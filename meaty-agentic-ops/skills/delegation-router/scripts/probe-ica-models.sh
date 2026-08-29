#!/usr/bin/env bash
# =============================================================================
# probe-ica-models.sh — ICA gateway servability drift-detector (report-only)
#
# Fetches the live model list from the ICA gateway, runs a REAL cache-busted
# probe of each model, and DIFFS the result against the tracked model registry
# (model-registry.yaml, co-located one dir up). It emits a drift report so a
# human can decide what to add / enable / disable. It NEVER edits the registry —
# scoring and enable/disable are human judgment calls (see the registry header).
#
# Descends from the original ad-hoc probe (took an API key + printed a status
# table). Hardened here with the lessons from the 2026-07-20/07-21 ICA probes:
#   • CACHE TRAP: LiteLLM caches successful responses, so the classic `"hi"` /
#     `max_tokens:5` probe returns a stale `200` for models that no longer serve.
#     We send a UNIQUE nonce every call so a stale cache hit can't fake success.
#   • REASONING-CONTROL-PARAM TRAP: the Azure-backed GPT deployments 400 when the
#     client attaches its reasoning-control param (`reasoning_effort` on chat).
#     We probe WITHOUT it — effort defaults server-side — so a model that only
#     works with the param stripped (e.g. gpt-5.6-luna-dzus via the CODEX key)
#     shows as working, matching how a param-strip proxy would reach it.
#   • KEY SCOPE MATTERS: the CC key and the CODEX key see the same /models list
#     but have different deployment access. Pass --key to probe a specific one;
#     the drift verdict is only as good as the key you probe with.
#
# Usage:
#   ./probe-ica-models.sh [--key <token>] [--key-block <NAME>] [--registry <path>]
#                         [--base <url>] [--json] [--no-diff]
#
#   --key <token>     ICA bearer token. Default: resolved from ~/.dotfiles/ICA_CLAUDE
#                     (first uncommented ICA_CLAUDE_CODE_API_KEY=, i.e. the CC key).
#   --key-block NAME  Pick a named block from ~/.dotfiles/ICA_CLAUDE instead:
#                     CC1..CC6 (Claude keys) or CODEX (the OpenAI-line key). The
#                     CODEX key is the one that reaches gpt-5.6-luna-dzus on chat.
#   --registry PATH   model-registry.yaml to diff against. Default: ../model-registry.yaml.
#   --base URL        Gateway base. Default: https://api.nextgen-beta.ica.ibm.com/ica/v1
#   --json            Emit the drift result as JSON (for tooling) instead of the table.
#   --no-diff         Just probe + print the live table; skip the registry diff.
#
# Exit code is 0 on a clean run (drift is REPORTED, not an error) and non-zero only
# on operational failure (no key, gateway unreachable, bad registry).
# =============================================================================
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="https://api.nextgen-beta.ica.ibm.com/ica/v1"
REGISTRY="${SCRIPT_DIR}/../model-registry.yaml"
ICA_DOTENV="${HOME}/.dotfiles/ICA_CLAUDE"
KEY=""
KEY_BLOCK=""
AS_JSON=0
DO_DIFF=1

# ── Args ─────────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)       KEY="$2"; shift 2 ;;
    --key-block) KEY_BLOCK="$2"; shift 2 ;;
    --registry)  REGISTRY="$2"; shift 2 ;;
    --base)      BASE_URL="$2"; shift 2 ;;
    --json)      AS_JSON=1; shift ;;
    --no-diff)   DO_DIFF=0; shift ;;
    -h|--help)   sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ── Resolve the key ────────────────────────────────────────────────────────────
if [[ -z "${KEY}" ]]; then
  if [[ -n "${ICA_PROBE_KEY:-}" ]]; then
    KEY="${ICA_PROBE_KEY}"
  elif [[ -n "${KEY_BLOCK}" && -f "${ICA_DOTENV}" ]]; then
    # Pull the (possibly commented) key from a named "## NAME" block.
    KEY="$(awk -v name="${KEY_BLOCK}" '
      # Match the FIRST whitespace-delimited token after "## " so headers with a
      # trailing description still match — e.g. "## CODEX (OpenAI-line via ICA gateway)".
      /^##/ { b=$0; sub(/^##[[:space:]]*/,"",b); split(b, parts, /[[:space:]]/); found=(toupper(parts[1])==toupper(name)) }
      found && /^#?ICA_(CLAUDE_CODE|CODEX)_API_KEY=/ { sub(/^#?ICA_(CLAUDE_CODE|CODEX)_API_KEY=/,""); print; exit }
    ' "${ICA_DOTENV}")"
  elif [[ -f "${ICA_DOTENV}" ]]; then
    KEY="$(grep -E '^ICA_CLAUDE_CODE_API_KEY=' "${ICA_DOTENV}" | head -n1 | cut -d'=' -f2-)"
  fi
