# Plan Frontmatter Schema (`it_schema: 1`)

> The cross-app canonical contract now lives at
> `docs/agentic-operator/contracts/frontmatter-schema.md`. Changes to this schema MUST land a
> same-PR diff to that contract (OQ-4 gate).

**Canonical, machine-readable reference for IntentTree plan-frontmatter.** This doc is the source
of truth for what planning artifacts (PRDs, implementation plans, phase breakdowns, feature
contracts, progress files) should author in YAML frontmatter so the IntentTree capture pipeline can
project them onto the command-center plan-lens.

> Authority: the ratified cross-app contract referenced above
> (`docs/agentic-operator/contracts/frontmatter-schema.md`) governs field semantics; this doc is its
> IntentTree-plan projection. (A prior "authoritative origin" pointer to a PRD §5 at
> `docs/project_plans/PRDs/intenttree-frontmatter-capture-schema-v1.md` was removed — that
> PRD was never created; corrected per shipped-work-ledger FR-14.)

Consumed by:
- `.claude/skills/artifact-tracking/scripts/validate-plan-frontmatter.py` (the linter — parses the
  machine-readable block below to derive its MUST/SHOULD/MAY sets; falls back to a hardcoded mirror
  if PyYAML is unavailable).
- `.claude/skills/planning/templates/*` (templates emit the MUST/SHOULD set).
- `.claude/skills/artifact-tracking/scripts/intenttree_capture.py` (`report-thin` audit; field
  forwarding).
- `.claude/skills/planning/scripts/enrich_frontmatter.py` + `/plan:enrich-frontmatter` (the
  enrichment agent infers SHOULD fields).

## The version key

```yaml
# Add to every plan frontmatter. Plans without it_schema are captured as-is and flagged for enrichment.
it_schema: 1
```

`it_schema` is a **new key, distinct from `schema_version`** (which versions the artifact-tracking
envelope). `it_schema` versions *this* field contract. v1 = `1`. Field additions in a future pass
increment the value; old plans are flagged-for-enrichment, never rejected.

## Conventions

- **Level** — where the field lives: `plan` = feature-level plan file; `phase` = a
  `wave_plan.phases[]` entry or a progress file; `task` = a `tasks[]` entry.
- **Tier** — authoring contract:
  - `MUST` — gate-checked by the linter. **Advisory, not merge-blocking in v1** (a blocking gate is
    a v2 decision). The MUST set is intentionally thin.
  - `SHOULD` — the enrichment agent fills these when absent; templates emit empty scaffolds.
  - `MAY` — forward-compatible / optional.
- **Capture** — how the field reaches the backend:
  - `CR-1` — existing model column, wire-only (no migration).
  - `CR-2` — child row in an existing table (`Edge`, `ExternalLink`, `ValidationRun`).
  - `CR-3` — `Node.meta` JSON bag (no column in v1; promote to a column only when a consumer needs
    to query/aggregate it).
  - `→` — the backend target field/method.
- **Author** — `H` = human plan author; `A` = enrichment agent; `D` = derived/computed.

## MUST set (linter-enforced, plan level)

The linter exits non-zero when any of these "thin six" is absent from a plan's frontmatter:

| Field | Note |
|-------|------|
| `it_schema` | The version key. v1 = `1`. |
| `feature_slug` | Stable identity; capture binds on it. |
| `status` | Lifecycle state; drives derived `planning_maturity`/`origin`. |
| `tier` | Routing + complexity classification. |
| `priority` | Triage. |
| `points` / `effort_estimate` / `estimated_points` | At least one effort signal (any alias). |

`title` and `description` are MUST by schema (§5.1) but are structurally required by doc-policy and
always present in practice (some templates carry `scope` rather than `description`); they are **not**
separately linter-gated in v1 to keep the enforced set thin. `node_type` is MUST at the **task**
level (§5.5) but task-level enforcement is **advisory-only in v1** (enforcing it on every legacy
`tasks[]` entry would be noise); the linter reports task entries missing `node_type` as advisory,
never as a non-zero MUST violation.

---

## §5.1 Identity & lineage (plan level)

