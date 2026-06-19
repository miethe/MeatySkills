---
title: workflow-authoring skill
doc_type: guide
status: current
last_verified: 2026-06-02
owner: workflow-orchestration
---

# workflow-authoring Skill

**Use this skill when authoring, modifying, or validating SkillMeat Dynamic Workflow scripts** (`.claude/workflows/*.js`). The skill governs the complete procedure: reading the master contract and per-workflow spec, choosing patterns from the pattern library, generating scripts against `ExecutionGraph`/`ExecutionReport` schemas, validating against the four hard constraints, syntax-checking, and registering in the workflow registry.

---

## When to Load This Skill

Load `workflow-authoring` **before** writing or modifying any `.claude/workflows/*.js` file:

```markdown
Skill("workflow-authoring")
```

**CLAUDE.md binding** (from `.claude/CLAUDE.md` command-skill bindings):
> When executing `/dev:*` or other workflow commands, explicitly invoke required skills before proceeding. For workflows, load `Skill("workflow-authoring")` before authoring or modifying any `.claude/workflows/*.js` script.

The skill operationalizes `.claude/specs/workflows/workflow-authoring-spec.md` (the master contract) into a repeatable five-step procedure.

---

## The Five-Step Authoring Procedure

See **`.claude/skills/workflow-authoring/SKILL.md`** for the complete procedural guide. Quick summary:

### Step 1 — Load the master contract and per-workflow spec

1. **Master contract**: `.claude/specs/workflows/workflow-authoring-spec.md`
   - Required sections: §1 (primitives), §2 (meta conventions), §3 (args contract), §5 (four constraints), §6 (ExecutionReport schema), §8 (reviewer routing)

2. **Per-workflow spec**: `.claude/specs/workflows/<name>-workflow-spec.md`
   - Existing specs: `execute-plan`, `execute-contract`, `explore-spike`, `review-council`
   - If creating a new workflow: scaffold from `.claude/skills/workflow-authoring/per-workflow-spec-template.md`

3. **Registry entry**: `.claude/specs/workflows/workflow-registry.md`
   - Verify registration (or add a `planned` entry) before authoring

### Step 2 — Choose patterns

Read `.claude/skills/dev-execution/orchestration/workflow-patterns.md` and use the master contract §11 selection guide to pick patterns:

| Task shape | Pattern(s) |
|---|---|
| Sequential waves, parallel phases, file-ownership batches | `waveFanout` + `modeBoundary` |
| Validate → fix → re-validate loop | `reviewerGate` + `fixLoop` |
| Reviewer type routing | `councilEscalation` |
| Parallel investigation legs → synthesis | `exploreLegs` + `adversarialVerify` |
| N items, multi-stage, no inter-item barrier | `pipeline` |
| Keep spawning finders until dry | `loopUntilDry` with budget guard |
| Detect high-risk phase, stop workflow | `modeBoundary` |
| Progress YAML update (no FS in script) | `trackerStep` |

Copy the pattern's implementation block from the pattern library verbatim; adapt to your workflow's agent types and schema.

### Step 3 — Generate the script

**File location**: `.claude/workflows/<name>.js` (plain JavaScript, not TypeScript)

**Required skeleton**:

```js
// Workflow args may arrive as a JSON string from the Workflow tool.
// Always parse at the top before destructuring.
const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args

export const meta = {
  name: '<kebab-case-verb>',
  description: '<one-sentence purpose and when to use>',
  phases: [
    { title: '<Phase title matching phase() calls below>' },
    // ... one entry per phase() call in the body
  ],
  whenToUse: '<trigger conditions for discoverability>',
}

// === script body ===
// All patterns below this line.
// No import/require, no FS, no shell, no Date.now(), no Math.random().
```

**Key generation rules**:
- `meta` must be a **pure literal** — no computed values, no function calls
- Every `phase()` call in the body must have a matching title in `meta.phases` (diff character-by-character)
- `args` is parsed at the top (JSON string or object)
- `args.dry_run === true`: return parsed graph immediately without spawning agents
- All implementation agent prompts must include: `"Do NOT git add/commit/push/stash"`
- All reviewer gate calls use edit-less `agentType` only

### Step 4 — Validate against the four-constraints checklist

Every workflow MUST pass all four constraints before saving. No exceptions.

