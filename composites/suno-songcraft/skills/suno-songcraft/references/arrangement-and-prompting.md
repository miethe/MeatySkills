# Arrangement and prompt design

Everything below is a creative workflow heuristic, not a claim that Suno obeys a formal score. Adapt it to the brief.

## 1. Blend by responsibility

Use a role matrix before a long list of genre names:

| Layer | Ask | Example assignment |
|---|---|---|
| Foundation | What supplies the song's identity and form? | Country-soul narrative duet |
| Groove | What establishes time and body movement? | Slow rolling 12/8 with laid-back backbeat |
| Harmony | What supplies color and tension? | Blues-inflected voicings; open acoustic drones |
| Lead instrument | What must listeners recognize? | Clean single-coil fingerstyle funk and double-stops |
| Roots detail | Which techniques earn the roots influence? | Sparse banjo rolls, mandolin chop, fiddle answers |
| Roughness | Where does the grunge influence live? | Dirty accents, percussive strums, ragged peaks |
| Production | What acoustic space binds the layers? | Intimate live-room sound with controlled separation |

These examples belong to one song, not every blend. A synth-pop/West African guitar/ambient brief requires a different matrix and specific, verified regional terminology where material.

Use qualitative weights such as foundation, supporting influence, and accent. Numerical percentages may help a human brief but are not a documented audio-mixing control.

## 2. Make instruments do jobs

For each instrument specify a useful subset of **tone, technique, register, placement, density, and entrance**. Compare “guitar, fiddle, banjo” with “clean guitar answers vocal phrases; fiddle sustains only at pre-chorus lifts; banjo adds sparse rolling subdivision after verse one.” The second tells the arrangement how to avoid collisions.

Start with one or two anchors, rhythm foundation, and a few accents. Add complexity only after an audible baseline. Texture should be perceivable, not just named. Prefer “dry close-miked acoustic with audible pick attack” to “authentic, organic, epic, professional, emotional.”

Distinguish:

- **Playing intensity** from **tempo**: harder acoustic attack need not increase BPM.
- **Distortion** from **vocal identity**: a raspy voice need not scream.
- **Dense backing** from **lead count**: a stack can stay behind two leads.
- **Roots technique** from **speed stereotype**: acoustic picking can serve a slow song.
- **Full mix** from **every instrument always on**: density is an arrangement decision.

## 3. Define a cast, not a celebrity collage

Use stable roles such as M1/F1/BGV in the planning brief, then plain descriptions in the actual lyric cues. Describe a singer through register, resonance, grain, articulation, phrasing, and dynamic range without claiming exact biological or personal identity.

Example planning map:

| Role | Verse 1 | Verse 2 | Chorus | Bridge |
|---|---|---|---|---|
| Low raspy lead | Solo melody | Quiet supporting entrance | Melody or low harmony | Vulnerable question/answer |
| Smoky co-lead | Selective harmony | Solo melody | Melody or upper harmony | Independent question/answer |
| Backing trio | Silent | Silent or restrained | Enter late; close harmony | Enter at convergence |

Ask for fewer simultaneous instructions when routing fails. Start with section-sized handoffs before line-by-line alternation. Add harmonies after both leads are recognizable. Try a section repair before rewriting the entire prompt.

## 4. Groove and form

When tempo is central, specify the intended counted pulse. For compound meters, document the beat-unit assumption in the planning brief; do not silently convert the user's 78 BPM into a different felt pulse. A prompt may say “slow rolling triplet pulse” when that conveys the intention better than more notation.

Treat key, chord sequences, bar counts, and duration as targets unless supported by supplied audio or notation and an appropriate workflow. Do not derive them from a mood label. Harmonic “bluegrass roots” does not by itself prescribe a key or progression.

Draw an energy contour with a clear reason: restrained opening, withheld harmony, stronger second chorus, contrasting bridge, final release. For dance or minimal music, the strongest contour may instead come from subtraction, filtering, groove mutation, or returning a motif.

## 5. Prompt budget

A starting allocation for a 1,000-character cap is roughly 150 for identity/groove, 250 for voices, 350 for instrumentation, and 200 for dynamics/production, leaving headroom. This is an editing aid, not a mandatory quota.

When over budget, remove in this order: repeated praise; redundant mood adjectives; duplicate genre tags; nonessential accents; repeated local directions already in lyrics. Do not remove the main singer, anchor instrument, fundamental groove, or protected stylistic contrast merely to retain decorative details.

Prefer plain compact sentences. Do not append a second “Style Tags” dump, a JSON mood object, or a second voice specification that contradicts the first. Put exact counts outside the copy block. Avoid emoji and unusual Unicode in Style when they add no musical information; do not strip useful native-language text from lyrics.

## 6. Local cue convention

Use one standalone bracket cue per line. Keep directions brief and nearby:

```text
[Verse 2]
[Female lead: smoky, close; sparse accompaniment]
Actual lyric line goes here.
[Male adds soft lower harmony]
The next actual lyric line goes here.
```

This example illustrates layout, not a guaranteed supported grammar. Do not put a paragraph-long engineering note ahead of every line. If cues are sung or ignored, simplify them and retain the important global direction in Style. Parentheses may be intended as sung ad-libs; do not automatically delete or reinterpret them.

For an instrumental, avoid accidental vocal instructions. A structural plan may guide the instrumental without manufacturing a singer or lyrics. Explain any instrumental cues separately unless the current workflow expects them in a field.
