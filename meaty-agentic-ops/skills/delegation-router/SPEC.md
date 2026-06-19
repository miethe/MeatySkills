---
schema_version: 2
doc_type: skill_spec
skill_name: delegation-router
skill_version: 1.1.0
aligned_app_version: 0.54.0
status: stable
created: 2026-06-09
updated: 2026-06-09
owner: nick
source_docs:
  - docs/project_plans/design-specs/model-registry-router-globalization-v1.md
  - .claude/specs/provider-routing-spec.md
  - "~/.claude/config/model-registry.yaml"
related_skills:
  - ica-delegate
  - codex
  - gemini-cli
  - bob-shell-delegate
  - workflow-authoring
affects_commands: []
---

<!-- Convention reference: .claude/context/key-context/spec-backed-skills-convention.md -->

# delegation-router — Skill Specification

> **Reading this file**: This is the versioned capability contract for the `delegation-router`
> skill. For invocation-time routing, see `SKILL.md` in this same directory. For the model
> metadata itself, see `references/model-registry.md` and `~/.claude/config/model-registry.yaml`
> (global canonical — registry DATA lives there only).

---

## 1. Purpose & Scope

**Mission**: Resolve a `(model, provider, effort, profile, task_class)` tuple to a single
immutable `RoutingRecord` that names the provider, model, agentType wrapper, invocation
template, and ordered fallback chain to run a delegated leg — honoring cost, capability,
determinism, and the MUST-stay-primary boundaries. The skill emits a decision; the chosen
platform skill executes it.

**In scope**:
- Provider/model resolution for delegated legs (`claude`, `ica`, `bob`, `gemini`, `codex`).
- Free-first cost-shifting of free-eligible task classes to ICA free-tier.
- MUST-stay-primary enforcement (orchestration, verdict, Mode-D, council review, synthesis).
- Determinism filtering on resumed structural stages.
- Failure-fallback chain emission for executor re-dispatch.
- Append-only audit logging and `skillmeat routing audit` queries.

**Out of scope**:
- Executing the delegation — owned by the platform skills (`ica-delegate`, `codex`, `gemini-cli`, `bob-shell-delegate`).
- Authoring or editing model metadata — that lives in `model-registry.yaml` (see `references/model-registry.md`).
- Changing the MUST-stay boundaries — invariant (design §2 non-goals).
- True 429 / quota accounting — runtime error/timeout is the pragmatic fallback trigger (design §2 non-goals).

### RoutingRecord schema (11 fields)

The canonical output. Source of truth: `routing-record.js`. Every field is required on every emit.

| # | Field | Type | Meaning |
|---|-------|------|---------|
| 1 | `chosen_plugin_id` | string | Selected provider id (`claude`\|`ica`\|`bob`\|`gemini`\|`codex`) |
| 2 | `model` | string | Model to use (e.g. `haiku`, `sonnet`, `opus`, `gpt-5.3-codex`) |
| 3 | `effort` | string | Effort level (`none`\|`low`\|`standard`\|`high`\|`extended`\|`xhigh`\|`adaptive`) |
| 4 | `agent_type_id` | string | agentType filename to instantiate (P2-INT-001 seam) |
| 5 | `invocation_template` | string | Provider-specific shell invocation template (from registry/plugins) |
| 6 | `scope_flags` | string[] | Extra CLI scope flags (e.g. `['--sandbox read-only']`) |
| 7 | `stage` | string | Two-stage structuring indicator: `A` \| `B` \| `none` |
| 8 | `validation_contract` | string | Structuring contract: `none` \| schema string |
| 9 | `continuity_mode` | string | `stateless` \| `resumable` |
| 10 | `fallback_chain` | FallbackEntry[] | Ordered `{plugin_id, model}` candidates; walker stops at first available |
| 11 | `reason` | string | Human-readable ranking rationale |

`agent_type_id` MUST match an agentType definition filename exactly (P2-INT-001):
`claude`→native (sentinel `claude`), `ica`→`ica-executor`, `bob`→`bob-delegate-executor`,
`gemini`→`gemini-executor`, `codex`→`codex-executor`.

### Scoring & fallback rules

