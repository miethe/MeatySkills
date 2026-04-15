---
name: plan-status
description: "Cross-feature visibility layer for implementation plans, PRDs, and progress files. Use when: checking what's in progress, auditing stale plan statuses, remediating mismatches between frontmatter and task reality, summarizing active work, investigating orphaned/superseded PRDs. Complements artifact-tracking (which handles per-phase task updates). Routes intent to scripts/plan-status-report.py and artifact-tracking scripts."
---

# Plan Status Skill

Cross-feature visibility layer. Routes natural language intent to Python scripts — never reads plan files directly.

**Scope**: Cross-feature aggregation only. For per-phase task updates, use the `artifact-tracking` skill.

---

## Route 1: Status Report

**Triggers**: "show plan status", "what's in progress", "planning status", "incomplete plans", "feature overview"

Default (last 3 weeks):
```bash
python scripts/plan-status-report.py --period 21
```

Variations:
```bash
# All time
python scripts/plan-status-report.py --all

# JSON output
python scripts/plan-status-report.py --period 21 --format json

# Save to file (use when asked to "save" or "write" a full report)
# Includes design-specs + meta-plans alongside default PRD/impl/progress.
# Reports live in the dedicated planning-status/ subdirectory.
python scripts/plan-status-report.py --all --include-pre-plan --include-meta --format markdown \
  --output docs/project_plans/reports/planning-status/$(date +%Y-%m-%d)-planning-artifacts-status.md
```

**Summarize in conversation**: total counts by effective status (completed / in-progress / planned), count of inferred updates, mismatch count. Do not paste full report into context — point to the output file if saved.

### Report structure (Route 1 markdown)

1. **Summary** — counts by `effective_status` (propagated, not raw).
2. **Inferred Updates** — every doc whose effective status differs from its raw frontmatter status, labeled with source (`inferred_from_plan` / `inferred_from_progress`). Surface these when asked "what changed" or "what's actually done".
3. **Documents by Type** — one GFM table per doc type in this order: `prd`, `implementation`, `progress`, `design-spec`, `meta-plan`, `report`. Columns: Status · Raw · Title · Feature · Created · Updated · Related PRD · File. Inferred statuses show a `*` suffix (e.g. `completed*`) with the original value in the Raw column.
4. **Mismatches** — progress files where task completion state disagrees with the file's own `status` field (see Route 2).

### Status propagation rules

The script computes `effective_status` by grouping docs via `feature_slug` (primary) or `prd_ref`/`plan_ref` (fallback):

- **Progress rollup**: A feature's progress is `completed` only when every progress file in its `.claude/progress/<slug>*/` directory is done AND all tasks within those files are `completed`/`done`.
- **Implementation plan**: inherits `completed (inferred from progress)` when the rollup is complete and its raw status isn't already terminal.
- **PRD**: inherits `completed (inferred from plan)` when any linked impl plan is effectively completed; otherwise `completed (inferred from progress)` when the rollup is complete.
- Raw status is **always preserved** and visible in the Raw column — propagation never mutates files.

Use this when a PRD is still marked `draft` but the implementation shipped — the report will surface it as `completed*` instead of hiding it.

---

## Route 2: Mismatch Audit

**Triggers**: "check mismatches", "stale progress", "audit plan status", "frontmatter drift"

```bash
python scripts/plan-status-report.py --all --mismatches-only
```

Categorize the output into three buckets:

| Category | Signal | Fix |
|----------|--------|-----|
| **Auto-fixable** | Progress file: all tasks done, `status` field stale | `manage-plan-status.py --status completed` |
| **Task-level stale** | Plan status `completed` but individual tasks still `pending` | `update-batch.py` |
| **Review needed** | Plan `completed` but phases have genuinely unresolved tasks | Flag for human — do not auto-fix |

Present the categorized summary in conversation. Offer to run Route 3 for auto-fixable items.

---

## Route 3: Batch Remediation

**Triggers**: "fix stale progress", "remediate mismatches", "update stale statuses", "clean up frontmatter"

