---
schema_version: 2
doc_type: skill_spec
skill_name: delivery-report
skill_version: 0.1.0
status: ready
created: 2026-07-23
updated: 2026-07-23
owner: nick
source_docs:
  - .claude/skills/delivery-report/SKILL.md
  - docs/project_plans/design-specs/status-report-skill-family.md
  - docs/project_plans/design-assets/status-report-reference/
related_skills:
  - html-capsules
  - dev-execution
  - planning
  - intenttree
---

# delivery-report Skill SPEC

## 1. Purpose & Scope

`delivery-report` turns verified evidence into a rich, self-contained, theme-aware HTML report. One
route-discriminated manifest serves two needs the ecosystem previously split across a skill that did
not exist and one that was singular by construction:

- **backward-looking** (`route: feature`) — one completed feature: delivered behaviour, value,
  findings, validation, residual truth. This absorbs and replaces the former `feature-report` skill.
- **forward-looking** (`route: program | phase | readiness`) — many things in flight, at a point in
  time, where **every open item carries a copyable agent handoff** so a reader goes from "this is
  behind" to a dispatched agent in one click.

In scope:

- Route-discriminated JSON/YAML report manifests and a deterministic, offline renderer.
- Feature eligibility (tier/size); forward reports produced on request.
- Per-item domain tagging from a closed, project-configurable vocabulary; per-item handoffs,
  including for deferrals and externally blocked work.
- Signature visualisations (activity flowsheet, two-track ladder), inline SVG flows/metrics,
  embedded screenshots, and clearly-labelled generated illustrations.
- Corrections of prior revisions; four-block light/dark theming with a viewer toggle.
- AOS writeback envelopes (`export`), IntentTree tracker linking, and registration.

Out of scope:

- Establishing completion/status independently of git/tests/review/deployment evidence.
- Live dashboards, hosted portals, automatic publication, or automatic evidence collection.
- Model-driven rendering or remote media fetching.
- Generic Markdown/YAML/JSON capsules (that is `html-capsules`); replacing plans/PRDs/AARs/changelogs.

## 2. Capability Coverage

| Intent | Surface | Contract |
|---|---|---|
| Choose a route + (feature) decide if a report is needed | `delivery_report.py eligibility` | `references/route-policy.md` |
| Create a manifest skeleton per route | `delivery_report.py init --route` | `schemas/delivery-report.schema.json` |
| Render a feature or status report | `delivery_report.py render` | `references/report-contract.md` |
| Author a dispatchable per-item handoff | `items[].handoff` / feature `followups[]` | `references/handoff-contract.md` |
| Render signature visualisations | `visuals.flowsheet`, `visuals.ladder` | renderer + `references/visual-evidence.md` |
| Embed screenshots/illustrations, inline flows/metrics | `media[]`, `diagrams[]`, `metrics[]` | `references/visual-evidence.md` |
| Validate truth, evidence, handoffs, media, HTML safety | `delivery_report.py validate` | Invariants 1–12 |
| Emit an AOS writeback envelope | `delivery_report.py export --target` | `references/aos-integration.md` |
| Gate feature closeout | dev-execution completion criteria | `references/route-policy.md` |

## 3. Invariants & Constraints

1. **Evidence precedes narrative.** Lock exact tree/commit, branch state, reviewer result,
   validation, and residual limits before authoring claims. Reconcile item state against git.
2. **Canonical source is structured.** The manifest is canonical; HTML is derived.
3. **No external resource loads.** Scripts, styles, fonts, images, and media are inline or blocked
   by a strict CSP; URLs may appear only as displayed evidence text.
4. **Local media only.** Media resolves beneath `--asset-root`; remote schemes are rejected; files
   embed as `data:` URIs. `sensitive: true` is a hard failure.
5. **No arbitrary HTML/SVG input.** All narrative fields are escaped; charts/flows are generated from
   declarative data; non-ASCII is numeric-entity encoded in body text.
6. **Truth labels are visible.** The closed enum is enforced; a non-final feature `truth_status`
   renders a DRAFT banner; owner/private validation stays explicitly unexecuted.
7. **Every vital cites its method.** A forward-route vital without `measured_by` fails validation.
8. **Handoffs are checkable.** Paths are existence-checked and requirement IDs grep-verified against
   the repo when it is present; `deferred` requires a `trigger`; `blocked_external` requires
   `command: null`; `repo` must be absolute. (See `references/handoff-contract.md`.)
9. **Rendering is offline and deterministic.** No LLM, browser automation, or network call in
   `render`, `validate`, or `export`; same manifest + assets → byte-identical output.
10. **Feature completion is tier-gated.** dev-execution Tier 2/3 and AOS Tier 3/4 closeouts require
    the report unless explicitly waived with a recorded reason.
