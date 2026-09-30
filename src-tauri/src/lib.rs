//! Intentio Terminal.

pub mod pty;
mod tabs;

use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

pub struct AppState {
    sessions: Arc<pty::Sessions>,
}

#[tauri::command]
fn spawn_shell(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<pty::Spawned, String> {
    pty::spawn(app, state.sessions.clone(), id, cwd, rows, cols)
}

#[tauri::command]
fn write_shell(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    pty::write(&state.sessions, &id, &data)
}

#[tauri::command]
fn resize_shell(state: State<'_, AppState>, id: String, rows: u16, cols: u16) -> Result<(), String> {
    pty::resize(&state.sessions, &id, rows, cols)
}

#[tauri::command]
fn close_shell(state: State<'_, AppState>, id: String) {
    pty::close(&state.sessions, &id);
}

/// Where a tab is working now, for its caption and for restoring it.
#[tauri::command]
fn shell_cwd(state: State<'_, AppState>, id: String) -> Option<String> {
    pty::working_directory(&state.sessions, &id)
}

/// A short caption for a directory.
#[tauri::command]
fn directory_label(cwd: String) -> String {
    tabs::label_for(&cwd)
}

#[tauri::command]
fn saved_session() -> tabs::Session {
    tabs::read()
}

#[tauri::command]
fn save_session(session: tabs::Session) -> Result<(), String> {
    tabs::write(&session).map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { sessions: Arc::new(pty::Sessions::default()) })
        .invoke_handler(tauri::generate_handler![
            spawn_shell,
            write_shell,
            resize_shell,
            close_shell,
            shell_cwd,
            directory_label,
            saved_session,
            save_session,
        ])
        .setup(|app| {
            let _ = app.handle();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
