# Controlled iteration and listening review

These are experiment-design and production heuristics. Numerical scores are listener judgments, not measured model probabilities.

## Choose the next experiment

Separate four axes:

| Variant kind | Change | Keep stable |
|---|---|---|
| Sonic | One of grit, groove, palette, vocal density, or production space | Hook, lyric content, other key musical anchors |
| Structural | Section length/order, entrance timing, bridge contrast | Core premise and agreed hook |
| Lyric | A hook, image system, verse, or line repair | Arrangement and source melody where possible |
| Reference encoding | Artist shorthand versus traits | Intended sound, words, cast, groove |

A default exploration pack has baseline A, targeted alternative B, and at most one further useful test. Do not produce six nearly identical prompts as fake variety. For each, state a falsifiable listening question: “Does more acoustic attack add roughness without covering the clean guitar?” is better than “Is this epic?”

Platform randomness remains. Hold available controls steady; log them; do not call a single lucky generation proof of a prompt law. Do not invent seed support or reproducibility settings.

## Editing an existing song

First identify whether the actual audio is available, what was heard, and which reference is selected in the authorized tool. Preserve the source before experimenting. Distinguish preserving words, preserving melody, preserving arrangement, preserving timbre, and preserving exact audio; they are different requirements.

Use this edit brief pattern:

```text
Use the selected source track. Change only [section/time range/element].
Make [specific musical change]. Preserve [hook, words, groove, identity,
arrangement, timing, or other explicitly protected elements]. Keep the
change localized. Judge success by [audible test].
```

Replace placeholders before delivery. Do not guarantee that unaffected audio is identical. If exact preservation matters, compare before/after audio using an appropriate available workflow; textual constraints alone cannot verify it. A rebuilt song is not automatically a surgical edit.

When only one lyric is wrong, request the smallest relevant line/section repair before a full regeneration, using currently verified editing capabilities. When the whole musical identity is wrong, repair the hierarchy in the brief rather than stacking more adjectives.

## Listening order

Reject hard failures before ranking aesthetic preferences. Check:

1. Protected hook/words and the intended lead cast.
2. Groove and signature instrument audibility.
3. Section ownership, harmony hierarchy, and intelligibility.
4. Genre blend coherence, dynamics, emotional arc, and ending.
5. Artifacts, cue leakage, unexpected lyrics, timing jumps, and fatigue.

Log the model, date, source, prompt version, lyrics version, actual controls shown, generation identifier, and timestamps of problems. Leave scores empty until listening occurs. The `assets/listening-log.csv` file is an optional log header, not results.

A useful 1–5 scale: 1 misses the intention, 3 partly achieves it, 5 strongly achieves it. Define success for this song before comparing. A good overall score never cancels a violated locked lyric or a missing co-lead.

## Repair by symptom

| Symptom | First repair | Avoid |
|---|---|---|
| Lead voices merge | Remove extra singer identities; strengthen section-sized ownership | Adding more famous voices |
| Backups replace frontman | State support role; delay entrance; reduce stack density | Repeating “powerful vocals” |
| Genre mix becomes mush | Reassign influences to concrete layers; simplify accents | Adding more genre labels |
| Roots sound becomes frantic | Restate felt pulse; decouple fast picking from tempo | Removing every acoustic instrument |
| Clean guitar disappears | Make it an anchor; reduce dirty layers in its register | Asking every instrument to be prominent |
| Grunge means only distortion | Target attack, dynamics, and vocal grain independently | A constant wall of fuzz |
| Lyrics feel generic | Replace one abstract assertion with consequential action | Adding unrelated local brand/place names |
| Cue text is sung | Shorten/standardize cues; move global detail to Style | More brackets and longer directives |
| Harmony is muddy | Reduce simultaneous parts; specify melody ownership | Asking for more stacks |
| New verse crowds melody | Match phrase stress and breath groups to the source | Equal syllable counts as the only test |
| Ending feels cut off | Request an ending gesture; verify generated audio | Assuming a tag fixes all endings |

## Completion language

Say “text package validated,” “Style counted,” or “listening review completed” only for work actually done. Without audio, list proposed listening checks and state that performance is untested. Do not imply a high-credit mode, named reference, or longer prompt guarantees a superior result.
