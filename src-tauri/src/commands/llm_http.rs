//! Generic LLM HTTP bridge.
//!
//! Two supported wire formats: `"openai"` (OpenAI-SDK-compatible: Doubao/Ark,
//! Moonshot/Kimi, Aliyun DashScope, Zhipu GLM, DeepSeek, native OpenAI…) and
//! `"anthropic"` (native Anthropic Messages API). Each provider sets its own
//! `base_url` + `model` + `api_key`; the shape switch chooses the request +
//! response parser.
//!
//! Routed through Rust (not TS `fetch`) because the webview blocks cross-origin
//! fetches to most of these hosts.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct TestResult {
    pub ok: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub text: String,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("reqwest client")
}

fn trim_trailing_slash(s: &str) -> &str {
    s.trim_end_matches('/')
}

fn short_body(text: String) -> String {
    text.chars().take(240).collect::<String>()
}

/// OpenAI-SDK-compatible request path.
async fn openai_complete(
    base_url: &str,
    model: &str,
    api_key: &str,
    prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", trim_trailing_slash(base_url));
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": false,
        "max_tokens": max_tokens,
    });
    let resp = client()
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {status}: {}", short_body(text)));
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("parse: {e}"))?;
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(content)
}

/// Anthropic Messages API.
async fn anthropic_complete(
    base_url: &str,
    model: &str,
    api_key: &str,
    prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let url = format!("{}/messages", trim_trailing_slash(base_url));
    let body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    });
    let resp = client()
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {status}: {}", short_body(text)));
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("parse: {e}"))?;
    // Anthropic response shape: { content: [{ type: "text", text: "..." }, ...] }
    let parts = v["content"].as_array().cloned().unwrap_or_default();
    let mut buf = String::new();
    for part in parts {
        if part["type"].as_str() == Some("text") {
            if let Some(t) = part["text"].as_str() {
                buf.push_str(t);
            }
        }
    }
    Ok(buf)
}

async fn complete_dispatch(
    base_url: &str,
    model: &str,
    api_key: &str,
    prompt: &str,
    sdk_shape: &str,
    max_tokens: u32,
) -> Result<String, String> {
    match sdk_shape {
        "openai" => openai_complete(base_url, model, api_key, prompt, max_tokens).await,
        "anthropic" => anthropic_complete(base_url, model, api_key, prompt, max_tokens).await,
        other => Err(format!("unsupported sdk_shape: {other}")),
    }
}

#[tauri::command]
pub async fn llm_complete(
    base_url: String,
    model: String,
    api_key: String,
    prompt: String,
    sdk_shape: String,
) -> Result<ChatResponse, String> {
    let text = complete_dispatch(&base_url, &model, &api_key, &prompt, &sdk_shape, 1500).await?;
    Ok(ChatResponse { text })
}

#[tauri::command]
pub async fn llm_test_credentials(
    base_url: String,
    model: String,
    api_key: String,
    sdk_shape: String,
) -> Result<TestResult, String> {
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        complete_dispatch(&base_url, &model, &api_key, "hi", &sdk_shape, 8),
    )
    .await;
    match outcome {
        Ok(Ok(_text)) => Ok(TestResult {
            ok: true,
            reason: None,
        }),
        Ok(Err(e)) => Ok(TestResult {
            ok: false,
            reason: Some(e),
        }),
        Err(_) => Ok(TestResult {
            ok: false,
            reason: Some("timeout".into()),
        }),
    }
}