1. **MUST-stay override (first, unconditional)** — if `task_class` ∈ MUST-stay set, return
   `chosen_plugin_id='claude'`, `agent_type_id='claude'`, regardless of input `provider`.
2. **Registry chain resolution** — resolve `task_class` to its `routing_policy.chain` in
   `model-registry.yaml`; skip `enabled:false` instances and `enabled:false` classes.
3. **Chain walk** — walk the chain top-down, honoring `priority`, availability, and capability
   match (`when_to_use`). First available instance wins. The chain order IS the free-first ordering.
4. **Determinism filter** — when `resume_active=true` AND the stage is structural, exclude any
   provider in `routing_rules.nondeterministic_providers`. Prevents stochastic output from
   poisoning a resumed session's structural state.
5. **Fallback chain** — emit the remaining chain tail as `fallback_chain`. Executors re-dispatch
   down it on runtime failure/timeout (not just binary-absence), recording `actual_provider_used`
   and `fallback_applied`.

### Project-local overrides (`routing.local.toml`)

The global `model-registry.yaml` is shared across all repos. A project may layer
**selection-only** overrides on top of it WITHOUT editing the registry, via a per-repo
`routing.local.toml`.

- **Discovery** — the resolver looks for `process.cwd()/.claude/config/routing.local.toml`.
  An absent file means no overrides — behavior is byte-for-byte identical to registry-only
  routing. Tests inject an alternate path via `input._localConfigPath`. Parsing reuses the
  resolver's in-file zero-dependency TOML parser (no new dependency); a malformed file
  degrades to no-overrides (warn, never throw).
- **Application point** — overrides are applied to an in-memory clone of the loaded registry
  inside the registry resolution path (`resolveFromRegistry`), after `loadRegistry` and before
  candidate filtering/scoring. The legacy `_configPath` (provider-plugins.toml) path is
  untouched. The loaded registry object is never mutated.
- **Supported fields** (all optional):
  - `disabled_providers = ["gemini", "codex"]` — drop these providers' instances from every
    model's candidacy (and from emitted fallback chains) in this repo.
  - `disabled_models = ["claude-opus-4-7"]` — drop these registry model KEYS entirely.
  - `[priority_overrides]` — re-rank a specific `"provider/model_id"` instance, e.g.
    `"ica/claude-haiku-4-5" = 0` (lower = preferred; breaks cost/priority ties).
  - `[routing_policy_overrides.<task_class>]` — project-local `chain` (and `enabled`) merged
    OVER the global `routing_policy` for that task_class.
- **MUST-stay is ABSOLUTE and CANNOT be overridden** — a `routing_policy_overrides` entry for
  a MUST-stay class (orchestration / verdict / mode_d / council_review / synthesis, plus the
  routing-record literals schema-recovery / cross-wave-merge) is **ignored** (and warned). The
  unconditional MUST-stay short-circuit still runs on the original `task_class`, so even a
  successfully-parsed local chain cannot route a protected class off `claude`. See §3 invariant 1.

---

## 2. Capability Coverage

| Intent | Workflow / Section | Canonical Doc |
|--------|--------------------|---------------|
| Resolve where a single delegated task should run | `SKILL.md § "Invocation Patterns" — Pattern A` | `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 4` |
| Resolve + log per-stage routing from a workflow script | `SKILL.md § "Invocation Patterns" — Pattern B` | `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 4` |
| Understand or extend model metadata; add a new model on release | `references/model-registry.md` | `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 3` |
| Self-install the skill into a new project | `references/bootstrap.md` | `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 5` |
| See Today→Proposed routing for planning/execution legs | `references/workflow-walkthrough.md` | `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 7` |
| Audit routing decisions or check MUST-stay violations | `skillmeat routing audit` | `skillmeat routing audit --help` |
| Read routing rules, cost policy, and profile semantics (human) | — | `.claude/specs/provider-routing-spec.md` |

---

## 3. Invariants & Constraints

