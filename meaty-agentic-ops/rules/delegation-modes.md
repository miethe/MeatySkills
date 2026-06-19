# Delegation Modes Rule (Global)

**Purpose**: Mode markers calibrate agent autonomy without restating long context. Every delegation prompt includes one mode marker as the first line to encode the safety boundary and expected behavior.

---

## The Five Modes

**Mode A: Exploration Only**

Read-only investigation. No edits, no file writes. Agent explores codebase, traces patterns, answers questions like "where is X used?" or "how does Y work?". Used for `codebase-explorer`, `search-specialist`, `symbols-engineer`. Output is findings/summary, never code changes.

**Mode B: Contract Drafting**

Author a contract, plan, PRD, or specification; no production-code edits. Agent writes planning/design artifacts. Used for `prd-writer`, `implementation-planner`, contract writers, and feature planning work. Output is the authored artifact itself.

**Mode C: Autonomous Feature Sprint**

Tier 1 full implementation per a Feature Contract. Single agent explores, implements, tests, validates, produces Completion Report. Complete autonomy within contract scope. Used for `feature-sprint-executor`. Permission: `acceptEdits` within contract boundaries.

**Mode D: High-Risk Change**

Auth, payments, data deletion, infrastructure, or database migrations. Agent explores, proposes solution in Completion Report, stops before edits. Await explicit human approval before any production changes. No code writes without user sign-off.

**Mode E: Reviewer**

Read diff and validation artifacts; score against criteria; produce recommendation. No edits, no file writes. Used for `task-completion-validator`, `karen`, `code-reviewer`. Output is the review/recommendation, never code.

---

## Invariants

1. **Every delegation prompt SHOULD include exactly one mode marker** as the first line: e.g., `Mode: C — Autonomous Feature Sprint`.

2. **Mode determines the safety boundary**, not the agent's pre-configured `permissionMode`. Both must align. Mixing a Mode A prompt with an agent configured as `acceptEdits` is a safety violation.

3. **Cross-mode escalation requires explicit user approval.** A Mode C sprint that hits Mode D territory (touches auth or payment code) must stop and report. Requesting user approval or Opus judgment before continuing.

4. **In v1 these are advisory** (encoded in prompt text). v2 may split into distinct agent profiles per mode, each with aligned `permissionMode` and resource constraints (see Open Question OQ-2 in `.claude/plans/tiered-workflow-overhaul.md`).

5. **Mode E reviewers read diffs,** not source files. Use `git diff` output, Completion Reports, and artifact frontmatter. Reviewers never have edit permissions; they cannot implement fixes, only identify them.

---

## Workflow Reality (Dynamic Workflows)

Dynamic Workflows make some mode boundaries *enforceable* and some advisory text *moot*. The table below reconciles each mode against the four hard runtime constraints (§2.2 of `.claude/plans/workflow-orchestration-integration-v1.md`).

| Mode | Workflow reality | Rule |
|---|---|---|
| **A — Exploration only** | Workflow subagents always run `acceptEdits`; the script cannot force a spawned agent to be read-only via prompt text alone. | Use a read-only `agentType` (`Explore`, `codebase-explorer`) whose agent definition carries `disallowedTools` covering write/edit operations. The safety boundary lives in the agent definition, not the prompt. |
| **B — Contract drafting** | Fine as a workflow stage; planner agents write planning artifacts, not production code. | No special handling required. |
| **C — Autonomous sprint** | Native fit — this is the `execute-contract` workflow (T2). The fix-loop is the sprint's review cycle expressed as deterministic code. | Route to `execute-contract` workflow; the validate→fix→re-validate loop is the sprint's built-in review cycle. |
| **D — High-risk change** | **No mid-run human sign-off exists.** The runtime docs are explicit: "For sign-off between stages, run each stage as its own workflow." | **Mode D is a workflow boundary, never an internal step.** The script detects the boundary (phase flag `mode: D` or `files_affected` touching auth, payments, migrations, deletion, or secret rotation) and returns `{status: 'needs_opus', reason: 'mode_d', phase}`. Opus runs that phase interactively. Cross-wave worktree merges and pushes also remain with Opus. |
| **E — Reviewer** | Reviewers must remain edit-less; `acceptEdits` is the subagent default. | Always use an edit-less reviewer `agentType` (`task-completion-validator`, `karen`, `council-review`, `code-reviewer`). Never pass a review task as an inline prompt to a write-capable agent. |

**Workflow invariant**: Workflow agents always run `acceptEdits` and inherit the session tool allowlist. Mode boundaries are enforced by `agentType` selection (for read-only roles) and by returning control to Opus (for Mode D), never by the workflow script's prompt text alone.

---

## Mode-D at Depth

Subagent nesting (a subagent spawning subagents via the `Agent` tool, GA in CLI v2.1.172+) creates spawn points 1–4 hops from Opus with **no runtime Mode-D boundary** — there is no nested-equivalent of a workflow's `return {needs_opus}`. Because `permissionMode` PROPAGATES to nested children (they inherit `acceptEdits`/`bypassPermissions` and write unprompted — Phase 0 finding OQ-4), Mode D at depth is a **HARD prerequisite, not advisory**.

1. **Nested agents are PROHIBITED from Mode-D work outright** — auth, payments, migrations, deletion, force-push, secret-rotation. The stop instruction lives in the agent definition, never inline task text alone.
2. **On hitting Mode-D territory a nested agent STOPS and bubbles a `needs_opus` / `mode_d` signal up its chain.** Each parent relays it UPWARD UNCHANGED until it reaches Opus, who executes that work interactively.
3. This **extends Mode D (and Invariant 3's cross-mode escalation) to arbitrary nesting depth.**

Canonical: `.claude/specs/subagent-nesting-spec.md` § "Mode-D at Depth".

---

## Cross-References

- **Tier system**: `.claude/plans/tiered-workflow-overhaul.md` §2 (tier matrix and economics).
- **Mode definitions**: `.claude/plans/tiered-workflow-overhaul.md` §4.8.
- **Feature Sprint executor**: `feature-sprint-executor` agent definition (Mode C consumer).
- **Mandatory reviewer gates**: `.claude/skills/dev-execution/validation/completion-criteria.md`.
- **Workflow governance reconciliation**: `.claude/plans/workflow-orchestration-integration-v1.md` §6 (full mode-by-mode reconciliation table and new invariant source).
- **Workflow authoring contract**: `.claude/specs/workflows/workflow-authoring-spec.md` (four-constraints checklist, `agentType` routing rules, Mode-D boundary lint).
- **Subagent nesting governance**: `.claude/specs/subagent-nesting-spec.md` (Mode-D-at-depth, per-level budget, durability contract for nested spawns).
