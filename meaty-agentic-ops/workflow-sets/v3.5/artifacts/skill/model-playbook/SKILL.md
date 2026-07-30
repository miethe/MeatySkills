---
name: model-playbook
description: >-
  Per-model-family usage playbooks — how to get the best out of a model once it has already been
  chosen (by delegation-router's RoutingRecord, a plan/PRD explicit assignment, or a
  routing_policy chain). Covers exact invocation lane/model_id, effort and context guidance,
  known gotchas, and anti-patterns for every routable model (Claude, GPT/Codex, Gemini, ICA
  gateway lanes, free open models). Companion to delegation-router: that skill decides
  WHICH/WHERE; this skill says HOW. Use immediately after a model is named, before invoking it,
  when unsure of the exact model_id/effort/lane, or when hand-assigning a model in a plan and
  needing its usage mechanics. One route file per model family, loaded progressively — an
  executor loads ONLY the route file for the model it was actually routed to.
version: "1.0"
app_version: "2026-07-28"
updated: 2026-07-28
scope: repo
---

# Model Playbook

Per-model "how to use it well" reference. `delegation-router` answers *which* model/provider to
use for a task_class; this skill answers *how* to invoke the chosen model correctly — exact
`provider/model_id`, effort ladder, context ceiling, and the gotchas that silently degrade output
(wrong context suffix, dropped structured-output param, dead ICA lane, contested benchmark, etc).

## When To Use

- Immediately after a `RoutingRecord` names a model, before the executor invokes it.
- A plan/PRD/task node hand-assigns a specific model and you need its invocation mechanics.
- Deciding between sibling tiers of one family (e.g. `gpt-5.6-terra` vs `gpt-5.6-sol`) once the
  family is already fixed.
- Sanity-checking a lane before probing/validating a new or flaky ICA model id.

## When NOT To Use

- Deciding **which** model/provider to route to for a task_class — that is `delegation-router`'s
  job; this skill never picks a model, it only documents the one already picked.
- Editing model metadata, scores, or `routing_policy` chains — that lives in
  `../delegation-router/model-registry.yaml` (the registry), not here.
- Full transport mechanics for a delegation CLI (flags, session logging, key rotation) — those
  live in the platform skill this route file points to (`ica-delegate`, `codex`, `gemini-cli`);
  this skill covers only the model-specific "how to get the best out of it" layer on top.

## The One Rule — Load Only Your Route

**Load exactly one route file: the one matching the model_id you were actually routed to.** If
the chosen provider is `ica`, also load `routes/ica-lanes.md` (lane mechanics apply regardless of
which model family is running on it). Never load all five route files — that defeats the
progressive-disclosure design and burns context on families you aren't using this turn.

## When-To-Load Table

| Model key(s) (registry `models:`) | Route file |
|---|---|
| `claude-opus-5`, `claude-fable-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6` | [`routes/anthropic-claude.md`](routes/anthropic-claude.md) |
| `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5-gus`, `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.1`, `gpt-4o` | [`routes/openai-gpt.md`](routes/openai-gpt.md) |
| `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.1-pro-preview`, `gemini-3.1-pro-preview-ica`, `gemini-3.1-flash-lite` | [`routes/google-gemini.md`](routes/google-gemini.md) |
| `gemma-4-26b`, `llama-4-maverick`, `granite-4-small`, `bob-local` | [`routes/open-models.md`](routes/open-models.md) |
| any model where the chosen `provider` is `ica` (in addition to its family route above) | [`routes/ica-lanes.md`](routes/ica-lanes.md) |

**Out of scope (no route file — consult `model-registry.yaml`'s `descriptor` directly):**
`nano-banana-2`/`nano-banana-pro` (image gen, see `nano-banana`/`nano-banana-pro` skills),
`sora-2` (video gen, see `sora` skill). Single-purpose generation models with no per-effort/lane
nuance worth a route file — the registry carries no `playbook_ref` for either.

## Composition With delegation-router and Grounded Rankings

This skill is a **consumer**, not a source, of routing decisions and evidence:

1. `delegation-router` resolves `(model, provider, effort, profile, task_class)` → a `RoutingRecord`
   naming one `chosen_plugin_id`/model_id. This skill starts **after** that resolution.
2. Where a route section makes a use-case claim (e.g. "prefer Fable 5 for taste-critical SVG"), it
   is cited as **grounded evidence** — `grounded <date>, conf <0.0-1.0>: <finding>` — sourced from
   `../delegation-router/use-case-rankings.yaml` (Thread 1 of the model-use-case-grounding spec;
   see `docs/agentic-operator/analysis/model-use-case-grounding-and-per-model-skills-spec.md` in
   `agentic_meta_dev`). Grounded findings **inform** a manual/explicit model choice — they do not
   auto-mutate `routing_policy` chains; a human accepts ranking-driven chain changes at the
   writeback gate, same posture as the registry's own "scoring is a human judgment call."
3. The 4-axis scorecard (`scores{cost,intelligence,taste,speed}`) in `model-registry.yaml` stays
   the fast model-level prior; grounded rankings are a sharper, per-use-case second layer — they
   do not replace or contradict the scorecard, they refine it for the specific use case at hand.

## Key References

| Resource | Path |
|---|---|
| Model registry (authoritative model facts: descriptor, scores, providers, when_to_use) | `../delegation-router/model-registry.yaml` |
| Use-case grounded rankings (evidence source for playbook claims, once landed) | `../delegation-router/use-case-rankings.yaml` |
| WHICH/WHERE decision engine (companion skill) | `../delegation-router/SKILL.md` |
| Task-class vocabulary | `../delegation-router/task-class-vocabulary.v1.json` |
| Grounding spec (Thread 1-3, this skill = Thread 3 option B) | `agentic_meta_dev/docs/agentic-operator/analysis/model-use-case-grounding-and-per-model-skills-spec.md` |
| Model × provider × effort policy (human-facing) | `agentic_meta_dev/docs/agentic-operator/MODEL-ROUTING.md` |
| ICA transport mechanics (flags, key rotation, session logging) | `~/.claude/skills/ica-delegate/SKILL.md` |
| Codex transport mechanics (flags, sandbox, session logging) | `~/.claude/skills/codex/SKILL.md` |
| Gemini CLI transport mechanics (flags, auth, output caps) | `~/.claude/skills/gemini-cli/SKILL.md` |

## Do Not Say

- Do not say this skill decides which model to use — it never picks; `delegation-router` picks,
  this skill documents the pick.
- Do not say grounded rankings auto-update `routing_policy` chains — they are evidence for a human
  writeback decision, not a live resolver input (resolver stays pure/no-model-call per AOS
  constraint 4).
- Do not say loading all five route files is the normal path — the design is one route per
  invocation (plus `ica-lanes.md` when the lane is ICA); loading everything defeats the
  token-budget purpose of the split.
