import { invoke } from '@tauri-apps/api/core';

export interface KeychainAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export const keychain: KeychainAdapter = {
  async get(key) {
    const v = await invoke<string | null>('keychain_get', { key });
    return v ?? null;
  },
  async set(key, value) {
    await invoke('keychain_set', { key, value });
  },
  async delete(key) {
    await invoke('keychain_delete', { key });
  },
};
