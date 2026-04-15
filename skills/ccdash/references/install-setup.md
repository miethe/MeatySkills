# Install & Setup

## Primary: `pipx` (recommended)

```bash
pipx install ccdash-cli
ccdash --version                       # expect: ccdash <version>
```

`pipx` isolates the CLI in its own venv and puts `ccdash` on PATH. Re-run `pipx upgrade ccdash-cli` for updates.

If `pipx` is unavailable, `pip install --user ccdash-cli` works but risks conflicts with other user-site packages.

## Fallback A: Repo-Local (for CCDash contributors)

When running from a CCDash checkout:

```bash
# one-time setup creates backend/.venv with cli deps installed editable
npm run setup

# use the venv shim directly
backend/.venv/bin/ccdash --version
```

The venv shim lives at `backend/.venv/bin/ccdash`; it imports the editable `packages/ccdash_cli/` and `packages/ccdash_contracts/` wheels. Use this path in repo-local invocations to avoid picking up a stale pipx install.

## Fallback B: Standalone Dev Venv

If `backend/.venv/` is not present and the user does not want the full backend setup:

```bash
python3 -m venv .venv-standalone-cli
source .venv-standalone-cli/bin/activate
pip install -e packages/ccdash_contracts/
pip install -e packages/ccdash_cli/
ccdash --version
```

This matches the `.venv-standalone-cli/` directory already present at repo root.

## First-Run Verification

```bash
ccdash --version                       # CLI present
ccdash target list                     # no targets yet -> expected on fresh install
ccdash target add local http://localhost:8000
ccdash target use local
ccdash target show                     # confirm resolved config
ccdash doctor                          # probe connectivity + auth
ccdash status project                  # first real query
```

If `doctor` reports the server as unreachable, either start the CCDash backend (`npm run dev:backend` in a CCDash checkout) or add a remote target pointing at a running instance.

## Authentication

The standalone CLI enforces bearer auth when the server requires it (see the `feat(api): enforce standalone cli auth` commit). Two token-supply mechanisms:

- **Keyring (preferred)**: `ccdash target login <name>` (or `ccdash target set-token <name>`) stores the token in the OS keyring under `target:<name>`; the CLI reads it transparently on each call.
- **Env var**: `CCDASH_TOKEN=...` overrides the keyring for one-off invocations. Useful in CI or when no keyring backend is available.

For local loopback dev against an unauthenticated backend, leave `token_ref` empty and the CLI sends no `Authorization` header.

## Upgrading

```bash
pipx upgrade ccdash-cli                # pipx install
pip install --upgrade --user ccdash-cli # --user pip install
git pull && pip install -e packages/ccdash_cli   # repo-local
```

After upgrade, re-run `ccdash doctor` to ensure the new CLI matches the server's expected contracts.

## Ground-Truth References

- `packages/ccdash_cli/README.md` (canonical)
- `docs/guides/standalone-cli-guide.md` (operator guide)
- `docs/guides/cli-migration-guide.md` (if migrating from the repo-local `backend/.venv/bin/ccdash`)

Link rot warning: if paths above move, update this file before invoking the CLI from an unknown layout.
