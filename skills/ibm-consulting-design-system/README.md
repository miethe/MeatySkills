# IBM Consulting Design System

A design kit for designing interfaces, decks, battlecards, and marketing assets on behalf of **IBM Consulting** — IBM's global professional-services arm (and its business-unit partners like BoxBoat). The system is rooted in **IBM's Carbon Design System** and the **IBM Plex** type family — both of which IBM publishes as open source — layered with the marketing-side conventions seen in IBM Consulting's internal sales decks and battlecards.

---

## Sources given

All material was extracted from files in `uploads/`:

| File | Status | Notes |
|---|---|---|
| `uploads/Offering_battlecards.pptx` | ✅ read | 4 battlecards for IBM Consulting's hybrid-cloud offerings. Full IBM template: 5 slide masters, 273 layouts, 31 media assets. Theme colors + fonts extracted. |
| `uploads/2026 IBM Consulting Strategy & Capabilities Deck v26.02-1.pptx` | ⚠️ **not in project** | Referenced in the brief but not uploaded. Flag to user. |
| `uploads/2026 IBM Consulting Strategy & Capabilities Deck v26.02-2.pptx` | ⚠️ **not in project** | Referenced in the brief but not uploaded. Flag to user. |
| `uploads/BoxBoat GTM-26-v1.pptx` | ⚠️ **not in project** | Referenced in the brief but not uploaded. Flag to user. |

Only the battlecards deck was actually present in the filesystem. Everything below is derived from that deck **plus** publicly-documented IBM brand conventions (Carbon, IBM Plex, the 2022 "IBM Consulting" sub-brand refresh). If the missing decks show up, the system should be revisited — they likely contain additional layouts and cover-slide compositions.

### The battlecards themselves

Four one-pagers, one per offering, each pitched at $500K–$10M+ engagements:

1. **Automation Transformation** — Red Hat Ansible + HashiCorp Terraform "Everything-as-Code"
2. **Cloud-Native Foundations (Day-0)** — OpenShift/Kubernetes landing zones
3. **Modern & Agentic SDLC (DevEx)** — GitHub Enterprise + AI copilots + governed agents
4. **VMware Estate Transformation** — RHOV migration, Broadcom escape-hatch

All four follow the same rigid template: Objectives → Activities In-Scope → Tools → 3-Phase Offer Structure → Value Levers → Why IBM / BoxBoat → Deliverables → Timelines → Commercials.

---

## Brand context

**IBM Consulting** is the advisory + services arm of IBM Corp. Within it sit specialty practices — **BoxBoat** (cloud-native / Kubernetes), **Nordcloud**, etc. — which are acquired companies rebranded as IBM Consulting sub-units. They go to market together, so materials co-brand: the big blue **IBM®** logo anchored at top, supporting partner logos (Red Hat, HashiCorp, GitHub, NVIDIA) called out in body copy.

Target audience for these assets is enterprise buyers: CIOs, CTOs, VPs of Platform Engineering at Fortune-500s. Tone is **precise, evidence-backed, and confident without being flashy** — the opposite of startup-marketing energy.

---

## Index of this design system

Root manifest:

| File | Purpose |
|---|---|
| `README.md` | **This file.** Brand context, content + visual foundations, iconography. |
| `SKILL.md` | Claude Code skill manifest — makes this kit portable. |
| `colors_and_type.css` | All design tokens: colors, type scale, spacing, radii, shadows, motion. |
| `assets/logos/` | IBM master-brand logos (blue, white, black, dark-blue variants). |
| `assets/icons/` | Battlecard-style line icons (7 @ 112px) extracted from the deck. |
| `assets/backgrounds/` | Blue gradient washes + white sculptural "IBM" brand renders. |
| `assets/ui/` | UI fragments pulled from the deck (monitor bezel, gradient rules). |
| `preview/*.html` | Individual cards shown in the Design System tab — tokens, specimens, components. |
| `ui_kits/ibm-consulting-web/` | React recreation of IBM Consulting's site patterns. |
| `slides/` | Battlecard + title + section-header slide templates (16:9, 1280×720). |

---

## CONTENT FUNDAMENTALS

IBM Consulting copy is **corporate, precise, and credentialed**. It reads like a McKinsey deck, not a SaaS landing page. A few durable rules:

### Voice & tone
- **Third-person institutional.** "IBM Consulting delivers…", "BoxBoat's engineers build…". First-person plural ("we") appears only in "Why IBM Consulting" sections and always paired with concrete credentials ("Largest Red Hat and HashiCorp certified practice within IBM Consulting").
- **Second-person ("you") is rare** and only shows up in client-facing CTAs ("Let's work together").
- **No rhetorical flourish.** No "imagine if…", no "what if we told you…", no "the future is…". Every sentence is a claim backed by a number or a proper noun.
- **Specific technology names are the hero.** Red Hat Ansible Automation Platform, HashiCorp Terraform / OpenTofu, Red Hat ACS (StackRox), GitHub Copilot. Spell products out in full on first mention; partner brands earn the full name.

