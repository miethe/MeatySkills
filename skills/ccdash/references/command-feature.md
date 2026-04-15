# `ccdash feature` — Feature Investigations

Four subcommands: `list`, `show`, `sessions`, `documents`. All honor `--output {human|json|markdown}` with `--json` / `--md` shortcuts.

## `feature list`

```text
ccdash feature list [--status TEXT]... [--category TEXT] [--limit INT=50] [--offset INT=0] [--output ...]
```

- `--status` — repeatable or comma-separated. Common values: `active`, `blocked`, `done`, `shipped`.
- `--category` — filter by category string.
- `--limit` / `--offset` — pagination.

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
  "limit": 50,
  "offset": 0
}
```

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
| `session_ids` | Sessions linked to this feature. |
| `workflow_ids` | Workflows gated on this feature. |
| `risk_signals` | Array of `{signal, score, explanation}`. |
| `created_at`, `updated_at`, `generated_at` | Timestamps. |

## `feature sessions FEATURE_ID`

```text
ccdash feature sessions FEATURE_ID [--limit INT=50] [--offset INT=0] [--output ...]
```

Lists sessions linked to the feature. JSON returns `{sessions: [...], total, limit, offset}` where each session includes `session_id`, `root_session_id`, `started_at`, `ended_at`, `cost`, `model`, and summary fields.

## `feature documents FEATURE_ID`

```text
ccdash feature documents FEATURE_ID [--output ...]
```

Lists PRD / implementation plan / progress / ADR / spike docs linked to the feature. Each entry: `document_id`, `doc_type`, `path`, `updated_at`, `status`.

## When To Use Which

- "Which features are active/blocked" → `feature list --status active,blocked --json`.
- "Tell me about FEAT-X" → `feature show FEAT-X --json`, then summarize risk signals + linked sessions.
- "What agents worked on FEAT-X" → `feature sessions FEAT-X --json`.
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
