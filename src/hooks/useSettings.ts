import { useCallback, useEffect, useState } from 'react';
import { keychain } from '../adapters/KeychainAdapter';
import { KEYCHAIN_KEYS, DEFAULT_WAKE_WORD } from '../logic/config';

export interface SettingsState {
  wakeWord: string;
  volcanoAppId: string;
  volcanoAccessKey: string;
  doubaoApiKey: string;
}

export function useSettings() {
  const [state, setState] = useState<SettingsState>({
    wakeWord: DEFAULT_WAKE_WORD,
    volcanoAppId: '',
    volcanoAccessKey: '',
    doubaoApiKey: '',
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [appId, accessKey, doubao] = await Promise.all([
          keychain.get(KEYCHAIN_KEYS.volcanoAppId),
          keychain.get(KEYCHAIN_KEYS.volcanoAccessKey),
          keychain.get(KEYCHAIN_KEYS.doubaoApiKey),
        ]);
        const ww = localStorage.getItem('supernono.wakeWord') ?? DEFAULT_WAKE_WORD;
        setState({
          wakeWord: ww,
          volcanoAppId: appId ?? '',
          volcanoAccessKey: accessKey ?? '',
          doubaoApiKey: doubao ?? '',
        });
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const save = useCallback(async () => {
    await keychain.set(KEYCHAIN_KEYS.volcanoAppId, state.volcanoAppId);
    await keychain.set(KEYCHAIN_KEYS.volcanoAccessKey, state.volcanoAccessKey);
    await keychain.set(KEYCHAIN_KEYS.doubaoApiKey, state.doubaoApiKey);
    localStorage.setItem('supernono.wakeWord', state.wakeWord);
  }, [state]);

  return { state, setState, save, loaded };
}
