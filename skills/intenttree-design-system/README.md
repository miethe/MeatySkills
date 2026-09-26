# IntentTree — Design System

> *Plan deeply. Zoom in. Execute precisely.*

IntentTree is an iPad-first **Execution Operating System** that turns a person's
intent into a living, zoomable tree of work. Big things at the top, atomic tasks
at the leaves. The system is built around two opposing impulses held in tension:

- **Plan deeply** — see the whole intent at once. Every project rolls up to its
  North Star. Cross-goal links surface shared work so you solve once and advance
  many.
- **Execute precisely** — collapse to the next atomic step. The Daily Train
  sequences exactly today's tasks. *Execute Next* is the only primary CTA in
  the entire interface.

The product blends human and agent execution. Most atomic tasks have an
*Assignment* — Human, Agent, or Hybrid — and the system gently recommends the
right one. Recommendations, never decrees.

---

## Content fundamentals

**Voice.** Calm. Operational. Verbs first. We surface status before sentiment.
"Two tasks blocked" beats "Yikes — we have a problem!". We never use exclamation
points and never use emoji confetti. Delight is restrained: a small leaf grows
on the mascot after meaningful completions; that's it.

**Vocabulary.** A controlled set of nouns that map directly to the data model.
Use these terms exactly — never substitute synonyms.

| Term | Meaning |
|---|---|
| **North Star** | The single top-level intent for a tree. One per project. |
| **Pillar** | A major branch beneath the North Star. |
| **Work Area** | A grouping inside a pillar. |
| **Atomic Task** | The leaf — a single executable unit (~5–60 min). |
| **Subtask** | A step inside an atomic task. |
| **Quick Win** | An off-tree, high-value, low-effort task. Orange. |
| **Side Quest** | An off-tree exploration that may matter later. Purple. |
| **Shared Work** | A task whose completion advances 2+ branches. |
| **Daily Train** | Today's sequenced execution timeline. |
| **Execution Mode** | Human / Agent / Hybrid assignment for a task. |
| **Shepherd** | The grounded AI assistant. Clarifies, never performs. |

**Tone for microcopy.** Recommend, don't decree:
> *Recommended: Hybrid. AI scaffolds, you refine.*

Never:
> ~~You should let AI do this!~~

**Status language.** Standardized pill copy:
- `Idle` · `In Progress` · `Ready` · `Waiting Review` · `Blocked` · `Completed`

---

## Visual foundations

**Color.** Six 9-step semantic scales. Base palette is `--it-green-*` (execution),
`--it-blue-*` (structure), `--it-gold-*` (accomplishment, used sparingly).
Status: `--it-orange-*` (warn), `--it-red-*` (error), `--it-purple-*` (agent),
`--it-teal-*` (knowledge). Surfaces stack from `bg-app` → `bg-canvas` →
`surface-base` → `surface-elevated` → `surface-glass`. Dark theme included.
**See:** `tokens/tokens.css`, `preview/colors.html`.

**Typography.** SF Pro Display / Inter system stack. Eight-step ramp with
display, headline, title, body, label, caption, micro. Headings use a tight
`-0.02em` tracking; eyebrow labels use a wide `0.10em` uppercase tracking.
**Numbers are tabular by default** — they appear everywhere (estimates, scores,
durations) and must align in tables and timelines. Mono is Berkeley Mono /
JetBrains Mono. **See:** `preview/typography.html`.

**Space, radius, shadow, motion.**
- 4-pt spacing grid: `--it-space-1` (4px) → `--it-space-12` (96px).
- Radius scale: `sm` 6, `md` 10, `lg` 14, `xl` 20, `2xl` 28, `pill` 999.
- Layered shadow stack: ambient + directional + glow. Blue glow signals an
  active focus; gold glow signals a celebration moment. Glow is rare.
- Glass blur tokens: `--it-blur-sm` 8px, `--it-blur-md` 16px, `--it-blur-lg` 24px.
- Motion is calm. Three durations (120 / 220 / 360ms), three easings
  (`ease-out`, `ease-in-out`, `ease-spring`). No bounce on routine actions.
**See:** `preview/spacing.html`.

