# Changelog — intenttree-design-system

## 1.0 — 2026-09-21

Adopted into MeatySkills from a prior standalone instance
(`/Users/miethe/dev/WIP/agents/Claude-Skills-Dev/intenttree-design-system`). Changes made during
adoption:

- Added skill-dev-conformant frontmatter to `SKILL.md` (`name`, `description`, `version`,
  `app_version`, `updated`) — the source file had no frontmatter block at all.
- Added `## When NOT To Use`, expanded `## Deferred / Do Not Say`, and `## Key References`
  sections to `SKILL.md`.
- Added this `CHANGELOG.md`.
- Added `LICENSE` (copied from the MeatySkills repo root, per house rule).
- Fixed a dangling reference: `SKILL.md` and `README.md` referenced `tokens/colors_and_type.css`,
  which does not exist — the actual file is `tokens/tokens.css`. Corrected both.
- Deduplicated the reference mockup PNGs: `uploads/*.png` and `assets/refs/*.png` held
  byte-identical copies of the same 9 files (verified via SHA-256). Kept `assets/refs/` as the
  canonical location (per MeatySkills ingestion convention — `uploads/` reads as ingest staging,
  not a maintained path) and removed the `uploads/` copies, saving ~6 MB.
- Moved the two design-handoff documents (`uploads/DESIGN.full.md`,
  `uploads/UIUX_DESIGN_SPEC.full.md`) into `references/`, then removed the now-empty `uploads/`
  directory.
- Diffed this system's `tokens/tokens.css` and `tokens/components.css` against the live
  `intenttree` repo's equivalents and recorded concrete staleness findings in `SKILL.md`'s
  "Deferred / Do Not Say" section, rather than leaving the artifact's currency unstated. Filed a
  tracker node for the actual refresh (not performed here — see the ingestion report).
