export const SUMMARY_INTERVAL_MS = 5 * 60 * 1000;
export const SILENCE_TIMEOUT_MS = 2000;
export const MAX_RAW_WINDOW_MIN_SUMMARY = 5;
export const MAX_RAW_WINDOW_MIN_QA = 2;
export const MAX_CONTEXT_CHARS = 8000;
export const DEFAULT_WAKE_WORD = '嘿 Nono';
export const DEFAULT_LANG: 'zh' | 'en' = 'zh';

export const KEYCHAIN_KEYS = {
  volcanoAppId: 'volcano_app_id',
  volcanoAccessKey: 'volcano_access_key',
  doubaoApiKey: 'doubao_api_key',
} as const;

export const E2E_DEFAULT_VOICE = 'zh_female_vv_jupiter_bigtts';

export const QA_SYSTEM_PROMPT_PREAMBLE =
  'You are SuperNono, an AI participant in a live meeting. ' +
  'Answer concisely, in the same language as the question, ' +
  'based only on the discussion context below.';
