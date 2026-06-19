---
schema_version: 2
doc_type: spec
title: "Explore & Spike Workflow Spec — Parallel Investigation and Research SPIKE"
status: active
created: 2026-06-01
owner: nick
related_documents:
  - .claude/specs/workflows/workflow-authoring-spec.md
  - .claude/plans/workflow-orchestration-integration-v1.md
  - .claude/skills/dev-execution/orchestration/workflow-patterns.md
  - .claude/skills/planning/SKILL.md
  - .claude/skills/planning/templates/exploration-charter-template.md
  - .claude/skills/planning/templates/feasibility-brief-template.md
  - .claude/commands/plan/explore.md
  - .claude/commands/plan/spike.md
  - .claude/rules/delegation-modes.md
---

# Explore & Spike Workflow Spec

Covers both `explore.js` and `spike.js`. Both workflows share this spec — they differ in focus
(charter-driven investigation vs. ad-hoc SPIKE research) but produce compatible output contracts and
follow the same phase structure. Each workflow maps exactly to the imperative flow already defined in
`/plan:explore` and `/plan:spike`; the workflow form makes the execution deterministic and resumable
without requiring Opus to drive the loop manually.

**Verdict sign-off rule (mandatory)**: Neither workflow self-approves a verdict. The workflow returns
a structured result with the synthesised findings and a `status: 'needs_opus'` / `reason:
'verdict_signoff'` return. Opus and the human review the synthesis and decide `go | no-go |
conditional`. This is a hard workflow boundary per constraint 2 (no mid-run sign-off).

---

## §1 — Purpose

| Workflow | Purpose |
|---|---|
| `explore` | Pre-commitment exploration. Orchestrates 1–4 investigation legs from an `exploration_charter`, runs them in parallel, deep-reads their outputs via `pipeline`, synthesises into a schema-valid `exploration_charter` result, and returns to Opus for verdict sign-off. |
| `spike` | Research SPIKE. Orchestrates 1–4 research legs (from a SPIKE charter or ad-hoc question list), runs them in parallel, deep-reads, synthesises into a schema-valid `feasibility_brief`, and returns to Opus for verdict sign-off. |

Both workflows are read-only from the script body's perspective — no file writes, no git operations.
All file writes are performed by the agents they spawn, following constraint 1.

---

## §2 — Args Contract

Opus builds `args` pre-flight from the charter (or ad-hoc description) and passes it when invoking
the workflow. The script never reads the charter or plan file itself — that violates constraint 1.

### `explore` args shape

```js
{
  workflow_type: 'explore',           // discriminator
  charter_ref: string,                // path to exploration_charter file (for agents to read)
  feature_slug: string,               // from charter frontmatter
  hypothesis: string,                 // from charter frontmatter — one falsifiable sentence
  deal_killer: string,                // from charter frontmatter — mandatory
  legs: Leg[],                        // 1–4 investigation legs (see Leg shape below)
  output_dir: string,                 // docs/project_plans/exploration/[slug]/
  synthesis_output: string,           // path where synthesis agent writes its output
  timestamp: string,                  // ISO 8601 from Opus; never Date.now() in script
  budget_total: integer,              // token ceiling
  dry_run: boolean,                   // default false; return parsed args without spawning
  depth: 'shallow' | 'standard' | 'deep',  // controls pipeline deep-read intensity
}
```

### `spike` args shape

```js
{
  workflow_type: 'spike',             // discriminator
  charter_ref: string,                // path to SPIKE charter file (for agents to read)
  spike_slug: string,                 // from charter; matches output directory name
  research_questions: string[],       // 3–7 questions from charter (or ad-hoc scope)
  legs: Leg[],                        // 1–4 research legs (see Leg shape below)
  output_dir: string,                 // docs/dev/architecture/spikes/[spike-slug]/
  //   OR docs/project_plans/exploration/[slug]/spikes/[leg-id]/  when leg_of is set
  synthesis_output: string,           // path where synthesis agent writes its output
  leg_of: string | null,              // parent exploration_charter path when running as a leg
  timestamp: string,                  // ISO 8601 from Opus; never Date.now() in script
  budget_total: integer,
  dry_run: boolean,
  depth: 'shallow' | 'standard' | 'deep',
}
```

