---
name: intenttree-design-system
description: >-
  Reference design system for building IntentTree screens, slides, or marketing surfaces —
  color/type/spacing tokens, component classes, layout patterns, and copy voice rules. Use when
  designing or reviewing an IntentTree UI mockup, screen, or brand surface. Triggers: "IntentTree
  design system", "design for IntentTree", "IntentTree tokens", "IntentTree components", "IntentTree
  screen mockup". Captures the system as of 2026-05 (v0.1/v0.2 spec) — see Deferred / Do Not Say for
  what has since diverged from the live product; do NOT use this as a guide to the live IntentTree
  app's current screen inventory.
version: 1.0
app_version: "2026-09-21"
updated: 2026-09-21
---

# IntentTree Design System — Skill Guide

This file tells you (the agent) how to design *for* IntentTree. Read it before
making any IntentTree screen, slide, or marketing surface.

## When To Use

Use this skill when:
- Designing a new IntentTree screen, component, or marketing/brand surface
- Reviewing an existing IntentTree mockup or PR for adherence to the visual language
- Answering "what color/token/component do I use for X" in an IntentTree context

## When NOT To Use

Do NOT use this skill for:
- Determining what screens currently exist in the live IntentTree product, or what its current
  component inventory is — this system predates a significant product expansion (see Deferred /
  Do Not Say). Read the live repo (`/Users/miethe/dev/homelab/development/intenttree/web/src/`)
  instead.
- General design-system authoring unrelated to IntentTree — use `design-system-patterns` or
  `frontend-design` instead.
- Implementing the actual IntentTree frontend code — this skill governs visual/interaction rules,
  not React/TypeScript implementation; work in the `intenttree` repo directly for that.

## What IntentTree is

iPad-first execution operating system. The user's intent becomes a tree:
North Star → Pillars → Work Areas → Atomic Tasks → Subtasks. The system
sequences today's atomic tasks into a *Daily Train*, with execution mode
(Human / Agent / Hybrid) recommended per task.

## Where everything lives

- **Tokens** — `tokens/tokens.css` and `tokens/components.css`.
  Always link both in this order; `components.css` depends on the variables.
- **System docs** — every page in `preview/` is a live render of one
  foundation or component family.
- **App reference** — `ui_kits/app/index.html` shows the four canonical
  screens (Project Map, Pillar, Atomic Task, Daily Train) composed from the
  system. Use it as the source of truth for layout patterns *within those
  four screens* — see Deferred / Do Not Say for what it does not cover.
- **Reference mockups** — `assets/refs/*.png` are the original view mockups
  (map view, pillar view, day view, atomic task, horizontal flow, horizontal
  tree overview, mid-task view, vertical task tree, work-package view) this
  system was authored against. Consult them for layout intent when a
  `preview/` page or `ui_kits/` doesn't cover a case.
- **Design history** — `references/DESIGN.full.md` and
  `references/UIUX_DESIGN_SPEC.full.md` are the original design-handoff
  documents (v0.1/v0.2, 2026-04/2026-05). Background and rationale only —
  not a live spec.

## The seven non-negotiables

1. **Calm density.** Linear-grade, not dashboard-grade. White space is content.
   If a screen feels busy, remove — never recolor or boldface — until it isn't.
2. **One primary CTA per surface.** The green *Execute Next* is the only
   primary button on any atomic-task screen. Everything else is secondary,
   ghost, or subtle.
3. **Tabular numerics, always.** Estimates, scores, durations, percentages.
   Use the `font-variant-numeric: tabular-nums` already baked into the type
   ramp; do not override it.
4. **Status before sentiment.** Microcopy leads with the operational fact.
   "2 blocked", "On Track", "Waiting Review" — not "Uh oh!" or "Great job!"
5. **Glow is rare.** The blue glow (`--it-shadow-glow-blue`) marks the *one*
   active focus on a screen. The gold glow marks a celebration. If you find
   yourself adding a third glow, you're doing it wrong.
