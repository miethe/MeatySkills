---
name: ibm-consulting-design-system
description: >-
  Generate IBM Consulting–branded interfaces, decks, battlecards, landing pages, and prototypes
  using IBM's Carbon Design System conventions and the IBM Plex type family. Trigger on: "IBM
  Consulting deck", "battlecard", "IBM branding", "Carbon design", "IBM Plex", "IBM blue",
  BoxBoat/Nordcloud co-brand assets, or any throwaway mock/prototype/marketing page that must look
  like IBM Consulting materials. Do NOT use for: real IBM.com or product-UI production work (use
  `@carbon/react` + `@carbon/icons-react` directly — see Deferred below), or any deliverable
  presented as official/authoritative IBM guidance rather than an internal presentation aid.
user-invocable: true
version: 1.0
app_version: "2026-09-21"
updated: 2026-09-21
---

Read `README.md` in this skill directory first — it has the brand context (IBM Consulting vs. IBM
Corp, BoxBoat/Nordcloud co-branding), content fundamentals, visual foundations, and iconography
rules that this file only summarizes.

## What's in this kit

| Path | What it's for |
|---|---|
| `colors_and_type.css` | Every design token — colors, type scale, spacing, radii, shadows, motion. `<link>` this into any static HTML artifact to inherit the full system in one line. |
| `assets/logos/` | Official IBM logos: blue-on-white, white, black, dark-blue, wide variants. |
| `assets/icons/` | 7 Carbon-style line icons (clock, dollar-chat, microscope, rocket, shield-hand, target, tools) pulled from battlecard decks. |
| `assets/backgrounds/` | Blue gradient washes + the signature white sculptural "IBM" renders (arches, columns, corner, iso). |
| `assets/ui/` | Loose UI fragments (monitor bezel frame, vertical gradient decoration). |
| `assets/misc/` | Unsorted extracted imagery — inspect before reuse. |
| `fonts/` | IBM Plex Sans, full weight/italic set (Thin through Bold). OFL-licensed — see Deferred below before redistributing further. |
| `ui_kits/ibm-consulting-web/` | React recreation of IBM Consulting marketing-site patterns (masthead, hero, offering card, stat block, footer). Marketing-layer approximation, not a pulled product codebase — see its own `README.md`. |
| `uploads/` | Source decks this kit was extracted from. `Offering_battlecards.pptx` is the only one actually present. |

### `preview/*.html` — token & component specimens

Reach for the specific card instead of browsing the directory:

- **Color**: `colors-blue.html` · `colors-gray.html` · `colors-semantic.html` · `colors-accents.html`
- **Type**: `type-display.html` · `type-headings.html` · `type-body.html` · `type-weights.html` · `type-families.html`
- **Structure**: `spacing-scale.html` · `radii.html` · `shadows.html` · `motion.html`
- **Brand**: `brand-logo.html` · `brand-imagery.html` · `brand-icons.html` · `background-treatments.html`
- **Components**: `components-buttons.html` · `components-forms.html` · `components-table.html` · `components-tags.html` · `components-notifications.html`

### `slides/*.html` — 16:9 (1280×720) slide templates

`title-slide.html` · `quote-slide.html` · `big-stats.html` · `section-divider.html` ·
`battlecard.html` — all share `_slide.css`.

## Workflow

**Visual artifacts** (slides, mocks, throwaway prototypes, marketing pages, decks): copy the
needed assets out of this skill into the working project and build static HTML.
`<link rel="stylesheet" href="colors_and_type.css">` is the fastest way to inherit the token
system; start from the closest matching file in `preview/` or `slides/` rather than from scratch.

