---
schema_version: 2
doc_type: spec
title: "execute-contract Workflow Spec"
status: active
created: 2026-06-01
owner: nick
phase: 2
related_documents:
  - .claude/plans/workflow-orchestration-integration-v1.md
  - .claude/specs/workflows/workflow-authoring-spec.md
  - .claude/specs/workflows/schemas/execution-graph.schema.json
  - .claude/specs/workflows/schemas/execution-report.schema.json
  - .claude/skills/dev-execution/orchestration/workflow-patterns.md
  - .claude/skills/dev-execution/SKILL.md
  - .claude/agents/dev/feature-sprint-executor.md
  - .claude/rules/delegation-modes.md
workflow_script: .claude/workflows/execute-contract.js
registry_entry: .claude/specs/workflows/workflow-registry.md
---

# execute-contract Workflow Spec

Per the master contract (`workflow-authoring-spec.md`), this spec extends, never contradicts, what is defined there. Read the master contract before authoring or modifying `.claude/workflows/execute-contract.js`.

---

## §1 — Purpose and Trigger

`execute-contract` is the **Tier 1 sprint workflow**. It replaces the manual `feature-sprint-executor` + `task-completion-validator` Task-pair Opus currently drives by hand, making Tier 1 sprints **resumable, inspectable via `/workflows`, and deterministically gated**.

**When to use**:
- A Feature Contract (`doc_type: feature_contract`) exists and has `status: approved`.
- Estimated effort is 3–8 story points (Tier 1 range).
- The contract does **not** touch auth, payments, production migrations, or multi-tenant data boundaries — those are Mode D; use `execute-plan` with Mode D boundary detection or invoke interactively.

**Invocation**: `workflow execute-contract` with a JSON `args` envelope (see §2), or via the `/dev:execute-contract` saved command once registered.

**Do not use for**:
- Tier 0 tasks (use `/dev:quick-feature` directly).
- Tier 2/3 plans with multiple phases and waves (use `execute-plan`).
- Contracts flagged Mode D in their metadata (workflow returns `needs_opus` immediately).

---

## §2 — `args` Envelope (Feature Contract Envelope)

`execute-contract` uses a simplified subset of the full `ExecutionGraph` schema. Opus builds this pre-flight from the contract file and passes it as the workflow `args`. The workflow script **never reads the contract file itself** (constraint 1 — no FS access from script).

```json
{
  "contract_path":  "string — relative path from repo root to the Feature Contract .md",
  "plan_ref":       "string — same as contract_path (aliases execution-graph convention)",
  "tier":           1,
  "timestamp":      "string — ISO 8601 set by Opus pre-flight; never Date.now() in script",
  "budget_total":   50000,
  "context_paths":  ["string — optional list of relevant file paths for agent context"],
  "fix_agent":      "string — optional agentType override for fix-loop; default 'feature-sprint-executor'",
  "review_intensity": "standard | tier3 | council — default 'standard'",
  "dry_run":        false,

  "contract_metadata": {
    "slug":           "string — e.g. 'artifact-tag-bulk-edit'",
    "mode":           "string — delegation mode from contract; 'D' triggers needs_opus",
    "files_affected": ["string — relative paths the contract expects to touch"],
    "effort_points":  3
  }
}
```

**Field notes**:

| Field | Required | Notes |
|---|---|---|
| `contract_path` | yes | Path to the Feature Contract `.md` file. Agents read this file; the script does not. |
| `tier` | yes | Always `1` for this workflow. |
| `timestamp` | yes | ISO 8601 string from Opus. Never call `Date.now()` inside the script. |
| `budget_total` | no | Default `50000`. Derived from `effort_points × 6250` (8 pts × 6250 ≈ 50K). Opus sets this based on contract effort. |
| `context_paths` | no | Additional codebase paths the sprint agent should read. Passed verbatim into the sprint prompt. |
| `fix_agent` | no | Override `agentType` for fix-loop agents. Defaults to `'feature-sprint-executor'`. |
| `review_intensity` | no | Reviewer routing (see §5). Default `'standard'` routes to `task-completion-validator`. |
| `dry_run` | no | When `true`, returns the parsed `args` envelope without spawning agents. Use for pre-flight inspection. |
| `contract_metadata.mode` | no | If `'D'`, the workflow returns `{status:'needs_opus', reason:'mode_d'}` before spawning the sprint. Also checked via `files_affected` heuristic (see §4). |
| `contract_metadata.files_affected` | no | Paths the contract expects to touch. Used for implicit Mode D detection. |

