---
title: AC Schema Reference
doc_type: reference
created: 2026-04-22
updated: 2026-04-22
scope: planning skill — structured acceptance-criteria format and generator rules
---

# AC Schema Reference

Supplement to `SKILL.md §Plan Generator Rules`. Defines the structured AC markdown format, usage guidance, and answers the `target_surfaces` encoding question (§8 Q1 of the delivery-quality-improvements-spec).

## Structured AC Format

Use this format for any AC that (a) spans multiple UI surfaces, (b) involves a cross-owner propagation contract, or (c) introduces or depends on an optional backend field.

```markdown
#### AC [ID]: [Short description]
- target_surfaces:
    # Path strings relative to repo root (see §aq1-path-vs-symbol below).
    - components/Planning/PlanningSummaryPanel.tsx
    - components/Planning/PlanningGraphPanel.tsx
    - components/Planning/TrackerIntakePanel.tsx
    - components/Planning/PlanningAgentRosterPanel.tsx  # include only if linked
- propagation_contract: >
    [Describe exactly how the value is produced and consumed: route state, prop drilling,
    context, query param, etc. One sentence per surface if they differ.]
- resilience: >
    [Describe what each target_surface renders / does when the backend field is absent or null.
    "disabled with tooltip X" is acceptable; silence is not.]
- visual_evidence_required: >
    [Specify viewport + scenario, e.g. "before/after screenshots at desktop ≥1440px"
    OR set to false for non-visual ACs.]
- verified_by:
    - [task-id-in-verification-phase, e.g. P16-003]
    - [P16-012-smoke]
```

### Field Definitions

| Field | Required | Notes |
|---|---|---|
| `target_surfaces` | Yes (when AC uses scope words) | Path strings; see §aq1 below |
| `propagation_contract` | Yes (for cross-owner ACs) | Prose; may be one line per surface |
| `resilience` | Yes (when AC touches an optional backend field) | Explicit null/missing behavior |
| `visual_evidence_required` | Yes (UI-touching ACs) | Spec or `false`; never omit |
| `verified_by` | Yes (all ACs) | At least one verification-phase task ID |

## Generator Rules (summary)

Full rules live in `SKILL.md §Plan Generator Rules`. Quick reference:

| Rule | Trigger | Action |
|---|---|---|
| R-P1 | AC contains "across", "everywhere", "throughout", "all X", or "visible" | Expand with `target_surfaces:` list before emitting plan |
| R-P2 | Phase introduces new backend field X | Auto-add AC "FE handles missing X" with `resilience:` if not present |
| R-P3 | Phase has ≥2 owner specialties + `files_affected` intersection ≥1 | Add `integration_owner` to phase frontmatter + ≥1 seam task |
| R-P4 | Phase has any `*.tsx` in `files_affected` | Add a "runtime smoke" task to the verification phase |

## §aq1 — Path Strings vs Symbol Refs

**Decision (2026-04-22): Use path strings.**

`target_surfaces` entries are repo-relative path strings (e.g., `components/Planning/PlanningSummaryPanel.tsx`), not symbol-graph IDs.

**Rationale**: Symbol refs (`ai/symbols.graph.json` IDs) are more stable under rename but require the graph to be freshly generated at plan time. Path strings are universally resolvable without tooling, survive graph staleness, and are greppable. When the symbol graph is available and fresh, a generator MAY resolve path strings to symbol IDs for cross-linking, but path strings remain the canonical form in AC text.

**When the graph is available**, the generator may append a `symbol_ref:` comment inline:
```markdown
- components/Planning/PlanningSummaryPanel.tsx  # symbol: planning.PlanningSummaryPanel
```

## Concrete Example

```markdown
#### AC R3.4: Status Distribution filter narrows planning surfaces
- target_surfaces:
    - components/Planning/PlanningSummaryPanel.tsx
    - components/Planning/PlanningGraphPanel.tsx
    - components/Planning/TrackerIntakePanel.tsx
    - components/Planning/PlanningAgentRosterPanel.tsx
- propagation_contract: >
    Selected bucket/signal is written to route state by the filter control and read
    via usePlanningRouteState() in each target_surface's query/memo.
- resilience: >
    If payload lacks statusCounts, filter controls render disabled with tooltip
    "Backend did not supply status counts"; surfaces render with all rows visible.
- visual_evidence_required: before/after screenshots at desktop ≥1440px
- verified_by:
    - P16-003
    - P16-012-smoke
```

## Related

- `SKILL.md §Plan Generator Rules` — normative rule definitions
- `templates/phase-breakdown-template.md` — phase frontmatter fields (`integration_owner`, `ui_touched`, `target_surfaces`, `seam_tasks`)
- `artifact-tracking` skill — `validate-phase-completion.py`, `ac-coverage-report.py`