For each auto-fixable progress file (all tasks done, status stale):
```bash
# Fix progress file status
python .claude/skills/artifact-tracking/scripts/manage-plan-status.py \
  --file .claude/progress/<slug>/phase-N-progress.md --status completed

# Fix individual stale tasks (if plan is confirmed complete but tasks are pending)
python .claude/skills/artifact-tracking/scripts/update-batch.py \
  -f .claude/progress/<slug>/phase-N-progress.md \
  --updates "TASK-N.1:completed,TASK-N.2:completed"
```

**Skip** statuses: `deferred`, `future`, `blocked`, `partial`, `deviated`, `at_risk` — these are intentional non-complete states.

**Do not auto-fix** items in the "Review needed" category.

Report what was fixed and what requires manual attention.

---

## Route 4: Active Work Summary

**Triggers**: "what am I working on", "active features", "current work", "what's active"

```bash
python scripts/plan-status-report.py --period 21
```

Filter the output to show only:
- `effective_status: in-progress` — features with some phases done
- `effective_status: planned` — features approved but not yet started

Present as a brief list in conversation: feature slug, phases done/total, plan status. Skip completed features unless asked.

---

## Route 6: Pre-Plan Intake Status

**Triggers**: "what design-specs are ready", "pre-plan intake", "design spec status", "ready to promote", "orphaned specs", "active meta-plans"

```bash
python scripts/plan-status-report.py --route6
```

Surfaces four things:
- design-specs with `maturity: ready` AND no `prd_ref` — ready to promote to PRD
- design-specs stale >30 days in `maturity: shaping` — may need unblocking
- orphaned design-specs — no `prd_ref` in frontmatter
- meta-plans in `docs/project_plans/meta-plans/` with `status: in-progress` or `active` — active workflow/tooling changes

**Use this route** at the start of planning sessions to identify what pre-PRD work is actionable and what workflow changes are in flight.

---

## Route 7: Findings Triage

**Triggers**: "triage findings", "archive old findings", "findings cleanup", "stale findings", "missing frontmatter"

```bash
python scripts/plan-status-report.py --route7
```

Surfaces `.claude/findings/` files for archival:
- Files missing frontmatter entirely (lint targets — all need frontmatter backfill)
- Files >60 days old with no `promoted_to` reference (archive candidates)
- Groups output by size bucket and age bucket
- Honours `archive_exempt: true` in frontmatter (excludes file from triage)

Archival target: `.claude/findings/archive/YYYY-MM/`

---

## Route 5: Superseded PRD Investigation & Cleanup

**Triggers**: "what's the deal with [PRD]", "is this PRD still relevant", "this plan has no implementation", "investigate [feature] status", "clean up dead plans"

**When to use**: A PRD exists but appears orphaned — no implementation plan, empty progress files, or work was done under a different feature slug.

**Investigation steps**:

1. Read the PRD frontmatter (status, feature_slug, related_documents)
2. Check for implementation plan at expected path — may be empty (0 lines) or missing
3. Check for progress files: `ls .claude/progress/<feature_slug>/`
4. Search for actual code: `grep -rn "<feature_keyword>" skillmeat/` to find if work landed elsewhere
5. Cross-reference related PRDs/plans to identify where work was absorbed

**Diagnosis categories**:

| Diagnosis | Signal | Action |
|-----------|--------|--------|
| **Superseded** | Work absorbed into other features; impl plan empty/missing | Mark `status: superseded` with `superseded_by` and `superseded_note` in frontmatter |
| **Abandoned** | No code exists, no related feature absorbed the work | Mark `status: abandoned` with rationale |
| **Misattributed** | Code exists but tracked under wrong slug | Fix slug references or merge progress files |

**Cleanup actions**:

```yaml
# 1. Update PRD frontmatter
status: superseded
superseded_by:
  - path/to/successor-plan-1.md
  - path/to/successor-plan-2.md
superseded_note: >
  Brief explanation of what absorbed the work and where the code lives.

# 2. Update related design specs similarly

# 3. Delete empty artifacts
rm docs/project_plans/implementation_plans/<category>/<slug>.md  # if 0 lines
rm -r .claude/progress/<slug>/  # if all files empty or planning-only
```

