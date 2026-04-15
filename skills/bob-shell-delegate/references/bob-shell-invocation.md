# Bob Shell CLI Invocation Reference

## Core Commands

```bash
# Interactive session
bob

# Non-interactive (read-only by default)
bob -p "prompt"

# Non-interactive with write access
bob -p "prompt" --yolo

# Pipe input
cat file.txt | bob -p "explain this"

# File reference + output redirect
bob -p "Review @src/main.js" > review.md

# Specific mode
bob --chat-mode=code
bob --chat-mode=code -p "refactor this function"

# Sandboxed execution
bob --sandbox
bob -s "analyze this script"
bob --chat-mode=code --sandbox -p "task"
```

## Non-Interactive Behavior

- Read-only by default — only read tools available
- `--yolo` enables write tools (file create/modify)
- Even with `--yolo`, Bob will NOT write outside the project directory
- Output includes thinking steps; add formatting instructions to prompt for clean output
- Must accept license agreement before first non-interactive use (run interactive once)

## File References

Use `@` to reference project files in prompts:
```bash
bob -p "Explain @src/utils.js"
bob -p "Review @src/api.js and suggest improvements"
```

## Slash Commands (Interactive)

| Command | Action |
|---------|--------|
| `/mode CODE\|ASK\|PLAN\|ADVANCED` | Switch mode |
| `/settings` | Open settings dialog |
| `/permissions` | Manage trusted folder settings |
| `/restore <checkpoint>` | Restore from checkpoint |
| `/instance` | Switch IBM instance/team |
| `/ide enable\|status\|install` | IDE integration |
| `/memory refresh\|show` | Reload/view context files |

## Custom Commands

Create `.bob/commands/name.md` files:
```yaml
---
description: Create a new API endpoint
argument-hint: <endpoint-name> <http-method>
---
Create a new API endpoint called $1 that handles $2 requests.
```

Commands from:
- `.bob/commands/` — project-level
- `~/.bob/commands/` — global

## Installation

```bash
# macOS/Linux
curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash

# Windows (PowerShell)
powershell -ep Bypass 'irm -Uri "https://bob.ibm.com/download/bobshell.ps1" | iex'

# Via npm
npm install -g bobshell

# Uninstall
npm uninstall -g bobshell
```

Requires: Node.js 22.15.0+, 4GB RAM (8GB recommended), internet connection.
