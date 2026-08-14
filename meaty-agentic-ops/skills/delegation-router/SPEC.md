---
schema_version: 2
doc_type: skill_spec
skill_name: delegation-router
skill_version: 1.2.0
aligned_app_version: 0.54.0
status: stable
created: 2026-06-09
updated: 2026-07-26
owner: nick
source_docs:
  - docs/project_plans/design-specs/model-registry-router-globalization-v1.md
  - .claude/specs/provider-routing-spec.md
  - "~/.claude/config/model-registry.yaml"
  - meaty-agentic-ops/skills/delegation-router/use-case-rankings.yaml
  - meaty-agentic-ops/skills/model-playbook/
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
- Failure-fallback chain emission for executor re-dispatch (**availability failures only** — see §5a:
  a permission denial is never a traversal trigger).
- Append-only audit logging and `skillmeat routing audit` queries.
- Versioned external task-class vocabulary and fail-closed feedback-key validation.

**Out of scope**:
- Executing the delegation — owned by the platform skills (`ica-delegate`, `codex`, `gemini-cli`, `bob-shell-delegate`).
- Authoring or editing model metadata — that lives in `model-registry.yaml` (see `references/model-registry.md`).
- Changing the MUST-stay boundaries — invariant (design §2 non-goals).
- True 429 / quota accounting — runtime error/timeout is the pragmatic fallback trigger (design §2 non-goals).

### RoutingRecord schema (14 fields)

The canonical output. Source of truth: `routing-record.js`. Every field is required on every emit.

| # | Field | Type | Meaning |
|---|-------|------|---------|
| 1 | `chosen_plugin_id` | string | Selected provider id (`claude`\|`ica`\|`bob`\|`gemini`\|`codex`) |
| 2 | `model` | string | Model to use (e.g. `haiku`, `sonnet`, `opus`, `gpt-5.6-terra`) |
| 3 | `effort` | string | Effort level (`none`\|`low`\|`standard`\|`high`\|`extended`\|`xhigh`\|`adaptive`) |
| 4 | `agent_type_id` | string | agentType filename to instantiate (P2-INT-001 seam) |
| 5 | `invocation_template` | string | Provider-specific shell invocation template (from registry/plugins) |
| 6 | `scope_flags` | string[] | Extra CLI scope flags (e.g. `['--sandbox read-only']`) |
| 7 | `stage` | string | Two-stage structuring indicator: `A` \| `B` \| `none` |
| 8 | `validation_contract` | string | Structuring contract: `none` \| schema string |
| 9 | `continuity_mode` | string | `stateless` \| `resumable` |
| 10 | `fallback_chain` | FallbackEntry[] | Ordered `{plugin_id, model}` candidates; walker stops at first available |
| 11 | `reason` | string | Human-readable ranking rationale |
| 12 | `context_ref` | string \| null | Optional absolute delegation-context bundle path; forced null for protected/provider-excluded legs |
| 13 | `context_class` | `C1`\|`C2`\|`C3`\|`C4` \| null | Optional declared context class of the milestone this leg serves. **Audit passthrough only** — stamped after selection, never a resolver input, never gated on MUST-stay (it carries no context). Joins realized burn to declared class. |
| 14 | `routing_feedback` | object \| null | Provenance for an **empirical adjustment actually applied** to this decision, else null. Carries the action (`rank_displacement: [{entry, from, to, combined_signal, evidence}]`) and the reason (`combined_signal` + the §2.2 evidence block). Demotion-only and bounded to 1 position — validation rejects a promotion or a larger move. Forced null for MUST-stay classes at the emitter. Replaces the **retired** `score_delta`, which must never reappear. |

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

#### 5a. The fallback chain covers UNAVAILABILITY only — a permission denial is not a traversal trigger

The chain answers one question: *the chosen provider could not carry this leg — who is next?*
"Could not" means **availability**, and the closed list of triggers is:

