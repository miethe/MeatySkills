#!/usr/bin/env bash
# =============================================================================
# provision-artifacts.sh — Dev-Execution Pre-Execution Artifact Provisioning Gate
# =============================================================================
#
# PURPOSE:
#   Non-blocking pre-execution gate that ensures every artifact a plan needs
#   (skills / agents / commands / context / MCP / workflows) is present in the
#   repo BEFORE the execution graph is built — deploying in-catalog gaps from
#   SkillMeat, skipping inactive (linked-but-not-deployed) manifest entries, and
#   hard-failing loudly only when a NEEDED artifact exists nowhere.
#
#   Composes ONLY existing SkillMeat CLI primitives (show/deploy/undeploy). The
#   real work is in the co-located engine `provision_artifacts.py`; this wrapper
#   owns the master-switch + binding guard + non-fatal contract, exactly mirroring
#   sdlc-sync.sh. Design: PRD dynamic-artifact-provisioning.md;
#   rule .claude/rules/artifact-provisioning.md.
#
# TRIGGER REGISTRATION:
#   Called at the FIRST pre-flight step of /dev:execute-{plan,contract,phase} and
#   from dev-execution modes (phase-execution.md, plan-execution.md), before any
#   task/graph construction:
#     PROVISION_PLAN_FILE="docs/.../plan.md" PROVISION_SCOPE="plan:<slug>" \
#       .claude/skills/dev-execution/hooks/provision-artifacts.sh
#   Teardown at end-of-feature:
#     PROVISION_TEARDOWN=1 PROVISION_SCOPE="plan:<slug>" \
#       .claude/skills/dev-execution/hooks/provision-artifacts.sh
#
# ENVIRONMENT:
#   AOS_ARTIFACT_PROVISION — ON BY DEFAULT. Only an explicit falsy value
#                            (0/false/no/off) disables. Mirrors INTENTTREE_SDLC_SYNC.
#   PROVISION_PLAN_FILE    — plan file whose required_artifacts to resolve. Optional.
#   PROVISION_MANIFEST     — path to .claude/aos-artifacts.yaml. Default: <project>/.claude/aos-artifacts.yaml
#   PROVISION_PROJECT      — project root. Default: cwd (".").
#   PROVISION_MODE         — auto | sign-off | off. Default: manifest policy.mode, else auto.
#   PROVISION_SCOPE        — ephemeral scope for provision/teardown, e.g. plan:<slug>.
#   PROVISION_CHECK        — "1" → report only (dry-run), exit 2 on any needed gap.
#   PROVISION_TEARDOWN     — "1" → teardown plan-scoped ephemerals (requires PROVISION_SCOPE).
#   PROVISION_JSON         — "1" → emit the frozen --json contract to stdout.
#   SKILLMEAT_BIN          — skillmeat CLI path override (tests point this at a fake).
#
# EXIT CONTRACT (mirrors sdlc-sync.sh's non-fatal discipline, with ONE exception):
#   * Engine exit 2 (needed+unsatisfiable, or gaps under sign-off/off/--check) is a
#     CORRECTNESS gate → propagated as nonzero so the orchestrator halts.
#   * Any OTHER nonzero (engine crash, python/pyyaml missing, infra) is INFRA →
#     logged and swallowed → exit 0. A provisioning-infra failure never blocks a run.
#   * No binding (no manifest AND no plan required_artifacts) → silent no-op, exit 0.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# ---------------------------------------------------------------------------
case "$(printf '%s' "${AOS_ARTIFACT_PROVISION:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) exit 0 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="${HERE}/provision_artifacts.py"
PROJECT="${PROVISION_PROJECT:-.}"
MANIFEST="${PROVISION_MANIFEST:-${PROJECT}/.claude/aos-artifacts.yaml}"

# ---------------------------------------------------------------------------
# Guard: binding must exist. No manifest AND no plan required_artifacts → no-op.
# (Keeps default-on silent in repos with no AOS artifact presence.)
# ---------------------------------------------------------------------------
HAS_MANIFEST=0
[ -f "${MANIFEST}" ] && HAS_MANIFEST=1
HAS_PLAN_REQS=0
if [ -n "${PROVISION_PLAN_FILE:-}" ] && [ -f "${PROVISION_PLAN_FILE}" ] \
    && grep -qE '^required_artifacts:' "${PROVISION_PLAN_FILE}" 2>/dev/null; then
    HAS_PLAN_REQS=1
fi
if [ "${HAS_MANIFEST}" -eq 0 ] && [ "${HAS_PLAN_REQS}" -eq 0 ] && [ "${PROVISION_TEARDOWN:-0}" != "1" ]; then
    exit 0
