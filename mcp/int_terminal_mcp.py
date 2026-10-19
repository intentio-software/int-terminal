#!/usr/bin/env python3
"""An MCP server for Intentio Terminal.

Deliberately narrow. The obvious tool to put here - "run this command in a
tab" - is one an agent already has as Bash, and adding a second, unlogged path
to the same capability buys nothing and costs a control. So there is no way to
execute anything through this server.

What it offers instead is the thing nothing else can answer: which tabs exist,
what they are working on, and which of them has stopped and is waiting for a
person. That comes from the terminal reading its own pty, and no other tool on
the machine knows it.

Standard library only, newline-delimited JSON-RPC over stdio, same shape as
the other Intentio MCP servers.
"""

import json
import os
import sys
import time

TABS = os.path.expanduser("~/.intentio/terminal-tabs.json")
ACTIVITY = os.path.expanduser("~/.intentio/terminal-activity.json")
REQUESTS = os.path.expanduser("~/.intentio/terminal-requests.jsonl")

TOOLS = [
    {
        "name": "terminal_tabs",
        "description": (
            "Every open tab: its name, working directory, and whether it is idle, working, or "
            "waiting. 'waiting' means a program is running and has gone quiet, which usually "
            "means it is asking a person something. Use it to find the session that is stuck."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "terminal_open_tab",
        "description": (
            "Ask Intentio Terminal to open a tab in a directory. The person sees it appear; "
            "nothing is run in it. Use it to put somebody where the work is, not to do the work."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "cwd": {"type": "string", "description": "Absolute path to open in."},
                "name": {"type": "string", "description": "Optional caption for the tab."},
            },
            "required": ["cwd"],
        },
    },
]


def tabs():
    """What the app last wrote, plus live activity if it is running."""
    try:
        with open(TABS, encoding="utf-8") as handle:
            saved = json.load(handle)
    except (OSError, ValueError):
        return {"tabs": [], "note": "Intentio Terminal has not written a session yet."}

    # Activity is written by the running app every couple of seconds. If it is
    # stale the app is not running, and saying so is better than reporting
    # every tab as idle - which would read as "nothing needs you" when the
    # truth is "nobody is looking".
    live, fresh = {}, False
    try:
        with open(ACTIVITY, encoding="utf-8") as handle:
            recent = json.load(handle)
        fresh = (time.time() * 1000 - recent.get("at", 0)) < 15_000
        if fresh:
            live = {entry["id"]: entry for entry in recent.get("tabs", [])}
    except (OSError, ValueError, KeyError):
        pass

    out = []
    for tab in saved.get("tabs", []):
        state = live.get(tab.get("id"), {})
        entry = {
            "id": tab.get("id"),
            "name": tab.get("name") or os.path.basename(tab.get("cwd", "")) or "Shell",
            "cwd": tab.get("cwd", ""),
            "active": tab.get("id") == saved.get("active"),
        }
        if fresh:
            entry["activity"] = state.get("activity", "idle")
            entry["quietForSeconds"] = state.get("quietFor", 0)
        out.append(entry)

    return {
        "tabs": out,
        "note": (
            "Live, from the running terminal."
            if fresh
            else "Intentio Terminal is not running, so only the last saved layout is known "
            "and no activity can be reported."
        ),
    }


def open_tab(cwd, name):
    """Leave a request for the app to pick up."""
    path = os.path.abspath(os.path.expanduser(cwd))
    if not os.path.isdir(path):
        raise RuntimeError(f"{path} is not a directory.")

    os.makedirs(os.path.dirname(REQUESTS), exist_ok=True)
    with open(REQUESTS, "a", encoding="utf-8") as handle:
        handle.write(json.dumps({"at": int(time.time() * 1000), "cwd": path, "name": name or ""}) + "\n")
    return {
        "requested": {"cwd": path, "name": name or ""},
        "note": "The tab opens when Intentio Terminal is running. Nothing is run in it.",
    }


def call(name, args):
    if name == "terminal_tabs":
        return tabs()
    if name == "terminal_open_tab":
        return open_tab(args["cwd"], args.get("name"))
    raise RuntimeError(f"No such tool: {name}")


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue

        method = message.get("method")
        reply = {"jsonrpc": "2.0", "id": message.get("id")}

        if method == "initialize":
            reply["result"] = {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "int-terminal", "version": "1.0.0"},
            }
        elif method == "tools/list":
            reply["result"] = {"tools": TOOLS}
        elif method == "tools/call":
            params = message.get("params", {})
            try:
                result = call(params.get("name"), params.get("arguments") or {})
                reply["result"] = {
                    "content": [{"type": "text", "text": json.dumps(result, indent=2)}],
                    "isError": False,
                }
            except Exception as error:
                reply["result"] = {
                    "content": [{"type": "text", "text": str(error)}],
                    "isError": True,
                }
        elif method and method.startswith("notifications/"):
            continue
        else:
            reply["error"] = {"code": -32601, "message": f"Unknown method: {method}"}

        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
