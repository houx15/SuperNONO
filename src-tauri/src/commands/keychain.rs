use keyring::Entry;
use serde::{Deserialize, Serialize};

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

#[tauri::command]
pub async fn keychain_get(key: String) -> Result<Option<String>, KeychainError> {
    let entry = Entry::new(SERVICE, &key)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn keychain_set(key: String, value: String) -> Result<(), KeychainError> {
    let entry = Entry::new(SERVICE, &key)?;
    entry.set_password(&value)?;
    Ok(())
}

#[tauri::command]
pub async fn keychain_delete(key: String) -> Result<(), KeychainError> {
    let entry = Entry::new(SERVICE, &key)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // Gated: the macOS keychain prompts interactively on CI.
    #[test]
    #[ignore]
    fn round_trip() {
        let key = format!("supernono_test_{}", std::process::id());
        tauri::async_runtime::block_on(async {
            keychain_set(key.clone(), "v".into()).await.unwrap();
            assert_eq!(keychain_get(key.clone()).await.unwrap(), Some("v".into()));
            keychain_delete(key).await.unwrap();
        });
    }
}