#### The Four Hard Constraints

**Constraint 1: No FS/shell access in script body**
- No `import fs`, `require`, `exec`, `readFile`, `Deno.readFile`, `child_process`, or any FS/shell call
- All file reads and CLI commands are performed by agents, not the script
- The plan file is read by Opus pre-flight; passed to agents via `args.plan_ref`

**Constraint 2: No mid-run human sign-off**
- Mode D phases (auth, payments, migrations, deletion, force-push, secret rotation) must never execute inside the workflow
- Detect Mode D via `phase.mode === 'D'` and return early: `return { status: 'blocked', reason: 'mode_d', blocked_phase: phase.id, report }`
- Mode D is a workflow boundary, not an internal phase

**Constraint 3: All reviewer agents use edit-less agentType**
- Valid edit-less set: `task-completion-validator`, `karen`, `council-review`, `code-reviewer`, `senior-code-reviewer`
- Never inline-prompt a reviewer — inline prompts cannot enforce read-only (constraint 3 is unenforceable at script level)
- Always use `agentType` from the registry for reviewers

**Constraint 4: No Date.now() / Math.random() / new Date()**
- Forbidden: `Date.now()`, `Math.random()`, argless `new Date()`
- Use timestamps via `args.timestamp` (Opus sets pre-flight)
- Determinism is required for session resumption

**Additional checks**:
- `meta` is a pure literal object (no expressions, function calls, or computed values)
- `phase()` titles match `meta.phases` entries exactly
- Budget guard present in every `while` / loop-until-dry pattern: `budget.remaining() > THRESHOLD`
- Implementation agent prompts include `"Do NOT git add/commit/push/stash"`
- `args` parsed at top: `typeof args === 'string' ? JSON.parse(args) : args`
- `args.dry_run` handled: return parsed graph without spawning agents

#### Syntax-Check Recipe

Use the provided **syntax-check-helper.js** to validate workflow scripts. The helper wraps the post-meta body in an async IIFE, avoiding `node --check` false-positives on top-level `return`/`await`.

**Exact invocation**:

```bash
node .claude/skills/workflow-authoring/syntax-check-helper.js .claude/workflows/<name>.js
```

**What the helper does**:
1. Reads the workflow script at the given path
2. Replaces `export const meta` with `const meta` (to avoid module context requirements)
3. Detects the closing brace of the meta block
4. Wraps everything after the meta block in `(async () => { ... })()`
5. Writes to a temp file and runs `node --check`
6. Prints result to stdout; exit code 0 = syntax OK, 1 = syntax error

**LSP false-positives on `.js` workflow scripts**:
- TypeScript/Pyright flags `phase`, `agent`, `parallel`, `log`, `args`, `budget`, `workflow` as "could not find name"
  - These are runtime globals provided by the workflow runtime, not import errors
  - Ignore these diagnostics
- Variables passed through the body and used in closures may be flagged "never read" or "not written"
  - Ignore; these are flow-control false positives from static analysis

### Step 5 — Dry-run, save, and register

**Dry-run** (`args.dry_run === true`):
Invoke the workflow with `{"dry_run": true, "waves": [...]}`. The script must return the parsed `args` object immediately without spawning any agents. Confirms args parsing, meta correctness, and early-return paths without real cost.

**Save**: The script file at `.claude/workflows/<name>.js` IS the saved workflow. No additional save step needed. Reference via `/<name>` command or `workflow('<name>', args)`.

**Register**: Add or update the entry in `.claude/specs/workflows/workflow-registry.md`:

```markdown
| `<name>` | `.claude/specs/workflows/<name>-workflow-spec.md` | `.claude/workflows/<name>.js` | `active` | nick | P<N> | <one-line description> |
```

Update the `updated` frontmatter date in `workflow-registry.md`.

---

## The Four Hard Constraints Checklist

Copy this checklist into every PR or spec review:

