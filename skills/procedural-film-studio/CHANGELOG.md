# Changelog — procedural-film-studio

## 1.0 — 2026-09-21

Adopted into MeatySkills from `Claude-Skills-Dev/procedural-film-studio-pack/`
(`procedural-film-studio/SKILL.md`, then 506 lines) as a single conformant skill.

- Added required frontmatter: `version`, `app_version`, `updated`.
- Added `## When NOT To Use` and `## Deferred / Do Not Say` sections.
- Restructured for progressive disclosure: the full 15-step workflow detail, rendering
  strategy, preview-before-scale rule, generated-imagery rules, and graceful-degradation
  ordering moved to `references/production-workflow.md`; the scene-ledger schema and
  story-understanding checklist moved to `references/scene-ledger-and-narrative.md`; the
  output directory contract moved to `references/output-package-spec.md`. `SKILL.md` now
  carries the router, defaults, contracts, and a one-line-per-step workflow index.
- Folded in the sibling standalone prompt `01_PROCEDURAL_ANIMATED_FILM_PRODUCTION_PROMPT.md`
  (same pack) rather than shipping it as a separate artifact: it covered the same production
  methodology in prompt form with ~90% content overlap against `SKILL.md`. The genuinely
  unique parts — the narrative-arc heuristic (`question → model → investigation →
  complication → insight → implication`), its fuller story-understanding checklist, and its
  more detailed output-directory tree (`src/scenes/`, `src/lib/`, per-stem `audio/` paths,
  `qa/contact-sheet.*` + `qa/sampled-frames/`) — were merged into the references above rather
  than dropped. The standalone prompt file itself was not carried into MeatySkills; its content
  now lives entirely inside this skill.
- Added `LICENSE` (copied from the MeatySkills repo root, per house rule).
- Absorbed the pack's `README.md`: its "two reusable artifacts" framing is now moot (folded
  into one skill) and its "recommended architecture" diagram is superseded by this skill's own
  input/output contracts; its one open TODO (add `filmkit/`-style renderer/QA utilities under
  the skill) is recorded verbatim in `## Deferred / Do Not Say` rather than silently dropped.
