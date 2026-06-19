#!/usr/bin/env bash
#
# sync-to-global.sh — Refresh the GLOBAL delegation-router SKILL CODE from the
# authoritative skillmeat copy.
#
# AUTHORITATIVE SOURCE: the skillmeat repo skill dir
#   .claude/skills/delegation-router/  (resolver.js, routing-record.js, etc.)
#
# WHAT THIS SCRIPT DOES:
#   Copies the engine code into ~/.claude/skills/delegation-router/ ONLY.
#   It does NOT copy registry DATA (model-registry.yaml / .generated.json).
#
# REGISTRY DATA IS GLOBAL-CANONICAL:
#   ~/.claude/config/model-registry.{yaml,generated.json} is the single source of
#   truth for registry data. It lives there only and is edited there directly.
#   To regenerate the JSON after editing the YAML run:
#       python3 .claude/skills/delegation-router/scripts/build-model-registry.py
#
# DEPRECATION WARNING:
#   Per-repo .claude/config/model-registry.* copies (Tier 2 in the resolver's 3-tier
#   lookup) are deprecated. They still work as per-project OVERRIDES, but are no longer
#   the canonical copy. Bootstrapped repos (ccdash, citytile_pack, etc.) should delete
#   their local copies; the resolver falls through to the global canonical automatically.
#
# tests/ and the dev-only node_modules are intentionally NOT copied — the global
# resolver falls back to model-registry.generated.json when js-yaml is absent.
#
# Idempotent: safe to re-run. Edit the skill in skillmeat (authoritative), then
# re-run this script to refresh the global copy.
#
set -euo pipefail

# --- Resolve source dir relative to this script (skillmeat is the documented default) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/ lives inside the skill dir; the skill dir is its parent.
SRC_SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# .claude/config/ is three levels up from the skill dir: skills/<name>/../../config
SRC_REPO_CLAUDE_DIR="$(cd "${SRC_SKILL_DIR}/../.." && pwd)"
SRC_CONFIG_DIR="${SRC_REPO_CLAUDE_DIR}/config"

# --- Destinations (global) ---
DEST_SKILL_DIR="${HOME}/.claude/skills/delegation-router"
DEST_CONFIG_DIR="${HOME}/.claude/config"

# --- Engine files to copy (no tests/, no node_modules) ---
SKILL_FILES=(
  resolver.js
  routing-record.js
  audit-log.js
  SKILL.md
  SPEC.md
  README.md
  CHANGELOG.md
)
SKILL_DIRS=(
  references
  scripts
)

# --- Validate source ---
for f in "${SKILL_FILES[@]}"; do
  if [[ ! -f "${SRC_SKILL_DIR}/${f}" ]]; then
    echo "ERROR: missing source skill file: ${SRC_SKILL_DIR}/${f}" >&2
    exit 1
  fi
done
for d in "${SKILL_DIRS[@]}"; do
  if [[ ! -d "${SRC_SKILL_DIR}/${d}" ]]; then
    echo "ERROR: missing source skill dir: ${SRC_SKILL_DIR}/${d}" >&2
    exit 1
  fi
done

echo "delegation-router :: global sync (code only)"
echo "  source skill : ${SRC_SKILL_DIR}"
echo "  dest  skill  : ${DEST_SKILL_DIR}"
echo "  registry     : ~/.claude/config/ (global-canonical — NOT touched by this script)"
echo

# --- Deprecation check: warn if repo-local registry data files still exist ---
if [[ -f "${SRC_CONFIG_DIR}/model-registry.yaml" ]] || \
   [[ -f "${SRC_CONFIG_DIR}/model-registry.generated.json" ]]; then
  echo "DEPRECATION WARNING: repo-local registry files detected at ${SRC_CONFIG_DIR}/"
  echo "  model-registry.yaml and model-registry.generated.json are now GLOBAL-CANONICAL."
  echo "  The repo copies should be removed (git rm) after confirming the global copy is current."
  echo "  The resolver still reads them as Tier-2 per-project overrides, but they are no longer"
  echo "  the authoritative source. Delete them; the resolver will fall through to ~/.claude/config/."
  echo
fi

# --- Prepare destinations ---
mkdir -p "${DEST_SKILL_DIR}"
mkdir -p "${DEST_CONFIG_DIR}"

# --- Copy engine files ---
for f in "${SKILL_FILES[@]}"; do
  cp -f "${SRC_SKILL_DIR}/${f}" "${DEST_SKILL_DIR}/${f}"
  echo "  copied  ${f}"
done

# --- Copy engine dirs (replace contents to avoid stale leftovers) ---
for d in "${SKILL_DIRS[@]}"; do
  rm -rf "${DEST_SKILL_DIR:?}/${d}"
  mkdir -p "${DEST_SKILL_DIR}/${d}"
  # Copy directory contents (skip any nested node_modules just in case).
  cp -R "${SRC_SKILL_DIR}/${d}/." "${DEST_SKILL_DIR}/${d}/"
  rm -rf "${DEST_SKILL_DIR}/${d}/node_modules"
  echo "  copied  ${d}/"
done

echo
echo "Done. Global delegation-router SKILL CODE refreshed at ${DEST_SKILL_DIR}."
echo
echo "REGISTRY REMINDER:"
echo "  Registry DATA lives at ~/.claude/config/model-registry.yaml (global-canonical)."
echo "  Edit the YAML there directly, then run:"
echo "    python3 ${DEST_SKILL_DIR}/scripts/build-model-registry.py"
echo "  to regenerate ~/.claude/config/model-registry.generated.json."