### Leg shape (shared by both)

```js
{
  id: string,                         // e.g. 'tech', 'value', 'risk', 'priorart'
  question: string,                   // the specific research question this leg must answer
  prompt: string,                     // full prompt string built by Opus for this leg's agent
  agentType: string,                  // read-only agentType — see §4
  model: string,                      // 'haiku' for pattern discovery; 'sonnet' for deep analysis
  output_path: string,                // where the leg agent writes its findings file
}
```

**Leg count**: 1–4. Fewer legs = faster; more legs = broader coverage. Default 2 for `explore`
(technical + value); default 2–3 for `spike` (technical + prior-art + risk when scope warrants).

**Pseudo-randomness without `Math.random()`**: vary agent prompts by leg index (e.g. `leg-0`,
`leg-1`) to produce diverse investigation angles. Do not use `Math.random()` or `Date.now()`.

---

## §3 — Phases

Both workflows follow the same four-phase structure. Phase titles must match `meta.phases` exactly.

| # | Phase title | Primitives | Agents |
|---|---|---|---|
| 1 | `'Exploration'` | `parallel(legs.map(...))` | Read-only leg agents (Mode A) |
| 2 | `'Deep read'` | `pipeline(legResults, deepStage)` | `codebase-explorer` (sonnet) |
| 3 | `'Adversarial verify'` | `adversarialVerify(deepResults)` | `senior-code-reviewer` (sonnet) |
| 4 | `'Synthesis'` | `agent(synthesisPrompt, schema)` | `implementation-planner` (sonnet) |

The workflow returns after Phase 4 with `{ status: 'needs_opus', reason: 'verdict_signoff', ... }`.
Opus and the human review the synthesis and sign off on the verdict. This is the workflow boundary.

### Phase 1 — Exploration (parallel legs)

Use `parallel` — all leg results are needed together before deep-read can begin. A failing leg
resolves to `null`; `.filter(Boolean)` before proceeding. The barrier is intentional: synthesis
requires the complete picture.

Leg agents are **read-only by agent definition** (constraint 3). Use `agentType: 'codebase-explorer'`
for code pattern discovery, `agentType: 'search-specialist'` for external/prior-art research. Neither
agent definition carries edit tools. Do not pass leg prompts to write-capable agents.

Each leg's prompt includes:
- Mode marker: `Mode: A — Exploration Only`
- The specific research question (`leg.question`)
- The charter ref path (for the agent to read charter context)
- Output path (`leg.output_path`) where findings must be written
- Explicit: `Do NOT git add/commit/push/stash`

### Phase 2 — Deep read (pipeline)

Use `pipeline` — legs are independent; maximum throughput; a straggler does not block others. Each
leg result is passed through a single deep-read stage: a `codebase-explorer` agent (sonnet) that
structures the raw findings into a normalized object. A failing stage drops that item to `null`;
`.filter(Boolean)` before adversarial verify.

**Depth control**: the `depth` arg governs the deep-read prompt intensity. `shallow` — extract key
claims only; `standard` — extract claims + supporting evidence; `deep` — extract claims + evidence +
alternative interpretations + confidence score. Default: `standard`.

### Phase 3 — Adversarial verify

Use `adversarialVerify` from the pattern library with `{ skeptics: 2 }`. Skeptic agents use
`agentType: 'senior-code-reviewer'` (edit-less by definition). A finding majority-refuted by skeptics
is dropped; survivors proceed to synthesis with higher confidence.

For `depth: 'deep'`, increase skeptic count to 3 for higher-stakes research.

### Phase 4 — Synthesis

A single `implementation-planner` (sonnet) agent synthesises the verified findings into:

- For `explore`: a schema-valid `ExplorationCharter` result object
- For `spike`: a schema-valid `FeasibilityBrief` result object

