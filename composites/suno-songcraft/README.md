# Suno Songcraft — Codex Skill Pack

**Version 1.0.0 · Prepared 2026-09-14**

Two independently installable skills for developing original songs and refining supplied work. The production skill handles Suno briefs and arrangements; the lyric skill handles writing and revision across genres. The detailed Carolina sound is an opt-in worked example, not a universal style preset.

This is an independent workflow pack, not an official Suno/OpenAI integration. It creates and validates text; it does not generate audio, log in, spend credits, or publish songs.

## Included skills

| Skill | Responsibility |
|---|---|
| `suno-songcraft` | Genre responsibility maps, groove, instrument roles, vocal cast and harmony, Style/Lyrics/Exclude separation, controlled variants, edit briefs, dated platform facts, artist-reference handling, and listening iteration |
| `genre-lyricist` | Premise, narrator and addressee, hook, section development, imagery, rhyme, prosody, singability, duet agency, genre-sensitive revision, and clean lyric exports |

Each uses `SKILL.md`, optional `agents/openai.yaml`, and progressively loaded references. The production skill includes a local JSON packet schema and standard-library Python checks. The lyric skill can be used without Suno.

## Installation

Prerequisites: a Codex host supporting local skills; Python **3.10+** for the installer and checks. The skills themselves are Markdown instructions. There are no third-party runtime dependencies.

Extract the ZIP, then run these commands from its extracted root:

```bash
cd suno-songcraft-codex
python3 install.py --dry-run
python3 install.py
```

The default destination is `~/.agents/skills`. Current Codex documentation also supports repository-local `.agents/skills` directories. See source O1 in the production skill's source register. If discovery does not update, restart Codex.

For a repository-specific installation:

```bash
python3 install.py --dest "/path/to/project/.agents/skills"
```

For only the lyric skill:

```bash
python3 install.py --only genre-lyricist
```

The installer refuses existing destinations by default. To update deliberately while saving the previous version:

```bash
python3 install.py --replace-with-backup
```

Backups go to a sibling `.skill-backups` directory outside skill discovery. All targets are checked before copying; installation/rollback is per skill, not an all-or-nothing transaction across both skills. The installer never copies the bundle's root AGENTS.md over your project guidance and makes no changes to Codex configuration or permissions.

Manual installation is also possible: copy either or both complete directories from `skills/` into a supported local skill directory. Do not install just SKILL.md without its linked references.

## Invocation examples

### A new genre-blended song

```text
Use $suno-songcraft and $genre-lyricist.
Develop an original song about maintaining a friendship across time zones.
Blend synth-pop, intimate folk storytelling, and restrained ambient textures.
Keep a warm low lead, a memorable clean-guitar motif, and an uncluttered chorus.
Deliver one recommended version and two controlled alternatives.
Use descriptive artist-free prompts. Keep each Style under 1,000 characters.
Return copy-ready Style, Lyrics, and Exclude blocks with counts outside them.
```

### Restyle without rewriting

```text
Use $suno-songcraft.
Restyle the supplied song while preserving every sung word and the hook.
Keep its clean funky guitar, add more acoustic attack and room texture,
and preserve the male/female co-lead arrangement.
Give a baseline and one grittier variant with the same lyrics and tempo.
Do not claim to have heard the source unless its audio is actually available.
```

### Genre-sensitive lyric work

```text
Use $genre-lyricist.
Polish the supplied lyrics for a country-soul / grungegrass duet.
Keep the chorus exactly. Give both singers independent perspectives.
Strengthen verse two's progression and the bridge's emotional turn.
Show only the revised lyrics, a few optional line alternatives, and a short change log.
```

### Artist-reference shorthand, when specifically requested

```text
Use $suno-songcraft.
Translate my artist references into specific instrumental and vocal traits.
Give me a complete descriptive baseline and an optional surname-shorthand
version with the same intended sound. Keep full names out of paste fields.
Label artist-name acceptance unverified; do not treat surnames as a loophole.
```

## Important decisions built into the pack

**Artist references:** preserve the writer's creative references, but default the actual paste fields to descriptive traits. Optional surname variants are explicitly experimental for platform acceptance. The source register distinguishes the documented warning from unverified assumptions.

**Limits:** the 1,000-character Style cap comes from the user's brief. It is not asserted as a universal current v6 UI limit. Exact code-point and UTF-16 counts are checked; useful headroom is preferred. Lyrics and Exclude are separate fields.

**V6 facts:** the platform snapshot is dated 2026-09-14 and linked to official sources. The skill refreshes relevant facts when current behavior matters instead of treating a frozen guide as permanently current. Basic structure cues are distinct from unverified detailed singer-routing requests.

**Variations:** change one primary dimension and explain the listening hypothesis. A name-free re-encoding is a compatibility alternative, not a different arrangement. Reuse one lyric block only when all variants genuinely share it.

**Lyric craft:** choose a primary lyric lens, then borrow secondary devices intentionally. A supplied melody changes the scansion task; equal syllable counts alone do not establish a match. Genre examples are adaptable craft heuristics, not stereotypes or historical definitions.

## Worked examples

The production skill's `assets/` directory includes:

- `carolina-rain.packet.json` and `.copy.md`: your supplied song, light edits, explicit vocal roles, a descriptive baseline, rougher texture variant, and optional surname re-encoding. Style lengths: **961 / 951 / 975** characters.
- `after-hours.packet.json` and `.copy.md`: an unrelated instrumental minimal-house / neo-soul / ambient example demonstrating that country, singers, and lyric templates are not hard-coded. Style lengths: **439 / 508** characters.

The Carolina files contain your song lyrics; omit that worked example before distributing this as a generic public pack unless you choose to share it.

## Validate and render

From the bundle root:

```bash
python3 -m unittest discover -s skills/suno-songcraft/scripts -p 'test_*.py' -v
python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 skills/suno-songcraft/scripts/songcheck.py check skills/suno-songcraft/assets/carolina-rain.packet.json
```

For your own packet:

```bash
python3 skills/suno-songcraft/scripts/songcheck.py check song.packet.json --json
python3 skills/suno-songcraft/scripts/songcheck.py render song.packet.json --output song.copy.md
```

For a standalone Style payload, count exact file contents, including final newlines:

```bash
python3 skills/suno-songcraft/scripts/songcheck.py count style.txt --limit 1000 --json
```

The checker catches structural problems, over-budget Style text, declared-count mismatches, known artist aliases in descriptive payloads, protected-line loss, preserve-words violations, malformed cue layout, duplicate role/variant IDs, and selected conflicts. Its schema checks implement the keyword subset used by the bundled schema, not all of JSON Schema.

It does not hear audio, calculate authoritative scansion, identify every artist, certify legal rights, predict moderation, or prove exact melody/voice preservation. See `VALIDATION.md` for the actual build checks. Behavioral acceptance cases are provided for later agent testing and remain marked unexecuted.

## Structure and provenance

```text
suno-songcraft-codex/
  README.md
  AGENTS.md
  install.py
  VALIDATION.md
  manifest.json
  skills/
    suno-songcraft/
      SKILL.md
      agents/openai.yaml
      references/
      scripts/
      assets/
      evals/acceptance-cases.json
    genre-lyricist/
      SKILL.md
      agents/openai.yaml
      references/
      assets/
      evals/acceptance-cases.json
  tests/test_install.py
```

Primary sources and evidence boundaries live in each skill's `references/sources.md`. `AGENTS.md` is maintenance guidance for this bundle. The manifest records file integrity, version, and verification date; it is not a claim of Suno endorsement or audio performance.