---

## §3 — Phases

Three named phases, matching the `meta.phases` array in `execute-contract.js` exactly:

```
1. Sprint        — feature-sprint-executor autonomous implementation
2. Review        — task-completion-validator (or tier3/council) reviewer gate
3. Fix cycle N   — feature-sprint-executor (or fix_agent) targeted fix (≤2 cycles)
```

The TUI will show all three phase groups. "Fix cycle N" groups appear only if the reviewer rejects on first pass (they are statically declared but will be empty if not needed).

### Phase 1: Sprint

**Agent**: `agentType: 'feature-sprint-executor'`
**Mode**: C — Autonomous Feature Sprint
**Permission**: `acceptEdits` (by agent definition)

The sprint agent receives:
- The Mode marker (`Mode: C — Autonomous Feature Sprint`)
- The contract path to read
- The list of `context_paths` (if any)
- The budget hint
- Explicit instruction: "Do NOT git add/commit/push/stash"
- Instruction to produce a Completion Report (appended to the contract or written to `.claude/worknotes/<slug>/completion-report.md`)

The sprint runs explore → implement → test → validate → Completion Report autonomously. Opus does not intervene unless the agent escalates a blocker.

The sprint agent returns a `SprintResult` object (§6, SPRINT_RESULT_SCHEMA) containing: completion report path, AC verdicts (pass/fail per criterion), commit SHA(s) authored during the sprint, files touched, and any escalation blockers.

**Note**: The sprint agent commits its own work inside its worktree during the sprint (constraint 4 — commit-as-you-go). The `commit_sha` in the result is the latest commit HEAD at sprint completion.

### Phase 2: Review

**Agent**: `agentType: 'task-completion-validator'` (or `'karen'` / `'council-review'` per `review_intensity`)
**Mode**: E — Reviewer
**Permission**: edit-less by agent definition (`disallowedTools` covers Write/Edit/MultiEdit)

The reviewer receives:
- The Mode marker (`Mode: E — Reviewer`)
- The contract path (to read Acceptance Criteria)
- The Completion Report path from the sprint result
- The commit SHA or branch to diff against
- Instruction to return a structured VERDICT (§6, VERDICT_SCHEMA)

The reviewer does **not** produce code changes. It reads the diff, the Completion Report, and the contract AC list, then returns `{approved: boolean, reviewer_type, required_fixes?: string[]}`.

**Reviewer routing** (mirrors authoring-spec §8):

| `review_intensity` | Reviewer agentType |
|---|---|
| `standard` (default) | `task-completion-validator` |
| `tier3` | `karen` |
| `council` | `council-review` |

### Phase 3: Fix Cycle N (≤2 cycles)

**Agent**: `agentType: fix_agent` (default `'feature-sprint-executor'`)
**Mode**: C — Autonomous Feature Sprint
**Budget guard**: `budget.remaining() > 60_000`

The fix agent receives the reviewer's `required_fixes` list and applies targeted fixes. It does not re-run the full sprint — only addresses the listed required fixes. Each fix cycle is followed immediately by a fresh reviewer pass (same `VERDICT_SCHEMA`).

After 2 failed cycles, the workflow returns `{status:'needs_opus', reason:'reviewer_unresolved'}`. Opus adjudicates the escalation.

---

## §4 — Mode D Boundary (Contract Metadata Check)

Per master contract §7 governance (constraint 2: no mid-run sign-off), `execute-contract` must detect Mode D contracts and return early **before spawning any agents**. Two detection paths:

### Explicit flag

If `args.contract_metadata.mode === 'D'`:

```js
return { status: 'needs_opus', reason: 'mode_d', blocked_phase: 'sprint', report: [] }
```

### Implicit heuristic (files_affected scan)

If any path in `args.contract_metadata.files_affected` matches high-risk patterns (auth, payments, billing, migrations, alembic, delete, drop_table, secret, token):

```js
return { status: 'needs_opus', reason: 'mode_d', blocked_phase: 'sprint', report: [] }
```

