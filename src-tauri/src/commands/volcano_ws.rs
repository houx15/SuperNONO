use std::sync::Arc;

use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Emitter, State};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, protocol::Message},
};
use uuid::Uuid;

pub struct AsrSession {
    pub audio_tx: mpsc::Sender<Vec<u8>>,
    pub _send_join: JoinHandle<()>,
    pub _recv_join: JoinHandle<()>,
}

pub type AsrSessions = Arc<DashMap<String, AsrSession>>;

pub fn new_sessions() -> AsrSessions {
    Arc::new(DashMap::new())
}

const ASR_URL: &str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";

#[derive(Debug, Serialize, Clone)]
pub struct TypedError {
    pub kind: String,
    pub message: String,
    pub retryable: bool,
}

impl TypedError {
    pub fn auth(msg: impl Into<String>) -> Self {
        Self {
            kind: "auth".into(),
            message: msg.into(),
            retryable: false,
        }
    }
    pub fn network(msg: impl Into<String>) -> Self {
        Self {
            kind: "network".into(),
            message: msg.into(),
            retryable: true,
        }
    }
    pub fn server(msg: impl Into<String>) -> Self {
        Self {
            kind: "server".into(),
            message: msg.into(),
            retryable: true,
        }
    }
    pub fn protocol(msg: impl Into<String>) -> Self {
        Self {
            kind: "protocol".into(),
            message: msg.into(),
            retryable: false,
        }
    }
    pub fn rate_limit(msg: impl Into<String>) -> Self {
        Self {
            kind: "rate_limit".into(),
            message: msg.into(),
            retryable: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AsrStartParams {
    pub lang: String,
    pub enable_speaker_id: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestResult {
    pub ok: bool,
    pub reason: Option<String>,
}

// Reference: docs/volcano/asr-stream-api.md — binary frame layout.
// M2: codec helpers used by the live Volcano ASR WebSocket bridge.
pub mod frame {
    use serde::Deserialize;

    #[derive(Debug, Clone, Deserialize)]
    pub struct Utterance {
        pub text: String,
        #[serde(default)]
        pub start_time: u64,
        #[serde(default)]
        pub end_time: u64,
        #[serde(default)]
        pub definite: bool,
    }

    #[derive(Debug)]
    pub enum ServerFrame {
        Response {
            sequence: i32,
            text: String,
            utterances: Vec<Utterance>,
        },
        Error {
            code: u32,
            message: String,
        },
    }

    pub fn encode_full_client_request(payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + payload.len());
        out.push(0x11); // v1, 4-byte header
        out.push(0x10); // msg_type=0b0001 (full client request), flags=0
        out.push(0x10); // serialization=JSON, compression=none
        out.push(0x00); // reserved
        out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    pub fn encode_audio_only(pcm: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + pcm.len());
        out.push(0x11);
        out.push(0x20); // msg_type=0b0010 (audio only), flags=0
        out.push(0x00); // serialization=raw, compression=none
        out.push(0x00);
        out.extend_from_slice(&(pcm.len() as u32).to_be_bytes());
        out.extend_from_slice(pcm);
        out
    }

    pub fn encode_audio_only_last(pcm: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + pcm.len());
        out.push(0x11);
        out.push(0x22); // flags 0b0010 = last packet (negative)
        out.push(0x00);
        out.push(0x00);
        out.extend_from_slice(&(pcm.len() as u32).to_be_bytes());
        out.extend_from_slice(pcm);
        out
    }

    pub fn decode_server_frame(bytes: &[u8]) -> Option<ServerFrame> {
        if bytes.len() < 4 {
            return None;
        }
        let msg_type = (bytes[1] >> 4) & 0x0f;
        let flags = bytes[1] & 0x0f;
        let mut off = 4;
        let sequence = if (flags & 0b0001) != 0 && msg_type == 0b1001 {
            if bytes.len() < off + 4 {
                return None;
            }
            let s = i32::from_be_bytes(bytes[off..off + 4].try_into().ok()?);
            off += 4;
            s
        } else {
            0
        };
        match msg_type {
            0b1001 => {
                if bytes.len() < off + 4 {
                    return None;
                }
                let size = u32::from_be_bytes(bytes[off..off + 4].try_into().ok()?) as usize;
                off += 4;
                if bytes.len() < off + size {
                    return None;
                }
                let json = &bytes[off..off + size];
                #[derive(Deserialize)]
                struct Wrap {
                    result: Option<Result_>,
                }
                #[derive(Deserialize)]
                struct Result_ {
                    #[serde(default)]
                    text: String,
                    #[serde(default)]
                    utterances: Vec<Utterance>,
                }
                let parsed: Wrap = serde_json::from_slice(json).ok()?;
                let r = parsed.result.unwrap_or(Result_ {
                    text: String::new(),
                    utterances: vec![],
                });
                Some(ServerFrame::Response {
                    sequence,
                    text: r.text,
                    utterances: r.utterances,
                })
            }
            0b1111 => {
                if bytes.len() < off + 8 {
                    return None;
                }
                let code = u32::from_be_bytes(bytes[off..off + 4].try_into().ok()?);
                let size = u32::from_be_bytes(bytes[off + 4..off + 8].try_into().ok()?) as usize;
                off += 8;
                if bytes.len() < off + size {
                    return None;
                }
                let msg = String::from_utf8_lossy(&bytes[off..off + size]).into_owned();
                Some(ServerFrame::Error { code, message: msg })
            }
            _ => None,
        }
    }
    // (tests live below)

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_encode_full_client_request() {
            let payload = br#"{"x":1}"#.to_vec();
            let bytes = encode_full_client_request(&payload);
            // header byte 0: 0x11 (v1, 4-byte header)
            assert_eq!(bytes[0], 0x11);
            // byte 1: message type 0b0001 << 4 | flags 0b0000 = 0x10
            assert_eq!(bytes[1], 0x10);
            // byte 2: serialization 0b0001 << 4 | compression 0b0000 = 0x10
            assert_eq!(bytes[2], 0x10);
            // byte 3: reserved = 0x00
            assert_eq!(bytes[3], 0x00);
            // bytes 4..8: payload size BE
            let size = u32::from_be_bytes(bytes[4..8].try_into().unwrap());
            assert_eq!(size as usize, payload.len());
            // remainder: payload
            assert_eq!(&bytes[8..], &payload[..]);
        }

        #[test]
        fn test_encode_audio_only_request() {
            let pcm = vec![0x01u8, 0x02, 0x03];
            let bytes = encode_audio_only(&pcm);
            // header byte 0: 0x11
            assert_eq!(bytes[0], 0x11);
            // byte 1: msg type 0b0010 << 4 | flags 0b0000 = 0x20
            assert_eq!(bytes[1], 0x20);
            // byte 2: raw serialization, no compression = 0x00
            assert_eq!(bytes[2], 0x00);
            let size = u32::from_be_bytes(bytes[4..8].try_into().unwrap());
            assert_eq!(size as usize, pcm.len());
            assert_eq!(&bytes[8..], &pcm[..]);
        }

        #[test]
        fn decode_full_server_response_partial() {
            // Build a minimal server response: header + sequence + payload_size + json
            let json = br#"{"result":{"text":"hello","utterances":[{"text":"hel","start_time":0,"end_time":100,"definite":false}]}}"#;
            let mut frame = vec![0x11u8, 0x91, 0x10, 0x00]; // msg type 0b1001, flags 0b0001 (sequence)
            frame.extend_from_slice(&1u32.to_be_bytes()); // sequence
            frame.extend_from_slice(&(json.len() as u32).to_be_bytes());
            frame.extend_from_slice(json);

            let decoded = decode_server_frame(&frame).expect("decode");
            match decoded {
                ServerFrame::Response { utterances, .. } => {
                    assert_eq!(utterances.len(), 1);
                    assert_eq!(utterances[0].text, "hel");
                    assert!(!utterances[0].definite);
                }
                other => panic!("expected Response, got {other:?}"),
            }
        }

        #[test]
        fn decode_full_server_response_final() {
            let json = br#"{"result":{"text":"hello","utterances":[{"text":"hello","start_time":0,"end_time":300,"definite":true}]}}"#;
            let mut frame = vec![0x11u8, 0x91, 0x10, 0x00];
            frame.extend_from_slice(&2u32.to_be_bytes());
            frame.extend_from_slice(&(json.len() as u32).to_be_bytes());
            frame.extend_from_slice(json);
            match decode_server_frame(&frame).unwrap() {
                ServerFrame::Response { utterances, .. } => {
                    assert!(utterances[0].definite);
                }
                _ => panic!("expected Response"),
            }
        }

        #[test]
        fn decode_error_frame() {
            let err_text = b"bad request";
            let mut frame = vec![0x11u8, 0xf0, 0x00, 0x00]; // msg type 0b1111
            frame.extend_from_slice(&42u32.to_be_bytes()); // error code
            frame.extend_from_slice(&(err_text.len() as u32).to_be_bytes()); // error msg size
            frame.extend_from_slice(err_text);
            match decode_server_frame(&frame).unwrap() {
                ServerFrame::Error { code, message } => {
                    assert_eq!(code, 42);
                    assert_eq!(message, "bad request");
                }
                _ => panic!("expected Error"),
            }
        }
    }
}

#[tauri::command]
pub async fn asr_start(
    app: tauri::AppHandle,
    sessions: State<'_, AsrSessions>,
    session_id: String,
    app_id: String,
    access_key: String,
    params: AsrStartParams,
) -> Result<(), String> {
    let connect_id = Uuid::new_v4().to_string();
    let mut req = ASR_URL.into_client_request().map_err(|e| e.to_string())?;
    let h = req.headers_mut();
    h.insert("X-Api-App-Key", app_id.parse().unwrap());
    h.insert("X-Api-Access-Key", access_key.parse().unwrap());
    h.insert(
        "X-Api-Resource-Id",
        "volc.bigasr.sauc.duration".parse().unwrap(),
    );
    h.insert("X-Api-Connect-Id", connect_id.parse().unwrap());

    let (ws, _resp) = match connect_async(req).await {
        Ok(ok) => ok,
        Err(e) => {
            let msg = e.to_string();
            let kind = if msg.contains("401") || msg.contains("403") {
                TypedError::auth(msg)
            } else {
                TypedError::network(msg)
            };
            app.emit("asr://error", kind).ok();
            return Err("connect failed".into());
        }
    };

    let (mut sink, mut stream) = ws.split();

    // First frame: full client request with audio+request config.
    let first_payload = json!({
        "user": { "uid": "supernono" },
        "audio": { "format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1 },
        "request": {
            "model_name": "bigmodel",
            "enable_punc": true,
            "enable_itn": true,
            "show_utterances": true,
            "end_window_size": 800
        }
    });
    let first_bytes = frame::encode_full_client_request(first_payload.to_string().as_bytes());
    if let Err(e) = sink.send(Message::Binary(first_bytes.into())).await {
        app.emit("asr://error", TypedError::network(e.to_string()))
            .ok();
        return Err("send first frame failed".into());
    }

    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(32);

    let app_send = app.clone();
    let send_join: JoinHandle<()> = tokio::spawn(async move {
        while let Some(pcm) = rx.recv().await {
            let frame_bytes = frame::encode_audio_only(&pcm);
            if let Err(e) = sink.send(Message::Binary(frame_bytes.into())).await {
                app_send
                    .emit("asr://error", TypedError::network(e.to_string()))
                    .ok();
                break;
            }
        }
        let _ = sink.close().await;
    });

    let app_recv = app.clone();
    let recv_join: JoinHandle<()> = tokio::spawn(async move {
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(Message::Binary(bytes)) => {
                    if let Some(f) = frame::decode_server_frame(&bytes) {
                        match f {
                            frame::ServerFrame::Response { utterances, .. } => {
                                for u in utterances {
                                    let payload = serde_json::json!({
                                        "text": u.text,
                                        "startMs": u.start_time,
                                        "endMs": u.end_time,
                                        "isFinal": u.definite,
                                    });
                                    let ev = if u.definite {
                                        "asr://final"
                                    } else {
                                        "asr://partial"
                                    };
                                    app_recv.emit(ev, payload).ok();
                                }
                            }
                            frame::ServerFrame::Error { code, message } => {
                                let kind = if code == 401 || code == 403 {
                                    TypedError::auth(message)
                                } else if code == 429 {
                                    TypedError::rate_limit(message)
                                } else if code >= 500 {
                                    TypedError::server(message)
                                } else {
                                    TypedError::protocol(message)
                                };
                                app_recv.emit("asr://error", kind).ok();
                            }
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    app_recv.emit("asr://closed", ()).ok();
                    break;
                }
                Err(e) => {
                    app_recv
                        .emit("asr://error", TypedError::network(e.to_string()))
                        .ok();
                    break;
                }
                _ => {}
            }
        }
    });

    sessions.insert(
        session_id,
        AsrSession {
            audio_tx: tx,
            _send_join: send_join,
            _recv_join: recv_join,
        },
    );
    let _ = params; // silence unused
    Ok(())
}

#[tauri::command]
pub async fn asr_send_audio(
    sessions: State<'_, AsrSessions>,
    session_id: String,
    pcm_chunk: Vec<u8>,
) -> Result<(), String> {
    if let Some(sess) = sessions.get(&session_id) {
        // Drop on full channel — slightly better than backpressure for a live capture loop.
        let _ = sess.audio_tx.try_send(pcm_chunk);
        Ok(())
    } else {
        Err("session not found".into())
    }
}

#[tauri::command]
pub async fn asr_stop(sessions: State<'_, AsrSessions>, session_id: String) -> Result<(), String> {
    sessions.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn asr_test_credentials(
    app_id: String,
    access_key: String,
) -> Result<TestResult, String> {
    let connect_id = Uuid::new_v4().to_string();
    let mut req = match ASR_URL.into_client_request() {
        Ok(r) => r,
        Err(e) => {
            return Ok(TestResult {
                ok: false,
                reason: Some(e.to_string()),
            })
        }
    };
    let h = req.headers_mut();
    let _ = h.insert("X-Api-App-Key", app_id.parse().unwrap());
    let _ = h.insert("X-Api-Access-Key", access_key.parse().unwrap());
    let _ = h.insert(
        "X-Api-Resource-Id",
        "volc.bigasr.sauc.duration".parse().unwrap(),
    );
    let _ = h.insert("X-Api-Connect-Id", connect_id.parse().unwrap());
    match tokio::time::timeout(std::time::Duration::from_secs(5), connect_async(req)).await {
        Ok(Ok((ws, _))) => {
            let (mut sink, _stream) = ws.split();
            let _ = sink.close().await;
            Ok(TestResult {
                ok: true,
                reason: None,
            })
        }
        Ok(Err(e)) => Ok(TestResult {
            ok: false,
            reason: Some(e.to_string()),
        }),
        Err(_) => Ok(TestResult {
            ok: false,
            reason: Some("timeout".into()),
        }),
    }
}