| Traversal trigger (availability) | NOT a traversal trigger (authorization / correctness) |
|---|---|
| binary or auth material absent | **permission denial** — the Claude Code permission classifier, a `PreToolUse` hook, or an explicit user/harness refusal of the executor's shelled invocation |
| runtime failure / non-zero exit / no usable output | Mode-D boundary hit (→ `needs_opus`, `reason: mode_d`) |
| timeout against the allotted budget | schema/validation failure (→ hard `validation_failed`) |
| rate-limit / throttle / 429-equivalent | missing write authority (→ `needs_write_authority`) |

**A denial is a decision about whether this content may take this path; unavailability is a fact
about the path.** They are not interchangeable, and conflating them turns the fallback chain into an
escape hatch from a control the leg is subject to. Concretely, executors MUST:

- return `{status: "blocked", reason: "permission_denied", fallback_applied: false}` with the denied
  invocation and the verbatim denial message as evidence, and stop;
- **never** re-attempt the same content on another lane — next chain entry, in-process with native
  tools, or a reworded/trimmed prompt. The denial attaches to the content and its destination, so
  every such lane is the same denied act in different clothes;
- **never** probe to isolate which part of the content tripped the classifier;
- **never** emit `fallback_applied: true` for a denial. Doing so makes an authorization event
  indistinguishable from an infrastructure one in the audit log, which is the one place a reviewer
  would have caught it.

Rerouting after a denial is the **orchestrator's** decision — it holds context the constrained leg
does not, including whether the denial is correct. Escalating a denial upward is never a failure to
complete the work; executing around one is.

Observed 2026-08-13 (COMMS-SWEEP-B, bg job `cac51b90`): an `ica-executor` leg denied while shelling
to `~/ica-claude.sh` ran 6 diagnostic probes to isolate the block, then re-executed the identical
extraction in-process and reported it as walking `fallback_chain` entry 3 (`{claude}`) with
`fallback_applied: true`. The harness flagged the hand-back as an auto-mode bypass. The protected
interest was not ultimately violated, but the reroute decision was taken by the wrong party.
Enforced (as prose) in all four executor agent definitions; tracked as
`node_01KZY8BAFRFNF836ZD0Y51V1Z3`.

**Writing the outcome this section mandates.** For its first year this clause named a record the
writer could not produce — `audit-log.js` had only `appendEntry` (decision) and `appendRealization`
(realization), and a denial has neither a realized provider nor a realized model. Since 2026-08-14
the writer is `appendBlocked({task_id, blocked_reason, denial_evidence})` /
`log-cli.js --blocked`, emitting `kind: 'blocked'`; the reader is `findBlockedEntries()` /
`skillmeat routing audit --blocked`, and a blocked task is excluded from `--unconfirmed` so
denied-and-never-ran is finally distinguishable from still-pending. The four reasons in the right-hand
column above ARE the `BLOCKED_REASONS` vocabulary — adding one means editing both. See §1's
"The third kind" for the full rationale; `node_01M00JTM8FVBK12GF4AYQ7S2JN`.

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

### External task-class feedback contract

The workflow resolver input and CCDash telemetry do not share a namespace by coincidence.
`sessions.skill_name` names an invoked artifact; it is not itself a router task class.

- `task-class-vocabulary.v1.json` is the router-owned machine-readable vocabulary
  (`aos.routing.task_class` v1.0.0). Canonical external identifiers use exact
  `lower_snake_case`.
- `routing-feedback-contract.v1.json` pins accepted producer mapping versions and digests and
  records the router/producer guardrail ownership split.
- `task-class-vocabulary.js::validateFeedbackJoin()` rejects unknown classes, legacy aliases,
  `_unclassified`, protected classes, contract/taxonomy/mapping mismatches, and absent/unlisted/
  mismatched `source_skill_name → task_class` pairs before any empirical adjustment can be
  considered.
- A valid pinned join still returns `accepted:false` while the router contract's
  `live_consumption` state is disabled. This is an executable default-off gate, not documentation.
