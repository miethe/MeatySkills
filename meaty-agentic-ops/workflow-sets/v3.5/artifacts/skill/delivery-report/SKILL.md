---
name: delivery-report
description: "Create rich, evidence-backed, theme-aware HTML delivery reports. One skill, five routes: `feature` (a completed feature, backward-looking — what did we deliver and how do we know), `dossier` (the living per-feature record spanning research → plan → execute → validate, regenerated at each phase boundary — what's being done now, what's blocked, what was decided, and the evidence behind each), and `program` / `phase` / `readiness` (work in flight, forward-looking — where are we, what's blocked, and the next concrete action on each open item). Forward-route and dossier items each carry domain tags and a copyable agent handoff (command, existence-checked paths, grep-verified requirement IDs, blocking gates, tracker node, and a paste-ready prompt) — including for deferrals and externally blocked work. Use for: feature completion showcase, a longitudinal per-feature delivery record, project/program status, phase or wave recap, go/no-go readiness review, stakeholder-friendly explanation of delivered value or current state. Triggers: \"feature report\", \"completion showcase\", \"delivery dossier\", \"living record\", \"where does this feature stand\", \"project status\", \"where are we\", \"program status\", \"status report\", \"phase report\", \"wave recap\", \"readiness review\", \"go/no-go\". Do NOT use for: generic markup-to-HTML capsules (use html-capsules), live dashboards or telemetry (the `dossier` route is the regenerate-on-phase middle ground, not a live per-token stream), a quick conversational status answer, or replacing plans/PRDs/AARs/changelogs/git history."
version: 0.1.0
app_version: "2026-07-23"
updated: 2026-07-23
spec: ./SPEC.md
---

# Delivery Report Skill

Turn verified evidence into a portable, self-contained, theme-aware HTML report — a completed
feature (backward-looking), a **living per-feature dossier** that accretes from research to
validation, or a program/phase/readiness snapshot of work in flight (forward-looking) — where
every open item carries a **copyable agent handoff**.

## Routes (Dial: `report.route`)

| Route | Answers | Typical trigger |
|---|---|---|
| `feature` | "What did we finish, and how do we know?" (one completed thing) | "feature report", "completion showcase" |
| `dossier` | "Where does this feature stand across its whole life?" (one feature, research → validate, regenerated each phase) | "delivery dossier", "living record", "where does this feature stand" |
| `program` | "Where is this whole effort? What's blocked, what isn't?" | "project status", "where are we" |
| `phase` | "How did this wave/phase land, and what's next?" | "phase report", "wave recap" |
| `readiness` | "Should we invest further? Go or no-go?" | "readiness review", "go/no-go" |

`program`/`phase`/`readiness` share one forward-looking renderer; `feature` is the retrospective
single-feature renderer. `dossier` is the **longitudinal** single-feature renderer — a stage
timeline (research → plan → execute → validate) plus open-question and decision panels, regenerated
at each phase boundary (a point-in-time render of an accreting manifest, not a live stream). Route
policy + section matrix: `references/route-policy.md`.

## When NOT To Use

- Generic Markdown/YAML/JSON → HTML capsules — use `html-capsules` (the lower-level renderer).
- A live dashboard or telemetry surface — every report is a point-in-time artifact. The `dossier`
  route is the regenerate-on-phase middle ground (it re-renders at each phase boundary and stamps a
  "you are here"), but it is still **not** a live per-token stream — true live-watching belongs to
  the IntentTree Command Center.
- A quick conversational "what's the status?" — answer in chat; do not render a full artifact.
- Replacing plans, PRDs, progress trackers, AARs, changelogs, git history, or reviewer reports.
- Rendering unfinished work as completed — a non-final `truth_status` retains a visible DRAFT banner.
- Manufacturing decorative imagery that implies unverified behaviour — prefer real screenshots,
  evidence-linked diagrams, or an explicit `no_visual_reason`.

## Confidence Anchor — the CLI is deterministic and offline