| Field | Type | Level | Tier | Author | Capture | Notes |
|-------|------|-------|------|--------|---------|-------|
| `it_schema` | int | plan | MUST | H | CR-1 → `Node.meta` | New. Plans without it = captured as-is + flagged for enrichment. v1 = `1`. |
| `feature_slug` | str | plan | MUST | H | CR-1 → `SourceArtifact.feature_slug` | Shipped. |
| `feature_version` | str | plan | SHOULD | H | CR-1 → `Node.meta` | Shipped. |
| `title` / `description` | str | plan | MUST | H | CR-1 → `Node.title`/`Node.description` | Shipped. |
| `doc_type` | str | plan | SHOULD | H | CR-1 → `SourceArtifact.kind` (alias) | Alias wired in capture. |
| `prd_ref` / `plan_ref` | path | plan | SHOULD | H | CR-1 → `Node.meta` | Shipped. |
| `spike_ref` / `charter_ref` | path | plan | MAY | H | CR-1 → `Node.meta` | Lineage forward-compat. |
| `meta_plan_refs` | path[] | plan | SHOULD | H | CR-1 + follow-link (DI-140) | Shipped; Phase 4 adds link-follow extraction. |
| `references` | path[] | plan | SHOULD | H | CR-1 → `Node.meta` | Shipped. |
| `related_documents` | path[] | plan | SHOULD | H | CR-3 → `meta` | Complement to `references`. |
| `owner` | str | plan | SHOULD | H | CR-1 → `Node.owner_id` (lookup) | |
| `tags` | str[] | plan | SHOULD | H | CR-1 → `Node.tags` | Shipped. |
| `adr_refs` | path[] | plan | MAY | H | CR-3 → `meta` | `SourceReference(ref_kind="adr")` convention. |
| `findings_doc_ref` | path | plan | MAY | H | CR-3 → `meta` | `SourceReference(ref_kind="findings_doc")`. |
| `test_plan_ref` | path | plan | MAY | H | CR-3 → `meta` | `SourceReference(ref_kind="test_plan")`. |
| `branch` / `repo` | str | plan/task | SHOULD | H | CR-1 → `Node.branch`/`Node.repo` | Binds git evidence at capture. |
| `intenttree_workspace` | str | plan | MAY | H/D | binding stamp (not node-captured) | Records the IntentTree **human** workspace the plan's nodes live in. Per-plan override at the top of the resolution precedence (D2). **Not written by any code today** — `itt sync import --apply` records the binding only in IntentTree's `WorkItemBinding` DB table; the `--stamp-frontmatter` writeback (see `intenttree_tree` below) stamps `intenttree_tree`/`source_artifact_id`/`itt_node_id` but **not** `intenttree_workspace`. Must be hand-authored or env-supplied (`INTENTTREE_TREE`/`ITT_NODE_ID`). See the ratified contract `docs/agentic-operator/contracts/frontmatter-schema.md` (OQ-3). See `.claude/rules/intenttree-integration.md`. |
| `intenttree_tree` | str | plan | MAY | H/D | binding stamp (opt-in writeback) | Records the tree id the plan binds to; the sdlc-sync hooks pass it as `--tree`. Defaults to the project tree (`aos-intenttree`) when absent. **Stamped by `itt sync import --apply --stamp-frontmatter`** — the opt-in flag (shipped 2026-07-21), not bare `--apply` (which stays DB-only, zero file writes). The same write stamps `source_artifact_id` and, for single-node imports only, `itt_node_id`, additive-only (never overwrites a present value; a mismatch prints a warning). Implementation: `client/src/intenttree_client/cli/frontmatter_stamp.py` + `sync_cmd.py` in the `intenttree` repo; contract `docs/project_plans/feature_contracts/itt-sync-frontmatter-stampback.md`. Without the flag, still hand-authored or env-supplied. See `.claude/rules/intenttree-integration.md`. |

## §5.2 Lifecycle & maturity (plan level)

| Field | Type | Level | Tier | Author | Capture | Notes |
|-------|------|-------|------|--------|---------|-------|
| `status` | enum | plan | MUST | H | CR-1 → `Node.status` | Shipped. DI-135: Phase 3 keeps this current during execution. |
| `planning_maturity` | enum | plan | SHOULD | H/A | CR-1 → `Node.meta`; derive from `status` | Derives deterministically if absent. |
| `maturity` | str | plan | MAY | H | alias → `planning_maturity` | Consolidated by linter. |
| `origin` | enum | plan | SHOULD | A/D | CR-1 → `Node.meta`; derive from `doc_type`/`source` | Derives as default. |
| `tier` | int | plan | MUST | H | CR-1 → `Node.meta` | Shipped. |
| `priority` | enum | plan | MUST | H | CR-1 → `Node.priority` | Shipped. |
| `milestone` | str | plan | SHOULD | H | CR-1 → `Node.meta` | Shipped. |
| `lifecycle_pinned` | bool | plan | MAY | H | CR-1 → `Node.lifecycle_pinned` | Pre-declare to block auto-sweeps. |