fi
if [[ -z "${KEY}" ]]; then
  echo "ERROR: no ICA key. Pass --key, --key-block CODEX, set ICA_PROBE_KEY, or populate ${ICA_DOTENV}." >&2
  exit 2
fi

# ── Fetch the live model list ───────────────────────────────────────────────────
MODELS_JSON="$(curl -sf -H "Authorization: Bearer ${KEY}" "${BASE_URL}/models" 2>&1)" || {
  echo "ERROR: could not reach ${BASE_URL}/models" >&2; echo "  ${MODELS_JSON}" >&2; exit 3
}
LIVE_IDS="$(echo "${MODELS_JSON}" | jq -r '.data[].id' 2>/dev/null | sort)"
[[ -z "${LIVE_IDS}" ]] && { echo "ERROR: empty model list from gateway" >&2; exit 3; }

# ── Probe each model with a UNIQUE nonce, no reasoning param ─────────────────────
# One line per model:  "<id>\t<verdict>\t<detail>"  where verdict ∈ ok|broken
probe_all() {
  while IFS= read -r ID; do
    # Minimal cache-busted /chat/completions with NO reasoning-control param — the
    # cleanest "does this deployment respond at all" servability signal. `reasoning_effort`
    # is omitted deliberately (see header: the Azure GPT deployments 400 when it's present),
    # so a model that only works with the param stripped still reads as servable here.
    # Retry ONCE (fresh nonce) on a non-success so a transient shared-pool blip doesn't
    # fake a "broken" verdict — the false-negative that plagues single-shot probes.
    local resp="" attempt
    for attempt in 1 2; do
      local nonce="probe-${RANDOM}-${RANDOM}"
      resp="$(curl -s -X POST "${BASE_URL}/chat/completions" \
        -H "Authorization: Bearer ${KEY}" -H "Content-Type: application/json" \
        -d "{\"model\":\"${ID}\",\"messages\":[{\"role\":\"user\",\"content\":\"reply with exactly: ${nonce}\"}],\"max_tokens\":32}" 2>/dev/null)"
      echo "${resp}" | grep -q '"choices"' && break
    done
    printf '%s\t%s\n' "${ID}" "${resp}" \
      | python3 -c '
import sys,json
line=sys.stdin.readline().rstrip("\n")
mid,_,raw=line.partition("\t")
try: d=json.loads(raw)
except Exception: print(f"{mid}\tbroken\tunparseable response"); sys.exit()
if d.get("choices"):
    print(f"{mid}\tok\t")
else:
    e=d.get("error") or {}
    msg=e.get("message","") if isinstance(e,dict) else str(e)
    print(f"{mid}\tbroken\t{msg[:90].strip()}")
'
  done <<< "${LIVE_IDS}"
}

PROBE_RESULT="$(probe_all)"

# ── Diff live+probe against the registry, emit the report ────────────────────────
export PROBE_RESULT LIVE_IDS REGISTRY AS_JSON DO_DIFF BASE_URL
python3 <<'PY'
import os, sys, json

as_json = os.environ["AS_JSON"] == "1"
do_diff = os.environ["DO_DIFF"] == "1"
base    = os.environ["BASE_URL"]

# Parse probe results: id -> (verdict, detail)
probe = {}
for ln in os.environ["PROBE_RESULT"].splitlines():
    if not ln.strip(): continue
    mid, verdict, *rest = ln.split("\t")
    probe[mid] = (verdict, rest[0] if rest else "")
live = [x for x in os.environ["LIVE_IDS"].splitlines() if x.strip()]

# The `[1m]` suffix is a Claude-Code CLIENT-SIDE context hint — it is stripped on the
# wire, so the gateway /models list only ever carries the PLAIN id. Normalize it away
# before comparing, or every `[1m]` registry id reads as a false "broken"/"gone".
def strip1m(mid): return mid[:-4] if mid.endswith("[1m]") else mid

