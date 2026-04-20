use serde::{Deserialize, Serialize};

const ARK_URL: &str = "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const DEFAULT_MODEL: &str = "doubao-1-5-pro-256k";

#[derive(Debug, Serialize, Deserialize)]
pub struct TestResult {
    pub ok: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub text: String,
}

#[derive(Serialize)]
struct ArkMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct ArkRequest<'a> {
    model: &'a str,
    messages: Vec<ArkMessage<'a>>,
    stream: bool,
    max_tokens: u32,
}

#[derive(Deserialize)]
struct ArkChoiceMessage {
    content: String,
}

#[derive(Deserialize)]
struct ArkChoice {
    message: ArkChoiceMessage,
}

#[derive(Deserialize)]
struct ArkResponseBody {
    choices: Vec<ArkChoice>,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("reqwest client")
}

#[tauri::command]
pub async fn doubao_complete(api_key: String, prompt: String) -> Result<ChatResponse, String> {
    let body = ArkRequest {
        model: DEFAULT_MODEL,
        messages: vec![ArkMessage {
            role: "user",
            content: &prompt,
        }],
        stream: false,
        max_tokens: 1500,
    };
    let resp = client()
        .post(ARK_URL)
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "HTTP {status}: {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    let parsed: ArkResponseBody = resp.json().await.map_err(|e| format!("parse: {e}"))?;
    let text = parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .unwrap_or_default();
    Ok(ChatResponse { text })
}

#[tauri::command]
pub async fn doubao_test_credentials(api_key: String) -> Result<TestResult, String> {
    let body = ArkRequest {
        model: DEFAULT_MODEL,
        messages: vec![ArkMessage {
            role: "user",
            content: "hi",
        }],
        stream: false,
        max_tokens: 1,
    };
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client()
            .post(ARK_URL)
            .bearer_auth(&api_key)
            .json(&body)
            .send(),
    )
    .await;
    match outcome {
        Ok(Ok(resp)) if resp.status().is_success() => Ok(TestResult {
            ok: true,
            reason: None,
        }),
        Ok(Ok(resp)) => {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            Ok(TestResult {
                ok: false,
                reason: Some(format!(
                    "HTTP {status}: {}",
                    text.chars().take(200).collect::<String>()
                )),
            })
        }
        Ok(Err(e)) => Ok(TestResult {
            ok: false,
            reason: Some(format!("network: {e}")),
        }),
        Err(_) => Ok(TestResult {
            ok: false,
            reason: Some("timeout".into()),
        }),
    }
}
