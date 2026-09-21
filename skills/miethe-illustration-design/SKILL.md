---
name: miethe-illustration-design
description: >-
  Illustration style guide, canon, and prompt-scaffolding router for Nick Miethe's personal
  family illustration system — the Miethe Illustration Constitution and its ten named
  dialects (Rivermind Lullaby, Blue Ridge Campfire Quilt, Quiet Kyoto Playbook, Maker
  Constellation, Montessori Meadow Cut-Paper, Mosaic Story Atlas, Lenslight Field Journal,
  Piano Rain Geometry, Wonder Workshop Toymaker, Hearthlight Future Garden). Use when asked
  to write or refine an image-generation prompt for a Miethe family children's book, story
  spread, poster, app mockup, educational card, keepsake, or family illustration; when asked
  to pick or blend an illustration style/dialect for the Miethe family canon; or when asked
  about the Miethe family character bible, canon cast, or illustration constitution. Triggers:
  "Miethe illustration", "family illustration style", "which dialect", "style guide for
  [family/book/poster]", "Rivermind Lullaby", "Blue Ridge Campfire Quilt", "Quiet Kyoto",
  "Maker Constellation", "Montessori Meadow", "Mosaic Story Atlas", "Lenslight Field
  Journal", "Piano Rain Geometry", "Wonder Workshop Toymaker", "Hearthlight Future Garden",
  "illustration constitution", "character bible", "canon cast", "Nick/Wife/Peyton/Parker/
  Penelope illustration". Do NOT use for: generic/non-family image generation (use the
  image-generation tool directly), a different person's/brand's illustration system, or
  actually rendering the image (this skill only produces the style-selection decision and
  the prompt — it never calls an image model itself).
version: 1.0
app_version: "2026-09-21"
updated: 2026-09-21
---

# Miethe Illustration Design Skill

This is Nick Miethe's personal, family-specific illustration canon: one shared "constitution"
(the invariant visual soul) plus ten named dialects, each a distinct visual grammar for a
different emotional job. This skill's job is to get an agent to the **one right dialect**
fast, tell it exactly what to load and in what order, then hand it a ready prompt scaffold —
never to make the agent read all ten style guides to decide.

## When To Use

Use this skill when asked to:
- write or refine an image-generation prompt for Miethe-family media (book, spread, poster,
  app mockup, educational card, keepsake, wall art, family journal)
- choose (or blend) an illustration dialect for a given emotional/narrative job
- answer a question about the Miethe Illustration Constitution, the canonical family cast,
  or a specific dialect's rules
- invent a new derivative dialect that must still read as constitutionally Miethe

## When NOT To Use

Do NOT use this skill for:
- generic, non-family, or client-facing illustration work — use the image-generation tool
  (e.g. `codex` / `image_gen.imagegen`, or `nano-banana`) directly with your own prompt
- someone else's personal brand, family, or illustration canon — this system is specific to
  Nick Miethe's family and is not a general-purpose illustration style library
- actually generating the image — this skill produces the dialect choice and the prompt
  text only; hand the result to an image-generation skill/tool to render it
- generic children's-book-illustration advice unrelated to this specific constitution — that
  is out of scope for this router

## Overview

The system is two layers:

1. **The Constitution** (`references/constitution/`) — the invariant layer that applies
   ACROSS every dialect: the canonical family cast, non-negotiable tone (emotionally safe,
   child-honoring, warm, specific, "beautiful but useful"), shared visual motifs, color/light
   logic, typography voice, and anti-patterns. Every dialect below is a *dialect of* the
   constitution, never a self-sufficient style on its own — treating a style guide in
   isolation, without the constitution's non-negotiables, is the most common way this system
   gets used wrong.
2. **Ten named dialects** (`references/styles/NN_Name/`) — each a distinct visual grammar
   (motifs, materials, palette, composition rules) tuned to one emotional/narrative job. A
   dialect never overrides the constitution; it specializes it.

Canon constraints sit alongside, not inside, the dialects: `references/canon/` holds the
character bible (per-character visual cues and props) and the canon-vs-archive rule (see
§ Canon Constraints below) — these bind on **every** dialect, not just one.

## Style Selection — read this table, not all ten guides

Match the request against "requester language" below, then load **only** that dialect's
`STYLE_GUIDE.md` + `style_spec.yaml`. Blend candidates are listed for when a request wants two
dialects merged (constitution stays dominant per § Blending Rules).