11. **Corrections are first-class.** A re-render that overturns a prior claim states what was
    claimed, what is true, and how it was verified — never silently.
12. **Deployment/ingestion is separate truth.** Local render, `export` envelope emission, enterprise
    registration, and subsystem ingestion are reported independently; `export` never ingests.

## 4. Enhancement Backlog

- **DR-BL-1: Automatic evidence collector.** Run and capture the gates a report cites rather than
  trusting hand-typed status. (Was `feature-report` FR-BL-5 / status-report SR-BL-1.) Highest-integrity item.
- **DR-BL-2: Diff-against-previous-revision.** Auto-generate the `corrections[]` block by diffing the
  prior manifest instead of relying on the author to remember what changed.
- **DR-BL-3: Tracker sync.** Read item state from IntentTree/Linear — must reconcile against git, not
  trust the (known-stale) tracker. v1 links + reads only; never writes.
- **DR-BL-4: Browser screenshot capture adapter.** Keep capture separate from rendering; require an
  explicit target and redaction review.
- **DR-BL-5: Artifact Atlas catalog ingest.** Attach HTML + manifest through the catalog contract.
- **DR-BL-6: Handoff dispatch.** A one-click "run this" that hands the payload to an agent runtime
  instead of the clipboard. Depends on a dispatcher; parked until one exists.
- **DR-BL-7: Shared/merged single core across routes** — already unified here; future work is a
  route-aware section registry to trim renderer branching.
- **DR-BL-8: PDF export** — deferred; HTML remains the portable source presentation.

## 5. Changelog

### 0.1.0 - 2026-07-23

- Initial ready contract. Unified, route-discriminated report skill.
- Absorbs and replaces `feature-report` as `route: feature` (handoff-shaped `followups[]`,
  optional `domains[]`, light theme, per-`<code>` copy buttons — the recommended feature-report
  enhancements landed here).
- Adds forward-looking `program`/`phase`/`readiness` routes with vitals+`measured_by`, corrections,
  closed domain vocabulary, per-item copyable handoffs (existence-check + grep-verify + deferred
  trigger + blocked_external `command:null`), and the activity-flowsheet + two-track-ladder visuals.
- Four-block light/dark theming with a viewer toggle; strict CSP; deterministic offline renderer.
- `export` writeback envelope (skillmeat/intenttree/meatywiki/ccdash) + IntentTree tracker linking.

## 6. Integration Points

| System | Integration | State |
|---|---|---|
| `dev-execution` | End-of-feature completion criteria invoke eligibility and require a `feature` report at configured tiers via `hooks/verify-delivery-report.sh` | shipped with v0.1 |
| `html-capsules` | Shared safe-HTML principles + writeback target vocabulary; no runtime dependency | compatible |
| IntentTree | `items[].handoff.tracker` links to nodes; `export --target intenttree` emits an envelope | shipped (link/read); write deferred (DR-BL-3) |
| MeatyWiki / SkillMeat / CCDash | `export --target …` writeback envelope for gated ingestion | envelope shipped; ingestion via subsystem CLIs |
| SkillMeat enterprise | Register as `skill:delivery-report` | deployment step |
| Claude / Agent global skills | Deploy to `~/.claude/skills` + `~/.agents/skills/delivery-report` | deployment step |
| Agentic node | `AOS_LAUNCHPAD_SKILLS` + `/redeploy` | deployment step |

Runtime dependencies: Python 3.10+ standard library. PyYAML optional (YAML manifests only).

## 7. Success Signals

1. Each example manifest (feature + program) renders to one self-contained HTML file with no external
   resource attributes and a strict CSP.
2. The same manifest renders byte-identically twice (determinism).
3. Invalid evidence references, path escapes, sensitive/missing media, missing handoff paths,
   invented requirement IDs, a `deferred` item without a trigger, a `blocked_external` item with a
   command, or a vital without `measured_by` all fail validation with a clear message.
4. A non-engineer can answer, from the report: what is the state, what is blocked and on whom, the
   next concrete action on each open item, and how we know — without reading the diff.
5. The skill directory passes its tests from a scratch working directory, offline.
6. Both themes render legibly and the viewer toggle overrides the media-query default.
7. SkillMeat enterprise returns the artifact file set; both global roots resolve a valid `SKILL.md`.

## 8. File Layout

```text
delivery-report/
├── SKILL.md
├── SPEC.md
├── README.md
├── CHANGELOG.md
├── schemas/delivery-report.schema.json
├── scripts/delivery_report.py
├── assets/report.css
├── assets/report.js
├── references/report-contract.md
├── references/handoff-contract.md
├── references/visual-evidence.md
├── references/route-policy.md
├── references/aos-integration.md
├── templates/overclaim-addendum.md
├── examples/feature.example.json
├── examples/program-status.example.json
├── examples/reference-program-status.html
└── tests/test_delivery_report.py
```
