---
description: Plan a feature from a GitHub issue with tier-aware routing — fetches, classifies, and routes to the right planning workflow
allowed-tools: Task, Skill, Bash, Read
argument-hint: "<issue-number-or-url> [--tier=auto|1|2|3]"
---

**You are Opus. Tokens are expensive. You orchestrate; subagents execute.**

---

## Step 1 — Fetch and Summarize Issue

**Do not** read the issue body into Opus context yourself. Delegate fetch + summarization to haiku.

```
Task("search-specialist",
  "Mode: A — Exploration Only
   Fetch GitHub issue $ISSUE and produce a structured summary.
   Command: gh issue view $ISSUE --json title,body,labels,milestone,assignees,url
   Output a single markdown block:
     - title (1 line)
     - summary (3–5 sentences, plain prose)
     - labels list
     - effort estimate if present in body or labels (look for points/pts/t-shirt size)
     - files/systems mentioned
     - acceptance criteria bullets if present
   Under 300 words total.")
```

Where `$ISSUE` is the first positional argument from `$ARGUMENTS` — either an issue number (e.g., `142`) or a full GitHub URL. For a bare number, resolve to the current repo: `gh issue view <N>`.

---

## Step 2 — Tier Classification

Parse `--tier=<value>` from `$ARGUMENTS` if provided. If `--tier=auto` or absent, classify:

**Classification inputs** (extract from the haiku summary):
- Story points / effort label (if present in issue body or labels)
- Number of files/systems mentioned
- Labels (e.g., `enhancement`, `refactor`, `spike-needed`, `high-risk`)
- Scope signals (cross-cutting, auth, payments, migrations → elevated risk/tier)

**Decision rule** (full table: `.claude/skills/planning/SKILL.md` §"Tier Matrix"):

| Tier | Size signals | Risk flags |
|------|-------------|------------|
| 0 | ≤3 pts, single file mentioned | none |
| 1 | 3–8 pts, clear bounded scope | low–medium risk |
| 2 | 8–13 pts, multiple systems | any risk level |
| 3 | 13+ pts, or spike-needed label | any risk level |

**Classify on your own judgment from the summary.** Only ask the user if the estimate is genuinely ambiguous after reviewing the summary.

---

## Step 3 — Route by Tier

### Tier 0 → Exit

Inform the user:

> Issue #N looks like a Tier 0 change (1–3 pts, single file). Use `/dev:quick-feature` instead — no planning artifact needed.

**Stop.** No skills invoked.

---

### Tier 1 → Feature Contract

```
Skill("planning")
```

Follow the skill's "Workflow: Tier 1 Feature Contract" using the issue summary as input.
Reference: `.claude/skills/planning/SKILL.md` §"Workflow: Tier 1 Feature Contract"

Pass the haiku summary (file path or inline block) to the contract writer subagent — do not re-read the issue yourself. Output location: `docs/project_plans/feature_contracts/[category]/[slug].md`

After contract is approved, use `/dev:execute-contract <contract-path>` to run the sprint.

---

### Tier 2 → PRD + Implementation Plan + Decisions Block

```
Skill("planning")
```

Follow the skill's Workflow 1 (PRD) and Workflow 2 (Implementation Plan), using the haiku summary as the feature request input. Provide the summary file path to `prd-writer` — do not paste issue content into the Opus prompt.

**Opus decisions block (mandatory before delegating to `implementation-planner`)**:
Author the decisions block directly using `.claude/skills/planning/templates/decisions-block-template.md`. Write to `.claude/worknotes/[slug]/decisions-block.md`. See skill §2.5. This is Opus-direct — do not delegate it.

```
Skill("artifact-tracking")
```

Create progress files (ONE per phase) and context file (ONE per PRD).

Mandatory reviewer gates: `task-completion-validator` per phase; `karen` at end of feature.

---

### Tier 3 → SPIKE + PRD + Implementation Plan + Decisions Block

Same as Tier 2, plus:

- Confirm a SPIKE doc exists or author one before starting the PRD.
- `karen` review per phase milestone (not just at end) — surface milestone checkpoints in the Implementation Plan.

---

## Token Discipline (Mandatory)

- **Do not** read the full issue body into Opus context — the haiku summary is sufficient for classification and delegation.
- **Do not** read source docs (SPIKEs, ADRs, design specs) that subagents will also read — provide paths only.
- **Do not** paste issue content into delegation prompts — provide the summary file path.
- Task prompts < 500 words. Paths, not contents.

Reference: `.claude/rules/context-budget.md`

## Skill References

- Tier matrix: `.claude/skills/planning/SKILL.md` §"Tier Matrix"
- Feature Contract workflow: `.claude/skills/planning/SKILL.md` §"Workflow: Tier 1 Feature Contract"
- Decisions block: `.claude/skills/planning/SKILL.md` §2.5 + `.claude/skills/planning/templates/decisions-block-template.md`
- Execution: `/dev:execute-contract` (Tier 1), `/dev:execute-phase` (Tier 2/3)
