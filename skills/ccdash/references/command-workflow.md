# `ccdash workflow` — Workflow Diagnostics

Current surface: one subcommand, `failures`. Honors `--output {human|json|markdown}` with `--json` / `--md` shortcuts.

## `workflow failures`

Workflows with the highest observed failure burden (repeat failures, most recent failures weighted higher, scoped by feature if requested).

```text
ccdash workflow failures [--feature FEATURE_ID] [--output ...]
```

- `--feature` — scope to a single feature. Without it, returns project-wide burden.

### JSON shape

```json
{
  "workflows": [
    {
      "workflow_id": "test:e2e:auth",
      "failure_count": 12,
      "last_failure_at": "2026-04-12T18:43:00Z",
      "feature_ids": ["FEAT-123", "FEAT-456"],
      "linked_session_ids": ["..."],
      "recent_failure_summaries": [
        { "session_id": "...", "timestamp": "...", "excerpt": "..." }
      ],
      "burden_score": 0.83
    }
  ],
  "generated_at": "...",
  "scope": { "feature_id": null }
}
```

Fields:

- `burden_score` — normalized 0..1; decay-weighted count of failures.
- `recent_failure_summaries` — one-line excerpts per recent failure; feeds `session drilldown` nicely.
- `feature_ids` — all features touched by this workflow's failures (cross-feature flakiness detector).

## When To Use

- "Which workflows are failing?" → `workflow failures --json`.
- "Is this flakiness tied to FEAT-X?" → `workflow failures --feature FEAT-X --json`.
- As an anchor for `recipes/workflow-failure-rootcause.md`.

## Default Output Mode

`--json` — the first step of a rootcause recipe almost always feeds subsequent `session drilldown` calls.

## Cross-Links

- Session drilldown: `command-session.md` → `session drilldown --concern`.
- Rootcause recipe: `recipes/workflow-failure-rootcause.md`.
- Feature linkage: `command-feature.md`.
