# `ccdash` CLI Overview

Snapshot of the standalone CCDash CLI as of 2026-04-13. The CLI ships from `packages/ccdash_cli/` in the CCDash repo. Ground-truth documentation: `packages/ccdash_cli/README.md` and `docs/guides/standalone-cli-guide.md`.

## Global Invocation

```text
ccdash [--target NAME] [--output human|json|markdown] [--version] <command> [...]
```

Global options:

- `--target TEXT` — pick a named target from `~/.config/ccdash/config.toml`. Overrides the active target for this invocation.
- `--output [human|json|markdown]` — default output format for subcommands that honor it. Individual subcommands also expose `--json` and `--md` shortcuts.
- `--version` — print the CLI version and exit.
- `--install-completion` / `--show-completion` — shell completion helpers.

## Command Tree

```text
ccdash
├── version                    # Show CLI version.
├── target                     # Manage CCDash server targets.
│   ├── list                   #   List all configured targets, indicating the active one.
│   ├── add NAME URL           #   Add a new named target (or replace an existing one).
│   ├── show [NAME]            #   Show the resolved target config. NAME optional (defaults to active).
│   ├── use NAME               #   Set the active target.
│   ├── remove NAME            #   Remove a named target.
│   ├── set-token NAME         #   Store a bearer token in the system keyring (interactive prompt).
│   ├── login NAME             #   Store a bearer token under token_ref = `target:<name>`.
│   ├── logout NAME            #   Clear the stored token and token_ref.
│   └── check NAME             #   Probe reachability + auth for the named target.
├── doctor                     # Diagnose CLI configuration and server connectivity.
├── status
│   └── project                # Show a project status summary.
├── workflow
│   └── failures               # Show workflows with the highest observed failure burden.
├── feature                    # Feature investigations.
│   ├── list                   #   List features with optional --status / --category / --limit / --offset.
│   ├── show FEATURE_ID        #   Full forensic detail for a feature.
│   ├── sessions FEATURE_ID    #   List sessions linked to a feature.
│   └── documents FEATURE_ID   #   List documents linked to a feature.
├── report                     # Reports and narrative output.
│   ├── aar --feature FEATURE_ID   # After-action report (default --output markdown).
│   └── feature FEATURE_ID     #   Narrative forensic report (default --output markdown).
└── session                    # Session intelligence.
    ├── list                   #   List sessions with optional --feature / --root-session / --limit / --offset.
    ├── show SESSION_ID        #   Detailed intelligence for a session.
    ├── search QUERY           #   Search session transcripts; filterable by feature/root/session.
    ├── drilldown SESSION_ID --concern {sentiment|churn|scope_drift}  # Concern drilldown.
    └── family SESSION_ID      #   All sessions sharing the same root as SESSION_ID.
```

Every leaf subcommand that emits structured data honors `--output`, `--json`, and `--md`.

## Target & Auth Resolution

Resolution precedence (first non-empty wins):

1. **CLI flag**: `--target <name>` for the current invocation.
2. **Environment**: `CCDASH_TARGET` selects the named target; `CCDASH_TOKEN` supplies a bearer token directly (bypasses the keyring); `CCDASH_BASE_URL` overrides target URL without touching config.
3. **Active target**: `active = "<name>"` entry in `~/.config/ccdash/config.toml`.
4. **Implicit local**: `http://localhost:8000` with no bearer token (for dev loopback).

Token lookup order for a resolved target:

1. `CCDASH_TOKEN` env var.
2. `token_ref` field on the target record → system keyring entry (convention: `target:<name>` after `ccdash target login`).
3. Unauthenticated (server must accept anonymous calls).

Use `ccdash target show` to print the fully resolved configuration without mutating state.

## Project Resolution

Commands scoped to a project pick a project id via:

1. `--project <id>` flag on the subcommand (when supported, e.g. `status project`).
2. `CCDASH_PROJECT` env var.
3. `project = "<id>"` field on the active target.
4. Server default (single-project deployments).

## Cross-Link

- Install and verify: `install-setup.md`
- Human vs JSON vs Markdown: `output-modes.md`
- IDs and timestamps to echo: `provenance.md`
- Per-command detail: `command-status.md`, `command-doctor.md`, `command-target.md`, `command-feature.md`, `command-session.md`, `command-workflow.md`, `command-report.md`
