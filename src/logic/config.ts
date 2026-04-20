export const SUMMARY_INTERVAL_MS = 5 * 60 * 1000;
/** First summary fires earlier so the user sees something within a minute,
 *  not 5 minutes of staring at a blank screen. Subsequent summaries use
 *  SUMMARY_INTERVAL_MS. */
export const FIRST_SUMMARY_MS = 60 * 1000;
export const SILENCE_TIMEOUT_MS = 2000;
export const MAX_RAW_WINDOW_MIN_SUMMARY = 5;
export const MAX_RAW_WINDOW_MIN_QA = 2;
export const MAX_CONTEXT_CHARS = 8000;
export const DEFAULT_WAKE_WORD = '嘿 Nono';
export const DEFAULT_LANG: 'zh' | 'en' = 'zh';

export const KEYCHAIN_KEYS = {
  volcanoAppId: 'volcano_app_id',
  volcanoAccessKey: 'volcano_access_key',
  // Generalized LLM config — any OpenAI-compatible or Anthropic-compatible provider.
  llmProvider: 'llm_provider',
  llmSdkShape: 'llm_sdk_shape',
  llmBaseUrl: 'llm_base_url',
  llmModel: 'llm_model',
  llmApiKey: 'llm_api_key',
} as const;

export type LlmSdkShape = 'openai' | 'anthropic';

export interface LlmProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  sdkShape: LlmSdkShape;
  modelHint: string;
  keyHint: string;
  keyUrl?: string;
}

export const LLM_PROVIDERS: LlmProviderPreset[] = [
  {
    id: 'doubao',
    label: '豆包 (火山 Ark)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    sdkShape: 'openai',
    modelHint: 'e.g. doubao-seed-2-0-code-preview-260215',
    keyHint: 'ark-...',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    sdkShape: 'openai',
    modelHint: 'e.g. gpt-4o-mini',
    keyHint: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    sdkShape: 'anthropic',
    modelHint: 'e.g. claude-sonnet-4-5',
    keyHint: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    sdkShape: 'openai',
    modelHint: 'e.g. moonshot-v1-32k',
    keyHint: 'sk-...',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'aliyun',
    label: '阿里百炼 (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    sdkShape: 'openai',
    modelHint: 'e.g. qwen-plus',
    keyHint: 'sk-...',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    sdkShape: 'openai',
    modelHint: 'e.g. glm-4-plus',
    keyHint: '用户密钥',
    keyUrl: 'https://bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    sdkShape: 'openai',
    modelHint: 'e.g. deepseek-chat',
    keyHint: 'sk-...',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'custom',
    label: '自定义 (Custom)',
    baseUrl: '',
    sdkShape: 'openai',
    modelHint: '自定义 endpoint 的 model id',
    keyHint: 'API Key',
  },
];

export const DEFAULT_LLM_PROVIDER = 'doubao';

export const E2E_DEFAULT_VOICE = 'zh_female_vv_jupiter_bigtts';

export const QA_SYSTEM_PROMPT_PREAMBLE =
  'You are SuperNono, an AI participant in a live meeting. ' +
  'Answer concisely, in the same language as the question, ' +
  'based only on the discussion context below.';
