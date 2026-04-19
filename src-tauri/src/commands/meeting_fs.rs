use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
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

#[tauri::command]
pub async fn meeting_create(app: AppHandle, id: String, meta_json: String) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    atomic_write(&dir.join("meeting.json"), meta_json.as_bytes())?;
    atomic_write(
        &dir.join("summaries.json"),
        br#"{"schema_version":1,"summaries":[]}"#,
    )?;
    atomic_write(
        &dir.join("ai-exchanges.json"),
        br#"{"schema_version":1,"exchanges":[]}"#,
    )?;
    // transcript.jsonl is append-only, created on first append
    Ok(())
}

#[tauri::command]
pub async fn meeting_write_meta(
    app: AppHandle,
    id: String,
    meta_json: String,
) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    atomic_write(&dir.join("meeting.json"), meta_json.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub async fn meeting_write_summaries(
    app: AppHandle,
    id: String,
    json: String,
) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    atomic_write(&dir.join("summaries.json"), json.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub async fn meeting_write_minutes(app: AppHandle, id: String, md: String) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    atomic_write(&dir.join("minutes.md"), md.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub async fn meeting_write_ai_exchanges(
    app: AppHandle,
    id: String,
    json: String,
) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    atomic_write(&dir.join("ai-exchanges.json"), json.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub async fn meeting_append_utterance(
    app: AppHandle,
    id: String,
    line_json: String,
) -> Result<(), FsError> {
    let dir = meeting_dir(&app, &id)?;
    let path = dir.join("transcript.jsonl");
    let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
    file.write_all(line_json.as_bytes())?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FullMeetingPayload {
    pub meta: serde_json::Value,
    pub summaries: serde_json::Value,
    pub transcript: Vec<serde_json::Value>,
    pub ai_exchanges: serde_json::Value,
    pub minutes_md: Option<String>,
}

#[tauri::command]
pub async fn meeting_list(app: AppHandle) -> Result<Vec<serde_json::Value>, FsError> {
    let dir = meetings_dir(&app)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let e = entry?;
        if !e.file_type()?.is_dir() {
            continue;
        }
        let meta_path = e.path().join("meeting.json");
        if !meta_path.exists() {
            continue;
        }
        let bytes = fs::read(&meta_path)?;
        let v: serde_json::Value = serde_json::from_slice(&bytes)?;
        out.push(v);
    }
    Ok(out)
}

#[tauri::command]
pub async fn meeting_read(app: AppHandle, id: String) -> Result<FullMeetingPayload, FsError> {
    let dir = meeting_dir(&app, &id)?;
    let meta: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("meeting.json"))?)?;
    let summaries: serde_json::Value = serde_json::from_slice(
        &fs::read(dir.join("summaries.json"))
            .unwrap_or_else(|_| b"{\"schema_version\":1,\"summaries\":[]}".to_vec()),
    )?;
    let ai_exchanges: serde_json::Value = serde_json::from_slice(
        &fs::read(dir.join("ai-exchanges.json"))
            .unwrap_or_else(|_| b"{\"schema_version\":1,\"exchanges\":[]}".to_vec()),
    )?;
    let minutes_md = fs::read_to_string(dir.join("minutes.md")).ok();

    let mut transcript = Vec::new();
    let tr_path = dir.join("transcript.jsonl");
    if tr_path.exists() {
        let text = fs::read_to_string(tr_path)?;
        for line in text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let v: serde_json::Value = serde_json::from_str(line)?;
            transcript.push(v);
        }
    }

    Ok(FullMeetingPayload {
        meta,
        summaries,
        transcript,
        ai_exchanges,
        minutes_md,
    })
}

#[tauri::command]
pub async fn meeting_export_md(
    app: AppHandle,
    id: String,
    dest_path: String,
) -> Result<(), FsError> {
    let src = meeting_dir(&app, &id)?.join("minutes.md");
    fs::copy(&src, PathBuf::from(dest_path))?;
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

    #[test]
    fn append_grows_file_line_by_line() {
        let d = tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        {
            let mut f = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&p)
                .unwrap();
            f.write_all(b"{\"a\":1}").unwrap();
            f.write_all(b"\n").unwrap();
            f.sync_all().unwrap();
            f.write_all(b"{\"a\":2}").unwrap();
            f.write_all(b"\n").unwrap();
            f.sync_all().unwrap();
        }
        let content = fs::read_to_string(&p).unwrap();
        assert_eq!(content.lines().count(), 2);
    }
}
