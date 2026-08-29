# Wave-Plan Guidance

> **Model policy:** [`docs/agentic-operator/MODEL-ROUTING.md`](../../../../docs/agentic-operator/MODEL-ROUTING.md) (§1.5 scorecard) is canonical. Model/effort tables in this file are derived convenience copies — when they disagree, MODEL-ROUTING wins; update it first, then re-derive here. Resolve provider/model per leg via the `delegation-router` skill; the platform skills (`ica-delegate`, `codex`, `gemini-cli`) only execute the decision.

## What Is `wave_plan` and When to Populate It

`wave_plan` is a YAML block in an implementation plan's frontmatter that encodes the phase dependency graph and file-ownership constraints for a feature. It tells `/dev:execute-plan` which phases can run concurrently, which files act as serialization barriers, and which phases require worktree isolation.

Per **D2** (spec §4.1), `wave_plan` lives in the implementation plan frontmatter — not in a separate file. Keeping it colocated preserves a single source of truth: one artifact, one place to update, no fork-of-truth risk.

`implementation-planner` should populate `wave_plan` for **Tier 2 plans** when phases are plausibly independent (distinct data/API/UI concerns with no shared file write), and for **all Tier 3 plans** by default. Omit it for Tier 0/1 features or any plan whose phases are strictly sequential by nature. When omitted, `/dev:execute-plan` falls back to phase-number-ordered sequential execution — safe and correct, just slower.

---

## Routing constraints (what replaces the pins)

Per `plan-doctrine.md` rule 3 (no plan-time model or agent pins), `wave_plan` still encodes the
**dependency and isolation graph** — that structure is orthogonal to routing and is unaffected by
this doctrine. What changes is the model/provider/profile fields below: a plan states a
**constraint**, never an identity, and `delegation-router` resolves provider + model at dispatch
time against the live registry.

A routing constraint is a short prose statement attached to a phase or milestone, e.g.:

- "This phase's merge-path correctness MUST stay claude-primary."
- "This phase is a mechanical sweep — offload-eligible."
- "Capability bar: needs frontier-level architectural judgment; do not route to an economy model."

Never write a model id, provider name, or profile as that constraint. The fields documented in
the schema below (`model`, `orchestrator_model`, `provider`, `profile`) are the pre-doctrine
mechanism — kept parsing for in-flight plans, deprecated for new ones.

---

## Schema Reference

```yaml
wave_plan:
  # DELETED (Claude-5 doctrine) — `orchestrator_model` was advisory prose the orchestration loop
  # never read (it cannot switch its own main-loop model mid-run). See plan-doctrine.md rule 3.
  serialization_barriers:     # Optional list; omit if no shared files exist
    - CLAUDE.md               # Files that force serialization when touched by >1 phase
    - skillmeat/api/openapi.json
    - README.md
    - .claude/settings.json
  phases:
    - id: P1                  # Required. Short label matching the phase number (P1, P2, …)
      depends_on: []          # Required. List of phase ids this phase must follow; [] = no deps
      isolation: shared       # Required. shared | worktree (see Isolation Decision Aid below)
      parallelizable: true    # Optional (default: true). False = force solo wave even if deps allow parallel
      owner_skills: []        # Optional. Skill names to pre-load on the phase-owner agent
      files_affected:         # Recommended. Paths the phase writes; used for barrier intersection check
        - skillmeat/cache/models/foo.py
        - skillmeat/cache/migrations/202605_xx_add_foo.py
      # DELETED (Claude-5 doctrine) — `orchestrator_model` (phase-level override) removed; see plan-doctrine.md rule 3.
      # DEPRECATED (Claude-5 doctrine) — plan-time model pins are obsolete; plans carry a routing
      # constraint instead (see "Routing constraints" above) and `delegation-router` resolves the
      # model at dispatch time. Legacy plans authored before this doctrine may still carry `model:`
      # and it still parses/executes. See plan-doctrine.md rule 3.
      model: sonnet           # Optional. Default model for this phase's implementer dispatches.
                              #   Values: opus | sonnet | haiku | gpt-5.6-terra | gemini-3.5-flash | gemini-3.1-pro-preview | nano-banana-pro
                              #   Per-task `Model` column overrides this default.
      effort: adaptive        # Optional. Default thinking budget for this phase's implementers.
                              #   Valid values depend on the chosen model — see Effort Vocabulary section below.
                              #   Per-task `Effort` column overrides this default.
    - id: P2
      depends_on: [P1]
      isolation: shared
      files_affected:
        - skillmeat/api/routers/foo.py
        - skillmeat/api/openapi.json    # touches a serialization barrier
    - id: P3
      depends_on: [P1]
      isolation: worktree             # risky: auth/migration work in isolated branch
      owner_skills: [frontend-design]
      files_affected:
        - skillmeat/web/components/foo/*.tsx
        - skillmeat/api/openapi.json    # also touches the barrier → forces wave split from P2
    - id: P4
      depends_on: [P2, P3]
      isolation: shared
      files_affected: []
  waves:                      # Derived field. Compute from the algorithm below; include in plan for clarity.
    - [P1]
    - [P2]                    # P2 and P3 separated despite same dep-tier (barrier collision on openapi.json)
    - [P3]
    - [P4]
```