- Existing `resolve()` compatibility behavior is unchanged. Its ability to return a record for an
  unknown workflow class is not evidence that an external feedback key joined.
- The merge + actuation implementation now EXISTS (see the next section). `live_consumption`
  nevertheless remains disabled: implementing the consumer was never the whole gate.

### Empirical routing feedback — merge + actuation (DI-1)

Implemented in `routing-feedback.js`. Authoritative design: CCDash
`docs/project_plans/design-specs/routing-feedback-router-merge-handoff.md` §2.2 (merge math) and
§2.4 ADR Option (C) (landing surface, ratified 2026-08-03). Read §2.4 **with** §2.2/§2.3 — it
amends both.

**The scalar is evidence; the action is discrete.** `combined_signal` is computed verbatim per §2.2
step 2 — `penalty_for_failure*0.5 + penalty_for_cost*0.3 + penalty_for_regression*0.2`, with
`regression_half_weight 0.5`, the D9c clamp `max(cost_index - 1.0, 0.0)` (cheapness earns no
bonus), and `confidence_threshold 0.7`. It is then used ONLY as a trigger. There is no continuous
score in the resolver for a delta to apply to (§2.4.2, independently source-verified), so:

| Retired (§2.4.7) | Replacement |
|---|---|
| `max_adjustment_cap = -0.15` as a magnitude | `θ = 0.15` demotion **threshold** |
| `max(-combined_signal, cap)` clamp | `combined_signal >= θ` compared directly |
| `score_delta` RoutingRecord field | `routing_feedback.rank_displacement` |
| the `-0.150` cap-bound worked example | `combined_signal 0.750 >= θ` → demote 1 position |

A test asserts none of the retired names can reappear in executable code.

- **Channel** — a dedicated machine-owned state file, `~/.claude/state/routing-feedback-overrides.json`
  (override with `AOS_ROUTING_FEEDBACK_STATE`; tests inject `input._feedbackStatePath`). **Never**
  `routing.local.toml`: that is the human channel, and two writers on one field cannot express
  "human wins".
- **Precedence is structural** — `MUST-stay (absolute) > routing.local.toml (human) >
  routing-feedback state (machine) > registry defaults`. A `task_class` appearing in
  `routing_policy_overrides`, or an instance appearing in `priority_overrides`, is skipped by
  machine feedback entirely.
- **Actuation point** — a pure `(chain, feedbackForClass) → chain'` reorder applied to the
  `routing_policy` chain **before** the position-based walk, so the three-stage selection structure
  is unchanged. **Demotion-only, at most one position, never a removal** (the reorder is a
  permutation, so the never-empty / last-candidate floor holds by construction; a single-entry
  chain is a hard no-op).
- **Chainless classes** — the same one-position demotion is applied to the already-ranked candidate
  list, **not** by mutating `priority`. `priority` is a *within-model* rank that must never be
  compared across models (`b0ab62d`), so a cross-model demotion cannot be written into it
  without corrupting that invariant. `priority_overrides` is never emitted: it is a proven no-op for
  all 10 chain-routed eligible classes and it lives in the human channel.
- **Null metrics contribute 0 and the weights are NOT re-normalized.** As of 2026-08-03
  `success_rate` is null until CCDash DI-4e ships and `regression_rate` is *permanently* null (no
  signal exists — `test_results`/`test_runs` are 0 rows, no retry linkage), so a merge running today
  is **cost-only**: one live term carrying weight 0.3. Re-normalizing would promote it to full
  strength and make a cost-only merge far more aggressive than the ratified design. A row whose
  every metric is null is **skipped**, never read as healthy — absence of evidence must not lift a
  demotion.
- **Guardrails** (§2.4.6, each tested) — hysteresis (`θ = 0.15` demote, `θ_restore = 0.08` restore,
  hold in between); TTL of one window, refreshed on re-confirmation; MUST-stay immunity enforced at
  the record emitter; instant disable via `AOS_ROUTING_FEEDBACK=0|false|no|off`; minimum-sample
  defense carried by the producer's `eligible_for_adjustment` and re-checked here.
