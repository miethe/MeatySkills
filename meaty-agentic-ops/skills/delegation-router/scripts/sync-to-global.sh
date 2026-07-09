#!/usr/bin/env bash
#
# sync-to-global.sh — Deploy the delegation-router SKILL (code + registry data)
# from this authoritative MeatySkills copy to the global ~/.claude locations.
#
# AUTHORITATIVE SOURCE: the MeatySkills repo skill dir
#   meaty-agentic-ops/skills/delegation-router/
#     - resolver.js, routing-record.js, audit-log.js  (pure engine)
#     - SKILL.md / SPEC.md / README.md / CHANGELOG.md + references/ + scripts/
#     - model-registry.yaml (+ model-registry.generated.json)  ← TRACKED registry source
#
# WHAT THIS SCRIPT DOES (Option A — registry is co-located + tracked with the artifact):
#   1. Copies the engine code into ~/.claude/skills/delegation-router/.
#   2. Deploys the TRACKED registry (model-registry.yaml) to ~/.claude/config/ and
#      regenerates ~/.claude/config/model-registry.generated.json from it.
#
# WHY REGISTRY-IS-TRACKED-HERE (2026-07-09):
#   The registry is now version-controlled alongside the router it drives — the same
#   "edit the upstream, never the deployed copy" rule as every other artifact. The
#   resolver still READS ~/.claude/config/model-registry.{yaml,generated.json} at runtime
#   (its 3-tier lookup is unchanged); this script is what lands the tracked source there.
#   Edit model-registry.yaml HERE (commit it), then run this script to deploy.
#
#   ⚠️ Do NOT hand-edit ~/.claude/config/model-registry.yaml — it is now a DEPLOYED
#   artifact. Edits belong in this repo's model-registry.yaml so they are tracked and
#   propagate to every host via this script (or /redeploy).
#
# PER-PROJECT OVERRIDES still work: the resolver's Tier-2 lookup reads
#   <cwd>/.claude/config/model-registry.* when a repo wants a local override. Those are
#   opt-in overrides, not the canonical source.
#
# tests/ and the dev-only node_modules are intentionally NOT copied — the global
# resolver falls back to model-registry.generated.json when js-yaml is absent.
#
# Idempotent: safe to re-run. Edit the skill + registry here (authoritative), commit,
# then re-run this script to refresh the global copies.
#
set -euo pipefail

# --- Resolve source dir relative to this script ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/ lives inside the skill dir; the skill dir is its parent.
SRC_SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

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

# --- The tracked registry source (co-located in this skill dir) ---
SRC_REGISTRY_YAML="${SRC_SKILL_DIR}/model-registry.yaml"
BUILD_SCRIPT="${SRC_SKILL_DIR}/scripts/build-model-registry.py"

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

echo "delegation-router :: global sync (code + tracked registry)"
echo "  source skill : ${SRC_SKILL_DIR}"
echo "  dest  skill  : ${DEST_SKILL_DIR}"
echo "  dest  config : ${DEST_CONFIG_DIR} (model-registry.{yaml,generated.json})"
echo

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

# --- Deploy the tracked registry to the global config dir + regenerate JSON ---
if [[ -f "${SRC_REGISTRY_YAML}" ]]; then
  cp -f "${SRC_REGISTRY_YAML}" "${DEST_CONFIG_DIR}/model-registry.yaml"
  echo "  deployed model-registry.yaml -> ${DEST_CONFIG_DIR}/"
  if command -v python3 >/dev/null 2>&1 && [[ -f "${BUILD_SCRIPT}" ]]; then
    python3 "${BUILD_SCRIPT}" \
      --in "${DEST_CONFIG_DIR}/model-registry.yaml" \
      --out "${DEST_CONFIG_DIR}/model-registry.generated.json"
    echo "  regenerated model-registry.generated.json (from deployed YAML)"
  else
    echo "  WARN: python3 or build-model-registry.py missing — copying tracked JSON verbatim" >&2
    [[ -f "${SRC_SKILL_DIR}/model-registry.generated.json" ]] && \
      cp -f "${SRC_SKILL_DIR}/model-registry.generated.json" "${DEST_CONFIG_DIR}/model-registry.generated.json"
  fi
else
  echo "  WARN: no tracked model-registry.yaml at ${SRC_REGISTRY_YAML} — skipping registry deploy" >&2
fi

echo
echo "Done. Global delegation-router refreshed at ${DEST_SKILL_DIR}"
echo "      and registry deployed to ${DEST_CONFIG_DIR}/model-registry.{yaml,generated.json}."
echo
echo "REMINDER: edit the registry HERE (${SRC_REGISTRY_YAML}) and commit it — it is the"
echo "tracked source. Re-run this script (or /redeploy) to propagate to global + the node."
