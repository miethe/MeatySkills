---
name: genre-lyricist
description: Write, revise, and critique original song lyrics for specified genres or genre blends, including hooks, narrative, prosody, rhyme, singability, duet perspectives, and performance cues. Use for lyric-first work or alongside suno-songcraft. Do not treat prose editing, music recommendations, or audio production alone as lyric-writing tasks.
version: 1.0
app_version: "2026-09-21"
updated: 2026-09-21
---

# Genre Lyricist

Write words that belong to the speaker, serve the song, and can be performed. Treat genre as a set of useful possibilities, not a list of compulsory clichés.

## Establish the lyric contract

Extract the user's premise, language, audience, narrator, addressee, emotional starting point and turn, genre blend, melody constraints, length/form, explicitness preference, and protected lines. Keep supplied autobiographical facts separate from invented imagery. Use [lyric-brief-template.md](assets/lyric-brief-template.md) only when a formal brief will help.

Choose the edit level from the actual request:

- **Preserve:** change only cues or layout; keep sung words and punctuation.
- **Polish:** repair specific weak lines or phrasing; keep the hook, point of view, meaning, and distinctive diction.
- **Rewrite:** rework the song within the user's protected constraints.
- **Explore:** offer clearly separate directions without replacing the baseline.

Do not ask the user to repeat supplied information. Do not turn a style-only request into lyric replacement. When no melody is available, describe prosodic fit as provisional rather than claiming it matches an unheard tune.

## Choose a useful genre lens

Read [genre-lenses.md](references/genre-lenses.md). Select a primary lyric tradition based on the song's narrative and delivery, not automatically the loudest instrument. Borrow only the secondary genre features that serve the premise.

For an unfamiliar, culturally specific, or contemporary microgenre, consult primary or artist-led sources when factual accuracy matters. Mark uncertainty. Do not invent genre rules, force English stress patterns on other languages, or equate a place with a costume dialect.

## Develop the song in passes

Read [craft-and-prosody.md](references/craft-and-prosody.md).

1. **Purpose:** State the song's central tension in one sentence. Determine what the listener knows or feels differently by the end.
2. **Section jobs:** Assign each section a new observation, event, argument, emotional turn, or return. Use verse/chorus/bridge only when they fit; allow strophic, through-composed, rap, dance, and instrumental-adjacent forms.
3. **Hook:** Develop a small set of distinct title/hook concepts when needed. Pick for emotional accuracy, memorability, and mouth feel, not rhyme convenience. Keep an approved hook untouched unless editing it is authorized.
4. **Evidence:** Build a compact palette of actions, objects, sounds, textures, and locations grounded in the narrator. Make details cause or reveal something.
5. **Draft:** Write in natural speech before polishing rhyme. Keep narrative causality, tense, pronouns, and ownership clear. Leave space for breath and musical response.
6. **Prosody:** Align speech stress, likely musical emphasis, vowel shape, line density, and emotional purpose. Count syllables only as a rough aid; dialect, elision, language, and melody change delivery.
7. **Rhyme:** Choose a scheme and degree of closure appropriate to the section. Use slant rhyme or unrhymed lines deliberately. Do not invert syntax or change facts to land a rhyme.
8. **Revision:** Remove empty abstractions, repeated information, accidental mixed metaphors, borrowed-sounding phrases, and genre props that do no work. Preserve roughness when it is expressive rather than confusing.
9. **Performance:** Read aloud or use available authorized playback; test breath groups and the hook's singable vowels. Do not claim audible testing unless actually performed.

Keep detailed craft notes outside copy-ready lyrics. Read [revision-and-duets.md](references/revision-and-duets.md) for multiple narrators, line alternatives, and targeted repairs.

## Write distinct duet voices

Define each speaker's knowledge, wants, blind spots, vocabulary, and change. A co-lead must contribute a perspective or action, not merely agree with the frontman. Do not assign personality from gender.

