---
name: delegation-router
description: >-
  Route a (model, provider, effort, profile, task_class) tuple to an immutable RoutingRecord
  before any per-provider agentType is instantiated. Use when deciding WHERE to delegate
  (claude primary, ICA free-tier, Bob, Gemini, or Codex) based on cost, capability,
  determinism, and MUST-stay-primary boundaries. Emits a routing decision only; the chosen
  platform skill executes it.
version: "3.4"
app_version: "2026-06-09"
updated: 2026-08-11
scope: repo
spec: ./SPEC.md
---

# Delegation Router

Repo-scope resolver engine that ranks providers and emits an immutable `RoutingRecord`.
This file holds invocation routing only. For the RoutingRecord schema, scoring/fallback
rules, and MUST-stay invariants see `./SPEC.md`. For registry and bootstrap details see
`./references/`.

---

## When To Use

- Deciding where to run a delegated leg before instantiating a per-provider agentType.
- A workflow stage needs a provider/model resolution honoring cost, capability, and determinism.
- Building or auditing the provider for a task-class (exploration, mechanical, second-opinion, etc.).
- Cost-shifting free-eligible work (Haiku-class / open models) to ICA free-tier.

## When NOT To Use

- The task is one of the five MUST-stay-primary classes (orchestration, verdict, Mode-D,
  council-tier review, final synthesis) — those route to `claude` unconditionally; no decision needed.
- Executing the delegation itself — that is the chosen platform skill's job (`ica-delegate`,
  `codex`, `gemini-cli`, `bob-shell-delegate`). This skill only emits the decision.
- Editing model metadata — that lives in the registry, not here (see `./references/model-registry.md`).

## Confidence Anchor

Repo-verified surfaces only:

| Surface | Value |
|---|---|
| Resolver entry | `resolve({model, provider, effort, profile, task_class[, resume_active]})` in `resolver.js` |
| Audit writer (decision) | `appendEntry({task_id, routing_record[, intended_model, fallback_applied]})` in `audit-log.js` — realized fields default to **null/unconfirmed**, never to the intent |
| Audit writer (realization) | `appendRealization({task_id, actual_provider_used, realized_model, realization_evidence})` in `audit-log.js` — evidence required; the only path to `realization_confirmed: true` |
| Audit entry schema | v2 (`schema_version: 2`): intent = `chosen_plugin_id` + `intended_model`; realization = `actual_provider_used` + `realized_model` + `realization_confirmed`; `model_substituted` is `null` when unknowable |
| RoutingRecord fields | 14 (see SPEC §1; `context_ref` + `context_class` + `routing_feedback` are additive) |
| MUST-stay classes | `orchestration`, `verdict`, `mode-d`, `council-review`, `schema-recovery`, `cross-wave-merge` |
| Task-class vocabulary | `task-class-vocabulary.v1.json` (`aos.routing.task_class` v1.0.0) |
| External feedback guard | `validateFeedbackJoin(...)` in `task-class-vocabulary.js` |
| agentType map | `claude`→native, `ica`→`ica-executor`, `bob`→`bob-delegate-executor`, `gemini`→`gemini-executor`, `codex`→`codex-executor` |
| Audit CLI | `skillmeat routing audit [--task-type <class>] [--violations] [--unconfirmed] [--model-substitutions]` |

## Routing Posture

