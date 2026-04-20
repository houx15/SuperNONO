import { useCallback, useEffect, useState } from 'react';
import { keychain } from '../adapters/KeychainAdapter';
import {
  KEYCHAIN_KEYS,
  DEFAULT_WAKE_WORD,
  LLM_PROVIDERS,
  DEFAULT_LLM_PROVIDER,
  type LlmSdkShape,
} from '../logic/config';

export interface SettingsState {
  wakeWord: string;
  volcanoAppId: string;
  volcanoAccessKey: string;
  llmProvider: string;
  llmSdkShape: LlmSdkShape;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
}

function defaultPreset() {
  return LLM_PROVIDERS.find((p) => p.id === DEFAULT_LLM_PROVIDER) ?? LLM_PROVIDERS[0];
}

export function useSettings() {
  const preset = defaultPreset();
  const [state, setState] = useState<SettingsState>({
    wakeWord: DEFAULT_WAKE_WORD,
    volcanoAppId: '',
    volcanoAccessKey: '',
    llmProvider: preset.id,
    llmSdkShape: preset.sdkShape,
    llmBaseUrl: preset.baseUrl,
    llmModel: '',
    llmApiKey: '',
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [appId, accessKey, provider, sdkShape, baseUrl, model, apiKey] = await Promise.all([
          keychain.get(KEYCHAIN_KEYS.volcanoAppId),
          keychain.get(KEYCHAIN_KEYS.volcanoAccessKey),
          keychain.get(KEYCHAIN_KEYS.llmProvider),
          keychain.get(KEYCHAIN_KEYS.llmSdkShape),
          keychain.get(KEYCHAIN_KEYS.llmBaseUrl),
          keychain.get(KEYCHAIN_KEYS.llmModel),
          keychain.get(KEYCHAIN_KEYS.llmApiKey),
        ]);
        const ww = localStorage.getItem('supernono.wakeWord') ?? DEFAULT_WAKE_WORD;
        const resolvedProvider = provider ?? preset.id;
        const matched = LLM_PROVIDERS.find((p) => p.id === resolvedProvider) ?? preset;
        setState({
          wakeWord: ww,
          volcanoAppId: appId ?? '',
          volcanoAccessKey: accessKey ?? '',
          llmProvider: resolvedProvider,
          llmSdkShape: (sdkShape as LlmSdkShape | null) ?? matched.sdkShape,
          llmBaseUrl: baseUrl ?? matched.baseUrl,
          llmModel: model ?? '',
          llmApiKey: apiKey ?? '',
        });
      } finally {
        setLoaded(true);
      }
    })();
  }, [preset]);

  const save = useCallback(async () => {
    await keychain.set(KEYCHAIN_KEYS.volcanoAppId, state.volcanoAppId);
    await keychain.set(KEYCHAIN_KEYS.volcanoAccessKey, state.volcanoAccessKey);
    await keychain.set(KEYCHAIN_KEYS.llmProvider, state.llmProvider);
    await keychain.set(KEYCHAIN_KEYS.llmSdkShape, state.llmSdkShape);
    await keychain.set(KEYCHAIN_KEYS.llmBaseUrl, state.llmBaseUrl);
    await keychain.set(KEYCHAIN_KEYS.llmModel, state.llmModel);
    await keychain.set(KEYCHAIN_KEYS.llmApiKey, state.llmApiKey);
    localStorage.setItem('supernono.wakeWord', state.wakeWord);
  }, [state]);

  return { state, setState, save, loaded };
}
