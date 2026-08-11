#!/usr/bin/env bash
#
# sync-to-global.sh — Deploy the delegation-router SKILL (code + registry data)
# from this authoritative MeatySkills copy to the global ~/.claude locations.
#
# AUTHORITATIVE SOURCE: the MeatySkills repo skill dir
#   meaty-agentic-ops/skills/delegation-router/
#     - resolver.js, routing-record.js, audit-log.js  (pure engine)
#     - task-class-vocabulary.js + versioned vocabulary/feedback contract
#     - resolve-cli.js  (headless CLI wrapper over resolve() — Codex/non-CC consumption)
#     - SKILL.md / SPEC.md / README.md / CHANGELOG.md + references/ + scripts/
#     - model-registry.yaml (+ model-registry.generated.json)  ← TRACKED registry source
#     - use-case-rankings.yaml  ← TRACKED grounded-evidence layer (co-located, rf-provenanced)
#
# ALSO DEPLOYS (sibling skill in this same MeatySkills repo):
#   meaty-agentic-ops/skills/model-playbook/  ← per-model/per-route playbook, referenced from
#     model-registry.yaml's `playbook_ref` fields. Deployed to ~/.claude/skills/ the same way
#     as the delegation-router code (best-effort: a missing source dir is a WARN, not a failure,
#     so this script stays forward-compatible while that skill is still being authored).
#
# WHAT THIS SCRIPT DOES (Option A — registry is co-located + tracked with the artifact):
#   1. Copies the engine code into ~/.claude/skills/delegation-router/.
#   2. Deploys the TRACKED registry (model-registry.yaml) to ~/.claude/config/ and
#      regenerates ~/.claude/config/model-registry.generated.json from it.
#   3. Deploys the TRACKED use-case-rankings.yaml alongside model-registry.yaml in
#      ~/.claude/config/ (same target dir, verbatim copy — no derived JSON for this one).
#   4. Deploys the sibling model-playbook skill into ~/.claude/skills/model-playbook/.
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

# --- Sibling model-playbook skill (co-located in this repo, deployed alongside) ---
SRC_PLAYBOOK_DIR="$(cd "${SRC_SKILL_DIR}/.." && pwd)/model-playbook"
DEST_PLAYBOOK_DIR="${HOME}/.claude/skills/model-playbook"

# --- Engine files to copy (no tests/, no node_modules) ---
SKILL_FILES=(
  resolver.js
  routing-record.js
  audit-log.js
  routing-feedback.js
  resolve-cli.js
  log-cli.js
  task-class-vocabulary.js
  task-class-vocabulary.v1.json
  routing-feedback-contract.v1.json
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

# --- The tracked grounded-evidence layer (co-located in this skill dir) ---
SRC_USE_CASE_RANKINGS_YAML="${SRC_SKILL_DIR}/use-case-rankings.yaml"

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
mkdir -p "${DEST_CONFIG_DIR}"

# Is the global skill dir a SYMLINK back to this source dir? Since the 2026-07-30
# globals-symlinking pass, ~/.claude/skills/delegation-router is a symlink to this repo,
# so the code copy below is a no-op BY CONSTRUCTION — and worse, BSD `cp -f src dst`
# where both resolve to the same inode FAILS with "are identical (not copied)". Under
# `set -e` that aborted the script at the very first file, silently skipping the
# registry deploy further down. Net effect: ~/.claude/config/model-registry.yaml froze
# on 2026-07-29 while the resolver kept reading it. Detect and skip instead of dying.
# (Found + fixed 2026-07-31 while deploying the ICA Opus 5 registry change.)
SKIP_CODE_COPY=0
if [[ -L "${DEST_SKILL_DIR}" ]]; then
  DEST_REAL="$(cd "${DEST_SKILL_DIR}" 2>/dev/null && pwd -P || true)"
  if [[ -n "${DEST_REAL}" && "${DEST_REAL}" == "$(cd "${SRC_SKILL_DIR}" && pwd -P)" ]]; then
    SKIP_CODE_COPY=1
  fi
fi

if [[ "${SKIP_CODE_COPY}" == "1" ]]; then
  echo "  dest skill dir is a SYMLINK to the source — code already live, skipping code copy"
else
  mkdir -p "${DEST_SKILL_DIR}"

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
fi

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

# --- Deploy the tracked grounded-evidence layer alongside model-registry.yaml ---
if [[ -f "${SRC_USE_CASE_RANKINGS_YAML}" ]]; then
  cp -f "${SRC_USE_CASE_RANKINGS_YAML}" "${DEST_CONFIG_DIR}/use-case-rankings.yaml"
  echo "  deployed use-case-rankings.yaml -> ${DEST_CONFIG_DIR}/"
else
  echo "  WARN: no tracked use-case-rankings.yaml at ${SRC_USE_CASE_RANKINGS_YAML} — skipping (not yet authored?)" >&2
fi

# --- Deploy the sibling model-playbook skill (best-effort — forward-compatible) ---
if [[ -d "${SRC_PLAYBOOK_DIR}" ]]; then
  mkdir -p "${DEST_PLAYBOOK_DIR}"
  rm -rf "${DEST_PLAYBOOK_DIR:?}"/*
  cp -R "${SRC_PLAYBOOK_DIR}/." "${DEST_PLAYBOOK_DIR}/"
  rm -rf "${DEST_PLAYBOOK_DIR}/node_modules"
  echo "  deployed model-playbook skill -> ${DEST_PLAYBOOK_DIR}/"
else
  echo "  WARN: no sibling model-playbook skill at ${SRC_PLAYBOOK_DIR} — skipping (not yet authored?)" >&2
fi

echo
echo "Done. Global delegation-router refreshed at ${DEST_SKILL_DIR}"
echo "      registry deployed to ${DEST_CONFIG_DIR}/model-registry.{yaml,generated.json},"
echo "      use-case-rankings.yaml deployed to ${DEST_CONFIG_DIR}/,"
echo "      and model-playbook deployed to ${DEST_PLAYBOOK_DIR}."
echo
echo "REMINDER: edit the registry HERE (${SRC_REGISTRY_YAML}) and commit it — it is the"
echo "tracked source. Re-run this script (or /redeploy) to propagate to global + the node."
