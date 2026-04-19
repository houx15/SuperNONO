mod commands;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::keychain::keychain_get,
            commands::keychain::keychain_set,
            commands::keychain::keychain_delete,
            commands::meeting_fs::meeting_create,
            commands::meeting_fs::meeting_write_meta,
            commands::meeting_fs::meeting_write_summaries,
            commands::meeting_fs::meeting_write_minutes,
            commands::meeting_fs::meeting_write_ai_exchanges,
            commands::meeting_fs::meeting_append_utterance,
            commands::meeting_fs::meeting_list,
            commands::meeting_fs::meeting_read,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
