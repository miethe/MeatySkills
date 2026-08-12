#!/usr/bin/env bash
# End-of-feature gate for tier/size-eligible rich delivery reports (route: feature).
# Renamed from verify-feature-report.sh when feature-report was folded into delivery-report.
set -u

say() { printf '%s\n' "$*"; }

tier_system="${DELIVERY_REPORT_TIER_SYSTEM:-dev-execution}"
tier="${DELIVERY_REPORT_TIER:-0}"
points="${DELIVERY_REPORT_POINTS:-0}"
signals="${DELIVERY_REPORT_SIGNALS:-}"
explicit="${DELIVERY_REPORT_EXPLICIT:-0}"
forced="${DELIVERY_REPORT_REQUIRED:-0}"
waiver="${DELIVERY_REPORT_WAIVER_REASON:-}"
manifest="${DELIVERY_REPORT_MANIFEST:-}"
report_html="${DELIVERY_REPORT_HTML:-}"
asset_root="${DELIVERY_REPORT_ASSET_ROOT:-.}"

decision="optional"
if [ "$explicit" = "1" ] || [ "$forced" = "1" ]; then
  decision="required"
elif [ "$tier_system" = "dev-execution" ] && [ "$tier" -ge 2 ] 2>/dev/null; then
  decision="required"
elif [ "$tier_system" = "aos" ] && [ "$tier" -ge 3 ] 2>/dev/null; then
  decision="required"
elif [ "$tier_system" = "aos" ] && [ "$tier" -eq 2 ] 2>/dev/null; then
  decision="recommended"
elif [ "$tier_system" = "dev-execution" ] && [ "$tier" -eq 1 ] 2>/dev/null; then
  points_whole="${points%%.*}"
  if [ "${points_whole:-0}" -ge 5 ] 2>/dev/null || [ -n "$signals" ]; then
    decision="recommended"
  fi
fi

if [ "$decision" = "required" ] && [ -n "$waiver" ]; then
  say "WARN delivery-report: required report waived — $waiver"
  exit 0
fi

if [ -z "$manifest" ] || [ -z "$report_html" ]; then
  if [ "$decision" = "required" ]; then
    say "FAIL delivery-report: $tier_system Tier $tier requires DELIVERY_REPORT_MANIFEST and DELIVERY_REPORT_HTML"
    exit 1
  fi
  say "PASS delivery-report: $decision for $tier_system Tier $tier; no report attached"
  exit 0
fi

if [ ! -f "$manifest" ] || [ ! -f "$report_html" ]; then
  say "FAIL delivery-report: attached manifest or HTML is missing"
  exit 1
fi

cli="${DELIVERY_REPORT_CLI:-}"
if [ -z "$cli" ]; then
  for candidate in \
    ".claude/skills/delivery-report/scripts/delivery_report.py" \
    "$HOME/.claude/skills/delivery-report/scripts/delivery_report.py" \
    "$HOME/.agents/skills/delivery-report/scripts/delivery_report.py"; do
    if [ -f "$candidate" ]; then cli="$candidate"; break; fi
  done
fi
if [ -z "$cli" ] || [ ! -f "$cli" ]; then
  say "FAIL delivery-report: validator CLI is unavailable"
  exit 1
fi

python_bin="${DELIVERY_REPORT_PYTHON:-}"
if [ -z "$python_bin" ]; then
  if [ -x ".venv/bin/python" ]; then python_bin=".venv/bin/python"; else python_bin="python3"; fi
fi
require_flag=""
if [ "$decision" = "required" ]; then require_flag="--require-report"; fi
if "$python_bin" "$cli" validate --manifest "$manifest" --asset-root "$asset_root" --html "$report_html" \
    --expect-route feature --expect-tier-system "$tier_system" --expect-tier "$tier" $require_flag >/dev/null 2>&1; then
  say "PASS delivery-report: $decision report validated ($report_html)"
  exit 0
fi
say "FAIL delivery-report: report validation failed; run validator directly for diagnostics"
exit 1
