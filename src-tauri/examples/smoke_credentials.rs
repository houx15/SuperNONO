//! Credential smoke test against real Volcano + LLM provider endpoints.
//!
//! Reads ../config/secrets (gitignored). Required keys:
//!   APP_ID, ACCESS_TOKEN                           — Volcano voice services
//!   LLM_API_KEY                                    — any provider
//! Optional LLM tuning (defaults match Doubao/Ark):
//!   LLM_BASE_URL   (default https://ark.cn-beijing.volces.com/api/v3)
//!   LLM_MODEL      (default doubao-seed-2-0-code-preview-260215)
//!   LLM_SDK_SHAPE  (openai | anthropic; default openai)
//!
//! Hits:
//!   1. LLM /chat/completions (OpenAI shape) or /messages (Anthropic shape)
//!   2. bigmodel_async ASR WS handshake + first full_client_request frame
//!   3. realtime/dialogue E2E WS handshake + StartConnection + StartSession
//!
//! Frame encoding is inlined here (not imported from lib) to avoid making
//! the commands module public. The bytes match exactly what the production
//! code in `commands::{volcano_ws, e2e_ws}::frame` produces.
//!
//! Run: `cd src-tauri && cargo run --example smoke_credentials`

use std::collections::HashMap;
use std::time::Instant;

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, protocol::Message},
};
use uuid::Uuid;

fn load_secrets() -> HashMap<String, String> {
    let path = std::path::Path::new("../config/secrets");
    let text = std::fs::read_to_string(path).expect("read ../config/secrets");
    let mut m = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            m.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    m
}

fn redact(s: &str) -> String {
    if s.len() < 8 {
        "***".into()
    } else {
        format!("{}…{}", &s[..4], &s[s.len() - 4..])
    }
}

// SAUC full client request: header(4) + payload_size(4) + payload
fn encode_asr_first_frame(payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + payload.len());
    out.extend_from_slice(&[0x11, 0x10, 0x10, 0x00]);
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