### Field Reference

| Field | Type | Required | Default | Semantics |
|-------|------|----------|---------|-----------|
| `serialization_barriers` | `string[]` | Optional | `[]` | Files that must never be written by two phases in the same wave. Any collision triggers a wave split. Typical candidates: `openapi.json`, `CLAUDE.md`, `README.md`, `.claude/settings.json`. |
| `phases[].id` | `string` | Required | — | Short label (`P1`, `P2`, …). Must match phase numbering in the Phase Breakdown section. |
| `phases[].depends_on` | `string[]` | Required | — | Phase ids that must reach `completed` status before this phase can start. Empty list = no dependency. |
| `phases[].isolation` | `enum` | Required | — | `shared`: phase-owner works on the active branch. `worktree`: phase-owner is spawned with `isolation: "worktree"` — gets a temp branch, changes are auto-cleaned if empty. See §2.5. |
| `phases[].parallelizable` | `bool` | Optional | `true` | Set to `false` to force a phase into its own solo wave even when its deps are satisfied alongside siblings. Use for phases with known but unmodeled coupling. |
| `phases[].owner_skills` | `string[]` | Optional | `[]` | Skills injected into the `phase-owner` agent at spawn via the `skills:` preload mechanism. Full SKILL.md is injected at startup — audit token size before adding. |
| `phases[].files_affected` | `string[]` | Recommended | `[]` | Files the phase is expected to write. Used by the decomposition algorithm to detect barrier intersections. Glob patterns are permitted but discourage overly broad entries. |
| `phases[].model` | `string` | Optional | — | **DEPRECATED (Claude-5 doctrine)** — plan-time model pin; obsolete within days of authoring (`plan-doctrine.md` rule 3). Legacy plans may still carry it and it still parses/executes. New plans express a routing constraint instead (see "Routing constraints" above). Values: `opus` \| `sonnet` \| `haiku` \| `gpt-5.6-terra` \| `gemini-3.5-flash` \| `gemini-3.1-pro-preview` \| `nano-banana-pro`. Per-task `Model` column overrides this default. |
| `phases[].effort` | `string` | Optional | — | Default thinking budget for this phase's implementers. Valid values depend on the chosen model — see Effort Vocabulary section below. Per-task `Effort` column overrides this default. |
| `phases[].provider` | `string` | Optional | — | **DEPRECATED (Claude-5 doctrine)** — plan-time provider pin; `delegation-router` resolves provider at dispatch time (`plan-doctrine.md` rule 3). Legacy plans may still carry it. Values: `claude` \| `ica` \| `codex` \| `gemini`. Per-task `Provider` column overrides. Defaults resolve via the global model registry (`~/.claude/config/model-registry.yaml`) + the global `delegation-router` skill (`~/.claude/skills/delegation-router/`) — R2 policy: Opus/Sonnet/Haiku default to `claude`; ICA/Codex/Gemini are explicit opt-ins, never defaults. |
| `phases[].profile` | `string` | Optional | — | **DEPRECATED (Claude-5 doctrine)** — plan-time profile pin; same rationale as `phases[].provider` above (`plan-doctrine.md` rule 3). Legacy plans may still carry it. Examples: `free-tier` (ICA), `sandbox=read-only` (Codex), `web-search=on` (Gemini). Per-task `Profile` column overrides. See the global `delegation-router` skill (`~/.claude/skills/delegation-router/references/model-registry.md`). |
| `waves` | `string[][]` | Derived | — | Computed output of the two-pass algorithm. Include explicitly in the plan so orchestrators and human reviewers can verify correctness without running the algorithm. |