The agent is prompted with the verified findings, the charter/SPIKE context (via paths), and the
output contract schema. It writes the synthesis file to `args.synthesis_output`. The schema enforced
via `schema:` forces the agent to retry on mismatch at the tool layer — no manual retries in script.

After synthesis, the workflow optionally runs `completenessCritic` (budget-guarded) to catch gaps.

**No verdict gate inside the workflow.** The synthesised `verdict` field is populated by the
synthesis agent as a structured field (`go | no-go | conditional`) with a `verdict_rationale` and
`verdict_confidence`, but Opus and the human decide whether to act on it. The workflow always returns
`status: 'needs_opus', reason: 'verdict_signoff'` — never `status: 'complete'`.

---

## §4 — Agent Routing

### Read-only leg agentTypes (Mode A enforcement via agent definition)

| Leg type | agentType | Model | Role |
|---|---|---|---|
| `technical` | `codebase-explorer` | `haiku` (discovery) or `sonnet` (deep) | Code pattern discovery, symbol queries, file mapping |
| `value` | `search-specialist` | `sonnet` | External evidence, user signals, prior demand |
| `risk` | `codebase-explorer` | `sonnet` | Risk surface, blast-radius analysis |
| `priorart` | `search-specialist` | `sonnet` | Prior art, existing patterns, external references |
| `research` (generic SPIKE) | `codebase-explorer` | `sonnet` | Technical feasibility, integration constraints |

These `agentType` definitions carry `disallowedTools` that prevents Write/Edit/MultiEdit. This is the
only reliable way to enforce read-only in a workflow — the script cannot enforce it via prompt text
(constraint 3).

### Supporting agents

| Stage | agentType | Model | Notes |
|---|---|---|---|
| Deep-read | `codebase-explorer` | `sonnet` | Structured extraction; edit-less |
| Adversarial skeptic | `senior-code-reviewer` | `sonnet` | Edit-less; 2 skeptics default |
| Synthesis | `implementation-planner` | `sonnet` | Writes synthesis output; schema-validated |
| Completeness critic | `senior-code-reviewer` | `sonnet` | Edit-less; budget-guarded |
| Gap-fill improvement | `implementation-planner` | `sonnet` | Improves synthesis if gaps found |

**Reviewer agents are always edit-less.** Never pass a synthesis or review task as an inline prompt
to a write-capable agent.

---

## §5 — Output Contracts

### `ExplorationCharter` result (returned by `explore`)

The synthesis agent produces a structured object conforming to the `exploration_charter` template
shape. This is the machine-readable result consumed by Opus:

```js
{
  feature_slug: string,
  hypothesis: string,
  verdict: 'go' | 'no-go' | 'conditional',        // populated by synthesis; confirmed by Opus
  verdict_confidence: number,                       // 0.0–1.0
  verdict_rationale: string,                        // 2–4 sentences citing leg findings
  deal_killer_triggered: boolean,
  investigation_summary: [{
    leg_id: string,
    confidence: number,                             // 0.0–1.0
    conclusion: string,                             // one-line summary
    findings_path: string,                          // path written by leg agent
    partial: boolean,                               // true if leg timed out
  }],
  open_questions: string[],
  recommended_next_action: string | null,
  synthesis_path: string,                           // path to written synthesis file
}
```

The `verdict` field here is Opus's input, not its decision. Opus reviews and signs off.

### `FeasibilityBrief` result (returned by `spike`)

Mirrors the `feasibility-brief-template.md` shape. Machine-readable fields:

```js
{
  feature_slug: string,
  verdict: 'go' | 'no-go' | 'conditional',        // populated by synthesis; confirmed by Opus
  verdict_confidence: number,                       // 0.0–1.0
  verdict_rationale: string,
  exploration_charter_ref: string | null,          // set when spike runs as a leg
  proposed_adr_ref: string | null,
  recommended_next_action: string | null,
  investigation_summary: [{
    leg_id: string,
    agent: string,
    confidence: number,
    findings_path: string,
    conclusion: string,
    partial: boolean,
  }],
  cost_estimate_range: string | null,
  risk_summary: [{
    risk: string,
    category: 'technical' | 'operational' | 'organizational',
    severity: 'H' | 'M' | 'L',
  }],
  open_questions: string[],
  synthesis_path: string,
}
```