fi

if [ ! -f "${ENGINE}" ]; then
    echo "[provision-artifacts] engine not found: ${ENGINE} — skipping (non-fatal)" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Credential + CLI resolution — this is what makes the correctness gate REAL.
#
# The engine shells `skillmeat` to classify a declared artifact. Without the PAT it gets
# HTTP 401, which is correctly treated as "availability UNKNOWN" (never as "absent") — so
# the exit-2 hard gate silently never fires, in exactly the case it exists for. Measured
# live: the gate was OFF on the production path for this reason while an interactive shell
# authenticated fine — nothing in dev-execution sourced the credential, and a bare
# `skillmeat` under this wrapper's python3 resolves to a pyenv shim rather than the AOS one.
#
# So: source the canonical secrets file (the standing rule is that a SkillMeat 401 is a
# missing-credential bug to be fixed by SOURCING it, never by falling back), and prefer the
# AOS shim every other caller uses. Both are best-effort and never fatal:
#   * a caller-supplied SKILLMEAT_BIN always wins (tests point it at a fake),
#   * an already-exported SKILLMEAT_PAT always wins (never clobber the environment),
#   * a missing secrets file or shim leaves things exactly as they were.
# ---------------------------------------------------------------------------
AOS_SECRETS="${AOS_SECRETS_ENV:-${HOME}/.config/aos/secrets.env}"
if [ -r "${AOS_SECRETS}" ]; then
    # Deliberately NOT `set -a; . file`. That exports everything in the file AND overwrites
    # values the caller already set — it silently clobbered a caller-supplied
    # SKILLMEAT_API_URL during verification, so a test pointed at an unreachable host quietly
    # hit the real node instead. Fill only SKILLMEAT_* keys, and only when unset/empty, so an
    # explicit caller value and an already-loaded credential both win.
    while IFS= read -r _line || [ -n "${_line}" ]; do
        _line="${_line#"${_line%%[![:space:]]*}"}"          # ltrim
        case "${_line}" in ''|'#'*) continue ;; esac
        _line="${_line#export }"
        _key="${_line%%=*}"
        case "${_key}" in
            SKILLMEAT_*) ;;                                  # in scope
            *) continue ;;                                   # not ours to touch
        esac
        case "${_key}" in ''|*[!A-Za-z0-9_]*) continue ;; esac
        [ -n "${!_key:-}" ] && continue                      # caller/env wins
        _val="${_line#*=}"
        _val="${_val%\"}"; _val="${_val#\"}"
        _val="${_val%\'}"; _val="${_val#\'}"
        export "${_key}=${_val}"
    done < "${AOS_SECRETS}"
    unset _line _key _val
fi
if [ -z "${SKILLMEAT_BIN:-}" ] && [ -x "${HOME}/.aos/shims/skillmeat" ]; then
    export SKILLMEAT_BIN="${HOME}/.aos/shims/skillmeat"
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "[provision-artifacts] python3 not found — skipping (non-fatal)" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Build engine args
# ---------------------------------------------------------------------------
ARGS=("${ENGINE}" "--project" "${PROJECT}" "--manifest" "${MANIFEST}")
[ -n "${PROVISION_PLAN_FILE:-}" ] && ARGS+=("--plan" "${PROVISION_PLAN_FILE}")
[ -n "${PROVISION_MODE:-}" ] && ARGS+=("--mode" "${PROVISION_MODE}")
[ -n "${PROVISION_SCOPE:-}" ] && ARGS+=("--scope" "${PROVISION_SCOPE}")
[ "${PROVISION_CHECK:-0}" = "1" ] && ARGS+=("--check")
[ "${PROVISION_TEARDOWN:-0}" = "1" ] && ARGS+=("--teardown")
[ "${PROVISION_JSON:-0}" = "1" ] && ARGS+=("--json")

# ---------------------------------------------------------------------------
# Run the engine. rc==2 is the correctness gate (propagate); everything else
# nonzero is infra (swallow → exit 0).
# ---------------------------------------------------------------------------
set +e
python3 "${ARGS[@]}"
rc=$?
set -e

if [ "${rc}" -eq 0 ]; then
    exit 0
elif [ "${rc}" -eq 2 ]; then
    echo "[provision-artifacts] required artifacts missing/unsatisfiable — halting before execution (exit 2)" >&2
    exit 2
else
    echo "[provision-artifacts] engine error (rc=${rc}) — non-fatal, continuing" >&2
    exit 0
fi
