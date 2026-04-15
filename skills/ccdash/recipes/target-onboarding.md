# Recipe: Target Onboarding

Fresh operator / fresh machine: install `ccdash`, register a target, authenticate, verify.

## Prerequisites

- Python 3.10+ available.
- URL of the CCDash server (localhost for dev, https://ccdash.example.com for prod).
- Bearer token for the server (if auth is required).

## Steps

1. **Install the CLI.**

   ```bash
   pipx install ccdash-cli          # recommended
   # or: pip install --user ccdash-cli
   ccdash --version                  # sanity check
   ```

   Alternate paths live in `references/install-setup.md` (repo-local venv, standalone venv).

2. **Register the target.**

   ```bash
   ccdash target add local http://localhost:8000
   # or:
   ccdash target add staging https://ccdash.staging.example.com --project meatyprompts
   ```

   Pick a short `name` (`local`, `staging`, `prod`). `--project` is optional and sets the target's default project id.

3. **Activate the target.**

   ```bash
   ccdash target use staging
   ccdash target show                # confirm URL + project
   ```

4. **Authenticate (skip for anonymous local dev).**

   ```bash
   ccdash target login staging       # prompts for bearer token; stored in OS keyring
   ```

   If the OS keyring is unavailable (headless Linux without gnome-keyring/kwallet), prefer an env var:

   ```bash
   export CCDASH_TOKEN="..."         # ephemeral alternative
   ```

5. **Verify connectivity + auth.**

   ```bash
   ccdash doctor
   ```

   Expected: reachable = yes, authenticated = yes (or "anonymous OK" for unauthenticated servers).

6. **First real query.**

   ```bash
   ccdash status project
   ```

   If this errors, do not re-run `status project` — drop into `recipes/unreachable-server.md`.

## Common Snags

- **`ccdash: command not found` after pipx install** → pipx's bin dir isn't on PATH. Run `pipx ensurepath` and restart the shell.
- **`keyring backend unavailable`** → use `CCDASH_TOKEN` env var, or install `keyring` with a usable backend (`pip install keyrings.alt` on bare Linux for a dev-grade fallback).
- **Multiple targets, wrong one active** → `ccdash target use <name>` (or pass `--target` per call).
- **Server requires project override** → edit with `ccdash target add <name> <url> --project <id>` (this overwrites the existing record with the new `--project`).

## Provenance To Echo

- `target.name`, `target.url`, `target.project`.
- `ccdash --version` output.

## Cross-Links

- Install fallbacks: `references/install-setup.md`
- Target flag surface: `references/command-target.md`
- If any step errors: `recipes/unreachable-server.md`
