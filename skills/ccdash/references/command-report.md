# `ccdash report` — Narrative Reports

Two subcommands: `aar` (after-action) and `feature` (narrative forensic). Both default to `--output markdown`; `--json` is a structured alternative when the agent needs to dissect the report (rare).

## `report aar --feature FEATURE_ID`

Curated after-action report for a feature: what happened, what went well, what hurt, costs, risk signals, suggested follow-ups.

```text
ccdash report aar --feature FEATURE_ID [--output human|json|markdown] [--json] [--md]
```

- `--feature` is required.
- Default mode: `markdown` — render verbatim to the user.

### Markdown shape (stable sections)

- `# AAR: <feature title> (FEATURE_ID)`
- `## Summary` — one paragraph.
- `## What Went Well`
- `## What Hurt`
- `## Cost & Timing`
- `## Signals` — risk flags (churn, scope drift, sentiment, etc.).
- `## Follow-ups` — suggested actions.
- Footer with `generated_at`, source `session_ids`.

### JSON shape (when `--json`)

`{feature_id, title, summary, sections: [...], cost_breakdown, signals, follow_ups, source_session_ids, generated_at}`.

## `report feature FEATURE_ID`

Narrative forensic report (less retrospective, more "current state explained"). Default markdown.

```text
ccdash report feature FEATURE_ID [--output human|json|markdown] [--json] [--md]
```

Markdown structure (stable sections):

- `# Feature Report: <title> (FEATURE_ID)`
- `## Status & Scope`
- `## Timeline`
- `## Contributing Sessions`
- `## Documents`
- `## Open Risks`
- Footer with `generated_at`.

## When To Use

- "Give me the AAR for FEAT-X" → `report aar --feature FEAT-X --md`, render verbatim.
- "Write a feature summary for FEAT-X" → `report feature FEAT-X --md`, render verbatim.
- Agent needs report structure for reasoning (rare) → `--json`.

## Rendering Rules

- Render markdown output **verbatim** to the user. Do not re-summarize; the server already curated.
- If the user asks for a tighter version, pull the JSON variant and synthesize a shorter summary from the structured fields.
- Do not save the report to disk unless the user asks (PRD open question #3; default is stream-to-agent).

## Recipes

- `recipes/feature-retrospective.md` — end-to-end: `feature show` → `feature sessions` → `report aar`.

## Cross-Links

- Feature detail: `command-feature.md`.
- Output mode rules: `output-modes.md`.
