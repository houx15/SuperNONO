# 豆包语音凭证获取指南

SuperNono 需要三组凭证才能正常使用。它们来自火山引擎（Volcano Engine）的**两个不同控制台** — 这是最常见的混淆点。

---

## 总览

| 凭证 | 用途 | 从哪里获取 |
|---|---|---|
| **App ID** + **Access Token** | 实时 ASR 转写 + 唤醒词问答 | 火山引擎**语音服务**控制台 |
| **Doubao API Key (Ark)** | 滚动摘要 + 最终会议纪要 | 火山引擎 **Ark** 控制台 |

⚠ **常见误会：Ark API Key ≠ 火山引擎通用 API Key。** 两者来自不同的控制台、绑定不同的服务。如果把其他类型的 key 填到 Doubao 字段，会收到 `HTTP 401: The API key doesn't exist`。

---

## 步骤 1 — 获取 App ID + Access Token

这一组凭证同时覆盖"流式语音识别"和"端到端实时语音"两个 WebSocket 服务。两个产品共用一个 App ID 和 Access Token，只需在各自服务页面开通即可。

1. 打开火山引擎语音服务控制台: <https://console.volcengine.com/speech>
2. 分别进入以下两个产品页面，按提示开通（或确认已开通）:
   - **豆包·端到端实时语音大模型**: <https://console.volcengine.com/speech/service/10017>
   - **豆包·流式语音识别大模型**: <https://console.volcengine.com/speech/service/10038>
3. 在任一页面或「我的应用」中，定位你创建的应用，复制:
   - **App ID**（纯数字，例如 `6986180714`）
   - **Access Token**（字符串，例如 `RtAG...ZbXm`）

这两个值分别填入 SuperNono 的 **Settings → App ID** 与 **Access Token** 字段。点击 **测试** 按钮验证 — 通过即说明 Volcano WSS 握手成功。

## 步骤 2 — 获取 Doubao API Key (Ark)

这个 key **必须**在 Ark 控制台创建；不能用火山引擎其他产品的通用 API Key。

1. 打开 Ark API Key 页面: <https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey>
2. 在 Ark 控制台确保已开通 `doubao-1-5-pro-256k`（或当前代码中 hardcode 的模型版本，见 `src-tauri/src/commands/doubao_http.rs:4`）
3. 点击「创建 API Key」，复制生成的 key
   - 格式可能是 UUID（例如 `37fa8e71-f1d3-45a2-...`）也可能是 `sk-` 前缀，两者均可

填入 SuperNono 的 **Settings → Doubao API Key (Ark)** 字段。点击 **测试** 按钮验证 — 通过即说明可以正常调用 LLM 补全。

---

## 验证方法

### 在应用内
打开 SuperNono → 设置 → 豆包语音凭证 → 粘贴三个值 → 点击每个 **测试** 按钮。三个状态都变成 **✓ 已通过** 后再点保存。

### 命令行（开发时）
```sh
# 在 config/secrets 中填入 APP_ID / ACCESS_TOKEN / VOLCANO_ENGINE_API_KEY
cd src-tauri && cargo run --example smoke_credentials
```
会依次打出三个端点的握手 / 请求结果，并在失败时附上服务器返回的错误码和 logid 便于排查。

---

## 常见错误与解决

| 错误 | 可能原因 | 解决方法 |
|---|---|---|
| Doubao 返回 `HTTP 401: The API key doesn't exist` | 用了非 Ark 的 API Key；或 Ark 下未开通 Doubao LLM | 到 <https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey> 重新创建 Ark 专用 key |
| Volcano 返回 `HTTP 401` / `auth` | Access Token 过期；或 AppID 与 Access Token 不匹配 | 在语音控制台重新生成 token |
| 两个 Volcano 产品任一未开通 | 服务未在对应服务页开通 | 分别进入 service/10017 与 service/10038 开通 |
| `timeout` / `network` | 网络出站被防火墙或代理拦截 | 允许访问 `openspeech.bytedance.com:443` 与 `ark.cn-beijing.volces.com:443` |
| 应用启动后测试按钮无反应，终端出现 `rustls CryptoProvider panic` | 使用了仍指向 `rustls-tls-webpki-roots` 的旧构建 | `pnpm tauri dev` 重新编译（M2 `995df7b` 之后的构建已切换到 `native-tls`） |

---

## 数据流向与隐私

- 会议音频 → `wss://openspeech.bytedance.com`（Volcano 语音服务） — 用于实时 ASR 与唤醒问答
- 摘要与纪要提示 → `https://ark.cn-beijing.volces.com`（Ark） — 用于 LLM 文本补全
- 所有凭证通过 **系统钥匙串**（macOS Keychain / Windows Credential Manager）本地存储
- 会议本体（转写、摘要、纪要 JSON）本地持久化在 `~/Library/Application Support/com.supernono.app/`（macOS）
- 凭证与会议内容**不经过** SuperNono 作者的任何服务器

---

## 开发者备注

- Volcano WSS 握手头的关键字段见 `src-tauri/src/commands/volcano_ws.rs`（ASR）和 `src-tauri/src/commands/e2e_ws.rs`（E2E）
- Ark 请求体与模型名见 `src-tauri/src/commands/doubao_http.rs`
- 如需切换到 Ark 的其他模型（例如 `doubao-seed-1.6`），修改 `DEFAULT_MODEL` 常量即可；未来可把它做成 Settings 里的下拉选项（见 README 的 "Polish / bugs" 段落）
