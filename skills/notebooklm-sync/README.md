# NotebookLM Sync Skill

Automatically syncs project documentation (markdown files) to Google NotebookLM so Claude can reference them via NotebookLM for grounded, citation-backed answers. Supports automatic sync via Claude Code hooks and manual batch operations.

## Overview

This skill manages bidirectional synchronization between your project's documentation and a dedicated Google NotebookLM notebook. Changes to markdown files are automatically captured and synced, enabling Claude to cite specific sections of your documentation with precision.

## Architecture

The skill is distributed as a package in `.claude/skills/notebooklm-sync/` with the following structure:

```
.claude/skills/notebooklm-sync/
├── README.md                    # This file
├── SKILL.md                     # Claude Code skill prompt
├── state.json                   # Project-agnostic reference template
├── scripts/
│   └── install.py               # Installer (deploys to project)
└── assets/
    ├── payload/                 # Canonical Python scripts
    │   ├── batch.py             # Bulk resync operation
    │   ├── cleanup.py           # Remove orphaned sources
    │   ├── init.py              # One-time setup
    │   ├── status.py            # Sync health check
    │   ├── update.py            # Single-file sync
    │   └── utils.py             # Shared utilities
    ├── config.py.template       # Template for project config
    └── hook.sh                  # Claude Code hook template
```

When installed into a project:
- Scripts deploy to `scripts/notebooklm_sync/` (project-specific)
- Configuration renders to `scripts/notebooklm_sync/config.py` (customizable)
- State (notebook ID, source mappings) stored at `~/.notebooklm/<project-slug>-sources.json` (shared across instances)
- Hook installs to `.claude/hooks/notebooklm-sync-hook.sh` (auto-invoked by Claude Code)

## Installation

### Initial Setup

```bash
# Deploy skill to current project
python .claude/skills/notebooklm-sync/scripts/install.py

# Or specify custom options
python .claude/skills/notebooklm-sync/scripts/install.py \
  --project-name "Custom Project" \
  --root-dir /path/to/docs
```

### Updating After Skill Changes

If the skill is updated (new payload scripts or hook logic):

```bash
# Re-deploy updated assets to project
python .claude/skills/notebooklm-sync/scripts/install.py --update
```

The installer will prompt before overwriting existing configuration.

## Configuration

Project-specific configuration lives in `scripts/notebooklm_sync/config.py` after installation. Customize:

| Option | Description | Default |
|--------|-------------|---------|
| `INCLUDE_DIRS` | Directories to scan for markdown | `["docs", ".claude"]` |
| `EXCLUDE_PATTERNS` | Glob patterns to skip | `["*.tmp", "**/__pycache__"]` |
| `ROOT_INCLUDE_FILES` | Files in project root to include | `["README.md", "CLAUDE.md"]` |
| `NOTEBOOK_TITLE` | NotebookLM notebook name | Project name + " Docs" |
| `CHUNK_SIZE_THRESHOLD` | Max chars before splitting | `15000` |
| `LOG_LEVEL` | Logging verbosity | `"INFO"` |

## Commands

| Command | Purpose | Use When |
|---------|---------|----------|
| `python scripts/notebooklm_sync/init.py` | Create notebook and upload docs | First-time setup |
| `python scripts/notebooklm_sync/init.py --refresh` | Reconcile sources with current scope | After major config changes |
| `python scripts/notebooklm_sync/batch.py` | Bulk resync stale/untracked files | Catching up after offline work |
| `python scripts/notebooklm_sync/batch.py -v` | Batch sync with verbose output | Debugging sync issues |
| `python scripts/notebooklm_sync/status.py` | Check sync health and stats | Monitoring overall status |
| `python scripts/notebooklm_sync/cleanup.py` | Remove orphaned sources | After deleting documentation files |
| `python scripts/notebooklm_sync/update.py <file>` | Sync single file to notebook | Manual single-file refresh |

## Workflow

### 1. Initial Setup

```bash
python scripts/notebooklm_sync/init.py
```

Creates a new NotebookLM notebook and uploads all documentation files matching your configuration. The notebook ID and source mappings are stored in `~/.notebooklm/<project-slug>-sources.json`.

### 2. Automatic Sync (via Hook)

When using Claude Code in this project:
- Write/Edit operations automatically trigger the sync hook
- Changed files are synced to NotebookLM within seconds
- You can reference the notebook in Claude conversations for citations

### 3. Manual Batch Sync

For catching up after offline changes or bulk updates:

```bash
python scripts/notebooklm_sync/batch.py
```

Scans for stale/untracked files and resynchronizes them.

### 4. Cleanup

After deleting documentation files, remove their orphaned references:

```bash
python scripts/notebooklm_sync/cleanup.py
```

## State Management

