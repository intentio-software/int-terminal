//! Real shells, on real pseudo-terminals.
//!
//! A terminal emulator has two halves. This is the half that owns the child
//! process: it allocates a PTY, starts a shell on it, pumps bytes both ways and
//! tells the kernel when the window changes size. The other half - parsing what
//! comes back into cells, cursors and colours - is xterm.js in the webview,
//! because writing a VT parser is a year of somebody's life and there is a
//! good one already.
//!
//! Every session gets a reader thread. Output arrives whenever the program
//! feels like producing it, so there is nothing to poll and nothing to wait
//! for: the thread blocks on a read and emits what it gets.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

/// Emitted with each chunk a shell produces.
pub const OUTPUT_EVENT: &str = "pty-output";
/// Emitted when a shell exits, so the tab can close itself.
pub const EXIT_EVENT: &str = "pty-exit";

/// A chunk of output, tagged with the tab it belongs to.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub id: String,
    /// Bytes as text. Invalid UTF-8 is replaced rather than dropped: a corrupt
    /// glyph is a better outcome than a missing line.
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Spawned {
    pub id: String,
    pub shell: String,
    pub cwd: String,
}

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    /// Kept so a tab can be closed without waiting for the shell to notice.
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct Sessions {
    open: Mutex<HashMap<String, Session>>,
}

/// The shell to start.
///
/// The account's login shell, asked of the system, rather than `$SHELL`.
/// `$SHELL` is inherited from whatever launched the app and is routinely
/// wrong: on this machine it reads /bin/zsh while the login shell is fish.
/// Starting the wrong shell means none of somebody's aliases, functions or
/// prompt, which is not a small thing.
///
/// An explicit choice in settings wins over both.
pub fn default_shell() -> String {
    if let Some(chosen) = configured_shell() {
        return chosen;
    }
    login_shell()
        .or_else(|| std::env::var("SHELL").ok())
        .unwrap_or_else(|| "/bin/zsh".into())
}

/// A shell the person has chosen, from `~/.intentio/terminal.json`.
fn configured_shell() -> Option<String> {
    let home = std::env::var_os("HOME")?;
    let path = std::path::PathBuf::from(home).join(".intentio").join("terminal.json");
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let shell = value.get("shell")?.as_str()?.trim().to_string();
    (!shell.is_empty() && std::path::Path::new(&shell).exists()).then_some(shell)
}

#[cfg(target_os = "macos")]
fn login_shell() -> Option<String> {
    // Directory Services is where a Mac actually keeps this; /etc/passwd is a
    // stub on macOS and does not have it.
    let user = std::env::var("USER").ok()?;
    let out = std::process::Command::new("dscl")
        .args([".", "-read", &format!("/Users/{user}"), "UserShell"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let shell = text.split_whitespace().nth(1)?.to_string();
    std::path::Path::new(&shell).exists().then_some(shell)
}

#[cfg(not(target_os = "macos"))]
fn login_shell() -> Option<String> {
    let user = std::env::var("USER").ok()?;
    let passwd = std::fs::read_to_string("/etc/passwd").ok()?;
    passwd
        .lines()
        .find(|line| line.starts_with(&format!("{user}:")))
        .and_then(|line| line.rsplit(':').next())
        .map(str::to_string)
        .filter(|shell| std::path::Path::new(shell).exists())
}

fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

/// Start a shell and begin pumping its output.
pub fn spawn<R: Runtime>(
    app: AppHandle<R>,
    sessions: Arc<Sessions>,
    id: String,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<Spawned, String> {
    let system = NativePtySystem::default();
    let pair = system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|err| format!("could not open a pty: {err}"))?;

    let shell = default_shell();
    let mut command = CommandBuilder::new(&shell);
    // A login shell, so profiles run and the environment matches what somebody
    // gets opening a terminal anywhere else. zsh, bash and fish all take -l.
    command.arg("-l");

    let start_in = cwd
        .filter(|path| std::path::Path::new(path).is_dir())
        .unwrap_or_else(home);
    command.cwd(&start_in);

    // Programs decide what they can draw from this. Without it, anything
    // curses-based refuses to start.
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "Intentio Terminal");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|err| format!("could not start {shell}: {err}"))?;
    // The slave is the child's end. Holding it open here would keep the pty
    // alive after the shell exits, and the reader would never see EOF.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("could not read from the pty: {err}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| format!("could not write to the pty: {err}"))?;

    sessions.open.lock().expect("sessions").insert(
        id.clone(),
        Session { writer, master: pair.master, child },
    );

    let reader_id = id.clone();
    let reader_app = app.clone();
    let reader_sessions = sessions.clone();
    std::thread::spawn(move || {
        // 8 KiB: big enough that `cat` of a large file is not thousands of
        // events, small enough that a prompt appears the moment it is printed.
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let data = String::from_utf8_lossy(&buffer[..read]).to_string();
                    let _ = reader_app.emit(
                        OUTPUT_EVENT,
                        Output { id: reader_id.clone(), data },
                    );
                }
                Err(_) => break,
            }
        }
        reader_sessions.open.lock().expect("sessions").remove(&reader_id);
        let _ = reader_app.emit(EXIT_EVENT, &reader_id);
    });

    Ok(Spawned { id, shell, cwd: start_in })
}

/// Send typed input to a shell.
pub fn write(sessions: &Sessions, id: &str, data: &str) -> Result<(), String> {
    let mut open = sessions.open.lock().expect("sessions");
    let Some(session) = open.get_mut(id) else {
        // A closed tab is not an error worth shouting about; the keystroke has
        // simply nowhere to go.
        return Ok(());
    };
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|err| err.to_string())
}

/// Tell the shell the window changed shape.
///
/// Without this, programs keep drawing to the old width and wrap in the wrong
/// places - the single most obvious sign of a terminal that is not finished.
pub fn resize(sessions: &Sessions, id: &str, rows: u16, cols: u16) -> Result<(), String> {
    let open = sessions.open.lock().expect("sessions");
    let Some(session) = open.get(id) else { return Ok(()) };
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|err| err.to_string())
}

/// Close a tab, ending the shell on it.
pub fn close(sessions: &Sessions, id: &str) {
    let mut open = sessions.open.lock().expect("sessions");
    if let Some(mut session) = open.remove(id) {
        let _ = session.child.kill();
    }
}

/// Where a shell is currently working, for restoring tabs next time.
///
/// Read from the OS rather than tracked, because the shell changes directory
/// without telling anybody. On macOS this is one syscall; elsewhere it falls
/// back to the directory the tab started in.
pub fn working_directory(sessions: &Sessions, id: &str) -> Option<String> {
    let open = sessions.open.lock().expect("sessions");
    let session = open.get(id)?;
    let pid = session.child.process_id()?;
    cwd_of(pid)
}

#[cfg(target_os = "macos")]
fn cwd_of(pid: u32) -> Option<String> {
    // lsof is not elegant, but the alternative is libproc bindings for one
    // field, and this runs when a tab closes rather than in any hot path.
    let out = std::process::Command::new("lsof")
        .args(["-a", "-d", "cwd", "-p", &pid.to_string(), "-Fn"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n').map(str::to_string))
}

#[cfg(target_os = "linux")]
fn cwd_of(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn cwd_of(_pid: u32) -> Option<String> {
    None
}
