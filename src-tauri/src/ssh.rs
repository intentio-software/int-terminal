//! Hosts you already have, offered without being typed again.
//!
//! Reads `~/.ssh/config` and `~/.ssh/known_hosts` for the names of machines.
//! Nothing else in `~/.ssh` is ever opened: not a private key, not an agent
//! socket, not an authorized_keys file. A terminal has no business reading key
//! material, and the fact that it could is not a reason to.
//!
//! What it takes from the config is what you would need to describe a host to
//! somebody: its alias, the machine behind it, the user and the port. `ssh`
//! itself does the connecting, with the same config, so anything clever in
//! there - jump hosts, identity files, forwarding - keeps working because
//! nothing here tries to reimplement it.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    /// What you type after `ssh`.
    pub alias: String,
    /// The machine behind the alias, when the config names one.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub hostname: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub user: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub port: String,
    /// `config` for something you have defined, `known` for somewhere you have
    /// merely been. A defined host is worth offering first.
    pub source: String,
    /// Whether the name suggests production. Shown as a warning, never as a
    /// restriction: guessing from a name is not something to enforce on
    /// somebody, only something to mention.
    pub looks_live: bool,
}

/// Names that suggest a machine people care about.
fn looks_live(name: &str) -> bool {
    const MARKERS: [&str; 5] = ["prod", "live", "production", "www", "public"];
    let lower = name.to_lowercase();
    MARKERS.iter().any(|marker| lower.contains(marker))
}

/// Parse an ssh config into the hosts it defines.
///
/// Patterns are skipped. `Host *` and friends apply settings to everything
/// rather than naming a machine, and offering `*` as somewhere to connect
/// would be nonsense.
pub fn parse_config(text: &str) -> Vec<Host> {
    let mut hosts: Vec<Host> = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (keyword, rest) = match line.split_once(|c: char| c.is_whitespace() || c == '=') {
            Some((keyword, rest)) => (keyword.to_lowercase(), rest.trim().trim_start_matches('=').trim()),
            None => continue,
        };

        match keyword.as_str() {
            "host" => {
                for alias in rest.split_whitespace() {
                    if alias.contains('*') || alias.contains('?') || alias.starts_with('!') {
                        continue;
                    }
                    hosts.push(Host {
                        alias: alias.to_string(),
                        hostname: String::new(),
                        user: String::new(),
                        port: String::new(),
                        source: "config".into(),
                        looks_live: looks_live(alias),
                    });
                }
            }
            // These belong to the Host block above them.
            "hostname" | "user" | "port" => {
                if let Some(current) = hosts.last_mut() {
                    match keyword.as_str() {
                        "hostname" => {
                            current.hostname = rest.to_string();
                            current.looks_live |= looks_live(rest);
                        }
                        "user" => current.user = rest.to_string(),
                        _ => current.port = rest.to_string(),
                    }
                }
            }
            _ => {}
        }
    }
    hosts
}

/// Host names from a known_hosts file.
///
/// Hashed entries are skipped rather than attempted. The whole point of
/// hashing them is that the names are not readable, and a terminal should not
/// be the thing that tries anyway.
pub fn parse_known_hosts(text: &str) -> Vec<String> {
    let mut names: BTreeSet<String> = BTreeSet::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("@revoked") {
            continue;
        }
        let Some(field) = line.split_whitespace().next() else { continue };
        if field.starts_with('|') {
            continue;
        }
        for entry in field.split(',') {
            // Strip the [host]:port form used for non-standard ports.
            let entry = entry.trim_start_matches('[');
            let name = entry.split(']').next().unwrap_or(entry);
            let name = name.split(':').next().unwrap_or(name);
            if name.is_empty() {
                continue;
            }
            names.insert(name.to_string());
        }
    }
    names.into_iter().collect()
}

/// Everything worth offering, defined hosts first.
pub fn hosts() -> Vec<Host> {
    let Some(home) = std::env::var_os("HOME") else { return Vec::new() };
    let ssh = std::path::PathBuf::from(home).join(".ssh");

    let mut hosts = std::fs::read_to_string(ssh.join("config"))
        .map(|text| parse_config(&text))
        .unwrap_or_default();

    let defined: BTreeSet<String> = hosts.iter().map(|host| host.alias.clone()).collect();

    // Somewhere you have been but never described. Useful, but second.
    for name in std::fs::read_to_string(ssh.join("known_hosts"))
        .map(|text| parse_known_hosts(&text))
        .unwrap_or_default()
    {
        if defined.contains(&name) {
            continue;
        }
        hosts.push(Host {
            looks_live: looks_live(&name),
            alias: name,
            hostname: String::new(),
            user: String::new(),
            port: String::new(),
            source: "known".into(),
        });
    }
    hosts
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = "\
# a comment
Host prodserver7.intentio
    HostName 10.0.0.7
    User deploy
    Port 2222

Host dev box-a
    HostName 192.168.1.20

Host *
    ServerAliveInterval 60

Host !nope
    HostName nowhere
";

    #[test]
    fn a_host_block_keeps_what_belongs_to_it() {
        let hosts = parse_config(CONFIG);
        let first = &hosts[0];
        assert_eq!(first.alias, "prodserver7.intentio");
        assert_eq!(first.hostname, "10.0.0.7");
        assert_eq!(first.user, "deploy");
        assert_eq!(first.port, "2222");
    }

    #[test]
    fn one_line_can_name_several_hosts() {
        let hosts = parse_config(CONFIG);
        let aliases: Vec<&str> = hosts.iter().map(|h| h.alias.as_str()).collect();
        assert!(aliases.contains(&"dev"));
        assert!(aliases.contains(&"box-a"));
    }

    #[test]
    fn patterns_are_not_places_you_can_connect_to() {
        let aliases: Vec<String> = parse_config(CONFIG).into_iter().map(|h| h.alias).collect();
        assert!(!aliases.iter().any(|a| a.contains('*')), "Host * is settings, not a machine");
        assert!(!aliases.iter().any(|a| a.starts_with('!')));
    }

    #[test]
    fn a_production_looking_name_is_flagged() {
        let hosts = parse_config(CONFIG);
        assert!(hosts[0].looks_live, "prodserver7 should be flagged");
        assert!(!hosts.iter().find(|h| h.alias == "dev").unwrap().looks_live);
    }

    #[test]
    fn equals_signs_are_allowed_as_ssh_allows_them() {
        let hosts = parse_config("Host one\n  HostName=10.0.0.1\n");
        assert_eq!(hosts[0].hostname, "10.0.0.1");
    }

    #[test]
    fn known_hosts_gives_names_without_the_keys() {
        let known = "\
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...
[example.net]:2222 ssh-rsa AAAAB3...
one.example,two.example ssh-rsa AAAAB3...
|1|hashedhashedhashed=|more= ssh-rsa AAAAB3...
";
        let names = parse_known_hosts(known);
        assert!(names.contains(&"github.com".to_string()));
        assert!(names.contains(&"example.net".to_string()), "the [host]:port form");
        assert!(names.contains(&"one.example".to_string()));
        assert!(names.contains(&"two.example".to_string()));
        // Hashed entries are deliberately unreadable; do not try.
        assert!(!names.iter().any(|n| n.contains("hashed")));
        // And nothing that is key material.
        assert!(!names.iter().any(|n| n.starts_with("AAAA")));
    }
}
