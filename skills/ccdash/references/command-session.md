# `ccdash session` — Session Intelligence

Five subcommands: `list`, `show`, `search`, `drilldown`, `family`. All honor `--output {human|json|markdown}` with `--json` / `--md` shortcuts.

## `session list`

```text
ccdash session list [--feature ID] [--root-session ID] [--limit INT=50] [--offset INT=0] [--output ...]
```

Filters:

- `--feature` — sessions linked to a feature.
- `--root-session` — sessions sharing a root (cluster lens; see `session family` for a convenience wrapper).

### JSON shape

```json
{
  "sessions": [
    {
      "session_id": "...",
      "root_session_id": "...",
      "feature_id": "...",
      "started_at": "...",
      "ended_at": "...",
      "cost": 1.23,
      "model": "claude-opus-4-6",
      "title": "..."
    }
  ],
  "total": ...,
  "limit": 50,
  "offset": 0
}
```

## `session show SESSION_ID`

Detailed intelligence for a single session: tool-call summary, cost breakdown, message counts, linked feature/documents, risk signals.

```text
ccdash session show SESSION_ID [--output ...]
```

### JSON shape (key fields)

| Field | Meaning |
|---|---|
| `session_id`, `root_session_id`, `feature_id` | Stable identity + linkage. |
| `started_at`, `ended_at`, `duration_seconds` | Timing. |
| `cost`, `token_input`, `token_output`, `model` | Usage. |
| `tool_calls` | Array summarizing tool usage (counts + top tools). |
| `message_counts` | Human / assistant / system / tool totals. |
| `linked_documents` | `{document_id, doc_type, path}` entries. |
| `risk_signals` | `{signal, score, explanation}` — feeds `drilldown`. |
| `summary` | Server-curated narrative one-paragraph. |

## `session search QUERY`

Full-text search over session transcripts (min 2 characters).

```text
ccdash session search QUERY [--feature ID] [--root-session ID] [--session ID] [--limit INT=25] [--offset INT=0] [--output ...]
```

### JSON shape

```json
{
  "matches": [
    {
      "session_id": "...",
      "feature_id": "...",
      "timestamp": "...",
      "match_line": "...",
      "line_no": 1234,
      "role": "assistant"
    }
  ],
  "total": ...,
  "limit": 25,
  "offset": 0
}
```

Use `--feature` to scope to a feature's session set; `--session` to pin to a single session.

## `session drilldown SESSION_ID --concern {sentiment|churn|scope_drift}`

Targeted analysis of a specific concern using session telemetry.

```text
ccdash session drilldown SESSION_ID --concern sentiment
ccdash session drilldown SESSION_ID --concern churn
ccdash session drilldown SESSION_ID --concern scope_drift
```

- `sentiment` — frustration / confusion / confidence indicators across the transcript.
- `churn` — file-edit thrash (same files modified repeatedly).
- `scope_drift` — deviation from the feature's stated scope.

JSON returns `{session_id, concern, findings: [...], evidence_line_refs: [...]}`.

## `session family SESSION_ID`

Lists all sessions sharing the same root as `SESSION_ID` (resumes, branches, parallel agents).

```text
ccdash session family SESSION_ID [--output ...]
```

JSON returns `{root_session_id, sessions: [...], feature_id}`.

## Default Output Mode

`--json` for all five. Use `--md` only when the user explicitly wants a narrative render.

## Recipes

- `recipes/workflow-failure-rootcause.md` — `workflow failures` → pick worst → `session drilldown`.
- `recipes/session-cluster-investigation.md` — `session show` → `session family` → per-sibling drilldown.
- `recipes/feature-retrospective.md` — uses `feature sessions` then `session show` for top-cost sessions.

## Cross-Links

- Feature linkage: `command-feature.md`.
- Workflow linkage: `command-workflow.md`.
- Provenance echo list: `provenance.md`.
