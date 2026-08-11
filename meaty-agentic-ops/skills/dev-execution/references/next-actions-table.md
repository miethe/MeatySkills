# The Next Actions Table — the standard "what comes next" close

Every execution and planning command ends its final response to the user with a **Next Actions
table**: a compact, copy-pasteable map of what to do next. It is the last thing the user reads, so
it is the one place they look to keep moving without re-reading the whole run.

This is the **flat-markdown projection of the `delivery-report` handoff vocabulary**
(`delivery-report/references/handoff-contract.md`). The columns *are* the handoff fields, collapsed
to one row per action. A full `delivery-report` renders the same information as per-item handoff
blocks with copyable payloads; this table is the always-on, inline form that needs no HTML render.
Keep the two consistent — same field names, same item-kind semantics.

## The format (fixed — do not vary the columns)

| # | Next action | Target — path / ITT node / project | Achieves | Gates / blockers | Model |
|---|---|---|---|---|---|

| Column | Contents | Sourced from |
|---|---|---|
| **#** | Priority rank (`1`, `2`, …) when ordering is meaningful; `—` when the rows are independent. Order the table by this. | Your judgment of dependency + risk order. |
| **Next action** | The exact command to run, with its argument form: `` `/dev:execute-plan` `` , `` `/plan:spike` `` , `` `/plan:plan-feature --tier=N` ``. For an item no agent can advance, write `human decision` (never a fake command). | `handoff.command` — `null` renders as `human decision`. |
| **Target — path / ITT node / project** | The concrete object the action acts on: repo-relative path(s), the bound IntentTree node id, and — **only for cross-project rows** — a `project:<slug>` prefix. Paths must exist; node ids must be real **and, for a `deferred` or `finding` row, must be present** — a path alone is not a Target for newly-discovered work (see below). | `handoff.paths` + `handoff.tracker` (+ target project when it differs from the current repo). |
| **Achieves** | One line: what running this yields. Imperative, concrete. | The item title / intent. |
| **Gates / blockers** | Blocking gate ids (`G0`, plan-gate), a one-phrase blocker, `blocked-external` for human-only waits, or `—` when clear to run. | `handoff.gates` + item kind. |
| **Model** | Recommended model in registry short form (`opus-5`, `sonnet-5`, `haiku-4-5`, `fable-5`). For an orchestrated command name both roles: `opus-5 orch / sonnet-5 exec`. `—` for `human decision` rows. | `MODEL-ROUTING.md` §1.5, resolved per-leg via the `delegation-router` skill. Never guess — the plan's `orchestrator_model` frontmatter is deleted (execution-doctrine.md, Bookkeeping demotions: advisory, never read); resolve fresh via the router every time. |

### A `deferred` or `finding` row must carry a tracker node id

The table is a *pointer into* the tracker, not the tracker itself. For every other kind the work
already exists somewhere durable — a plan, a phase file, a contract. `deferred` and `finding` rows
are the exception: they describe work discovered **during this run**, so if the row is the only
record, the item dies when the response scrolls away.

So: **file the node when you detect the item** — ungated, straight into the target tree
([`.claude/rules/finding-capture.md`](../../../rules/finding-capture.md)) — and put its id in the
Target column. Omitting the id and listing only a file path is **not** conformant, even though the
older "node ids must be real" wording technically allowed it; that gap is exactly how a deferral
once shipped with nothing filed behind it. The same requirement is enforced mechanically on the
report side as blocking rule 7 of the handoff contract.

Below the table, add at most **one** line for shared context if any command needs it (the project
invariant a dispatched agent must not violate — the report-global `constraints` of the handoff
contract). Do not restate per-row prompts here; the table is the brief, not the full handoff.

## Empty state (still emit the section)

When the work is genuinely finished and nothing follows, emit the header and a single line instead
of an empty table:

> **Next actions** — Complete. No follow-up actions; work is merged.

Never silently omit the section — its predictable presence is what makes it a standard.

## What populates the rows, per command

Each row is an open item in the handoff sense (`handoff-contract.md` § "Which item kinds require a
handoff"): `partial`, `not_started`, `blocked_external`, `deferred`, or an actionable `finding`.
`shipped` items do not get rows.

| Command | Rows to emit |
|---|---|
| **`/plan:plan-feature`** (and the planning skill's PRD + plan flows) | The single execute handoff for the classified tier — `/dev:quick-feature` (T0), `/dev:execute-contract <contract>` (T1), `/dev:execute-plan <plan>` (T2/3) — carrying the plan/contract path and bound node (Model column resolved per-leg via `delegation-router`, not read from plan frontmatter — see above). Add a row per prerequisite (e.g. a `/plan:spike` that must land first) and one `deferred` row per item the plan parked (DOC-006 spec tasks). |
| **`/plan:explore`** | One row for `recommended_next_action`: `go` → `/plan:plan-feature --tier=N`; `conditional` → a `deferred` row with the `defer-until:` trigger; `no-go` → a `human decision` row noting the archive. |
| **`/plan:spike`** | A row per unresolved open question that must be answered before the parent work proceeds, plus (in `--leg-of` mode) the return-to-parent handoff. Empty state when the spike fully resolved its charter. |
| **`/dev:execute-phase`** | The **following phases**, one row each, with each phase's orchestration-owner model and its phase-file/plan path — the next phase ranked `1`. Add rows for any blockers or actionable findings surfaced this phase. |
| **`/dev:execute-plan`** | Deferred items (DOC-006 spec-authoring tasks, one row each), reviewer-recommended follow-ups, any Mode-D escalations as `human decision` rows, and the recommended next effort (plan the deferred spec / execute a follow-up). Findings docs get a row when actionable. |
| **`/dev:quick-feature`** | Follow-ups or risks if the change surfaced any; otherwise the empty state. |
| **`/dev:execute-contract`** | On `CHANGES_REQUESTED`, the required fixes as rows (re-dispatch the sprint). On `APPROVED`, contract follow-up recommendations, else the empty state. |
| **`/dev:autopilot`** | On `complete`, follow-ups/deferrals from the nested run, else the empty state. On any `needs_opus` reason, a row for the recommended path (`/plan:plan-feature`, `/plan:explore`/`/plan:spike`, or the Mode-D `human decision`). |

## Placement — and the delivery-report callout

The Next Actions table is the **final section** of the response.

When the delivery is *also* a `delivery-report` (any route), the table does **not** disappear into
the HTML. Surface it **front-and-center in the response** as a brief callout — a two-line lead-in
plus the table — with the rendered report path listed as one of the artifacts, not as a substitute
for the table:

> **Next up** (full evidence in the delivery-report below):
> _<the table>_
>
> Report: `<path-to-report>.html`

The report's per-item handoff blocks hold the full copy-payloads; the table is the at-a-glance
callout so the reader sees the next move before opening anything.

## Cross-references

- Field vocabulary + validation + item kinds: `delivery-report/references/handoff-contract.md`.
- Model resolution: `docs/agentic-operator/MODEL-ROUTING.md` §1.5 + the `delegation-router` skill.
- Tier → execute-command routing: `planning/SKILL.md` § "Tier Matrix".
- Deferred-item lifecycle (what becomes a `deferred` row): `planning/references/deferred-items-and-findings.md`.
- Filing the node behind a `deferred`/`finding` row (ungated, at detection time): `.claude/rules/finding-capture.md`.
