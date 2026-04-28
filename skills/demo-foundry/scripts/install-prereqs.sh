#!/usr/bin/env bash
set -euo pipefail

PROJECT="${1:-$(pwd)}"
APPLY="${2:-}"
cd "$PROJECT"

if [[ ! -f package.json ]]; then
  echo "No package.json found. Create one or adapt prerequisites manually."
  exit 0
fi

PKG="npm"
if [[ -f pnpm-lock.yaml ]]; then PKG="pnpm"; fi
if [[ -f yarn.lock ]]; then PKG="yarn"; fi
if [[ -f bun.lockb ]]; then PKG="bun"; fi

cat <<EOF
# Demo Foundry prerequisite plan

Detected package manager: $PKG

Suggested dev dependencies:
- @playwright/test
- playwright
- remotion
- @remotion/cli
- typescript

Suggested browser install:
- npx playwright install chromium

FFmpeg:
- recommended for final media operations
- install via OS package manager or static binary
EOF

if [[ "$APPLY" != "--apply" ]]; then
  echo "\nDry-run only. Re-run with --apply to install JS dependencies and Playwright Chromium."
  exit 0
fi

case "$PKG" in
  pnpm)
    pnpm add -D @playwright/test playwright remotion @remotion/cli typescript
    pnpm exec playwright install chromium
    ;;
  yarn)
    yarn add -D @playwright/test playwright remotion @remotion/cli typescript
    yarn playwright install chromium
    ;;
  bun)
    bun add -d @playwright/test playwright remotion @remotion/cli typescript
    bunx playwright install chromium
    ;;
  npm|*)
    npm install -D @playwright/test playwright remotion @remotion/cli typescript
    npx playwright install chromium
    ;;
esac
