---
name: post-incident-retrospective
trigger_patterns:
  - "codex had to patch"        # case-insensitive substring
  - "gaps after merge"
  - "we missed"
  - "regression after phase"
invoked_by: /fix:debug (auto) or explicit mode request
---

# Post-Incident Retrospective Mode

Structured retrospective that turns post-merge regressions into a patch-plan addendum.
Triggered automatically by `/fix:debug` when the prompt contains any trigger phrase above.

## When to Use

- Discovering bugs that shipped despite being in scope of a completed phase
- Any "Codex had to patch" / "we missed X" / "regression after phase N complete" scenario
- Debriefing a multi-phase delivery whose merge introduced cross-panel seam failures
- Generating an addendum to an existing plan rather than starting a new one

## Failure Taxonomy

Embed this table when classifying gaps so Claude reasons against it inline:

| Class | Symptom | Root lever it exposes |
|---|---|---|
| **Ambiguous AC scope** | "filters lists/graph" — which panels? | Planning grammar lacks a `target_surfaces` field |
| **Seam ownership gap** | FE + BE owners but nobody owned propagation | Phase schema lacks `integration_owner` / `seam_tasks` |
| **Contract-only tests** | Payload shape asserted, rendered output not | Verification phase lacks AC↔test matrix |
| **No visual/runtime gate** | Serif font leak, missing density vars undetected | No mandatory browser smoke gate on UI phases |
| **Batch-flip completion** | Phase marked done with `started: null, completed: null` | artifact-tracking allows completion without timing |
| **Implicit resilience** | FE assumed `statusCounts` always present | Planning grammar has no `resilience` AC bucket |

Source: Delivery Quality Improvements Spec §2 (motivating incident: ccdash-planning-reskin-v2-interaction-performance-addendum).

## Workflow

### Step 1 — Locate plan + progress artifacts

Identify the relevant implementation plan and phase progress files.
The prompt usually names a feature or phase; use it to find:

```
docs/project_plans/implementation_plans/**/<prd-slug>.md
.claude/progress/<prd-slug>/phase-*-progress.md
```

Read plan frontmatter + phase tables.  Read progress task lists (status, evidence, verified_by fields).
Delegate pattern discovery to `codebase-explorer` (Haiku) if file locations are unclear.

### Step 2 — Enumerate gaps

For each reported regression or missed item:
1. State the symptom in one line.
2. Locate the AC or task in the plan that should have covered it.
3. Note whether it was `verified_by` any task.

### Step 3 — Classify against taxonomy

Map each gap to one or more classes from the table above.
Use exact class names so the addendum is machine-scannable.

Example classification block:

```
Gap: Status-Distribution filter not propagating to PlanningGraphPanel
  AC: R3.4 "Status Distribution filter narrows planning surfaces"
  Covered by: P16-003 (verified_by field was absent)
  Class: Ambiguous AC scope (no target_surfaces listed), Seam ownership gap (no seam task for FE propagation)
```

### Step 4 — Draft patch-plan addendum

Append a new section to the existing implementation plan file.
Do NOT create a new plan.  Do NOT overwrite any existing section.

**Output location:** same file as the referenced implementation plan, appended as:

```markdown
## Addendum: post-incident <YYYY-MM-DD>

### Incident Summary
<1-3 sentences>

### Gap → Taxonomy Mapping
| Gap | AC | Class(es) | Missing element |
|---|---|---|---|
| … | … | … | … |

### Patch Tasks

#### PT-001: Add target_surfaces to AC R3.4
- target_surfaces:
  - components/Planning/PlanningSummaryPanel.tsx
  - components/Planning/PlanningGraphPanel.tsx
  - [additional panels]
- assigned_to: ui-engineer-enhanced
- seam_tasks: [PT-003]

#### PT-002: Add resilience AC for statusCounts
- resilience: if payload lacks statusCounts, filter controls render disabled with tooltip
- assigned_to: ui-engineer-enhanced

#### PT-003: Seam task — propagation wire from BE filter to every target_surface
- integration_owner: ui-engineer-enhanced
- depends_on: [PT-001, PT-002]
- smoke_gate: runtime screenshot at ≥1440px for each target_surface

#### PT-004: Runtime smoke gate (was missing from Phase N verification)
- task_type: smoke_gate
- ui_touched: true
- evidence_required: screenshot paths under .claude/evidence/phase-N/

### AC Coverage Gaps
List any AC that has zero verified_by references after the incident:
- AC R3.4: verified_by was empty → add P16-003 retroactively once smoke gate passes

### Recommended Planning Grammar Fixes
List `target_surfaces`, `seam_tasks`, `resilience`, and `visual_evidence_required` fields
that should have been present in the original phase definition.
```

Adjust PT-NNN ids to continue from the plan's existing task numbering.

### Step 5 — Optionally save feedback memory

If a classification pattern is non-obvious or recurring, emit a memory entry via the
auto-memory system:

```
Pattern: <class> recurred in <prd-slug>
Observation: <1-2 line description of the non-obvious aspect>
Recommendation: <what to add to the plan template next time>
```

Save only when genuinely surprising — not for every incident.

## Agent Assignments for Retrospective Work

| Task | Agent | Model |
|------|-------|-------|
| Locate plan/progress files | codebase-explorer | Haiku |
| Gap classification + addendum draft | lead-architect | Opus |
| Patch task implementation (UI seams) | ui-engineer-enhanced | Sonnet |
| Patch task implementation (BE contracts) | python-backend-engineer | Sonnet |
| Smoke gate execution | task-completion-validator | Sonnet |

## Output Checklist

Before closing the retrospective:

- [ ] All reported gaps classified against taxonomy table
- [ ] Patch-plan addendum appended to existing plan file (not a new file)
- [ ] Every patch task has: `assigned_to`, `target_surfaces` (if UI), `seam_tasks` or `smoke_gate` where applicable
- [ ] Each original AC that was uncovered now has a `verified_by` candidate in the addendum
- [ ] Memory entry saved if pattern was non-obvious

## Related Modes

- [Comprehensive Remediation](./comprehensive-remediation.md) — for active bugs requiring a fix plan
- [Triage](./triage.md) — for severity assessment before deciding to enter retrospective mode