| # | Dialect | Requester language / trigger words | Emotional job | Good blend partners |
|---|---|---|---|---|
| 01 | **Rivermind Lullaby** | bedtime, calm down, sleep, lullaby, reassurance, "mind as a river", lanterns, moonlit | Bedtime calm, emotional literacy, gentle transition to sleep | 08, 02 |
| 02 | **Blue Ridge Campfire Quilt** | camping, mountains, Appalachian/Blue Ridge/NC, quilt, campfire, family road trip, seasonal wall art | Regional memory, outdoor family adventure, generational warmth | 07, 01, 06 |
| 03 | **Quiet Kyoto Playbook** | Japanese learning, vocabulary card, mindful/quiet study, seasonal ritual, torii/temple | Mindful learning-as-ritual, restraint, seasonality | 05, 08 |
| 04 | **Maker Constellation** | STEM, systems explainer, blueprint, constellation/cosmos, innovation poster, project branding | Making intelligence/systems feel warm and shareable | 09, 07, 10 |
| 05 | **Montessori Meadow Cut-Paper** | toddler, early learning, shapes, nature concepts, activity card, gentle app mini-game | Tactile early-childhood discovery, low cognitive load | 03, 07 |
| 06 | **Mosaic Story Atlas** | travel journal, place-based story, memory map, culture/coastal-town keepsake | Turning travel/place experience into durable shared story | 07, 02, 10 |
| 07 | **Lenslight Field Journal** | field journal, nature graphics, photography, observation prompt, specimen/field-guide | Noticing-as-craft, photography, everyday-becomes-extraordinary | 02, 05, 04 |
| 08 | **Piano Rain Geometry** | music learning, piano, rain, waveform, poetic/abstract, emotion mapping, meditative | Translating feeling into rhythm/pattern without losing warmth | 01, 03, 04 |
| 09 | **Wonder Workshop Toymaker** | DIY project, maker kit, toy, workbench, gears/robots, craft app, tinkering | Play and invention as family culture, buildable objects | 04, 05, 10 |
| 10 | **Hearthlight Future Garden** | future-of-home, sustainability, solarpunk, AI companion, optimistic-tech vision | Hopeful, humane, biophilic technology futures | 04, 06, 09 |

**Decision rule:** if the request names an emotional job or medium that appears in exactly one
row's "requester language" or "emotional job" column, use that dialect. If it plausibly matches
two rows, pick the **primary** dialect that best matches the stated medium/goal and offer the
second as an optional blend partner (never blend more than two — see § Blending Rules). If
nothing matches well, say so and propose a new derivative per § Deriving a New Dialect rather
than forcing a poor fit.

## Load Order

For a single-dialect request:
1. `references/constitution/MIETHE_ILLUSTRATION_CONSTITUTION.md` — the non-negotiables and
   shared visual primitives (read this even if you think you remember it; it is short).
2. The chosen dialect's `references/styles/NN_Name/STYLE_GUIDE.md`.
3. The chosen dialect's `references/styles/NN_Name/style_spec.yaml` (machine-readable form —
   use this to build the actual prompt fields; the STYLE_GUIDE.md is for human/agent judgment).
4. `references/templates/PROMPT_PATTERNS.md` — pick the pattern matching the requested medium.

