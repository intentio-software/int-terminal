//! Does the kernel actually tell us what a tab is doing?
use std::sync::Arc;
use std::time::Duration;

use int_terminal_lib::pty::{activity, Sessions, spawn_for_test};

fn main() {
    let sessions = Arc::new(Sessions::default());
    spawn_for_test(sessions.clone(), "t1".into());
    std::thread::sleep(Duration::from_millis(2500));

    let show = |label: &str| {
        let a = activity(&sessions);
        let t = a.first();
        println!(
            "  {:<32} {:?} (quiet {}s)",
            label,
            t.map(|x| x.activity),
            t.map(|x| x.quiet_for).unwrap_or(0)
        );
    };

    show("at a prompt");

    // Something running and talking.
    int_terminal_lib::pty::write(&sessions, "t1", "for i in (seq 20); echo $i; sleep 0.2; end\n").ok();
    std::thread::sleep(Duration::from_millis(1200));
    show("while a loop is printing");

    // Something running and silent, which is what a question looks like.
    //
    // `cat` with no arguments, not the shell's own `read`: a builtin runs in
    // the shell, so the shell stays the foreground process and the tab is
    // genuinely idle. That is the rule working, and my first test of it was
    // simply the wrong test.
    std::thread::sleep(Duration::from_millis(4500));
    int_terminal_lib::pty::write(&sessions, "t1", "cat\n").ok();
    std::thread::sleep(Duration::from_millis(12500));
    show("a child process gone quiet");

    // Ctrl-D ends cat and hands the terminal back to the shell.
    int_terminal_lib::pty::write(&sessions, "t1", "\u{4}").ok();
    std::thread::sleep(Duration::from_millis(1500));
    show("after it finishes");
}