### Casing
- **Sentence case for all headings** — "Cloud-Native Foundations (Day-0)", not "CLOUD-NATIVE FOUNDATIONS".
- **Capitalize proper nouns aggressively**, including internal IBM terms: "Everything-as-Code", "Agentic SDLC", "Day-0", "Shadow AI Crisis", "Jumpstart Investment". These are positioned as trademarkable concepts.
- **ALL CAPS only for abbreviations** (DORA, NIST, SSDF, SOC2, CIS, SBOM, SLSA, RHOV).
- **Kebab-case compound concepts**: "policy-as-code", "Everything-as-Code", "shift-left security", "lift-and-modernize".

### Number discipline
Every value claim is quantified:

- "2.5X faster software delivery with 40% fewer release failures"
- "Reduce operational toil by ~50%"
- "30–50% TCO reduction on virtualization"
- "1:1000+ admin-to-container ratio"

Ranges (`30–50%`) are preferred over single numbers — IBM Consulting is giving itself headroom for variability across engagements. The **en-dash `–`** is used for ranges, not hyphens.

### Punctuation quirks
- **Em-dashes** (`—`) set off value props: "Engineering-first DNA — we build and code alongside clients, not just advise".
- **Parenthetical asides** for technical clarifications: "Red Hat OpenShift (or EKS/AKS with opinionated governance)".
- **Bullet lists with no terminal period**, each bullet a compressed fragment — never a full sentence.
- Serial comma (Oxford) used.

### Emoji usage
**None.** Zero emoji in IBM Consulting materials, ever. Not in slides, not in battlecards, not in CTA copy. Emoji would read as consumer and undermine the enterprise positioning. Unicode decorations (✓ ★ →) also absent; the deck uses monochrome line icons (see ICONOGRAPHY) for everything visual.

### Examples (lifted from the source deck)

> **Objective:** Eliminate manual, error-prone infrastructure and configuration management.
>
> **Why IBM Consulting / BoxBoat:** Largest Red Hat and HashiCorp certified practice within IBM Consulting. Engineering-first DNA — we build and code alongside clients, not just advise. Natural pull-through to Cloud-Native Foundations, SDLC, and VMware exit.
>
> **Key Value Lever:** 10X faster infrastructure provisioning; eliminate configuration drift enterprise-wide.

Note: semicolons used instead of periods inside list items. Claims are scannable at a glance.

---

## VISUAL FOUNDATIONS

### Color

The palette is **Carbon**, IBM's open-source design system. See `colors_and_type.css` for the full token set. Three layers:

- **Neutrals.** The backbone is a 10-step gray scale (`#f4f4f4` → `#161616`). IBM does *not* use pure black for text — body copy is `#161616` (Gray 100). Almost every UI is built from these grays alone.
- **IBM Blue.** `#0f62fe` (Blue 60) is the single most important brand color — primary buttons, links, focus rings, brand accents. Darker shades (`--blue-70`/`--blue-80`) for hover/active and for deep "corporate" hero backgrounds.
- **Accent swatches (used sparingly).** `#a56eff` (Purple 60), `#009d9a` (Teal 60), `#9f1853` (Magenta 70), `#fa4d56` (Red 50). Present in the deck theme for data viz and category tags, but interface never leads with them.

Status colors follow Carbon: error = Red 60, success = Green 60, warning = Yellow 30, info = Blue 70.

### Type

**IBM Plex** across the board. The deck uses five Plex weights/styles that the system formalizes:

- **Plex Sans** (300 Light, 400 Regular, 500 Medium, 600 SemiBold) — UI body, headings.
- **Plex Sans Condensed** — data-dense tables and battlecard body copy (the four-pane layouts lean on Condensed to cram more text).
- **Plex Mono** — code snippets, technical annotations.
- **Plex Serif** — editorial/thought-leadership surfaces only; rare in product UI.

The deck's display type is set in **Plex Sans Light (300)** at large sizes — IBM's signature airy, confident display style. Never use bold for display; only heavier weights show up in small UI labels.

Carbon type scale lives in CSS vars `--type-heading-01` through `--type-display-04`. Display sizes are tight (line-height ≈ 1.05) with slightly negative letter-spacing.

### Spacing & layout

