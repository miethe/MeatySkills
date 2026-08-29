# Visual Evidence Guide

Inherit `feature-report`'s rule and keep it strict: **never manufacture decorative proof.** The
renderer never calls a model or the network — visuals are authored, captured, or generated at
authoring time and embedded as `data:` URIs.

## Selection order

| Visual | Use when | Rule |
|---|---|---|
| Screenshot | A real UI exists | Capture live; downscale (`sips -Z 880 -s formatOptions 62`) then base64. **Redact before embedding.** |
| Inline SVG diagram | 3+ components or steps interact (feature route `diagrams[]`) | Generated from declarative nodes/edges. Deterministic. |
| Activity flowsheet | A program's shape over time matters (forward routes) | Declarative `visuals.flowsheet` — see below. |
| Two-track ladder | Parallel tracks with a "you are here" (forward routes) | Declarative `visuals.ladder` — see below. |
| Metric chart | Before/after or delivered quantities (feature route `metrics[]`) | Real counts only; omit `before` rather than inventing zero. |
| Generated illustration / wireframe | A concept needs explaining and no real UI exists | **MUST be labelled `illustration`** and record `provider`. Never presented as a screenshot. |
| No visual | Backend-only change | State why in `no_visual_reason`. |

## Signature visualisations (build these; they carried the reference report)

- **Activity flowsheet** — rows = workstreams, columns = days/weeks, cells = commit counts, with a
  three-step density ramp (`d1` = 1, `d2` = 2–3, `d3` = 4+). Its value is the *shape*: one glance
  showed the front end flatlining after day 1 while governance work ran for a week. `null`/`0` cells
  render as no-activity dots. `columns` length must equal each row's `cells` length.
- **Two-track ladder** — parallel tracks (e.g. product vs. platform) as stacked cards with a left
  severity stripe encoding `state` (`done`/`part`/`blocked`/`none`), plus an explicit `here` marker.
- **Status pills + domain chips** — state encoded in form as well as text.

## Image generation — provider is pluggable, and unresolved (design spec §5.1)

Image generation is an **optional, pluggable provider** used at authoring time, never hardcoded and
never on the render path. The skill records which provider produced each image in `media[].provider`
so a reader can audit it, and every generated image is labelled `illustration`.

There is a live, unsettled conflict about the default provider; the skill does not depend on it:

- **Repo docs say** Codex-native image generation is *parked* (`docs/project_plans/design-specs/codex-imagegen-lane.md`,
  `DEF-3`), and the documented working path is `gemini-cli`
  (`gemini -p "..." -m gemini-3.1-flash-image --yolo -o text`, the "Nano Banana" family).
- **Operator memory says** Codex gpt-5.6 has native image generation and the free-tier Gemini key
  has zero image quota — i.e. the documented path may be non-functional in practice.

**Therefore, at authoring time:** probe availability, prefer the configured provider order, and on
failure fall back to the explicit `no_visual_reason` path rather than emitting a broken or fabricated
image. Record the provider used. (Separately tracked: the `codex` skill needs image-gen added as a
capability; resolve the conflict empirically and update both `codex-imagegen-lane.md` and Operator
memory to match reality — not part of this skill.)

## Capture & accessibility rules

- Capture the hydrated final state, not a loading shell; crop to the changed surface.
- Redact tokens, customer data, private conversations, emails, internal hostnames, unrelated PII.
  A media item marked `sensitive: true` is a hard validation failure.
- Descriptive `alt` (the state, not "screenshot"); captions state what to notice.
- Each media file ≤ 8 MB; combined embedded media < 25 MB.
- Do not encode status by colour alone — keep labels (PASS, VERIFIED, RISK, DRAFT, blocked).
- Honour `prefers-reduced-motion`; keep diagram labels legible in print.
