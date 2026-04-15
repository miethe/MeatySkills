# Bob Shell Overview

IBM Bob Shell — terminal-based AI assistant from IBM Bob.

## Session Types

| Type | Command | Use case |
|------|---------|----------|
| Interactive | `bob` | Conversational, exploratory, multi-turn |
| Non-interactive | `bob -p "prompt"` | Automation, scripting, bounded tasks |

## Modes

| Mode | Purpose |
|------|---------|
| `code` | Generate, modify, refactor code |
| `ask` | Answer questions about codebase |
| `plan` | Design and plan before implementation |
| `advanced` | Extended capabilities including MCP and browser tools |
| `orchestrator` | Coordinate complex multi-step projects |

Select with `--chat-mode=MODE` or `/mode MODE` in interactive.

## Tool Categories

- **Read** — file content, code structure (non-destructive)
- **Write** — create/modify files
- **Command** — run shell commands, install packages
- **MCP** — external tools via Model Context Protocol
- **Mode** — switch between modes
- **Question** — gather additional info from user

## Project Context

- `AGENTS.md` — project-level instructions (like Claude Code's `CLAUDE.md`)
- Memory file imports: `@./path/to/file.md` syntax in AGENTS.md
- `.bobignore` — gitignore-syntax file access control
- `.bobrules` — custom rules for coding style, documentation approach
- `.bob/commands/` — custom slash commands (markdown files)
- `.bob/custom_modes.yaml` — project-specific custom modes
- `~/.bob/` — global config, rules, commands, custom modes

## Config Precedence (highest to lowest)

1. Command-line flags
2. Environment variables
3. Project `.bob/settings.json`
4. User `~/.bob/settings.json`
5. System-level settings

## Key Differences from Claude Code

| Bob Shell | Claude Code |
|-----------|------------|
| `AGENTS.md` | `CLAUDE.md` |
| `.bobignore` | Built-in ignoring |
| `.bobrules` | CLAUDE.md conventions |
| `.bob/commands/` | `.claude/commands/` |
| `bob -p` | `claude -p` |
| `--yolo` (enable writes) | `--dangerously-skip-permissions` |
| IBMid auth | Anthropic auth |
| Bobcoins billing | Anthropic billing |