- **Carbon's 8px base grid.** All spacing tokens are multiples (`--space-01` = 2px through `--space-13` = 160px).
- **2x grid** — 16-column on desktop, 16px gutter on mobile, 32px on desktop. Content can extend **edge-to-edge** (Carbon allows it) rather than being locked to a capped container.
- **Generous whitespace at hero scale**, tight density in tables/battlecards. The battlecards are intentionally DENSE — lots of text in small boxes, with clear visual hierarchy from type weight alone.

### Backgrounds

IBM Consulting uses four distinct background treatments:

1. **Pure white (`#ffffff`)** for the vast majority of product UI and battlecard bodies. Clean, utilitarian.
2. **Gray 10 (`#f4f4f4`)** as the "layer-01" subtle surface — inset cards, sidebars, filters.
3. **Deep IBM blue** (`--blue-80` / `--blue-90` / `--blue-100`) for marketing hero sections and deck covers. See `assets/backgrounds/blue-gradient-full.jpeg` — a confident flat-to-subtle-gradient blue used behind IBM logos.
4. **White sculptural "IBM" renders** — high-key 3D letterforms cast in matte-white material with soft shadows (`assets/backgrounds/ibm-sculpt-*.jpg`). These are IBM Consulting's signature marketing imagery: abstract, architectural, non-photographic, slightly isometric. NOT gradients, NOT photos of people, NOT hand-drawn.

No repeating patterns. No noisy textures. No hand-drawn illustrations. No photography of stock businesspeople.

### Animation

Motion is **productive, not decorative**. Carbon's named easings apply:

- `--ease-productive` (`cubic-bezier(0.2, 0, 0.38, 0.9)`) for entrances.
- `--ease-expressive` for exits.
- Durations in the 70–240ms range for most UI. 400–700ms reserved for page-level transitions.
- **No bouncy spring easings. No extended loops. No parallax scroll effects.**
- Fades and small positional slides (≤8px) are the vocabulary. Elements slide in from the bottom 8px while fading from 0 to 1.

### Hover states

- **Buttons**: background darkens one shade (Blue 60 → Blue 70).
- **Links**: underline appears (the base state has none), color shifts to Blue 70.
- **Cards**: no lift on hover. Carbon does not use elevation-based hover. Instead, the border darkens from Gray 20 → Gray 50, or a left-edge 4px blue rule appears.
- **Icon buttons**: 8% black overlay (`rgba(0,0,0,0.08)`) tints the background.

Opacity-only hover is **not used** in IBM UI.

### Press/active states

- **Buttons**: background darkens further (Blue 80) — no scale transform, no shrink.
- **Links**: identical to hover.
- No "shrink on press" — Carbon is explicit that UI should not feel elastic.

### Focus

Carbon's focus ring is **non-negotiable** and instantly recognizable:

```
outline: 2px solid var(--focus);       /* #0f62fe */
outline-offset: -2px;                  /* INSET, not outset */
```

The 2px blue ring sits *inside* the component, not around it. Every interactive element must show this.

### Borders

- **1px, subtle gray** (`--gray-20` / `#e0e0e0`) everywhere. This is the dominant separator in Carbon UI.
- **1px `--gray-100`** for strong dividers on dark surfaces.
- **No colored borders** outside of status components.
- Borders do NOT round — see Radii below.

### Radii

**Carbon is emphatically square.** Default radius is **0**. The only exceptions:

- `2px` on inputs and some tags.
- `4px` on occasional marketing cards (outside Carbon itself, tolerated for marketing sites).
- **Never 8px+ rounded cards** — that reads as a non-IBM consumer design.

### Shadows

Minimal. Carbon replaces shadow with border. Where shadow appears:

- **Overlays / menus**: `0 2px 6px rgba(0,0,0,0.2)`.
- **Marketing cards**: `0 4px 16px rgba(0,0,0,0.10)` — only outside strict Carbon UI.
- No inner shadows. No glow effects.

### Transparency & blur

- **Modal scrim**: `rgba(22,22,22,0.5)`.
- **Navigation overlays on imagery**: solid color panels or gradient *protection* overlays (dark→transparent) to keep text legible on photography.
- **Backdrop blur is not used** in Carbon. Avoid `backdrop-filter` — it reads as iOS/Apple, not IBM.

### Cards

IBM's "card" is barely a card by modern standards — usually just a **bordered rectangle** (1px Gray 20) on white, with flat internal padding (`--space-06` / 24px). No shadow, no radius. On hover, the border color darkens or a colored left-rule appears.

### Image treatment

- **Colder than warm.** Imagery skews cool — blues, whites, silver grays. Warm tones are rare.
- **High key, never moody.** Backgrounds are bright; objects float in neutral space.
- **No grain, no film, no analog textures.** IBM imagery is clean, precise, modern.
- When photography is used, it's usually of a real team or architecture/equipment — never stock-smile portraits.
- **Signature imagery**: studio-rendered 3D geometric compositions in matte white with soft blue highlights, often forming abstract "IBM" letterforms. These are the deck covers.