**Iconography.** Two-tier system:
1. **Glyphs.** Single-character symbols (◎, ⊞, ▷, ⚛, ★, ⚡, ✦, ⚭) used inline in
   nav items, breadcrumbs, and pills. They read as type, not graphics.
2. **Tiles.** Square 32 / 40 / 56px rounded glyph containers
   (`.it-tile.sm/md/lg`) tinted to match the entity's domain color: blue for
   structure, green for execution, purple for agents/side-quests, gold for
   north-star, orange for quick-wins, teal for knowledge. Tiles head every
   pillar, work area, and atomic-task card.

We do **not** ship a custom icon font in v0.1. If the design needs an icon the
glyph set doesn't cover, use a placeholder tile and flag it in the TODO list —
do not invent stylistic icons that diverge from the existing set.

---

## Components

The component layer is in `tokens/components.css`. Every component below is
shown live in `preview/components.html`.

- **Button** — `.it-btn` with `primary` (green), `secondary` (blue), `ghost`,
  `danger`, `subtle`. Sizes `sm` / default / `lg`. `icon-only` square variant.
- **Pill (status)** — `.it-pill` with `idle` `progress` `ready` `warn` `blocked`
  `done`. Always preceded by a colored dot.
- **Chip (taxonomy)** — `.it-chip` with `green` `blue` `purple` `gold` `orange`.
  Used for tags like *Data Model*, *P1*, *AT-1.2.1*.
- **Tile** — `.it-tile.sm/md/lg` in six color variants. Holds a glyph.
- **Progress bar** — `.it-progress` with color modifier classes.
- **Progress ring** — `.it-ring` for compact circular progress.
- **Execution-mode segmented control** — `.it-exec` with three options
  (Human, Agent, Hybrid). The active state uses the *hybrid green* glow.
- **Quick-win pill** — `.it-qw` (orange) and **Side-quest pill** — `.it-sq`
  (purple) for off-tree work.
- **Shared-work badge** — `.it-shared`, the only component that uses the
  `⚭` glyph; signals a node that contributes to multiple branches.
- **Sidebar nav item** — `.it-nav-item` with `active` state and a left
  accent rail.
- **Search field** — `.it-search` with leading glyph and trailing `⌘K` kbd hint.
- **Avatar / divider / check / kbd** — small primitives.

**The atomic-task card** is the centerpiece composition (eyebrow → title → tags
→ effort block → subtask checklist → status pill + Execute Next). It appears
verbatim in the live UI kit.

---

## Manifest

```
README.md                       — this document
SKILL.md                        — how to use this system in a chat
CHANGELOG.md                    — version history for this skill package
LICENSE                          — MeatySkills repo license
tokens/
  tokens.css                    — every CSS variable + @font-face
  components.css                — component classes built on the tokens
preview/
  index.html                    — system landing page
  _preview.css                  — shared documentation styles
  colors.html                   — color foundations
  typography.html               — type ramp + voice samples
  spacing.html                  — grid / radius / shadow / motion
  components.html               — every component, live
  brand.html                    — logo / phrases / mascot / voice rules
ui_kits/
  app/index.html                — the IntentTree app (4 canonical screens)
assets/
  refs/                         — original view mockups (9 PNGs); design-time reference
                                  renders, not live product screenshots — see SKILL.md
                                  "Deferred / Do Not Say"
references/
  DESIGN.full.md                — original design-handoff doc (v0.1, 2026-04-30)
  UIUX_DESIGN_SPEC.full.md      — original UI/UX spec (v0.2, 2026-05-02)
```

⚠️ **Staleness note (2026-09-21):** this system was authored against IntentTree as of the spec
dates above and has not tracked the live product since. See SKILL.md's "Deferred / Do Not Say"
section for what has diverged (a large "Workspace"/agent-operations screen family and token set
this system does not cover) and what is still verified current (the base color palette).

---

## Inspiration

Linear (calm density), Things 3 (typographic clarity), Notion (compositional
discipline), Apple Reminders / Calendar on iPadOS (touch ergonomics).
What we deliberately reject: gamification badges, dashboard slop, AI hype
gradients, decorative emoji.
