# The Next Actions Table — the standard "what comes next" close

Every execution and planning command ends its final response to the user with a **Next Actions
table**: a compact, copy-pasteable map of what to do next. It is the last thing the user reads, so
it is the one place they look to keep moving without re-reading the whole run.

Because it is that one place, its **size is part of the contract, not a matter of taste** — at most
**two rows**, everything else filed or bundled. Read § "The row budget" before writing one; a table
that enumerates every node, merge and decision is the failure mode this spec exists to prevent, not
a thorough version of it.

This is the **flat-markdown projection of the `delivery-report` handoff vocabulary**
(`delivery-report/references/handoff-contract.md`). The columns *are* the handoff fields, collapsed
to one row per action. A full `delivery-report` renders the same information as per-item handoff
blocks with copyable payloads; this table is the always-on, inline form that needs no HTML render.
Keep the two consistent — same field names, same item-kind semantics.

## The row budget — at most two rows, then bundle

The reader of this table is a human spending a finite amount of attention deciding what to do next.
A table that lists every node, merge and decision the run touched does not serve that decision — it
replaces one question ("what next?") with twenty, which is measurably worse than silence. The
observed outcomes of the unbounded form are: work on all of it, work on the wrong one, or freeze and
do none of it.

So the table has a hard budget: **at most two rows.** Not two per kind, not two sections — two rows,
total.

Before writing any row, put every open item into exactly one of three buckets. The bucketing is
silent — never narrate it:

| Bucket | Test | What happens | Gets a row? |
|---|---|---|---|
| **finish now** | budget remains and it is in scope | do it before you close | no |
| **file** | real work, out of this run's scope | file the node at detection time to the finding-capture detail floor | no — unless it is one of the ≤2 |
| **human-only** | only the human can choose (Mode-D approval, product call, priority) | name it | yes — always eligible |

**When more than two items survive as follow-ups, bundle them.** File one **grouping node** under
the work product and point a single row at that node, instead of listing its children. See
§ "The grouping node" below.

This is ranking, not truncation. Choose the two by *what changes the human's next move*, and note
what makes the drop legal: **every item you leave out is already durable because you filed it.** A
row budget without the filing is not a brief, it is data loss — the budget and
[`finding-capture.md`](../../../rules/finding-capture.md) are one rule with two halves.

⚠️ **A Next Actions table is a smell unless every row is human-only.** If a row's action is
something an agent could have done, the honest close was to do it (bucket 1) or file it (bucket 2).
A row reading `/dev:execute-plan …` at the end of your own run is usually the run declining to
finish.

## The grouping node

The bundle target is a real IntentTree node, so that "see the group" is a pointer into the tracker
rather than a promise in prose.

**Convention: `type: work_package` + tag `closeout-group`.** No new node type — `work_package` is
already the grouping tier that legitimately parents `atomic_task` children (`NODE_TIER` 3), so this
needs no schema change or migration. The **tag** is what makes the bundle findable as a closeout
group and distinguishes it from an ordinary planned work package.

```bash
itt node create --type work_package --tag closeout-group \
  --tree <target_tree> --parent <the work product's node> \
  --title "<the theme — not the count>" \
  --description "Closeout bundle from <run/PR ref>. Children each carry their own detail floor."
```

Four requirements, each closing an observed way the bundle stops working:

- **Parent it under the work product** — the plan, feature or pillar node the run was against. Never
  under the atomic task that spawned it: child status cascades, and a bundle of open follow-ups
  hanging off a finished task flips that task back to `blocked`.
- **Each child still meets the detail floor on its own.** The group is an index, not a substitute for
  a filable node — a child that only makes sense from the parent's title is not filed, it is listed.
- **Title the theme, not the count.** "Reviewer-gate propagation gaps" is a pointer; "5 follow-ups
  from PR #412" is a number the reader has to open to understand.
- **The row's Target column carries the grouping node id**, exactly like any other tracker row.

Readers: `/itt:run` (its Action 6 close) and the `campaign` skill (its close contract) both know this
convention — a `closeout-group` node routes to `plan`, never to an execution lane, because it is an
index whose children are the work.

## The closeout message around the table

The table is the *what next*; the prose around it is deliberately small. A closeout is **brief and
non-technical** — four beats, no wall of technical decisions:

1. **Patterns** noticed this session.
2. **Escalations**, good or bad.
3. **Progress** — what was enabled, earned, or fixed.
4. **What's next** — the one pointer (the table).

Technical decisions, mechanism narration and full evidence belong in the **AAR**, which then goes
through `op story capture`. Jargon the reader has to decode is a cost charged to them, not a signal
of rigor.

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
| **`/plan:plan-feature`** (and the planning skill's PRD + plan flows) | The single execute handoff for the classified tier — `/dev:quick-feature` (T0), `/dev:execute-contract <contract>` (T1), `/dev:execute-plan <plan>` (T2/3) — carrying the plan/contract path and bound node (Model column resolved per-leg via `delegation-router`, not read from plan frontmatter — see above). Add a prerequisite row (e.g. a `/plan:spike` that must land first) if one exists. Items the plan parked (DOC-006 spec tasks) are **filed, not listed** — bundle them into one `closeout-group` node and spend at most one row on it. |
| **`/plan:explore`** | One row for `recommended_next_action`: `go` → `/plan:plan-feature --tier=N`; `conditional` → a `deferred` row with the `defer-until:` trigger; `no-go` → a `human decision` row noting the archive. |
| **`/plan:spike`** | The unresolved open questions that block the parent work — as one row when there is a single blocker, otherwise filed and bundled into one `closeout-group` row; plus (in `--leg-of` mode) the return-to-parent handoff. Empty state when the spike fully resolved its charter. |
| **`/dev:execute-phase`** | The **next phase** (ranked `1`) with its orchestration-owner model and phase-file/plan path — the remaining phases are already in the plan and need no rows. Blockers and actionable findings surfaced this phase are filed; spend the second row on one only if it changes what the human does now. |
| **`/dev:execute-plan`** | Mode-D escalations as `human decision` rows (always eligible — they are human-only by construction). Deferred items (DOC-006 spec-authoring tasks), reviewer-recommended follow-ups and actionable findings are **filed and bundled** into one `closeout-group` node under the plan; the recommended next effort gets the remaining row. |
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
- Filing the node behind a `deferred`/`finding` row (ungated, at detection time): `.claude/rules/finding-capture.md` — the other half of the row budget: what you leave out of the table must already be durable.
- Closeout shape (the four beats around the table) + the `closeout-group` convention in context: `docs/agentic-operator/AOS-AGENT-GUIDE.md` § "Closeout".
- Readers of the grouping-node convention: `.claude/commands/itt/run.md` (Action 6) and `.claude/skills/campaign/references/close-contract.md`.