1. **MUST-stay override first** — any MUST-stay task_class resolves to `claude` regardless of input `provider`.
2. **Registry chain** — resolve task_class to its `routing_policy.chain`; walk top-down by priority/availability/capability.
3. **Free-first** — free-eligible classes start at an ICA free-tier instance; primary only via the chain tail.
4. **Determinism filter** — when `resume_active=true` on a structural stage, exclude nondeterministic providers.
5. **Fallback chain** — emit an ordered `fallback_chain`; executors re-dispatch down it on runtime failure/timeout. ⚠️ **Availability failures only. A permission denial is NOT one** — a classifier/hook/user refusal of the shelled invocation is a decision about whether this content may take this path, not a fact about the path, so the executor returns `{status: 'blocked', reason: 'permission_denied', fallback_applied: false}` with evidence and stops. It never re-attempts the same content on another lane (next entry, in-process, or reworded), and never probes to isolate the block. Rerouting after a denial belongs to the orchestrator. Closed trigger list + provenance: SPEC §5a.
6. **Flat legs only** — the router governs FLAT legs; nesting is **never routed cross-provider**. An offloaded executor (`ica-executor` / `codex-executor` / `gemini-executor` / `bob-delegate-executor`) MUST NOT spawn nested children via the `Agent` tool — a nested spawn from an offloaded leg escapes the `RoutingRecord` audit log. Nesting is claude-primary-only. See provider-routing-spec §5 (MUST-stay #7) and `.claude/specs/subagent-nesting-spec.md` § "Claude-Primary-Only Nesting".

## External Feedback Join

`task_class` supplied by a workflow and `sessions.skill_name` observed by CCDash are different
namespaces. Never pass raw `skill_name` values to `resolve()` or treat resolver success as proof
that a feedback key joined.

The pinned external contract is:

- canonical vocabulary: `task-class-vocabulary.v1.json`;
- accepted producer/version/digest pins: `routing-feedback-contract.v1.json`;
- fail-closed validator: `validateFeedbackJoin(...)` in `task-class-vocabulary.js`;
- source binding: every payload's `source_skill_name → task_class` pair must match the pinned
  producer rule mirrored in `routing-feedback-contract.v1.json`;
- external identifiers: exact canonical `lower_snake_case` only; legacy aliases are workflow
  compatibility spellings, not valid feedback keys;
- `_unclassified`, unknown, alias, version/digest-mismatched, and MUST-stay keys contribute no
  empirical adjustment.

The validator returns `accepted: false` while `live_consumption` is disabled, even for a valid join.

### Empirical feedback: merge + demotion (DI-1)

The merge and actuation implementation now exists — `routing-feedback.js` — but **the gate is still
closed**, so routing behaves exactly as it did before. What it does when opened:

- `combined_signal` is computed **verbatim** per handoff-spec §2.2 (weights 0.5/0.3/0.2, regression
  half-weight 0.5, D9c cost clamp, confidence 0.7) and used ONLY as a trigger.
- At `combined_signal >= θ = 0.15`, one `routing_policy` chain entry is **demoted at most one
  position**. Promotion is impossible; nothing is ever removed from a chain.
- Overrides live in a dedicated machine file, `~/.claude/state/routing-feedback-overrides.json` —
  **never** `routing.local.toml`. Precedence is structural:
  `MUST-stay > routing.local.toml (human) > feedback state (machine) > registry`.
- Kill switch: `AOS_ROUTING_FEEDBACK=0` (or `false`/`no`/`off`) disables consumption instantly.
- An applied adjustment is recorded on `RoutingRecord.routing_feedback` with both the action and its
  evidence.

**Do not say** the router "downweights a model's score by up to 15%" — there is no score. `score_delta`
and the `-0.15` magnitude are retired; `|0.15|` is a demotion *threshold*. And do not say feedback is
live: a merge today would be **cost-only** (`success_rate` null until CCDash DI-4e, `regression_rate`
permanently null), and the flip additionally waits on DI-4f. See SPEC.md § "Empirical routing feedback".

## Invocation Patterns

| Pattern | When | Shape |
|---|---|---|
| **A — Direct routing decision** | An agent/operator needs to know where a single task should run | Call `resolve(...)`, read `record.chosen_plugin_id` + `record.agent_type_id`, hand off to that platform skill |
| **B — Resolver call from a workflow** | A workflow script resolves + logs per stage | `require` `resolver.js` + `audit-log.js`; `resolve(...)` then `appendEntry(...)` per stage |

### Resolver call signature

```javascript
const { resolve } = require('.claude/skills/delegation-router/resolver.js');
const { appendEntry, appendRealization } = require('.claude/skills/delegation-router/audit-log.js');

const record = resolve({
  model: 'haiku',          // model class (haiku|sonnet|opus|…)
  provider: 'ica',         // requested provider; MUST-stay classes override this
  effort: 'low',
  profile: 'free-tier',
  task_class: 'mechanical-tasks',
  resume_active: false,    // true on resumed structural stages → determinism filter
});

// Pattern A: hand record.chosen_plugin_id / record.agent_type_id to the platform skill.
// IN-PROCESS DISPATCH MUST PASS THE MODEL. The agent definition's own `model:` pin wins
// otherwise, silently, and the record's model never runs (see the no-op section below):
//   Agent({ subagent_type: record.agent_type_id, model: record.model, prompt })

// Pattern B (workflows): log the DECISION. Note what is NOT here — `actual_provider_used`.
// Nothing has executed yet, so there is nothing to report; omitted means UNCONFIRMED.
appendEntry({
  task_id: 'TASK-3.2',
  routing_record: record,     // chosen_plugin_id + intended_model derive from this
  fallback_applied: false,
});

// …after the leg runs, log what ACTUALLY ran, with what measured it. This is the only
// path that yields realization_confirmed: true.
appendRealization({
  task_id: 'TASK-3.2',
  actual_provider_used: 'ica',
  realized_model: 'claude-haiku-4-5[1m]',
  realization_evidence: 'ccdash session S-abc123; agent-def pin at ica-executor.md:5',
});
```

⚠️ **Never write `actual_provider_used: record.chosen_plugin_id`.** That was the shipped example
until 2026-08-11, and it is why the field could not audit anything: it made the realized hop a copy
of the intent, so the two could never disagree. Measured across the two live logs in this estate,
**112 of 123 entries (91%) had `actual === chosen`, and 0 of 123 carried any model at all**. The
executor's own self-report is not a substitute either — `appendRealization` requires
`realization_evidence` precisely because a leg reporting on itself is not a measurement
(`node_01KZS5A4S1YEZBPVBRFXWM3RY4`; the never-trust-a-leg's-self-report rule is
`agentic_meta_dev/.claude/rules/mode-d-enforcement.md`, whose local sibling here is
`meaty-agentic-ops/rules/delegation-modes.md`).

### Routing to a provider is a no-op when the session is already that provider

An **in-process** dispatch (the `Agent` tool, a workflow subagent) inherits the session's own
`ANTHROPIC_BASE_URL`. If the session is already on ICA, then routing a leg "to ICA" changes
nothing — its tokens were going there regardless — and if the session is on the subscription,
an in-process `ica-executor` never reaches ICA at all. Either way **the provider dimension is
decided by the launcher, not by the record.**

What the record does still decide in-process is the **model** — and that is exactly the dimension
that gets dropped, because the agent definition's `model:` pin wins over the record unless the
dispatcher passes `model: record.model` explicitly. Measured 2026-08-11: a record naming
`claude-sonnet-5[1m]` ran on `claude-haiku-4-5` (the `ica-executor` pin), and the Haiku leg shipped
three real defects on a precision-sensitive bash gate while reporting all ACs met.

So, for an in-process leg: **pass the model, and record provider and model separately.** Only a
shelled-out `invocation_template` decides the provider itself.

## Output Guidance

- Emit the full `RoutingRecord` (14 fields; the last three are additive/optional and default null);
  never a partial decision. Schema lives in `routing-record.js`.
- Always log via `appendEntry` in workflow integration (Pattern B) so `skillmeat routing audit --violations` stays meaningful.
- Log the **decision** and the **realization** as two entries. Leave the realized fields off the
  decision entry; supply them via `appendRealization` with evidence once something has actually run.
- On executor fallback, record `actual_provider_used` (+ `realized_model` when known) and
  `fallback_applied: true` for the realized hop — with the evidence that established it.
- **Never record a permission denial as a fallback hop.** `fallback_applied: true` asserts an
  *availability* condition was met; a denial is an authorization event and belongs in the audit log as
  a `blocked` / `permission_denied` outcome, not as a provider substitution (SPEC §5a).
- When dispatching an executor **in-process**, pass `model: record.model` to the `Agent` tool. The
  agent definition's `model:` pin is a fallback for when no record model is supplied, not a veto over
  the routing decision.

## Do Not Say

- Do not say a RoutingRecord's `chosen_plugin_id` determines where an **in-process** leg runs. The
  session's `ANTHROPIC_BASE_URL` does; routing to a provider the session is already on is a no-op,
  and routing to one it is not on does not reach that provider at all without a shelled-out
  `invocation_template`. In-process, the record decides the **model** and nothing else.
- Do not say a model id tells you which provider or lane something is on — and never infer a lane
  from a model-id **suffix**. `[1m]` (`claude-opus-5[1m]`, `claude-sonnet-5[1m]`,
  `gemini-3.5-flash[1m]`) is a **context-window** marker meaning 1M-token context, a Claude-Code
  client-side convention orthogonal to who serves the tokens; a native subscription session
  legitimately reports `claude-opus-5[1m]`. The lane discriminator is **`ANTHROPIC_BASE_URL`**.
  Reading your own session's `[1m]` as "already on ICA" suppresses offload that should have happened.
- Do not say an audit entry's `actual_provider_used` is evidence of where a leg ran. Unless the entry
  carries `realization_confirmed: true` **with** `realization_evidence`, it is an intent or a
  self-report. Every v1 entry (no `schema_version`) is unconfirmed by definition.
- Do not say a clean `skillmeat routing audit` means the recorded models actually ran. Check
  `--unconfirmed`; a v1-shaped log cannot detect a model substitution at all, having no model field.

- Do not say the resolver scores on `cost_tier + sampling` alone — v3 is registry-aware
  (`enabled`, priority, availability, capability match via `model-registry.yaml`). The
  cost_tier-only behavior was the v1/v2 resolver.
- Do not say model metadata lives in `provider-plugins.toml` — the authoritative source is
  `~/.claude/config/model-registry.yaml` (global-canonical; TOML routing tables are folded in / derived). See SPEC §4.
- Do not say the repo's `.claude/config/model-registry.yaml` is the authoritative copy — it is a
  deprecated Tier-2 per-project override path. The global canonical is at `~/.claude/config/`.
- Do not say there are 6 MUST-stay classes as a user-facing count — there are five MUST-stay
  *concepts* (design §7); the resolver's `MUST_STAY_PRIMARY_CLASSES` list has 6 entries because
  schema-recovery and cross-wave-merge are split out as distinct task_class strings.
- Do not say ICA Sonnet/Opus are free — they are `allowance: shared_token_pool` (opt-in
  cost-shift). Only Haiku 4.5 / Gemma 4 / Llama 4 Maverick / Granite 4 are `allowance: unlimited`.
  ICA Gemini 3.5 Flash (live 2026-07-07) is also `shared_token_pool` — **not free**.
- Do not say the resolver ranks or orders candidates by the `scores:` block — v3 ranking is
  chain / priority / availability / capability-match (all registry-driven). The `scores:` block
  (`cost · intelligence · taste · speed`, 1–10) is advisory metadata mirroring MODEL-ROUTING §1.5
  for agent decision-making; it is **not** a resolver input in v3 (reserved for a future upgrade;
  see `references/model-registry.md § Scores block`).
- Do not say CCDash `skill_name` values are router `task_class` values. The v1 mapping is explicit
  and versioned; raw or unpinned telemetry is rejected by `validateFeedbackJoin()`.
- Do not say matching mapping metadata alone is sufficient. The validator also binds the exact
  `source_skill_name` to its pinned canonical or telemetry-only target.
- Do not say empirical feedback "downweights a model's score" or applies a bounded `-0.15`
  adjustment. There is no score in the resolver; `score_delta` and the `-0.15` magnitude are
  **retired**. Feedback triggers a **one-position, demotion-only chain re-rank** at `θ = 0.15`.
- Do not say routing feedback is live. `live_consumption` is disabled in the committed contract, so
  the resolver read path is a no-op; and even when flipped, today's envelope makes it **cost-only**
  (`success_rate` null until CCDash DI-4e; `regression_rate` permanently null — no signal exists).
- Do not say feedback overrides go in `routing.local.toml`. That is the **human** channel; machine
  feedback writes only `~/.claude/state/routing-feedback-overrides.json`, and the human channel wins.

## Key References

| Resource | Path |
|---|---|
| Capability contract (RoutingRecord, scoring, invariants) | `/Users/miethe/dev/homelab/development/skillmeat/.claude/skills/delegation-router/SPEC.md` |
| How to read/extend the model registry | `/Users/miethe/dev/homelab/development/skillmeat/.claude/skills/delegation-router/references/model-registry.md` |
| Self-install into a new project | `/Users/miethe/dev/homelab/development/skillmeat/.claude/skills/delegation-router/references/bootstrap.md` |
| Today→Proposed workflow examples | `/Users/miethe/dev/homelab/development/skillmeat/.claude/skills/delegation-router/references/workflow-walkthrough.md` |
| Resolver engine | `/Users/miethe/dev/homelab/development/skillmeat/.claude/skills/delegation-router/resolver.js` |
| RoutingRecord schema | `/Users/miethe/dev/homelab/development/skillmeat/.claude/skills/delegation-router/routing-record.js` |
| Audit log writer | `/Users/miethe/dev/homelab/development/skillmeat/.claude/skills/delegation-router/audit-log.js` |
| Task-class vocabulary | `task-class-vocabulary.v1.json` |
| Feedback contract + validator | `routing-feedback-contract.v1.json`, `task-class-vocabulary.js` |
| Model registry (authoritative source) | `~/.claude/config/model-registry.yaml` (global canonical) |
| Grounded evidence layer (`use-case-rankings.yaml`) | `/Users/miethe/dev/homelab/development/MeatySkills/meaty-agentic-ops/skills/delegation-router/use-case-rankings.yaml` (co-located, rf-provenanced, human-gated; **advisory only — never read by `resolver.js`**); see `references/use-case-rankings.md` |
| Per-model playbook (`playbook_ref` targets) | `/Users/miethe/dev/homelab/development/MeatySkills/meaty-agentic-ops/skills/model-playbook/` (routes: `anthropic-claude.md`, `openai-gpt.md`, `google-gemini.md`, `ica-lanes.md`, `open-models.md`) |
| Routing rules / cost policy (human) | `/Users/miethe/dev/homelab/development/skillmeat/.claude/specs/provider-routing-spec.md` |
| Design spec | `/Users/miethe/dev/homelab/development/skillmeat/docs/project_plans/design-specs/model-registry-router-globalization-v1.md` |
| Audit CLI | `skillmeat routing audit --help` |