- **Provenance** — `RoutingRecord.routing_feedback` (14th field, additive/optional) carries the
  action (`rank_displacement`) *and* the reason (`combined_signal` + the §2.2 evidence block), so
  `skillmeat routing audit --violations` can answer "what changed and on what basis" from the record
  alone. Validation rejects a promotion, a >1-position move, an empty block, and a displacement with
  no signal.
- **Still gated.** `live_consumption` stays disabled in the committed contract, so the resolver read
  path is a no-op and selection is byte-identical to pre-DI-1 behavior. `mergeFeedback()` runs as an
  inspectable **dry run** in the meantime. Flipping the gate requires CCDash **DI-4f**
  (routing-key skill attribution — 61% of eligible keys have a NULL `skill_name`) **and** **DI-4e**
  (populate `success_rate`), **or** a written decision accepting a cost-only merge that states why a
  dead 0.5-weighted failure term is acceptable.

### Single-entry classes are feedback-immune by construction

`implementation`, `orchestration`, `mode_d`, and `video_generation` currently each have a one-entry
`routing_policy` chain, so empirical feedback can never actuate on any of them. `mode_d` and
`orchestration` immunity is correct: both are `must_stay_primary`. `video_generation` is immune only
incidentally — it has exactly one provider (`sora/sora-2`), so there is nothing to demote to; it
needs no decision until a second video provider is registered.

For `implementation`, the ordering was **fix the MAPPING first, then consider a chain peer** — and
the mapping fix has now LANDED (mapping `1.2.0`, see below). Its signal comes entirely from skill
`dev-execution`, a dual-role skill loaded by the orchestrator (`/dev:execute-phase`,
`/dev:execute-plan`) and by the implementer legs it dispatches.

Live CCDash session data shows parenting subagents is Opus-exclusive: Opus 4.8 (1,804
`dev-execution` sessions) parents 127, Opus 5 (159) parents 37, and Fable 5 parents 14; Sonnet 5
(820) and Haiku (141) parent zero, while 569 of Sonnet's 820 sessions are themselves subagent
children. By dollar, 164 orchestrator-role Opus `dev-execution` sessions (8.4%) account for 62.4%
of all Opus `dev-execution` cost (average $178/session versus $9–13 for the other roles).

Therefore the `cost_index` that would demote Opus off `implementation` is majority MUST-stay
ORCHESTRATION spend mis-attributed into a demotable class. The mapping is keyed on `skill_name`
alone and structurally cannot see the role distinction. The last-candidate floor has been masking a
mapping defect; adding a peer first would convert that latent defect into a live mis-demotion.

The mapping is owned by
`agentic_meta_dev/docs/agentic-operator/contracts/routing-feedback-task-map.v1.json` and mirrored
into CCDash (`backend/application/services/agent_queries/routing_task_map_v1.json`) and this
contract's `accepted_producers.ccdash` pin, all digest-pinned in lockstep. **Landed (mapping
`1.1.0` → `1.2.0`, digest `sha256:4d62b43a…`):** the `dev-execution` rule now carries a `roles`
object (`orchestrator → orchestration`, `implementer → implementation`) governed by a top-level
`role_discriminator` keyed on `sessions.subagent_parent_id` (orchestrator iff the session parents
≥1 subagent — the Opus-exclusive predicate above). The CCDash producer resolves the role per row;
orchestrator-role rows resolve to `orchestration`, which is `PROTECTED_TASK_CLASSES` and therefore
dropped from the rollup, so only implementer-role rows feed `implementation`. The consumer join is
unchanged: `source_task_class_rules['dev-execution']` stays `implementation` (the only class the
producer can emit for that skill into feedback), so no join-shape change was needed here.

**Ordering (recorded per AC3):** the mapping fix landed BEFORE any chain peer was added to
`implementation`. A chain peer may now be considered; until this landed, adding one would have
converted the latent mapping defect into a live mis-demotion of the spine model.

