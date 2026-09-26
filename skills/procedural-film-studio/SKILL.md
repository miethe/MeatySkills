---
name: procedural-film-studio
description: Create polished, reproducible animated documentaries, visual essays, and explanatory films from research, reports, essays, scripts, data, or other source material through code-driven animation, diagrams, simulations, typography, and deterministic rendering. Use when the requested output is a finished video and motion design / procedural animation would improve the result — the skill owns the whole path from story adaptation through final MP4, audio, captions, QA, and reproducible source. Do NOT use for requests that only need a script, storyboard, static image, slide deck, or a single one-shot generated video clip (those stop short of "the finished movie" this skill exists to deliver).
version: 1.0
app_version: "2026-09-21"
updated: 2026-09-21
---

# Procedural Film Studio

Create a finished animated film from supplied source material. The primary deliverable is the
**playable movie**, not a proposal, storyboard, screenplay, or production plan.

The skill owns: story adaptation, narration, visual direction, timed storyboard, deterministic
animation, generated visual assets when useful, audio, encoding, subtitles, visual QA, factual QA
against supplied sources, and reproducible project packaging.

## Default output

Unless otherwise requested:

- 1920×1080, 16:9, 24 fps
- 3–6 minutes when appropriate
- H.264 MP4 with AAC audio
- Captions (English SRT, embedded subtitle track when practical)
- Poster/cover image
- Chapter markers for films long enough to benefit
- Reproducible source package (see `references/output-package-spec.md`)

These are defaults, not hard constraints — change them when the material clearly benefits. Do
not ask for unspecified optional settings when sensible defaults exist; do not stop merely
because an optional production parameter is unspecified.

## Input contract

Accept any combination of: research reports, source notes, citation sets, essays, articles,
scripts, data, calculations, simulation results, figures, images, visual references, style
guidance, brand systems.

Treat supplied factual material as authoritative only to the degree its sources justify. **Never
invent findings, claims, citations, measurements, or experimental results to improve the story.**
Preserve meaningful uncertainty; if the supplied material cannot substantiate a claim, omit or
qualify it rather than smoothing it over.

## Output contract

Produce, when practical, the package below. Full tree and rationale:
`references/output-package-spec.md`.

```text
final.mp4  poster.jpg  captions.srt  README.md
script.md  storyboard.md  visual-system.md  sources.md  qa-report.md  manifest.json
src/   data/   assets/   audio/   qa/
```

Retain separate narration and music stems when practical. Do not include temporary rendered
frames in the final archive unless explicitly useful.

## Production principles

**Visuals explain.** Every major visual should communicate information, structure, causality,
scale, transformation, uncertainty, chronology, or metaphor. Do not default to decorative B-roll
where a diagram, simulation, comparison, or metaphor communicates the idea more directly.

**Code first.** Prefer deterministic programmatic animation — typography, diagrams, charts,
mathematical objects, simulations, transformations, particles, geometry, timelines, labels,
compositing, camera motion — over independent generative-video clips whenever visual continuity
matters. Model animation as a function of time where practical (`frame = render(time,
scene_state, assets, data)`).

**Generative media second.** Use generated imagery or video selectively when it adds substantial
value the material would be inefficient to construct procedurally (hero illustrations,
environments, historical/conceptual imagery, textures, visual metaphors). Never depend on
generated media for exact text, charts, labels, or factual diagrams — render those directly.

**Reproducibility.** A capable agent should be able to rerender the film from the retained source
project. Separate content, timing, scene state, renderer, assets, and generated data where
practical.

## Workflow

Full step-by-step detail for every item below, plus the rendering strategy, the
preview-before-scale rule, generated-imagery handling, and the graceful-degradation priority
order: `references/production-workflow.md`.

1. **Inspect the environment** — identify available runtime, rendering, media, TTS, and
   generation tooling; use the strongest available implementation rather than failing on an
   unavailable preferred library.
2. **Inspect the source packet** — extract the story (question, thesis, evidence, uncertainty,
   turning points). Full checklist and the narrative-arc heuristic:
   `references/scene-ledger-and-narrative.md`.