---

## Decomposition Algorithm

The orchestrator (or `implementation-planner` at authoring time) computes `waves` in two passes.

**Pass 1 — Topological sort on `depends_on`**: assign each phase to the earliest wave where all its dependencies are in prior waves:

```
wave_assignment = {}
ready = [p for p in phases if p.depends_on == []]

wave = 1
while ready:
    wave_assignment[wave] = ready
    next_ready = []
    for p in phases not yet assigned:
        if all deps of p are in wave_assignment[w] for w < wave:
            next_ready.append(p)
    ready = next_ready
    wave += 1
```

After pass 1, phases in the same wave have satisfied dependencies and would logically run in parallel.

**Pass 2 — Split on serialization barrier intersections**

Within each wave produced by pass 1, check whether any two phases both write a file in `serialization_barriers` (or both write the same non-barrier file):

```
for wave_N in waves:
    groups = []
    for phase in wave_N:
        placed = False
        for group in groups:
            collision = any(
                f in phase.files_affected and f in other.files_affected
                for other in group
                for f in serialization_barriers + other.files_affected
            )
            if not collision:
                group.append(phase)
                placed = True
                break
        if not placed:
            groups.append([phase])
    # Replace wave_N with the split groups (each becomes its own sequential wave)
    waves = expand(wave_N, groups)
```

The result is a refined wave list where no two concurrent phases write the same serialization-barrier file. The total order of waves is preserved; splits only add adjacent waves, never re-order dependencies.

---

## Isolation Decision Aid

### Mark `isolation: worktree` when the phase:

- Contains a **schema migration** not trivially reversible (DROP COLUMN, ALTER TYPE with data transform, UUID key change).
- Touches **auth, payments, or secret rotation** infrastructure — classic Mode D triggers.
- Is an **exploratory / experimental spike** where Opus may want to discard the output entirely.
- Performs a **large-scale file move or rename** (>10 files) where git merge complexity is high.
- Is designated as a **parallel experiment** where two approaches compete and only one will be merged.

See spec §2.5 for the three canonical use cases (risky single-phase, parallel experiments, spike-while-implementing).

### Keep `isolation: shared` (the default) when:

- The phase writes to well-understood, non-conflicting files.
- The phase has no Mode D triggers.
- The feature is Tier 2 with low merge complexity.
- Most normal work: adding a router, building a UI component, writing tests.

**Cost note**: Worktree creation is cheap. The cost is in the merge-back step — Opus must explicitly integrate the worktree branch before the next wave can start. Use `isolation: worktree` deliberately, not defensively.

---

## Worked Examples

### Example 1 — Linear Plan (All Sequential)

Three phases with a strict chain: P1 → P2 → P3. No parallelism; each phase depends on the prior.

```yaml
wave_plan:
  serialization_barriers:
    - skillmeat/api/openapi.json
  phases:
    - id: P1
      depends_on: []
      isolation: shared
      files_affected:
        - skillmeat/cache/models/widget.py
        - skillmeat/cache/migrations/202605_01_add_widget.py
    - id: P2
      depends_on: [P1]
      isolation: shared
      files_affected:
        - skillmeat/api/routers/widgets.py
        - skillmeat/api/openapi.json
    - id: P3
      depends_on: [P2]
      isolation: shared
      files_affected:
        - skillmeat/web/components/widgets/widget-list.tsx
  waves:
    - [P1]
    - [P2]
    - [P3]
```

Strict chain: each phase gets its own wave. Pass 2 finds no concurrent phases to check. Identical to legacy phase-number ordering — `wave_plan` adds no wall-clock benefit here but documents intent explicitly.

---

### Example 2 — Fan-Out Plan (Parallel Middle Phases)

P1 bootstraps, then P2 (API) and P3 (UI) can run in parallel, then P4 (integration testing) waits for both.

