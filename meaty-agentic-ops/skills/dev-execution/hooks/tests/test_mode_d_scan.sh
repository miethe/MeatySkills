#!/usr/bin/env bash
# Regression net for the delegated-leg Mode-D output guard.
#
# The load-bearing case is CASE 1: the literal breach from
# node_01KZC1AHEDYZ8FS9TAZSXQTTSB — an ica-executor leg that was briefed "must not
# generate any signing key … STOP and return mode_d" and instead wrote
# `secrets.token_bytes(32)`. If that diff ever stops failing this guard, the guard
# is decoration.
#
# Three contracts are tested, and they are not the same thing.
#
# The DETECTION contract: the produced output is what gets scanned. Added lines
# only — removing `secrets.token_bytes` is the FIX and must never be a finding
# (CASE 4). This is the whole reason the hook exists: the pre-dispatch guards read
# declarations, and the breaching leg declared nothing crypto-shaped.
#
# The LANE contract: the same finding is a hard gate on an offload lane (CASE 1)
# and an advisory on primary (CASE 2). Mode-D work is legitimate on
# claude-primary; a blanket grep would be noise, and noise is how a guard gets
# switched off. The lane, not the code, is what makes it a breach.
#
# The EXIT contract: exit 2 means "breach", full stop. argparse's default error
# exit is also 2, so CASE 6 pins usage errors to 1 — a guard that reports a breach
# when it merely misparsed a flag teaches people to wave it through, which is
# precisely how a reflexive `pin --repin` hollowed out the git guard.
#
# Offline and deterministic: no network, no model, no git required except CASE 9
# (tests/CLAUDE.md).
set -u

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
hooks="$(cd "$(dirname "$0")/.." && pwd)"
hook="$hooks/mode-d-scan.sh"
engine="$hooks/mode_d_scan.py"
python_bin="${DELIVERY_REPORT_TEST_PYTHON:-python3}"

pass=0
fail=0
check() { # check <label> <expected_rc> <actual_rc>
    if [ "$2" = "$3" ]; then
        printf '  ok    %s (rc=%s)\n' "$1" "$3"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s (expected rc=%s, got rc=%s)\n' "$1" "$2" "$3"
        fail=$((fail + 1))
    fi
}
contains() { # contains <label> <haystack-file> <needle>
    if grep -qF -- "$3" "$2"; then
        printf '  ok    %s\n' "$1"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s — output did not contain %q\n' "$1" "$3"
        fail=$((fail + 1))
    fi
}
absent() { # absent <label> <haystack-file> <needle>
    if grep -qF -- "$3" "$2"; then
        printf '  FAIL  %s — output leaked %q\n' "$1" "$3"
        fail=$((fail + 1))
    else
        printf '  ok    %s\n' "$1"
        pass=$((pass + 1))
    fi
}

# ── the breach, verbatim from the node (har.py:113-122 + :238-239) ────────────
breach="$tmpdir/breach.diff"
cat > "$breach" <<'DIFF'
diff --git a/src/operator_core/core/har.py b/src/operator_core/core/har.py
--- /dev/null
+++ b/src/operator_core/core/har.py
@@ -0,0 +1,7 @@
+import hmac
+import secrets
+
+def _sign_resume_token(run_id: str, gate: str, secret_key: bytes | None) -> str:
+    if secret_key is None:
+        secret_key = secrets.token_bytes(32)
+    return hmac.new(secret_key, f"{run_id}{gate}".encode(), "sha256").hexdigest()
DIFF

echo "== CASE 1: the real breach on an offload lane — hard gate =="
out="$tmpdir/c1.txt"
"$python_bin" "$engine" --diff "$breach" --provider ica >"$out" 2>&1
check "ica + secrets.token_bytes => exit 2" 2 "$?"
contains "names the minting signature" "$out" "crypto.secrets_token"
contains "names the parallel HMAC implementation" "$out" "crypto.hmac_new"
contains "names the file and line" "$out" "src/operator_core/core/har.py:6"
contains "says do not merge" "$out" "Do NOT merge"