```
Constraint 1: No FS/shell access in script body
[ ] No `import fs`, `require`, `exec`, `readFile`, `Deno.readFile`, or any FS/shell call
[ ] All file reads and CLI commands run via agents (constraint 1 — no FS access from script)

Constraint 2: No mid-run human sign-off
[ ] Mode D phases (`phase.mode === 'D'`) trigger early return `{status:'blocked'}` before any agents spawn
[ ] Detection: explicit flag `phase.mode === 'D'` and/or heuristic `files_affected` matching HIGH_RISK_PATTERNS

Constraint 3: All reviewer agents use edit-less agentType
[ ] All reviewer gate calls use agentType from edit-less set: task-completion-validator, karen, council-review, code-reviewer, senior-code-reviewer
[ ] Never inline-prompt a reviewer — inline prompts cannot enforce read-only

Constraint 4: No Date.now() / Math.random() / new Date()
[ ] No `Date.now()`, `Math.random()`, or argless `new Date()` in script body
[ ] Use timestamps via `args.timestamp` (Opus sets pre-flight)

Supplementary checks:
[ ] meta is a pure literal object (no expressions, function calls)
[ ] phase() titles match meta.phases entries exactly (character-by-character)
[ ] Budget guard present in every while/loop-until-dry pattern: budget.remaining() > THRESHOLD
[ ] Implementation agent prompts include "Do NOT git add/commit/push/stash"
[ ] args parsed at top: typeof args === 'string' ? JSON.parse(args) : args
[ ] args.dry_run handled: return parsed graph without spawning agents
```

---

## Agent Routing Rules

From the master contract §4 and §8:

**Reviewer agentType routing** (determined by `review_intensity` + `tier`):

| `review_intensity` | Reviewer agentType | Use when |
|---|---|---|
| `standard` | `task-completion-validator` | Tier 2 phases (default) |
| `tier3` | `karen` | Tier 3 and core-path phases (adversarial review) |
| `council` | `council-review` | Architecture, auth, payments, core-path phases (multi-lens ARC review) |

**Implementation agents**: Use `agentType` from the registered agent roster (e.g., `python-backend-engineer`, `ui-engineer-enhanced`, `feature-sprint-executor`).

**Mode D boundary enforcement**:
- Mode D is always a workflow boundary; never executed inside the workflow
- Return `{ status: 'blocked', reason: 'mode_d', blocked_phase: blocked.id, report }` before any agents spawn
- Opus runs the blocked phase interactively, then may resume remaining waves

---

## Per-Workflow Spec Requirement

Every workflow needs a corresponding spec at `.claude/specs/workflows/<name>-workflow-spec.md`:

**Template**: `.claude/skills/workflow-authoring/per-workflow-spec-template.md`

**Required sections**:
- Purpose (what orchestration problem it solves, what it replaces, fallback mechanism)
- `args` contract (which ExecutionGraph fields are used, workflow-specific extensions)
- Phases (list every `phase()` call with descriptions)
- Agent routing (which agentTypes, their roles, which are edit-less)
- Mode D handling (explicit flag detection + heuristic patterns)
- Dry-run mode (how it returns without spawning agents)
- Pre-conditions and post-conditions
- Return value (status semantics)
- Patterns used (which named patterns from workflow-patterns.md are composed)
- Extension points (where future authors can safely add behavior)
- Four-constraints checklist (workflow-specific verification)

The spec is the contract; the script implements it. **Never save a workflow script without a corresponding spec.**

---

## Workflow Registry

All workflows are registered in `.claude/specs/workflows/workflow-registry.md`.

**Current active workflows**:
- `execute-plan` — Tier 2/3 wave execution (sequential waves, parallel phases, file-ownership batching, reviewer gates)
- `execute-contract` — Tier 1 autonomous sprint (sprint → validate → fix-loop)
- `explore` — Pre-commitment exploration (parallel legs → deep-read → adversarial verify → synthesis)
- `spike` — Research SPIKE (same phase structure as `explore`, produces `FeasibilityBrief`)
- `review-council` — Agent Review Council (ARC) wrapper (embedded `review_intensity: council` gate)

**Future candidates** (registered, not built):
- `release` — Version bump → OpenAPI regeneration → SDK release → changelog audit
- `migrate-sweep` — N-file schema migration with per-file worktree isolation
- `audit` — Codebase-wide security or bug sweep
- `docs-sync` — Authoring-to-docs-site sync pipeline
- `symbols-refresh` — Regenerate `ai/symbols-*.json` after structural changes

---

## Forbidden APIs & Primitives

**Do NOT use these in workflow scripts**:

