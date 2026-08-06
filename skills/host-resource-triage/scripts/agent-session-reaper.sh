#!/usr/bin/env bash
# agent-session-reaper.sh — reclaim memory from accumulated long-lived CLI sessions.
#
# THE PATTERN
#   Interactive agent/editor CLI sessions accumulate silently in terminal panes. Nothing
#   crashes and nothing alerts, so the total goes unnoticed. Measured on one workstation:
#   37 sessions / 13.0 GB RSS / oldest 4 days, across 17 project dirs (10 of them stale git
#   worktrees) — and 172 processes once children were counted (MCP/language servers plus
#   multi-day ssh tunnels). That was enough to exhaust 64 GB and drive the host into swap.
#
# SAFETY PROPERTIES (do not remove any of these if you adapt this script)
#   1. Dry-run by default — acting requires --kill.
#   2. Self-protecting — walks the ppid chain and excludes the invoking session.
#   3. Children reaped with parents — never orphaned.
#   4. SIGTERM -> grace -> SIGKILL only for stragglers.
#   5. Age threshold, not "everything".
#   6. Prints the reclaimable total BEFORE acting, so a human can weigh it.
#
# THE DECISION IS THE HUMAN'S. Sessions may hold unsaved work or an in-flight task. Produce
# the list and the dry-run; let the operator choose. This holds especially when the numbers
# are damning — a large total means a lot of someone's work is in there.
#
# USAGE
#   ./agent-session-reaper.sh                                  # dry run, >12h, binary=claude
#   ./agent-session-reaper.sh --binary node --older-than 24    # dry run, different binary
#   ./agent-session-reaper.sh --older-than 12 --kill           # act
#   ./agent-session-reaper.sh --all --kill                     # everything but this session
#
set -uo pipefail

BINARY="claude"
OLDER_THAN_H=12
DO_KILL=0
REAP_ALL=0
GRACE_S=8

usage() { sed -n '2,33p' "$0"; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --binary)     BINARY="${2:?--binary needs a process name}"; shift 2 ;;
    --older-than) OLDER_THAN_H="${2:?--older-than needs hours}"; shift 2 ;;
    --grace)      GRACE_S="${2:?--grace needs seconds}"; shift 2 ;;
    --kill)       DO_KILL=1; shift ;;
    --all)        REAP_ALL=1; shift ;;
    -h|--help)    usage 0 ;;
    *) echo "unknown arg: $1" >&2; usage 2 ;;
  esac
done

case "$OLDER_THAN_H" in (*[!0-9]*|'') echo "--older-than must be an integer" >&2; exit 2 ;; esac

# --- 1. self-protection: find our own session and never signal it ---------------
self_pid=""
p=$$
while [ "${p:-1}" -gt 1 ]; do
  comm=$(ps -o comm= -p "$p" 2>/dev/null | xargs 2>/dev/null || true)
  case "$comm" in *"$BINARY"*) self_pid="$p"; break ;; esac
  p=$(ps -o ppid= -p "$p" 2>/dev/null | xargs 2>/dev/null || echo 1)
  [ -n "${p:-}" ] || p=1
done
if [ -n "$self_pid" ]; then
  echo "self session: pid $self_pid (PROTECTED — will never be signalled)"
else
  echo "self session: none detected (not running under '$BINARY')"
fi

# --- 2. elapsed-time parser: ps etime is [[dd-]hh:]mm:ss ------------------------
etime_to_s() {
  awk -F'[-:]' '{
    if (NF==4)      print $1*86400 + $2*3600 + $3*60 + $4;
    else if (NF==3) print $1*3600 + $2*60 + $3;
    else if (NF==2) print $1*60 + $2;
    else            print 0
  }' <<<"$1"
}

cutoff_s=$(( OLDER_THAN_H * 3600 ))
total_kb=0
count=0
VICTIMS=()

printf '\n%-8s %-7s %-9s %s\n' PID AGE RSS_MB WHERE
printf '%s\n' "--------------------------------------------------------------------------"

while read -r pid etime rss comm; do
  [ -n "${pid:-}" ] || continue
  [ "$pid" = "$self_pid" ] && continue
  # exact-ish match on the session binary; skip our own grep/awk pipeline members
  case "$comm" in *"$BINARY"*) : ;; *) continue ;; esac

  age_s=$(etime_to_s "$etime")
  if [ "$REAP_ALL" -eq 0 ] && [ "$age_s" -lt "$cutoff_s" ]; then continue; fi

  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's|^n||p' | head -1)
  label="${cwd:-$comm}"
  # shorten to the interesting tail of the path
  label="${label##*/development/}"

  printf '%-8s %-7s %-9s %s\n' "$pid" "$(( age_s / 3600 ))h" "$(( rss / 1024 ))" "$label"
  VICTIMS+=("$pid")
  total_kb=$(( total_kb + rss ))
  count=$(( count + 1 ))
done < <(ps -Ao pid=,etime=,rss=,comm= 2>/dev/null)

echo
if [ "$count" -eq 0 ]; then
  echo "no '$BINARY' sessions older than ${OLDER_THAN_H}h — nothing to do."
  exit 0
fi
printf 'sessions: %d    reclaimable (RSS): %.2f GB\n' "$count" \
  "$(awk -v k="$total_kb" 'BEGIN{printf "%.2f", k/1048576}')"
echo "note: RSS understates if pages are already compressed/swapped."

# --- 3. collect full descendant sets ------------------------------------------
descendants_of() {
  local queue=("$1") cur kids k
  while [ ${#queue[@]} -gt 0 ]; do
    cur="${queue[0]}"; queue=("${queue[@]:1}")
    kids=$(pgrep -P "$cur" 2>/dev/null || true)
    for k in $kids; do
      [ "$k" = "$self_pid" ] && continue
      echo "$k"
      queue+=("$k")
    done
  done
}

ALL=()
for v in "${VICTIMS[@]}"; do
  ALL+=("$v")
  while read -r d; do [ -n "$d" ] && ALL+=("$d"); done < <(descendants_of "$v")
done
echo "including children (MCP/language servers, ssh tunnels): ${#ALL[@]} processes in scope"

if [ "$DO_KILL" -eq 0 ]; then
  echo
  echo "DRY RUN — nothing signalled. Re-run with --kill to reap."
  exit 0
fi

# --- 4. TERM -> grace -> KILL --------------------------------------------------
echo
echo "sending SIGTERM to ${#ALL[@]} processes..."
for p in "${ALL[@]}"; do kill -TERM "$p" 2>/dev/null || true; done
sleep "$GRACE_S"

stragglers=0
for p in "${ALL[@]}"; do
  if kill -0 "$p" 2>/dev/null; then
    kill -KILL "$p" 2>/dev/null || true
    stragglers=$(( stragglers + 1 ))
  fi
done
[ "$stragglers" -gt 0 ] && echo "SIGKILLed $stragglers straggler(s) after ${GRACE_S}s grace"

echo
echo "memory after (compare against your pre-fix snapshot):"
if [ "$(uname -s)" = "Darwin" ]; then
  vm_stat | awk '
    /page size of/{ps=$8} /Pages free/{f=$3} /occupied by compressor/{c=$5}
    END{gsub(/\./,"",f); gsub(/\./,"",c);
        printf "  free=%.2f GB  compressor=%.2f GB\n", f*ps/1073741824, c*ps/1073741824}'
  sysctl -n vm.swapusage | sed 's/^/  swap: /'
else
  free -h | sed 's/^/  /'
fi
echo "  (load average lags minutes behind recovery — do not judge the fix by it)"
