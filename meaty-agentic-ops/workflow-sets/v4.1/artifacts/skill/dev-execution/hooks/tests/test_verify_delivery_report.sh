#!/usr/bin/env bash
set -u

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
hook="$(cd "$(dirname "$0")/.." && pwd)/verify-delivery-report.sh"
fake_cli="$tmpdir/delivery_report.py"
manifest="$tmpdir/delivery-report.json"
report_html="$tmpdir/index.html"
python_bin="${DELIVERY_REPORT_TEST_PYTHON:-/usr/bin/python3}"

printf '%s\n' '# fake validator' 'import os, sys' 'sys.exit(int(os.environ.get("FAKE_VALIDATE_EXIT", "0")))' > "$fake_cli"
printf '{}\n' > "$manifest"
printf '<!doctype html>\n' > "$report_html"

pass=0
fail=0
check() {
  name="$1" expected="$2"
  shift 2
  set +e
  "$@" >/dev/null 2>&1
  actual=$?
  set -e
  if [ "$actual" -eq "$expected" ]; then
    pass=$((pass + 1))
  else
    printf 'FAIL %s: expected %s got %s\n' "$name" "$expected" "$actual"
    fail=$((fail + 1))
  fi
}

set -e
check optional-no-report 0 env DELIVERY_REPORT_TIER=0 "$hook"
check required-missing-report 1 env DELIVERY_REPORT_TIER=2 "$hook"
check required-valid-report 0 env DELIVERY_REPORT_TIER=2 DELIVERY_REPORT_MANIFEST="$manifest" DELIVERY_REPORT_HTML="$report_html" DELIVERY_REPORT_CLI="$fake_cli" DELIVERY_REPORT_PYTHON="$python_bin" "$hook"
check required-invalid-report 1 env DELIVERY_REPORT_TIER=2 DELIVERY_REPORT_MANIFEST="$manifest" DELIVERY_REPORT_HTML="$report_html" DELIVERY_REPORT_CLI="$fake_cli" DELIVERY_REPORT_PYTHON="$python_bin" FAKE_VALIDATE_EXIT=1 "$hook"
check required-waived 0 env DELIVERY_REPORT_TIER=2 DELIVERY_REPORT_WAIVER_REASON="covered by parent feature report" "$hook"

printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