```bash
# Create a manifest skeleton for a route.
"$DELIVERY_REPORT_PYTHON" "$DELIVERY_REPORT_SKILL_DIR/scripts/delivery_report.py" init \
  --route program --title "Program status" --subject my-repo \
  --out .claude/reports/my-repo-status/report.json

# (feature route) check whether a completed feature meets the reporting threshold.
"$DELIVERY_REPORT_PYTHON" "$DELIVERY_REPORT_SKILL_DIR/scripts/delivery_report.py" eligibility \
  --manifest .claude/reports/<slug>/report.json

# Render + validate a self-contained report.
"$DELIVERY_REPORT_PYTHON" "$DELIVERY_REPORT_SKILL_DIR/scripts/delivery_report.py" render \
  --manifest .claude/reports/<slug>/report.json --asset-root . --out .claude/reports/<slug>/index.html
"$DELIVERY_REPORT_PYTHON" "$DELIVERY_REPORT_SKILL_DIR/scripts/delivery_report.py" validate \
  --manifest .claude/reports/<slug>/report.json --asset-root . --html .claude/reports/<slug>/index.html

# Emit an AOS writeback envelope (offline; ingestion is a separate, gated action).
"$DELIVERY_REPORT_PYTHON" "$DELIVERY_REPORT_SKILL_DIR/scripts/delivery_report.py" export \
  --manifest .claude/reports/<slug>/report.json --html .claude/reports/<slug>/index.html \
  --target intenttree --out .claude/reports/<slug>/writeback.json
```

Resolve the skill dir and Python in this order:

```bash
DELIVERY_REPORT_SKILL_DIR="${DELIVERY_REPORT_SKILL_DIR:-$HOME/.claude/skills/delivery-report}"
test -f "$DELIVERY_REPORT_SKILL_DIR/scripts/delivery_report.py" \
  || DELIVERY_REPORT_SKILL_DIR="$HOME/.agents/skills/delivery-report"
DELIVERY_REPORT_PYTHON="${DELIVERY_REPORT_PYTHON:-.venv/bin/python}"
test -x "$DELIVERY_REPORT_PYTHON" || DELIVERY_REPORT_PYTHON="python3"
```

## Reporting Workflow

1. **Lock the truth first.** Verify the exact tree/commit, branch state (run
   `git log <default>..<branch>` for every active branch — main-only reads under-report in-flight
   work), reviewer verdict, validation results, and residual limitations before writing narrative.
2. **Pick the route** and, for `feature`, evaluate `eligibility`. An explicit request always wins.
3. **Author the manifest** using `references/report-contract.md`. Forward routes: give every vital a
   `measured_by`, every open item a handoff (`references/handoff-contract.md`).
4. **Collect visuals** per `references/visual-evidence.md`; redact before embedding. Label generated
   images `illustration` and record the `provider`.
5. **Render and validate.** Treat external resource loads, missing media, unresolved evidence IDs,
   missing handoff paths, invented requirement IDs, a `deferred` item without a trigger, or a
   `blocked_external` item with a non-null command as failures.
6. **Attach and (optionally) export.** Record the HTML path in the closeout / tracker; emit a
   writeback envelope for an AOS subsystem with `export` (`references/aos-integration.md`).

## The `dossier` lifecycle — seeded by planning, written by execution

The dossier is the one route you usually **do not** author from scratch: it is created at plan time
and accreted at each phase boundary by hooks that already run. Do not hand-build the manifest, and
do not re-render it by hand mid-execution.

| Moment | Who | What happens |
|---|---|---|
| **Plan time** (Tier 2/3) | `planning` Workflow 2 step 10 → `dev-execution/hooks/seed-dossier.sh` | Deterministically seeds the manifest from the plan: stage spine (`research` → `plan` → one `execute` per plan phase → `validate`), plus the plan's open questions and decisions. No model call. |
| **Each phase close** | the phase-closing agent → `dev-execution/hooks/update-dossier.sh` | The agent authors that stage's `narrative`/`outcome`/`decisions`/`evidence` into the manifest (a decision-time touch); the hook re-renders + re-validates. |
| **Validation** | the closing agent | Fills `validation[]` + final media; cross-links the enforced `feature` report. |