6. **Restrained delight.** No XP bars, levels, streaks, confetti, or emoji
   walls. The mascot leaf and a single sparkle on completion are the entire
   delight budget.
7. **Recommend, don't decree.** AI surfaces use the word *Recommended:* and
   always show a runner-up. The user is in command.

## Color usage rules of thumb

- **Green** = execution and forward motion. Primary buttons. Completed states.
  The mascot. The "Ready" pill.
- **Blue** = structure, hierarchy, focus. Pillar tiles. Active focus glow.
  Breadcrumb current crumb.
- **Purple** = agents and side quests. Anything autonomous or off-tree.
- **Gold** = north-star, accomplishment, rare celebration. Never decoration.
- **Orange** = quick-wins (off-tree, high-value, low-effort) and `warn` status.
- **Teal** = knowledge / context / memory.
- **Red** = errors and `blocked` only. Never used for emphasis.

When in doubt, use a neutral surface and let one accent color do the work.

Verified 2026-09-21 against the live `intenttree` repo's `web/src/styles/tokens.css`: the base
palette hex values above are still current (unchanged since this system was authored). What is
NOT current is the token *set* — see Deferred / Do Not Say.

## Layout patterns

- **Three-column app shell** is the default: 220 px sidebar, fluid main,
  optional 280 px right inspector. The shell, top bar, and right panel all
  use `--it-surface-glass` with `--it-blur-md` so they read as floating
  glass over the canvas.
- **The Project Map** is a 7-column branch grid sandwiched between two
  glass side-panels (Quick Wins on the left, Side Quests on the right).
  The North Star headline sits centered above; the Shared-Work pill sits
  centered below.
- **Pillar pages** are a hero card on top (tile + title + chip + progress +
  status pill) followed by a list of work-area rows. Rows use a 6-column
  grid: `tile · name+desc · progress · status · qw-chips · chevron`.
- **Daily Train** is a horizontal swimlane timeline with one lane per
  pillar/lane. The active task is the only task card with the blue glow.
  Agent-run tasks use the purple-tinted card variant.

## Typography do/don't

- Headings get `letter-spacing: -0.02em`. Body is loose tracking.
- Eyebrows: 10-11 px, `text-transform: uppercase`, `letter-spacing: 0.10em`,
  `--it-text-tertiary` color.
- Body copy: 13-14 px, line-height 1.5. Never below 12 px in product.
- Use the type tokens (`--it-text-base`, `--it-text-md`, etc.) — don't
  hard-code px sizes outside the system.

## When you don't have an asset

Use a placeholder tile (`.it-tile`) with a glyph. Flag it in a TODO comment.
Do not invent stylistic icons or generate SVG illustrations from scratch —
the system is intentionally typographic and glyph-based.

## Tone and copy starters

- Empty states: *"Nothing here yet. Add your first {noun} to get started."*
- AI suggestions: *"Recommended: {choice}. {one-line reason}."*
- Confirmations: *"Marked complete."* — not *"Yay! You did it!"*
- Blockers: *"Resolve {dependency} to continue."*
- Today header: *"Your execution train for today."*

## Building a new screen — checklist

1. Link both token files.
2. Drop the three-column shell. Decide if you need the right inspector.
3. Sidebar gets the brand lockup, search, nav items, and the user card.
4. Top bar gets a breadcrumb on the left, a status pill + secondary buttons +
   a kebab on the right. No primary button here unless it's *Execute Next*.
5. Compose the body from existing components. If you're reaching for a new
   component, first ask whether an existing one (likely `.it-tile` or
   `.it-pill`) already covers it.
6. Verify: tabular numerics, one glow max, no exclamation points, status
   before sentiment, one primary CTA.