echo "== CASE 2: identical diff on claude-primary — advisory, never fatal =="
out="$tmpdir/c2.txt"
"$python_bin" "$engine" --diff "$breach" --provider claude >"$out" 2>&1
check "claude + same diff => exit 0" 0 "$?"
contains "still reports the finding" "$out" "crypto.secrets_token"
contains "marks it advisory" "$out" "advisory only"

echo "== CASE 3: unknown lane — advisory (never fail on an unproven premise) =="
"$python_bin" "$engine" --diff "$breach" >/dev/null 2>&1
check "no provider => exit 0" 0 "$?"

echo "== CASE 4: REMOVING the breach is the fix, not a finding =="
cat > "$tmpdir/fix.diff" <<'DIFF'
--- a/src/operator_core/core/har.py
+++ b/src/operator_core/core/har.py
@@ -1,2 +1,1 @@
-        secret_key = secrets.token_bytes(32)
+        raise ValueError("resume_token is passed in opaque; never minted here")
DIFF
out="$tmpdir/c4.txt"
"$python_bin" "$engine" --diff "$tmpdir/fix.diff" --provider ica >"$out" 2>&1
check "deletion of the signature => exit 0" 0 "$?"
contains "reports clean" "$out" "no Mode-D signatures"

echo "== CASE 5: each Mode-D class trips the gate on an offload lane =="
while IFS='|' read -r label line; do
    [ -z "$label" ] && continue
    d="$tmpdir/cls.diff"
    {
        printf -- '--- /dev/null\n+++ b/probe/thing.py\n@@ -0,0 +1,1 @@\n'
        printf -- '+%s\n' "$line"
    } > "$d"
    "$python_bin" "$engine" --diff "$d" --provider bob >/dev/null 2>&1
    check "$label" 2 "$?"
done <<'CLASSES'
crypto: Fernet.generate_key|    k = Fernet.generate_key()
crypto: generate_private_key|    k = rsa.generate_private_key(65537, 2048)
crypto: node randomBytes|  const k = crypto.randomBytes(32)
crypto: jwt.encode|    t = jwt.encode(payload, key)
auth: password check|    if verify_password(raw, stored):
migration: alembic upgrade|    subprocess.run(["alembic", "upgrade", "head"])
migration: destructive DDL|    op.drop_column("users", "email")
data: DROP TABLE|    cur.execute("DROP TABLE sessions")
data: DELETE FROM|    cur.execute("DELETE FROM runs")
history: force push|    git push --force origin main
history: reset --hard|    git reset --hard origin/main
secretstore: aos secrets|    p = Path.home() / ".config/aos/secrets.env"
CLASSES

echo "== CASE 6: usage errors exit 1, never the gate's 2 =="
"$python_bin" "$engine" --bogus-flag >/dev/null 2>&1
check "unknown flag => exit 1" 1 "$?"
"$python_bin" "$engine" --diff "$breach" --allow crypto.secrets_token >/dev/null 2>&1
check "waiver with no reason => exit 1" 1 "$?"
"$python_bin" "$engine" --diff "$breach" --allow no.such.signature=typo >/dev/null 2>&1
check "waiver naming unknown signature => exit 1" 1 "$?"

echo "== CASE 7: a reasoned waiver downgrades, and is disclosed =="
out="$tmpdir/c7.txt"
"$python_bin" "$engine" --diff "$breach" --provider ica \
    --allow "crypto.secrets_token=test fixture" \
    --allow "crypto.hmac_new=test fixture" >"$out" 2>&1
check "both signatures waived => exit 0" 0 "$?"
contains "waivers are disclosed, not silent" "$out" "waived:"

