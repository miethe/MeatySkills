---
schema_version: 2
doc_type: spec
title: "Provider Routing Specification — Authoritative Routing Rules"
status: active
created: 2026-06-09
updated: 2026-06-09
feature_slug: delegation-router-multimodel
version: "1.0.0"
source_of_truth: true
related_documents:
  - .claude/config/provider-plugins.toml
  - .claude/config/multi-model.toml
  - docs/project_plans/design-specs/delegation-router-multimodel.md
  - docs/project_plans/PRDs/infrastructure/delegation-router-multimodel-v1.md
---

# Provider Routing Specification

**Single authoritative home for all provider × model × effort routing rules.**

Every other document that previously contained routing prose MUST point here rather than
duplicate rules. When a rule changes, change it here only. Downstream docs are thin pointers.

---

## 1. Governance

| Concern | Owner file |
|---------|-----------|
| Routing rules, decision procedure, fallback chains, cost policy | **This file** |
| Invocation mechanics, binary paths, auth, per-model plugin entries | `.claude/config/provider-plugins.toml` |
| Effort thresholds, defaults, CI assertions, model defaults | `.claude/config/multi-model.toml` |
| Planning + wave-phase schema extension | `.claude/skills/planning/templates/implementation-plan-template.md` |
| Agent definitions and assignments | `.claude/context/key-context/agent-roster.md` |

Governance invariant: routing knowledge flows **down** from this file. Never encode routing
policy in workflow scripts, agent prompts, or cascade docs — add a rule here and point there.

---

## 2. Core Architecture — MODEL-FIRST Routing (R2 Policy)

### R2 Policy (Approved 2026-06-09)

> **Opus and Sonnet stay on-primary `claude` by default. ICA for core implementation is an
> explicit per-task opt-in, never the default.**

The model is the routing axis. The provider is the access transport.

- **Choosing a model** = deciding what class of intelligence the task needs.
- **Choosing a provider** = picking the cheapest/best-fit transport that serves that model
  within the safety boundary.
- A task without an explicit `provider:` field defaults to `provider: claude` for all Claude
  model classes (Opus, Sonnet, Haiku).

**ICA is a MIXED provider.** It serves Opus / Sonnet / Haiku / GPT / Gemini / free-tier OSS.
"ICA" is an access path to a model, not a model itself. Selecting ICA for a Sonnet task is an
explicit cost-shift decision, not a default.

**Routing record emission.** The `delegation-router` skill resolves a `(model, provider,
effort, profile, task_class)` tuple to a deterministic, JSON-serializable `RoutingRecord`:

```json
{
  "chosen_plugin_id": "codex",
  "model": "gpt-5.6-terra",
  "effort": "high",
  "agent_type_id": "codex-executor",
  "invocation_template": "codex exec --sandbox read-only \"{prompt}\"",
  "scope_flags": ["--sandbox read-only"],
  "stage": "A",
  "validation_contract": "none",
  "continuity_mode": "stateless",
  "fallback_chain": [
    {"plugin_id": "ica", "model": "sonnet"},
    {"plugin_id": "claude", "model": "opus"}
  ],
  "reason": "agentic code-review; deterministic; read-only sandbox"
}
```

---

## 3. Planning-Agent Assignment Rule — Model-First Decision Procedure

Opus and `implementation-planner` follow this procedure when authoring plans:

1. **Classify task → assign model.**
   - Image generation → `nano-banana-pro` (Gemini image).
   - Debug escalation (2+ failed local cycles) → `gpt-5.6-sol` (frontier tier; `gpt-5.6-terra` is the workhorse default for non-escalated codex work).
   - Needs current web info → `Gemini`.
   - Mechanical / boilerplate / extraction / doc-gen → `Haiku`.
   - Core implementation (most tasks) → `Sonnet`.
   - Orchestration / planning / verdict → `Opus`.

2. **Select provider given model.**
   - Claude models (Opus/Sonnet/Haiku) with no explicit opt-in → `provider: claude`.
   - Haiku explicitly marked for cost-shift → `provider: ica`, `profile: free-tier`.
   - Sonnet explicitly opted in for cost-shift (mechanical, non-core) → `provider: ica`,
     `profile: sonnet-tier`. **Core Sonnet implementation stays `provider: claude` (R2).**
   - Gemini tasks → `provider: gemini`.
   - gpt-5.6-terra → `provider: codex`.
   - Low-risk isolated drafts/scaffolding → `provider: bob`.

3. **Set profile/scope.**
   - ICA: `{free-tier | sonnet-tier | opus-tier}` or `continuity-{opt-in | disabled}` +
     `--max-turns N`.
   - Codex: `{sandbox=read-only | workspace-write | danger-full-access}`.
     - Sandbox gated by effort: `none/low` → `read-only`; `medium/high` → `workspace-write`;
       `xhigh` → `danger-full-access` (escalation only).
   - Bob: `{isolated | interactive}`. Output is NOT auto-applied — validation gate required.
   - Gemini: `{web-search=on | off}`.
   - Claude: always `null`.

