# Changelog — delegation-router skill

Tracks changes to the skill's SKILL.md, SPEC.md, README.md, and references/. For SPEC.md
contract version history see `SPEC.md § 5`.

## 2026-08-14 — audit entry `kind: 'blocked'`: the outcome SPEC 5a mandated and the writer lacked

SPEC §5a is explicit that a permission denial belongs in the audit log "as a blocked /
permission_denied outcome, not as a provider substitution" — and the writer had no way to say it.
`appendRealization({actual_provider_used: null, realized_model: null, …})` throws by design, and a
denial has neither field, because nothing ran. Measured 2026-08-14 while routing 5 legs: two
`ica-executor` legs were denied by the auto-mode classifier, both returned the correct
`{status: blocked, reason: permission_denied, fallback_applied: false}` shape, and **neither outcome
could be recorded.** Origin: `node_01M00JTM8FVBK12GF4AYQ7S2JN`; the denials themselves,
`node_01KZW2PT7PFNS4RKTYPYBMKEV1`.

The consequence was the quiet-gate class. The only representable options were to leave the decision
entry unconfirmed — byte-identical to a leg that simply had not reported yet — or to write a realized
provider, which is a lie and precisely the `actual === chosen` corruption the 2026-08-11 entry below
exists to have removed. So `routing audit --unconfirmed` silently conflated *denied, never ran* with
*still pending*, and **a lane that was 100% denied looked identical to a lane nobody had used** —
which is how a broken offload lane stayed `not_started` through two filings.

- **`appendBlocked({task_id, blocked_reason, denial_evidence, …})`** — a third kind, not a flag on a
  realization. Every realized field is null **by construction** and `fallback_applied` is hard-false
  (SPEC 5a forbids true: it would make an authorization event indistinguishable from an
  infrastructure one). `chosen_plugin_id`/`intended_model` are echoed as the **denied intent**.
  Passing `actual_provider_used`, `realized_model`, `realization_evidence`, or
  `fallback_applied: true` **throws** rather than being silently dropped — a caller reaching for those
  has misread the kind, and quietly accepting one reintroduces the copied-intent bug.
- **`BLOCKED_REASONS`** (`permission_denied`, `mode_d`, `validation_failed`, `needs_write_authority`)
  — a closed set mirroring §5a's "NOT a traversal trigger" column, so `--blocked` stays queryable.
  An availability failure is rejected with a pointer to the fallback path. Adding a reason is a SPEC
  change: the table and the list move together.
- **`findUnconfirmedEntries()` now excludes any task with a blocked entry**, and this is the point of
  the kind rather than a side effect. "Unconfirmed" means *nobody has checked yet*; a denial is a
  settled answer that will never be confirmed. New reader `findBlockedEntries(log_path, reason?)`.
- **`ingestRoutingLog()`** accepts `kind: 'blocked'`, validating in pass 1 so a malformed blocked leg
  is *skipped* rather than thrown (pass 1 must write nothing), and counts it in `counts.blocked`.
- **`log-cli.js --blocked --blocked-reason <r> --denial-evidence <t>`** — the headless writer, with
  its own flags rather than reusing `--actual`/`--evidence`, which would invite the very reflex §5a
  forbids. Also fixes the ingest total, which summed only `decision + realization`: a wholly-denied
  batch would have reported `ingested: 0`.
- **`appendRealization`'s all-null guard is UNCHANGED.** Relaxing it was the obvious move and the
  wrong one — that guard is what stops an empty realization reading as a measurement.
  `tests/test-audit-log-blocked.js` CASE 5 asserts it still throws; CASE 4 asserts the
  blocked-vs-pending discrimination. 6 cases, zero deps.

## 2026-08-11 — audit entry schema v2: intent vs realization, provider vs model

