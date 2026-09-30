# CLAUDE.md

Guidance for Claude Code working in this repository.

Intentio Terminal: a Tauri + Angular terminal emulator.

- The VT parsing and rendering is xterm.js. Do not write a parser.
- The process side is `portable-pty`, in `src-tauri/src/pty.rs`.
- Per-machine state lives in `~/.intentio/`, never in a synced store: a working
  directory on this laptop means nothing on another one.

## Project knowledge

Shared context lives in the Intentio Knowledge vault, through the `knowledge`
MCP server.

- `Intentio/04-Technical` - stack conventions and principles
- `Intentio/07-Agents and AI/README.md` - how the vault, the MCP servers and
  Claude fit together

Write durable findings back into the vault rather than leaving them in a chat
log, or as a new file in this repo - the vault is the durable record.