echo "== CASE 8: the report never reproduces the matched literal =="
cat > "$tmpdir/leak.diff" <<'DIFF'
--- /dev/null
+++ b/probe/cfg.py
@@ -0,0 +1,2 @@
+SIGNING_KEY = "s3cr3t-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
+h = hmac.new(SIGNING_KEY.encode(), b"x", "sha256")
DIFF
out="$tmpdir/c8.txt"
"$python_bin" "$engine" --diff "$tmpdir/leak.diff" --provider ica >"$out" 2>&1
check "flags the signing act" 2 "$?"
absent "literal secret is redacted in the report" "$out" "s3cr3t-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
out="$tmpdir/c8b.txt"
"$python_bin" "$engine" --diff "$tmpdir/leak.diff" --provider ica --json >"$out" 2>&1
absent "literal secret is redacted in --json too" "$out" "s3cr3t-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

echo "== CASE 9: whole-file scan of quarantined output (never committed) =="
mkdir -p "$tmpdir/quarantine"
printf 'import secrets\nk = secrets.token_bytes(32)\n' > "$tmpdir/quarantine/har.py.rejected"
"$python_bin" "$engine" --paths "$tmpdir/quarantine" --provider ica >/dev/null 2>&1
check "quarantined file => exit 2" 2 "$?"

echo "== CASE 10: binary/vendored noise is skipped =="
mkdir -p "$tmpdir/vendor/node_modules"
printf 'k = secrets.token_bytes(32)\n' > "$tmpdir/vendor/node_modules/dep.py"
"$python_bin" "$engine" --paths "$tmpdir/vendor" --provider ica >/dev/null 2>&1
check "node_modules ignored => exit 0" 0 "$?"

echo "== CASE 11: the scanner does not fail on its own source =="
"$python_bin" "$engine" --paths "$engine" --provider ica >/dev/null 2>&1
check "self-exempt by default => exit 0" 0 "$?"
"$python_bin" "$engine" --paths "$engine" --provider ica --include-self >/dev/null 2>&1
check "--include-self defeats the exemption => exit 2" 2 "$?"

echo "== CASE 12: wrapper contract — switch, binding, non-fatal, gate =="
AOS_MODE_D_SCAN=off MODE_D_SCAN_DIFF="$breach" MODE_D_SCAN_PROVIDER=ica \
    "$hook" >/dev/null 2>&1
check "master switch off => exit 0" 0 "$?"
MODE_D_SCAN_PROVIDER=ica "$hook" >/dev/null 2>&1
check "no source (no binding) => silent no-op exit 0" 0 "$?"
MODE_D_SCAN_DIFF="$tmpdir/does-not-exist.diff" MODE_D_SCAN_PROVIDER=ica \
    "$hook" >/dev/null 2>&1
check "engine infra failure swallowed => exit 0" 0 "$?"
MODE_D_SCAN_DIFF="$breach" MODE_D_SCAN_PROVIDER=ica "$hook" >/dev/null 2>&1
check "gate propagates through the wrapper => exit 2" 2 "$?"
MODE_D_SCAN_DIFF="$breach" MODE_D_SCAN_PROVIDER=claude "$hook" >/dev/null 2>&1
check "primary lane through the wrapper => exit 0" 0 "$?"
MODE_D_SCAN_PATHS="$tmpdir/quarantine" MODE_D_SCAN_PROVIDER=ica "$hook" >/dev/null 2>&1
check "PATHS binding through the wrapper => exit 2" 2 "$?"
MODE_D_SCAN_DIFF="$breach" MODE_D_SCAN_PROVIDER=ica \
    MODE_D_SCAN_ALLOW="crypto.secrets_token=fixture crypto.hmac_new=fixture" \
    "$hook" >/dev/null 2>&1
check "ALLOW list is word-split correctly => exit 0" 0 "$?"

echo "== CASE 13: --json is a stable machine contract =="
out="$tmpdir/c13.json"
"$python_bin" "$engine" --diff "$breach" --provider ica --json >"$out" 2>&1
"$python_bin" - "$out" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["lane"] == "offload", d["lane"]
assert d["gated"] is True, d
assert any(f["sig_id"] == "crypto.secrets_token" for f in d["findings"]), d
assert all({"sig_id", "class", "path", "line", "excerpt", "why"} <= set(f) for f in d["findings"]), d
PY
check "json shape/keys/gated flag" 0 "$?"

echo ""
printf 'mode-d-scan: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
