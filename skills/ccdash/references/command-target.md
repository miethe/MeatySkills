# `ccdash target` — Target Management

Nine subcommands for managing CCDash server endpoints, auth tokens, and the active target selection. All are `--output human` only (no structured output yet).

## Config Storage

- Targets live in `~/.config/ccdash/config.toml`.
- Tokens live in the OS keyring under `target:<name>` (by convention, via `ccdash target login`).
- The `active` field picks which target unadorned commands hit. Overridable per call via `--target <name>` or `CCDASH_TARGET` env var.

## Subcommands

### `target list`

```text
ccdash target list
```

Lists all configured targets and marks the active one. No flags. Use to answer "what environments do I have configured?"

### `target add NAME URL [--token-ref REF] [--project SLUG]`

```text
ccdash target add staging https://ccdash.staging.example.com --project meatyprompts
```

Creates or replaces a named target. `--token-ref` sets a custom keyring key (default set by `target login`). `--project` sets the default project id for that target.

### `target show [NAME]`

```text
ccdash target show          # resolved active target
ccdash target show staging  # specific named target
```

Prints the fully resolved target config (name, URL, project, token_ref) without mutating state. Safe preflight for any session.

### `target use NAME`

```text
ccdash target use staging
```

Sets the `active` field. Use this when an operator says "switch to staging".

### `target remove NAME`

```text
ccdash target remove oldprod
```

Deletes the target record from `config.toml`. Keyring token is untouched; pair with `target logout` to clean tokens.

### `target set-token NAME`

```text
ccdash target set-token staging
```

Interactively prompts for a bearer token (input hidden), stores it in the OS keyring. Use when the token_ref is custom or already set.

### `target login NAME [--token TOKEN]`

```text
ccdash target login staging
ccdash target login staging --token "sk-..."
```

Stores a token under the conventional `target:<name>` keyring key and sets the record's `token_ref` to match. Prefer this over `set-token` for fresh onboarding — it handles both pieces in one call. Prompts interactively if `--token` is omitted.

### `target logout NAME`

```text
ccdash target logout staging
```

Clears the keyring entry (if any) and removes `token_ref` from the target record. Subsequent calls will be unauthenticated until you log back in.

### `target check NAME`

```text
ccdash target check staging
```

Lightweight reachability + auth probe (HTTP health + auth status). Equivalent to `ccdash doctor --target staging` but faster and narrower. Use for loops / scripts; prefer `doctor` for human-facing triage since it gives interpretation.

## Decision Tree

- "Is my target set up?" → `target show`.
- "What targets exist?" → `target list`.
- "Switch environment." → `target use <name>`.
- "Add new server." → `target add <name> <url>` then `target login <name>`.
- "Rotate a token." → `target logout <name>` then `target login <name>`.
- "Quick is-it-up check" → `target check <name>` (or `doctor` for full interpretation).

## Cross-Links

- Onboarding recipe: `recipes/target-onboarding.md`
- Failure triage: `recipes/unreachable-server.md`
- Doctor interpretation: `command-doctor.md`
- Auth precedence: `cli-overview.md` § "Target & Auth Resolution"
