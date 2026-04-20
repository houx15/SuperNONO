mod commands;

use commands::e2e_ws::{new_e2e_sessions, E2eSessions};
use commands::mic::{new_mic, MicHandle};
use commands::volcano_ws::{new_sessions as new_asr_sessions, AsrSessions};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage::<AsrSessions>(new_asr_sessions())
        .manage::<E2eSessions>(new_e2e_sessions())
        .manage::<MicHandle>(new_mic())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            commands::meeting_fs::meeting_delete,
            commands::window_controls::window_close,
            commands::window_controls::window_minimize,
            commands::window_controls::window_toggle_maximize,
            commands::prevent_sleep::prevent_sleep_enable,
            commands::prevent_sleep::prevent_sleep_disable,
            commands::settings_link::open_mic_settings,
            commands::volcano_ws::asr_start,
            commands::volcano_ws::asr_send_audio,
            commands::volcano_ws::asr_stop,
            commands::volcano_ws::asr_test_credentials,
            commands::e2e_ws::e2e_open,
            commands::e2e_ws::e2e_send_audio,
            commands::e2e_ws::e2e_close,
            commands::e2e_ws::e2e_test_credentials,
            commands::llm_http::llm_complete,
            commands::llm_http::llm_test_credentials,
            commands::mic::mic_start,
            commands::mic::mic_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
