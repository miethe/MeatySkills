---
skillmeat-type: composite
skillmeat-version: "1.0"
name: suno-songcraft
description: Two independently installable skills for original song development and lyric craft — suno-songcraft (Suno briefs, arrangements, style/lyrics/exclude payloads) and genre-lyricist (premise-to-hook lyric writing and revision) — plus a standard-library installer for Codex-style local skill directories.
composite-variant: plugin
---

# Suno Songcraft Plugin

A two-skill pack for developing original songs and refining supplied lyrics/arrangements, ported
from a Codex-native skill pack (`AGENTS.md` + `install.py` + `manifest.json`) into MeatySkills.

## Relationship to `manifest.json`

This file is **additive**, not a replacement. `manifest.json` is the plugin's own build/integrity
record — file inventory, SHA-256 hashes, automated-test counts — consumed by `install.py` and by
the pack's own `VALIDATION.md`. It is native to the Codex packaging convention this artifact
shipped with and is preserved unchanged. `PLUGIN.md` is the SkillMeat-side manifest that declares
this directory as a `composite` (variant `plugin`) artifact so SkillMeat's discovery/deploy tooling
recognizes it as a container. **Do not consolidate the two** — a future edit that merges
`manifest.json`'s fields into this file, or deletes `manifest.json` in favor of this one, breaks
`install.py`'s own integrity check and this pack's `VALIDATION.md` claims, neither of which read
`PLUGIN.md`.

## Contents

| Path | Role |
|---|---|
| `skills/suno-songcraft/` | Suno production skill — genre responsibility maps, groove, instrumentation, vocal cast, Style/Lyrics/Exclude payloads, variations, and a standard-library `songcheck.py` validator/renderer |
| `skills/genre-lyricist/` | Lyric-writing skill — premise, narrator, hook, section development, prosody, rhyme, duet voices; usable standalone or coordinated with `suno-songcraft` |
| `install.py` | Codex-host installer: copies either or both skill directories into `~/.agents/skills` (or a `--dest` path), with dry-run and backup-on-replace support |
| `manifest.json` | Build/integrity record (file inventory + SHA-256 + test counts) — Codex-native, unchanged; see relationship note above |
| `AGENTS.md` | Maintenance guidance for this pack (both skills) |
| `VALIDATION.md` | The pack's own build-time validation report (69 automated tests, 28 unexecuted behavioral cases) |
| `tests/test_install.py` | Installer unit tests (dry-run, dest override, `--only`, backup-on-replace) |
| `LICENSE` | MIT, per MeatySkills house rule — also present in each `skills/<name>/` directory |

## Using this pack

This is a Codex-shaped skill pack: it expects installation into a local Codex skill directory via
`install.py`, not direct SkillMeat-managed deployment of the two inner skills in isolation (though
each skill is independently SkillMeat-conformant — see their own `SKILL.md`/`CHANGELOG.md`). See
`README.md` for installation commands and invocation examples, and `AGENTS.md` for the maintenance
invariants (locked/directed/exploratory constraint tiers, platform-fact currency, no audio
generation or account access).

## Known staleness (see also each skill's `## Deferred / Do Not Say`)

The platform snapshot (`references/platform-v6.md` under `skills/suno-songcraft/`) is dated
2026-09-14 and was not re-verified against current Suno UI/API behavior during this ingestion.
Treat it as historical evidence, not current fact, and re-check primary sources before relying on
any time-sensitive claim in it.