Both hooks share one master switch (`AOS_DELIVERY_DOSSIER`), are binding-gated, non-fatal, and
always exit 0. **Seeding is what arms the loop** — `update-dossier.sh` is gated on the manifest
existing, so an unseeded feature accretes nothing. Author a dossier manifest directly only when
retrofitting a record onto a feature that was planned before the seed existed. Spec:
`docs/skill-development/delivery-dossier/spec.md` §A.1 / §A.6.

## The handoff — the core of the forward routes

Every open item carries enough to dispatch an agent in one click: `command` (or `null` for
human-only acts), an **absolute** `repo`, existence-checked `paths`, grep-verified `requirement_ids`,
blocking `gates`, a `tracker` node, a `deferred` `trigger`, and a self-contained `prompt`. The
report-global `report.constraints` is injected into every copyable payload. Full rules:
`references/handoff-contract.md`.

## The response callout — the Next Actions table stays front-and-center

The rendered HTML holds the full per-item handoffs, but a report is often produced *as part of* an
execution or planning delivery — and there, the report must not swallow "what comes next." When you
produce a report inside such a delivery, also surface the **Next Actions table** front-and-center in
the chat response: a brief two-line lead-in plus the flat table (the same handoff vocabulary,
projected to one row per open item), with the rendered report path listed as an artifact — not as a
substitute for the table. The table is the at-a-glance callout; the report is the full evidence
behind it. Canonical format + per-command row semantics: `dev-execution/references/next-actions-table.md`.

## Output Guidance

- Outcome/state first, implementation detail second; separate facts from interpretation.
- Truthful labels only: `verified`, `partially_verified`, `not_executed`, `owner_data_absent`,
  `branch_local`, `shipped`; `verified_by: self | delegated | unverified` on material claims.
- Never expose secrets, tokens, private customer data, or unredacted screenshots.
- Emit both the JSON/YAML manifest (canonical) and `index.html` (portable). Default location:
  the project's completion-artifact dir, else `.claude/reports/<slug>/`.

## Do Not Say

| Wrong claim | Correct statement |
|---|---|
| "The HTML proves this is done/on-track." | The report presents evidence; git, tests, reviewer gates, and deployment receipts establish truth. |
| "A generated illustration is a product screenshot." | Label generated media `illustration`, record its provider, and reserve screenshots for captured state. |
| "The tracker says it's not started, so it isn't." | Reconcile against git — a branch may be many commits ahead while the tracker is stale (`partial`). |
| "Rendering uploads or hosts the report." | Render is local and self-contained; export/ingest is a separate approved action. |
| "Missing owner-held validation can be marked passed." | Preserve it as `not_executed` / `owner_data_absent` / another exact residual state. |

## Deferred (do NOT invoke)

- **SR-BL-1 / automatic evidence collector** — the renderer runs *no* gates; every `passed` is
  hand-authored. Do not claim a report auto-collected or auto-ran the checks it cites.
- **Writeback ingestion** — `export` emits an envelope only; do not treat it as having written to
  MeatyWiki / SkillMeat / IntentTree. Ingestion is a separate, gated CLI action.
- **IntentTree write-back of item state** — v1 links and reads trackers; it never writes node status.

## References Pointer Table

| File | Load when |
|---|---|
| `references/report-contract.md` | Authoring or reviewing any manifest |
| `references/handoff-contract.md` | Authoring forward-route item handoffs (the differentiator) |
| `dev-execution/references/next-actions-table.md` | Emitting the flat Next Actions table as the response callout (shared spec) |
| `references/visual-evidence.md` | Selecting, capturing, generating, or redacting visuals |
| `references/route-policy.md` | Choosing a route, its section matrix, or the eligibility policy |
| `references/aos-integration.md` | Exporting a writeback envelope, tracker linking, or registration |
| `templates/overclaim-addendum.md` | A project has a claim class that must never be blurred |
| `schemas/delivery-report.schema.json` | Integrating another tool or validating field shape |
| `examples/*.example.json` | Starting from a complete example (feature + dossier + program) |

## Key References

- `/Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/delivery-report/SPEC.md`
- `/Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/delivery-report/references/report-contract.md`
- `/Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/delivery-report/references/handoff-contract.md`
- `/Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/delivery-report/references/aos-integration.md`
- `/Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/dev-execution/validation/completion-criteria.md`
