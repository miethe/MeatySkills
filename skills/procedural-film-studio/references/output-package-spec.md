# Output package specification

Referenced from `SKILL.md`'s output contract. This is the fuller directory contract — it merges
the standalone production prompt's more detailed tree (`src/scenes/`, `src/lib/`, per-stem audio
paths, `qa/contact-sheet.*` + `qa/sampled-frames/`) with the skill's original, coarser one. Use
this as the canonical target; the short list in `SKILL.md` is the at-a-glance version of it.

```text
project/
├── final.mp4
├── poster.jpg
├── captions.srt
├── README.md
├── research-or-source-material/
├── sources.md
├── script.md
├── storyboard.md
├── visual-system.md
├── qa-report.md
├── manifest.json
├── src/
│   ├── render.*
│   ├── scenes/
│   └── lib/
├── data/
├── assets/
├── audio/
│   ├── narration.*
│   ├── music.*
│   └── effects/
└── qa/
    ├── contact-sheet.*
    └── sampled-frames/
```

Notes:

- Deliver this unless technically impossible. When a component genuinely cannot be produced
  (e.g. no TTS available), say so in `qa-report.md` rather than silently omitting the path —
  see `production-workflow.md` § Graceful degradation for the priority order to preserve.
- Retain narration, music, and effects as separate stems when practical (not muxed-only) so a
  later remix does not require re-rendering.
- Do not bundle unnecessary caches, temporary per-frame renders, dependencies, secrets,
  credentials, or generated build junk into the delivered package.
- The source project (`src/`, `data/`, `assets/`, `manifest.json`) should be sufficient for
  another capable agent to understand and regenerate the film without this session's context.
