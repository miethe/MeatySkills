# delegation-router

Human orientation for the `delegation-router` skill. For agent invocation see `SKILL.md`;
for the capability contract see `SPEC.md`.

## What it is

A pure resolver engine that decides **where** a delegated unit of work should run before any
platform skill executes it. Given a `(model, provider, effort, profile, task_class)` tuple, it
ranks the available providers — Claude primary, ICA free-tier, Bob, Gemini, Codex — and emits a
single immutable `RoutingRecord` naming the chosen provider, model, agentType wrapper,
invocation template, and an ordered fallback chain. It never runs the work itself.

## How it fits the multi-model routing story

SkillMeat's orchestration is multi-model: Opus reasons and orchestrates, and bounded legs are
cost-shifted to cheaper or free providers where that is safe. This skill is the **decision
boundary** in that story:

- **Free-first cost-shifting** — exploration, mechanical, documentation, and second-opinion
  work routes to ICA free-tier (`allowance: unlimited`) in the happy path, so free-eligible
  work never burns primary subscription tokens.
- **MUST-stay-primary protection** — orchestration, verdict sign-off, Mode-D changes,
  council-tier reviews, and final synthesis are structurally pinned to Claude primary. The
  resolver cannot route them anywhere else.
- **Determinism + fallback** — resumed structural stages exclude stochastic providers, and
  executors re-dispatch down the emitted fallback chain on runtime failure or timeout.

Model metadata (which models exist, on which providers, free vs shared-pool, when to use each)
lives in a single model-first registry at `~/.claude/config/model-registry.yaml` (global canonical).
The resolver honors that registry; it is not duplicated in the skill or in any per-repo copy.

## Quick links

| I want to… | Go to |
|---|---|
| Invoke the resolver from an agent or workflow | `SKILL.md` |
| Understand the RoutingRecord schema, scoring, and invariants | `SPEC.md` |
| Read or extend the model registry; add a new model on release | `references/model-registry.md` |
| Install this skill into a new project | `references/bootstrap.md` |
| See concrete Today→Proposed routing examples | `references/workflow-walkthrough.md` |
| Read the routing rules / cost policy (human-facing) | `.claude/specs/provider-routing-spec.md` |
| Read the design spec (north star) | `docs/project_plans/design-specs/model-registry-router-globalization-v1.md` |

## Status

Spec-backed (`SPEC.md` at v1.1.0). Provider routing is governed per-workflow by the
`provider_routing_enabled` flag (default-off). Free-tier-only classes are a candidate for
auto-on. The engine is global at `~/.claude/skills/delegation-router/`; registry DATA is
global-canonical at `~/.claude/config/model-registry.yaml`. Per-repo copies are deprecated —
the resolver falls through to the global canonical automatically (see `references/bootstrap.md`
for the migration checklist).
