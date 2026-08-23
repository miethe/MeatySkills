#!/usr/bin/env bash
# Negative control for node_01M0QXD9B07HDPT298NSSS0W8G. This FAILS against the
# pre-fix hook: agent:hop-* has no session anchor, so its cadence survives the
# dead throwaway process until the 1440-minute cap.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HOOK="$HERE/../itt-claim.sh"
TMP="$(mktemp -d)"
anchor=""
renew_pid=""
trap 'if [ -n "${renew_pid:-}" ]; then kill "$renew_pid" 2>/dev/null || true; fi; if [ -n "${anchor:-}" ]; then kill "$anchor" 2>/dev/null || true; fi; rm -rf "$TMP"' EXIT

fail() { echo "FAIL $*"; exit 1; }

cat >"$TMP/stub-curl" <<'EOF'
#!/usr/bin/env bash
printf '{}\n200'
EOF
chmod +x "$TMP/stub-curl"

sleep 300 &
anchor=$!
export AOS_ITT_RENEW_DIR="$TMP/renew"
export ITT_CLAIM_CURL="$TMP/stub-curl"
export INTENTTREE_API_URL="http://stub.invalid"
export INTENTTREE_API_TOKEN="stub-token"
export OP_RUN_ID="op_run_anchor_negative_control"
export ITT_CLAIM_ANCHOR_PID="$anchor"

bash "$HOOK" renew-daemon node_anchor_negative_control --interval 5 >/dev/null || fail "could not arm cadence"
pidfile="$(find "$AOS_ITT_RENEW_DIR" -name '*.pid' -print -quit)"
[ -n "$pidfile" ] || fail "cadence did not write a pidfile"
renew_pid="$(cat "$pidfile")"
kill -0 "$renew_pid" 2>/dev/null || fail "renew process was not alive after arming"

kill "$anchor"
wait "$anchor" 2>/dev/null || true

deadline=$((SECONDS + 9)) # one 5s interval plus polling slack
while [ "$SECONDS" -lt "$deadline" ]; do
    if ! kill -0 "$renew_pid" 2>/dev/null && [ ! -e "$pidfile" ]; then
        echo "passed=1 failed=0"
        exit 0
    fi
    sleep 0.2
done

fail "renew process or pidfile survived the dead explicit anchor"
