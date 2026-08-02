# delivery-report

Rich, evidence-backed, theme-aware **HTML delivery reports** — one skill, four routes:

- `feature` — a completed feature, backward-looking ("what did we deliver, and how do we know?").
  Replaces the former `feature-report` skill.
- `program` / `phase` / `readiness` — work in flight, forward-looking ("where are we, what's
  blocked, and the next concrete action on each open item?"). Every open item carries a **copyable
  agent handoff**: command, existence-checked paths, grep-verified requirement IDs, blocking gates,
  tracker node, and a paste-ready prompt — so a reader goes from "this is behind" to a dispatched
  agent in one click.

The renderer is **deterministic and offline** — no model call, no network in `render` / `validate` /
`export`. The manifest is canonical; the HTML is derived and self-contained (strict CSP, media inlined
as `data:` URIs, light/dark theming with a viewer toggle).

## Quick start

```bash
PY=.venv/bin/python   # or python3
SK="$HOME/.claude/skills/delivery-report/scripts/delivery_report.py"

# forward-looking program status
$PY "$SK" init --route program --title "Program status" --subject my-repo --out report.json
$PY "$SK" render --manifest report.json --asset-root . --out index.html
$PY "$SK" validate --manifest report.json --asset-root . --html index.html

# backward-looking feature completion
$PY "$SK" init --route feature --title "My feature" --subject my-project --out report.json
$PY "$SK" eligibility --manifest report.json
```

## Layout

| Path | Role |
|---|---|
| `SKILL.md` / `SPEC.md` | router + canonical contract |
| `scripts/delivery_report.py` | `init` / `eligibility` / `render` / `validate` / `export` |
| `assets/report.css` / `report.js` | four-block theme system + copy/handoff components |
| `schemas/delivery-report.schema.json` | route-discriminated manifest shape |
| `references/` | report contract, handoff contract, visual evidence, route policy, AOS integration |
| `templates/overclaim-addendum.md` | project overclaim-guard template |
| `examples/` | `feature.example.json`, `program-status.example.json`, vendored golden reference |
| `tests/test_delivery_report.py` | offline test suite |

## Tests

```bash
python3 -m pytest .claude/skills/delivery-report/tests -q
```

Provenance: the forward-looking design and the golden reference come from a hand-built
`pediatric-anemia-site` program-status report (2026-07-22); see
`docs/project_plans/design-specs/status-report-skill-family.md`.