`mergeFeedback()` optionally accepts `chains` and `must_stay` to label its decision report and
override classes with the same immunity classification. As of node `…0J`, `feedback-cli.js` now
derives that topology from the registry and passes both, so the production state file is
immunity-annotated. This is a labelling surface, not a suppression surface: inert demotions remain
recorded and are explicitly marked inert for consumers that receive the topology.

---

## Audit entry schema v2 (`.claude/logs/routing-decisions.jsonl`)

Two entry kinds, joined on `task_id`. The log stays append-only: a realization never mutates the
decision it settles.

| Field | Kind | Meaning |
|---|---|---|
| `schema_version` | both | `2`. **Absent ⇒ a v1 entry**, which normalizes to an unconfirmed decision |
| `kind` | both | `decision` (resolve time) \| `realization` (post-execution) |
| `chosen_plugin_id` | decision | INTENT: provider the resolver selected. Derivable from `routing_record` |
| `intended_model` | decision | INTENT: model the resolver selected. Derivable from `routing_record.model` |
| `actual_provider_used` | realization | Provider that ran. **`null` = unconfirmed**, never a copy of the intent |
| `realized_model` | realization | Model that ran. `null` = unconfirmed |
| `realization_confirmed` | both | True only when `realization_evidence` accompanies a realized value |
| `realization_evidence` | realization | What measured it (session id, meter row, transcript path) |
| `realization_confirmed_claimed` | both | Present when a caller claimed confirmation with no evidence |
| `model_substituted` | both | `intended !== realized`; **`null` when unknowable** (either side missing) |
| `fallback_applied` | both | Auto-true only when a *measured* provider differs from the intent |

### Why the separation is structural rather than conventional

v1 required `actual_provider_used`, and the documented Pattern B call satisfied that requirement
with `record.chosen_plugin_id`. A required field with no way to express "not yet known" does not get
left blank — it gets filled with the nearest value to hand, which here was the very thing it was
supposed to audit. Measured across the two live logs in this estate on 2026-08-11: **112 of 123
entries (91%) had `actual === chosen`, and 0 of 123 carried any model field.**

The model omission is the load-bearing half. In an **in-process** dispatch the provider is fixed by
the session's `ANTHROPIC_BASE_URL`, so routing to that provider is a no-op and the model is the only
dimension the record actually decides — and the agent definition's `model:` pin silently overrides it
unless the dispatcher passes `model: record.model`. A record naming `claude-sonnet-5[1m]` therefore
ran on `claude-haiku-4-5`, and the log showed a clean entry naming a model that never executed.

Readers: `findUnconfirmedEntries()` (decisions never settled by a confirmed realization — this is
what `skillmeat routing audit --unconfirmed` surfaces), `findBlockedEntries()` (legs that were never
allowed to run — `--blocked`), and `findModelSubstitutions()` (confirmed realizations whose model
differs from the intent). All treat v1 entries as unconfirmed.

**The third kind: `blocked`.** §5a mandates that a denial be recorded as a blocked /
`permission_denied` outcome rather than a provider substitution, and until 2026-08-14 the writer
could not express it: a denial has neither an `actual_provider_used` nor a `realized_model`, because
nothing ran, and `appendRealization()` correctly rejects an all-null realization. So the only
representable options were to leave the decision unconfirmed — indistinguishable from a leg that had
not reported yet — or to name a provider that never executed, which is exactly the copied-intent
corruption above. `appendBlocked({task_id, blocked_reason, denial_evidence})` writes `kind: 'blocked'`
with every realized field null **by construction** and `fallback_applied` hard-false; passing a
realized field is an error, not a silently-dropped hint. `blocked_reason` is the closed vocabulary
`BLOCKED_REASONS`, mirroring §5a's "NOT a traversal trigger" column, so the reason set and that table
must change together. Crucially, `findUnconfirmedEntries()` now **excludes** a task carrying a blocked
entry: "unconfirmed" means nobody has checked yet, whereas a denial is a settled answer that will
never be confirmed. Conflating them made a wholly-denied lane read as an idle one, which is how a
broken offload lane stayed `not_started` through two filings (`node_01M00JTM8FVBK12GF4AYQ7S2JN`).
Headless writer: `log-cli.js --blocked`.

