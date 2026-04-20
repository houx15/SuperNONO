# 凭证获取指南

SuperNono 的凭证分为**两大类**，配置方式也不同：

1. **① 火山语音凭证** — 固定来自火山引擎语音服务控制台，用于实时 ASR 和唤醒词问答（两个 WebSocket 服务共用）。
2. **② LLM 服务凭证** — **可自由选择服务商**。用于会议摘要与纪要生成。默认为豆包 Ark，也支持 OpenAI / Anthropic / Kimi / 阿里百炼 / 智谱 GLM / DeepSeek 等任何 OpenAI-SDK-兼容或 Anthropic-SDK-兼容 的服务。

⚠ **常见误会：若使用豆包，Ark API Key ≠ 火山引擎语音服务的 API Key。** 两者来自不同的控制台、绑定不同的服务。把其他类型的 key 填到 LLM 字段，会收到 `HTTP 401: The API key doesn't exist`。

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

## 步骤 2 — 选择 LLM 服务商并配置

Settings 的 "② LLM 服务凭证" 一栏提供了一个下拉菜单。选择你想用的服务商后，base URL 会自动填好，你只需要填 **Model** 和 **API Key**。

### 预设服务商及其凭证入口

| 服务商 | SDK 兼容 | 凭证页面 |
|---|---|---|
| 豆包 (火山 Ark) | OpenAI | <https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey> |
| OpenAI | OpenAI | <https://platform.openai.com/api-keys> |
| Anthropic Claude | Anthropic | <https://console.anthropic.com/settings/keys> |
| Kimi (Moonshot) | OpenAI | <https://platform.moonshot.cn/console/api-keys> |
| 阿里百炼 (DashScope) | OpenAI | <https://bailian.console.aliyun.com/?apiKey=1> |
| 智谱 GLM | OpenAI | <https://bigmodel.cn/usercenter/apikeys> |
| DeepSeek | OpenAI | <https://platform.deepseek.com/api_keys> |
| 自定义 | 可选 | 手动填 base URL + model + key |

**Model 名必须是服务商实际开通的模型或推理接入点 ID。** 以豆包为例：在 Ark 的 "在线推理" 页面可以看到类似 `doubao-seed-2-0-code-preview-260215` 这样的 model id，或者你创建的 endpoint ID `ep-xxxxxxxx-xxxxx`。其他服务商同理 — 把控制台给你的完整模型字符串粘进来即可。

### 对豆包的补充说明

如果你用豆包：
1. 打开 <https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey>
2. 点击「创建 API Key」，复制（格式可能是 `ark-...` 或 UUID，均可）
3. 在 Ark 的 "模型 / 在线推理" 页面找到你要用的 model id
4. 填入 SuperNono，点击测试

⚠ 这个 Ark API Key **不是**火山引擎语音服务的 API Key，它们分属不同控制台。

---

## 验证方法

### 在应用内
打开 SuperNono → 设置 → 豆包语音凭证 → 粘贴三个值 → 点击每个 **测试** 按钮。三个状态都变成 **✓ 已通过** 后再点保存。

### 命令行（开发时）

`config/secrets` 文件（gitignored）示例：

```
APP_ID=6986180714
ACCESS_TOKEN=your-volcano-access-token
LLM_API_KEY=your-llm-api-key
# Optional, default to Doubao / Ark:
LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
LLM_MODEL=doubao-seed-2-0-code-preview-260215
LLM_SDK_SHAPE=openai    # or anthropic
```

然后：

```sh
cd src-tauri && cargo run --example smoke_credentials
```

会依次打出三个端点的握手 / 请求结果，并在失败时附上服务器返回的错误码和 logid 便于排查。

---

## 常见错误与解决

| 错误 | 可能原因 | 解决方法 |
|---|---|---|
| LLM 返回 `HTTP 401: The API key doesn't exist` | 用错了控制台的 key（例如豆包时用了语音控制台的 key 而非 Ark 的） | 到对应服务商的凭证页面重新创建 |
| LLM 返回 `HTTP 404: The model or endpoint ... does not exist` | Model id 拼写错误；或账号未开通该模型；或该 id 是别的账号的 | 在服务商控制台 "模型 / 推理接入点" 页面确认你的 model id |
| Volcano 返回 `HTTP 401` / `auth` | Access Token 过期；或 AppID 与 Access Token 不匹配 | 在语音控制台重新生成 token |
| 两个 Volcano 产品任一未开通 | 服务未在对应服务页开通 | 分别进入 service/10017 与 service/10038 开通 |
| `timeout` / `network` | 网络出站被防火墙或代理拦截 | 放行到 `openspeech.bytedance.com:443` 和你选择的 LLM 服务商域名 |
| 应用启动后测试按钮无反应，终端出现 `rustls CryptoProvider panic` | 使用了仍指向 `rustls-tls-webpki-roots` 的旧构建 | `pnpm tauri dev` 重新编译（已切换到 `native-tls`） |

---

## 数据流向与隐私

- 会议音频 → `wss://openspeech.bytedance.com`（Volcano 语音服务） — 用于实时 ASR 与唤醒问答
- 摘要与纪要提示 → 你配置的 LLM base URL — 用于 LLM 文本补全
- 所有凭证通过 **系统钥匙串**（macOS Keychain / Windows Credential Manager）本地存储
- 会议本体（转写、摘要、纪要 JSON）本地持久化在 `~/Library/Application Support/com.supernono.app/`（macOS）
- 凭证与会议内容**不经过** SuperNono 作者的任何服务器

---

## 开发者备注

- Volcano WSS 握手头的关键字段见 `src-tauri/src/commands/volcano_ws.rs`（ASR）和 `src-tauri/src/commands/e2e_ws.rs`（E2E）
- LLM 请求分发见 `src-tauri/src/commands/llm_http.rs` — 有 `openai` 和 `anthropic` 两套请求/响应 shape
- 前端 LLM 客户端：`src/adapters/LlmClient.ts`；Settings 服务商预设见 `src/logic/config.ts` 的 `LLM_PROVIDERS` 常量，增加新的预设只需在这里追加一行