4. **Validation checklist.**
   - Worktree isolation + non-`claude` provider → **WARN**: two-stage durability required.
   - Mode-D boundary (auth, secret rotation, payment, force-push, deletion, infra migrations)
     + non-`claude` provider → **REJECT**: all Mode-D stays on primary Opus.
   - Validate `effort` against `multi-model.toml` effort levels for the model.
   - Stateful/resumable session + Bob/non-primary → **WARN**: document resume behavior.

5. **Output.** Per-task: `Model | Effort | Provider | Profile | deps` columns.
   Phase header: `model: / provider: / profile:` fields.

**Default absent-field behavior.** Existing plans without `provider`/`profile` fields default
to `provider: claude` / `profile: null` — no migration required, no parse error.

---

## 4. Per-Task-Class Routing Policy Table

| Task Class | Preferred Model | Provider | Effort | Rationale | Fallback |
|-----------|----------------|----------|--------|-----------|----------|
| **Orchestration / verdict / synthesis** | Opus | claude | standard | Master plan, verdicts, Mode-D. **MUST-STAY PRIMARY.** | None — never offload |
| **Implementation (core)** | Sonnet | **claude (R2 default)** | standard–high | Core coding stays on-primary. ICA is explicit per-task opt-in only. | Opus (claude) on structuring fail |
| **Mechanical / extraction / CRUD / doc-gen** | Haiku | ica | low (free) | Boilerplate, schema transforms. Cost-shifted. | Sonnet (ica) on structuring miss |
| **Code review / AC validation** | gpt-5.6-terra | codex | none–low | Edit-less checklist + JSON schema compliance. Sandbox=read-only. | Haiku (ica) + manual verify |
| **Debug escalation** | gpt-5.6-sol | codex | xhigh | After 2 failed local cycles. Frontier SOTA agentic repair; escalated from gpt-5.6-terra. | Opus (claude) after Codex attempt |
| **Web research** | Gemini-2.5-pro | gemini | standard | Unique web-search grounding + 1M context. Read-only fan-out. | ICA (Sonnet) on 429/rate-limit |
| **Adversarial vote / skeptic** | Haiku or Sonnet | ica | free–standard | Second opinion / refutation. Losing a skeptic ≠ safety regression. | Haiku (ica) on token exhaustion |
| **Exploration / large-context read** | Gemini-2.5-flash | gemini | medium | ≈1M context + web. Read-only. | ICA (Sonnet/Gemini bridge) |
| **Drafting / scaffolding (low-risk)** | bob-local | bob | standard | Isolated bounded tasks. Output NOT auto-applied. Validation gate required. | Sonnet (ica) on Bob timeout/no-binary |
| **Image generation** | nano-banana-pro | gemini | standard | Hi-fidelity text-to-image via Gemini image model. | nano-banana-2 (Flash) on cost |
| **Doc generation / summarization** | Haiku | ica | free | Low complexity; cheap + sufficient. | Sonnet (ica) on complexity miss |
| **Deep-read structuring** | gpt-5.6-terra | codex | low | JSON schema compliance via `--json-schema`; preferred for deterministic output shape. | ICA (Haiku) + two-stage fallback |
| **Completeness critic / gap analysis** | Gemini-2.5-flash | gemini | medium | Large-context gap analysis. Read-only. | ICA (Sonnet) on rate-limit |

**Default preference precedence (highest first):**
1. MUST-stay boundaries always primary (see §5).
2. Model fits task naturally (named model class wins).
3. Cheapest provider serving the required model within the safety tier.
4. Determinism discipline: nondeterministic providers (Gemini, ICA) excluded from ranking when
   same-session resume is active and the stage role is `structural`.

---

## 5. MUST-Stay-Primary Boundary List

The following 7 classes of work MUST remain on the primary Claude subscription (Opus, claude
provider). They are non-negotiable and may not be offloaded in any phase without explicit
Opus + human sign-off.