## §5.3 Effort & scoring (plan level)

| Field | Type | Level | Tier | Author | Capture | Notes |
|-------|------|-------|------|--------|---------|-------|
| `points` / `effort_estimate` | num/str | plan | MUST | H | CR-1 → `Node.estimate_points` | Shipped. |
| `risk_level` | enum | plan | MUST | H | CR-1 → `Node.meta` | Shipped. |
| `context_class` | enum (C1, C2, C3, C4) | plan | SHOULD | H | CR-1 → `Node.meta` | New (Claude-5 doctrine). Sizes AGENT CONTEXT, not behavior — predicts burn where points do not; MAY also be set per-milestone via `wave_plan.phases[].context_class`. See `planning/references/plan-doctrine.md`. |
| `estimate_minutes` | int | task | SHOULD | H | CR-1 → `Node.estimate_minutes` | Time scheduling; not synonymous with `points`. |
| `spent_points` | num | task | MAY | A/D | CR-1 → `Node.spent_points` | Burn-down. |
| `impact` | float (0–1) | plan/task | SHOULD | H | CR-1 → `Node.impact` | CC card; separate from `scores.strategic_value`. |
| `target_date` | date | task/phase | SHOULD | H | CR-1 → `Node.target_date` | Due-today projection. |
| `scores` | bag (11 dims) | plan/task | SHOULD | H (seed) | CR-1 → `Node.scores{}` JSON bag | Frontmatter seeds the bag; M2 engine owns runtime recompute. See bag keys below. |

`scores` bag keys (all optional floats, 0–1 unless noted):
`strategic_value`, `leverage`, `urgency`, `blocker_power`, `reuse_potential`,
`execution_readiness`, `delegation_readiness`, `confidence`, `effort`, `risk`, `distraction_risk`.
The 5 flat keys from the design-spec (`strategic_value`, `urgency`, `leverage`, `readiness`, `risk`)
map **into this bag** — never as flat top-level node fields. (`readiness` → `execution_readiness`.)

**Context class** (new, Claude-5 doctrine). Points size human-scale scope; `context_class` sizes
agent context — the actual burn predictor (C1 bounded/single-module through C4 cross-repo +
adversarially gated + novel). Full class table + assignment drivers: `planning/references/plan-doctrine.md`.

## §5.4 Structural planning — the lens centerpiece (plan level)