For a blend, hybrid, or net-new derivative, also read:
- `references/canon/DEVELOPMENT_CONTEXT.md` — why this system exists, its emotional north star
- `references/canon/INFLUENCES_AND_DERIVATIONS.md` — influence families per dialect (material
  language and compositional logic only — never direct imitation, see that file's own rule)
- `references/canon/CHARACTER_BIBLE.md` — required for any piece featuring the family (see
  § Canon Constraints)
- `references/canon/CANON_NOTES.md` — canon-vs-archive resolution rule

Never read all ten `STYLE_GUIDE.md` files to make a selection — the table above exists so you
don't have to.

## Canon Constraints — bind on every dialect

`references/canon/CHARACTER_BIBLE.md` and `references/canon/CANON_NOTES.md` are **not** style
choices; they are constraints that apply regardless of which dialect is selected:

- **Canonical cast**: Nick, Wife/Mom, Peyton (eldest), Parker (middle), Penelope (youngest).
  Each character has fixed visual cues and typical props in `CHARACTER_BIBLE.md` — use them
  when the family appears, don't invent new physical descriptions per piece.
- **Dogs are excluded by default.** Include a dog only if explicitly requested.
- **Archive vs. canon**: this pack's asset history includes older exploratory images that
  often omit Wife/Mom and include dogs. Per `CANON_NOTES.md`, those are historical mood
  references only — never treat them as current canon. When an archive image conflicts with
  canon: keep the mood/structural lesson, update the cast to current canon, remove dogs unless
  the brief says otherwise, and preserve the chosen dialect.

## Blending Rules

Per the constitution: one primary dialect + at most one secondary dialect, and the
constitution stays dominant over both. Named example blends (constitution §8):
Rivermind + Piano Rain = bedtime music-poetry · Quiet Kyoto + Montessori Meadow = calm language
learning for young kids · Maker Constellation + Wonder Workshop = hands-on STEM play ·
Lenslight + Mosaic Story Atlas = travel journaling and memory capture.

## Deriving a New Dialect

If no existing dialect fits, `references/templates/PROMPT_PATTERNS.md` has an "Experimental
derivative pattern": state which 2-3 existing dialects the new one descends from, and retain
the constitution's tone, motifs, and child-safe emotional logic. A new derivative is never
added back into this skill's ten without Nick's explicit sign-off — do not silently promote an
experiment to dialect status.

## Prompt Assembly

Use `references/templates/PROMPT_PATTERNS.md` for the medium-specific scaffold (book cover,
interior spread, app screen, poster/infographic, experimental derivative) and
`references/templates/ARTIFACT_RECIPES.md` for medium-specific composition guidance (what to
keep to one concept per card, which dialects suit which recipe, etc.). Every assembled prompt
must, at minimum: name the primary dialect, feature the canonical cast (or explicitly justify
omitting a member), exclude dogs unless requested, and state the emotional/narrative goal.

## Guardrails

- **This skill never renders images.** It produces a dialect decision and prompt text; pass
  that prompt to an image-generation tool/skill to actually render it.
- **Never silently drop the constitution.** A dialect's STYLE_GUIDE.md reads as self-sufficient
  (it repeats family/composition guidance for convenience) but the constitution's
  non-negotiables and anti-patterns always apply on top of it.
- **Never invent new canon.** Cast description, cast membership, and the dogs-excluded default
  come from `references/canon/`, not from the current conversation's assumptions.

## Deferred / Do Not Say

- This skill does **not** generate, render, or call any image model. Do not tell a user "I
  generated the image" from this skill alone — it only produces the dialect choice and prompt.
- `references/manifests/asset_index.json` / `asset_index.csv` / `design_manifest.json` were
  regenerated during this skill's restructure (2026-09-21) to reflect the new
  `references/`/`assets/` paths below, and were spot-checked to all resolve on disk at that
  time. They are a convenience index, not a live-verified manifest — if a future edit adds or
  moves a file under this skill without updating them, they will drift stale. Do not present
  them as guaranteed current beyond that date.
- The original pack's root `README.md` / `AGENTS.md` / `CLAUDE.md` progressive-disclosure
  guidance (Level 0/1/2, "minimal/standard/deep" context modes) has been folded into this
  file's § Load Order and is **not** preserved as separate files — do not look for them under
  this skill's directory.
- This is Nick Miethe's **personal** family canon (a specific five-person cast with a specific
  visual history), not a general-purpose illustration style library, a licensable brand
  system, or a generic "family illustration" starter kit for other users/products.

## Key References

- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/references/constitution/MIETHE_ILLUSTRATION_CONSTITUTION.md — the shared non-negotiables, read before any dialect
- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/references/constitution/constitution_spec.yaml — machine-readable constitution fields
- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/references/styles/ — the ten dialect folders (`STYLE_GUIDE.md` + `style_spec.yaml` each); see the Style Selection table above for which one to load
- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/references/canon/CHARACTER_BIBLE.md — per-character visual cues and props, binding on every dialect
- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/references/canon/CANON_NOTES.md — canon-vs-archive resolution rule
- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/references/canon/DEVELOPMENT_CONTEXT.md — why this system exists; load for blends/derivatives
- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/references/canon/INFLUENCES_AND_DERIVATIONS.md — influence families per dialect; load for blends/derivatives
- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/references/templates/PROMPT_PATTERNS.md — medium-specific prompt scaffolds
- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/references/templates/ARTIFACT_RECIPES.md — medium-specific composition recipes
- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/references/manifests/design_manifest.json — full pack manifest (paths updated for this skill's layout)
- /Users/miethe/dev/homelab/development/MeatySkills/skills/miethe-illustration-design/assets/ — style boards, constitution infographics, and example visual-story renders (organized by `constitution/`, `styles/NN_Name/`, `visual-stories/`)
