# `ccdash status project`

Project-level health summary: active features, in-flight sessions, recent workflow failures, freshness of the cached index.

## Usage

```text
ccdash status project [--project <id>] [--output human|json|markdown] [--json] [--md]
```

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--project <id>` | resolved target's default project | Override the project id just for this call. Useful when a target has multiple projects. |
| `--output` | `human` (or global `--output`) | `json` for agent reasoning, `markdown` for user-facing narrative. |
| `--json` / `--md` | — | Shortcuts for `--output json` / `--output markdown`. |

## Example Invocations

```bash
# Agent path: structured summary for reasoning.
ccdash status project --json

# Operator path: terminal-friendly summary.
ccdash status project

# Specific project override.
ccdash status project --project meatyprompts --json
```

## JSON Field Glossary

Top-level fields (shape is stable but tolerate additive new keys):

| Field | Type | Meaning |
|---|---|---|
| `project_id` | string | Resolved project id. Echo in follow-ups. |
| `generated_at` | ISO 8601 | Server-side timestamp; freshness indicator. |
| `feature_counts.active` | int | Features with status in active set. |
| `feature_counts.blocked` | int | Features currently blocked. |
| `feature_counts.done` | int | Features closed recently. |
| `active_session_ids` | string[] | Sessions still running or recently updated. |
| `recent_workflow_failures` | object[] | Summary rows of failing workflows (see `command-workflow.md`). |
| `risky_features` | object[] | Features flagged by heuristics (high churn, long tail, stalled). Each has `feature_id`, `reason`, `signal_score`. |
| `last_sync_at` | ISO 8601 | When the CCDash filesystem -> DB sync last ran. Stale sync ⇒ caveat in summary. |

## When To Use

- Operator opener: "what's the state of this project" -> default (`human`).
- Agent triage opener: run with `--json`, then branch into `feature show` on the highest-signal risky feature (see `recipes/project-triage.md`).
- Health check after a deploy or a long session batch finishes.

## Failure Modes

- Connection/auth errors -> run `ccdash doctor`; see `recipes/unreachable-server.md`.
- Empty `risky_features` with `feature_counts.active > 0` is legitimate — the project is healthy. Do not manufacture concerns.
- `last_sync_at` older than ~15 minutes ⇒ warn the user that the answer may lag the filesystem; suggest triggering a sync if the backend exposes one.

## Cross-Links

- Recipe: `recipes/project-triage.md`
- Output rules: `output-modes.md`
- Provenance echo list: `provenance.md`
