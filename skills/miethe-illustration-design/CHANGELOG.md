# Changelog

## 1.0 — 2026-09-21

Initial adoption into MeatySkills as a `skill` artifact, restructured from the standalone
"Miethe Illustration Design Pack" (`01_CONSTITUTION`/`02_STYLES`/`03_VISUAL_STORIES`/
`04_CONTEXT`/`05_TEMPLATES`/`06_MANIFESTS` layout) at
`/Users/miethe/dev/WIP/agents/Specs-styles/Miethe_Illustration_Design_Pack`.

- Authored `SKILL.md` as a router: a style-selection table keyed on requester language (not a
  bare list of ten names), an explicit load order, canon constraints that bind across every
  dialect, and blending/derivation rules — new content, not present in the source pack.
- Added required skill-dev frontmatter (`version`, `app_version`, `updated`), `## When NOT To
  Use`, and `## Deferred / Do Not Say` sections; none existed in the source pack.
- Moved `01_CONSTITUTION/{MIETHE_ILLUSTRATION_CONSTITUTION.md, constitution_spec.yaml}` to
  `references/constitution/`.
- Moved each `02_STYLES/NN_Name/{STYLE_GUIDE.md, style_spec.yaml}` to
  `references/styles/NN_Name/`.
- Moved `04_CONTEXT/*` to `references/canon/` (character bible, canon notes, development
  context, influences/derivations).
- Moved `05_TEMPLATES/*` to `references/templates/`.
- Moved `06_MANIFESTS/*` to `references/manifests/`, and rewrote every path inside
  `asset_index.json`, `asset_index.csv`, and `design_manifest.json` to the new
  `references/`/`assets/` layout (the source pack's own paths no longer exist post-move).
- Moved all PNG assets to `assets/`, organized as `assets/constitution/`,
  `assets/styles/NN_Name/`, and `assets/visual-stories/` (source pack scattered them across
  each section's own `assets/` subfolder).
- Folded the source pack's root `README.md`, `AGENTS.md`, and `CLAUDE.md` (all three carried
  overlapping progressive-disclosure guidance) into `SKILL.md`'s `## Overview` and
  `## Load Order` sections rather than preserving them as separate files.
- Added `LICENSE` (copied from the MeatySkills repo root, per house rule).
