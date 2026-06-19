---
schema_version: 2
doc_type: reference
title: "Workflow Registry — SkillMeat Authoritative Index"
status: active
created: 2026-06-01
updated: 2026-06-03  # auto-feature (autopilot lane) registered active; powers /dev:autopilot
owner: nick
related_documents:
  - .claude/specs/workflows/workflow-authoring-spec.md
  - .claude/plans/workflow-orchestration-integration-v1.md
---

# Workflow Registry

This file is the authoritative index of every SkillMeat workflow — current and planned. Every entry must conform to the master contract in `.claude/specs/workflows/workflow-authoring-spec.md`. No workflow script is saved to `.claude/workflows/` or per-workflow spec authored to `.claude/specs/workflows/` without a corresponding entry here.

New workflows are added to this registry when authored via the (future) `workflow-authoring` skill (Phase 5). Until that skill exists, registry entries are authored directly by the `ai-artifacts-engineer` following §13 of the master contract.

**Maintenance ownership**: nick. Update the `updated` frontmatter date on every change.

---

## Registered Workflows

| Workflow | Spec | Script | Status | Owner | Introduced | Notes |
|---|---|---|---|---|---|---|
| `execute-plan` | `.claude/specs/workflows/execute-plan-workflow-spec.md` | `.claude/workflows/execute-plan.js` | `active` | nick | P1 | Prime target. Drives Tier 2/3 wave execution: sequential waves, parallel phases, file-ownership batching, reviewer gates, tracker steps. Replaces the manual Opus wave loop in `/dev:execute-plan`. Pilot runs against one real Tier 2 plan before retiring the manual fallback. |
| `execute-contract` | `.claude/specs/workflows/execute-contract-workflow-spec.md` | `.claude/workflows/execute-contract.js` | `active` | nick | P2 | Tier 1 autonomous sprint. Implements the sprint → validate → fix-loop pattern for a single Feature Contract. Resumable fix-loop with budget guard; `task-completion-validator` / `karen` / `council-review` reviewer gate (routing by review_intensity). Mode D boundary check before sprint spawns. Measured against the ~326K trial baseline from the current single-`feature-sprint-executor` path. |
| `explore` | `.claude/specs/workflows/explore-spike-workflow-spec.md` | `.claude/workflows/explore.js` | `active` | nick | P3 | Pre-commitment exploration. Parallel investigation legs (read-only `codebase-explorer` / `search-specialist`) → `pipeline` deep-read → `adversarialVerify` (2–3 skeptics) → `implementation-planner` synthesis → `completenessCritic` (budget-guarded). Returns `ExplorationCharter` result. Verdict sign-off stays with Opus + human; workflow always returns `needs_opus / verdict_signoff`. |
| `spike` | `.claude/specs/workflows/explore-spike-workflow-spec.md` | `.claude/workflows/spike.js` | `active` | nick | P3 | Research SPIKE. Same phase structure as `explore`. Produces schema-valid `FeasibilityBrief` with `verdict`, `verdict_confidence`, `risk_summary`, `cost_estimate_range`. Supports standalone SPIKE and exploration-leg mode (`args.leg_of`). Verdict sign-off stays with Opus + human; workflow always returns `needs_opus / verdict_signoff`. |
| `review-council` | `.claude/specs/workflows/review-council-workflow-spec.md` | `.claude/workflows/review-council.js` | `active` | nick | P4 | Agent Review Council (ARC) wrapper. Embeds the `council-review` skill as a deterministic workflow step. Operates standalone (direct invocation) and as an embedded `review_intensity: council` gate inside `execute-plan`. Produces the full ARC artifact set: `findings.yaml`, `scorecard.json`, `risk_register.yaml`, `decision_record.md`, `validation_plan.md`. Seeded-bug gate test required before Phase 4 exit. |
| `auto-feature` | `.claude/specs/workflows/auto-feature-workflow-spec.md` | `.claude/workflows/auto-feature.js` | `active` | nick | P7 | Autopilot lane (`/dev:autopilot`). Takes a RAW request (no PRD/contract): `implementation-planner` classifies + decomposes + writes a durable plan artifact (Stage A, no schema) -> haiku structurer extracts an `AutopilotPlan` (Stage B, schema) -> deterministic single-pass feasibility gate -> nests `execute-contract` (single wave) or `execute-plan` (<=3 waves). Escalates to full planning via `needs_opus` reasons `mode_d` / `spike_required` / `scope_exceeds_single_pass`, always leaving the plan artifact on disk. Implements the recalibrated single-pass capacity from `tiered-workflow-overhaul.md` 12. One level of `workflow()` nesting only. |

---

## Future Candidates (registered, not built)

The following workflows are registered per §5.5 of the integration plan. Each requires a per-workflow spec and script; none are in scope until the primary five workflows are piloted and the `workflow-authoring` skill exists (Phase 5+).

| Workflow | Intended scope | Status |
|---|---|---|
| `release` | Version bump → OpenAPI regeneration → SDK release → changelog audit → tag. Replaces the manual multi-command release sequence. Scope: `release` + `changelog-sync` skill integration with worktree isolation for the version-bump commit. | `candidate` |
| `migrate-sweep` | N-file schema migration or large refactor with per-file worktree isolation. Each file processed as a `pipeline` item through extract → transform → validate stages. Scope: data-layer and cross-cutting migrations that currently require manual wave management. | `candidate` |
| `audit` | Codebase-wide bug or security sweep. Fans out `security-review` or `code-reviewer` agents across file groups via `pipeline`; synthesises findings into a ranked issue register. Scope: periodic audits triggered manually or on schedule. | `candidate` |
| `docs-sync` | Authoring-to-docs-site sync pipeline. Runs `sync-from-source.py`, validates MkDocs nav consistency, commits to `skillmeat-docs`. Codifies the manual sync step from `.claude/rules/docs-site-sync.md`. | `candidate` |
| `symbols-refresh` | Regenerates `ai/symbols-*.json` graph artifacts after structural changes. Coordinates `symbols-engineer` agents, validates output against graph schema, commits refreshed symbols. | `candidate` |

---

## Authoring a New Workflow

Invoke `Skill("workflow-authoring")` first. The skill operationalizes the full procedure:

1. Load `.claude/specs/workflows/workflow-authoring-spec.md` (master contract) and the per-workflow spec.
2. Read or author a per-workflow spec at `.claude/specs/workflows/<name>-workflow-spec.md`
   (template: `.claude/skills/workflow-authoring/per-workflow-spec-template.md`).
3. Choose patterns from `.claude/skills/dev-execution/orchestration/workflow-patterns.md`.
4. Author the script at `.claude/workflows/<name>.js`, passing the four-constraints checklist (§5 of master contract).
5. Validate syntax via `.claude/skills/workflow-authoring/syntax-check-helper.js`.
6. Add a row to the **Registered Workflows** table above with all columns populated.
7. Update this file's `updated` frontmatter date.

**Skill reference**: `.claude/skills/workflow-authoring/SKILL.md`
