# IBM Consulting Design System

A design kit for designing interfaces, decks, and marketing assets using publicly documented IBM brand conventions. It is rooted in **IBM's Carbon Design System**, the **IBM Plex** type family, and the public IBM Consulting sub-brand.

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
| `assets/icons/` | Line icon assets. |
| `assets/backgrounds/` | Blue gradient washes + white sculptural "IBM" brand renders. |
| `assets/ui/` | Interface decorations (monitor bezel, gradient rules). |
| `preview/*.html` | Individual cards shown in the Design System tab — tokens, specimens, components. |
| `ui_kits/ibm-consulting-web/` | React recreation of IBM Consulting's site patterns. |
| `slides/` | Presentation slide templates (16:9, 1280×720). |

---

## CONTENT FUNDAMENTALS

For IBM Consulting branded work, use a **corporate, precise, and credentialed** voice. A few durable rules:

### Voice & tone
- **Third-person institutional.** Use clear, organization-focused wording. First-person plural ("we") may appear when it makes the speaker clear.
- **Second-person ("you") is rare** and only shows up in client-facing CTAs ("Let's work together").
- **No rhetorical flourish.** No "imagine if…", no "what if we told you…", no "the future is…". Use specific language and substantiate factual claims.
- **Specific technology names are the hero.** Spell products out in full on first mention; use partner brand names accurately.

### Casing
- **Sentence case for all headings** — "Designing for cloud infrastructure", not "DESIGNING FOR CLOUD INFRASTRUCTURE".
- **Capitalize proper nouns consistently**, while keeping ordinary concepts in sentence case.
- **ALL CAPS only for abbreviations** (DORA, NIST, SSDF, SOC2, CIS, SBOM, SLSA, RHOV).
- **Kebab-case compound concepts**: "policy-as-code", "shift-left security", "lift-and-modernize".

### Number discipline
Support factual value claims with a source and context:

- Quantify a value claim only when its source and context are available.

Use an en dash (`–`) for numeric ranges.

### Punctuation quirks
- **Em-dashes** (`—`) can set off a concise aside.
- **Parenthetical asides** clarify technical details when needed.
- **Bullet lists with no terminal period**, each bullet a compressed fragment — never a full sentence.
- Serial comma (Oxford) used.

### Emoji usage
**None.** Zero emoji in IBM Consulting materials, ever. Not in slides or CTA copy. Emoji would read as consumer and undermine the enterprise positioning. Unicode decorations (✓ ★ →) also absent; the public IBM materials use monochrome line icons (see ICONOGRAPHY) for everything visual.

### Example

> **Objective:** Improve a process with clear, measurable outcomes.
>
> Public IBM Consulting brand materials use a precise, evidence-backed institutional voice.
>
> **Key Value Lever:** Reduce repetitive work; improve consistency across environments.

Note: semicolons used instead of periods inside list items. Claims are scannable at a glance.

---

## VISUAL FOUNDATIONS

### Color

The palette is **Carbon**, IBM's open-source design system. See `colors_and_type.css` for the full token set. Three layers:

- **Neutrals.** The backbone is a 10-step gray scale (`#f4f4f4` → `#161616`). IBM does *not* use pure black for text — body copy is `#161616` (Gray 100). Almost every UI is built from these grays alone.
- **IBM Blue.** `#0f62fe` (Blue 60) is the single most important brand color — primary buttons, links, focus rings, brand accents. Darker shades (`--blue-70`/`--blue-80`) for hover/active and for deep "corporate" hero backgrounds.
- **Accent swatches (used sparingly).** `#a56eff` (Purple 60), `#009d9a` (Teal 60), `#9f1853` (Magenta 70), `#fa4d56` (Red 50). Use for data visualization and category tags; interfaces should not lead with them.

Status colors follow Carbon: error = Red 60, success = Green 60, warning = Yellow 30, info = Blue 70.

### Type

**IBM Plex** across the board. The system formalizes several IBM Plex weights and styles:

- **Plex Sans** (300 Light, 400 Regular, 500 Medium, 600 SemiBold) — UI body, headings.
- **Plex Sans Condensed** — data-dense tables and compact interface labels.
- **Plex Mono** — code snippets, technical annotations.
- **Plex Serif** — editorial/thought-leadership surfaces only; rare in product UI.

The deck's display type is set in **Plex Sans Light (300)** at large sizes — IBM's signature airy, confident display style. Never use bold for display; only heavier weights show up in small UI labels.

Carbon type scale lives in CSS vars `--type-heading-01` through `--type-display-04`. Display sizes are tight (line-height ≈ 1.05) with slightly negative letter-spacing.

### Spacing & layout

- **Carbon's 8px base grid.** All spacing tokens are multiples (`--space-01` = 2px through `--space-13` = 160px).
- **2x grid** — 16-column on desktop, 16px gutter on mobile, 32px on desktop. Content can extend **edge-to-edge** (Carbon allows it) rather than being locked to a capped container.
- **Generous whitespace at hero scale**, balanced density in tables, with clear visual hierarchy from type weight alone.

### Backgrounds

Public IBM brand materials use several background treatments:

1. **Pure white (`#ffffff`)** for the vast majority of product UI and content surfaces. Clean, utilitarian.
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
- **Signature imagery**: studio-rendered 3D geometric compositions in matte white with soft blue highlights, often forming abstract "IBM" letterforms. These are public brand compositions.

### Fixed elements

- **Top navigation bar**: fixed at top on scroll, 48px tall on IBM.com, Carbon-standard.
- **Left side-nav** (where used): 256px wide, fixed, collapsible to 48px icon rail.
- Mobile: hamburger trigger reveals a full-screen overlay nav, not a drawer.

---

## ICONOGRAPHY

IBM Consulting uses **IBM Carbon Icons** — the open-source icon library published alongside the Carbon Design System. Over 2,400 icons, all hand-built, all on a 32×32 grid, all **monochromatic line icons** with 2px stroke and 0px fill by default. They are the single source of truth.

### In this system

The `assets/icons/` directory contains PNG icon assets. For new work, use the public Carbon icon library as the canonical source.

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
- **Icons**: For UI, use the Carbon CDN as the canonical source.
