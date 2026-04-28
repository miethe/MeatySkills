---
name: plan-review
description: Post-implementation retrospective on a completed implementation plan. Compares estimated story points against measured complexity (git stats, file counts, CCDash AAR), identifies which estimation heuristics failed, and emits actionable tuning suggestions for the planning skill. Use when a feature is done or near-done and the user asks for a retrospective ("why did X take so long", "review the plan for X", "AAR on X", "what did we miss in the estimate"), or proactively after any plan ≥5 pts completes. Complements CCDash's `feature-retrospective` recipe by adding heuristic-tuning analysis specific to SkillMeat's planning skill.
---

# Plan Review Skill

Post-implementation retrospective workflow for SkillMeat implementation plans. Closes the feedback loop between estimation (planning skill) and execution (dev-execution skill) by measuring actual complexity against the plan's `Estimation Sanity Check`.

## When To Use

Trigger on intents such as:

- "Why did `<feature-slug>` take so long?" / "AAR on `<feature-slug>`"
- "Review the plan for `<feature-slug>`" / "post-mortem on `<feature-slug>`"
- "What did we miss in the `<feature-slug>` estimate?"
- "Is the planning skill drifting?" / "tune our estimation heuristics"
- Proactive: any completed plan ≥5 pts, run a review before closing the branch

## When NOT To Use

- During mid-flight execution — use `karen` agent or `task-completion-validator` instead.
- For PRD-only documents (no implementation plan exists yet).
- For meta-plans, design specs, or reports — those don't have SP estimates to validate.
- Pure code review without estimation analysis — use `senior-code-reviewer` agent.

## Inputs

The skill accepts any of:

1. **Implementation plan path** (preferred): `docs/project_plans/implementation_plans/<category>/<slug>-v1.md`
2. **Feature slug**: skill resolves to plan path via filesystem search.
3. **Branch name**: skill infers slug from branch (e.g., `ica/team-features-filtering` → `ica-team-features-filtering`).

## Outputs

A single retrospective document at `.claude/findings/plan-review-<slug>-<YYYY-MM-DD>.md` containing:

1. **Metrics snapshot**: estimated vs actual (SP, weeks, LOC, file count, commit count, phase count).
2. **Variance analysis**: per-phase actual-vs-estimate with multiplier.
3. **Heuristic failure attribution**: which of H1–H6 (from `planning/references/estimation-heuristics.md`) would have caught the miss.
4. **Anchor update proposal**: this plan's actual cost should be added as a future anchor for similar features.
5. **Heuristic tuning suggestions**: if a pattern emerges across ≥3 reviews, propose constant adjustments (e.g., "raise H1 baseline from 2 pts to 2.5 pts based on N=4 reviews").
6. **Capture proposals**: candidate `learning` or `gotcha` memories to write to the SkillMeat memory system.

## Workflow

See `recipes/plan-retrospective.md` for the full step-by-step procedure.

**Quick summary**:

1. Resolve plan path from input.
2. Pull plan metadata (estimated SP, phase table, sanity check section, frontmatter dates).
3. Compute actual metrics from git (`git diff --stat main...<branch>`, commit count, file count, weeks elapsed).
4. Pull CCDash AAR (`ccdash report aar --feature <slug>` or MCP `ccdash_generate_aar`) for session/duration/failure context. Skip gracefully if CCDash unavailable.
5. Compute variance (actual / estimated) per phase and overall.
6. Map variance to heuristic failures using rules in `references/heuristic-attribution.md`.
7. Write the retrospective document.
8. Offer to capture candidate memories and (if pattern detected across recent reviews) propose updates to `planning/references/estimation-heuristics.md`.

## Integration with Other Skills

- **planning**: Source of estimation heuristics (`references/estimation-heuristics.md`). This skill validates and tunes them.
- **ccdash**: Source of feature forensics and AAR data. Use MCP when available (`ccdash_feature_forensics`, `ccdash_generate_aar`); fall back to CLI (`ccdash feature report`, `ccdash report aar`). See `references/ccdash-routing.md`.
- **artifact-tracking**: Reads progress files (`.claude/progress/<slug>/phase-*-progress.md`) to compute per-phase actual durations and any blockers logged.
- **skillmeat-cli**: Captures candidate memories (`learning` / `gotcha`) using the API fallback procedure.

## Heuristic Tuning Loop

After **every 3 reviews**, the skill aggregates findings to propose constant adjustments:

```
Reviews collected: 3+
For each heuristic H1–H6:
  - Count: how many reviews flagged this heuristic as a failure mode?
  - Pattern: is the failure consistently in one direction (under-count vs over-count)?
  - If ≥66% of reviews flag the same heuristic in the same direction:
    → Propose a constant adjustment in references/estimation-heuristics.md
    → Open a meta-plan at .claude/plans/heuristic-tuning-YYYY-MM-DD.md
    → Do NOT auto-edit the heuristics doc — surface to user for approval
```

This prevents single-feature noise from corrupting the heuristic constants.

## When Heuristics Aren't At Fault

Not every overrun is an estimation failure. The retrospective explicitly considers:

- **Scope creep**: PRD changed mid-flight; mark as scope variance, not estimation failure.
- **External blockers**: Deps not ready, tooling broke; mark as schedule variance.
- **Discovery work**: SPIKE that should have happened first; flag as a process gap, propose a `confidence-check` improvement.
- **Quality work that paid off**: Extra tests, refactor that prevented future debt; mark as good investment, no heuristic change needed.

The output document attributes variance to the right cause; only true estimation failures feed back into heuristic tuning.

## File Layout

```
.claude/skills/plan-review/
├── SKILL.md                              # this file
├── recipes/
│   └── plan-retrospective.md             # full step-by-step workflow
└── references/
    ├── heuristic-attribution.md          # variance → heuristic mapping rules
    └── ccdash-routing.md                 # CCDash MCP/CLI selection per query
```

## Related References

- `.claude/skills/planning/references/estimation-heuristics.md` — the heuristics this skill validates.
- `.claude/skills/ccdash/recipes/feature-retrospective.md` — CCDash's AAR recipe (this skill calls into it).
- `.claude/skills/artifact-tracking/SKILL.md` — progress file format, used to extract per-phase durations.
- `.claude/rules/memory.md` — capture procedure for `learning`/`gotcha` memories.
