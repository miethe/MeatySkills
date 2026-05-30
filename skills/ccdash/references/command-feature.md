# `ccdash feature` — Feature Investigations

> **Transport note**: `list`, `show`, `sessions`, and `documents` are **standalone CLI only** (`pipx install ccdash-cli`). The in-repo CLI (`backend/.venv/bin/ccdash`) provides only `ccdash feature report <id>`. Do not suggest `feature list/show/sessions/documents` to users running only the in-repo CLI.

The standalone CLI provides four subcommands: `list`, `show`, `sessions`, `documents`. All honor `--output {human|json|markdown}` with `--json` / `--md` shortcuts.

## `feature list`

```text
ccdash feature list [--status TEXT]... [--category TEXT] [--q TEXT] [--limit INT=200] [--offset INT=0] [--no-cache] [--output ...]
```

- `--status` — repeatable or comma-separated. Common values: `active`, `blocked`, `done`, `shipped`.
- `--category` — filter by category string.
- `--q TEXT` — keyword filter: case-insensitive substring match on feature name/title only. Brittle for multi-word queries; narrow with `--status` or `--category` first.
- `--limit` / `--offset` — pagination. Default limit is **200** (raised from 50 in phase 5).
- `--no-cache` — bypass the 60 s query cache; use when immediate consistency is required.

### JSON shape

```json
{
  "features": [
    {
      "feature_id": "FEAT-123",
      "title": "...",
      "status": "active",
      "category": "backend",
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "total": 42,
  "limit": 200,
  "offset": 0,
  "truncated": false
}
```

**Always check `truncated` and `total`.** If `truncated: true`, surface both values to the user and suggest `--q KEYWORD` or pagination to narrow.

## `feature show FEATURE_ID`

Full forensic detail: PRD / plan / progress doc pointers, linked sessions, linked workflows, counts, risk signals.

```text
ccdash feature show FEATURE_ID [--output ...]
```

### JSON shape (key fields)

| Field | Meaning |
|---|---|
| `feature_id` | Stable id (echo for chaining). |
| `status`, `category`, `priority` | Basic classification. |
| `summary` | Server-side curated one-paragraph summary. |
| `documents` | Array of `{document_id, doc_type, path, updated_at}`. |
| `linked_sessions` | Sessions linked to this feature — **may lag** the sync engine. See `sessions_note`. |
| `sessions_note` | Non-empty string when `linked_sessions` may be stale; directs caller to use `feature sessions` for fresh data. |
| `linked_tasks` | Array of `{task_id, title, owner, status}`. `owner` carries agent-role attribution. |
| `session_ids` | Shorthand session ID list (same caveat as `linked_sessions`). |
| `workflow_ids` | Workflows gated on this feature. |
| `risk_signals` | Array of `{signal, score, explanation}`. |
| `created_at`, `updated_at`, `generated_at` | Timestamps. |

## `feature sessions FEATURE_ID`

```text
ccdash feature sessions FEATURE_ID [--limit INT=50] [--offset INT=0] [--no-cache] [--output ...]
```

**Canonical sessions surface.** Always prefer this over `feature show`'s `linked_sessions` field when fresh data matters. JSON returns `{sessions: [...], total, limit, offset}` where each session includes `session_id`, `root_session_id`, `started_at`, `ended_at`, `cost`, `model`, and summary fields.

## `feature documents FEATURE_ID`

```text
ccdash feature documents FEATURE_ID [--output ...]
```

Lists PRD / implementation plan / progress / ADR / spike docs linked to the feature. Each entry: `document_id`, `doc_type`, `path`, `updated_at`, `status`.

## When To Use Which

- "Which features are active/blocked" → `feature list --status active,blocked --json`.
- "Find features matching a keyword" → `feature list --q KEYWORD --json`; check `truncated` + `total`.
- "Tell me about FEAT-X" → `feature show FEAT-X --json`, then summarize risk signals + linked sessions.
- "What agents worked on FEAT-X" → `feature show FEAT-X --json` → inspect `linked_tasks[].owner`; correlate with `feature sessions FEAT-X --json`. See `recipes/task-attribution.md`.
- "Which sessions ran for FEAT-X" → `feature sessions FEAT-X --json` (canonical, not `feature show`'s `linked_sessions`).
- "Which PRD/plan/progress covers FEAT-X" → `feature documents FEAT-X --json`.

## Default Output Mode

`--json` for all four — agent reasoning is the dominant caller. Use `--md` only when the user explicitly wants a narrative render; `report feature` is usually better for that.

## Recipes

- `recipes/feature-retrospective.md` — `feature show` → `feature sessions` → `report aar`.
- `recipes/project-triage.md` — pick a risky feature from `status project`, then drill in via `feature show`.

## Cross-Links

- Session detail: `command-session.md`.
- Narrative rendering: `command-report.md`.
- Provenance echo list: `provenance.md`.
