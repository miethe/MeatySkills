---
name: suno-songcraft
description: Develop and revise Suno songs, genre blends, style prompts, instrumentation, vocal arrangements, variations, and edit briefs. Use for Suno creation or refinement, including v6-specific guidance. Coordinate lyric writing with genre-lyricist. Do not imply audio generation or account access without an available authorized tool.
version: 1.0
app_version: "2026-09-21"
updated: 2026-09-21
---

# Suno Songcraft

Turn a musical intention into a coherent, copy-ready song package. Preserve the user's authorship and essential sound; make trade-offs explicit rather than stuffing every influence into every layer.

## Start with scope and evidence

1. Identify the request: new song, restyle, lyric revision, arrangement, instrumental, or controlled comparison. For style-only work, do not rewrite lyrics or invent a full project.
2. Extract constraints already supplied. Ask only for a genuinely blocking detail; otherwise state a small, reversible assumption. Do not import personal facts or unrelated song presets.
3. Read [platform-v6.md](references/platform-v6.md) for model, control, and workflow advice. Verify current official sources when the user asks for latest behavior or a time-sensitive feature matters. Offline, state the snapshot date and omit unsupported settings. Never guess a new model, UI field, or API.
4. Read [artist-references.md](references/artist-references.md) when any artist or band is named. Default to descriptive musical traits. Keep reference names in the creative brief, not automatically in paste-ready fields.

## Build a compact musical brief

Capture premise, audience/language, emotional movement, primary genre, secondary influences, groove, voice roles, instrument roles, production texture, and what must remain unchanged. Use [brief-template.md](assets/brief-template.md) only when a reusable brief is useful.

Separate three constraint tiers:

- **Locked:** approved hook, protected lyrics, signature riff, perspective, forbidden changes.
- **Directed:** target groove, vocal character, arrangement, dynamic arc.
- **Exploratory:** accent instruments, grit, alternate hooks, secondary genre weight.

Resolve source contradictions explicitly. One male lead plus a female co-lead is not a two-male-lead duet. A backing trio is not three extra frontmen. A timbre description does not establish an actual singer's identity or vocal range.

## Design the musical roles

Read [arrangement-and-prompting.md](references/arrangement-and-prompting.md).

- Assign a foundation genre to groove/form and each secondary influence to a concrete role: harmony, instrumental technique, timbre, vocal delivery, or production.
- Name one or two sonic anchors. Give supporting instruments an entrance, register, or function; avoid constant full-density layering.
- Define each vocalist once: lead or backing role, comfortable register, grain, diction, intensity, section ownership. Use short, consistent role labels in lyric cues.
- Specify who carries the melody versus harmony. Distinguish unison, close harmony, call-and-response, backing stack, and choir. Request exact intervals only when useful; do not guarantee execution.
- Describe groove with tempo, meter, beat unit when material, subdivision, and feel. Do not confuse a faster picking subdivision with a tempo increase.
- Map verse intimacy, chorus lift, bridge contrast, and ending, or choose another form appropriate to the music. Do not force every genre into a pop song arc.

## Write or preserve the lyrics

For substantive writing or editing, use the installed `genre-lyricist` skill, locating it through the available skill list. It can work independently; do not assume a hard-coded installation path.

If it is unavailable, use this minimal fallback: define speaker and emotional turn; give each section a distinct job; write a memorable hook; develop concrete images; read the words aloud for stress, breath, and natural language; preserve locked lines; separate directions from sung words. Do not label this a complete lyric-craft review.

Use the Carolina example only when the request explicitly calls for that palette; see [carolina-profile.md](references/carolina-profile.md). Do not re-use its lyrics for unrelated users or songs.

## Compile the output

Keep four separate payloads: **Style**, **Lyrics**, optional **Exclude**, and optional **Edit brief**. Put each in its own fenced `text` block; put labels, counts, rationales, and citations outside the payload.

For Style, prioritize:

1. Foundation and bounded genre mix; tempo/groove.
2. Lead voice identities as musical traits; handoffs and backing hierarchy.
3. Anchor instruments and playing techniques; supporting roles.
4. Section-level dynamics; production and emotional movement.

Default to at most **1,000 characters per Style** as a user constraint. Count final text programmatically, including spaces, punctuation, and line breaks. Prefer headroom; never silently truncate a sentence or drop a locked feature. Track both Unicode code points and UTF-16 units; require both within the chosen ceiling unless a confirmed UI convention says otherwise. Lyrics and Exclude do not consume this Style budget. Do not invent their current platform limits.

Put concise standalone bracketed cues before relevant lyric sections. Treat them as soft performance requests, not an API or reliable voice-routing grammar. Do not bury stage directions in sung text or fill lyrics with long production essays.

