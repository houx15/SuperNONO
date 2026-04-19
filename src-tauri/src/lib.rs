mod commands;

use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut(tauri_plugin_global_shortcut::Shortcut::new(
                    Some(Modifiers::SUPER | Modifiers::SHIFT),
                    Code::KeyN,
                ))
                .unwrap()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        use tauri::Emitter;
                        let _ = app.emit("shortcut://start-meeting", ());
                    }
                })
                .build(),
        )
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
            commands::meeting_fs::meeting_export_md,
            commands::window_controls::window_close,
            commands::window_controls::window_minimize,
            commands::window_controls::window_toggle_maximize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
