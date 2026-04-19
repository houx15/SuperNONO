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
// M1: codec unit tests only. Live .connect() path is completed in M2.
pub mod frame {
    #[derive(Debug, PartialEq)]
    pub struct Frame {
        pub message_type: u8,
        pub flags: u8,
        pub serialization: u8,
        pub compression: u8,
        pub payload: Vec<u8>,
    }

    pub fn encode_header(f: &Frame) -> [u8; 4] {
        [
            0x11,
            (f.message_type << 4) | f.flags,
            (f.serialization << 4) | f.compression,
            0x00,
        ]
    }

    pub fn decode_header(bytes: &[u8]) -> Option<(u8, u8, u8, u8)> {
        if bytes.len() < 4 {
            return None;
        }
        let msg = (bytes[1] >> 4) & 0x0f;
        let flags = bytes[1] & 0x0f;
        let ser = (bytes[2] >> 4) & 0x0f;
        let comp = bytes[2] & 0x0f;
        Some((msg, flags, ser, comp))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn round_trip_header() {
            let f = Frame {
                message_type: 1,
                flags: 0,
                serialization: 1,
                compression: 0,
                payload: vec![],
            };
            let h = encode_header(&f);
            let (m, fl, s, c) = decode_header(&h).unwrap();
            assert_eq!((m, fl, s, c), (1, 0, 1, 0));
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