3. **Create the narration** — written for speech, timed against the target runtime.
4. **Define the visual system** — a `visual-system.md` covering palette, typography, motifs, and
   semantic visual mappings, established before the renderer.
5. **Create the scene ledger** — the film's canonical timeline. Per-scene schema:
   `references/scene-ledger-and-narrative.md`.
6. **Build reusable primitives** — timelines, transforms, typography, charts, cameras,
   transitions — rather than one-off per-scene code.
7. **Precompute data** — run expensive simulations/transforms outside the per-frame loop.
8. **Create representative frames** — sample opening/typography/data/complex-animation/reveal/
   ending before a full render; correct systemic problems first.
9. **Create audio** — narration, music, effects as separate stems; music stays subordinate to
   speech.
10. **Render a preview** — a cheaper rough cut, reviewed for pacing/sync/repetition before the
    real render.
11. **Validate computational content** — assertions on the intellectual content of computational
    scenes, not merely that the code ran.
12. **Final render** — final dimensions/frame rate, muxed with audio, captions, chapters.
13. **Media validation** — programmatic checks: decode, dimensions, frame rate, duration,
    audio/video alignment, caption/chapter bounds, no missing assets.
14. **QA contact sheets** — broad + transition-adjacent frame sampling, inspected visually.
15. **Eight review passes** — factual accuracy, reasoning, narrative, visual communication,
    graphic design, animation, pacing, visual necessity. Fix defects rather than only recording
    them.

## Quality bar

A film is not complete merely because it exists. Reject or revise obvious slideshow behavior,
random B-roll, dense presentation-style text, generic transitions, repeated composition, or
unsupported claims. Prefer one excellent visual idea over several mediocre ones. If tools are
limited, preserve priorities in this order: factual integrity, visual explanation, coherent
narrative, reproducibility, animation sophistication, decorative polish — see
`references/production-workflow.md` § Graceful degradation.

## Completion

The task is complete when: a playable final movie exists; it has passed technical/media
validation; representative frames have passed visual inspection; significant factual claims have
been checked against the supplied source material; and the reproducible source project has been
packaged. Return direct links to the movie and the source package. Do not stop at a screenplay,
storyboard, image collection, animation code, or rough cut when the environment permits
completion.

## When NOT To Use

- The request only needs a script, storyboard, or production plan with no rendered video —
  that is a writing/planning task, not this skill; produce the document directly.
- The request wants a single static image, illustration, or poster — use an image-generation
  skill/tool directly.
- The request wants a slide deck or narrated presentation — this skill explicitly avoids the
  "narrated slideshow" shape; use a presentation tool instead.
- The request is satisfied by one unedited AI-generated video clip with no continuity, diagram,
  or narration requirements — a direct video-generation call is enough; this skill's overhead
  (visual system, scene ledger, eight-pass review) is not warranted for a single clip.

## Deferred / Do Not Say

- **No bundled renderer.** This skill does not ship a `filmkit/`-style rendering library,
  preview pipeline, or contact-sheet generator. It is production *methodology* — the actual
  scene/timeline/renderer code is authored per-project against whatever runtime is available
  (step 1). Treat "the skill includes reusable renderer utilities" as false until such a library
  is actually added and referenced from here.
- **No FFmpeg/TTS/image-gen wiring.** The skill assumes the invoking environment already has (or
  can obtain) media tooling; it does not configure or vendor any of it.
- **Not for text-only outputs.** A script, storyboard, or `visual-system.md` alone is progress,
  not completion — see § Completion.

## Key References

- /Users/miethe/dev/homelab/development/MeatySkills/skills/procedural-film-studio/references/production-workflow.md
- /Users/miethe/dev/homelab/development/MeatySkills/skills/procedural-film-studio/references/scene-ledger-and-narrative.md
- /Users/miethe/dev/homelab/development/MeatySkills/skills/procedural-film-studio/references/output-package-spec.md
