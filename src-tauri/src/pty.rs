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
    /// The bytes exactly as the program wrote them, base64 for the trip
    /// through a JSON event.
    ///
    /// Bytes, not text. Decoding each chunk here as UTF-8 looks harmless and
    /// is not: a read ends wherever the kernel decides, so a three-byte
    /// character or an escape sequence is routinely cut in half, and decoding
    /// the halves separately turns both into replacement characters. A broken
    /// escape sequence is the expensive half - the terminal keeps reading the
    /// rest of the line as part of a command that never ended, and the output
    /// after it lands in the wrong place.
    ///
    /// xterm decodes the stream with state carried across writes, which is
    /// exactly what a stream needs and what this cannot do one chunk at a
    /// time.
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
    /// When this tab last produced any output, in milliseconds.
    last_output: Arc<Mutex<u64>>,
}

/// What a tab appears to be doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Activity {
    /// Sitting at a shell prompt with nothing running.
    Idle,
    /// Something is running and still producing output.
    Working,
    /// Something is running and has gone quiet. Usually it wants an answer.
    Waiting,
}

/// What each tab is doing, for the strip.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabActivity {
    pub id: String,
    pub activity: Activity,
    /// Seconds since this tab last said anything.
    pub quiet_for: u64,
}

/// How long a running program may be silent before it is taken to be waiting.
///
/// Long enough that a compile reading from disk, or a request waiting on a
/// slow server, is not mistaken for a question. Short enough to be useful
/// while you are deciding which window to look at.
const QUIET_BEFORE_WAITING: u64 = 10;

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

/// A shell the person has chosen explicitly.
fn configured_shell() -> Option<String> {
    let shell = crate::settings::read().shell.trim().to_string();
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

/// Variables that name the session which launched us, rather than describing
/// the machine.
///
/// A terminal opened from a shell, an editor or an agent inherits that
/// parent's whole environment, session identity included. Passing it on makes
/// every new tab claim to be part of a session it has nothing to do with:
/// launching this app from inside a Claude Code session and then running
/// Claude Code in a tab had it announce itself as a child session and stop
/// saving transcripts.
///
/// A new tab is a new session. Only markers are removed, by prefix, so
/// anything that genuinely describes the environment is left alone.
pub fn inherited_session_markers_for_test() -> Vec<String> {
    inherited_session_markers()
}

fn inherited_session_markers() -> Vec<String> {
    const PREFIXES: [&str; 3] = ["CLAUDE_CODE_", "VSCODE_", "TERM_SESSION_"];
    std::env::vars()
        .map(|(name, _)| name)
        .filter(|name| PREFIXES.iter().any(|prefix| name.starts_with(prefix)))
        .collect()
}

fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

/// What a tab actually runs, and the shell behind it.
///
/// One function rather than one per caller, because a test that builds its own
/// command is a test of something other than the app. This exact mistake cost
/// a probe that reported persistence was broken when it had simply never been
/// switched on for the shell the probe started.
pub fn build_command(id: &str, cwd: Option<String>) -> (CommandBuilder, String) {
    let shell = default_shell();
    let persist = crate::settings::read().persist_sessions;
    let tmux = persist.then(crate::settings::tmux_path).flatten();
    let start_in = cwd
        .filter(|path| std::path::Path::new(path).is_dir())
        .unwrap_or_else(home);

    let mut command = match &tmux {
        // Named after the tab, so reopening the app finds the same session.
        // -A attaches if it exists and creates it if it does not, which is the
        // "resume or start" we want without having to ask which case this is.
        Some(tmux) => {
            let mut command = CommandBuilder::new(tmux);
            command.arg("-u"); // the shell talks UTF-8; so should tmux
            command.arg("new-session");
            command.arg("-A");
            command.arg("-s");
            command.arg(format!("int-{id}"));
            command.arg("-c");
            command.arg(&start_in);
            command
        }
        None => {
            let mut command = CommandBuilder::new(&shell);
            // A login shell, so profiles run and the environment matches what
            // somebody gets opening a terminal anywhere else. zsh, bash and
            // fish all take -l.
            command.arg("-l");
            command
        }
    };
    command.cwd(&start_in);

    for name in inherited_session_markers() {
        command.env_remove(&name);
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "Intentio Terminal");

    (command, start_in)
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

    let (command, start_in) = build_command(&id, cwd.clone());
    let shell = default_shell();




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

    let last_output = Arc::new(Mutex::new(crate::now_millis()));
    sessions.open.lock().expect("sessions").insert(
        id.clone(),
        Session { writer, master: pair.master, child, last_output: last_output.clone() },
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
                    if let Ok(mut at) = last_output.lock() {
                        *at = crate::now_millis();
                    }
                    use base64::Engine;
                    let data = base64::engine::general_purpose::STANDARD
                        .encode(&buffer[..read]);
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

/// A shell with no app around it, for checking the activity rules.
pub fn spawn_for_test(sessions: Arc<Sessions>, id: String) {
    let system = NativePtySystem::default();
    let pair = system
        .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
        .expect("pty");
    let (command, _) = build_command(&id, None);
    let child = pair.slave.spawn_command(command).expect("shell");
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().expect("reader");
    let writer = pair.master.take_writer().expect("writer");
    let last_output = Arc::new(Mutex::new(crate::now_millis()));
    let seen = last_output.clone();
    sessions.open.lock().expect("sessions").insert(
        id,
        Session { writer, master: pair.master, child, last_output },
    );
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        while let Ok(read) = reader.read(&mut buffer) {
            if read == 0 {
                break;
            }
            if let Ok(mut at) = seen.lock() {
                *at = crate::now_millis();
            }
        }
    });
}

/// What every tab is doing.
///
/// Read from the kernel rather than scraped from the screen. A terminal always
/// knows which process group owns its input: if that is the shell itself,
/// nothing is running and the tab is at a prompt. If it is anything else, a
/// program has the terminal, and whether it is working or waiting is the
/// difference between still talking and having gone quiet.
///
/// Doing it this way means it works for anything - a compile, a migration, an
/// agent - rather than only for programs whose output we have learnt to
/// recognise. Reading the screen would have to be taught every prompt in the
/// world and would still be wrong about the next one.
pub fn activity(sessions: &Sessions) -> Vec<TabActivity> {
    let now = crate::now_millis();
    let open = sessions.open.lock().expect("sessions");

    open.iter()
        .map(|(id, session)| {
            let quiet_ms = session
                .last_output
                .lock()
                .map(|at| now.saturating_sub(*at))
                .unwrap_or(0);
            let quiet_for = quiet_ms / 1000;

            let activity = match foreground_is_the_shell(session) {
                // The shell owns the terminal: nothing is running.
                Some(true) => Activity::Idle,
                Some(false) if quiet_for >= QUIET_BEFORE_WAITING => Activity::Waiting,
                Some(false) => Activity::Working,
                // Nothing to go on. Idle is the quiet answer, and a tab wrongly
                // marked as wanting attention is worse than one left unmarked.
                None => Activity::Idle,
            };

            TabActivity { id: id.clone(), activity, quiet_for }
        })
        .collect()
}

/// Whether the shell itself owns the terminal's input.
#[cfg(unix)]
fn foreground_is_the_shell(session: &Session) -> Option<bool> {
    let shell = session.child.process_id()? as i32;
    let foreground = session.master.process_group_leader()?;
    Some(foreground == shell)
}

#[cfg(not(unix))]
fn foreground_is_the_shell(_session: &Session) -> Option<bool> {
    None
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
