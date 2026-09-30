//! Intentio Terminal.

pub mod pty;
mod settings;
pub mod ssh;
mod tabs;

use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

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

/// Write what the frontend knows about itself, for diagnosing a rendering
/// problem that cannot be screenshotted from here.
///
/// A file rather than a console line: the console of a packaged app is not
/// somewhere anybody can look, and "it says something in devtools" is not a
/// report somebody should have to relay.
#[tauri::command]
fn record_diagnostics(report: serde_json::Value) {
    let Some(home) = std::env::var_os("HOME") else { return };
    let path = std::path::PathBuf::from(home).join(".intentio").join("terminal-diagnostics.json");
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, serde_json::to_string_pretty(&report).unwrap_or_default());
}

#[tauri::command]
fn terminal_settings() -> settings::Settings {
    settings::read()
}

#[tauri::command]
fn set_terminal_settings(next: settings::Settings) -> Result<(), String> {
    settings::write(&next).map_err(|err| err.to_string())
}

/// Shells on this machine, plus the one currently in use.
#[tauri::command]
fn shells() -> Vec<String> {
    let mut found = settings::available_shells();
    let current = pty::default_shell();
    if !found.contains(&current) {
        found.insert(0, current);
    }
    found
}

/// Hosts from the ssh config and known_hosts, for the picker.
#[tauri::command]
fn ssh_hosts() -> Vec<ssh::Host> {
    ssh::hosts()
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
        // Size, position and whether it was maximised, restored next time.
        //
        // The plugin rather than a few lines of our own, because the part that
        // is easy to get wrong is not saving the numbers: it is a window that
        // was on a second monitor which is no longer there, and would come back
        // somewhere nobody can reach it.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            record_diagnostics,
            terminal_settings,
            set_terminal_settings,
            shells,
            ssh_hosts,
            saved_session,
            save_session,
        ])
        .setup(|app| {
            // Save the geometry as it changes, not only on a clean exit.
            //
            // The plugin writes on shutdown, which covers quitting properly and
            // nothing else: a crash, a force quit, or a machine going down
            // takes the layout with it. Writing on move and resize costs a few
            // hundred bytes now and again and means the window comes back where
            // it was however the app ended.
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if matches!(
                        event,
                        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                    ) {
                        let _ = handle.save_window_state(StateFlags::all());
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