```yaml
wave_plan:
  serialization_barriers:
    - skillmeat/api/openapi.json
    - README.md
  phases:
    - id: P1
      depends_on: []
      isolation: shared
      files_affected:
        - skillmeat/cache/models/campaign.py
    - id: P2
      depends_on: [P1]
      isolation: shared
      owner_skills: [skillmeat-cli]
      files_affected:
        - skillmeat/api/routers/campaigns.py
        - skillmeat/api/schemas/campaign.py
    - id: P3
      depends_on: [P1]
      isolation: shared
      owner_skills: [frontend-design]
      files_affected:
        - skillmeat/web/components/campaigns/campaign-card.tsx
        - skillmeat/web/hooks/use-campaigns.ts
    - id: P4
      depends_on: [P2, P3]
      isolation: shared
      files_affected:
        - tests/integration/test_campaigns.py
        - skillmeat/web/__tests__/campaign-card.test.tsx
  waves:
    - [P1]
    - [P2, P3]   # parallel: distinct files, no barrier collisions
    - [P4]
```

Pass 1: P1 (wave 1), P2 + P3 together (wave 2), P4 (wave 3). Pass 2: P2 and P3 share no files and neither touches a barrier — no split. P2-owner and P3-owner launch concurrently with `run_in_background: true`.

---

### Example 3 — Diamond with Serialization Barrier Split

P2 and P3 both depend on P1 (diamond shape), but both need to write `openapi.json`. The barrier forces a split.

```yaml
wave_plan:
  serialization_barriers:
    - skillmeat/api/openapi.json
  phases:
    - id: P1
      depends_on: []
      isolation: shared
      files_affected:
        - skillmeat/cache/models/export.py
    - id: P2
      depends_on: [P1]
      isolation: shared
      files_affected:
        - skillmeat/api/routers/exports.py
        - skillmeat/api/openapi.json      # barrier write
    - id: P3
      depends_on: [P1]
      isolation: worktree                 # auth scope — Mode D risk
      owner_skills: [frontend-design]
      files_affected:
        - skillmeat/web/components/exports/export-dialog.tsx
        - skillmeat/api/openapi.json      # also a barrier write — collision with P2
    - id: P4
      depends_on: [P2, P3]
      isolation: shared
      files_affected:
        - tests/e2e/test_export_flow.py
  waves:
    - [P1]
    - [P2]      # P2 and P3 would be wave 2 from pass 1, but openapi.json collision forces split
    - [P3]
    - [P4]
```

Pass 1: P2 and P3 land in wave 2. Pass 2: both write `openapi.json` (a barrier) — collision. P3 splits to wave 3; P4 becomes wave 4. Wall-clock is linear, but the reason is explicit — barrier collision, not a false dependency.

---

## Why Plain `Task()`, Not `TeamCreate`

The `/dev:execute-plan` command dispatches every phase-owner via **plain `Task()`**, not via `TeamCreate` or the `team_name:` parameter, even though "team" sounds like the natural primitive for parallel phase work. Five independent constraints from the Agent Teams limitations docs make `TeamCreate` unworkable here:

| Constraint | Location | Effect on phase-owner workflow |
|------------|----------|-------------------------------|
| **L5 — no nested teams** | https://code.claude.com/docs/en/agent-teams#limitations, bullet 5 | Teammates cannot spawn their own teammates. Phase-owners must spawn implementers (the third level of the hierarchy) — impossible inside a team. |
| **L4 — one team at a time per lead** | Same doc, bullet 4 | Opus already orchestrates multiple phase-owners concurrently (parallel wave). Starting a second team would violate this constraint. |
| **L7 — permissions set at spawn** | Same doc, bullet 7 | Per-phase `permissionMode:` differentiation (e.g., `worktree`-isolated phases may warrant a different mode) cannot be set per-teammate at spawn time; it must be encoded in agent frontmatter. Plain `Task()` respects frontmatter `permissionMode:` unconditionally. |
| **Issue #33045** | Platform bug | `isolation: "worktree"` is silently ignored for team-spawned agents. Risky-phase isolation (spec §2.5) would be invisibly broken — no error, just no isolation. |
| **Issue #29441** | Platform bug | `skills:` frontmatter is not preloaded for team-spawned teammates. `owner_skills` in `wave_plan` (the primary per-phase skill delivery mechanism) would be inert. |

All five bind simultaneously for any `TeamCreate` usage in this workflow. None bind for plain `Task()`. The canonical reference is https://code.claude.com/docs/en/agent-teams#limitations.

This is codified as a load-bearing invariant in spec §2.1. The phase-owner agent body includes a top-of-file callout and a defensive self-check to catch accidental regression (spec §3.1).