| # | Class | Example stages | Rationale |
|---|-------|----------------|-----------|
| **1** | **Orchestration / master plan / synthesis** | explore/spike Synthesis writer + Gap-fill synthesis; execute-plan Adaptive phase-owner | Top-level reasoning loop; verdicts carry irreversible downstream consequences. |
| **2** | **Verdict sign-off (explore/spike)** | explore.js Synthesis writer; spike.js Synthesis writer | Verdicts are never self-approved. Opus + human required. Workflow forces `status: needs_opus` on return. |
| **3** | **Mode-D phases** | Auth middleware edits; secret rotation; payment flows; deletion; force-push; infra/DB migrations | Enforced by `modeBoundary()` / early-return pattern before any agents spawn. Mode D is a workflow boundary, not a dispatchable stage. |
| **4** | **High-trust / council-tier reviews** | review-council: correctness, security, concurrency, contract lenses; adversarial code-tracer; adjudicator; decision-record writer | Security/concurrency/contract correctness = trust boundary. Council adjudication is audit-critical. |
| **5** | **Schema-recovery structurers (Stage B)** | execute-contract Sprint structurer; execute-plan Fallback structurer | Stage B decides pass/fail for the whole sprint. Trust boundary; already cheap (haiku) with no routing benefit. |
| **6** | **Cross-wave worktree merges + pushes** | Post-wave squash + merge to branch; PR creation | Remains with Opus outside the workflow. Not a dispatchable stage. |
| **7** | **Subagent nesting / nested spawn points** | Any subagent-spawns-subagent via the `Agent` tool | **Claude-primary-only.** Only claude-primary may spawn nested children; nested children always run on the primary subscription. Offloaded executors (ICA/Bob/Gemini/Codex) MUST remain **flat** — depth-0 leaves under the router. A nested spawn from an offloaded leg escapes the `RoutingRecord` audit log. See `.claude/specs/subagent-nesting-spec.md` § "Claude-Primary-Only Nesting". |

Offloadable stages (P3/P4 targets only): mechanical task execution, AC validation, fix-cycle
patches, exploration legs, deep-read structuring, skeptic votes, completeness critics.
See `.claude/worknotes/delegation-router-multimodel/determinism-table.md` for the full
per-stage classification (30 stages across 5 workflows).

---

## 6. Effort Vocabulary Per Model

| Model class | Valid effort values | Default | Notes |
|------------|-------------------|---------|-------|
| **claude** (Opus/Sonnet/Haiku) | `adaptive`, `extended` | `adaptive` | `extended` = deep reasoning. Escalate only when blocked with concrete artifacts. Budget tokens deprecated on Opus 4.6. |
| **codex** (gpt-5.6 line) | `none`, `low`, `medium`, `high`, `xhigh`, `ultra` (`ultra` = Sol/Terra only) | `medium` | Graduate based on task complexity. `xhigh`/`ultra` for deep analysis / debug escalation only. |
| **gemini** (Gemini 2.5 Pro/Flash) | `none`, `low`, `medium`, `high` | `medium` | Flash defaults to `low`; Pro defaults to `medium`. |
| **bob** (bob-local) | `standard`, `quality` | `standard` | `quality` for final assets. |
| **nano-banana** | `standard`, `quality` | `standard` | `quality` for final assets; `standard` for drafts/iterations. |

Full effort thresholds and checkpoint config: `.claude/config/multi-model.toml §[models.effort_policy]`.

---

## 7. Determinism and Resume-Safety Rules

Rules for whether a stage/model is safe to replay from cache on workflow resume.

### Definitions

- **deterministic**: output is fully reproducible for a fixed prompt + model config.
- **stochastic**: output varies between identical runs (sampling temperature > 0, narrative
  generation, vote aggregation, etc.).
- **resume_safe**: safe to replay from cache on workflow resume. A stage is `resume_safe: true`
  only if it is BOTH deterministic AND idempotent. **Invariant: every stochastic stage MUST be
  `resume_safe: false`.**

### Provider determinism classification

| Provider | Classification | Notes |
|---------|---------------|-------|
| **claude** | deterministic | Native session; structured outputs via API. |
| **codex** | deterministic | `--json-schema` enforces schema compliance; content deterministic within sandbox. |
| **bob** | deterministic | Local model; stateless; reproducible for fixed prompt. |
| **gemini** | stochastic | Sampling temperature > 0; content varies between runs. |
| **ica** | stochastic | Gateway sampling; reflects upstream model stochasticity. |

### Resume-safety routing rule

When `resume_active=true` AND the stage role is `structural` (output drives downstream branch
logic), the router MUST exclude nondeterministic providers (`gemini`, `ica`) from ranking and
fall back to a deterministic provider (`claude`, `codex`, `bob`).

Workflow-internal transient stages (skeptic votes, exploration legs) are non-structural; they
may use nondeterministic providers even during a resume.

### Per-stage table reference

Full 30-stage classification: `.claude/worknotes/delegation-router-multimodel/determinism-table.md`.
That table is authoritative for `sampling` and `resume_safe` values; this section states the
policy rules that flow from those values.

---

## 8. Cost Policy

### R2 cost policy (Approved 2026-06-09)

> "ICA is cost-shifted — prefer it for Haiku/mechanical and any **explicitly opted-in** Sonnet
> task; core Opus/Sonnet stay on-primary `claude` by default; Codex is expensive but
> irreplaceable for its use cases; Bob/Gemini free."

### Rules

