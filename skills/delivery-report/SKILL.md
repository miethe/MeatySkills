---
name: delivery-report
description: "Create rich, evidence-backed, theme-aware HTML delivery reports. One skill, four routes: `feature` (a completed feature, backward-looking — what did we deliver and how do we know), and `program` / `phase` / `readiness` (work in flight, forward-looking — where are we, what's blocked, and the next concrete action on each open item). Forward-route items each carry domain tags and a copyable agent handoff (command, existence-checked paths, grep-verified requirement IDs, blocking gates, tracker node, and a paste-ready prompt) — including for deferrals and externally blocked work. Use for: feature completion showcase, project/program status, phase or wave recap, go/no-go readiness review, stakeholder-friendly explanation of delivered value or current state. Triggers: \"feature report\", \"completion showcase\", \"project status\", \"where are we\", \"program status\", \"status report\", \"phase report\", \"wave recap\", \"readiness review\", \"go/no-go\". Do NOT use for: generic markup-to-HTML capsules (use html-capsules), live dashboards or telemetry, a quick conversational status answer, or replacing plans/PRDs/AARs/changelogs/git history."
version: 0.1.0
app_version: "2026-07-23"
updated: 2026-07-23
spec: ./SPEC.md
---

# Delivery Report Skill

Turn verified evidence into a portable, self-contained, theme-aware HTML report — either a
completed feature (backward-looking) or a program/phase/readiness snapshot of work in flight
(forward-looking), where every open item carries a **copyable agent handoff**.

## Routes (Dial: `report.route`)

| Route | Answers | Typical trigger |
|---|---|---|
| `feature` | "What did we finish, and how do we know?" (one completed thing) | "feature report", "completion showcase" |
| `program` | "Where is this whole effort? What's blocked, what isn't?" | "project status", "where are we" |
| `phase` | "How did this wave/phase land, and what's next?" | "phase report", "wave recap" |
| `readiness` | "Should we invest further? Go or no-go?" | "readiness review", "go/no-go" |

`program`/`phase`/`readiness` share one forward-looking renderer; `feature` is the retrospective
single-feature renderer. Route policy + section matrix: `references/route-policy.md`.

## When NOT To Use

- Generic Markdown/YAML/JSON → HTML capsules — use `html-capsules` (the lower-level renderer).
- A live dashboard or telemetry surface — every report is a point-in-time artifact.
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

## The handoff — the core of the forward routes

Every open item carries enough to dispatch an agent in one click: `command` (or `null` for
human-only acts), an **absolute** `repo`, existence-checked `paths`, grep-verified `requirement_ids`,
blocking `gates`, a `tracker` node, a `deferred` `trigger`, and a self-contained `prompt`. The
report-global `report.constraints` is injected into every copyable payload. Full rules:
`references/handoff-contract.md`.

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
| `references/visual-evidence.md` | Selecting, capturing, generating, or redacting visuals |
| `references/route-policy.md` | Choosing a route, its section matrix, or the eligibility policy |
| `references/aos-integration.md` | Exporting a writeback envelope, tracker linking, or registration |
| `templates/overclaim-addendum.md` | A project has a claim class that must never be blurred |
| `schemas/delivery-report.schema.json` | Integrating another tool or validating field shape |
| `examples/*.example.json` | Starting from a complete example (feature + program) |

## Key References

- `/Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/delivery-report/SPEC.md`
- `/Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/delivery-report/references/report-contract.md`
- `/Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/delivery-report/references/handoff-contract.md`
- `/Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/delivery-report/references/aos-integration.md`
- `/Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/dev-execution/validation/completion-criteria.md`
