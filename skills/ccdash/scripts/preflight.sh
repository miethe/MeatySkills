#!/usr/bin/env bash
# Preflight probe for the ccdash skill.
# Verifies: CLI is installed, a target resolves, and doctor passes.
# Exit codes: 0 = ready; 10 = CLI missing; 20 = target missing; 30 = doctor failed.
set -u

if ! command -v ccdash >/dev/null 2>&1; then
  echo "ccdash: command not found on PATH" >&2
  echo "Next: follow recipes/target-onboarding.md (pipx install ccdash-cli)" >&2
  exit 10
fi

version=$(ccdash --version 2>/dev/null || true)
if [[ -z "$version" ]]; then
  echo "ccdash --version returned empty output; install may be broken" >&2
  exit 10
fi
echo "ok: $version"

if ! ccdash target show >/dev/null 2>&1; then
  echo "no active target resolved" >&2
  echo "Next: ccdash target add <name> <url> && ccdash target use <name>" >&2
  exit 20
fi

if ! ccdash doctor >/dev/null 2>&1; then
  echo "doctor reported issues; run: ccdash doctor" >&2
  exit 30
fi

echo "ok: target + doctor clean"
exit 0