1. **No per-task dollar cap in v1.** Dollar-budget routing (`--max-budget-usd`) is
   out-of-scope for v1 (design_spec §1 Non-goals).
2. **Never `--max-budget-usd` on live/stateful work.** A past EC2 incident (discovery §6)
   caused partial execution when the budget was hit mid-operation. This flag is banned on any
   workflow stage that writes state, commits, or operates on a live system.
3. **Aggressive cost-shift defaults for Haiku/mechanical.** Haiku mechanical work defaults to
   `provider: ica`, `profile: free-tier`. No explicit opt-in needed for Haiku cost-shift.
4. **No aggressive Sonnet cost-shift default.** Sonnet core implementation stays `provider:
   claude`. Per-task ICA Sonnet opt-in is allowed when the task is clearly mechanical/CRUD and
   not part of core architecture (explicit task-table override, not a phase-level default).
5. **Codex costs are accepted for its specialty.** `gpt-5.6-terra` is irreplaceable for
   agentic coding, debug escalation, and JSON schema compliance. Cost is accepted; no
   substitution.
6. **Bob/Gemini are free; prefer them for their specialties.** Bob for low-risk isolated
   drafts. Gemini for web research and large-context exploration.

---

## 9. Fallback Chain Definitions

Fallback chains are applied by the `delegation-router` when the primary provider is unavailable,
rate-limited, or exhausted. Chains are defined in `.claude/config/provider-plugins.toml §[routing_rules]`.

| Primary | Fallback chain | Notes |
|---------|---------------|-------|
| Sonnet (any provider) | `["ica/sonnet", "claude/opus"]` | ICA Sonnet first (cost-shifted); escalate to Opus only on second fail. |
| Haiku (any provider) | `["ica/haiku", "claude/sonnet"]` | ICA Haiku first; escalate to Sonnet on second fail. |
| gpt-5.6-terra | `["claude/sonnet", "claude/opus"]` | No substitute for Codex specialty; fall back to Sonnet, then Opus, with manual review. |
| Gemini | `["ica/sonnet"]` | ICA Sonnet as web-bridge; accept reduced web-grounding. |

**Lazy availability checking (default).** The router assumes all providers available (fast
path). The agent's prompt preamble verifies its provider (`which codex`, etc.) and walks the
fallback chain autonomously on failure, recording the actual provider used in metadata.

**Opt-in upfront probe (`--precheck-availability`).** For unattended CI/deployment runs, a
preamble agent runs all `availability_check` snippets and caches results to
`.claude/cache/provider-availability.json` (session-scoped, 1h TTL).

---

## 10. Workflow-Internal Stage Defaults

Workflow-internal stages (skeptic votes, exploration legs, critics) carry no plan frontmatter.
They resolve via two patterns:

- **Pattern A — pre-wired agentType.** A custom `agentType` (e.g. `skeptic-voter`) preloads
  `delegation-router` and auto-classifies by purpose internally. Used for transient internal
  roles.
- **Pattern B — script-routed.** The script calls `Skill("delegation-router")`, passes the
  `RoutingRecord` as `args`. Used for audit-critical offloads (execute-plan fix cycle,
  review-council evidence scribe).

Purpose-keyed defaults for Pattern A:

| Internal purpose | Default model | Default provider | Profile |
|-----------------|--------------|-----------------|---------|
| `skeptic-refutation` | haiku | ica | free-tier |
| `gap-finder` | gemini-3.5-flash | gemini | — |
| `json-structure` | gpt-5.6-terra | codex | sandbox=read-only |
| `exploration-leg` | gemini-3.5-flash | gemini | — |
| `completeness-critic` | gemini-3.5-flash | gemini | — |
| `evidence-scribe` | gpt-5.6-terra | codex | sandbox=read-only |
| `performance-reviewer` | gemini-3.5-flash | gemini | — |
| `observability-reviewer` | gemini-3.5-flash | gemini | — |
| `ac-validator` | gpt-5.6-terra | codex | sandbox=read-only |

---

## 11. Routing Audit Log

Every routing decision MUST be logged to `.claude/logs/routing-decisions.jsonl` as a
`RoutingRecord` JSON object with the following fields at minimum:

```json
{
  "timestamp": "2026-06-09T10:00:00Z",
  "task_id": "P1-001",
  "requested": {"model": "sonnet", "provider": "claude", "effort": "adaptive"},
  "chosen_plugin_id": "claude",
  "model": "sonnet",
  "reason": "R2: core implementation defaults to claude primary",
  "fallback_chain": []
}
```

Query the audit log: `skillmeat routing audit --task-type <class>` (v1 in-scope per design
spec §9 OQ-9).

---

## 12. Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0.0 | 2026-06-09 | Initial creation from design_spec (approved §SIGN-OFF). Implements AC-RP1 + AC-RP2. |
