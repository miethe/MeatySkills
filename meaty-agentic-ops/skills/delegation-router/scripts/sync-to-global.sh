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
# WHAT THIS SCRIPT DOES (as of 2026-08-12 — engine-code deploy RETIRED)
#   1. Deploys the TRACKED registry (model-registry.yaml) to ~/.claude/config/ and
#      regenerates ~/.claude/config/model-registry.generated.json from it.
#   2. Deploys the TRACKED use-case-rankings.yaml alongside it.
#
#   It NO LONGER copies engine code, and NO LONGER touches ~/.claude/skills/. That is
#   SkillMeat's job now:
#
#      skillmeat deploy delegation-router model-playbook --project ~ --apply-recipe
#
#   (~ is registered as the SkillMeat system/global project: `skillmeat system show`.)
#   The same config placement this script does by hand is also carried declaratively by
#   this artifact's recipe.toml, so a SkillMeat deploy is self-sufficient; this script
#   remains as a registry-only manual path.
#
# WHY THE CODE DEPLOY WAS RETIRED (node_01KZS86MTR0WDPXT10EEXNVC2D)
#   ~/.claude/skills/delegation-router was a SYMLINK into this repo's live WORKING TREE, so
#   the globally deployed router — for every project on the machine — was whatever branch
#   happened to be checked out here. A `git checkout` was an undeclared global deploy. Worse,
#   two write paths in this script would write INTO that working tree when run from a git
#   worktree (DEST_REAL != SRC_SKILL_DIR, so the old SKIP_CODE_COPY guard did not fire):
#     - the engine-file `cp -f` loop, plus `rm -rf "${DEST_SKILL_DIR}/references|scripts"`
#     - the model-playbook block's `rm -rf "${DEST_PLAYBOOK_DIR:?}"/*`, which had NO symlink
#       guard at all and so fired even when SKIP_CODE_COPY=1
#   Both would delete and replace TRACKED files on whatever branch another agent had checked
#   out. Rather than add a third guard to a hand-rolled deploy path, the path is gone: refuse
#   to write into any git working tree, and let SkillMeat own artifact deployment.

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

# --- The only sources this script deploys ---
# NOTE: there is deliberately no hand-maintained engine-file list here any more. The old
# SKILL_FILES array had to be updated by hand every time the engine gained a file, and it
# silently did not list routing-feedback.js / log-cli.js / entry-key.js / feedback-cli.js —
# so a deploy that replaced the symlink with real copies would have shipped a router with no
# feedback engine at all. SkillMeat deploys the artifact DIRECTORY, so the list is obsolete
# rather than merely out of date.
# --- The tracked registry source (co-located in this skill dir) ---
SRC_REGISTRY_YAML="${SRC_SKILL_DIR}/model-registry.yaml"
BUILD_SCRIPT="${SRC_SKILL_DIR}/scripts/build-model-registry.py"

# --- The tracked grounded-evidence layer (co-located in this skill dir) ---
SRC_USE_CASE_RANKINGS_YAML="${SRC_SKILL_DIR}/use-case-rankings.yaml"

# --- Validate the sources this script actually deploys ---
if [[ ! -f "${SRC_REGISTRY_YAML}" ]]; then
  echo "ERROR: missing tracked registry source: ${SRC_REGISTRY_YAML}" >&2
  exit 1
fi

echo "delegation-router :: global sync (TRACKED REGISTRY ONLY — code is SkillMeat's job)"
echo "  source skill : ${SRC_SKILL_DIR}"
echo "  dest  skill  : ${DEST_SKILL_DIR} (NOT written here)"
echo "  dest  config : ${DEST_CONFIG_DIR} (model-registry.{yaml,generated.json})"
echo

# --- Prepare destinations ---
mkdir -p "${DEST_CONFIG_DIR}"