**Production code**: read `README.md`'s brand rules to design correctly with the IBM brand, but
implement against the canonical open-source [Carbon Design System](https://carbondesignsystem.com/)
and [Carbon Icons](https://carbondesignsystem.com/elements/icons/library/) via `@carbon/react` +
`@carbon/icons-react`. This kit is for presentation-layer speed, not a substitute for Carbon in a
real codebase.

**No brief given**: ask what's being built (deck? landing page? product UI? battlecard?), ask
about audience and scope, then act as an expert IBM-brand designer producing HTML artifacts — or
production React against Carbon — as appropriate.

## Non-negotiables for anything made with this skill

- IBM Plex everywhere. No other typefaces.
- Square corners. 0 radius default; 2px max on inputs.
- 2px inset focus rings in IBM Blue (`#0f62fe`).
- No emoji, no gradients-as-decoration, no rounded cards with colored left borders.
- Icons from Carbon only. Never hand-draw SVG iconography.
- IBM Blue (`#0f62fe`) is THE brand color. Accents (purple, teal, magenta) support; never lead.

## When NOT To Use

- **Real production IBM.com or product UI work** — use `@carbon/react` + `@carbon/icons-react`
  directly against the live Carbon Design System, not this kit's static assets or the
  `ui_kits/ibm-consulting-web/` marketing-layer approximation.
- **Any context requiring a different brand** (a client's own brand, a non-IBM-Consulting IBM
  business unit with its own guidelines) — this kit encodes IBM Consulting's sales/marketing
  conventions specifically, not IBM Corp brand guidelines generally.
- **Anything that must cite authoritative, current IBM brand policy** — go to IBM's own internal
  brand center or Carbon's published docs instead; see Deferred below.
- **Bundling or redistributing the `fonts/` files outside this repo without carrying forward the
  OFL license terms** — see Deferred below.

## Deferred / Do Not Say

- **This is internal presentation material, not an IBM-published design system.** It was extracted
  from an internal battlecard deck (`uploads/Offering_battlecards.pptx`) plus publicly documented
  Carbon/IBM Plex conventions, for building throwaway prototypes, mocks, and IBM Consulting-styled
  decks quickly. Never present output built with this skill as official or authoritative IBM
  guidance, and never cite this kit itself as an IBM-sanctioned source.
- **`Global Instructions - IBM branding.md` is deliberately NOT included in this skill.** It exists
  in the pre-ingestion working copy and was withheld pending a publish-safety decision on the
  content of that file (tracked: `node_01M329WNS6MD1407J4XMNB6A5X`). Do not add it, paraphrase it
  into this file, or treat its absence as an oversight to "fix."
- **Three source decks referenced in `README.md`'s "Sources given" table were never uploaded**
  (`2026 IBM Consulting Strategy & Capabilities Deck v26.02-1.pptx`, `...-2.pptx`,
  `BoxBoat GTM-26-v1.pptx`). Everything in this kit derives from the one deck that *is* present
  (`Offering_battlecards.pptx`) plus public Carbon/Plex conventions — not from those three.
- **`fonts/*.ttf` (IBM Plex Sans) ship under the SIL Open Font License 1.1**, which permits bundling
  and redistribution but requires the OFL license text to accompany redistributed copies. This
  directory currently carries no `OFL.txt`/license file alongside the font binaries — a gap, not a
  clearance. Do not treat the repo root `LICENSE` (MIT, covers this skill's own authored content)
  as covering the fonts.
- **`uploads/Offering_battlecards.pptx` is a real internal sales deck bundled in this skill** — a
  separate publish-safety exposure already filed upstream; do not re-file it.

## Key References

- `/Users/miethe/dev/homelab/development/MeatySkills/skills/ibm-consulting-design-system/README.md` — brand context, content fundamentals, visual foundations, iconography.
- `/Users/miethe/dev/homelab/development/MeatySkills/skills/ibm-consulting-design-system/colors_and_type.css` — the token system.
- `/Users/miethe/dev/homelab/development/MeatySkills/skills/ibm-consulting-design-system/ui_kits/ibm-consulting-web/README.md` — scope and component map for the React kit.
- `/Users/miethe/dev/homelab/development/MeatySkills/skills/ibm-consulting-design-system/CHANGELOG.md` — this skill's adoption history.