| Field | Type | Level | Tier | Author | Capture | Notes |
|-------|------|-------|------|--------|---------|-------|
| `open_questions` | `str[] \| {q,owner,status}[]` | plan | SHOULD | H/A | shipped (P3) | Primary enrichment target. |
| `decisions` | `{decision,rationale,status}[]` | plan | SHOULD | H/A | same-body + link-follow (DI-140) | Canonical home = `decisions:` FM list; inline GFM table and `decisions-block.md` are derived sources feeding the same list. |
| `decision_gates` | `{gate,status}[]` | plan | SHOULD | H/A | derived from `decisions` where `status=pending`, or explicit | |
| `wave_plan` | `{waves[][],phases[]}` | plan | SHOULD | H | CR-1 → `Node.meta` | Shipped; the wave DAG itself is still consumed by IntentTree and is NOT deprecated. **DEPRECATED (Claude-5 doctrine)** — `.phases[].model`/`.provider`/`.profile` and any per-task model/agent pin: plans now carry routing *constraints*, not identities; `delegation-router` resolves provider+model at dispatch time (`planning/references/plan-doctrine.md` rule 3). Legacy plans carrying these sub-fields still parse and still execute — they are simply no longer emitted by new plans. |
| `phases` | `map(id→{title,…})` | plan | SHOULD | H | CR-1 → phase container nodes | Shipped. |
| `blockers` | `str[]` | plan/task | SHOULD | H | CR-2 → `Edge(BLOCKS)` | Capture emits `Edge` rows. |
| `success_metrics` / `success_criteria` | `str[]` | plan | SHOULD | H/A | CR-3 → `Node.meta` | `success_criteria` → rename to `success_metrics` in linter. No column in v1. |
| `entry_criteria` | `str[]` | phase | SHOULD | H | CR-3 → `Node.meta` | Phase-gate primitive. |
| `exit_criteria` | `str[]` | phase | SHOULD | H | CR-3 → `Node.meta` | Phase-gate primitive. |
| `contributors` | `str[]` | plan | SHOULD | H | CR-3 → `Node.meta` | Column only if queried. |
| `changelog_required` | bool | plan | MAY | H | CR-3 → `Node.meta` | Operational. |
| `gate_lens` | `enum[]` (`security`, `validator`, `karen`, `karen-final-tree-only`) | phase | SHOULD | H/A | CR-3 → phase `Node.meta` | **New (gate-tiering v4.1).** The reviewer lens set for this milestone/phase. Lives on a `wave_plan.phases[]` entry. **Read at dispatch** by `councilEscalation` in `MeatySkills/meaty-agentic-ops/workflows/execute-plan.js` — `security` → `council-review`, `karen`/`karen-final-tree-only` → `karen`, otherwise `task-completion-validator`. Default is a **single** lens (`[validator]`); a second is added only on a named trigger. Ruleset: `dev-execution/references/gate-risk-classes.md` §2. |
| `gate_lens_reason` | enum (`untrusted-input`, `authz-boundary`, `irreversible-outward`, `ambiguity-tie`) | phase | SHOULD — **conditionally required** | H/A | CR-3 → phase `Node.meta` | **New (gate-tiering v4.1).** Which second-lens trigger justified a 2+-lens `gate_lens`. **Required whenever `gate_lens` has ≥2 entries** — a two-lens phase with no named trigger is a classification error, not a cautious default. Absent/ignored when `gate_lens` has ≤1 entry. Linter-checked (advisory in v1). |
| `gate_shared_with` | str (phase id) \| null | phase | MAY | H/A | CR-3 → phase `Node.meta` | **New (gate-tiering v4.1)** — pre-existing in live plans, registered here. Set on the *later* of two phases serialized for **file-ownership** reasons whose review is the same body of work; its gate rides the earlier phase's. Only where the shared review genuinely covers both — never to avoid a distinct lens. |

> **Gate fields were load-bearing before they were registered.** `gate_lens` / `gate_shared_with` were
> emitted by the plan-optimizer (2026-07-29) and are now *read at dispatch*, but were absent from this
> schema — so the linter could not see them and plan authors did not know they existed. That is the
> same gap `routing_constraints` fell into. Registered 2026-07-31; do not add a fourth.

## §5.5 Task-level fields

| Field | Type | Level | Tier | Author | Capture | Notes |
|-------|------|-------|------|--------|---------|-------|
| `node_type` (→ `type`) | enum | task | MUST | H | CR-1 → `Node.type` | Wrong type breaks rollup. Maps `atomic_task`/`work_package`/`side_quest`/`milestone`/etc. Task-level enforcement advisory in v1. |
| `acceptance_criteria` | `str[]` | task/plan | SHOULD | H | CR-1 → `Node.acceptance_criteria` | The most load-bearing omission for agentic self-verification. |
| `definition_of_done` | str | task/plan | SHOULD | H | CR-1 → `Node.definition_of_done` | Prose DoD, separate from AC list. |
| `checklist` | `{text,done}[]` | task | MAY | H | CR-1 → `Node.checklist` | Micro-steps inside an atomic task. |
| `intent_tags` | `str[]` | task | MAY | H | CR-1 → `Node.intent_tags` | Cross-cutting intent labels. |
| `is_critical_path` | bool | task | MAY | H/D | CR-1 → `Node.is_critical_path` | Plan may pre-declare; M2 also computes. |
| `pr_refs` | `str[]` | plan/task | SHOULD | H | CR-2 → `ExternalLink(github)` | Typed delivery evidence. |
| `commit_refs` | `str[]` | plan/task | SHOULD | H | CR-2 → `ExternalLink(github)` | Git evidence. |
| `validation_commands` | `{command,kind}[]` | task | MAY | H | CR-2 → `ValidationRun` rows | `kind` ∈ pytest/mypy/ruff/tsc/eslint/vitest/a11y/runtime_smoke/custom. |

