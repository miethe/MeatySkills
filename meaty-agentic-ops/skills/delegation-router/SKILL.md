---
name: delegation-router
description: >-
  Route a (model, provider, effort, profile, task_class) tuple to an immutable RoutingRecord
  before any per-provider agentType is instantiated. Use when deciding WHERE to delegate
  (claude primary, ICA free-tier, Bob, Gemini, or Codex) based on cost, capability,
  determinism, and MUST-stay-primary boundaries. Emits a routing decision only; the chosen
  platform skill executes it.
version: "3.0"
app_version: "2026-06-09"
updated: 2026-06-09
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
| Audit writer | `appendEntry({task_id, routing_record, actual_provider_used, fallback_applied})` in `audit-log.js` |
| RoutingRecord fields | 11 (see SPEC §1) |
| MUST-stay classes | `orchestration`, `verdict`, `mode-d`, `council-review`, `schema-recovery`, `cross-wave-merge` |
| agentType map | `claude`→native, `ica`→`ica-executor`, `bob`→`bob-delegate-executor`, `gemini`→`gemini-executor`, `codex`→`codex-executor` |
| Audit CLI | `skillmeat routing audit [--task-type <class>] [--violations]` |

## Routing Posture

1. **MUST-stay override first** — any MUST-stay task_class resolves to `claude` regardless of input `provider`.
2. **Registry chain** — resolve task_class to its `routing_policy.chain`; walk top-down by priority/availability/capability.
3. **Free-first** — free-eligible classes start at an ICA free-tier instance; primary only via the chain tail.
4. **Determinism filter** — when `resume_active=true` on a structural stage, exclude nondeterministic providers.
5. **Fallback chain** — emit an ordered `fallback_chain`; executors re-dispatch down it on runtime failure/timeout.
6. **Flat legs only** — the router governs FLAT legs; nesting is **never routed cross-provider**. An offloaded executor (`ica-executor` / `codex-executor` / `gemini-executor` / `bob-delegate-executor`) MUST NOT spawn nested children via the `Agent` tool — a nested spawn from an offloaded leg escapes the `RoutingRecord` audit log. Nesting is claude-primary-only. See provider-routing-spec §5 (MUST-stay #7) and `.claude/specs/subagent-nesting-spec.md` § "Claude-Primary-Only Nesting".

## Invocation Patterns

| Pattern | When | Shape |
|---|---|---|
| **A — Direct routing decision** | An agent/operator needs to know where a single task should run | Call `resolve(...)`, read `record.chosen_plugin_id` + `record.agent_type_id`, hand off to that platform skill |
| **B — Resolver call from a workflow** | A workflow script resolves + logs per stage | `require` `resolver.js` + `audit-log.js`; `resolve(...)` then `appendEntry(...)` per stage |

### Resolver call signature

```javascript
const { resolve } = require('.claude/skills/delegation-router/resolver.js');
const { appendEntry } = require('.claude/skills/delegation-router/audit-log.js');

const record = resolve({
  model: 'haiku',          // model class (haiku|sonnet|opus|…)
  provider: 'ica',         // requested provider; MUST-stay classes override this
  effort: 'low',
  profile: 'free-tier',
  task_class: 'mechanical-tasks',
  resume_active: false,    // true on resumed structural stages → determinism filter
});

// Pattern A: hand record.chosen_plugin_id / record.agent_type_id to the platform skill.
// Pattern B (workflows): also log the decision.
appendEntry({
  task_id: 'TASK-3.2',
  routing_record: record,
  actual_provider_used: record.chosen_plugin_id,
  fallback_applied: false,
});
```

## Output Guidance

- Emit the full `RoutingRecord` (11 fields); never a partial decision. Schema lives in `routing-record.js`.
- Always log via `appendEntry` in workflow integration (Pattern B) so `skillmeat routing audit --violations` stays meaningful.
- On executor fallback, record `actual_provider_used` and `fallback_applied: true` for the realized hop.

## Do Not Say

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
| Model registry (authoritative source) | `~/.claude/config/model-registry.yaml` (global canonical) |
| Routing rules / cost policy (human) | `/Users/miethe/dev/homelab/development/skillmeat/.claude/specs/provider-routing-spec.md` |
| Design spec | `/Users/miethe/dev/homelab/development/skillmeat/docs/project_plans/design-specs/model-registry-router-globalization-v1.md` |
| Audit CLI | `skillmeat routing audit --help` |
