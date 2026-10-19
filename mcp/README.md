# Intentio Terminal MCP

```
claude mcp add --scope user terminal -- python3 ~/work/int_github/int-terminal/mcp/int_terminal_mcp.py
```

| Tool | |
|---|---|
| `terminal_tabs` | Every open tab, with whether it is idle, working, or **waiting** |
| `terminal_open_tab` | Ask the app to open a tab somewhere. Nothing is run in it |

Two tools, and deliberately no third.

The obvious one to add - "run this command in a tab" - is one an agent already
has as Bash. A second, unlogged path to the same capability buys nothing and
costs a control, so there is no way to execute anything through this server.

What it offers instead is the thing nothing else on the machine can answer:
which session has stopped and is waiting for a person. The terminal works that
out by reading its own ptys, which is why it has to come from here.

`terminal_tabs` says plainly when the app is not running, rather than
reporting every tab as idle - "nothing needs you" and "nobody is looking" are
different answers and should not look the same.