1. **Five MUST-stay-primary classes can never route off `claude`.** Orchestration / master plan
   / final synthesis, verdict sign-off (`status: needs_opus`), Mode-D phases (auth, secret
   rotation, payment, deletion, force-push, infra/DB migrations), council-tier reviews
   (`review_intensity: council`) and final-gate reviews, schema-recovery structurers. The
   resolver returns `claude` unconditionally for these. Breaking this is a MAJOR bump.
   **This is absolute and cannot be weakened by `routing.local.toml`** — a project-local
   `routing_policy_overrides` entry targeting a MUST-stay class is ignored (and warned), and
   the unconditional MUST-stay short-circuit runs on the original `task_class` regardless of
   any local override.
   _Source_: `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 2, § 7`

2. **The resolver is pure — no shell or filesystem I/O at route time.** It reads the registry
   (or a derived in-memory structure) and returns a record. Side effects (logging) are a
   separate `appendEntry` call.
   _Source_: `model-registry-router-globalization-v1.md § OQ-2`; `.claude/specs/workflows/workflow-authoring-spec.md` four-constraints

3. **`~/.claude/config/model-registry.yaml` is the single authoritative source for model metadata.**
   Registry DATA lives globally at `~/.claude/config/` — not in any repo. Per-repo copies at
   `<repo>/.claude/config/model-registry.*` are deprecated Tier-2 overrides; do not create new ones.
   `provider-plugins.toml` and `multi-model.toml` routing tables are folded in / derived; the
   ICA prose inventory is migrated in. Do not add model metadata to the skill or to SKILL.md.
   _Source_: `model-registry-router-globalization-v1.md § 3.3`

4. **Free vs not-free is encoded, never assumed.** `allowance: unlimited` (Haiku 4.5, Gemma 4,
   Llama 4 Maverick, Granite 4) are genuinely free / cost-shifted. `allowance: shared_token_pool`
   (ICA Sonnet/Opus) are token-limited and NOT free — they stay opt-in cost-shifts.
   _Source_: `model-registry-router-globalization-v1.md § 3.2`

5. **`agent_type_id` MUST match an agentType definition filename exactly** (P2-INT-001 seam).
   A mismatch makes the record un-instantiable.
   _Source_: `routing-record.js` header; `SKILL.md § "Confidence Anchor"`

6. **Determinism filter applies on resumed structural stages.** When `resume_active=true`,
   nondeterministic providers are excluded from candidate ranking for structural stages.
   _Source_: `model-registry-router-globalization-v1.md § 4`; `provider-plugins.toml [routing_rules]`

7. **Every resolution and every fallback hop is appended to the audit log.**
   `.claude/logs/routing-decisions.jsonl` is append-only; `skillmeat routing audit --violations`
   must report zero MUST-stay breaches at the feature-end gate.
   _Source_: `model-registry-router-globalization-v1.md § 4`

8. **Workflow integration obeys the four hard constraints.** No FS/shell in the workflow
   script's own logic, Mode-D is a workflow boundary (never an internal step), reviewers are
   edit-less, and no `Date.now`/`Math.random` in the script. The resolver call sits inside this contract.
   _Source_: `.claude/specs/workflows/workflow-authoring-spec.md` (four-constraints checklist)

---

## 4. Enhancement Backlog

- **[BL-1] Registry-aware scoring fully wired** — resolver honors `enabled`, `priority`,
  availability, and capability match from `model-registry.yaml` (not cost_tier+sampling only).
  _Status_: planned (design W2)
  _Rationale_: v1/v2 resolver scored on `cost_tier + sampling`; the registry data is inert until W2 lands.

- **[BL-2] Failure-fallback in executors** — `ica-executor` and the Bob/codex offload paths
  re-dispatch down `fallback_chain` on runtime failure/timeout, not just binary-absence.
  _Status_: planned (design W3 — edits `.claude/workflows/*.js`, manual wave loop per bootstrap exception)
  _Rationale_: Today fallback triggers only on `test -f` binary-absence.

- **[BL-3] True 429 / quota accounting** — distinguish rate-limit from generic failure for ICA shared pool.
  _Status_: deferred
  _Rationale_: ICA does not cleanly surface rate-limit state (design §2 non-goal). Treat any error/timeout as fall-back for now.

