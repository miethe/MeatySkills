# Recipe: Plan Retrospective

End-to-end workflow for reviewing a completed implementation plan.

## Step 1 — Resolve Inputs

Accept any of:

- Implementation plan path
- Feature slug
- Branch name (infer slug)

Resolve to:
- `<plan_path>`: implementation plan markdown
- `<slug>`: feature slug (matches frontmatter `feature_slug` and `.claude/progress/<slug>/` dir)
- `<branch>`: git branch where the work landed (default: current branch if it matches slug)
- `<base_branch>`: typically `main`

If the progress dir has a version suffix (`<slug>-v1`), `ls -d .claude/progress/<slug>*` to find it.

## Step 2 — Pull Plan Metadata

Read **only** the plan's frontmatter, Phase Summary table, and Estimation Sanity Check section. Do **not** read the full plan; it's already represented by its summary.

Extract:
- `estimated_sp` (frontmatter `effort_estimate`)
- `estimated_timeline` (frontmatter `timeline`)
- `created_date`, `updated_date`
- `phases[]`: each with `phase_num`, `title`, `estimated_pts`, `target_subagents`
- `sanity_check`: H1–H6 values if populated; `null` if the plan predates the heuristics

## Step 3 — Compute Actual Metrics from Git

```bash
# Files and LOC
git diff --stat <base_branch>...<branch> | tail -1
# Net python LOC (excluding tests)
git diff --stat <base_branch>...<branch> | grep -E "\.py" | grep -v test | awk '{sum+=$3} END {print sum}'
# Test LOC
git diff --stat <base_branch>...<branch> | grep test.*\.py | awk '{sum+=$3} END {print sum}'
# Commit count
git log --oneline <base_branch>..<branch> | wc -l
# Date range
git log --format="%aI" <base_branch>..<branch> | sort | sed -n '1p;$p'
# Files-by-layer rough count
git diff --name-only <base_branch>...<branch> | grep -E "(routers|services|repositories|migrations)" | sort | uniq -c
```

Compute:
- `actual_loc_total`, `actual_loc_nontest`, `actual_loc_test`
- `actual_files_changed`, `actual_files_new`
- `actual_commits`
- `actual_weeks` = ceil((last_commit_date - first_commit_date) / 7 days)
- `actual_phases_completed` (from `.claude/progress/<slug>/phase-*-progress.md` status fields)

## Step 4 — Pull Per-Phase Durations from Progress Files

For each `phase-N-progress.md`:
- Read frontmatter only (`status`, `created`, `updated`, `actual_effort` if recorded)
- If `status: completed`, count actual duration from progress file's first→last commit referencing that phase

Per-phase actuals let you see whether overruns concentrated in one layer or spread across all phases (a global multiplier vs a localized algorithmic miss).

## Step 5 — Pull CCDash AAR (Optional)

Prefer CCDash MCP tools when available:
- `ccdash_feature_forensics` (feature_id matches `<slug>`)
- `ccdash_generate_aar`

CLI fallback:
```bash
ccdash report aar --feature <slug> --md
ccdash feature report <slug> --json
```

Skip gracefully if CCDash is unavailable in the project; record `ccdash_data: null` in the output.

Extract from AAR (when available):
- Session count, total session hours
- Failure-burden percentage (sessions that ended in error/rollback)
- Top 3 failure categories
- Notable rework cycles (file edited >5× in one branch)

## Step 6 — Compute Variance

```
overall_multiplier = actual_effort_pts / estimated_sp
```

Where `actual_effort_pts` is derived from one of:
1. **Preferred**: CCDash's AAR effort estimate if available.
2. **Fallback**: LOC-based proxy: `(actual_loc_nontest / 1500) + (actual_loc_test / 2000)` pts (rough — calibrated to SkillMeat history; document the assumption).
3. **Wall-clock**: `actual_weeks * 5` pts (assumes 5pt/week velocity).

Per-phase: same calculation against each phase's `estimated_pts`.

## Step 7 — Map Variance to Heuristic Failures

Use `references/heuristic-attribution.md` to attribute each phase's variance to a likely heuristic miss. For each flagged heuristic, write a one-paragraph evidence statement citing concrete file counts or phase data.

**Important**: also categorize variance that is NOT a heuristic failure:
- `scope_change`: PRD or plan was modified mid-flight (check `git log` on the plan file)
- `external_blocker`: progress file mentions blocker waiting on external dep
- `discovery_work`: SPIKE-shaped exploration happened during execution
- `quality_investment`: extra tests/refactor that pays forward (not a miss)

## Step 8 — Write Retrospective Document

Output: `.claude/findings/plan-review-<slug>-<YYYY-MM-DD>.md`

Frontmatter:
```yaml
---
schema_version: 2
doc_type: report
report_category: post-mortem
title: "Plan Review: <feature title>"
status: draft
source: agent
created: <today>
feature_slug: <slug>
plan_ref: <plan_path>
overall_multiplier: <X.Y>
heuristics_flagged: [H1, H3, H6]   # which heuristics had attributed failures
---
```

Body sections (template):

```markdown
## Summary
<one-paragraph headline: estimated X pts → actual ~Y pts (Zx multiplier). Top 2 root causes.>

## Metrics
| Metric | Estimated | Actual | Multiplier |
|--------|-----------|--------|------------|
| Story Points | X | Y | Zx |
| Timeline (weeks) | X | Y | Zx |
| Files changed | (proxy from H1) | N | — |
| Non-test LOC | — | N | — |
| Test LOC | — | N | — |
| Commits | — | N | — |
| Phases completed | N | N | — |

## Per-Phase Variance
| Phase | Title | Estimated | Actual (proxy) | Multiplier | Notes |
|-------|-------|-----------|----------------|------------|-------|

## Heuristic Failure Attribution
### H<N>: <heuristic name> — flagged
**Evidence**: <concrete data>
**What would have caught it**: <how applying H<N> bottom-up would have changed the estimate>
**Suggested action**: <re-anchor / add fixture list / SPIKE / etc.>

(repeat for each flagged heuristic)

## Variance NOT Attributed to Estimation
- <scope change / external blocker / quality investment, with evidence>

## Anchor Update Proposal
Add this completed feature as an anchor for future similar plans:
- **Surface**: N tables, M endpoints, K services
- **Actual cost**: Y pts over Z weeks
- **Best comparator for**: <list of plan archetypes this anchors>

## Heuristic Tuning Suggestions
<only populated when ≥3 reviews flag the same heuristic in the same direction; otherwise "insufficient data, monitoring">

## Candidate Memories
- `learning`: <one-liner candidate; user must approve before capture>
- `gotcha`: <one-liner candidate>

## CCDash Provenance (if available)
- feature_id, generated_at, data_freshness, source_refs
```

## Step 9 — Offer Follow-Ups

Present to the user:
1. "Want me to capture the candidate memories?" (uses `skillmeat-cli` memory capture procedure)
2. "Want me to add this feature as an anchor in `estimation-heuristics.md`?"
3. If pattern detected: "Heuristic H<N> has been flagged in M of last 3 reviews. Want me to draft a tuning proposal at `.claude/plans/heuristic-tuning-<date>.md`?"

Do **not** auto-edit `estimation-heuristics.md`. All heuristic constant changes must go through user-approved meta-plans.

## Anti-Patterns

- Do not read the full implementation plan when summary metadata suffices (~5K tokens saved).
- Do not invent CCDash commands not shipped in the repo (see `references/ccdash-routing.md`).
- Do not conflate scope changes with estimation failures — they require different fixes.
- Do not propose heuristic adjustments based on a single retrospective.
- Do not auto-capture memories without user approval.
