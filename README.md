# Intentio Terminal

A terminal that remembers what you were doing.

- Tabs that come back after a restart, in the directory they were left in
- Captions from the work: `stm-front-end` shows as **STM**
- Rename, colour and mark a tab, so a strip of eight is readable at a glance
- Text size per tab, because a log tail and a pairing session want different ones

`⌘T` new tab · `⌘W` close · `⌘1-9` jump · `⌘⇧[` `⌘⇧]` cycle · `⌘+` `⌘-` size

## Built on

VT parsing and rendering is [xterm.js](https://xtermjs.org); the process side is
`portable-pty` from WezTerm. Neither wheel is reinvented here.

## Development

    npm install
    npm run tauri dev
