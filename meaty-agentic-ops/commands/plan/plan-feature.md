---
description: Plan new features with tier-aware routing: Tier 0 → quick-feature, Tier 1 → Feature Contract, Tier 2/3 → PRD + Implementation Plan
allowed-tools: Task, Skill, Read, Write, Edit, Bash
argument-hint: "[request-or-file] [--impl-only|-i] [--plan-progress|-p] [--all|-a]"
---

**You are Opus. Tokens are expensive. You orchestrate; subagents execute.**

You must use subagents to perform all tasks, only delegating work. Use them wisely to optimize for reasoning, with all token-heavy work being delegated.

**Commit often.**

---

## Phase 0 — Exploration Charter Check (First Action)

Before tier classification, check whether this idea has already been through `/plan:explore`. This enforces the "no re-exploration of settled ground" guard from the meta plan §9 and auto-imports feasibility evidence when an exploration has cleared the idea.

**Steps**:

1. **Compute `feature_slug`** from `$ARGUMENTS` (kebab-case; same derivation Tier Classification will use).
2. **Charter probe**: check for `docs/project_plans/exploration/[feature-slug]/[feature-slug]-charter.md`.
3. **Branch on result**:

   | Condition | Action |
   |-----------|--------|
   | No charter found AND request looks speculative (no comparable past feature, no obvious deal-killer in the request, signaled high risk_level) | Suggest `/plan:explore` first as a **non-blocking** recommendation. Cite which speculative signals fired. Proceed to Tier Classification only if the user confirms. |
   | No charter found, request is concrete (clear past analog OR obvious low risk) | Proceed silently to Tier Classification. |
   | Charter found, `verdict: go` | Auto-import the feasibility brief into the resulting PRD/contract `related_documents`. Resolve the brief path as `docs/project_plans/exploration/[feature-slug]/[feature-slug]-feasibility-brief.md` and stage it for the planning skill (pass the path through `$ARGUMENTS` to downstream `prd-writer` / contract steps). Proceed to Tier Classification. |
   | Charter found, `verdict: no-go` | **Refuse to proceed.** Surface the archived rationale (`verdict_rationale` and `recommended_next_action` from the charter, plus the feasibility brief's verdict section) and stop. Do not run Tier Classification. The user must explicitly override by superseding the archive or invoking `/plan:explore` to reopen it. |
   | Charter found, `verdict: conditional` AND precondition is unmet | **Refuse to proceed.** Cite the precondition from the brief's `recommended_next_action` (e.g., `defer-until: [condition]`). Stop. |
   | Charter found, `verdict: conditional` AND precondition is met (user states it, or the precondition is timestamp/state-checkable and verifiable) | Auto-import the brief into `related_documents` and proceed to Tier Classification. |
   | Charter found, `verdict: null` (exploration in-progress) | Refuse to proceed. Direct the user to conclude the exploration via `/plan:explore --charter=[path]` first. |

**Read budget**: read ONLY the charter frontmatter and (when `verdict: go | conditional`) the brief frontmatter. Do NOT read the full charter body or full brief — those are for the planning skill's downstream subagents.

**Anti-pattern guard**: This phase exists to prevent two failure modes — (1) committing speculative ideas without exploration, and (2) re-litigating ideas that already have a verdict. Do not skip on grounds of "the user clearly wants to proceed"; the verdict IS the record of past human intent. An override is a deliberate action, not an inference.

---

## Tier Classification (First Action)

Before invoking any skill or creating any artifact, classify the feature tier. Tier drives everything downstream — artifact type, execution model, reviewer requirements, and model routing.

**Inputs** (parse from `$ARGUMENTS` or ask once):
- Estimated story points
- Scope (number of files/systems touched, inferred from request if not given)
- `risk_level`: low / medium / high (default low unless auth, payments, migrations, or data deletion are in scope)

**Decision rule** (from `.claude/skills/planning/SKILL.md` §"Tier Matrix"):

| Tier | Size | Planning artifact | Execution model |
|------|------|-------------------|-----------------|
| **0** | 1–3 pts, single file | none | `/dev:quick-feature` |
| **1** | 3–8 pts | Feature Contract | one autonomous sprint |
| **2** | 8–13 pts | PRD + Implementation Plan | phase-by-phase orchestration |
| **3** | 13+ pts | SPIKE + PRD + Implementation Plan | phase-by-phase orchestration |

**Classify first; proceed immediately based on tier.** Do not prompt the user unless the point estimate is genuinely ambiguous (i.e., you cannot form a confident estimate from the request).

---

## Tier Routing

### Tier 0 — Exit Early

Inform the user:

> This looks like a Tier 0 (1–3 pts, single file) change. Use `/dev:quick-feature` instead — no planning artifact needed.

**Stop.** Do not invoke any skill.

---

### Tier 1 — Feature Contract

**Do not** create a PRD, Implementation Plan, or progress files. The Feature Contract is the single planning artifact for Tier 1.

The `--impl-only`, `--plan-progress`, and `--all` flags are Tier 2/3-only and are **ignored** for Tier 1. The contract is always the only artifact.

**Steps**:

1. **Invoke planning skill**:
   ```
   Skill("planning")
   ```
   Follow the skill's "Workflow: Tier 1 Feature Contract" exactly.
   Reference: `.claude/skills/planning/SKILL.md` §"Workflow: Tier 1 Feature Contract"

2. **Output location**: `docs/project_plans/feature_contracts/[category]/[feature-slug].md`
   Categories: `features` | `enhancements` | `refactors` | `harden-polish` | `infrastructure`

3. **After contract is approved**, use `/dev:execute-contract <contract-path>` to run the sprint. Do not start execution here — this command is planning-only.

---

### Tier 2 — PRD + Implementation Plan + Decisions Block

**Mode flags** (parse from `$ARGUMENTS`):
- `--impl-only` or `-i`: Implementation Plan only (skip PRD)
- `--plan-progress` or `-p`: Plan + Progress tracking artifacts only
- `--all` or `-a` (default): Full process — PRD, Implementation Plan, progress files

**Mandatory Opus decisions block** (before delegating to `implementation-planner`):

Opus authors the decisions block directly using the template at `.claude/skills/planning/templates/decisions-block-template.md`. Write it to `.claude/worknotes/[feature-slug]/decisions-block.md` **before** delegating to `implementation-planner`. Do not delegate the decisions block authoring itself — this is the architectural judgment Opus earns its premium on. See skill §2.5 for the full decisions-block step.

**Steps**:

1. **Discovery Phase** — search request-logs for related items:
   ```
   /mc search "feature-keyword" skillmeat
   ```

2. **Invoke planning skill**:
   ```
   Skill("planning")
   ```
   Follow the skill's Workflow 1 (PRD from Feature Request) and Workflow 2 (Implementation Plan from PRD). The skill directs delegation to `prd-writer` and `implementation-planner`.

3. **Author decisions block** (Opus-direct, ~200 lines, before delegating to `implementation-planner`):
   - Phase boundaries, agent routing, risk hotspots, estimation anchors, dependency map, model routing per phase.
   - Output: `.claude/worknotes/[feature-slug]/decisions-block.md`

4. **Invoke artifact-tracking skill** (if not `--impl-only`):
   ```
   Skill("artifact-tracking")
   ```
   Follow skill's instructions to create progress files (ONE per phase) and context file (ONE per PRD).

**Mandatory reviewer gate**: `task-completion-validator` per phase; `karen` at end of feature.

---

### Tier 3 — SPIKE + PRD + Implementation Plan + Decisions Block

Same as Tier 2, plus:

- **SPIKE reference required**: Confirm a SPIKE doc exists or is authored first. Do not start the PRD until the SPIKE is complete or explicitly waived by the user.
- **`karen` per phase milestone** (not just at end): surface milestone checkpoints in the Implementation Plan.
- All Tier 2 steps and the mandatory decisions block apply.

---

## Understanding the Pattern

**The Pattern**:
1. You invoke a skill → skill expands with instructions/tools
2. You read the skill's instructions
3. You follow those instructions, which direct you to delegate to subagents

**Skills contain the logic; this command standardizes the invocation order.**

---

## Input Handling

`$ARGUMENTS` may contain:
- Inline feature description
- Path to PRD file
- Path to feature request document
- Mode flags (`--impl-only`, `--plan-progress`, `--all`)

Pass the full input to the skills — they will parse appropriately.

---

## Token Discipline (Mandatory)

**Before reading ANY source document (SPIKE, ADR, design spec, research), ask: "Will a subagent also read this?"** If yes, don't read it — provide the path instead.

### Delegation-First Checklist

1. **OQ Assessment**: If you need to check whether open questions are resolved:
   - **DO**: Delegate to haiku: `"Check if OQs in [design-spec] §N are resolved by [spike-findings]. Table format, under 200 words."`
   - **DON'T**: Read both documents into Opus context (~7K tokens wasted)

2. **PRD Delegation**: Prompt = file paths + frontmatter + scope + deferred items
   - **Target**: 30–50 lines. Paths to template, SPIKE, ADR, design spec
   - **DON'T**: Extract model schemas, API surfaces, or design rationale into the prompt

3. **Implementation Plan Delegation**: Prompt = PRD path + decisions-block path + template path
   - **Target**: 40–60 lines. Reference subagent assignments and multi-model guidance by path
   - **DON'T**: Copy task descriptions, code snippets, or SPIKE content into the prompt

4. **Progress File Delegation**: Prompt = implementation plan path + template path + output dir
   - **Target**: 20–30 lines. Agent extracts task IDs, descriptions, and dependencies itself
   - **DON'T**: Manually extract 45 task IDs and dependency chains into the prompt

### What Opus MAY Read Directly

- Tracker/meta-plan entry (~5–10 lines) — to determine readiness and mode
- Implementation plan's phase overview table (~20 lines) — for cross-reference edits
- Frontmatter of docs being updated (~15 lines) — for surgical edits

### What Opus Must NOT Read

- Full SPIKE findings (delegate comprehension to prd-writer)
- Full ADRs (prd-writer references these)
- Full implementation plan body (progress agent reads this)
- Phase breakout files (progress agent reads these)

---

## Critical Reminders

- **Never write code directly** — delegate to specialized subagents
- **Never explore codebases yourself** — use codebase-explorer
- **Never read source docs subagents will also read** — provide paths only
- **Focus on reasoning** — all implementation is delegated
- **Update progress immediately** after task completion
- **Commit after changes** — don't batch commits
- **Plan for deferrals upfront** — scan the PRD for deferred items, backlog items, open questions, and research-needed items. Every deferred item must get a design-spec authoring task in the final phase (DOC-006) so nothing is lost. See `.claude/skills/planning/references/deferred-items-and-findings.md`.
- **Findings doc is lazy** — only created on the first real finding during execution. Initialize `findings_doc_ref: null` in plan frontmatter; populate only when a finding forces creation.

Use Task() commands from progress file Quick Reference sections for maximum efficiency.