- ❌ `import`, `require`, `readFile`, `writeFileSync`, `exec`, `shell` — use agents instead
- ❌ `Date.now()`, `Math.random()`, `new Date()` — use `args.timestamp` (Opus-supplied)
- ❌ Declarative hooks like `on_success:`, `condition:`, `status_field` — these do not exist
- ❌ Mid-run human sign-off / prompt — use Mode D boundary return instead
- ❌ Inline prompts for known agent types — use `agentType` from the registry

**Do use these**:

- ✅ `agent(prompt, opts)` — spawn one subagent
- ✅ `parallel(thunks)` — run concurrently, barrier on completion
- ✅ `pipeline(items, ...stages)` — multi-stage transform, no inter-item barrier
- ✅ `phase(title)` — start progress group
- ✅ `log(msg)` — narrator line
- ✅ `args` — ExecutionGraph passed by Opus
- ✅ `budget` — token ceiling with `.total`, `.spent()`, `.remaining()`
- ✅ `workflow(name, args)` — invoke another saved workflow (one level nesting only)

---

## Authoring Workflow vs. Extending Existing

**Author new** when:
- A new repeated orchestration pattern has no existing workflow (check registry first)
- A new workflow candidate from the integration plan (e.g., `release`, `audit`) is being built
- A new command (`/dev:*`, `/plan:*`, `/review:*`) needs a background execution target

**Extend existing** when:
- A new phase type (e.g., `phase_strategy: 'adaptive'`) needs a code path added
- A reviewer routing rule changes (update `councilEscalation` logic)
- A new `agentType` becomes available and should replace an inline prompt
- An existing pattern needs a bug fix or budget-guard adjustment

**Never extend** when the change would make `meta.phases` incorrect without updating all callers. `meta.phases` is consumed by the `/workflows` TUI; silent mismatches produce ghost phase groups.

---

## See Also

**Procedural source of truth**: `.claude/skills/workflow-authoring/SKILL.md` — the full five-step procedure and detailed guidance

**Master contract** (canonical): `.claude/specs/workflows/workflow-authoring-spec.md` — §1 primitives, §2 meta conventions, §3 args contract, §5 four constraints, §6 ExecutionReport schema, §8 reviewer routing, §10 budget conventions, §11 pattern selection, §13 OQ-5 telemetry decision

**Per-workflow spec template**: `.claude/skills/workflow-authoring/per-workflow-spec-template.md` — scaffold for new specs

**Workflow registry**: `.claude/specs/workflows/workflow-registry.md` — authoritative index of all workflows (active and planned)

**Pattern library**: `.claude/skills/dev-execution/orchestration/workflow-patterns.md` — copy-paste-ready JS implementations of all named patterns

**Execution schemas**:
- `.claude/specs/workflows/schemas/execution-graph.schema.json` — args contract
- `.claude/specs/workflows/schemas/execution-report.schema.json` — return value contract

**Integration plan**: `.claude/plans/workflow-orchestration-integration-v1.md` — strategic context for why workflows exist and their role in the orchestration layer

**Rules governing workflows**:
- `.claude/rules/delegation-modes.md` — Mode A–E reconciliation and how workflows enforce boundaries
- `.claude/rules/context-budget.md` — token discipline (no TaskOutput for file-writing agents, task prompts < 500 words)

**End-to-end hub** (how to use workflows): `.claude/docs/workflows/README.md`

---

## Quick Summary

1. **Load this skill** before authoring any workflow script
2. **Read the master contract** (`.claude/specs/workflows/workflow-authoring-spec.md`)
3. **Read or author a per-workflow spec** (use `per-workflow-spec-template.md`)
4. **Generate the script** at `.claude/workflows/<name>.js`
5. **Validate** with `node .claude/skills/workflow-authoring/syntax-check-helper.js .claude/workflows/<name>.js`
6. **Pass the four-constraints checklist** (no FS/shell, Mode D boundary, edit-less reviewers, no Date.now/Math.random)
7. **Register** in `.claude/specs/workflows/workflow-registry.md`
8. **Dry-run** with `args.dry_run === true` to confirm args parsing and meta correctness
9. **Test** with `/workflows` TUI for visibility into phases and agent execution

The goal is **deterministic, resumable, auditable workflow execution** that replaces manual orchestration and scales to complex multi-phase work.