In both cases the workflow stops before the sprint agent is spawned. Opus receives the `needs_opus` result and runs the sprint interactively, applying the Mode D discipline from `delegation-modes.md`.

**The `blocked_phase` value is always `'sprint'`** for `execute-contract` (there is only one implementation phase).

---

## §5 — Agent Routing Summary

| Phase | agentType | Edit tools? | Mode |
|---|---|---|---|
| Sprint | `feature-sprint-executor` | yes (`acceptEdits`) | C |
| Review | `task-completion-validator` / `karen` / `council-review` | **no** (edit-less by definition) | E |
| Fix cycle | `fix_agent` (default `feature-sprint-executor`) | yes (`acceptEdits`) | C |

The reviewer is always an **edit-less** `agentType`. This is enforced by the agent definition's `disallowedTools`, not by the workflow prompt — per constraint 3 (subagents always run `acceptEdits`; read-only is only enforced via agent definitions).

---

## §6 — Output Schemas

Both schemas are inline `schema` options passed to `agent()` — the tool layer enforces structured output and retries on mismatch.

### SPRINT_RESULT_SCHEMA

```json
{
  "type": "object",
  "required": ["completion_report_path", "ac_verdicts", "commit_sha", "files_touched"],
  "properties": {
    "completion_report_path": { "type": "string" },
    "ac_verdicts": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["criterion", "met"],
        "properties": {
          "criterion": { "type": "string" },
          "met": { "type": "boolean" },
          "notes": { "type": "string" }
        }
      }
    },
    "commit_sha": { "type": "string", "pattern": "^[0-9a-f]{7,40}$" },
    "files_touched": { "type": "array", "items": { "type": "string" } },
    "blockers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["description"],
        "properties": {
          "description": { "type": "string" },
          "resolution_hint": { "type": "string" }
        }
      }
    }
  }
}
```

### VERDICT_SCHEMA

Mirrors the `ReviewerVerdict` object from `execution-report.schema.json`:

```json
{
  "type": "object",
  "required": ["approved", "reviewer_type"],
  "properties": {
    "approved": { "type": "boolean" },
    "reviewer_type": {
      "type": "string",
      "enum": ["task-completion-validator", "karen", "council-review", "code-reviewer", "senior-code-reviewer"]
    },
    "required_fixes": {
      "type": "array",
      "items": { "type": "string" }
    },
    "council_artifacts": {
      "type": "object",
      "properties": {
        "run_dir": { "type": "string" },
        "findings_yaml": { "type": "string" },
        "scorecard_json": { "type": "string" },
        "risk_register_yaml": { "type": "string" },
        "decision_record_md": { "type": "string" },
        "validation_plan_md": { "type": "string" }
      }
    }
  }
}
```

---

## §7 — ExecutionReport Return Value

`execute-contract` returns a value conforming to `execution-report.schema.json`. The `report` array contains a single `WaveResult` with a single `PhaseResult` (the sprint phase). This matches the canonical schema so Opus post-processes it identically regardless of whether a plan ran via `execute-plan` or `execute-contract`.

**`routing_log` — drain it after the run, on every outcome.** Every exit carries a `routing_log` array
(`workflow-authoring-spec.md` §6.1) recording this run's fix-cycle provider routing: the Mode-D guard's
override to claude, the `bob-delegate-executor` dispatch, and the measured fallback when Bob fails. The
script cannot write it (constraint 1). `commands/dev/execute-contract.md` is hand-orchestrated and never
invokes this workflow, so the two real callers own the hop — a direct invoker, and `auto-feature` when it
nests this workflow (there, `commands/dev/autopilot.md` § "Handle the ExecutionReport" drains it):

```bash
node .claude/skills/delegation-router/log-cli.js --ingest <report.json> --task-id <node_or_contract_slug>
skillmeat routing audit --unconfirmed
```

Skipping it discards the run's routing decisions and leaves the audit reporting *nothing*, which reads
identically to *clean* (`node_01KZVV9R3EK13DJXS44VCQ8E9C`).

**Status semantics**:

| Status | When | Opus action |
|---|---|---|
| `complete` | Sprint done + reviewer approved (within ≤2 fix cycles) | Commit and close contract; update contract frontmatter (`status: completed`, `commit_refs`, `merge_commit`) |
| `needs_opus` (reason: `mode_d`) | Contract is Mode D | Run sprint interactively; return to workflow for review phase if desired |
| `needs_opus` (reason: `reviewer_unresolved`) | Fix-loop exhausted, reviewer still disapproves | Opus adjudicates; either fixes directly or re-scopes contract |
| `needs_opus` (reason: `budget_exhausted`) | Fix-loop hit budget floor before 2 cycles | Opus decides whether to continue with a fresh budget or scope-reduce |

---

## §8 — Opus Post-Run Responsibilities

The workflow script handles only the sprint-review-fix loop. On `status: 'complete'`, Opus must:

1. Read `report[0].phases[0].tasks[0].commit_sha` — the sprint agent's work commit.
2. Merge the worktree branch into the target branch (cross-worktree merge is a git mutation — stays with Opus per constraint 1).
3. Update contract frontmatter: `status: completed`, `files_affected`, `commit_refs` (append sprint SHA), `merge_commit`, `merge_branch`.
4. Run final validation commands (`pytest` / `pnpm test` + `type-check` + `lint`) — these are session commands, not workflow agents.
5. Check `.claude/progress/<slug>/` for a progress file and update via `update-batch.py` if the contract was tracked.

On `status: 'needs_opus'`, Opus reads `reason` and `blocked_phase` from the report and acts accordingly (see §7 status table).

---

## §9 — Budget Convention

`budget_total` defaults to `50000` tokens (the Tier 1 sprint budget hint from `SKILL.md §Tier 1 Autonomous Sprint`). Derive from contract `effort_points` using `effort_points × 6250` (e.g., 8 pts → 50K, 4 pts → 25K).

**Fix-loop guard threshold**: `budget.remaining() > 60_000`. This is inherited directly from the `fixLoop` pattern in `workflow-patterns.md`. Do not lower it — it is a runaway guard, not a quality dial.

If the sprint itself is expected to be large (8 pts, full-stack feature), set `budget_total: 80000` to leave headroom for two fix cycles after the sprint.

Token profile target: beat the ~326K Tier 1 trial baseline cited in `workflow-orchestration-integration-v1.md §4 T2` by moving orchestration round-trips out of Opus's context and into background agents.

---

## §10 — Extension Points

Future authors can extend `execute-contract` without modifying the core script:

1. **`fix_agent` override**: Pass `"fix_agent": "python-backend-engineer"` (or any domain expert) in `args` when the sprint is domain-specific and `feature-sprint-executor` is too broad for targeted fixes.

2. **`review_intensity: 'council'`**: Escalate to ARC review for contracts touching architecture or cross-domain concerns. The workflow routes to `agentType: 'council-review'`; the verdict includes `council_artifacts` paths for Opus post-run analysis.

3. **`context_paths`**: Inject additional codebase context the sprint agent should read. Passed verbatim into the sprint prompt. Keep the list narrow — wide context injection inflates sprint agent token cost.

4. **Budget scaling**: For 8-pt contracts expected to generate large diffs, set `budget_total: 80000`. For 3-pt contracts, `budget_total: 25000` is sufficient.

5. **Sub-workflow nesting**: A future release workflow could invoke `execute-contract` for a post-bump validation sprint via `workflow('execute-contract', args)`. One level of nesting only (authoring-spec §1).