---

## When You Would Actually Want `TeamCreate`

`TeamCreate` (Agent Teams) is the right primitive for a narrow set of scenarios that do not overlap with `/dev:execute-plan`:

- **Interactive human-lead debugging**: A human is the lead who wants to talk directly to each "teammate" in a split-pane or in-process session. The live chat model — not the background-subagent model — fits.
- **Cross-perspective brainstorming with a fixed roster**: Opus wants genuine peer-to-peer deliberation among a small set of named agents (e.g., architect + security reviewer + PM) on a decision, not task delegation.
- **`SendMessage` peer-to-peer loops**: When agents genuinely need to converse with each other (not hub-and-spoke through Opus), `SendMessage` between named teammates adds value that is hard to replicate with plain `Task()`.

None of these patterns match the `/dev:execute-plan` use case, which is background-parallel task execution with hub-and-spoke delegation from Opus through phase-owners to implementers.

---

## Authoring Checklist for `implementation-planner`

When populating `wave_plan` in a new plan:

- [ ] List all `serialization_barriers` relevant to this feature (openapi.json, CLAUDE.md, README.md, settings.json are the standard candidates).
- [ ] For each phase: assign `id`, list `depends_on` (use phase ids, not phase numbers), choose `isolation` (default `shared`), enumerate `files_affected` (at minimum the primary files the phase writes).
- [ ] Set `owner_skills` on phases with substantial domain context needs (e.g., a frontend phase benefits from `frontend-design`; a DB migration phase benefits from `skillmeat-cli`).
- [ ] Run the two-pass algorithm mentally or via pseudocode; write the derived `waves` block explicitly.
- [ ] Verify no two phases in the same wave share a `serialization_barriers` entry.
- [ ] If any phase is `isolation: worktree`, confirm it has a Mode D trigger or is genuinely experimental.

**Fallback**: If `wave_plan` is omitted entirely, `/dev:execute-plan` falls back to phase-number-ordered sequential execution. This is safe and correct — it just forgoes parallelism. Omit for Tier 0/1 plans and any Tier 2 plan where all phases are strictly sequential.

---

## Effort Vocabulary

Source of truth: `.claude/config/multi-model.toml` § `[models.effort_levels]`

| Model family | Models | Valid Effort values | Default |
|---|---|---|---|
| claude | opus, sonnet, haiku | `adaptive`, `extended` | `adaptive` |
| codex | gpt-5.6-terra | `none`, `low`, `medium`, `high`, `xhigh` | `medium` |
| gemini | gemini-3.5-flash, gemini-3.1-pro-preview | `none`, `low`, `medium`, `high` | `medium` |
| nano_banana | nano-banana-pro | `standard`, `quality` | `standard` |

**Critical rule**: Effort is a model-keyed reasoning budget, NOT a size estimate. Story points or hours belong in the per-task `Estimate` column. Putting `"3pts"` or `"2h"` in the `Effort` column is a common mistake — those values should be in `Estimate`.

**Override precedence (legacy plans only)**: for plans authored before the Claude-5 doctrine that
still carry per-phase `model`/`effort` defaults and per-task `Model`/`Effort` columns, the per-task
value overrides the per-phase default. Both remain optional; absence means "use the model's own
default." New plans don't set either — they carry a routing constraint (see "Routing constraints"
above) and effort is resolved at dispatch time.

**DEPRECATED (Claude-5 doctrine) — plan-time model/effort phase defaults**: the prior guidance
here told planners to set `model` and `effort` on each `wave_plan.phases[]` entry as a phase-wide
default. Per `plan-doctrine.md` rule 3, planners SHOULD NOT set model, provider, or profile at
plan time — they declare the routing constraint and capability bar for the phase/milestone, and
`delegation-router` resolves provider + model at dispatch time against the live registry. Effort
may still be set as a capability-bar hint, but treat it as advisory, not a pin.

**DEPRECATED (Claude-5 doctrine) — provider / profile cascade**: the previous inheritance cascade
(global default → `wave_plan.phases[].provider`/`.profile` → per-task `Provider`/`Profile`
columns) was a plan-time pinning mechanism. Legacy plans may still carry these fields and they
still parse/execute; new plans omit them. For the current assignment procedure and cost policy,
see the global `delegation-router` skill (`~/.claude/skills/delegation-router/SPEC.md`).