**Do not delete** progress files that contain actual task completion data — those have historical value even if the parent PRD is superseded.

---

## Route 8: Ready to Implement

**Triggers**: "what should I work on next", "what's ready to implement", "next wave", "actionable meta-plans", "what needs a PRD", "ready to execute"

```bash
python scripts/plan-status-report.py --route8
python scripts/plan-status-report.py --route8 --format json
```

Surfaces the next actionable wave from every non-done meta-plan across `.claude/plans/` and `docs/project_plans/meta-plans/`, plus in-progress implementation plans not already covered by a meta-plan wave.

Output columns: Priority | Feature | Next Wave | Items | Artifacts | Source

- **Feature**: meta-plan title
- **Next Wave**: "Wave {id}: {title}" — first wave not marked done/deferred
- **Items**: non-completed item titles from the wave (truncated to 80 chars); empty for heuristic-parsed meta-plans without structured `waves` frontmatter
- **Artifacts**: up to 3 markdown links (`prd`, `impl`, `spec`, `spike`, `progress`) derived from item artifact fields
- **Source**: the meta-plan file path

A separate **Blocked Waves** section lists waves where effective status is `blocked` (explicit or auto-derived from item statuses).

**Wave status auto-derivation** (when `status` not explicit on the wave):
- All items `completed` → `completed`
- Any item `in-progress` → `in-progress`
- Any item `blocked` (none in-progress) → `blocked`
- All items `deferred` → `deferred`
- Otherwise → `planned`

**Fallback heuristic** (meta-plans without structured `waves` frontmatter): parses Markdown headings matching `Wave N: Title` and returns the first not followed immediately by a done keyword.

**Use this route** at the start of a work session to identify the single highest-priority next wave across all active planning threads.

---

## Script Reference

| Script | Location | Purpose |
|--------|----------|---------|
| `plan-status-report.py` | `scripts/` | Cross-feature status aggregation, mismatch detection, Routes 6 + 7 |
| `manage-plan-status.py` | `.claude/skills/artifact-tracking/scripts/` | Update plan/progress frontmatter fields |
| `update-batch.py` | `.claude/skills/artifact-tracking/scripts/` | Batch-update task statuses in progress files |
| `update-status.py` | `.claude/skills/artifact-tracking/scripts/` | Single task status update |

## Key Flags for plan-status-report.py

| Flag | Effect |
|------|--------|
| `--period N` | Limit to files modified in last N days (default: 21) |
| `--all` | All files regardless of age |
| `--mismatches-only` | Only output mismatch cases (Route 2) |
| `--format markdown\|json` | Output format (default: markdown) |
| `--output FILE` | Write to file instead of stdout |
| `--include-pre-plan` | Add `design-spec` to discovery scope |
| `--include-meta` | Add `meta-plan` to discovery scope |
| `--include-reports` | Add `report` to discovery scope |
| `--all-types` | Enable all three extension sets |
| `--route6` | Route 6: Pre-Plan Intake Status |
| `--route7` | Route 7: Findings Triage |
| `--route8` | Route 8: Ready to Implement (meta-plan wave triage) |

**Default discovery** (always enabled): `prd`, `implementation_plan`, `progress`

**Extension discovery** (opt-in flags above): `design-spec`, `meta-plan`, `report`

**Output header**: Every run prints one line at the top: `Scanned: prd, implementation_plan, progress [, design-spec] [, meta-plan] [, report]`

**Report output directory**: `docs/project_plans/reports/planning-status/`. Always write planning-artifacts status reports here (not the parent `reports/` dir). Filename convention: `YYYY-MM-DD-planning-artifacts-status.md`.

## Intentional Non-Complete Statuses (Never Auto-Fix)

`deferred` · `future` · `blocked` · `partial` · `deviated` · `at_risk`

These represent deliberate decisions, not stale data.

## Relationship to artifact-tracking

- **artifact-tracking**: Per-phase task management — updating individual task statuses, creating progress files, querying blockers within a feature.
- **plan-status**: Cross-feature aggregation — what is the state of all features, where are the mismatches, what is actively in flight.

Use both together: plan-status finds which features need attention; artifact-tracking fixes them.