6. **Sub-task sharding (Tier A nesting pilot)**: Pass `"subtask_sharding_enabled": true` in `args` (DEFAULT `false`) to let the on-primary `feature-sprint-executor` shard bounded, mechanical sub-tasks (test-writer, doc-updater, fixture-builder) to **depth-1 nested helper agents** via the `Agent` tool. This is the Phase 1 pilot of `.claude/plans/subagent-nesting-orchestration-strategy-v1.md` (§6), introduced to mitigate the *execute-contract-blows-context-on-large-files* failure mode by spreading mechanical context load. It is **pilot-gated and never auto-promoted** — with the flag off, `sprintPrompt` is byte-for-byte identical to the pre-pilot behaviour. Governance encoded inline in `buildSubtaskShardingClause()`:
   - **Depth cap = 1** — helpers must not spawn their own children.
   - **Single committer** — helpers run in the sprint's worktree but never `git add/commit/push/stash`; the sprint executor reviews and commits their output as its own logical units, keeping its commit history the sole durable record. (Phase 0 confirmed nested children inherit the parent's cwd and `acceptEdits`, so the no-commit rule is a behavioural instruction, not a permission boundary — keep helper slices small.)
   - **Bounded** — each helper < 25 tool uses, scoped to explicit named file paths.
   - **Mode-D-at-depth** — a sub-slice touching auth / payments / migrations / deletion / force-push / secret-rotation is neither delegated nor implemented; the sprint stops it and records a Completion Report blocker for Opus. (The contract is already gated non-Mode-D at §4; this is defense-in-depth.)
   - **Durability contract** — a nested subtree is, from the workflow's view, part of the single Stage-A `agent()` call; if a helper blows its context the whole sprint re-runs (no nested resume). Commit consolidated output promptly.

---

## §11 — Durability Design (two-stage sprint)

The Sprint phase is implemented as two sequential stages within the same `phase('Sprint')` group. This was introduced to prevent a terminal `StructuredOutput` miss from discarding committed sprint work (see `workflow-authoring-spec.md` §16).

**Stage A — `feature-sprint-executor` (no schema)**
- Runs the full autonomous sprint.
- Commits each logical unit to the worktree branch as it completes work (REQUIRED for durability).
- Writes the Completion Report to the path returned by `reportPathForContract(parsed)` (either `parsed.completion_report_path` if provided, or `.claude/worknotes/<slug>/completion-report.md` derived from the contract filename) BEFORE returning.
- Returns a plain-text human summary. No structured output.

**Stage B — `general-purpose` haiku (schema: SPRINT_RESULT_SCHEMA)**
- Reads the Completion Report from disk.
- Runs `git log`, `git diff --name-only`, and `git rev-parse HEAD` to fill `commit_sha` and `files_touched`.
- Parses the AC Status section to derive `ac_verdicts`.
- Sets a blocker if no new commits exist since the branch base (sign of an uncommitted sprint).
- Wrapped in try/catch: on failure, a minimal fallback result is used rather than crashing.

**Why this matters**: a `feature-sprint-executor` sprint may run for many minutes and make dozens of edits. If the agent's final `StructuredOutput` call fails (network hiccup, context overflow, runtime error), the old single-stage design would crash the workflow and discard the entire run. The two-stage design ensures: (a) committed work is always preserved in git regardless of Stage B outcome; (b) Stage B can be re-run or manually inspected if it fails.

**`reportPathForContract` helper**: pure string function. Returns `parsed.completion_report_path` if set in args; otherwise derives `.claude/worknotes/<slug>/completion-report.md` where `<slug>` = contract filename without directory or `.md` extension. No FS access.

---

## §12 — Four-Constraints Checklist (this workflow)

```
[x] No FS/shell access in script body
    — args envelope passed by Opus; no readFile, exec, or import fs in execute-contract.js

[x] Mode D phases trigger early return, never executed
    — contract_metadata.mode === 'D' OR files_affected heuristic → return {status:'needs_opus', reason:'mode_d'}
    — sprint agent is never spawned for Mode D contracts

[x] All reviewer agents use edit-less agentType
    — Phase 2 always uses task-completion-validator / karen / council-review
    — All three have disallowedTools covering Write/Edit/MultiEdit in their definitions
    — Never an inline prompt to a write-capable agent

[x] No Date.now() / Math.random() / new Date() in script body
    — timestamp passed via args.timestamp (Opus sets it pre-flight)
    — meta is a pure literal object; no expressions

[x] meta is a pure literal object (no computed values, no function calls)

[x] phase() titles match meta.phases exactly:
    'Sprint', 'Review', 'Fix cycle 1', 'Fix cycle 2'

[x] Budget guard present in fix-loop: budget.remaining() > 60_000

[x] Durability: sprint (Stage A) has no schema; commits checkpoints; writes report to disk
[x] Durability: structure stage (Stage B) wrapped in try/catch with fallback result
[x] Durability: fix agent prompt includes DURABILITY footer (commit to worktree, no push/merge/stash)
[x] reportPathForContract is pure string — no FS access
```
