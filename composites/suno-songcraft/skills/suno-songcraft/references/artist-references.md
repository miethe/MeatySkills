# Artist references: creative shorthand versus platform acceptance

## Ground truth

Suno's moderation article, edited **2025-12-19** and checked **2026-09-14**, says that well-known artist/person names may prevent generation [S4 in sources.md]. It does not document a surname-only exception. The v6 launch also discusses future opt-in artist experiences; that is not blanket permission to use any artist identity now [S1].

Do not turn “this spelling worked once” into “this spelling is allowed.” Acceptance can differ from musical fidelity, platform permission, or authorization to use a recording.

## Default: translate references into musical attributes

Record the user's intended reference in the brief and map it to specific, original musical choices. Select the attributes they actually requested; do not assume an artist's entire catalog is a single style. These are **translations of this user's reference intent**, not factual profiles or claims of voice duplication:

| User shorthand | Relevant target traits in the Carolina brief |
|---|---|
| Mayer | Clean single-coil guitar; muted finger-funk; blues bends; double-stops; conversational phrasing only where useful |
| Stapleton | Deep chest resonance, sandpaper grain, intimate lows, soulful ragged peaks |
| Evans | Rich smoky country lead, clear ringing highs, warmth without disappearing behind the frontman |
| LeVox / DeMarcus / Rooney | Tight country backing blend; bright top, warm middle, resonant low support |
| Cornell / Weiland | Rough high-harmony peaks or darker rock grain, not an additional competing frontman |

Write the default Style and lyric role cues with those attributes. Keep the result recognizably its own composition. Do not promise “sounds exactly like” or use another person's identity as the name of the generated singer.

## Requested surname variant

When the user explicitly requests reference-name shorthand, provide it as an optional alternative alongside a complete descriptive version:

- Use only the surnames or unambiguous shorthand the user requested in paste-ready fields; do not expand to full names.
- Assign each reference a role; avoid an unordered roll call of artists.
- Label acceptance **unverified** outside the Style block and in the packet warning.
- Keep the musical plan, lyrics, tempo, and arrangement constant so this remains a reference-encoding comparison.
- Do not call it a more accurate or officially supported prompt.

If a prompt is rejected, move to the descriptive version. Do not propose misspellings, hidden characters, initials, spacing, or tags as a way to evade the block. If a documented artist-specific opt-in feature is genuinely available, verify its scope and use that authorized workflow rather than generalizing to other artists.

## Inputs and outputs

User-owned lyrics can be edited according to the brief. Do not seek or reproduce unprovided copyrighted lyrics merely to make a closer imitation. Use uploaded reference audio only within the user's actual rights/authorization and the tool's requirements; do not claim rights were legally verified from an assertion alone.

The packet's `artist_references` list is a creative mapping and a limited lint dictionary. It is not submitted as a Style field. The linter can catch listed aliases; it cannot identify every famous name, determine licensing, or certify moderation acceptance.

Use unambiguous aliases in the lint dictionary. A common noun or a genuine character name can be a false positive; inspect the context and narrow the dictionary with a recorded reason rather than silently rewriting intended lyrics. Passing an alias check still does not prove platform acceptance.
