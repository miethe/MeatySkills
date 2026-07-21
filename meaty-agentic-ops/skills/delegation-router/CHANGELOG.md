# Changelog — delegation-router skill

Tracks changes to the skill's SKILL.md, SPEC.md, README.md, and references/. For SPEC.md
contract version history see `SPEC.md § 5`.

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