Project state is stored at `~/.notebooklm/<project-slug>-sources.json`:

```json
{
  "notebook_id": "abc-123-def",
  "notebook_title": "SkillMeat Docs",
  "last_sync": "2026-03-15T10:30:00Z",
  "sources": {
    "docs/api.md": {
      "source_id": "source-1",
      "source_title": "docs/api.md",
      "hash": "sha256:abc123...",
      "synced_at": "2026-03-15T10:30:00Z",
      "size_bytes": 4512
    }
  }
}
```

The installer generates a portable `state.json` reference file that documents where project-specific state lives (see below).

## Development Workflow

To maintain and improve the skill:

1. **Edit canonical source files** in `assets/payload/` (e.g., `batch.py`, `utils.py`)
2. **Update templates** in `assets/config.py.template` or `assets/hook.sh`
3. **Re-deploy to projects**:
   ```bash
   python .claude/skills/notebooklm-sync/scripts/install.py --update
   ```
4. **Test manually**:
   ```bash
   python scripts/notebooklm_sync/batch.py -v
   python scripts/notebooklm_sync/status.py
   ```

## Authentication

The skill uses the `notebooklm` CLI for authentication.

### Initial Authentication

```bash
notebooklm login
```

Follow the browser prompt to authenticate with your Google account.

### Re-authentication

If authentication expires or you get an "auth failed" error:

```bash
notebooklm logout
notebooklm login
```

Then retry your sync command. Scripts will exit with a clear message if auth is stale.

## Requirements

- `notebooklm` CLI installed and authenticated
- Python 3.9+
- Write access to `~/.notebooklm/` directory
- `requests` library (for file chunking and retry logic)

## Troubleshooting

### Notebook Not Found

**Error**: "Notebook ID invalid" or "Could not find notebook"

**Solution**: Run `python scripts/notebooklm_sync/status.py` to verify state. If corrupt, delete `~/.notebooklm/<project-slug>-sources.json` and re-run `init.py`.

### Sync Timeout

**Error**: "Request timed out" during batch sync

**Solution**: Run with smaller batches:
```bash
python scripts/notebooklm_sync/batch.py --max-files 10
```

### Large File Not Synced

**Error**: "File too large" warning in logs

**Solution**: Files larger than 50MB are skipped. Check logs for which files:
```bash
python scripts/notebooklm_sync/status.py | grep "too large"
```

### Config Changes Not Applied

**Issue**: Edited `scripts/notebooklm_sync/config.py` but old patterns still active

**Solution**: Refresh the notebook source list:
```bash
python scripts/notebooklm_sync/init.py --refresh
```

## API Reference

### Command Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Configuration error (missing config or invalid settings) |
| `2` | Authentication error (run `notebooklm login`) |
| `3` | Network error (retry with `--retry-count 5`) |
| `4` | Notebook state corrupted (delete and re-run init) |

### Log Files

Sync operations are logged to:
- `~/.notebooklm/sync.log` (verbose transcript)
- Terminal output (summary + errors)

View full logs with:
```bash
tail -f ~/.notebooklm/sync.log
```

## Performance Notes

- **Initial upload**: ~5-30 seconds per 100 files (depends on average file size)
- **Incremental sync**: ~1-2 seconds per file
- **Cleanup**: ~5 seconds per 100 orphaned sources
- **Status check**: ~2 seconds (reads local state)

For projects with 1000+ markdown files, batch operations are gated by NotebookLM API rate limits (typically 50-100 files/minute).

## Integration with Claude Code

The skill installs a Claude Code hook that fires on every Write/Edit operation:

```bash
.claude/hooks/notebooklm-sync-hook.sh
```

The hook:
1. Extracts changed file path
2. Checks if file matches INCLUDE_DIRS and EXCLUDE_PATTERNS
3. Calls `python scripts/notebooklm_sync/update.py <file>`
4. Logs results (visible in Claude Code terminal)

To disable auto-sync temporarily, rename or delete the hook file. Re-run the installer to restore it.

## Best Practices

1. **Run `init.py` once** at project setup time
2. **Keep markdown files below 20KB** where possible (improves citation precision)
3. **Use descriptive section headings** for better source navigation in NotebookLM
4. **Run `status.py` weekly** to catch orphaned sources early
5. **Run `cleanup.py` after deleting documentation** to avoid stale references
6. **Check logs** with `tail -f ~/.notebooklm/sync.log` if sync seems slow

## Limitations

- Supports markdown only (`.md` files)
- Single notebook per project (no multi-notebook support yet)
- NotebookLM API rate limits apply (typically 50-100 files/minute)
- Files larger than 50MB are skipped
- Sync is unidirectional (project → notebook); changes in NotebookLM are not reflected back

## License

This skill is part of the SkillMeat project and follows the same licensing terms.
