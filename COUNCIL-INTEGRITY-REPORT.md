# Council payload-integrity fix — completion report

Branch: `fix/council-payload-integrity` (base `8972ded`, stacked on
`fix/workflow-upstream-neutral-roster-note-and-council-envelope`).
Worktree: `/Users/miethe/dev/homelab/development/MeatySkills/.worktrees/sm-council-integrity`

## Defect

`review-council.js`'s `decisionRecordPrompt` and `adjudicationPrompt` truncated the JSON
findings payload with a bare `.slice(0, 5000)` / `.slice(0, 4000)` — no truncation marker, no
count assertion. The 2026-08-08 rescue run (`.claude/findings/council-run-20260808-p1-rescued/`
in skillmeat) received complete detail for 3 of 10 accepted findings, a 4th truncated
mid-sentence, and nothing after — and honestly reported the 4 survivors as the whole population,
because it had no way to tell "truncated" from "that's everything". Count reconciliation
(`total_findings_claimed` / `findings_not_received`) asks the model to notice its own loss and
self-report a number in free prose; the rescue's own ad-hoc reconciliation keys
(`total_findings_expected_per_run_summary` / `findings_not_delivered`) were silently dropped by
`COUNCIL_VERDICT_SCHEMA`'s `additionalProperties:false`, so even an honest self-report would not
have reached `execute-plan.js`.

## Fix

An id roster computed **before** the (possibly truncated) findings payload is sent, and a
script-side, model-free set-difference check (`assessPayloadIntegrity`) against what the writer
echoes back — independent of the model noticing anything.

## Commits (in this worktree, MeatySkills upstream)

1. `8e8e02c` — `fix(review-council): id-roster fail-closed check for truncated findings payloads`
   `meaty-agentic-ops/workflows/review-council.js`
   - `COUNCIL_VERDICT_SCHEMA.summary` gains `expected_finding_ids` / `delivered_finding_ids`.
   - `decisionRecordPrompt` emits the roster before the findings payload; instructs the writer
     to echo `delivered_finding_ids`.
   - New `formatFindingsForPrompt()` replaces both bare slices — always emits the complete
     id/title/severity roster first, then as much full JSON as fits the budget, with a loud
     `...TRUNCATED:` marker when anything is cut.
   - New pure `assessPayloadIntegrity(expectedIds, verdict)`, next to `gateApproved`.
   - Return path: non-empty missing-id set ⇒ `status:'needs_opus'`,
     `reason:'council_payload_incomplete'` (distinct from `council_not_approved` — incomplete
     payload needs re-dispatch, not a fix loop), missing ids in the envelope.
   - `run_dir_prefix` default: `'runs'` → `'.claude/council-runs'`.

2. `e781e87` — `fix(execute-plan): route council_payload_incomplete to gate-integrity, never fixLoop`
   `meaty-agentic-ops/workflows/execute-plan.js`
   - `assessCouncilVerdict`'s existing `needs_opus`/`blocked` branch now surfaces
     `missing_finding_ids` in the integrity-failure message.
   - Added a belt-and-braces `expected_finding_ids`/`delivered_finding_ids` set-difference check
     directly on `summary.*`, for a stale deployed `review-council.js` elsewhere in the fleet
     that reports `status:'complete'` with a truncated payload.

3. `e9226a3` — `docs(review-council-spec): document new run_dir_prefix default`
   `meaty-agentic-ops/specs/workflows/review-council-workflow-spec.md` (`:77`, `:304`).

4. (agentic_meta_dev repo, separate commit `a238fa8` on `main`) —
   `test(workflow-gate-integrity): add Defect 11 — council payload-integrity id roster`
   `tests/test_workflow_gate_integrity.py` — 8 new tests: 6 static/AST assertions (schema fields,
   prompt wiring, distinct reason, `run_dir_prefix` default, `execute-plan.js` consuming end) +
   `_extract_js_function` helper + the mandatory positive control.

## Out of scope (per brief)

- `agentic_meta_dev/.claude/skills/council-review/` docs (SKILL.md, references/) — orchestrator's.
- `sync_project_workflows.py` — not run; propagation to deployed copies (skillmeat and 12 other
  repos) is the orchestrator's stacking/PR job. No PR, no merge, no push performed here.
- `workflow-sets/v3.5|v4.1` sibling copies — explicitly out of scope per the scoping report.

## Evidence

- `.council-evidence/positive-control-green.txt` — `test_assess_payload_integrity_positive_control`
  passing against the fix as committed: `assessPayloadIntegrity(10 expected, 4 delivered)` returns
  exactly `{F-5..F-10}`; a fully-delivered verdict (`2 expected, 2 delivered`) returns `[]` (no
  false positive).
- `.council-evidence/revert-check-output.txt` — the same test run with `assessPayloadIntegrity`
  temporarily stubbed to always return `[]` (simulating the pre-fix bug). Confirmed **red**
  (`AssertionError: ... got []`), then the stub was reverted via `git checkout --` and the full
  91-test suite (83 pre-existing + 8 new) re-confirmed green.
- `node --check` (via `syntax-check-helper.js`'s async-IIFE + meta-strip recipe): both modified
  workflow scripts pass.
- Four-constraints re-check on the touched hunks: `grep` for FS/shell calls
  (`readFile|writeFile|execSync|spawn`) and `Date.now()`/`Math.random()` in the diff — zero hits.
  Reviewer agentTypes unchanged (still `karen`, `task-completion-validator`).

## Residuals / follow-ups for the orchestrator

- Run `sync_project_workflows.py --check` then (unforced) apply, to propagate into skillmeat and
  the rest of the fleet; expect skillmeat's `execute-plan.js` roster hunk (2 lines) to survive as
  the documented per-deployment exemption.
- `agentic_meta_dev/.claude/skills/council-review/SKILL.md:24-25`,
  `references/output-contract.md:46`, `references/run-workflow.md:17,55,60` — update `runs/` →
  `.claude/council-runs/` (deferred to orchestrator per brief scope).
- The new test's `_DEFAULT_UPSTREAM_ROOT` points at this worktree
  (`MeatySkills/.worktrees/sm-council-integrity/meaty-agentic-ops/workflows`), which will not
  exist once the branch merges and the worktree is removed. Flip to `REVIEW_COUNCIL`/
  `EXECUTE_PLAN` (the deployed-copy constants, matching Defect 9/10's pattern) once
  `sync_project_workflows.py` has propagated this fix — TODO comment left in the test file.
- No PR opened against `origin`/`ibm-main` for the MeatySkills branch — stacking coordination
  with the unmerged parent branch is the orchestrator's, per brief.
