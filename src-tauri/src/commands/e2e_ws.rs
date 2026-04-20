use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct E2eOpenOpts {
    pub system_prompt: String,
    pub voice: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestResult {
    pub ok: bool,
    pub reason: Option<String>,
}

// Reference: docs/volcano/e2e-interaction-api.md — PCM in, PCM out.
pub mod frame {
    use serde_json::json;

    #[derive(Debug)]
    pub enum ServerFrame {
        Event { event_id: u32, payload: Vec<u8> },
        Audio { pcm: Vec<u8> },
        Error { code: u32, message: String },
    }

    fn header(msg_type: u8, has_event: bool, ser: u8, comp: u8) -> [u8; 4] {
        let flags = if has_event { 0b0100 } else { 0b0000 };
        [0x11, (msg_type << 4) | flags, (ser << 4) | comp, 0x00]
    }

    fn write_event_frame(
        msg_type: u8,
        ser: u8,
        event_id: u32,
        session_id: Option<&str>,
        payload: &[u8],
    ) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&header(msg_type, true, ser, 0));
        out.extend_from_slice(&event_id.to_be_bytes());
        if let Some(sid) = session_id {
            out.extend_from_slice(&(sid.len() as u32).to_be_bytes());
            out.extend_from_slice(sid.as_bytes());
        }
        out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        out.extend_from_slice(payload);
        out
    }

    pub fn encode_start_connection() -> Vec<u8> {
        write_event_frame(0b0001, 0b0001, 1, None, b"{}")
    }

    pub fn encode_start_session(session_id: &str, system_prompt: &str, voice: &str) -> Vec<u8> {
        let payload = json!({
            "tts": {
                "speaker": voice,
                "audio_config": { "channel": 1, "format": "pcm", "sample_rate": 24000 }
            },
            "dialog": {
                "bot_name": "Nono",
                "system_role": system_prompt,
                "extra": { "input_mod": "audio", "model": "1.2.1.1" }
            }
        });
        let body = payload.to_string();
        write_event_frame(0b0001, 0b0001, 100, Some(session_id), body.as_bytes())
    }

    pub fn encode_finish_session(session_id: &str) -> Vec<u8> {
        write_event_frame(0b0001, 0b0001, 102, Some(session_id), b"{}")
    }

    pub fn encode_finish_connection() -> Vec<u8> {
        write_event_frame(0b0001, 0b0001, 2, None, b"{}")
    }

    pub fn encode_task_request(session_id: &str, pcm: &[u8]) -> Vec<u8> {
        write_event_frame(0b0010, 0b0000, 200, Some(session_id), pcm)
    }

    pub fn decode_server_frame(bytes: &[u8]) -> Option<ServerFrame> {
        if bytes.len() < 4 {
            return None;
        }
        let msg_type = (bytes[1] >> 4) & 0x0f;
        let flags = bytes[1] & 0x0f;
        let mut off = 4;
        match msg_type {
            0b1001 => {
                // Full server response; flag 0b0100 means event present.
                let event_id = if flags & 0b0100 != 0 {
                    if bytes.len() < off + 4 {
                        return None;
                    }
                    let e = u32::from_be_bytes(bytes[off..off + 4].try_into().ok()?);
                    off += 4;
                    e
                } else {
                    0
                };
                if bytes.len() < off + 4 {
                    return None;
                }
                let size = u32::from_be_bytes(bytes[off..off + 4].try_into().ok()?) as usize;
                off += 4;
                if bytes.len() < off + size {
                    return None;
                }
                let payload = bytes[off..off + size].to_vec();
                Some(ServerFrame::Event { event_id, payload })
            }
            0b1011 => {
                if bytes.len() < off + 4 {
                    return None;
                }
                let size = u32::from_be_bytes(bytes[off..off + 4].try_into().ok()?) as usize;
                off += 4;
                if bytes.len() < off + size {
                    return None;
                }
                let pcm = bytes[off..off + size].to_vec();
                Some(ServerFrame::Audio { pcm })
            }
            0b1111 => {
                if bytes.len() < off + 4 {
                    return None;
                }
                let code = u32::from_be_bytes(bytes[off..off + 4].try_into().ok()?);
                off += 4;
                if bytes.len() < off + 4 {
                    return None;
                }
                let size = u32::from_be_bytes(bytes[off..off + 4].try_into().ok()?) as usize;
                off += 4;
                if bytes.len() < off + size {
                    return None;
                }
                let msg = String::from_utf8_lossy(&bytes[off..off + size]).into_owned();
                Some(ServerFrame::Error { code, message: msg })
            }
            _ => None,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn encode_start_connection_frame() {
            let bytes = encode_start_connection();
            // byte 0 = 0x11; byte 1 = msg_type=0b0001 << 4 | flags=0b0100 (event) = 0x14
            assert_eq!(bytes[0], 0x11);
            assert_eq!(bytes[1], 0x14);
            // byte 2 = serialization JSON | compression none = 0x10
            assert_eq!(bytes[2], 0x10);
            assert_eq!(bytes[3], 0x00);
            // next 4 bytes: event id = 1
            assert_eq!(&bytes[4..8], &1u32.to_be_bytes());
            // then payload size (4B) and empty JSON {}
            let size = u32::from_be_bytes(bytes[8..12].try_into().unwrap());
            assert_eq!(size, 2);
            assert_eq!(&bytes[12..14], b"{}");
        }

        #[test]
        fn encode_start_session_carries_session_id_and_payload() {
            let bytes = encode_start_session("sess-1", "prompt", "vv");
            assert_eq!(bytes[0], 0x11);
            assert_eq!(bytes[1], 0x14); // event flag
                                        // event id = 100
            assert_eq!(&bytes[4..8], &100u32.to_be_bytes());
            // session id size
            let sid_size = u32::from_be_bytes(bytes[8..12].try_into().unwrap()) as usize;
            assert_eq!(sid_size, "sess-1".len());
            // session id bytes
            assert_eq!(&bytes[12..12 + sid_size], b"sess-1");
            // payload size
            let payload_off = 12 + sid_size;
            let payload_size =
                u32::from_be_bytes(bytes[payload_off..payload_off + 4].try_into().unwrap())
                    as usize;
            let payload = &bytes[payload_off + 4..payload_off + 4 + payload_size];
            let parsed: serde_json::Value = serde_json::from_slice(payload).unwrap();
            assert_eq!(parsed["tts"]["speaker"], "vv");
            assert_eq!(parsed["tts"]["audio_config"]["format"], "pcm");
            assert_eq!(parsed["tts"]["audio_config"]["sample_rate"], 24000);
            assert_eq!(parsed["dialog"]["system_role"], "prompt");
        }

        #[test]
        fn encode_task_request_carries_audio() {
            let pcm = vec![0xAAu8, 0xBB, 0xCC];
            let bytes = encode_task_request("sess-1", &pcm);
            // msg type 0b0010 (audio only) | flags 0b0100 (event) = 0x24
            assert_eq!(bytes[1], 0x24);
            // serialization raw | compression none = 0x00
            assert_eq!(bytes[2], 0x00);
            assert_eq!(&bytes[4..8], &200u32.to_be_bytes()); // event id 200
        }

        #[test]
        fn decode_session_started_server_event() {
            // header + event id (150) + payload size + payload
            let payload = br#"{}"#;
            let mut frame = vec![0x11u8, 0x94, 0x10, 0x00];
            frame.extend_from_slice(&150u32.to_be_bytes());
            frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
            frame.extend_from_slice(payload);
            match decode_server_frame(&frame).unwrap() {
                ServerFrame::Event { event_id, .. } => assert_eq!(event_id, 150),
                _ => panic!("expected event"),
            }
        }

        #[test]
        fn decode_audio_only_response() {
            let pcm = vec![0x00, 0x01, 0x02, 0x03];
            let mut frame = vec![0x11u8, 0xb0, 0x00, 0x00]; // msg 0b1011 audio-only response
            frame.extend_from_slice(&(pcm.len() as u32).to_be_bytes());
            frame.extend_from_slice(&pcm);
            match decode_server_frame(&frame).unwrap() {
                ServerFrame::Audio { pcm: got } => assert_eq!(got, pcm),
                _ => panic!("expected audio"),
            }
        }

        #[test]
        fn decode_error_frame() {
            let err_payload = br#"{"error":"boom"}"#;
            let mut frame = vec![0x11u8, 0xf0, 0x10, 0x00];
            frame.extend_from_slice(&9u32.to_be_bytes()); // error code
            frame.extend_from_slice(&(err_payload.len() as u32).to_be_bytes());
            frame.extend_from_slice(err_payload);
            match decode_server_frame(&frame).unwrap() {
                ServerFrame::Error { code, message } => {
                    assert_eq!(code, 9);
                    assert!(message.contains("boom"));
                }
                _ => panic!("expected error"),
            }
        }
    }
}