### Fixed elements

- **Top navigation bar**: fixed at top on scroll, 48px tall on IBM.com, Carbon-standard.
- **Left side-nav** (where used): 256px wide, fixed, collapsible to 48px icon rail.
- Mobile: hamburger trigger reveals a full-screen overlay nav, not a drawer.

---

## ICONOGRAPHY

IBM Consulting uses **IBM Carbon Icons** — the open-source icon library published alongside the Carbon Design System. Over 2,400 icons, all hand-built, all on a 32×32 grid, all **monochromatic line icons** with 2px stroke and 0px fill by default. They are the single source of truth.

### In this system

Seven line icons from the battlecards deck have been copied into `assets/icons/` at 112×112 (all PNG). They are the exact icons IBM Consulting picks for deck body content: **microscope** (assessment), **shield-with-hand** (security/governance), **target** (objectives), **tools** (tooling), **dollar-in-chat-bubble** (commercials), **clock** (timelines), **rocket** (launch). Each is a square 112×112 black-on-white PNG.

These seven cover the battlecard vocabulary but are a tiny slice of the full library.

### For new designs — pull from CDN

For UI and new slides, load Carbon icons from the canonical CDN:

```html
<!-- As web font (all icons) -->
<link rel="stylesheet" href="https://1.www.s81c.com/common/carbon/icons/carbon-icons.min.css" />

<!-- Or import individual SVGs from the React/web-components package -->
<script type="module" src="https://cdn.jsdelivr.net/npm/@carbon/icons/lib/add/16.js"></script>
```

Or go direct: `https://carbondesignsystem.com/elements/icons/library/` — every icon is downloadable as SVG in 16/20/24/32 sizes. **Prefer SVG over PNG** for UI.

### Approach rules — three tiers

1. **Carbon first.** Use Carbon Icons for every standard UI glyph (add, close, search, settings, arrow-right, trash, etc.). Line icons only, 2px stroke, single `currentColor`, 32px grid. This is the canonical system.
2. **Lucide as fallback.** When Carbon genuinely lacks a glyph, pull from [Lucide](https://lucide.dev/) (`https://unpkg.com/lucide@latest`). Lucide's visual language — 2px stroke, 24px grid, rounded line-caps — sits close enough to Carbon that mixing reads as intentional. Prefer Lucide over hand-drawing.
3. **Custom SVG or image generation** as the last resort:
   - **Hand-build an SVG** for brand-specific marks (e.g. a BoxBoat wordmark glyph, a sub-practice logo). Keep to 32px grid + 2px stroke so it sits next to Carbon/Lucide without looking foreign.
   - **Use image generation** for full illustrations or hero compositions — especially the 3D matte-white sculptural renders that anchor IBM Consulting title slides. **Never** use image gen for UI icons; a real vector icon always wins.
- **Single-color.** Inherit `currentColor`. Never multi-hue, regardless of source.
- **No emoji. No Unicode symbols as icons.**
- **Icons never bigger than their accompanying text by more than 1.5×.** In buttons, 16×16 icons sit next to 14px text.

### Logos

Provided in `assets/logos/`:

- `ibm-logo-blue-white-bg.png` — the master IBM® logo, blue (#0f62fe) on white.
- `ibm-logo-black-white-bg.png` — black on white (press / monochrome contexts).
- `ibm-logo-white.png` — white on dark (use on `--blue-80`+ backgrounds).
- `ibm-logo-darkblue.png` — dark variant for light-but-muted backgrounds.
- `ibm-logo-blue-wide.png` / `ibm-logo-blue-white.png` — larger display renders.

The 8-bar IBM logotype has **protected clearspace** — minimum margin on all sides equal to the height of one bar. Do not place graphics or text inside that margin.

---

## Known substitutions & caveats

- **Fonts**: IBM Plex Sans is loaded from **local TTF files** in `fonts/` (16 files, full weight + italic range — Thin 100 through Bold 700, including the "Text" weight at ~450). IBM Plex Sans Condensed, Mono, and Serif are still loaded from Google Fonts (the official IBM-published distribution) until local TTFs for those families are provided.
- **Icons**: Only 7 were extracted from the deck. For UI, the system delegates to the Carbon CDN.
- **Missing decks**: The strategy/capabilities decks and the BoxBoat GTM deck mentioned in the brief are not in `uploads/`. Cover slides, section dividers, and some marketing layouts are therefore **inferred from public IBM brand conventions**, not lifted from source. If those decks arrive, the `slides/` folder should be revisited.