7. **If the screen is part of the "Workspace" / agent-operations surface**
   (dashboards, mission control, run/signal boards, cross-project views —
   see Deferred / Do Not Say), this system does not yet cover it. Check the
   live `intenttree` repo for the current pattern rather than inventing one
   from the four-screen model here.

## Deferred / Do Not Say

This system captures IntentTree's design language **as of 2026-05-02** (spec v0.2 / DESIGN.md
v0.1). It has NOT been kept in sync with the live product. Verified 2026-09-21 by diffing this
skill's `tokens/tokens.css` and `tokens/components.css` against the live repo's
`/Users/miethe/dev/homelab/development/intenttree/web/src/styles/{tokens,components}.css`:

- **Base palette is current.** The green/blue/purple/gold/orange/teal/red hex scales are
  byte-identical to the live tokens file — the "Color usage rules of thumb" above are safe to use.
- **The token set has grown.** The live `tokens.css` (493 lines vs. this system's 345) adds, and
  this system does NOT cover: a `--it-text-strong` primitive, a `--it-cta-success-*` semantic CTA
  layer, an entire "Workspace Dashboard Canvas" token family (`--it-canvas-*`, `--it-pane-*` —
  spec §7.4: pane chrome, drag/resize/lock/conflict/approval states, focus rings), a
  reduced-motion override block, and an `.it-scroll-owner` layout utility class.
- **`components.css` has grown substantially.** The live file is 734 lines vs. this system's 453
  — a net ~283 lines of added component rules (only 2 removed), almost entirely new "Workspace
  Dashboard" pane/canvas component classes not present here.
- **The "four canonical screens" named above (Project Map, Pillar, Atomic Task, Daily Train) still
  exist** in the live app (`Map.tsx`, `Pillar.tsx`, `Task.tsx`, `Today.tsx`) and this system's
  layout guidance for them is not known to be wrong. But the live product has since grown roughly
  25 additional screens this system says nothing about: an agent/mission-control surface
  (`AgentBoard`, `MissionControl`, `SignalBoard`, `RunLabScreen`, `RunLabCampaignScreen`), a
  "Workspace" surface (`WorkspaceDashboardScreen`, `WorkspaceCommandCenter`, `WorkspaceReview`,
  `WorkspaceRuns`, `WorkspaceMap`, `WorkspaceCarousel`, `SharedCanvas`), and a cross-project/home
  family (`CrossProjectHome`, `CrossProjectInbox`, `HomeDailyBoardScreen`, `HomeDoctrinesScreen`,
  `HomeLedgersScreen`, `HomeModelsScreen`, `HomeModulesScreen`, `HomeServicesScreen`).
- **Do not present the "four canonical screens" claim, or `ui_kits/app/index.html`, as a complete
  picture of the current app.** They are a correct-but-partial slice frozen at authoring time.
- **A refresh is filed as a tracker node, not done here** — see the report accompanying this
  ingestion for the node id. This skill's job was conformance + honest staleness disclosure, not a
  redesign; that needs the live product and Nick.
- The nine `assets/refs/*.png` mockups are **not referenced by any product code** — they are
  design-time reference renders, not live screenshots. Treat them as illustrative, not current.

## Key References

- /Users/miethe/dev/homelab/development/MeatySkills/skills/intenttree-design-system/README.md
- /Users/miethe/dev/homelab/development/MeatySkills/skills/intenttree-design-system/tokens/tokens.css
- /Users/miethe/dev/homelab/development/MeatySkills/skills/intenttree-design-system/tokens/components.css
- /Users/miethe/dev/homelab/development/MeatySkills/skills/intenttree-design-system/preview/index.html
- /Users/miethe/dev/homelab/development/MeatySkills/skills/intenttree-design-system/ui_kits/app/index.html
- /Users/miethe/dev/homelab/development/MeatySkills/skills/intenttree-design-system/references/DESIGN.full.md
- /Users/miethe/dev/homelab/development/MeatySkills/skills/intenttree-design-system/references/UIUX_DESIGN_SPEC.full.md
