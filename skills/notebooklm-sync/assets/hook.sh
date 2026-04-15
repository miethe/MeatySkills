#!/bin/bash
# NotebookLM Sync Hook for Claude Code
# Triggers on Write|Edit of markdown files
# Syncs changed files to NotebookLM notebook

set -euo pipefail

LOG_FILE="$HOME/.notebooklm/sync.log"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

log() {
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Read stdin (Claude Code passes JSON via stdin to hooks)
STDIN_JSON=$(cat)

# Parse file_path from tool_input
FILE_PATH=$(echo "$STDIN_JSON" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" ]]; then
    exit 0
fi

# Convert absolute path to relative
if [[ "$FILE_PATH" == "$PROJECT_DIR"/* ]]; then
    REL_PATH="${FILE_PATH#$PROJECT_DIR/}"
else
    REL_PATH="$FILE_PATH"
fi

# Quick filter: only markdown files
if [[ ! "$REL_PATH" =~ \.md$ ]]; then
    exit 0
fi

# Skip .claude/ internal files
if [[ "$REL_PATH" =~ ^\.claude/ ]]; then
    exit 0
fi

log "Syncing: $REL_PATH"

# Run the sync script (scope check happens in Python)
cd "$PROJECT_DIR"
python scripts/notebooklm_sync/update.py "$REL_PATH" 2>> "$LOG_FILE" || {
    log "ERROR: Sync failed for $REL_PATH"
    exit 0  # Don't fail the hook
}

log "Sync complete: $REL_PATH"
exit 0