### Workflow return envelope (both workflows)

```js
{
  status: 'needs_opus',                            // always; verdict boundary is never crossed
  reason: 'verdict_signoff',
  workflow_type: 'explore' | 'spike',
  charter_ref: string,
  synthesis: ExplorationCharter | FeasibilityBrief,
  legs_run: integer,
  legs_partial: integer,
  verified_findings_count: integer,
  budget_remaining: integer,
}
```

Opus receives this envelope, reviews `synthesis.verdict` and `synthesis.verdict_rationale`, presents
the recommendation to the user, obtains sign-off, and records the verdict via CLI:

```bash
python .claude/skills/artifact-tracking/scripts/manage-exploration-status.py \
  --file [charter-path] --status concluded \
  --verdict [go|no-go|conditional] \
  --verdict-rationale "..."
```

---

## §6 — Verdict Sign-Off Boundary

**The verdict sign-off is always a workflow boundary.** This follows directly from constraint 2:
no mid-run human sign-off is possible, and the docs are explicit — "for sign-off between stages, run
each stage as its own workflow."

The workflow never transitions a `verdict` from the synthesis agent into an approved decision.
`synthesis.verdict` is a recommendation for Opus, not a fait accompli.

Sign-off rules (carried forward from `/plan:explore` Phase 4):

| Verdict | Required action |
|---|---|
| `go` | Human sign-off required. |
| `no-go` | Human sign-off required. |
| `conditional` | May auto-close only when the precondition is concrete and time-bound; otherwise human sign-off required. |

After sign-off, Opus records the verdict via the `manage-exploration-status.py` CLI script (no token
cost for progress update) and routes handoff per the verdict:

- `go` → `/plan:plan-feature --tier=[N]`
- `no-go` → `recommended_next_action: archive`
- `conditional` → `recommended_next_action: "defer-until: [concrete condition]"` + backlog entry

---

## §7 — Four-Constraints Checklist

Both workflows must pass the full checklist from `workflow-authoring-spec.md` §5.

```
[x] No FS/shell access in script body
    — args built by Opus pre-flight; leg agents write files; script only reads from agent results
[x] Mode D phases trigger early return, never executed
    — research/explore workflows have no implementation phases; no Mode D phases in scope
    — if args.legs includes any entry with mode 'D', return needs_opus immediately (defensive)
[x] All reviewer agents use edit-less agentType
    — codebase-explorer, search-specialist (legs); senior-code-reviewer (skeptics, critic)
    — synthesis via implementation-planner (writes synthesis file; not a reviewer role)
[x] No Date.now() / Math.random() / new Date() in script body
    — args.timestamp from Opus; leg index used for pseudo-randomness
[x] meta is a pure literal object
[x] phase() titles match meta.phases exactly
[x] Budget guard present in completenessCritic call
```

---

## §8 — Extension Points

**Leg count**: 1–4 legs. Default 2. A 4-leg explore run covers technical + value + risk + priorart.

**Depth levels**: `shallow | standard | deep`. Controls deep-read stage prompt intensity and skeptic
count. Wire via `args.depth`.

**Completeness critic**: optional, budget-guarded. Enabled by default when `budget.remaining() >
80_000` after synthesis. Disable with `args.skip_completeness_critic = true`.

**Exploration-leg mode** (spike only): when `args.leg_of` is set, the spike workflow runs as a
single leg within a parent explore workflow. Output paths shift to
`docs/project_plans/exploration/[slug]/spikes/[leg-id]/`. The leg appends a confidence score and
`status: complete | partial` to the parent charter's `output_artifacts` array via its synthesis
agent.

**Seeded findings**: Opus may pass `args.seeded_findings: string[]` with prior research context
(e.g., findings from a previous partial run). Synthesis prompt incorporates these as priors.