## §5.6 Agent-facing context (plan/phase/task level)

Capture projects these onto existing node columns (migration 0026 added them).

| Field | Type | Level | Tier | Author | Capture | Notes |
|-------|------|-------|------|--------|---------|-------|
| `agent_title` | str | plan/phase/task | SHOULD | H/A | CR-1 → `Node.agent_title` | Authored in frontmatter, projected onto node. |
| `agent_summary` | str | plan/phase/task | SHOULD | H/A | CR-1 → `Node.agent_summary` | |
| `agent_context` | str (md) | plan/phase/task | SHOULD | H/A | CR-1 → `Node.agent_context` | |
| `agent_instructions` | str (md) | plan/phase/task | MAY | H/A | CR-1 → `Node.agent_instructions` | |
| `execution_mode` | enum | plan/task | SHOULD | H | CR-1 → `Node.execution_mode` | `human`/`agent`/`hybrid`/`autonomous`/`system`/`unassigned`. Distinct from `delegation_mode`. Absent → `unassigned`. |
| `delegation_mode` | enum (A–E) | plan/task | MAY | H | CR-3 → `Node.meta` | Maps to `.claude/rules/delegation-modes.md` A–E. |
| `reviewer_actor` | str | task | MAY | H | CR-2 → `Node.reviewer_actor_id` | `agent:<handle>` or `human:<handle>`. |
| `proposed_by_actor` | str | task | MAY | H | CR-2 → `Node.proposed_by_actor_id` | Attribution for proposal. |

## §5.7 Required artifacts — the provisioning manifest (plan + phase level)

The **declared** set of artifacts a plan needs — consumed by the dev-execution pre-execution
provisioning gate (`hooks/provision-artifacts.sh`) and, once shipped, by `skillmeat project
reconcile`. Complementary to (not a replacement for) the *derived* set a scanner extracts from
`.claude/` conventions: the declared set can express artifacts that **do not exist yet**
(`status: needs_creation`/`needs_enhancement`), which derivation cannot. Authoring workflow:
`references/required-artifacts-guidance.md`. Design: PRD `docs/project_plans/PRDs/dynamic-artifact-provisioning.md`.

| Field | Type | Level | Tier | Author | Capture | Notes |
|-------|------|-------|------|--------|---------|-------|
| `required_artifacts` | `{type,name,skillmeat_ref,status,lifecycle,scope,note}[]` | plan | SHOULD | H/A | CR-3 → `Node.meta` | Plan-level declared artifact set. Advisory (non-blocking) in v1. |
| `wave_plan.phases[].required_artifacts` | same shape | phase | SHOULD | H | CR-3 → phase `Node.meta` | Per-phase generalization of `owner_skills` (which stays, for Claude-Code skill preload). |