# Parse registry ICA provider ids -> enabled bool (no external deps beyond pyyaml if present)
reg_ica = {}   # model_id (as written) -> {"enabled": bool, "model_key": str, "status": str}
reg_path = os.environ["REGISTRY"]
try:
    import yaml
    reg = yaml.safe_load(open(reg_path))
    for mkey, mval in (reg.get("models") or {}).items():
        status = mval.get("status", "")
        for p in (mval.get("providers") or []):
            if p.get("provider") == "ica":
                reg_ica[p["model_id"]] = {"enabled": bool(p.get("enabled")), "model_key": mkey, "status": status}
except Exception as e:
    print(f"WARN: could not parse registry {reg_path} ({e}); diff limited to live probe.", file=sys.stderr)
    do_diff = False

reg_base_ids = {strip1m(m) for m in reg_ica}                 # registry coverage, [1m] normalized
def verdict_of(mid): return probe.get(strip1m(mid), ("broken",""))[0]  # probe by base id

# Classify drift ([1m]-normalized). De-dupe by base id so `x` and `x[1m]` don't both list.
new_models        = sorted({m for m in live if do_diff and m not in reg_base_ids})
enabled_broken    = sorted({strip1m(m) for m,meta in reg_ica.items() if meta["enabled"] and verdict_of(m) != "ok"})
disabled_working  = sorted({strip1m(m) for m,meta in reg_ica.items() if not meta["enabled"] and verdict_of(m) == "ok"})
gone_from_gateway = sorted({strip1m(m) for m in reg_ica if strip1m(m) not in live})

if as_json:
    print(json.dumps({
        "base": base,
        "live_count": len(live),
        "probe": {m:{"verdict":v,"detail":d} for m,(v,d) in probe.items()},
        "drift": {
            "new_models_not_in_registry": sorted(new_models),
            "registry_enabled_but_broken": sorted(enabled_broken),
            "registry_disabled_but_working": sorted(disabled_working),
            "registry_ica_id_gone_from_gateway": sorted(gone_from_gateway),
        },
    }, indent=2))
    sys.exit(0)

# Human table
C = {"ok":"\033[0;32m", "broken":"\033[0;31m", "hdr":"\033[1;36m", "warn":"\033[1;33m", "b":"\033[1m", "r":"\033[0m"}
print(f"\n{C['hdr']}{C['b']}ICA gateway servability probe{C['r']}  ({base})")
print(f"{C['hdr']}live models: {len(live)}   registry ICA ids: {len(reg_ica)}{C['r']}\n")
print(f"{C['b']}{'MODEL':<40} {'PROBE':<9} {'REGISTRY':<22} DETAIL{C['r']}")
print("─"*100)
# Map each registry base id to its meta (prefer the [1m] variant if both exist).
reg_by_base = {}
for mid, meta in reg_ica.items():
    b = strip1m(mid)
    if b not in reg_by_base or mid.endswith("[1m]"):
        reg_by_base[b] = meta
for m in live:
    v,d = probe.get(m, ("broken","(not probed)"))
    vcol = C['ok'] if v=="ok" else C['broken']
    if m in reg_by_base:
        reg = f"{'enabled' if reg_by_base[m]['enabled'] else 'disabled'}/{reg_by_base[m]['status'] or '-'}"
    else:
        reg = "— NOT IN REGISTRY"
    print(f"{m:<40} {vcol}{v:<9}{C['r']} {reg:<22} {d[:40]}")

if do_diff:
    print("\n" + "─"*100)
    print(f"{C['b']}DRIFT (report only — no registry edits made):{C['r']}")
    def sect(title, items, col):
        if items:
            print(f"  {col}{title}{C['r']}")
            for it in sorted(items): print(f"    • {it}")
    sect("NEW on gateway, absent from registry (consider adding):", new_models, C['warn'])
    sect("registry ENABLED but probe BROKEN (consider disabling):", enabled_broken, C['broken'])
    sect("registry DISABLED but probe OK (candidate to enable — verify the executor path first):", disabled_working, C['warn'])
    sect("registry ICA id GONE from gateway /models (stale):", gone_from_gateway, C['warn'])
    if not (new_models or enabled_broken or disabled_working or gone_from_gateway):
        print(f"  {C['ok']}no drift — registry ICA lanes match the gateway.{C['r']}")
    print(f"\n  {C['b']}NOTE:{C['r']} this probes /chat/completions with the given key and NO reasoning param.")
    print( "        GPT models that need the reasoning-control param stripped (or the CODEX key)")
    print( "        may show OK here yet still 400 via ica-claude.sh — verify the executor path")
    print( "        before enabling. See references/ica-models.md and the registry header.")
print()
PY
