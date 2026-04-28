---
name: ibm-consulting-design
description: Use this skill to generate well-branded interfaces and assets for IBM Consulting, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping. Rooted in IBM's open Carbon Design System and the IBM Plex type family.
user-invocable: true
---

Read the `README.md` file within this skill first — it contains the brand context, content fundamentals, visual foundations, and iconography guidelines. Then explore:

- `colors_and_type.css` — every design token (colors, type scale, spacing, radii, shadows, motion).
- `assets/logos/` — official IBM logos (blue, white, black, dark-blue).
- `assets/icons/` — 7 Carbon line icons pulled from IBM Consulting battlecards.
- `assets/backgrounds/` — blue gradient washes and the signature white sculptural "IBM" renders.
- `preview/*.html` — token cards and component specimens (Design System tab).
- `ui_kits/ibm-consulting-web/` — React recreations of IBM Consulting web patterns.
- `slides/` — 16:9 battlecard, title, and section-header slide templates.

If creating visual artifacts (slides, mocks, throwaway prototypes, marketing pages, decks), copy the needed assets out of this skill into your working project and build static HTML. `<link rel="stylesheet" href="colors_and_type.css">` is the fastest way to inherit the full token system.

If working on production code, read the rules in `README.md` to become an expert in designing with the IBM brand — the canonical implementation is [Carbon Design System](https://carbondesignsystem.com/) and the canonical icon library is [Carbon Icons](https://carbondesignsystem.com/elements/icons/library/). Both are open source and should be installed via `@carbon/react` + `@carbon/icons-react` for real production work.

If the user invokes this skill without any other guidance, ask them what they want to build or design (deck? landing page? product UI? battlecard?), ask a few clarifying questions about audience and scope, and act as an expert designer who outputs HTML artifacts — or production React — depending on the need.

**Non-negotiables for anything made with this skill:**
- IBM Plex everywhere. No other typefaces.
- Square corners. 0 radius default; 2px max on inputs.
- 2px inset focus rings in IBM Blue (`#0f62fe`).
- No emoji, no gradients-as-decoration, no rounded cards with colored left borders.
- Icons from Carbon only. Never hand-draw SVG iconography.
- IBM Blue (`#0f62fe`) is THE brand color. Accents (purple, teal, magenta) support; never lead.
