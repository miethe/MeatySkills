# delegation-router

Human orientation for the `delegation-router` skill. For agent invocation see `SKILL.md`;
for the capability contract see `SPEC.md`.

## What it is

A pure resolver engine that decides **where** a delegated unit of work should run before any
platform skill executes it. Given a `(model, provider, effort, profile, task_class)` tuple, it
ranks the available providers — Claude primary, ICA free-tier, Bob, Gemini, Codex — and emits a
single immutable `RoutingRecord` naming the chosen provider, model, agentType wrapper,
invocation template, and an ordered fallback chain. It never runs the work itself.

## `hooks/routing-log-sink.py` — the audit-log consumer, co-located on purpose

`audit-log.js` + `log-cli.js` are the **writer** for `.claude/logs/routing-decisions.jsonl`.
Nothing in a workflow calls them: `withRouting()` puts each decision into the workflow's RETURN
ENVELOPE (`routing_log`) and workflow scripts cannot do filesystem work. For a long stretch that
producer wire was deployed fleet-wide with **no consumer at all**, so the audit log stayed empty —
and an empty log reads exactly like a clean one (`node_01KZVV9R3EK13DJXS44VCQ8E9C`, reopened as
`node_01KZYDYVAD8N82NHZMTEKR7YH2`).

`hooks/routing-log-sink.py` is that consumer: a Claude Code **`Stop`** hook that reads each
completed workflow's returned `routing_log` and drives `log-cli.js --ingest`. It ships beside the
writer because it is useless without it — a repo that deploys this skill gets both halves.

- It is a **`Stop`** hook, not `PostToolUse`/`Workflow`: workflows run in the background, whose
  `PostToolUse` fires at launch (`status: async_launched`) with **no result**, so `routing_log` is
  never in that payload. That design would be inert.
- It must be **registered** in the consuming project's `.claude/settings.json` under `hooks.Stop`
  and deployed to `<repo>/.claude/hooks/` (SkillMeat artifact `hook:routing-log-sink`). Deploying
  this skill alone does not arm it.
- ⚠️ **This copy is a MIRROR.** The canonical edit point is
  `agentic_meta_dev/infra/hooks/routing-log-sink.py` (the registered SkillMeat artifact source);
  the two are held byte-identical by a test in that repo. Edit there, then re-copy here.

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
| Validate a CCDash/external task-class feedback key | `task-class-vocabulary.v1.json`, `routing-feedback-contract.v1.json`, `task-class-vocabulary.js` |
| Install this skill into a new project | `references/bootstrap.md` |
| See concrete Today→Proposed routing examples | `references/workflow-walkthrough.md` |
| Read the routing rules / cost policy (human-facing) | `.claude/specs/provider-routing-spec.md` |
| Read the design spec (north star) | `docs/project_plans/design-specs/model-registry-router-globalization-v1.md` |

## Status

Spec-backed (`SPEC.md` at v1.2.0). Provider routing is governed per-workflow by the
`provider_routing_enabled` flag (default-off). Free-tier-only classes are a candidate for
auto-on. The engine is global at `~/.claude/skills/delegation-router/`; registry DATA is
global-canonical at `~/.claude/config/model-registry.yaml`. Per-repo copies are deprecated —
the resolver falls through to the global canonical automatically (see `references/bootstrap.md`
for the migration checklist).

External routing feedback is contract-pinned but not live. Raw CCDash `skill_name` values never
feed `resolve()` directly; `validateFeedbackJoin()` must accept the exact producer, taxonomy, and
mapping versions/digests before a future consumer may consider an empirical adjustment.
