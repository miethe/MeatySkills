# Changelog — jules-integration

## 1.0 — 2026-09-21

- Adopted into MeatySkills (`skills/jules-integration/`) from a standalone `SKILL.md` originally
  authored under an `mcpmarket-version: 1.0.0` frontmatter convention.
- Restructured to the skill-dev contract: added required frontmatter (`version`, `app_version`,
  `updated`), split the router-facing `description:` to front-load trigger keywords with an
  inline "Do NOT use for" clause, and added the mandatory `## When NOT To Use` and
  `## Deferred / Do Not Say` sections.
- Rewrote the CLI command surface against the current `@google/jules` npm package (v0.1.42):
  the original documented `jules remote new --repo . --session "YOUR TASK"` does not match the
  shipped CLI. Corrected to `jules new "<prompt>"` (+ `--repo`, `--parallel`), with `remote
  list`/`remote pull` documented separately as the session-inspection surface. The stale form is
  called out explicitly in `## Deferred / Do Not Say` rather than silently dropped.
- Added a `## Key References` section pointing at this file and the sibling `LICENSE`.
- Added `LICENSE` (MIT, copied from the MeatySkills repo root per house convention).
- No change to the REST API section — the base URL, auth header, and session-create body shape
  were independently re-verified against `https://developers.google.com/jules/api` on 2026-09-21
  and match the source artifact.