Entry shape:
- `type` — `skill | agent | command | mcp | workflow | context_module`.
- `name` — the artifact name as deployed under `.claude/{agents,skills,commands}` (or the MCP/context id).
- `skillmeat_ref` — the SkillMeat catalog name to resolve/deploy; `null` when `status != available`.
- `status` — `available` (in catalog / deployable now) · `needs_creation` (author before execution) · `needs_enhancement` (extend an existing artifact first). Non-`available` entries MUST become a `batch_0` provisioning task or a named blocker at plan authoring (planning skill "Required Artifacts Resolution" step).
- `lifecycle` — `permanent` (belongs to the project's durable set) · `ephemeral` (epic/plan-scoped; torn down on completion).
- `scope` — for `ephemeral`: `epic:<id>` | `plan:<feature_slug>` (the teardown trigger); `null` for permanent.
- `note` — free text (why it's needed / which phase).

The gate resolves `required_artifacts` against the durable per-project manifest
`.claude/aos-artifacts.yaml` and SkillMeat enterprise; see `.claude/rules/artifact-provisioning.md`.

---

## Machine-readable schema

The linter parses the first fenced `yaml` block below to build its tier/level sets. Keep this block
in lockstep with the tables above. (`tier`: `must`|`should`|`may`; `level`: `plan`|`phase`|`task` or
combos like `plan/task`; `capture`: `cr1`|`cr2`|`cr3`|`derived`.)

```yaml
it_schema: 1
must_set_plan:        # the "thin six" — linter exits non-zero on absence
  - it_schema
  - feature_slug
  - status
  - tier
  - priority
  - effort            # satisfied by `points` OR `effort_estimate` OR `estimated_points`
effort_aliases: [points, effort_estimate, estimated_points]
must_set_task:
  - node_type         # advisory-only at task level in v1
conditional_required:   # gate-tiering v4.1 — advisory in v1, same posture as must_set_plan
  # A phase carrying two or more reviewer lenses MUST name the trigger that earned the
  # second one. A two-lens phase with no named trigger is a classification error, not a
  # cautious default (dev-execution/references/gate-risk-classes.md §2).
  - field: gate_lens_reason
    level: phase
    when: {field: gate_lens, min_len: 2}
    allowed: [untrusted-input, authz-boundary, irreversible-outward, ambiguity-tie]
fields:
  # §5.1 identity & lineage
  - {name: it_schema, level: plan, tier: must, author: H, capture: cr1, type: int}
  - {name: feature_slug, level: plan, tier: must, author: H, capture: cr1, type: str}
  - {name: feature_version, level: plan, tier: should, author: H, capture: cr1, type: str}
  - {name: title, level: plan, tier: must, author: H, capture: cr1, type: str}
  - {name: description, level: plan, tier: must, author: H, capture: cr1, type: str}
  - {name: doc_type, level: plan, tier: should, author: H, capture: cr1, type: str}
  - {name: prd_ref, level: plan, tier: should, author: H, capture: cr1, type: path}
  - {name: plan_ref, level: plan, tier: should, author: H, capture: cr1, type: path}
  - {name: spike_ref, level: plan, tier: may, author: H, capture: cr1, type: path}
  - {name: charter_ref, level: plan, tier: may, author: H, capture: cr1, type: path}
  - {name: meta_plan_refs, level: plan, tier: should, author: H, capture: cr1, type: path[]}
  - {name: references, level: plan, tier: should, author: H, capture: cr1, type: path[]}
  - {name: related_documents, level: plan, tier: should, author: H, capture: cr3, type: path[]}
  - {name: owner, level: plan, tier: should, author: H, capture: cr1, type: str}
  - {name: tags, level: plan, tier: should, author: H, capture: cr1, type: str[]}
  - {name: adr_refs, level: plan, tier: may, author: H, capture: cr3, type: path[]}
  - {name: findings_doc_ref, level: plan, tier: may, author: H, capture: cr3, type: path}
  - {name: test_plan_ref, level: plan, tier: may, author: H, capture: cr3, type: path}
  - {name: branch, level: plan/task, tier: should, author: H, capture: cr1, type: str}
  - {name: repo, level: plan/task, tier: should, author: H, capture: cr1, type: str}
  - {name: intenttree_workspace, level: plan, tier: may, author: H/D, capture: cr3, type: str}
  - {name: intenttree_tree, level: plan, tier: may, author: H/D, capture: cr3, type: str}
  # §5.2 lifecycle & maturity
  - {name: status, level: plan, tier: must, author: H, capture: cr1, type: enum}
  - {name: planning_maturity, level: plan, tier: should, author: H/A, capture: cr1, type: enum}
  - {name: maturity, level: plan, tier: may, author: H, capture: alias, type: str}
  - {name: origin, level: plan, tier: should, author: A/D, capture: cr1, type: enum}
  - {name: tier, level: plan, tier: must, author: H, capture: cr1, type: int}
  - {name: priority, level: plan, tier: must, author: H, capture: cr1, type: enum}
  - {name: milestone, level: plan, tier: should, author: H, capture: cr1, type: str}
  - {name: lifecycle_pinned, level: plan, tier: may, author: H, capture: cr1, type: bool}
  # §5.3 effort & scoring
  - {name: points, level: plan, tier: must, author: H, capture: cr1, type: num}
  - {name: effort_estimate, level: plan, tier: must, author: H, capture: cr1, type: str}
  - {name: risk_level, level: plan, tier: must, author: H, capture: cr1, type: enum}
  - {name: context_class, level: plan, tier: should, author: H, capture: cr1, type: str}
  - {name: estimate_minutes, level: task, tier: should, author: H, capture: cr1, type: int}
  - {name: spent_points, level: task, tier: may, author: A/D, capture: cr1, type: num}
  - {name: impact, level: plan/task, tier: should, author: H, capture: cr1, type: float}
  - {name: target_date, level: task/phase, tier: should, author: H, capture: cr1, type: date}
  - {name: scores, level: plan/task, tier: should, author: H, capture: cr1, type: bag}
  # §5.4 structural planning
  - {name: open_questions, level: plan, tier: should, author: H/A, capture: cr1, type: list}
  - {name: decisions, level: plan, tier: should, author: H/A, capture: cr1, type: list}
  - {name: decision_gates, level: plan, tier: should, author: H/A, capture: derived, type: list}
  - {name: wave_plan, level: plan, tier: should, author: H, capture: cr1, type: map}  # .phases[].model/.provider/.profile DEPRECATED (Claude-5 doctrine) — see §5.4 notes; wave DAG itself not deprecated
  - {name: phases, level: plan, tier: should, author: H, capture: cr1, type: map}
  - {name: blockers, level: plan/task, tier: should, author: H, capture: cr2, type: str[]}
  - {name: success_metrics, level: plan, tier: should, author: H/A, capture: cr3, type: str[]}
  - {name: entry_criteria, level: phase, tier: should, author: H, capture: cr3, type: str[]}
  - {name: exit_criteria, level: phase, tier: should, author: H, capture: cr3, type: str[]}
  - {name: contributors, level: plan, tier: should, author: H, capture: cr3, type: str[]}
  - {name: changelog_required, level: plan, tier: may, author: H, capture: cr3, type: bool}
  # gate-tiering v4.1 — reviewer-lens fields on wave_plan.phases[] entries
  - {name: gate_lens, level: phase, tier: should, author: H/A, capture: cr3, type: enum[]}
  - {name: gate_lens_reason, level: phase, tier: should, author: H/A, capture: cr3, type: enum}  # REQUIRED when gate_lens has >=2 entries — see conditional_required below
  - {name: gate_shared_with, level: phase, tier: may, author: H/A, capture: cr3, type: str}
  # §5.5 task-level
  - {name: node_type, level: task, tier: must, author: H, capture: cr1, type: enum}
  - {name: acceptance_criteria, level: task/plan, tier: should, author: H, capture: cr1, type: str[]}
  - {name: definition_of_done, level: task/plan, tier: should, author: H, capture: cr1, type: str}
  - {name: checklist, level: task, tier: may, author: H, capture: cr1, type: list}
  - {name: intent_tags, level: task, tier: may, author: H, capture: cr1, type: str[]}
  - {name: is_critical_path, level: task, tier: may, author: H/D, capture: cr1, type: bool}
  - {name: pr_refs, level: plan/task, tier: should, author: H, capture: cr2, type: str[]}
  - {name: commit_refs, level: plan/task, tier: should, author: H, capture: cr2, type: str[]}
  - {name: validation_commands, level: task, tier: may, author: H, capture: cr2, type: list}
  # §5.6 agent-facing context
  - {name: agent_title, level: plan/phase/task, tier: should, author: H/A, capture: cr1, type: str}
  - {name: agent_summary, level: plan/phase/task, tier: should, author: H/A, capture: cr1, type: str}
  - {name: agent_context, level: plan/phase/task, tier: should, author: H/A, capture: cr1, type: str}
  - {name: agent_instructions, level: plan/phase/task, tier: may, author: H/A, capture: cr1, type: str}
  - {name: execution_mode, level: plan/task, tier: should, author: H, capture: cr1, type: enum}
  - {name: delegation_mode, level: plan/task, tier: may, author: H, capture: cr3, type: enum}
  - {name: reviewer_actor, level: task, tier: may, author: H, capture: cr2, type: str}
  - {name: proposed_by_actor, level: task, tier: may, author: H, capture: cr2, type: str}
  # §5.7 required artifacts (provisioning manifest)
  - {name: required_artifacts, level: plan, tier: should, author: H/A, capture: cr3, type: list}
```

---

## Linter contract (v1)

`validate-plan-frontmatter.py` is **ADVISORY — non-blocking in v1**. It:

1. Exits non-zero only on a **plan-level MUST** violation.
2. Reports SHOULD/MAY gaps as advisory lines (never affects exit code).
3. Emits per-field output with a fix hint.
4. Logs what it skips (it does not deep-validate value types in v1 — presence + a few light checks).
5. Does **not** block `git commit` or CI merge. A blocking gate is a v2 decision (PRD §13 D3).
