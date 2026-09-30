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
    fn a_partial_file_keeps_the_rest() {
        // Somebody editing this by hand should not have to write it all out.
        let settings: Settings =
            serde_json::from_str(r#"{"cursorStyle":"bar"}"#).expect("settings");
        assert_eq!(settings.cursor_style, "bar");
        assert!(settings.cursor_blink, "unspecified fields keep their defaults");
        assert_eq!(settings.cursor_inactive, "outline");
    }
}
