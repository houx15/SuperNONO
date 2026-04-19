use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum FsError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("path: {0}")]
    Path(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

impl Serialize for FsError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub fn meetings_dir(app: &AppHandle) -> Result<PathBuf, FsError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| FsError::Path(e.to_string()))?;
    let dir = base.join("SuperNono").join("meetings");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn meeting_dir(app: &AppHandle, id: &str) -> Result<PathBuf, FsError> {
    let dir = meetings_dir(app)?.join(id);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), FsError> {
    let parent = path
        .parent()
        .ok_or_else(|| FsError::Path("no parent".into()))?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| FsError::Io(e.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn atomic_write_creates_file() {
        let d = tempdir().unwrap();
        let path = d.path().join("x.json");
        atomic_write(&path, b"hello").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"hello");
    }

    #[test]
    fn atomic_write_overwrites_atomically() {
        let d = tempdir().unwrap();
        let path = d.path().join("x.json");
        atomic_write(&path, b"a").unwrap();
        atomic_write(&path, b"bb").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"bb");
    }
}
