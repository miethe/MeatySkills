# Workflow Walkthrough (Today → Proposed)

Concrete routing examples per workflow stage. Agent-facing companion to the design spec's §7.
Design reference: `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 7`.

**Principle:** the user runs normal commands. The router silently cost-shifts free-eligible legs
and keeps judgment / orchestration / Mode-D on primary Claude. The only manual levers are forcing
a provider for a specific task, or toggling `enabled` in the registry.

---

## Planning — `/plan:explore`

| Leg | Today | Proposed routing |
|---|---|---|
| Exploration / code-read legs | primary | ICA Haiku (free, `allowance: unlimited`) |
| Web-research leg | primary | Gemini (`gemini-3.1-pro-preview`, web-search profile) |
| Skeptic / diversity votes | primary | ICA Gemma / Haiku (free) |
| **Synthesis + verdict** | primary | **primary Opus (MUST-stay)** |

The verdict boundary stays with Opus — the resolver returns `claude` for the synthesis/verdict
task class unconditionally. Only the cheap investigation legs cost-shift.

## Execution — `/dev:execute-plan`

| Leg | Today | Proposed routing |
|---|---|---|
| Orchestration / graph build / cross-wave merge | primary | **primary (MUST-stay)** |
| Mechanical extraction / scaffolding | primary | ICA Haiku (free) |
| Real implementation judgment | primary Sonnet | primary Sonnet (ICA Sonnet only on explicit opt-in — `shared_token_pool`) |
| Fix-cycle | primary | Bob (local, $0) unless Mode-D |
| AC validation / code review | primary | Codex (`gpt-5.6-terra`) |
| Council-tier review | primary | **primary (MUST-stay)** |
| **Anything touching auth / payments / migrations / deletion** | primary | **primary (Mode-D — MUST-stay)** |

Implementation *judgment* stays on primary Sonnet; only mechanical extraction and the fix-cycle
cost-shift in the happy path. ICA Sonnet is opt-in only because it bills the shared token pool.

## Primary-Claude-only (the five MUST-stay classes)

These never route off primary, regardless of registry or requested provider:

1. Orchestration / master plan / final synthesis
2. Verdicts / sign-off (`status: needs_opus`)
3. Mode-D (auth, secret rotation, payment, deletion, force-push, infra/DB migrations)
4. Council-tier reviews (`review_intensity: council`) and final-gate reviews
5. Schema-recovery structurers

The resolver returns `chosen_plugin_id: 'claude'`, `agent_type_id: 'claude'` for these
unconditionally. `skillmeat routing audit --violations` must report zero breaches at the
feature-end gate.

## Free-model routing (the explicit answer)

Haiku-class and open-model work routes to ICA **first** (free, $0 to the primary budget) and only
falls back to `claude/*` on failure or absence — so free-eligible work never burns primary tokens
in the happy path. This applies to free-tier ICA models only (`allowance: unlimited`: Haiku 4.5,
Gemma 4, Llama 4 Maverick, Granite 4). ICA Sonnet/Opus (`shared_token_pool`) remain opt-in
cost-shifts, not always-on free routes.

## How a leg gets routed (end to end)

1. The workflow calls `resolve({ model, provider, effort, profile, task_class, resume_active })`.
2. MUST-stay check runs first — if the task class is MUST-stay, the record is `claude` and we stop.
3. Otherwise the resolver resolves the task class to its `routing_policy.chain`, walks it
   top-down by priority/availability/capability, and applies the determinism filter on resumed
   structural stages.
4. The emitted `RoutingRecord` carries the chosen instance plus an ordered `fallback_chain`.
5. The executor runs the chosen provider; on runtime failure/timeout it re-dispatches down the
   fallback chain and records `actual_provider_used` + `fallback_applied`.
6. Every resolution and every fallback hop is appended to `.claude/logs/routing-decisions.jsonl`.