## Make informative variations

Default to one recommended baseline plus up to two meaningful alternatives when exploration is requested; deliver fewer for narrow tasks.

For every alternative, state the changed axis, the elements held constant, the listening hypothesis, and the likely trade-off. Change one primary axis at a time. A name-free re-encoding is a compatibility version, not a new sonic arrangement. Share lyrics only when all versions use the same words and section ownership; otherwise provide an explicitly paired lyric variant.

If requested, a surname-shorthand version may accompany the descriptive baseline, labeled unverified for acceptance. Never describe surnames, initials, misspellings, or bracket placement as a moderation loophole. Never respond to a rejection by disguising the same artist name.

## Iterate and verify

Read [iteration-and-qc.md](references/iteration-and-qc.md) for source-preserving edits, listening tests, and failure-specific repairs. Use the smallest sufficient change. Keep generation recommendations separate from actions that spend credits or publish content.

For reusable files, batch work, or a logged experiment, use the local contract in [packet-contract.md](references/packet-contract.md) and [song.packet.schema.json](assets/song.packet.schema.json). This is a project file format, **not a Suno API**.

Run when a packet or Style file is available:

```bash
python3 <skill-dir>/scripts/songcheck.py count style.txt
python3 <skill-dir>/scripts/songcheck.py check song.packet.json
python3 <skill-dir>/scripts/songcheck.py render song.packet.json --output song.copy.md
```

Use the actual skill path in place of `<skill-dir>`. The script needs Python 3.10+ and no third-party runtime packages. Fix errors and review warnings. It does not hear audio, identify every artist, certify moderation acceptance, or judge all musical contradictions.

## Finish with the right amount of output

Deliver the recommended copy-ready fields, measured Style counts, concise variation trade-offs, any verified control recommendations, and the next listening decision. For a light task, do not impose a JSON packet or a report. For files, include actual paths and validation results. State what remains untested.

Reference provenance: [sources.md](references/sources.md). Behavioral test briefs: [acceptance-cases.json](evals/acceptance-cases.json).

## When NOT To Use

- **Lyric writing or revision as the primary task** — use `genre-lyricist` instead. This skill
  coordinates lyric work through the fallback in "Write or preserve the lyrics" above, but its own
  focus is the musical brief, arrangement, and Style/Lyrics/Exclude payload, not craft-level lyric
  development.
- **Actually generating audio, logging into a Suno account, spending credits, or publishing a
  song** — this skill produces text (briefs, prompts, packets); it has no audio, account, or
  publishing capability, and never implies otherwise.
- **General prose editing or non-song creative writing** — this is a song-production skill, not a
  general writing assistant.
- **Verifying current Suno v6 UI/API behavior with certainty** — the platform reference is a dated
  snapshot (see Deferred / Do Not Say below); for a live-verification need, consult current
  official Suno sources directly rather than treating this skill as the source of truth.

## Deferred / Do Not Say

- **No audio was generated, heard, or tested in Suno during this pack's development.** Do not
  claim or imply that a Style/Lyrics/Exclude payload has been heard, rendered, or musically
  validated — the `songcheck.py` tooling is a structural/text checker only.
- **The 1,000-character Style ceiling is a user-requested project constraint, not a certified
  universal Suno UI limit.** Do not present it as an official platform fact.
- **The `references/platform-v6.md` snapshot is dated 2026-09-14** and was not re-verified against
  current Suno behavior during this MeatySkills ingestion (2026-09-21). Treat it as historical
  evidence; re-check primary sources when a time-sensitive feature matters.
- **The 28 behavioral acceptance cases in `evals/acceptance-cases.json` are explicitly unexecuted.**
  Passing the 69 automated structural/unit tests recorded in `VALIDATION.md` is not equivalent to
  demonstrated performance on those behavioral cases.
- **Do not treat surname/initial/misspelling artist-reference shorthand as a documented moderation
  loophole** — it is labeled unverified for platform acceptance, never a certified workaround.
- Do not claim this is an official Suno or OpenAI integration; it is an independent workflow pack.

## Key References

- [/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/suno-songcraft/CHANGELOG.md](/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/suno-songcraft/CHANGELOG.md) — version history for this skill
- [/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/suno-songcraft/references/sources.md](/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/suno-songcraft/references/sources.md) — primary-source register and evidence boundaries
- [/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/suno-songcraft/scripts/songcheck.py](/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/suno-songcraft/scripts/songcheck.py) — standard-library Style/packet checker and renderer
- [/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/PLUGIN.md](/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/PLUGIN.md) — the composite/plugin manifest this skill ships inside
- [/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/VALIDATION.md](/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/VALIDATION.md) — the pack's build-time validation report