Map solo blocks, answers, harmonized statements, and backing responses before adding cues. Use shared harmony where meaning converges; use separate lines where viewpoints differ. Keep backups from introducing an unintended third narrator.

## Export according to the destination

For ordinary songwriting, deliver clean lyrics. For Suno, coordinate with `suno-songcraft` for platform details and field limits; use concise standalone bracketed section/performance cues as requested. Keep stage directions visibly separate from sung words. Treat them as requests, not deterministic execution commands.

Default lyric delivery:

1. Recommended title and complete lyrics in one copy-ready block.
2. Only the requested alternate hooks, lines, or verses, clearly labeled and paired.
3. Brief revision notes identifying substantive changes and protected content.
4. A small number of actionable singability uncertainties or listening checks.

Do not place scansion marks, syllable estimates, citations, analysis, or an artist-reference essay inside the lyric payload. Preserve diacritics and native script. Provide pronunciation aids separately when requested.

## Check before delivery

Use [lyric-review-template.md](assets/lyric-review-template.md) for substantive work. Verify that sections develop rather than repeat the premise; metaphors remain intelligible; the hook is earned; each voice has agency; natural word stress survives; no protected line changed; and the language matches the requested audience without caricature.

Do not fabricate lived experiences as the user's biography, promise plagiarism clearance, or reconstruct unprovided copyrighted lyrics. Work from the user's supplied text, their ideas, or original writing.

Reference grounding: [sources.md](references/sources.md). Behavioral test briefs: [acceptance-cases.json](evals/acceptance-cases.json).

## When NOT To Use

- **Suno-specific style prompting, arrangement, instrumentation, vocal casting, or Style/Lyrics/
  Exclude payload assembly** — use `suno-songcraft` instead. This skill writes and revises words;
  it does not know Suno's current field limits or platform conventions on its own (see "Export
  according to the destination" above, which coordinates with `suno-songcraft` for those details).
- **Prose editing, essays, or non-lyrical creative writing** — this skill's craft passes (hook,
  section jobs, prosody, rhyme) are built for sung lyrics, not general text.
- **Audio production, mixing, or recommendation work** — this skill produces text only.
- **Reconstructing unprovided copyrighted lyrics, or claiming plagiarism clearance** — see Deferred
  below; work only from the user's own supplied text, ideas, or original writing.

## Deferred / Do Not Say

- **Do not fabricate lived experiences as the user's biography.** Autobiographical facts the user
  supplies stay separate from invented imagery; never invent a claimed personal history.
- **Do not promise plagiarism clearance or legal rights certification** — this skill has no
  capability to certify originality or rights status.
- **Do not claim audible or performed testing unless playback actually happened.** Prosodic fit
  against an unheard melody is described as provisional, never as a confirmed match.
- **Do not invent genre rules, force English stress patterns onto other languages, or equate a
  place with a costume dialect** — genre lenses are craft heuristics, not stereotypes or historical
  definitions; mark uncertainty on unfamiliar or culturally specific microgenres rather than
  guessing.
- **The 28 behavioral acceptance cases in the sibling `suno-songcraft` skill's
  `evals/acceptance-cases.json`, and this skill's own, are unexecuted** as of this ingestion
  (2026-09-21) — structural conformance is not evidence of demonstrated lyric-craft performance
  against them.

## Key References

- [/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/genre-lyricist/CHANGELOG.md](/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/genre-lyricist/CHANGELOG.md) — version history for this skill
- [/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/genre-lyricist/references/sources.md](/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/genre-lyricist/references/sources.md) — primary-source register and evidence boundaries
- [/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/suno-songcraft/SKILL.md](/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/skills/suno-songcraft/SKILL.md) — the sibling skill this one coordinates with for Suno-specific output
- [/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/PLUGIN.md](/Users/miethe/dev/homelab/development/MeatySkills/composites/suno-songcraft/PLUGIN.md) — the composite/plugin manifest this skill ships inside
