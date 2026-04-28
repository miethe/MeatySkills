# UI Kit — IBM Consulting Web

A React recreation of the core interaction patterns used on IBM Consulting's web surfaces (ibm.com/consulting marketing pages and the battlecard deck — the two primary channels we have reference for).

**Scope.** This is a marketing-site kit, not a product UI kit. No codebase was provided — the visual vocabulary is lifted from:

1. `uploads/Offering_battlecards.pptx` (layout, type, color, icon usage, copy voice).
2. Public IBM Carbon Design System conventions (buttons, form fields, grid, navigation patterns) — the open-source system IBM publishes itself.

If a real ibm.com codebase becomes available, this kit should be replaced with components lifted directly from `@carbon/react`. Treat what's here as a faithful marketing-layer approximation.

## Components

| File | Purpose |
|---|---|
| `MastheadNav.jsx` | IBM.com-style 48px top bar with primary nav and search. |
| `Button.jsx` | Carbon button — primary/secondary/tertiary/ghost with arrow icon. |
| `HeroBlock.jsx` | Big-display hero with blue sculptural-imagery background. |
| `OfferingCard.jsx` | Clickable card for an IBM Consulting offering (the battlecard thumbnails). |
| `StatBlock.jsx` | Quantified proof-point — rule-above + big-number + label. |
| `TileLink.jsx` | Text link with arrow that becomes a block on hover. |
| `FooterBar.jsx` | IBM footer rail. |

## Screens

`index.html` is a clickable interactive home: landing → click an offering → offering detail → browse stats → footer. All links are in-page routed with `useState` — no navigation.