The audit log could not detect the substitution it exists to detect. Measured across both live logs
in this estate (123 entries): **112 (91%) had `actual_provider_used === chosen_plugin_id`** — the
shape the shipped Pattern B example produced — and **0 carried any model field at all**. Origin:
`node_01KZS5A4S1YEZBPVBRFXWM3RY4`; sibling `node_01KZS33HCND9T13BW7FGRQ8WAA` (the same example threw
as written).

- `audit-log.js` schema v2. Realized fields (`actual_provider_used`, `realized_model`) default to
  **null = unconfirmed** and are never derived from the intent; `intended_model` records the
  resolver's model; `model_substituted` is `null` when unknowable rather than `false`.
  `realization_confirmed` is true only when `realization_evidence` accompanies a realized value — a
  caller claiming confirmation without evidence gets `realization_confirmed_claimed` instead of
  confirmation. New `appendRealization()` (evidence required) is the only path to a confirmed
  realization, and it appends rather than mutating.
- `appendEntry` now derives `chosen_plugin_id`/`intended_model` from `routing_record` when the
  top-level params are absent — the documented call passed the record and nothing else, and threw.
- New readers `findUnconfirmedEntries()` / `findModelSubstitutions()` / `readNormalizedEntries()` /
  `normalizeEntry()`. v1 entries normalize to **unconfirmed** decisions even when they carry an
  `actual_provider_used`, because in v1 that value was a copy of the intent.
- `log-cli.js`: `--intended-model`, `--realized-model`, `--evidence`, `--realization`. **`--actual`
  no longer defaults to `--chosen`** — omitted now means unconfirmed.
- `SKILL.md` v3.4: Pattern B fixed (no intent-copying; decision and realization as two calls),
  plus the in-process doctrine — routing to a provider is a **no-op** when the session's own
  `ANTHROPIC_BASE_URL` is already that provider, so the model is the only dimension an in-process
  dispatch decides, and the dispatcher must pass `model: record.model` or the agent definition's pin
  silently wins. `SPEC.md`: invariant 7b + § "Audit entry schema v2".
- Tests: `tests/test-audit-log-realization.js`, 9 cases. CASE 1 is the shipped v1 Pattern B call
  verbatim — if it stops asserting *unconfirmed*, the log is auditing a copy of its own intent again.

## 2026-08-04 — DI-1: empirical routing feedback merge + discrete demotion actuation

CCDash proof can now change a routing decision. This is the consumer half of BP-6 — the step that
makes "proof changes behavior, not just gets looked at" true rather than aspirational. Design:
CCDash `docs/project_plans/design-specs/routing-feedback-router-merge-handoff.md` §2.2 (merge math)
+ §2.4 ADR Option (C) (landing surface, ratified 2026-08-03).

- Added `routing-feedback.js`. `combined_signal` is computed **verbatim** per §2.2 step 2 — weights
  0.5/0.3/0.2, `regression_half_weight 0.5`, D9c cost clamp `max(cost_index - 1.0, 0.0)`,
  `confidence_threshold 0.7`. Those params survive the ADR unchanged.
- **The scalar is evidence; the action is discrete.** At `combined_signal >= θ = 0.15` a
  `routing_policy` chain entry is demoted **at most one position** and may **never** be promoted.
  θ is the §2.2 *saturation* point, not its sensitivity point (0.01) — a whole rank flip is a
  full-strength action and must not fire on a marginal signal.
- **Retired outright** (§2.4.7), with a test asserting they cannot reappear in executable code:
  `score_delta`, the `max_adjustment_cap = -0.15` **magnitude**, the `max(-combined_signal, cap)`
  clamp, and the `-0.150` cap-bound worked example. There is no continuous score in the resolver for
  a delta to land on (independently source-verified) — `|0.15|` survives only as θ.
- Actuation is a pure `(chain, feedbackForClass) → chain'` reorder applied **before** the
  position-based chain walk, so the three-stage selection structure is unchanged. It is a
  permutation, so nothing is ever removed and the never-empty / last-candidate floor holds by
  construction.
