---
name: notebooklm-sync
description: >-
  Deploy and manage NotebookLM documentation sync for any Claude Code project.
  Installs Python scripts + Claude Code hook that automatically syncs markdown
  files to a Google NotebookLM notebook on every Write/Edit. Supports install,
  status, resync, batch sync, cleanup, and uninstall workflows.
  Use when setting up NotebookLM sync in a new project, checking sync health,
  or managing notebook sources.
---

# NotebookLM Sync Skill

Deploy a NotebookLM documentation sync system into any Claude Code project. This skill packages Python scripts and a Claude Code hook that automatically syncs markdown documentation to a Google NotebookLM notebook whenever files are edited.

## Quick Reference

| Task | Command |
|------|---------|
| Install sync in project | `/notebooklm-sync` or `/notebooklm-sync install` |
| Check sync health | `/notebooklm-sync status` |
| Resync all modified files | `/notebooklm-sync resync` |
| Update scope (after config change) | `/notebooklm-sync refresh` |
| Remove orphaned sources | `/notebooklm-sync cleanup` |
| Remove sync from project | `/notebooklm-sync uninstall` |

## Prerequisites

Before using this skill, ensure:

- **Python 3.9+** installed
- **`notebooklm-py` package** installed: `pip install notebooklm-py`
- **Google authentication**: `notebooklm login` (you'll be prompted to authenticate)
- **`jq`** available on PATH (used by the hook shell script for JSON processing)

If any prerequisite is missing, the installer will detect and guide you through setup.

## File Structure

The skill deploys the following structure to your project:

```
scripts/notebooklm_sync/
├── __init__.py              # Package initialization
├── config.py                # Per-project configuration
├── utils.py                 # Common utilities (NotebookLM API, file handling)
├── init.py                  # Initialize/refresh notebook and sources
├── update.py                # Single-file sync (used by hook)
├── batch.py                 # Batch resync operations
├── status.py                # Check sync health
├── cleanup.py               # Remove orphaned sources
└── install-git-hooks.sh     # Git hook installer (optional)

.claude/hooks/
└── notebooklm-sync-hook.sh  # Claude Code PostToolUse hook

~/.notebooklm/
├── <project>-sources.json   # Local-to-remote file mapping
└── sync.log                 # Sync operation log
```

## Installation Workflow

Run `/notebooklm-sync install` to set up sync in the current project. The installer performs these steps:

### Step 1: Prerequisite Check

Verify that:
- `notebooklm-py` is installed (suggest `pip install notebooklm-py` if not)
- You are authenticated (`notebooklm login` if not)
- `jq` is available (critical for hook operation)

### Step 2: Discover Documentation Directories

Scan the project for documentation directories:
- `docs/` and all subdirectories (`docs/dev/`, `docs/project_plans/`, etc.)
- `.claude/progress/`
- `.claude/worknotes/`
- Any user-specified directories

The installer presents findings and asks which to include in the sync scope.

### Step 3: Configure Scope

Ask user for:
- **Notebook title** in NotebookLM (default: `<project-name> Documentation`)
- **Root-level files** to include (e.g., `README.md`, `CHANGELOG.md`)
- **Directories** to recursively scan for `.md` files
- **Exclude patterns** (glob patterns to skip)

### Step 4: Run Installation

Execute the Python installer:

```bash
python .claude/skills/notebooklm-sync/scripts/install.py \
  --project-name "<project-slug>" \
  --notebook-title "<title>" \
  --include-dirs "docs" \
  --include-dirs ".claude/progress" \
  --root-files "README.md" \
  --root-files "CHANGELOG.md" \
  --exclude-patterns "*.draft.md" \
  --exclude-patterns "tmp-*"
```

This:
1. Creates the NotebookLM notebook
2. Deploys `scripts/notebooklm_sync/` to the project
3. Installs the Claude Code PostToolUse hook
4. Performs initial scan and creates the mapping file at `~/.notebooklm/<project>-sources.json`

### Step 5: Verify Installation

Run status check to confirm:

```bash
python scripts/notebooklm_sync/status.py
```

Expected output shows:
- Notebook ID and title
- Number of tracked files
- Last sync timestamp
- Sync status (OK / pending changes / errors)

## Status Workflow

Check the health of the sync system in the current project:

```bash
# Overview
python scripts/notebooklm_sync/status.py

# Show files modified since last sync
python scripts/notebooklm_sync/status.py --stale

# Show files in scope but not yet synced
python scripts/notebooklm_sync/status.py --untracked

# Show files tracked but deleted locally (orphaned)
python scripts/notebooklm_sync/status.py --orphaned

# Machine-readable JSON output
python scripts/notebooklm_sync/status.py --json
```

Status flags:
- **OK**: File synced, no local changes
- **STALE**: File modified locally but not synced to NotebookLM
- **UNTRACKED**: File in scope but never synced
- **ORPHANED**: Source in NotebookLM but file deleted locally
- **SYNC_ERROR**: Last sync attempt failed

## Batch Resync Workflow

Force-sync all modified and new files:

```bash
# Resync all stale and untracked files
python scripts/notebooklm_sync/batch.py

# Only resync modified files (skip new/untracked)
python scripts/notebooklm_sync/batch.py --stale-only

# Preview changes without syncing
python scripts/notebooklm_sync/batch.py --dry-run

# Resync with verbose output
python scripts/notebooklm_sync/batch.py --verbose

# Resync specific files
python scripts/notebooklm_sync/batch.py --files "docs/api.md" --files "docs/guide.md"
```

The batch operation:
1. Scans for stale (modified) and untracked (new) files
2. For each file: deletes old NotebookLM source (if exists) and uploads new content
3. Updates the mapping file
4. Applies 1-second delay between uploads to avoid rate limiting
5. Logs all operations to `~/.notebooklm/sync.log`

## Refresh Scope Workflow

Update the set of directories to sync after editing `scripts/notebooklm_sync/config.py`:

```python
# Example: add .claude/agents to scope
INCLUDE_DIRS = [
    "docs",
    ".claude/progress",
    ".claude/agents",  # <-- Added
]
```

Then refresh:

```bash
# Reconcile notebook sources with new scope
python scripts/notebooklm_sync/init.py --refresh

# Preview changes
python scripts/notebooklm_sync/init.py --refresh --dry-run
```

This:
1. Scans for files in new directories
2. Uploads new files as sources
3. Removes sources for files now outside scope
4. Updates the mapping file

## Cleanup Workflow

Remove orphaned sources (files deleted locally but still in NotebookLM):

```bash
# Preview orphaned sources
python scripts/notebooklm_sync/cleanup.py --dry-run

# Remove orphaned sources (with confirmation)
python scripts/notebooklm_sync/cleanup.py

# Remove orphaned sources (no confirmation)
python scripts/notebooklm_sync/cleanup.py --force

# Remove specific sources
python scripts/notebooklm_sync/cleanup.py --sources "source-id-1" --sources "source-id-2"
```

## Uninstall Workflow

To remove the sync system from a project:

### Option 1: Automated Uninstall

```bash
python .claude/skills/notebooklm-sync/scripts/uninstall.py --project-root .
```

### Option 2: Manual Removal

1. Delete the sync scripts directory:
   ```bash
   rm -rf scripts/notebooklm_sync/
   ```

2. Remove the Claude Code hook:
   ```bash
   rm -f .claude/hooks/notebooklm-sync-hook.sh
   ```

3. Remove hook registration from `.claude/settings.json`:
   ```json
   {
     "hooks": {
       // Remove this entry:
       "notebooklm-sync": {
         "trigger": "PostToolUse",
         "script": ".claude/hooks/notebooklm-sync-hook.sh"
       }
     }
   }
   ```

4. (Optional) Delete the mapping file:
   ```bash
   rm -f ~/.notebooklm/<project-slug>-sources.json
   ```

5. (Optional) Delete the NotebookLM notebook via Google interface or:
   ```bash
   notebooklm delete <notebook-id>
   ```

## How It Works

The sync system has two modes:

### Auto-Sync (Hook-Triggered)

When you use Write or Edit on a markdown file within the configured scope:

1. The `.claude/hooks/notebooklm-sync-hook.sh` PostToolUse hook fires
2. The hook calls `scripts/notebooklm_sync/update.py <file-path>`
3. If the file is in scope (matching INCLUDE_DIRS and not excluded):
   - Delete old NotebookLM source (if it exists)
   - Upload new content as a source
   - Update the mapping file
4. Hook errors are logged but **never fail** the Write/Edit operation
5. All operations are logged to `~/.notebooklm/sync.log`

### Manual Sync

Scripts for on-demand operations:
- **`status.py`**: Check sync health without making changes
- **`batch.py`**: Bulk sync all modified/new files
- **`init.py --refresh`**: Reconcile scope after config changes
- **`cleanup.py`**: Remove orphaned sources

## Configuration

After installation, configure the sync scope in `scripts/notebooklm_sync/config.py`:

```python
# Root-level files to include
ROOT_INCLUDE_FILES = [
    "README.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
]

# Directories to recursively scan for .md files
INCLUDE_DIRS = [
    "docs",
    ".claude/progress",
    ".claude/worknotes",
]

# Glob patterns to exclude (relative to INCLUDE_DIRS)
EXCLUDE_PATTERNS = [
    "*.draft.md",
    "tmp-*",
    "**/private/*",
]

# Path to mapping file (local file -> NotebookLM source ID)
MAPPING_PATH = "~/.notebooklm/{PROJECT_SLUG}-sources.json"

# NotebookLM notebook title
DEFAULT_NOTEBOOK_TITLE = "Project Documentation"

# NotebookLM notebook ID (set during install)
NOTEBOOK_ID = "notebook-id-here"
```

Edit this file to:
- Add/remove documentation directories
- Exclude draft or temporary files
- Change the notebook title (not recommended after initial setup)

After edits, run `python scripts/notebooklm_sync/init.py --refresh` to reconcile.

## Mapping File Format

The mapping file at `~/.notebooklm/<project>-sources.json` tracks which local files map to which NotebookLM sources:

```json
{
  "notebook_id": "abc123def456...",
  "notebook_title": "Project Documentation",
  "last_refresh": "2024-11-29T10:00:00Z",
  "sources": {
    "docs/api.md": {
      "source_id": "source-abc123",
      "title": "API Documentation",
      "last_synced": "2024-11-29T10:15:30Z"
    },
    "README.md": {
      "source_id": "source-def456",
      "title": "README",
      "last_synced": "2024-11-29T10:15:35Z"
    }
  }
}
```

**Do not edit manually** — scripts manage this file automatically. If corruption occurs, delete it and run `/notebooklm-sync resync` to rebuild.

## Important Notes

### Safety & Error Handling

- **Hook never fails**: All errors are caught and logged to `~/.notebooklm/sync.log`. If sync fails, your Write/Edit still succeeds.
- **Atomic operations**: File upload and mapping update are atomic (mapping updated only if upload succeeds).
- **Logging**: All operations logged to `~/.notebooklm/sync.log` with timestamps and full error context.

### Capacity Limits

- **50-source limit** per NotebookLM notebook — keep your sync scope focused.
- If you exceed 50 files, consider:
  - Creating separate notebooks for different projects
  - Excluding generated/temporary files via `EXCLUDE_PATTERNS`
  - Using nested scopes (e.g., `docs/api/` instead of all `docs/`)

### File Naming & Collisions

- **README collision handling**: If multiple directories contain `README.md` (e.g., `docs/README.md` and `docs/guides/README.md`), they are renamed to `README-{parent}.md` (e.g., `README-docs.md`, `README-guides.md`) to avoid name collisions in NotebookLM.
- **Dot-files excluded**: Files starting with `.` are skipped (e.g., `.gitignore`, `.env`).

### Rate Limiting

- **1-second delay** applied between uploads during batch operations to avoid hitting NotebookLM API rate limits.
- Hook triggers are **not rate-limited** — each Write/Edit triggers a sync immediately. If you rapidly edit multiple files, they queue on the NotebookLM side.

### Debugging

Check the log file for errors:

```bash
tail -f ~/.notebooklm/sync.log
```

Common issues:
- **"Notebook not found"**: NotebookLM was deleted. Run `/notebooklm-sync install` to create a new one.
- **"Authentication failed"**: Run `notebooklm login` to re-authenticate.
- **"Source upload failed"**: File may be too large (NotebookLM has file size limits). Check log for details.
- **"Mapping corrupted"**: Delete `~/.notebooklm/<project>-sources.json` and run `/notebooklm-sync resync`.

## Examples

### Example 1: Install Sync for a New Project

```bash
/notebooklm-sync install

# Follow prompts to select directories and files
# Installer creates notebook and deploys scripts
# Run status check to verify
/notebooklm-sync status
```

### Example 2: Check What's Changed Since Last Sync

```bash
python scripts/notebooklm_sync/status.py --stale

# Output:
# STALE: docs/api.md (modified 2 hours ago)
# STALE: docs/guide.md (modified 30 minutes ago)
# UNTRACKED: docs/new-feature.md (added 5 minutes ago)
```

### Example 3: Resync After Editing Multiple Files

```bash
# You edited several docs and want to force a sync
python scripts/notebooklm_sync/batch.py

# Monitor progress
python scripts/notebooklm_sync/status.py --verbose
```

### Example 4: Add .claude/agents to Scope

```bash
# Edit config
# In scripts/notebooklm_sync/config.py, add ".claude/agents" to INCLUDE_DIRS

# Refresh to upload new files
python scripts/notebooklm_sync/init.py --refresh

# Verify
python scripts/notebooklm_sync/status.py
```

### Example 5: Clean Up After Deleting Files

```bash
# You deleted some docs locally but NotebookLM still has them
python scripts/notebooklm_sync/status.py --orphaned

# Remove orphaned sources
python scripts/notebooklm_sync/cleanup.py --force
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Notebook not found" | Notebook was deleted. Run `/notebooklm-sync install` to create a new one. |
| Authentication fails | Run `notebooklm login` and re-authenticate with Google. |
| Files not syncing on Write/Edit | Check that the hook is registered: `cat .claude/settings.json \| grep notebooklm-sync`. Reinstall if missing: `python .claude/skills/notebooklm-sync/scripts/install.py --repair`. |
| "NotebookLM API rate limit exceeded" | Too many syncs in rapid succession. Wait a minute before syncing again. Batch operations apply 1s delays to avoid this. |
| Mapping file corrupted | Delete `~/.notebooklm/<project>-sources.json` and run `/notebooklm-sync resync`. |
| Hook script not executable | Run `chmod +x .claude/hooks/notebooklm-sync-hook.sh`. |
| `jq` command not found | Install `jq`: `brew install jq` (macOS) or `apt install jq` (Linux). |

## Summary

This skill provides a complete NotebookLM documentation sync system for Claude Code projects. Use it to:

- **Automatically sync** markdown files to NotebookLM on every Write/Edit
- **Maintain documentation** in NotebookLM as a living reference
- **Batch resync** after major documentation overhauls
- **Manage scope** by editing configuration and refreshing
- **Monitor health** with status checks
- **Clean up** orphaned sources

All operations are logged, safe (hook never fails), and configurable to fit your project's documentation structure.
