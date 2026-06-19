# Changelog — delegation-router skill

Tracks changes to the skill's SKILL.md, SPEC.md, README.md, and references/. For SPEC.md
contract version history see `SPEC.md § 5`.

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