- For a class with **no chain**, the same one-position demotion is applied to the already-ranked
  candidate list rather than by mutating `priority`. `priority` is a within-model rank that must
  never be compared across models (`b0ab62d`), so a cross-model demotion cannot be written into it
  without corrupting that invariant. `priority_overrides` is never emitted — it is a proven no-op for
  all 10 chain-routed eligible classes and it lives in the human channel.
- **Precedence is now structural, not conventional.** Feedback reads/writes a dedicated
  machine-owned `~/.claude/state/routing-feedback-overrides.json`, **never** `routing.local.toml`:
  `MUST-stay > human > machine > registry`. A class pinned in `routing_policy_overrides` or an
  instance pinned in `priority_overrides` is skipped entirely.
- **Null metrics contribute 0 and the weights are NOT re-normalized.** `success_rate` is null until
  CCDash DI-4e and `regression_rate` is *permanently* null (no signal exists), so a merge today is
  cost-only — one live term at weight 0.3. Re-normalizing would promote it to full strength and make
  a cost-only merge far more aggressive than ratified. A row whose every metric is null is skipped,
  never read as healthy.
- Guardrails, each tested: hysteresis (θ 0.15 demote / θ_restore 0.08 restore / hold between), TTL of
  one window refreshed on re-confirmation, MUST-stay immunity enforced at the record emitter, instant
  `AOS_ROUTING_FEEDBACK=0` kill switch, minimum-sample defense via `eligible_for_adjustment`, and
  fail-closed joins through `validateFeedbackJoin()` (raw `skill_name` never reaches `resolve()`).
- Added `routing_feedback` as the **14th RoutingRecord field** (additive/optional): the action
  (`rank_displacement`) *and* the reason (`combined_signal` + the §2.2 evidence block). Validation
  rejects a promotion, a >1-position move, an empty block, and a displacement with no signal.
- Amended SPEC invariant 10 to the discrete guardrail vocabulary — the "effective-score floor" it
  required was unsatisfiable over a score the resolver does not compute — and corrected BL-1's stale
  `planned` status to DELIVERED (§2.4.8 router-repo follow-ups, both closed).
- **`live_consumption` stays disabled.** The resolver read path is a no-op and selection is
  byte-identical to pre-DI-1 behavior; `mergeFeedback()` runs as an inspectable dry run. Flipping the
  gate needs CCDash **DI-4f** (61% of eligible keys have a NULL `skill_name`) **and** **DI-4e**
  (populate `success_rate`), or a written decision accepting a cost-only merge.
- Added `tests/test-routing-feedback.js` (65 cases). Fixed a pre-existing red test: the pinned
  source-rule count was left at 17 when mapping v1.1.0 landed 36 rules. Full suite green.

## 2026-07-30 — `context_class` audit passthrough (13th RoutingRecord field)

- Added `context_class` (`C1`|`C2`|`C3`|`C4`|`null`) as the 13th RoutingRecord field, additive and
  optional in the same posture as `context_ref`: absent is tolerated, so existing 11/12-field
  callers and stored records keep validating.
- It is a **passthrough for audit only** — stamped once in `resolve()` (after selection, so it
  cannot influence ranking by construction) and carried onto every resolution path: registry,
  TOML, MUST-stay, and determinism-filter. Its purpose is joining *realized* burn to the class a
  plan *declared*.
- Unlike `context_ref` it is **not** gated on MUST-stay classes or `CONTEXT_REF_NULL_PROVIDERS`:
  `context_ref` is a path to a context bundle and must never leak onto a protected leg, whereas
  `context_class` carries no context at all — only a size label.
- Out-of-vocabulary values are rejected by `validateRoutingRecord`; `CONTEXT_CLASSES` is exported.
- Added `tests/test-context-class.js` (10 cases: carry-through, default-null, empty-string
  normalization, invalid rejection, selection-invariance, MUST-stay survival, legacy-record
  tolerance). Existing suite unchanged and green (7/7).
