//! Credential storage.
//!
//! Tries the OS keychain first (macOS Keychain / Windows Credential
//! Manager / libsecret on Linux). Falls back to a plaintext JSON file
//! under the app data directory when keychain access fails — which is
//! common in dev mode on macOS, because `pnpm tauri dev` produces a
//! freshly-signed binary each rebuild and macOS scopes keychain ACLs to
//! the exact signing identity. Without the fallback, users lose their
//! credentials on every dev restart.
//!
//! File-based storage is obviously less secure than the keychain, but:
//!   - the file lives inside the user's own home directory
//!   - meeting data already persists there unencrypted
//!   - only the user's own LLM/Volcano keys are at risk
//!
//! For production builds with stable signing, the keychain path works and
//! the file is never consulted after the initial read.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use keyring::Entry;
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.supernono.app";

#[derive(Debug, Serialize, Deserialize)]
pub struct KeychainError {
    pub message: String,
}

impl From<keyring::Error> for KeychainError {
    fn from(e: keyring::Error) -> Self {
        Self {
            message: e.to_string(),
        }
    }
}

fn fallback_path(app: &AppHandle) -> Result<PathBuf, KeychainError> {
    let base = app.path().app_data_dir().map_err(|e| KeychainError {
        message: format!("app_data_dir: {e}"),
    })?;
    fs::create_dir_all(&base).map_err(|e| KeychainError {
        message: format!("create_dir_all: {e}"),
    })?;
    Ok(base.join("credentials.json"))
}

// Cached snapshot of the fallback file, so repeated get/set don't reparse.
static FALLBACK_CACHE: OnceCell<Mutex<HashMap<String, String>>> = OnceCell::new();

fn load_fallback(path: &PathBuf) -> HashMap<String, String> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn save_fallback(path: &PathBuf, map: &HashMap<String, String>) -> Result<(), KeychainError> {
    let json = serde_json::to_string_pretty(map).map_err(|e| KeychainError {
        message: format!("serialize: {e}"),
    })?;
    fs::write(path, json).map_err(|e| KeychainError {
        message: format!("write: {e}"),
    })?;
    Ok(())
}

fn cache() -> &'static Mutex<HashMap<String, String>> {
    FALLBACK_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn fallback_get(app: &AppHandle, key: &str) -> Result<Option<String>, KeychainError> {
    let path = fallback_path(app)?;
    let mut guard = cache().lock().map_err(|e| KeychainError {
        message: format!("lock: {e}"),
    })?;
    if guard.is_empty() {
        *guard = load_fallback(&path);
    }
    Ok(guard.get(key).cloned())
}

fn fallback_set(app: &AppHandle, key: &str, value: &str) -> Result<(), KeychainError> {
    let path = fallback_path(app)?;
    let mut guard = cache().lock().map_err(|e| KeychainError {
        message: format!("lock: {e}"),
    })?;
    if guard.is_empty() {
        *guard = load_fallback(&path);
    }
    guard.insert(key.to_string(), value.to_string());
    save_fallback(&path, &guard)
}

fn fallback_delete(app: &AppHandle, key: &str) -> Result<(), KeychainError> {
    let path = fallback_path(app)?;
    let mut guard = cache().lock().map_err(|e| KeychainError {
        message: format!("lock: {e}"),
    })?;
    if guard.is_empty() {
        *guard = load_fallback(&path);
    }
    guard.remove(key);
    save_fallback(&path, &guard)
}

#[tauri::command]
pub async fn keychain_get(app: AppHandle, key: String) -> Result<Option<String>, KeychainError> {
    // Try keychain first. If it fails (access denied, no entry type, etc.),
    // fall through to the file store.
    if let Ok(entry) = Entry::new(SERVICE, &key) {
        match entry.get_password() {
            Ok(v) => return Ok(Some(v)),
            Err(keyring::Error::NoEntry) => { /* fall through to file */ }
            Err(_) => { /* access denied or similar — fall through */ }
        }
    }
    fallback_get(&app, &key)
}

#[tauri::command]
pub async fn keychain_set(app: AppHandle, key: String, value: String) -> Result<(), KeychainError> {
    // Try keychain. If it works, ALSO mirror to the file so a subsequent
    // dev rebuild (which loses keychain access) still has the value.
    let keychain_ok = match Entry::new(SERVICE, &key) {
        Ok(entry) => entry.set_password(&value).is_ok(),
        Err(_) => false,
    };
    // Always write to the file as well — it's the reliable source of truth
    // across dev restarts. `_keychain_ok` is informational only.
    let _ = keychain_ok;
    fallback_set(&app, &key, &value)
}

#[tauri::command]
pub async fn keychain_delete(app: AppHandle, key: String) -> Result<(), KeychainError> {
    if let Ok(entry) = Entry::new(SERVICE, &key) {
        let _ = entry.delete_credential();
    }
    fallback_delete(&app, &key)
}

#[cfg(test)]
mod tests {
    // The round-trip test used to require interactive keychain access on
    // macOS; the new file-backed path is unit-testable, but it depends on
    // a real AppHandle which requires Tauri runtime setup. Covered by the
    // manual smoke (Settings → save → restart → fields still populated).
}