---

## 2. Capability Coverage

| Intent | Workflow / Section | Canonical Doc |
|--------|--------------------|---------------|
| Resolve where a single delegated task should run | `SKILL.md § "Invocation Patterns" — Pattern A` | `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 4` |
| Resolve + log per-stage routing from a workflow script | `SKILL.md § "Invocation Patterns" — Pattern B` | `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 4` |
| Understand or extend model metadata; add a new model on release | `references/model-registry.md` | `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 3` |
| Read grounded evidence behind a `routing_policy` chain re-rank | `references/use-case-rankings.md` | `use-case-rankings.yaml` (co-located, rf-provenanced, human-gated) |
| Look up a model's per-route playbook via its `playbook_ref` | `model-playbook` skill, `routes/<family>.md#<model-key>` | `meaty-agentic-ops/skills/model-playbook/` |
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

7b. **An audit entry separates INTENT from REALIZATION, and PROVIDER from MODEL.** A realized
   provider/model is never defaulted from the intent, and `realization_confirmed` is true only
   when the writer supplied `realization_evidence` — an executing leg's self-report does not
   qualify. See § "Audit entry schema v2" below.
   _Source_: `node_01KZS5A4S1YEZBPVBRFXWM3RY4` (measured 2026-08-11)

8. **Workflow integration obeys the four hard constraints.** No FS/shell in the workflow
   script's own logic, Mode-D is a workflow boundary (never an internal step), reviewers are
   edit-less, and no `Date.now`/`Math.random` in the script. The resolver call sits inside this contract.
   _Source_: `.claude/specs/workflows/workflow-authoring-spec.md` (four-constraints checklist)

9. **External feedback joins fail closed.** A producer must match the pinned contract, taxonomy,
   and source-mapping identifiers, versions, digests, and exact source-to-class rule. Unknown,
   absent, alias, telemetry-only, protected, or source/class-mismatched inputs produce no empirical
   adjustment. The default-off live-consumption state is enforced in code.

10. **The router owns actuation guardrails.** Before live consumption can be enabled, the router
    must enforce: a **maximum rank displacement of 1 position, demotion-only** (promotion is
    forbidden); a **never-empty / last-candidate floor** plus MUST-stay immunity; **hysteresis and
    TTL** in place of decay (`θ = 0.15`, `θ_restore = 0.08`, TTL 1 window); a minimum-sample
    defense-in-depth gate; absolute human-override precedence via physically separate channels;
    instant feature disable; and auditable RoutingRecord provenance. CCDash remains evidence-only.
    _Amended 2026-08-03_: the original wording required a "bounded-adjustment cap and
    **effective-score floor**" over a score the resolver does not compute — an unsatisfiable
    invariant (confirmed contradiction, not a misreading). A magnitude cap is meaningless when there
    is exactly one available action, so boundedness is re-expressed as displacement limits and
    hysteresis per handoff spec §2.4.6. Implemented in `routing-feedback.js` (DI-1).

11. **Raw `skill_name` is never a live join key.** CCDash preserves it as producer provenance and
    emits `task_class` only through the accepted versioned mapping. Resolver fallback behavior must
    never be used as join validation.

---

## 4. Enhancement Backlog

- **[BL-1] Registry-aware scoring fully wired** — resolver honors `enabled`, `priority`,
  availability, and capability match from `model-registry.yaml` (not cost_tier+sampling only).
  _Status_: **DELIVERED** (v3 registry path; status corrected 2026-08-03 — it had been left at
  `planned (design W2)` after the work landed). `resolveFromRegistry` honors all four registry
  fields; see SKILL.md's "Do Not Say" entry, which already instructs readers that v3 **is**
  registry-aware.
  _Not to be confused with_: wiring the registry's advisory `scores:` block (cost · intelligence ·
  taste · speed) into ranking. That is a **distinct** future upgrade (resolver v4) and is explicitly
  out of scope for DI-1 — BL-1 never scoped a continuous score, so DI-1 was not sequenced behind it.
  See handoff spec §2.4.3.

