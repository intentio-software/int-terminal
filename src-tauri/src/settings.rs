//! Preferences that belong to the person rather than to a tab.
//!
//! Font size is per tab, because a log tail and a pairing session want
//! different ones at the same time. A cursor is not like that: somebody has
//! one cursor they like, and seeing a different one in the next tab would be
//! an irritation rather than a feature.
//!
//! Lives in `~/.intentio/terminal.json`, beside the rest of the suite's
//! per-machine state, and is where the shell override is read from too.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// An explicit shell, overriding the account's login shell. Empty to
    /// follow the account.
    #[serde(default)]
    pub shell: String,
    /// `block`, `bar` or `underline`.
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default = "yes")]
    pub cursor_blink: bool,
    /// Hex colour, or empty to use the app's accent.
    #[serde(default)]
    pub cursor_colour: String,
    /// What the cursor does in a tab that is not in front. `none` is quiet;
    /// `outline` still shows where you were.
    #[serde(default = "default_inactive")]
    pub cursor_inactive: String,
    /// Keep shells running when the app closes, by hosting them in tmux.
    ///
    /// Off by default. It needs tmux installed, and it puts tmux between you
    /// and your shell - its key bindings, its idea of a window - which is a
    /// real change to how the terminal behaves and not one to make for
    /// somebody without asking.
    #[serde(default)]
    pub persist_sessions: bool,
}

fn default_cursor_style() -> String {
    "block".into()
}

fn default_inactive() -> String {
    "outline".into()
}

fn yes() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            shell: String::new(),
            cursor_style: default_cursor_style(),
            cursor_blink: true,
            cursor_colour: String::new(),
            cursor_inactive: default_inactive(),
            persist_sessions: false,
        }
    }
}

fn path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(std::path::PathBuf::from(home).join(".intentio").join("terminal.json"))
}

pub fn read() -> Settings {
    path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn write(settings: &Settings) -> std::io::Result<()> {
    let Some(p) = path() else { return Ok(()) };
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(settings).unwrap_or_default();
    std::fs::write(p, format!("{json}\n"))
}

/// Whether tmux is available to host sessions.
pub fn tmux_path() -> Option<String> {
    for candidate in ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"] {
        if std::path::Path::new(candidate).is_file() {
            return Some(candidate.to_string());
        }
    }
    // Fall back to whatever is on PATH, which is not much of a fallback for a
    // GUI app launched from Finder but costs nothing to try.
    let out = std::process::Command::new("which").arg("tmux").output().ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!path.is_empty()).then_some(path)
}

/// Shells worth offering, that actually exist on this machine.
pub fn available_shells() -> Vec<String> {
    let mut found: Vec<String> = std::fs::read_to_string("/etc/shells")
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter(|line| std::path::Path::new(line).exists())
        .map(str::to_string)
        .collect();
    found.dedup();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_file_gives_sensible_defaults() {
        let settings: Settings = serde_json::from_str("{}").expect("settings");
        assert_eq!(settings.cursor_style, "block");
        assert!(settings.cursor_blink);
        // Empty means "follow the account", not "no shell".
        assert!(settings.shell.is_empty());
    }

    #[test]
    fn persistence_is_off_unless_asked_for() {
        let settings: Settings = serde_json::from_str("{}").expect("settings");
        assert!(!settings.persist_sessions, "it changes how the terminal behaves");
    }

    #[test]
    fn a_partial_file_keeps_the_rest() {
        // Somebody editing this by hand should not have to write it all out.
        let settings: Settings =
            serde_json::from_str(r#"{"cursorStyle":"bar"}"#).expect("settings");
        assert_eq!(settings.cursor_style, "bar");
        assert!(settings.cursor_blink, "unspecified fields keep their defaults");
        assert_eq!(settings.cursor_inactive, "outline");
    }
}