**Tie-breaker protocol**: when two or more legs produce conflicting claims at high confidence (both
>= 0.7), the adversarial verify phase escalates to 3 skeptics per conflicting finding pair (instead
of 2). If a majority still cannot be established, the conflict surfaces in `open_questions` with
both positions cited. Synthesis must not silently drop either position.

**Sequential fallback**: pass `args.sequential = true` to run legs serially (Phase 1 becomes a `for`
loop rather than `parallel`). Used for resource-constrained environments or debugging. Default is
parallel.

**Tier A nesting pilot** (`args.leg_recursion_enabled`, DEFAULT `false`): when `true`, each read-only
leg may spawn a single depth-capped layer of read-only child investigators for bounded decomposition
of a narrow sub-question. This is the Phase 1 pilot of
`.claude/plans/subagent-nesting-orchestration-strategy-v1.md` (§6). It is **pilot-gated and never
auto-promoted** — with the flag off, leg prompts are byte-for-byte identical to the pre-pilot
behaviour. Governance encoded inline in `buildLegRecursionClause()`:

- **Depth cap = 1** — children must not spawn their own children.
- **Read-only by agentType** — children must use `codebase-explorer` / `search-specialist`
  (`disallowedTools` block writes; Phase 0 confirmed `permissionMode` propagates to depth, so prompt
  text alone cannot enforce read-only — the agentType must).
- **Bounded** — each child < 15 tool uses; sub-questions narrow and mechanical.
- **Mode-D-at-depth** — a sub-question touching auth / payments / migrations / deletion / force-push /
  secret-rotation is not investigated via a child; the thread stops and records `needs_opus / mode_d`.
- **Single author** — children write nothing to git; the leg consolidates results into its one
  findings file.
- **Claude-primary-only** (§5.2) — the recursion clause is **suppressed when the leg is offloaded**
  (`provider_routing_enabled` + `gemini-executor`); an external shell-out leg cannot nest. The
  effective predicate is `leg_recursion_enabled && !offloadLegsToGemini`.

---

## §9 — What Does Not Change

The output file contracts produced by exploration agents (charter files, SPIKE findings, feasibility
briefs, ADRs) are **identical** to those produced by the manual `/plan:explore` and `/plan:spike`
commands. The workflow is a deterministic execution layer; it does not change:

- The `exploration_charter` frontmatter schema (template at `skills/planning/templates/`)
- The `feasibility_brief` frontmatter schema (template at `skills/planning/templates/`)
- Output file locations and naming conventions
- The charter update CLI conventions (`manage-exploration-status.py`)
- The verdict sign-off protocol (Opus + human; not the workflow)
- Agent assignments from `exploration-legs-catalog.md`

Any change to these contracts must be made in the planning skill templates and catalog, then
reflected here and in the workflow scripts. The workflow spec is downstream of the planning skill.

---

## §10 — Operational Notes

- **Concurrency**: legs run at full concurrency (capped by `min(16, cores-2)`). For 4-leg explores
  on resource-constrained machines, use `args.sequential = true`.
- **Partial leg handling**: a leg whose agent returns `null` (user skip or timeout) is recorded as
  `partial: true` in the synthesis. Synthesis proceeds; the gap is surfaced in `open_questions`.
  Do not abort on a single null leg.
- **Budget allocation**: exploration runs are lighter than implementation runs. Allocate ~20–40K
  tokens total for a standard 2-leg explore; ~30–60K for a 4-leg deep explore. Set `args.budget_total`
  in Opus pre-flight accordingly.
- **Model routing**: legs use `haiku` for pure pattern discovery (`technical` legs against local
  codebase); `sonnet` for legs requiring reasoning (`value`, `risk`, `priorart`). Deep-read and
  synthesis always use `sonnet`. Deep-read and synthesis always use `sonnet`. Pass model per leg in
  `args.legs[i].model`.
- **Resume**: same-session only (constraint 4). Leg results cached within session. No commit-as-you-go
  needed (read-only workflows). On restart, Opus relaunches with same `args`; parallel re-execution
  is safe.
