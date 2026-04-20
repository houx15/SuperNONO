use serde::{Deserialize, Serialize};
use tauri::AppHandle;

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
    _app: AppHandle,
    _session_id: String,
    _app_id: String,
    _access_key: String,
    _params: AsrStartParams,
) -> Result<(), String> {
    Err("asr_start: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn asr_send_audio(_session_id: String, _pcm_chunk: Vec<u8>) -> Result<(), String> {
    Err("asr_send_audio: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn asr_stop(_session_id: String) -> Result<(), String> {
    Err("asr_stop: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn asr_test_credentials(
    _app_id: String,
    _access_key: String,
) -> Result<TestResult, String> {
    Ok(TestResult {
        ok: false,
        reason: Some("Not implemented until M2".into()),
    })
}