// ─── Session registry ─────────────────────────────────────────────────────────

use std::sync::Arc;

use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use tauri::{Emitter, State};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, protocol::Message},
};
use uuid::Uuid;

use crate::commands::e2e_ws::frame::{
    decode_server_frame, encode_finish_session, encode_start_connection, encode_start_session,
    encode_task_request, ServerFrame,
};
use crate::commands::volcano_ws::TypedError;

const E2E_URL: &str = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";
const E2E_APP_KEY: &str = "PlgvMymc7f3tQnJ6"; // fixed per docs

pub struct E2eSession {
    pub audio_tx: mpsc::Sender<Vec<u8>>,
    pub _send_join: JoinHandle<()>,
    pub _recv_join: JoinHandle<()>,
}

pub type E2eSessions = Arc<DashMap<String, E2eSession>>;
pub fn new_e2e_sessions() -> E2eSessions {
    Arc::new(DashMap::new())
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn e2e_open(
    app: tauri::AppHandle,
    sessions: State<'_, E2eSessions>,
    session_id: String,
    app_id: String,
    access_key: String,
    opts: E2eOpenOpts,
) -> Result<(), String> {
    let connect_id = Uuid::new_v4().to_string();
    let mut req = E2E_URL.into_client_request().map_err(|e| e.to_string())?;
    let h = req.headers_mut();
    h.insert("X-Api-App-ID", app_id.parse().unwrap());
    h.insert("X-Api-Access-Key", access_key.parse().unwrap());
    h.insert("X-Api-Resource-Id", "volc.speech.dialog".parse().unwrap());
    h.insert("X-Api-App-Key", E2E_APP_KEY.parse().unwrap());
    h.insert("X-Api-Connect-Id", connect_id.parse().unwrap());

    let (ws, _) = match connect_async(req).await {
        Ok(ok) => ok,
        Err(e) => {
            let msg = e.to_string();
            let kind = if msg.contains("401") || msg.contains("403") {
                TypedError::auth(msg)
            } else {
                TypedError::network(msg)
            };
            app.emit("e2e://error", kind).ok();
            return Err("connect failed".into());
        }
    };
    let (mut sink, mut stream) = ws.split();

    // StartConnection → StartSession
    sink.send(Message::Binary(encode_start_connection().into()))
        .await
        .map_err(|e| e.to_string())?;
    sink.send(Message::Binary(
        encode_start_session(&session_id, &opts.system_prompt, &opts.voice).into(),
    ))
    .await
    .map_err(|e| e.to_string())?;

    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(32);
    let sid_send = session_id.clone();
    let app_send = app.clone();
    let send_join: JoinHandle<()> = tokio::spawn(async move {
        while let Some(pcm) = rx.recv().await {
            // Split into ~20ms sub-frames (640 bytes at 16kHz s16le mono).
            const SUB: usize = 640;
            for chunk in pcm.chunks(SUB) {
                let frame = encode_task_request(&sid_send, chunk);
                if let Err(e) = sink.send(Message::Binary(frame.into())).await {
                    app_send
                        .emit("e2e://error", TypedError::network(e.to_string()))
                        .ok();
                    return;
                }
            }
        }
        // Graceful finish
        let _ = sink
            .send(Message::Binary(encode_finish_session(&sid_send).into()))
            .await;
        let _ = sink.close().await;
    });

    let app_recv = app.clone();
    let recv_join: JoinHandle<()> = tokio::spawn(async move {
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(Message::Binary(bytes)) => match decode_server_frame(&bytes) {
                    Some(ServerFrame::Event { event_id, payload }) => match event_id {
                        451 => {
                            // user transcript
                            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&payload) {
                                let text = v["result"]["text"].as_str().unwrap_or("");
                                app_recv
                                    .emit(
                                        "e2e://question_transcript",
                                        serde_json::json!({ "text": text }),
                                    )
                                    .ok();
                            }
                        }
                        550 | 551 => {
                            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&payload) {
                                let text =
                                    v["text"].as_str().or(v["content"].as_str()).unwrap_or("");
                                app_recv
                                    .emit(
                                        "e2e://answer_transcript",
                                        serde_json::json!({ "text": text }),
                                    )
                                    .ok();
                            }
                        }
                        352 => {
                            app_recv.emit("e2e://turn_end", ()).ok();
                        }
                        _ => { /* connection/session lifecycle events — ignore */ }
                    },
                    Some(ServerFrame::Audio { pcm }) => {
                        app_recv.emit("e2e://audio", pcm).ok();
                    }
                    Some(ServerFrame::Error { code, message }) => {
                        let kind = if code == 401 || code == 403 {
                            TypedError::auth(message)
                        } else if code == 429 {
                            TypedError::rate_limit(message)
                        } else if code >= 500 {
                            TypedError::server(message)
                        } else {
                            TypedError::protocol(message)
                        };
                        app_recv.emit("e2e://error", kind).ok();
                    }
                    None => {}
                },
                Ok(Message::Close(_)) => break,
                Err(e) => {
                    app_recv
                        .emit("e2e://error", TypedError::network(e.to_string()))
                        .ok();
                    break;
                }
                _ => {}
            }
        }
    });

    sessions.insert(
        session_id,
        E2eSession {
            audio_tx: tx,
            _send_join: send_join,
            _recv_join: recv_join,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn e2e_send_audio(
    sessions: State<'_, E2eSessions>,
    session_id: String,
    pcm_chunk: Vec<u8>,
) -> Result<(), String> {
    if let Some(sess) = sessions.get(&session_id) {
        let _ = sess.audio_tx.try_send(pcm_chunk);
        Ok(())
    } else {
        Err("session not found".into())
    }
}

#[tauri::command]
pub async fn e2e_close(sessions: State<'_, E2eSessions>, session_id: String) -> Result<(), String> {
    sessions.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn e2e_test_credentials(
    app_id: String,
    access_key: String,
) -> Result<TestResult, String> {
    let connect_id = Uuid::new_v4().to_string();
    let mut req = match E2E_URL.into_client_request() {
        Ok(r) => r,
        Err(e) => {
            return Ok(TestResult {
                ok: false,
                reason: Some(e.to_string()),
            })
        }
    };
    let h = req.headers_mut();
    let _ = h.insert("X-Api-App-ID", app_id.parse().unwrap());
    let _ = h.insert("X-Api-Access-Key", access_key.parse().unwrap());
    let _ = h.insert("X-Api-Resource-Id", "volc.speech.dialog".parse().unwrap());
    let _ = h.insert("X-Api-App-Key", E2E_APP_KEY.parse().unwrap());
    let _ = h.insert("X-Api-Connect-Id", connect_id.parse().unwrap());

    match tokio::time::timeout(std::time::Duration::from_secs(5), connect_async(req)).await {
        Ok(Ok((ws, _))) => {
            let (mut sink, _stream) = ws.split();
            let _ = sink
                .send(Message::Binary(encode_start_connection().into()))
                .await;
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