- Source doctrine: `agentic_meta_dev/.claude/skills/planning/references/plan-doctrine.md` §
  "Context class"; spec `docs/project_plans/design-specs/claude5-plan-doctrine-v1.md` §4.

## 2026-07-26 — Versioned task-class vocabulary + fail-closed CCDash join

- Added `task-class-vocabulary.v1.json` as the canonical `aos.routing.task_class` v1.0.0
  vocabulary. External identifiers are exact `lower_snake_case`; legacy aliases are explicitly
  listed for workflow compatibility but are invalid feedback keys.
- Added `routing-feedback-contract.v1.json`, pinning the CCDash source-mapping version/digest and
  assigning runtime adjustment cap/floor, sample defense, human-override precedence, protected
  immunity, disable, and provenance to the router.
- Added `task-class-vocabulary.js::validateFeedbackJoin()` and focused tests. Unknown,
  `_unclassified`, alias, stale/mismatched, source/class-mismatched, and MUST-stay keys fail closed
  with no empirical adjustment. All 17 pinned CCDash source rules are exercised.
- Enforced the default-off state in code: a valid pinned join is visible as `join_valid:true` but
  remains `accepted:false` until `live_consumption` is explicitly enabled in a future reviewed
  implementation.
- Kept live empirical-prior consumption disabled and preserved existing `resolve()` behavior;
  resolver success is not treated as proof that an external key joined.

## 2026-07-24 — Opus 5 is the new spine (model-registry.yaml)

- **`claude-opus-5` added** as the current flagship Opus and the AOS SPINE / MUST-stay tier
  ($5/$25, 1M/128K, adaptive, effort defaults to `high`, new tokenizer, knowledge cutoff May 2026).
  Anthropic moved **Opus 4.8 to legacy** the same day; Opus 5 is `>2x` Opus 4.8's agentic
  performance at a lower cost per task.
- **Routing-policy repoint:** the `orchestration` and `mode_d` chains now resolve to
  `claude/claude-opus-5` (were `claude/claude-opus-4-8`). `must_stay_primary` (class names) is
  unchanged, so verdict/synthesis/council legs follow the spine to Opus 5 as well.
- **Opus 4.8 demoted but retained:** still selectable (`superseded_by: claude-opus-5`) and remains
  the **ICA `claude-opus-4-8[1m]` spine-offload fallback**. `claude-opus-5[1m]` is registered
  `scaffolded`/`enabled: false` pending a live ICA-gateway availability probe.
- **Sonnet 5 unchanged as the default implementation workhorse**, with an added `token_economy_note`:
  its new tokenizer emits ~30% more tokens than Sonnet 4.6, so for bounded/mechanical high-volume
  fan-out on metered/ICA lanes prefer `claude-sonnet-4-6[1m]`/Haiku for token economy.
- **Codex gpt-5.6 line (sol/terra/luna) unchanged** — already current; no new Codex models.
- Human SSOT: `agentic_meta_dev/docs/agentic-operator/MODEL-ROUTING.md`.

## 2026-07-21 — resolve-cli.js: headless resolve CLI for Codex/non-Claude-Code consumption

- **`resolve-cli.js` added** — a thin (~200-line, mostly comments) CLI wrapper over `resolver.js`'s
  pure `resolve()`. Lets Codex (or any harness that can shell out) obtain the same `RoutingRecord`
  Claude Code would, without re-implementing the resolver. `node resolve-cli.js --model <id>
  [--provider …] [--task-class …] [--effort …] [--profile …] [--resume-active] [--compact]` prints
  the validated RoutingRecord as JSON and exits 0; an invalid/unresolvable request exits non-zero
  with a one-line message on stderr. Pure read — no network, no model calls, no writes; the only
  I/O beyond the resolver's existing registry lookup is a single `fs.existsSync` stat (see next
  bullet).
