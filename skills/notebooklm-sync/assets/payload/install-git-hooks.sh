#!/usr/bin/env bash
# Install NotebookLM git hooks
# Usage: ./install-git-hooks.sh

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the script directory and repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")

if [[ -z "${REPO_ROOT}" ]]; then
    echo -e "${RED}Error: Not in a git repository${NC}"
    exit 1
fi

HOOKS_SRC="${SCRIPT_DIR}/hooks"
HOOKS_DST="${REPO_ROOT}/.git/hooks"

echo "Installing NotebookLM git hooks..."
echo ""

# Ensure .git/hooks directory exists
mkdir -p "${HOOKS_DST}"

# Install pre-commit hook
install_hook() {
    local hook_name="$1"
    local src_file="${HOOKS_SRC}/pre-commit-notebooklm"
    local dst_file="${HOOKS_DST}/${hook_name}"

    if [[ ! -f "${src_file}" ]]; then
        echo -e "${RED}Error: Source hook not found: ${src_file}${NC}"
        return 1
    fi

    if [[ -f "${dst_file}" ]]; then
        # Check if it's already our hook or a different one
        if grep -q "notebooklm" "${dst_file}" 2>/dev/null; then
            echo -e "${YELLOW}Updating existing ${hook_name} hook...${NC}"
        else
            # There's an existing hook that's not ours
            echo -e "${YELLOW}Existing ${hook_name} hook found. Creating wrapper...${NC}"

            # Backup existing hook
            mv "${dst_file}" "${dst_file}.original"

            # Create wrapper that calls both
            cat > "${dst_file}" << WRAPPER
#!/usr/bin/env bash
# Wrapper hook that calls multiple hooks

# Run original hook first
if [[ -x "${dst_file}.original" ]]; then
    "${dst_file}.original"
    original_status=\$?
    if [[ \$original_status -ne 0 ]]; then
        exit \$original_status
    fi
fi

# Run NotebookLM hook (non-blocking)
if [[ -x "${HOOKS_SRC}/pre-commit-notebooklm" ]]; then
    "${HOOKS_SRC}/pre-commit-notebooklm"
fi

exit 0
WRAPPER
            chmod +x "${dst_file}"
            echo -e "${GREEN}Created wrapper ${hook_name} hook${NC}"
            return 0
        fi
    fi

    # Create symlink or copy the hook
    # Using symlink so updates to source are reflected automatically
    ln -sf "${src_file}" "${dst_file}"
    chmod +x "${dst_file}"
    echo -e "${GREEN}Installed ${hook_name} hook (symlink)${NC}"
}

# Install pre-commit hook
install_hook "pre-commit"

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo "Hooks installed:"
echo "  - pre-commit: Warns about stale NotebookLM docs (non-blocking)"
echo ""
echo "To uninstall, run:"
echo "  rm ${HOOKS_DST}/pre-commit"
echo ""
