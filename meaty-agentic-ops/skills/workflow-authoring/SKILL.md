---
name: workflow-authoring
description: Use this skill when authoring, modifying, or validating SkillMeat Dynamic Workflow scripts (.claude/workflows/*.js). Covers the full governed procedure: loading the master contract and per-workflow spec, choosing patterns from the pattern library, generating scripts against ExecutionGraph/ExecutionReport schemas, validating against the four-constraints checklist (no FS/shell in script, Mode D as boundary, edit-less reviewers, no Date.now/Math.random), syntax-check recipe (async-IIFE wrap for node --check), dry-run guidance, saving to .claude/workflows/, and registering in workflow-registry.md. Use whenever creating a new workflow, extending an existing one, or reviewing a workflow script for compliance.
---

# Workflow Authoring Skill

Governed procedure for authoring SkillMeat Dynamic Workflow scripts. Operationalizes
`.claude/specs/workflows/workflow-authoring-spec.md` §5.4 into a repeatable five-step flow.

**Anti-hallucination baseline**: the only real primitives are `agent()`, `parallel()`,
`pipeline()`, `phase()`, `log()`, `args`, `budget`, and `workflow()`. No `on_success:`,
`condition:`, `status_field`, or declarative hooks exist. See master contract §1.

---

## The Five-Step Procedure

### Step 1 — Load the master contract and per-workflow spec

Always load in this order:

1. **Master contract** — `.claude/specs/workflows/workflow-authoring-spec.md`
   Required sections: §1 primitives, §2 meta conventions, §3 args contract,
   §5 four-constraints checklist, §6 ExecutionReport schema, §8 reviewer routing.

2. **Per-workflow spec** — `.claude/specs/workflows/<name>-workflow-spec.md`
   - Existing specs: `execute-plan`, `execute-contract`, `explore-spike`, `review-council`
   - If no spec exists yet: scaffold one from `./per-workflow-spec-template.md` before
     writing the script. The spec is the contract; the script implements it.

3. **Registry entry** — `.claude/specs/workflows/workflow-registry.md`
   Verify the workflow is registered (or add a `planned` entry) before authoring.

---

### Step 2 — Choose patterns for the task shape

Consult `.claude/skills/dev-execution/orchestration/workflow-patterns.md`.
Use the selection guide in the master contract §11 to pick:

| Task shape | Pattern(s) |
|---|---|
| Sequential waves, parallel phases, file-ownership batches | `waveFanout` + `modeBoundary` |
| Validate → fix → re-validate | `reviewerGate` + `fixLoop` |
| Reviewer type routing | `councilEscalation` |
| Parallel investigation legs → synthesis | `exploreLegs` |
| N items, multi-stage, no inter-item barrier | `pipeline` |
| Keep spawning finders until dry | `loopUntilDry` |
| Challenge findings with skeptics | `adversarialVerify` |
| Post-output gap identification | `completenessCritic` |
| Multiple attempts scored by a panel | `judgePanel` |
| Detect high-risk phase, stop workflow | `modeBoundary` |
| Progress YAML update (no FS in script) | `trackerStep` |

Copy the named pattern's implementation block verbatim and adapt to your workflow's agent types
and schema. Do not reinvent the primitives.

---

### Step 3 — Generate the script

**File**: `.claude/workflows/<name>.js` (plain JS, not TypeScript)

**Required skeleton** (fill in phases, args shape, and pattern bodies):

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
- `meta` must be a **pure literal** — no computed values, no function calls.
- Every `phase()` call in the body must have a matching title in `meta.phases`.
- `args` is parsed at the top (JSON string or object, see skeleton above).
- `args.dry_run === true`: return parsed graph immediately without spawning agents.
- Implementation agent prompts must include `"Do NOT git add/commit/push/stash."` explicitly.
- All reviewer gate calls use edit-less `agentType` — see §4 registry in master contract.
- Cross-wave git merges, worktree merges, and Mode D phases belong to Opus post-run, not in script.
- **Provider routing**: workflow scripts dispatch `agent(prompt, { agentType })` only. They NEVER call the `delegation-router` resolver at runtime. The resolver runs at Opus pre-flight; the resolved `RoutingRecord.agent_type_id` becomes the `agentType` value passed to `agent()`. See `.claude/specs/provider-routing-spec.md` for routing rules.

**ExecutionGraph fields** (passed as `args` by Opus pre-flight):

```
args.waves[]          → sequential dependency levels
args.tier             → 1 | 2 | 3
args.plan_ref         → path string for agents to read (Opus passes it; script passes it through)
args.timestamp        → ISO string (never derive from Date.now())
args.budget_total     → maps to budget.total
args.dry_run          → return parsed graph without spawning agents
args.progressFile     → resolved path to phase progress YAML (Opus resolves pre-flight)
```

Each `wave.phases[].tasks[]` carries: `id`, `prompt`, `assigned_to`, `model`, `effort`,
`files_affected`, `isolation`, `mode`. Each `wave.phases[]` carries: `mode`, `review_intensity`,
`isolation`, `phase_strategy`, `fix_agent`, `batches`.

**ExecutionReport returned shape** (consumed by Opus post-run):

```
{ status: 'complete' | 'blocked' | 'needs_opus',
  reason?: 'mode_d' | 'reviewer_unresolved' | 'budget_exhausted',
  blocked_phase?: string,
  report: WaveResult[] }
```

Full schemas: `.claude/specs/workflows/schemas/execution-graph.schema.json` and
`.claude/specs/workflows/schemas/execution-report.schema.json`.

---

### Step 4 — Validate against the four-constraints checklist AND durability checklist

Run every check before saving. The workflow MUST NOT be saved with any check failing.

**Durability checklist** (from `workflow-authoring-spec.md` §16 — run alongside the four-constraints):

```
[ ] Commit-checkpoints present: every implementation/sprint/fix prompt includes DURABILITY_FOOTER
    (or equivalent explicit commit instruction)
[ ] Report written pre-schema: Completion Report path written to disk BEFORE Stage B structurer
[ ] Heavy agents two-staged: no top-level await agent({schema}) for long-running executor agents
    (feature-sprint-executor and phase-owner with large workloads must use Stage A + Stage B)
[ ] Reviewers/trackers no-commit: review, tracker, and structurer agents never git add/commit/push
[ ] Fallback on structure miss: try/catch around schema calls; minimal result rather than null/crash
```

```
Four-Constraints Checklist
[ ] No FS/shell access in script body
    (no import fs, require, exec, readFile, Deno.readFile, child_process, or any FS/shell call)
[ ] Mode D phases trigger early return — never executed inside the workflow
    (check that modeBoundary() or inline mode === 'D' guard fires BEFORE any agents spawn for that phase)
[ ] All reviewer agents use edit-less agentType
    (valid set: task-completion-validator, karen, council-review, code-reviewer, senior-code-reviewer)
[ ] No Date.now() / Math.random() / new Date() in script body
[ ] meta is a pure literal object (no expressions, no function calls)
[ ] phase() titles match meta.phases entries exactly (diff them character-by-character)
[ ] Budget guard present in every while / loop-until-dry pattern (budget.remaining() > THRESHOLD)
[ ] Implementation agent prompts include "Do NOT git add/commit/push/stash"
[ ] args parsed at top (typeof args === 'string' ? JSON.parse : identity)
[ ] args.dry_run handled (return parsed graph without spawning agents)
```

#### Syntax-check recipe

`node --check` false-fails on workflow scripts that use top-level `return` or top-level `await`
(both are valid in the workflow runtime but invalid as standalone Node modules). Use this wrapper:

```bash
# 1. Copy the script body (after the "export const meta = {...}" block) to a temp file,
#    replacing the "export const meta" declaration with "const meta", then wrapping in an async IIFE:

node --check <(
  sed 's/^export const meta/const meta/' .claude/workflows/<name>.js \
  | awk '/^export const meta/{meta=1} meta && /^}$/{meta=0; print; print "(async () => {"; next} {print} END{print "})();"}' 
)

# Simpler approach: author a lint-wrap helper (see ./syntax-check-helper.js)
```

See `./syntax-check-helper.js` for a ready-to-run Node.js script that performs this wrapping
automatically for any `.claude/workflows/*.js` file.

---

### Step 5 — Dry-run, save, and register

**Dry-run** (`args.dry_run === true`):
Invoke the workflow with `{"dry_run": true, "waves": [...]}`. The script must return the
parsed `args` object immediately without spawning any agents. Confirms args parsing, meta
correctness, and early-return paths without real cost.

```
/workflows inspect <name>    # Inspect saved workflow in the /workflows TUI
```

**Save**: The script is already at `.claude/workflows/<name>.js`. No additional save step needed —
the file IS the saved workflow. Reference via `/<name>` command or `workflow('<name>', args)`.

**Register**: Add or update the entry in `.claude/specs/workflows/workflow-registry.md`:

```
| `<name>` | `.claude/specs/workflows/<name>-workflow-spec.md` | `.claude/workflows/<name>.js` | `active` | nick | P<N> | <one-line description> |
```

Update the `updated` frontmatter date in `workflow-registry.md`.

---

## When to Author a New Workflow vs. Extend an Existing One

**Author new** when:
- A new repeated orchestration pattern has no existing workflow (check registry first).
- A new workflow candidate from §5.5 of the integration plan is being built:
  `release`, `migrate-sweep`, `audit`, `docs-sync`, `symbols-refresh`.
- A new command (`/dev:*`, `/plan:*`, `/review:*`) needs a background execution target.

**Extend existing** when:
- A new phase type (e.g., `phase_strategy: 'adaptive'`) needs a code path added.
- A reviewer routing rule changes (update `councilEscalation` logic).
- A new `agentType` becomes available and should replace an inline prompt.
- An existing pattern needs a bug fix or budget-guard adjustment.

**Never extend** when the change would make `meta.phases` incorrect without a corresponding
update to all callers. `meta.phases` is consumed by the `/workflows` TUI; silent mismatches
produce ghost phase groups.

---

## Mode D Handling Quick Reference

Mode D phases (auth, payments, migrations, deletion, force-push, secret rotation) must never
execute inside a workflow. Detection is two-tier:

1. **Explicit flag**: `phase.mode === 'D'` — set by Opus in the ExecutionGraph.
2. **Heuristic fallback**: `files_affected` matching the HIGH_RISK_PATTERNS set in the
   `modeBoundary` pattern (see pattern library).

On detection, the script returns immediately:

```js
return { status: 'blocked', reason: 'mode_d', blocked_phase: phase.id, report }
```

Opus receives this, runs the phase interactively, then relaunches the workflow with a trimmed
`args.waves` (excluding the completed and blocked waves).

---

## Budget Planning

`args.budget_total` is set by Opus pre-flight from the plan's `effort_estimate`. Guidance
(from master contract §10):

| Stage | Recommended model | Approximate cost |
|---|---|---|
| Mechanical search / extraction | `haiku` | low |
| Implementation, standard review | `sonnet` (session default) | medium |
| Deep reasoning, plan building | `opus` | high |
| Council adjudication | inherit session model | high |

Fix-loop guard threshold: `budget.remaining() > 60_000` (enough for one fix + review cycle).
Loop-until-dry threshold: `budget.remaining() > 80_000` (two extra agents; set higher).

---

## Supporting References

| File | Purpose |
|---|---|
| `./per-workflow-spec-template.md` | Scaffold for new per-workflow specs |
| `./syntax-check-helper.js` | Node.js script that wraps a workflow for `node --check` |
| `.claude/specs/workflows/workflow-authoring-spec.md` | Master contract (authoritative) |
| `.claude/specs/workflows/workflow-registry.md` | Registry of all workflows + status |
| `.claude/skills/dev-execution/orchestration/workflow-patterns.md` | Pattern library |
| `.claude/specs/workflows/schemas/execution-graph.schema.json` | args schema |
| `.claude/specs/workflows/schemas/execution-report.schema.json` | return value schema |
| `.claude/specs/provider-routing-spec.md` | Routing rules for agentType selection at pre-flight (scripts dispatch only; never resolve at runtime) |