# --- REFUSE to write into any git working tree (AC4) -----------------------------
# A destination that resolves inside a git worktree is never a deploy target: writing there
# mutates tracked files on whatever branch is checked out, which is a cross-branch write into
# someone else's work. Checked by walking up from the resolved path looking for .git (a dir in
# a primary checkout, a FILE in a linked worktree — both count).
refuse_if_git_worktree() {
  local label="$1" path="$2" probe
  # Resolve through symlinks; for a not-yet-existing path, resolve its nearest existing parent.
  probe="${path}"
  while [[ -n "${probe}" && ! -e "${probe}" ]]; do probe="$(dirname "${probe}")"; done
  probe="$(cd "${probe}" 2>/dev/null && pwd -P || echo "${probe}")"
  local d="${probe}"
  while [[ -n "${d}" && "${d}" != "/" ]]; do
    if [[ -e "${d}/.git" ]]; then
      echo "ERROR: refusing to deploy ${label} into a git working tree." >&2
      echo "         target   : ${path}" >&2
      echo "         resolves : ${probe}" >&2
      echo "         worktree : ${d}  (branch: $(git -C "${d}" rev-parse --abbrev-ref HEAD 2>/dev/null | tr -d '\n' || true))" >&2
      echo "" >&2
      echo "       Writing here would replace TRACKED files on whatever branch that checkout" >&2
      echo "       holds. If ${label} is a symlink into a repo, remove the symlink and deploy" >&2
      echo "       real copies through SkillMeat instead:" >&2
      echo "" >&2
      echo "         rm ${path}" >&2
      echo "         skillmeat deploy delegation-router model-playbook --project ~ --apply-recipe" >&2
      echo "" >&2
      echo "       (node_01KZS86MTR0WDPXT10EEXNVC2D)" >&2
      exit 1
    fi
    d="$(dirname "${d}")"
  done
}

refuse_if_git_worktree "the global config dir" "${DEST_CONFIG_DIR}"

# --- Engine code + model-playbook: deployed by SkillMeat, not here ----------------
# Deliberately not a warning that can be ignored: if a symlink is still in place, the
# refusal above fires for the config dir, and these two are simply not this script's job.
if [[ -e "${DEST_SKILL_DIR}" || -L "${DEST_SKILL_DIR}" ]]; then
  if [[ -L "${DEST_SKILL_DIR}" ]]; then
    echo "NOTE: ${DEST_SKILL_DIR} is still a SYMLINK (-> $(readlink "${DEST_SKILL_DIR}"))." >&2
    echo "      The deployed router is therefore pinned to that working tree's current branch." >&2
    echo "      Retire it:  rm ${DEST_SKILL_DIR} && skillmeat deploy delegation-router \\" >&2
    echo "                    model-playbook --project ~ --apply-recipe" >&2
  fi
fi
echo "  engine code  : NOT deployed by this script (SkillMeat owns it)"
echo "                 skillmeat deploy delegation-router model-playbook --project ~ --apply-recipe"
echo

# --- Deploy the tracked registry to the global config dir + regenerate JSON ---
# refuse_if_git_worktree above has already guaranteed DEST_CONFIG_DIR is not inside a repo.
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

# --- Deploy the tracked grounded-evidence layer alongside model-registry.yaml ---
if [[ -f "${SRC_USE_CASE_RANKINGS_YAML}" ]]; then
  cp -f "${SRC_USE_CASE_RANKINGS_YAML}" "${DEST_CONFIG_DIR}/use-case-rankings.yaml"
  echo "  deployed use-case-rankings.yaml -> ${DEST_CONFIG_DIR}/"
else
  echo "  WARN: no tracked use-case-rankings.yaml at ${SRC_USE_CASE_RANKINGS_YAML} — skipping" >&2
fi

echo
echo "Done. Registry deployed to ${DEST_CONFIG_DIR}/model-registry.{yaml,generated.json}"
echo "      and use-case-rankings.yaml deployed to ${DEST_CONFIG_DIR}/."
echo
echo "Engine code is NOT deployed here. To deploy/refresh the skills themselves:"
echo "      skillmeat deploy delegation-router model-playbook --project ~ --apply-recipe"
echo
echo "REMINDER: edit the registry HERE (${SRC_REGISTRY_YAML}) and commit it — it is the"
echo "tracked source. Re-run this script (or the SkillMeat deploy above) to propagate."
