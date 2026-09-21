# Production workflow — full 15-step detail

Referenced from `SKILL.md`. This is the procedural detail behind the short workflow list —
read it once per production, not once per scene.

## 1. Inspect the environment

Identify available: Python/runtime, image libraries, numerical libraries, vector/rendering
libraries, FFmpeg, fonts, speech synthesis, image generation, video generation, audio generation,
media inspection utilities.

Do not fail simply because the preferred library is unavailable. Choose the strongest available
implementation.

## 2. Inspect the source packet

See `scene-ledger-and-narrative.md` for the full story-understanding checklist and the narrative
arc heuristic. Minimally extract: central question, thesis, evidence, uncertainty,
counterarguments, important definitions, data, turning points, conclusion. Record which claims
require visual evidence.

## 3. Create the narration

Write for speech rather than prose. Prefer concise sentences, clear conceptual transitions,
varied cadence, occasional deliberate silence, a strong opening hook, minimal jargon, and
explanation before terminology where possible. Avoid narrating everything visible on screen —
narration and visuals should complement, not duplicate, one another.

Estimate speech duration and adjust the script to fit the target runtime before full rendering.
Maintain a timed narration representation.

## 4. Define the visual system

Create `visual-system.md`. Specify: palette, typography, hierarchy, background, shape language,
animation behavior, camera behavior, recurring motifs, semantic visual mappings (e.g. dots =
individual entities, lines = relationships, brightness = information, fragmentation =
uncertainty, convergence = compression, vertical motion = abstraction, horizontal motion = time),
transition language.

These mappings should stay consistent enough that the viewer learns the visual language while
watching. Do not begin the full renderer without establishing this system.

## 5. Create the scene ledger

See `scene-ledger-and-narrative.md` for the per-scene schema. The ledger is the film's canonical
timeline. Prefer one strong visual idea per scene — do not overcrowd the frame simply because
multiple elements are available.

## 6. Build reusable primitives

Prefer common abstractions for: timelines, interpolation, easing, transforms, typography, paths,
charts, image layers, particles, masks, cameras, transitions, compositing. Do not duplicate scene
infrastructure unnecessarily — separate content, scene state, visual design, timing, and
rendering so revisions do not require rewriting the entire film.

## 7. Precompute data

Run expensive simulations, transforms, model calculations, dataset processing, and image analysis
outside the per-frame rendering loop where possible. Save deterministic intermediates.

## 8. Create representative frames

Before a full render, inspect representative outputs from several visual modes. At minimum
sample: opening, a typography-heavy scene, a diagram/data scene, a complex animation, a major
reveal, the ending. Evaluate composition, legibility, visual consistency, animation quality,
information density, color, typography, margins, hierarchy. Correct systemic visual problems
before full rendering.

## 9. Create audio

Generate or acquire narration, music, and optional effects. Keep stems separate. If multiple
speech systems are available, prefer the highest-quality appropriate voice; if only local/basic
TTS is available, continue rather than abandoning the film. Create music only when it improves
the experience — it must remain subordinate to speech and support pacing without competing with
narration. Prefer restrained procedural, generated, licensed, or otherwise usable music. Normalize
and mix intentionally; avoid clipping.

## 10. Render a preview

Create a computationally cheaper preview before final render whenever doing so meaningfully
reduces iteration cost. Review the entire preview for: narrative coherence, dead time, rushed
sections, visual repetition, awkward transitions, text duration, narration synchronization, music
balance, scene duration. Revise the timeline when necessary — do not treat the first successful
render as the finished film.

## 11. Validate computational content

Create assertions around important quantitative or logical claims, e.g.:

```text
assert reconstruction_error == 0
assert observed_count == expected_count
assert abs(displayed_value - computed_value) < tolerance
assert frame_count == expected_frame_count
```

A successful program exit is not proof that the displayed argument is correct. If the film
visualizes an experiment, the displayed result must be generated from or verified against the
experiment.

## 12. Final render

Render at final dimensions and frame rate. Encode with FFmpeg or an equivalent deterministic
pipeline. Mux: video, narration, music, effects, captions, chapters when applicable.

## 13. Media validation

Programmatically inspect the result. Verify: file decodes, expected dimensions, expected frame
rate, reasonable duration, audio exists, audio/video durations align, captions remain within
timeline, expected chapter metadata exists, no required assets are missing.

## 14. Generate QA contact sheets

Sample the timeline broadly and generate contact sheets containing representative frames; also
sample frames around scene transitions and, for difficult scenes, inspect multiple nearby frames
rather than a single still. Inspect visually for: clipping, overlap, blank/corrupted frames, poor
hierarchy, unreadable type, inconsistent palette, accidental generated text, awkward compositions,
visual repetition, inconsistent margins, abrupt palette changes, visual monotony.

## 15. Run eight review passes

Review separately, and fix material defects rather than merely recording them in the QA report:

1. **Factual accuracy** — are claims supported? Are uncertainty and limitations represented
   accurately?
2. **Strength of reasoning** — does the argument follow from the evidence? Does the film imply
   more than the investigation established?
3. **Narrative structure** — does the film have momentum? Are turning points clear?
4. **Visual communication** — do the visuals explain the concepts? Could a stronger visual
   replace any decorative sequence?
5. **Graphic-design quality** — are typography, hierarchy, spacing, alignment, palette, and
   composition professional?
6. **Animation quality** — does motion feel intentional? Are transitions motivated? Are easing
   and timing coherent?
7. **Pacing** — are important ideas given enough time? Does anything overstay its welcome?
8. **Visual necessity** — for every major sequence, ask: *what does this visual communicate that
   the narration alone does not?* If the answer is "nothing," redesign or remove it.

## Rendering strategy

Use a scene-oriented renderer. Conceptually:

```python
frame = scene.render(
    time=local_time,
    progress=normalized_time,
    context=context,
)
```

Prefer resolution-independent coordinates internally. Centralize colors, type scale, margins,
animation curves, frame dimensions, and frame rate rather than distributing these constants
arbitrarily throughout scene code.

## Preview-before-scale rule

For expensive renders: (1) validate individual stills, (2) validate short scene clips, (3) render
a lower-cost rough cut, (4) inspect, (5) render final. Never discover obvious global layout
problems only after rendering thousands of final-resolution frames if a cheaper validation pass
could have found them.

## Generated imagery rules

Never rely on generated imagery to render exact text — add typography in the deterministic
renderer. When image generation is used: retain the source asset, record its intended scene,
inspect it before animation, crop intentionally, avoid stretching, and use animation that fits the
composition. Treat generated video as a scene asset rather than as the architecture of the entire
movie unless the request specifically calls for that style.

## Factual integrity

The film must not become more certain than its sources. Clearly distinguish observations,
calculations, hypotheses, interpretations, and unknowns. When an investigation failed, the film
may end with that failure — narrative satisfaction does not justify false closure.

## Quality threshold

A film is not complete merely because it exists. Reject or revise obvious: slideshow behavior,
random B-roll, dense presentation-style text, generic transitions, repeated composition,
inconsistent typography, unnecessary visual effects, poor pacing, unsupported claims. Prefer one
excellent visual idea over several mediocre ones.

## Graceful degradation

If tools are limited, preserve priorities in this order: factual integrity, visual explanation,
coherent narrative, reproducibility, animation sophistication, decorative polish. A simple,
excellent procedural film is preferable to a visually ambitious but incoherent one.
