//! Does a shell outlive its tab when persistence is on?
use std::sync::Arc;
use std::time::Duration;

use int_terminal_lib::pty::{close, spawn_for_test, write, Sessions};

fn main() {
    let sessions = Arc::new(Sessions::default());
    let id = "persist-probe";

    println!("  starting a tab");
    spawn_for_test(sessions.clone(), id.into());
    std::thread::sleep(Duration::from_millis(3000));

    // Something long-running, so there is a process to survive.
    write(&sessions, id, "sleep 400 &\n").ok();
    std::thread::sleep(Duration::from_millis(1200));
    write(&sessions, id, "echo MARKER-WAS-HERE > /tmp/int-persist-probe\n").ok();
    std::thread::sleep(Duration::from_millis(1200));

    println!("  closing the tab");
    close(&sessions, id);
    std::thread::sleep(Duration::from_millis(1500));

    let alive = std::process::Command::new("/opt/homebrew/bin/tmux")
        .args(["has-session", "-t", &format!("int-{id}")])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    println!("  tmux session still alive after the tab closed: {alive}");

    println!("  reopening the same tab");
    spawn_for_test(sessions.clone(), id.into());
    std::thread::sleep(Duration::from_millis(2500));
    write(&sessions, id, "jobs\n").ok();
    std::thread::sleep(Duration::from_millis(1200));

    let marker = std::fs::read_to_string("/tmp/int-persist-probe").unwrap_or_default();
    println!("  work done before the close survived: {}", marker.contains("MARKER"));

    // Tidy up, or the probe session outlives the probe. Which is the point,
    // but not something to leave lying around.
    let _ = std::process::Command::new("/opt/homebrew/bin/tmux")
        .args(["kill-session", "-t", &format!("int-{id}")])
        .status();
    let _ = std::fs::remove_file("/tmp/int-persist-probe");
}
