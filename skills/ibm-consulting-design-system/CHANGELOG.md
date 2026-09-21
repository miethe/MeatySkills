# Changelog — ibm-consulting-design-system

## 1.0 — 2026-09-21

Initial skill-dev conformance adoption of an already-placed artifact
(`skills/ibm-consulting-design-system/`, previously at `85` files / `12M`, unchanged in content).

- Fixed `name:` frontmatter key from `ibm-consulting-design` to `ibm-consulting-design-system` to
  match the directory name (validator requirement).
- Added required frontmatter: `version: 1.0`, `app_version: "2026-09-21"`, `updated: 2026-09-21`.
- Rewrote `description:` to lead with router-relevant trigger keywords and add an inline
  "Do NOT use for" clause.
- Restructured the body into a "What's in this kit" table plus explicit `preview/*.html` and
  `slides/*.html` indexes, so an agent can find the right token card or slide template from
  SKILL.md alone instead of listing the directory (the prior 30-line version under-routed for an
  85-file, 12M artifact).
- Added `## When NOT To Use` (real boundaries: production Carbon work, non-IBM-Consulting brands,
  authoritative-policy citation, font redistribution).
- Added `## Deferred / Do Not Say` recording: this is internal presentation material, not
  IBM-published guidance; `Global Instructions - IBM branding.md` is deliberately withheld pending
  `node_01M329WNS6MD1407J4XMNB6A5X`; three referenced source decks were never uploaded; the bundled
  `fonts/` (IBM Plex Sans) are OFL-1.1-licensed and currently lack an accompanying OFL license file.
- Added `## Key References` with absolute, on-disk-resolving paths.
- No change to any design asset, CSS token, preview card, slide template, or UI-kit file — content
  is otherwise byte-identical to the pre-adoption copy.
