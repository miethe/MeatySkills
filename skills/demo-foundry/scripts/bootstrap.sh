#!/usr/bin/env bash
set -euo pipefail

PROJECT="${1:-$(pwd)}"
APPLY="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "$APPLY" == "--apply" ]]; then
  node "$PACK_ROOT/bin/demo-foundry.mjs" init --project "$PROJECT" --apply
else
  node "$PACK_ROOT/bin/demo-foundry.mjs" init --project "$PROJECT"
fi
