# Suno platform snapshot

Verified: **2026-09-14**. Source IDs resolve in [sources.md](sources.md). This file separates documented capabilities from this pack's workflow choices. Refresh only the facts needed for the current task; do not browse merely to decorate a lyric rewrite.

## Documented product facts

| Topic | Snapshot | Source |
|---|---|---|
| Models | v6 targets controlled creation; v6-wild targets exploration; v6-mini is the lighter, faster option. | S1, S2 |
| Access and duration | Suno lists v6/v6-wild for Pro and Premier, v6-mini for all plans, and up to eight minutes per generation. Confirm the user's actual UI rather than assuming account access. | S2 |
| Natural-language editing | Suno describes editing a section or lyric, combining sources, and using text/audio/image/video references. These are product claims, not proof of lossless preservation. | S1 |
| Variety | The FAQ says this control modifies style prompts; setting it to zero retains control of the style tags. It does not make audio deterministic. | S3 |
| Max Mode | The FAQ describes a higher-credit option for longer songs, closer covers/style transfer, and greater vocal/style consistency. Check current cost before spending. | S3 |
| Exclude | The help article describes a separate Custom Mode advanced control for unwanted musical elements. Reconfirm placement if the UI differs. | S5 |
| Artist names | Names of well-known artists or people may prevent generation. No surname exception is documented by the cited moderation page. | S4 |
| Own voice | Voices is documented as an own-voice workflow with verification, not arbitrary artist impersonation. | S7 |

## Routing choices used by this skill

These are recommendations, not vendor guarantees:

- Start a tightly specified composition in the controlled model available to the user. Explore more adventurous blends in the exploration variant when useful.
- For a controlled comparison, hold model, lyrics, source reference, and relevant UI controls steady. Use a zero-Variety setting only where this control is present and the dated documentation remains applicable.
- Try the more expensive consistency-oriented mode only after the composition earns it, and only within authorized credit use. Do not report a universal price.
- For an existing song, use an actual attached/selected source and the narrowest suitable edit workflow. A URL, title, or remembered description does not mean the audio has been inspected.
- Do not map old Weirdness, Style Influence, Audio Influence, Personas, or other controls onto v6 by analogy. Verify the particular control in current documentation/UI before recommending values. A prior-model tutorial is historical evidence, not a v6 specification.
- Multiple lead identities and backing ensembles are creative requests. Do not claim deterministic per-line voice assignment, exact harmony intervals, exact BPM/key/duration, or sample-identical preservation from text alone.

## Field discipline

**Style:** global musical identity, groove, voice hierarchy, instruments, dynamics, production.

**Lyrics:** actual sung text plus short section or local performance cues. Conventional bracket labels are useful organizational hints, but this pack does not certify a comprehensive tag grammar. Suno documents conventional section labels such as verse and chorus [S6]; it does not establish deterministic per-singer routing. Extended vocal-routing cues are this pack's soft-direction convention.

**Exclude:** concise unwanted elements, not a second contradictory arrangement. Avoid broad exclusions that remove part of the desired blend.

**Conversational edit brief:** source reference, exact target, requested change, protected elements, and success test. Do not cram the whole workflow into the Style box.

**Title and local metadata:** tracking fields outside Style. JSON keys such as `energy`, `bpm`, and `vocal_register` in a local brief are not verified Suno API parameters.

## Limits and refresh rules

The **1,000-character Style cap is inherited from the user's brief** and remains the pack's default even if the UI later permits more. No current primary source found in this verification established that this is a universal v6 limit. Use a confirmed smaller UI cap when necessary; increase the user's cap only with their instruction. Count actual final text, not an estimate. Keep Exclude and Lyrics separate; verify their limits only when needed.

Treat every date-dependent claim as a snapshot. On a new feature/version question, consult S1/S2/S3/S8. Prefer a current feature-specific help page and observed account UI over an older broad marketing announcement. Record conflicting evidence rather than silently choosing a convenient interpretation. Without browsing, say which date is known and avoid calling it current.

## Boundaries

This bundle writes and checks text. It includes no Suno connector, API client, account login, audio renderer, or publishing automation. When an authorized tool is available in the host, follow that tool's schema and permissions; never invent one.