- **Node-safety fallback (CLI-side only)** — resolver.js's Track-1 `buildRegistryInvocation`
  gpt-branch is left untouched (protected per the feature contract). Instead, `resolve-cli.js`
  post-processes the emitted record: if `invocation_template` references `~/ica-gpt.sh` (the
  laptop-only `/messages` param-strip shim) and that file isn't present on the host running the
  CLI, it rewrites the template to the raw `~/ica-claude.sh` path so the record stays directly
  runnable on hosts (e.g. the agentic node) that don't have the shim yet. Test/debug seam:
  `ICA_GPT_SHIM_PATH` env var overrides the probed path.
- **`scripts/sync-to-global.sh`** — added `resolve-cli.js` to `SKILL_FILES` so it deploys to
  `~/.claude/skills/delegation-router/` alongside the engine files.
- **`tests/test-resolve-cli.js` added** — 10 subprocess-based smoke tests (known-good request →
  valid RoutingRecord + exit 0; invalid/missing input → non-zero + readable stderr; zero
  network/model-call static check; node-safety fallback with/without the shim; `--help`).
- Feature contract: `docs/project_plans/feature_contracts/infrastructure/delegation-router-codex-consumption.md`
  (agentic_meta_dev).

## 2026-07-21 — ICA GPT retest: gpt-5.5-gus added, gpt-5.4/5.1 regressed, servability drift-detector

- **`gpt-5.5-gus` added** (`status: scaffolded`, `enabled: false`) — a NEW, genuinely-working ICA
  reasoning GPT model. Validated (both keys, cache-busted, fallback OFF): tool calls + reasoning on
  raw `/chat/completions` (`reasoning_effort` honored), `/responses` (`reasoning.effort` scales:
  low→~24 / high→~99 reasoning tokens), and Anthropic `/messages` (plain + tool_use). Left disabled
  because via `ica-claude.sh`/Claude Code it 400s — CC attaches `output_config` and the Azure backend
  rejects it (`Unknown parameter: 'output_config'`). Enable only once a client can suppress that param.
- **`gpt-5.4` + `gpt-5.1` regressed → `status: degraded`, `enabled: false`** — both non-servable on
  every tested key/endpoint (`LLM Provider NOT provided` / 404). Superseded on the gateway by 5.5-gus.
- **Unifying finding** (registry header + `ica-delegate/references/ica-models.md`): the ICA Azure-backed
  GPT deployments reject the client's reasoning-control param (`reasoning_effort` on chat, `output_config`
  on `/messages`); strip it and the working models complete, effort defaulting server-side. This
  CONFIRMS the "strip reasoning_effort → it works" hypothesis — verified on `gpt-5.6-luna-dzus`
  (CODEX key + chat + no effort). `gpt-5.6-terra-dzus` remains dead on all routes. dzus NOTEs refreshed.
- **NEW: `scripts/probe-ica-models.sh`** — a report-only servability drift-detector. Fetches live
  `/models`, runs a cache-busted (unique-nonce) real probe per model with a retry-once for transient
  blips, and diffs vs this registry ([1m]-suffix normalized) to report new / regressed-enabled /
  disabled-but-working / gone models. Never edits the registry (scoring + enable stay human). Run it
  when the gateway roster changes; `--json` for tooling, `--key-block CODEX` to probe the OpenAI-line key.
- Regenerated `model-registry.generated.json` (27 models).

## 2026-07-20 — ICA Sonnet 5 reasoning REVALIDATED working (model-registry.yaml + generated.json)