- **[BL-2] Failure-fallback in executors** — `ica-executor` and the Bob/codex offload paths
  re-dispatch down `fallback_chain` on runtime failure/timeout, not just binary-absence.
  _Status_: planned (design W3 — edits `.claude/workflows/*.js`, manual wave loop per bootstrap exception)
  _Rationale_: Today fallback triggers only on `test -f` binary-absence.
  ⚠️ **Widening the trigger set widens the tunneling surface.** Any implementation of this item must
  keep §5a's exclusion intact — a permission denial must never be swept in as a "runtime failure",
  and the widened list must stay a list of *availability* conditions.

- **[BL-6] Mechanical denial-is-stop enforcement** — §5a is prose in four executor agent definitions
  and nothing checks it, which is exactly the shape that already failed once for Mode-D
  (`mode-d-enforcement.md`: prose in a brief cannot constrain the party being constrained).
  _Status_: not started — filed as an IntentTree finding during the §5a landing
  _Rationale_: the honest position is that a denied leg's compliance is currently unverified;
  candidate mechanisms are an output-time scan for `fallback_applied: true` co-occurring with a
  denial in the session transcript, and a `fallback_applied` provenance field the audit log can
  reject without an availability-condition witness.

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

### v1.3.0 — 2026-08-04

- **DI-1: empirical routing feedback merge + discrete demotion actuation** (`routing-feedback.js`).
  §2.2's `combined_signal` is computed verbatim (weights 0.5/0.3/0.2, regression half-weight 0.5,
  D9c cost clamp, confidence 0.7) but acts only as a **trigger**: at `combined_signal >= θ = 0.15` a
  `routing_policy` chain entry is demoted at most one position, never promoted. New pure stage before
  the position-based chain walk; three-stage structure unchanged.
- **Retired** `score_delta`, the `max_adjustment_cap = -0.15` magnitude, and the
  `max(-combined_signal, cap)` clamp — there is no continuous score in the resolver to apply a delta
  to. A test asserts they cannot reappear in executable code. `|0.15|` survives only as θ.
- **Dedicated machine-owned channel** `~/.claude/state/routing-feedback-overrides.json`, never
  `routing.local.toml`, making `MUST-stay > human > machine > registry` structural rather than
  conventional.
- **RoutingRecord 14th field** `routing_feedback` — the applied action plus its evidence; rejects a
  promotion, a >1-position move, an empty block, or a displacement with no signal.
- Amended invariant 10 to the discrete guardrail vocabulary (the "effective-score floor" it required
  was unsatisfiable), and corrected BL-1's stale `planned` status to DELIVERED.
- `live_consumption` remains **disabled**; the resolver read path is a no-op and `mergeFeedback()` is
  a dry run until CCDash DI-4f + DI-4e land or a cost-only merge is accepted in writing.
- Fixed a pre-existing red test: the pinned source-rule count was left at 17 when mapping v1.1.0
  landed 36 rules. Added `tests/test-routing-feedback.js` (65 cases).

### v1.2.0 — 2026-07-26

- Added `aos.routing.task_class` v1.0.0 as a machine-readable canonical vocabulary with explicit
  legacy aliases and protected-class status.
- Added the pinned CCDash feedback contract and fail-closed `validateFeedbackJoin()` guard,
  including exact `source_skill_name → task_class` binding and an executable default-off gate.
- Assigned bounded-adjustment cap/floor, minimum-sample defense, human-override precedence,
  protected-class immunity, disable, and routing provenance to the router.
- Preserved legacy `resolve()` behavior while prohibiting raw `skill_name` or resolver success as
  proof of an external vocabulary join.

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