// E2E event frame: header(4) + event_id(4) + [session_id_size(4)+session_id] + payload_size(4) + payload
fn encode_e2e_event(
    msg_type: u8,
    ser: u8,
    event_id: u32,
    session_id: Option<&str>,
    payload: &[u8],
) -> Vec<u8> {
    let mut out = Vec::new();
    let flags = 0b0100;
    out.extend_from_slice(&[0x11, (msg_type << 4) | flags, (ser << 4), 0x00]);
    out.extend_from_slice(&event_id.to_be_bytes());
    if let Some(sid) = session_id {
        out.extend_from_slice(&(sid.len() as u32).to_be_bytes());
        out.extend_from_slice(sid.as_bytes());
    }
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

fn encode_start_connection() -> Vec<u8> {
    encode_e2e_event(0b0001, 0b0001, 1, None, b"{}")
}

fn encode_start_session(session_id: &str, system_prompt: &str, voice: &str) -> Vec<u8> {
    let payload = serde_json::json!({
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
    encode_e2e_event(0b0001, 0b0001, 100, Some(session_id), body.as_bytes())
}

async fn smoke_llm(
    base_url: &str,
    model: &str,
    api_key: &str,
    sdk_shape: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap();
    let base = base_url.trim_end_matches('/');
    let (url, body, resp_parser): (String, serde_json::Value, fn(&serde_json::Value) -> String) =
        match sdk_shape {
            "openai" => (
                format!("{base}/chat/completions"),
                serde_json::json!({
                    "model": model,
                    "messages": [{"role": "user", "content": "Say hi in 3 words."}],
                    "stream": false,
                    "max_tokens": 20,
                }),
                |v| {
                    v["choices"][0]["message"]["content"]
                        .as_str()
                        .unwrap_or("")
                        .to_string()
                },
            ),
            "anthropic" => (
                format!("{base}/messages"),
                serde_json::json!({
                    "model": model,
                    "messages": [{"role": "user", "content": "Say hi in 3 words."}],
                    "max_tokens": 20,
                }),
                |v| {
                    let parts = v["content"].as_array().cloned().unwrap_or_default();
                    let mut s = String::new();
                    for p in parts {
                        if p["type"].as_str() == Some("text") {
                            if let Some(t) = p["text"].as_str() {
                                s.push_str(t);
                            }
                        }
                    }
                    s
                },
            ),
            other => return Err(format!("unsupported sdk_shape: {other}")),
        };

    let mut req = client.post(&url).json(&body);
    req = match sdk_shape {
        "openai" => req.bearer_auth(api_key),
        "anthropic" => req
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json"),
        _ => req,
    };

    let resp = req.send().await.map_err(|e| format!("network: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "HTTP {status}: {}",
            text.chars().take(240).collect::<String>()
        ));
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("parse: {e}"))?;
    Ok(resp_parser(&v))
}

async fn smoke_asr(app_id: &str, access_token: &str) -> Result<String, String> {
    let url = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
    let connect_id = Uuid::new_v4().to_string();
    let mut req = url.into_client_request().map_err(|e| e.to_string())?;
    let h = req.headers_mut();
    h.insert("X-Api-App-Key", app_id.parse().unwrap());
    h.insert("X-Api-Access-Key", access_token.parse().unwrap());
    h.insert(
        "X-Api-Resource-Id",
        "volc.bigasr.sauc.duration".parse().unwrap(),
    );
    h.insert("X-Api-Connect-Id", connect_id.parse().unwrap());

    let connect =
        tokio::time::timeout(std::time::Duration::from_secs(10), connect_async(req)).await;
    let (ws, resp) = match connect {
        Ok(Ok(ok)) => ok,
        Ok(Err(e)) => return Err(format!("connect: {e}")),
        Err(_) => return Err("connect timeout".into()),
    };
    let logid = resp
        .headers()
        .get("X-Tt-Logid")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<no-logid>")
        .to_string();

    let (mut sink, mut stream) = ws.split();

    let first = serde_json::json!({
        "user": { "uid": "supernono-smoke" },
        "audio": { "format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1 },
        "request": {
            "model_name": "bigmodel",
            "enable_punc": true,
            "enable_itn": true,
            "show_utterances": true,
            "end_window_size": 800
        }
    });
    let frame = encode_asr_first_frame(first.to_string().as_bytes());
    sink.send(Message::Binary(frame.into()))
        .await
        .map_err(|e| format!("send first frame: {e}"))?;

    let recv = tokio::time::timeout(std::time::Duration::from_secs(3), stream.next()).await;
    let summary = match recv {
        Ok(Some(Ok(Message::Binary(bytes)))) => {
            if bytes.len() < 4 {
                "too-short frame".into()
            } else {
                let msg_type = (bytes[1] >> 4) & 0x0f;
                match msg_type {
                    0b1001 => format!("response frame ({} bytes)", bytes.len()),
                    0b1111 => {
                        // error: 4B code, 4B size, utf8 msg
                        let mut off = 4usize;
                        let code = u32::from_be_bytes(bytes[off..off + 4].try_into().unwrap());
                        off += 4;
                        let size =
                            u32::from_be_bytes(bytes[off..off + 4].try_into().unwrap()) as usize;
                        off += 4;
                        let end = (off + size).min(bytes.len());
                        let msg = String::from_utf8_lossy(&bytes[off..end]).into_owned();
                        let _ = sink.close().await;
                        return Err(format!("server err code {code}: {msg}"));
                    }
                    other => format!("msg_type={other:#x}"),
                }
            }
        }
        Ok(Some(Ok(Message::Close(f)))) => {
            let _ = sink.close().await;
            return Err(format!("server closed: {:?}", f));
        }
        Ok(Some(Ok(_))) => "other msg".into(),
        Ok(Some(Err(e))) => {
            let _ = sink.close().await;
            return Err(format!("recv: {e}"));
        }
        Ok(None) => "stream ended".into(),
        Err(_) => "no server frame within 3s (ok — server awaits audio)".into(),
    };

    let _ = sink.close().await;
    Ok(format!("handshake ok · logid={logid} · {summary}"))
}

async fn smoke_e2e(app_id: &str, access_token: &str) -> Result<String, String> {
    let url = "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";
    let connect_id = Uuid::new_v4().to_string();
    let mut req = url.into_client_request().map_err(|e| e.to_string())?;
    let h = req.headers_mut();
    h.insert("X-Api-App-ID", app_id.parse().unwrap());
    h.insert("X-Api-Access-Key", access_token.parse().unwrap());
    h.insert("X-Api-Resource-Id", "volc.speech.dialog".parse().unwrap());
    h.insert("X-Api-App-Key", "PlgvMymc7f3tQnJ6".parse().unwrap());
    h.insert("X-Api-Connect-Id", connect_id.parse().unwrap());

    let connect =
        tokio::time::timeout(std::time::Duration::from_secs(10), connect_async(req)).await;
    let (ws, resp) = match connect {
        Ok(Ok(ok)) => ok,
        Ok(Err(e)) => return Err(format!("connect: {e}")),
        Err(_) => return Err("connect timeout".into()),
    };
    let logid = resp
        .headers()
        .get("X-Tt-Logid")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<no-logid>")
        .to_string();

    let (mut sink, mut stream) = ws.split();

    sink.send(Message::Binary(encode_start_connection().into()))
        .await
        .map_err(|e| format!("send StartConnection: {e}"))?;
    sink.send(Message::Binary(
        encode_start_session(
            "smoke-sess",
            "You are Nono, a meeting assistant.",
            "zh_female_vv_jupiter_bigtts",
        )
        .into(),
    ))
    .await
    .map_err(|e| format!("send StartSession: {e}"))?;

    let mut saw_conn_started = false;
    let mut saw_sess_started = false;
    let deadline = Instant::now() + std::time::Duration::from_secs(5);
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let recv = tokio::time::timeout(remaining, stream.next()).await;
        match recv {
            Ok(Some(Ok(Message::Binary(bytes)))) => {
                if bytes.len() < 8 {
                    continue;
                }
                let msg_type = (bytes[1] >> 4) & 0x0f;
                let flags = bytes[1] & 0x0f;
                if msg_type == 0b1001 && flags & 0b0100 != 0 {
                    let event_id = u32::from_be_bytes(bytes[4..8].try_into().unwrap());
                    match event_id {
                        50 => saw_conn_started = true,
                        150 => {
                            saw_sess_started = true;
                            break;
                        }
                        _ => {}
                    }
                } else if msg_type == 0b1111 {
                    let mut off = 4usize;
                    let code = u32::from_be_bytes(bytes[off..off + 4].try_into().unwrap());
                    off += 4;
                    let size = if bytes.len() >= off + 4 {
                        let s =
                            u32::from_be_bytes(bytes[off..off + 4].try_into().unwrap()) as usize;
                        off += 4;
                        s
                    } else {
                        0
                    };
                    let end = (off + size).min(bytes.len());
                    let msg = String::from_utf8_lossy(&bytes[off..end]).into_owned();
                    let _ = sink.close().await;
                    return Err(format!("code {code}: {msg}"));
                }
            }
            Ok(Some(Ok(Message::Close(f)))) => {
                let _ = sink.close().await;
                return Err(format!("server closed: {:?}", f));
            }
            Ok(Some(Ok(_))) => continue,
            Ok(Some(Err(e))) => {
                let _ = sink.close().await;
                return Err(format!("recv: {e}"));
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }

    let _ = sink.close().await;
    Ok(format!(
        "handshake ok · logid={logid} · ConnectionStarted={saw_conn_started} · SessionStarted={saw_sess_started}"
    ))
}

#[tokio::main]
async fn main() {
    let secrets = load_secrets();
    let app_id = secrets.get("APP_ID").cloned().expect("APP_ID");
    let access_token = secrets.get("ACCESS_TOKEN").cloned().expect("ACCESS_TOKEN");
    let llm_key = secrets.get("LLM_API_KEY").cloned().expect("LLM_API_KEY");
    let llm_base_url = secrets
        .get("LLM_BASE_URL")
        .cloned()
        .unwrap_or_else(|| "https://ark.cn-beijing.volces.com/api/v3".into());
    let llm_model = secrets
        .get("LLM_MODEL")
        .cloned()
        .unwrap_or_else(|| "doubao-seed-2-0-code-preview-260215".into());
    let llm_sdk_shape = secrets
        .get("LLM_SDK_SHAPE")
        .cloned()
        .unwrap_or_else(|| "openai".into());

    println!(
        "APP_ID={app_id}  ACCESS_TOKEN={}  LLM={}/{} ({}) KEY={}",
        redact(&access_token),
        llm_base_url,
        llm_model,
        llm_sdk_shape,
        redact(&llm_key),
    );

    println!("\n=== 1. LLM ({llm_sdk_shape} shape) ===");
    let t = Instant::now();
    match smoke_llm(&llm_base_url, &llm_model, &llm_key, &llm_sdk_shape).await {
        Ok(content) => println!(
            "✓ PASS ({:.1}s)  reply: {content:?}",
            t.elapsed().as_secs_f32()
        ),
        Err(e) => println!("✗ FAIL ({:.1}s)  {e}", t.elapsed().as_secs_f32()),
    }

    println!("\n=== 2. Volcano ASR (bigmodel_async) ===");
    let t = Instant::now();
    match smoke_asr(&app_id, &access_token).await {
        Ok(info) => println!("✓ PASS ({:.1}s)  {info}", t.elapsed().as_secs_f32()),
        Err(e) => println!("✗ FAIL ({:.1}s)  {e}", t.elapsed().as_secs_f32()),
    }

    println!("\n=== 3. Doubao E2E Realtime (realtime/dialogue) ===");
    let t = Instant::now();
    match smoke_e2e(&app_id, &access_token).await {
        Ok(info) => println!("✓ PASS ({:.1}s)  {info}", t.elapsed().as_secs_f32()),
        Err(e) => println!("✗ FAIL ({:.1}s)  {e}", t.elapsed().as_secs_f32()),
    }
}
