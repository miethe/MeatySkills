# Delivery Report Contract

Manifest-driven, like `feature-report`: author a data file, render deterministically. Never let the
model free-write the final HTML — that is how unverifiable claims get in. The validator is the
honesty mechanism and runs before every render.

## Top-level shape

```yaml
schema_version: "1.0"
report:
  route: program            # feature | program | phase | readiness
  title: "..."
  subject: "..."            # repo/program name (forward routes); use `project` for feature route
  revision: 2               # increment on every re-render of the same report
  generated_from: { repo: /abs/path, ref: origin/main, commit: 263120b }
  truth_status: verified    # verified | partially_verified | not_executed | owner_data_absent | branch_local | shipped
  generated_by: "delivery-report 0.1.0"
  generated_at: "2026-07-23"
  constraints: "..."        # global invariants injected into every handoff payload
```

Route selects the required body. See `route-policy.md` for the per-route section matrix.

## Evidence hierarchy (both routes)

Prefer direct, current evidence in this order:

1. Exact commit/tree and repository status.
2. Test, lint, build, migration, or validation command output.
3. Tier-appropriate reviewer verdict bound to that exact tree.
4. Deployment, release, tag, PR, or runtime receipt.
5. Product screenshots or deterministic output captures.
6. Plans, trackers, and narrative records.
7. Inference, explicitly labeled as inference.

Plans and agent summaries never override contradictory git, test, reviewer, or deployment evidence.
**A status report that reads only the default branch systematically under-reports in-flight work** —
run `git log <default>..<branch>` for every active branch (`partial` kind).

## Forward routes — items, vitals, corrections, domains

- **`vitals[]`** — 4–6 headline numbers. **Every vital must cite `measured_by`** (the command or
  method that produced it). A headline number with no method is an assertion, and validation rejects it.
- **`items[]`** — every reportable thing, one of six closed kinds. Each carries 1–3 `domains` from
  the closed vocabulary and (for open kinds) a handoff. See `handoff-contract.md`.
- **`corrections[]`** — first-class. When re-rendering a report whose earlier revision made a claim
  now known wrong, state what was claimed, what is actually true, and how it was verified. Silently
  fixing a number across revisions destroys the reader's ability to trust any of them.
- **`domains{}`** — a closed, project-configurable vocabulary (name → group). Closed matters: free
  text stops being filterable. Rendered as three colour families (build / knowledge / governance),
  not one colour per domain — the grouping is the signal.

## Feature route — the retrospective single-feature contract

| Field | Rule |
|---|---|
| `report.truth_status` | A non-final label (`partially_verified`, `not_executed`, …) renders a visible DRAFT banner. |
| `executive_summary` | Problem, solution, present outcome, residual truth in 3–6 sentences. |
| `problem` / `solution` | Problem without jargon; solution as changed behaviour before architecture. |
| `value_adds[]` | Name the beneficiary and practical improvement; reference evidence IDs. |
| `changes[]` | `plain_english` before optional `technical_detail`. |
| `findings[]` | Surprises, constraints, tradeoffs, rejected assumptions. Exact status. |
| `validation[]` | Record what actually ran. Never convert "not available" into `passed`. Mark `verified_by: self \| delegated \| unverified`. |
| `followups[]` | **Handoff-shaped objects** (a completion report whose follow-ups cannot be dispatched is a dead end). Bare strings are tolerated with a warning. |
| `evidence[]` | Every reusable proof gets a stable ID referenced from claims; paths existence-checked when the repo is present. |

## Honesty discipline (both routes)

1. **Existence-check every referenced path**, not just media.
2. **"How this was measured" on every vital.**
3. **Separate "verified by me" from "reported by a subagent"** — `verified_by` per material claim;
   the renderer surfaces `unverified`. Delegated research is not self-verifying; spot-check it.
4. **State verification limits explicitly.** Say what you could not confirm rather than implying
   full coverage.
5. **Domain-specific overclaim guards** cannot live in the renderer — see `templates/overclaim-addendum.md`.
6. **No automated evidence collection yet.** Neither this skill nor `feature-report` runs the gates
   it reports on; every `passed` is hand-authored. Run the gate, paste real output, record *when*.

## Plain-English test

A reader who did not do the work should be able to answer: what is the state, what is blocked and on
whom, what is the next concrete action on each open item, and how do we know. If those need the diff,
rewrite the summary and the vitals.
