# Bob Shell Safety & Security

## Trusted Folders

- First run in a folder triggers trust dialog: Trust / Don't trust / Don't ask again
- Decisions saved in `~/.bob/trustedFolders.json`
- **Non-interactive mode defaults to trusted** for folders without explicit decisions
- Pre-configure trust for CI/CD: edit `~/.bob/trustedFolders.json` before running

### Untrusted Folder Restrictions (Safe Mode)

- Project `.bob/settings.json` NOT loaded
- Project `.env` files NOT loaded
- MCP servers do NOT connect
- Auto-approval disabled (every tool needs confirmation)
- Memory files NOT auto-loaded
- Custom commands from TOML files NOT loaded

## Sandboxing

### Methods

| Method | Platform | Description |
|--------|----------|-------------|
| `sandbox-exec` (Seatbelt) | macOS only | Restricts writes outside project dir |
| Docker/Podman | Cross-platform | Full container isolation |

### Enabling

```bash
# Flag (single command)
bob --sandbox
bob -s "prompt"

# Environment variable (session)
export BOB_SHELL_SANDBOX=true
export BOB_SHELL_SANDBOX=docker  # specific type

# Settings file (persistent)
# In settings.json:
# { "tools": { "sandbox": true } }
```

Precedence: CLI flag > env var > settings file.

### Seatbelt Profiles

Control via `SEATBELT_PROFILE` env var:
- `permissive-open` (default) — restricts writes outside project

### Container Flags

```bash
export SANDBOX_FLAGS="--memory=4g --cpus=2"
```

## Non-Interactive Safety

- **Read-only by default** — no file modifications without `--yolo`
- `--yolo` enables writes but only within the project directory
- No trust dialog in non-interactive mode

## File Access Control

`.bobignore` (gitignore syntax) controls tool-based file access:
```
.env
secrets/
*.key
config/credentials.json
```
Limitations: only controls Bob's tool access, not shell command file access.

## Auto-Approve Risks

Auto-approve settings bypass confirmation prompts. Command-line auto-approve is particularly dangerous — can run arbitrary shell commands without user review.

## MCP Security

- Verify MCP server sources before connecting
- Remote MCP servers need same security as traditional server infrastructure
- Review tool permissions before granting `alwaysAllow`

## Checkpointing (Rollback Safety)

Enable in settings: `{ "general": { "checkpointing": { "enabled": true } } }`

- Creates Git snapshots in `~/.bob/history/<project_hash>/` (separate from project git)
- Saves conversation history at each file-modifying operation
- Restore: `/restore <checkpoint_file>` in interactive mode
