# Changelog — delivery-report

## 0.1.0 — 2026-07-23

Initial release. Unified, route-discriminated report skill that **replaces `feature-report`**.

- **Routes:** `feature` (retrospective single feature — absorbs `feature-report`) plus
  `program` / `phase` / `readiness` (forward-looking, multi-item).
- **Handoffs:** every open forward-route item carries a copyable agent handoff — absolute repo,
  existence-checked paths, grep-verified requirement IDs, blocking gates, tracker node, and a
  paste-ready prompt. Validation is blocking: `deferred` needs a `trigger`, `blocked_external` needs
  `command: null`, `repo` must be absolute.
- **Honesty mechanism:** every vital cites `measured_by`; `corrections[]` is first-class; evidence
  and handoff paths are existence-checked when the repo is present; `verified_by` distinguishes
  self / delegated / unverified claims.
- **Feature-route enhancements** (the recommended `feature-report` changes, landed here):
  handoff-shaped `followups[]`, optional `domains[]`, light theme, per-`<code>` copy buttons,
  existence-checked evidence paths.
- **Visuals:** activity flowsheet + two-track ladder from declarative data; inline SVG flows/metrics;
  screenshots and clearly-labelled generated illustrations with recorded provider.
- **Theming:** four-block token system (`:root`, dark media query, explicit `data-theme`) with a
  viewer toggle that wins over the media query.
- **AOS:** `export` writeback envelope (skillmeat/intenttree/meatywiki/ccdash) and IntentTree tracker
  linking. Deterministic and offline throughout.
