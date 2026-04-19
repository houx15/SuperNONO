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
    pub fn encode_start_session(system_prompt: &str, voice: &str) -> serde_json::Value {
        serde_json::json!({
            "event": "StartSession",
            "payload": {
                "tts": { "speaker": voice },
                "prompts": { "system": system_prompt }
            }
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn start_session_payload_shape() {
            let v = encode_start_session("hello", "vv");
            assert_eq!(v["event"], "StartSession");
            assert_eq!(v["payload"]["tts"]["speaker"], "vv");
        }
    }
}

#[tauri::command]
pub async fn e2e_open(
    _session_id: String,
    _token: String,
    _opts: E2eOpenOpts,
) -> Result<(), String> {
    Err("e2e_open: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn e2e_send_audio(_session_id: String, _pcm_chunk: Vec<u8>) -> Result<(), String> {
    Err("e2e_send_audio: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn e2e_close(_session_id: String) -> Result<(), String> {
    Err("e2e_close: real connection implemented in M2".into())
}

#[tauri::command]
pub async fn e2e_test_credentials(_api_key: String) -> Result<TestResult, String> {
    Ok(TestResult {
        ok: false,
        reason: Some("Not implemented until M2".into()),
    })
}
