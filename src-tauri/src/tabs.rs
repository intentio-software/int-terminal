//! What the window looked like last time.
//!
//! Kept in `~/.intentio/terminal-tabs.json`, beside the rest of the suite's
//! per-machine state. Not in a synced store: a working directory on this laptop
//! means nothing on another one, and restoring somebody else's tabs would be
//! worse than restoring none.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: String,
    /// What the person called it. Empty means "use what the shell is doing".
    #[serde(default)]
    pub name: String,
    /// Where it was working when the app last closed.
    #[serde(default)]
    pub cwd: String,
    /// A colour for the tab strip, as a hex string. Empty means none.
    #[serde(default)]
    pub colour: String,
    /// One emoji, shown before the name.
    #[serde(default)]
    pub emoji: String,
    /// Per-tab text size. A log tail wants small; pairing wants large; both at
    /// once is the ordinary case, which is why this is not a window setting.
    #[serde(default = "default_font_size")]
    pub font_size: u32,
}

fn default_font_size() -> u32 {
    13
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default)]
    pub tabs: Vec<Tab>,
    /// Which tab was in front.
    #[serde(default)]
    pub active: String,
}

fn path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(std::path::PathBuf::from(home).join(".intentio").join("terminal-tabs.json"))
}

pub fn read() -> Session {
    path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn write(session: &Session) -> std::io::Result<()> {
    let Some(p) = path() else { return Ok(()) };
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(session).unwrap_or_default();
    std::fs::write(p, format!("{json}\n"))
}

/// A short name for a directory, for a tab nobody has renamed.
///
/// Client repositories are named `<dsg>-front-end`, `<dsg>-back-end` and so on,
/// so the designator is the part worth showing: a strip reading STM, STM, M4C
/// says more at a glance than three truncated repository names.
pub fn label_for(cwd: &str) -> String {
    let name = std::path::Path::new(cwd)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| cwd.to_string());

    if let Some(home) = std::env::var_os("HOME") {
        if cwd == home.to_string_lossy() {
            return "~".into();
        }
    }
    match name.split_once('-') {
        // Only a plausible designator: three characters starting with a letter,
        // not the first word of a name like "full-stack-fastapi-template".
        // Digits count, because several real ones have them - M4C, for one.
        Some((prefix, rest))
            if prefix.len() == 3
                && prefix.starts_with(|c: char| c.is_ascii_alphabetic())
                && prefix.chars().all(|c| c.is_ascii_alphanumeric())
                && !rest.is_empty() =>
        {
            prefix.to_uppercase()
        }
        _ => name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_client_repository_shows_its_designator() {
        assert_eq!(label_for("/Users/max/work/int_github/stm-front-end"), "STM");
        assert_eq!(label_for("/Users/max/work/int_github/m4c-back-end"), "M4C");
    }

    #[test]
    fn an_ordinary_folder_keeps_its_name() {
        assert_eq!(label_for("/Users/max/work/experiments"), "experiments");
        // Not a designator: the first word happens to be four letters.
        assert_eq!(label_for("/Users/max/full-stack-template"), "full-stack-template");
    }

    #[test]
    fn a_hyphenated_name_with_a_long_first_word_is_left_alone() {
        assert_eq!(label_for("/tmp/intentio-terminal"), "intentio-terminal");
    }
}