- **[BL-4] Auto-on for free-tier-only classes** — exploration / mechanical / documentation /
  second_opinion default-on (zero primary-budget risk, automatic fallback).
  _Status_: candidate (design §8, OQ-3; confirm at W2 review)
  _Rationale_: Everything else stays behind `provider_routing_enabled` until observed.

- **[BL-5] Globalize engine to user scope** — promote engine + registry to
  `~/.claude/skills/delegation-router/`; project-local `routing.local.toml` carries Mode-D paths.
  _Status_: complete for engine + registry data — resolver code is at `~/.claude/skills/delegation-router/`,
  registry DATA is global-canonical at `~/.claude/config/model-registry.yaml` (3-tier lookup order:
  env override → project-local override → global canonical). Remaining: Mode-D path consumption by
  the workflow guard.
  _Rationale_: Same models everywhere; per-project coupling stays local. See `references/bootstrap.md`.

---

## 5. Changelog

### v1.1.0 — 2026-06-09

- Wired project-local `routing.local.toml` selection overrides into the registry resolver
  (`resolveFromRegistry`): discovery at `cwd/.claude/config/routing.local.toml` (override via
  `_localConfigPath`), parsed with the existing zero-dependency TOML parser; absent file =
  unchanged behavior.
- Supported override fields: `disabled_providers`, `disabled_models`, `[priority_overrides]`,
  `[routing_policy_overrides.<task_class>]`. Applied to an in-memory registry clone (no mutation);
  legacy `_configPath` path untouched; resolver stays pure (fs read only).
- Enforced MUST-stay-as-absolute: local routing_policy overrides for protected classes are
  ignored + warned. Documented the override contract in §1 and §3, updated the `bootstrap.md`
  template, and added `tests/test-local-overrides.js` (12 cases incl. the MUST-stay guard and
  the override-independent MUST-stay model-lookup regression).

### v1.0.0 — 2026-06-09

- Initial SPEC.md authored at stable status as part of the skill restructure (design W4).
- Captured RoutingRecord schema (11 fields), scoring/fallback rules, 5 MUST-stay invariants,
  registry-schema reference, and four-constraints alignment.
- Capability Coverage maps the two invocation patterns + three references to canonical design-spec sections.
- Enhancement Backlog BL-1..BL-5 track the registry-aware scoring, executor fallback, quota
  accounting, free-tier auto-on, and globalization work from the design spec waves.

---

## 6. Integration Points

| Agent / Command | Invocation Pattern | Notes |
|-----------------|--------------------|-------|
| `execute-plan` workflow | Pattern B — `resolve` + `appendEntry` per wave/stage | Opus builds the graph; the workflow resolves provider per task |
| `explore` / `spike` workflows | Pattern B | Exploration/research legs cost-shift to ICA free-tier; synthesis/verdict stays primary |
| `execute-contract` workflow | Pattern B | Sprint legs resolve provider; Mode-D stays a boundary |
| `lead-architect` / Opus orchestration | Pattern A | Resolves where a single delegated leg should run before handing to a platform skill |
| `skillmeat-cli` skill | route reference | `routing audit` intent routes here from the skillmeat-cli route table |
| `workflow-authoring` skill | contract reference | Load when authoring/modifying a workflow that calls the resolver |

**Co-loaded with**: the chosen platform skill (`ica-delegate`, `codex`, `gemini-cli`,
`bob-shell-delegate`) which executes the emitted decision.

**Config gate**: provider routing is governed per-workflow by `provider_routing_enabled`
(default-off; free-tier classes are a candidate for auto-on per BL-4).

---

## 7. Success Signals

- Every emitted record has all 11 fields and an `agent_type_id` that matches a real agentType file.
- MUST-stay task classes always resolve to `claude` — `skillmeat routing audit --violations` exits 0 at the feature-end gate.
- Free-eligible legs (exploration, mechanical, documentation, second-opinion) resolve to an ICA
  free-tier instance in the happy path — primary tokens are not burned for free-eligible work.
- ICA Sonnet/Opus never resolve as a default free route — they appear only on explicit opt-in.
- The resolver stays pure: no shell/FS calls inside `resolve(...)`; logging is a separate `appendEntry`.
- Agents read model metadata from `references/model-registry.md` / `model-registry.yaml`, not from SKILL.md.