- **Supersedes the 2026-07-09 "ICA Sonnet 5 has no reasoning" caveat.** Revalidation (Claude Code
  2.1.215, raw `/ica/v1/messages`, `--fallback-model` OFF, unique nonces): CC now emits
  `thinking.type:adaptive` + `output_config.effort` to the gateway and ICA Sonnet 5 reasons
  end-to-end — adaptive thinking + effort scaling honored (effort=low → ~1,116 think tokens, max →
  6,000 capped); legacy `thinking.type:enabled` now returns HTTP 400. The CC path is proven
  (`claude --model 'claude-sonnet-5[1m]'`, fallback off → thinking block, no 400).
- **`claude-sonnet-5` entry updated**: descriptor + `reasoning_caveat` flipped to WORKING; removed
  `extended-thinking`/`deep-reasoning` from `when_not_to_use_ica` and added them to `when_to_use`;
  `when_not_to_use_ica` now flags only the one real gap — `output_config.format` (structured-JSON
  schema) is silently dropped by the gateway (effort passes, format doesn't) → use a forced
  tool-call for structured output on the ICA lane. Regenerated `model-registry.generated.json`.
- **Gemini** (`gemini-3.5-flash`, `gemini-3.1-pro-preview`) confirmed usable via ICA both endpoints
  (`/v1/messages` + `/chat/completions`) + the CC `[1m]` path; reasoning not surfaced as thinking
  blocks, grounding still native-key-only. No routing change (already advisory).

## 2026-07-08 — Sonnet 5 default + version standardization (resolver.js, routing-record.js re-vendor)

- **resolver.js**: `findClaudeSonnet` hardcoded fallback bumped `claude-sonnet-4-6` → `claude-sonnet-5`
  (defensive default only; the resolver reads the sonnet model dynamically from the global registry,
  where `claude-sonnet-5` now precedes 4.6). ICA now serves Sonnet 5 (`claude-sonnet-5[1m]`, 1M) as of
  2026-07-08 — see MODEL-ROUTING.md §2. `references/bootstrap.md` priority-override example updated to match.
- **routing-record.js + routing-record.test.js**: finalized the pending DCB v2 re-vendor — the
  `context_ref` 12th field + `finalizeRoutingRecord` emitter + `CONTEXT_REF_NULL_PROVIDERS` (already
  live-deployed in `~/.claude`, previously uncommitted here). Additive/inert (resolver wiring still
  pending); test passes. This closes the routing-record.js version drift vs the skillmeat repo copy.
- **Standardization**: backported the newer 2026-07-07 docs (SKILL.md v3.1, this CHANGELOG,
  references/model-registry.md) so MeatySkills (upstream) + `~/.claude` (live) carry one canonical
  version. skillmeat repo copy still re-vendors from here on its next clean commit.

## 2026-07-07 — scores block + ICA Gemini 3.5 Flash (SKILL.md v3.1, references/model-registry.md)

Documentation-only; no resolver, routing-record, audit-log, or test changes.

- **references/model-registry.md**:
  - Added `scores: { cost, intelligence, taste, speed }` to the top-level structure YAML snippet
    (model level) and `cost_score:` to the provider-instance inline schema.
  - Added ICA Gemini 3.5 Flash to the `shared_token_pool` row of the `cost_tier` vs `allowance`
    table (live 2026-07-07; NOT free — `shared_token_pool`, not `unlimited`).
  - Added new **"Scores block — advisory scorecard metadata"** section covering: schema with a
    worked `claude-sonnet-5` example, per-field meanings, `cost_score` per-provider override
    semantics, mirror rule ("update MODEL-ROUTING §1.5 and registry together"), and explicit caveat
    that the **v3 resolver does NOT read `scores:` yet** (advisory metadata only; reserved for a
    future resolver upgrade).
- **SKILL.md** (v3.0 → v3.1, updated 2026-07-07):
  - Expanded the ICA free/shared-pool "Do Not Say" bullet to note ICA Gemini 3.5 Flash is
    `shared_token_pool` (not free).
  - Added new "Do Not Say" bullet: do not say the resolver ranks by `scores:` — v3 ranking is
    chain/priority/availability/capability-match; `scores` is advisory metadata mirroring
    MODEL-ROUTING §1.5, not a v3 resolver input.

## 2026-06-11 — global-canonical registry cutover (resolver.js 3-tier lookup, SPEC.md v1.1.0)

- **resolver.js**: Replaced single-path registry loading with a 3-tier lookup order:
  (1) `MODEL_REGISTRY_PATH` env override, (2) project-local `<cwd>/.claude/config/model-registry.*`
  (per-project override / deprecated repo copy), (3) global canonical `~/.claude/config/model-registry.*`.
  The existing js-yaml → generated-JSON fallback applies at each tier. Added `_loadYamlWithStalenessCheck`
  helper (shared staleness warning logic). Added `os` import for `homedir()`.
- **scripts/build-model-registry.py**: Default `--in`/`--out` paths now point to
  `~/.claude/config/model-registry.{yaml,generated.json}` (global canonical). Added `--out`
  default logic: generate JSON next to whichever YAML was used as input. Changed `_generated_from`
  from a relative path to an absolute path.
- **scripts/sync-to-global.sh**: Removed registry-data copy (no longer pushes
  `model-registry.yaml`/`.generated.json` from repo to global). Added deprecation warning when
  per-repo registry files are detected. Updated messaging.
- **tests/test-registry-resolver.js**: Extended smoke suite to "3-tier lookup" suite; added
  three new tier tests: `MODEL_REGISTRY_PATH` env override, project-local fallback-to-global,
  and `_registryPath` beats env var. 25 tests total (was 22).
- **SKILL.md**: Updated "Do Not Say" + Key References table to point to global canonical path.
- **SPEC.md**: Updated source_docs frontmatter, §3 invariant 3 (global-only data), §5 BL-5
  (marked complete for engine + registry data), preamble comment.
- **README.md**: Updated model-registry path; status note now reflects shipped globalization.
- **references/model-registry.md**: Updated canonical path to `~/.claude/config/`; updated
  regen command to use default (global) path.
- **references/bootstrap.md**: Updated global vs project-local table (registry DATA is global);
  updated Path B instructions; added migration note for bootstrapped repos (ccdash, citytile_pack,
  etc.) with step-by-step `git rm` instructions.

## 2026-06-09 — restructure to spec-backed convention (SKILL.md v3.0, SPEC.md v1.0.0)

- Brought the skill into compliance with `.claude/skills/_meta/skill-authoring-guide.md` and the
  spec-backed skills convention (design `model-registry-router-globalization-v1.md § 6`, W4).
- **SKILL.md** rewritten lean: When To Use / When NOT To Use / Confidence Anchor / Routing Posture
  / Invocation Patterns (Pattern A direct decision, Pattern B resolver-call-from-workflow) /
  Output Guidance / Do Not Say / Key References. Heavy model tables and deep schema removed and
  relocated to SPEC.md and references/. Bumped to v3.0.
- **SPEC.md** (new) — authoritative contract: RoutingRecord schema (11 fields), scoring/fallback
  rules, 5 MUST-stay invariants, registry-schema reference, four-constraints alignment, 7 required
  convention sections. Published at stable v1.0.0.
- **README.md** (new) — human orientation: what the skill is, how it fits the multi-model routing
  story, quick links.
- **references/model-registry.md** (new) — how to read/extend `model-registry.yaml`; cost_tier vs
  allowance (ICA free-tier `unlimited` vs `shared_token_pool`); routing_policy chains as
  priority/free-first; add-a-new-model-on-release recipe.
- **references/bootstrap.md** (new) — self-install into a new project: global vs project-local
  split, 3-step checklist, Path A (skillmeat-assisted) / Path B (manual), `routing.local.toml`
  template, smoke test.
- **references/workflow-walkthrough.md** (new) — design §7 Today→Proposed routing examples
  (planning, execution, MUST-stay, free-model routing).
- Added this CHANGELOG.md (required by the authoring guide).
