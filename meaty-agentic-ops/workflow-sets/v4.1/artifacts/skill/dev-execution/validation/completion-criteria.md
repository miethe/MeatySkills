# Completion Criteria

Definition of done for stories, features, and tasks.

## Mandatory Reviewer Gates

Every feature requires a reviewer-agent gate at the checkpoints below. Phases and sprints are **not
complete** without the reviewer pass listed. **What is mandatory is that a gate fires — not that a
fixed set of lenses fires at it.** The lens count is risk-tiered.

### The base gate — one lens, every tier

| Tier | Gate | Reviewer | Inputs |
|------|------|----------|--------|
| 0 | end of the change | `task-completion-validator` | AC + touched files |
| 1 | end of sprint | `task-completion-validator` | contract + diff + Completion Report |
| 2 | end of each phase | `task-completion-validator` | failure summary (on a re-pass) + touched files + AC in question |
| 2 | end of feature | `karen` (final tree, once) | AC matrix + cumulative diff |
| 3 | end of each phase | `task-completion-validator` | failure summary (on a re-pass) + touched files + AC in question |
| 3 | end of feature | `karen` (final tree, once) | AC matrix + cumulative diff |
| 3 | plan-milestone boundary — **`context_class` C3/C4 only** | `karen` | AC matrix + cumulative diff |

**Invariant**: This is non-optional. A phase/sprint cannot be marked complete until the reviewer at
the listed checkpoint has approved.

**The ordinary shape is: implement → tests → one review → ship.** For most work — CRUD, UI,
reporting, read paths, mechanical refactors — the table above is the *entire* gate structure. No
pre-gate, no second lens, no per-phase `karen`.

### The second lens — three triggers, nothing else

A **second** lens (`security`, run via `council-review`) is added to a phase's gate only when that
phase matches one of exactly three triggers:

| Trigger | The phase's surface… |
|---|---|
| `untrusted-input` | **parses input the caller controls** (deserialization, request/query parsing, path or filename handling, template rendering with caller data, regex over caller input, uploads, URL/host parsing, archive extraction) |
| `authz-boundary` | **is an authorization or identity boundary** (authorize/RBAC/policy/permission/guard, identity/principal/actor/session/tenant, tokens/nonces/confirmation/replay, isolation/sandbox/subprocess/tool-permission, secrets/credentials/redaction) |
| `irreversible-outward` | **has an irreversible effect, or leaves the system** (publish/deploy, send to an external service, PR or issue creation, force-push, schema migration, secret rotation, data deletion, preview/writeback "must-not-execute" surfaces, CAS/atomicity/single-writer durability) |

Full ruleset, row-by-row signals, and the surface vocabulary: `references/gate-risk-classes.md` §2.
The classification is recorded per phase as `gate_lens` + `gate_lens_reason`, and **a two-lens phase
with no named trigger is a classification error, not a cautious default.**

**Tier does not add lenses.** A Tier 3 CRUD phase gets one lens; a Tier 2 authorization phase gets
two. This is deliberate: tier sizes the *work*, the triggers size the *risk*, and conflating them
made `karen` (opus) the reviewer for every phase of every Tier 3 plan regardless of intent.

**Never removable.** Once a trigger assigns the `security` lens, no budget, merge, or cost pressure
removes it (`references/gate-risk-classes.md`, "The hard invariant"). Where a one-lens default and a
triggered phase conflict, the `security` lens is the one that survives — not the `validator`.

**Reviewers do not add lenses either.** Neither `karen` nor `task-completion-validator` dispatches
follow-on reviewers; each returns a verdict. The plan decides the lens count, not the reviewer.

**Delta context, not the full stack** (execution-doctrine.md rule 2). Per-phase `task-completion-validator`
gates carry the delta — the failure summary, the touched files, and the AC actually in question — never
the full plan, the cumulative diff, or the progress file. `karen`'s whole-tree reality-check is the one
legitimate exception: it keeps the cumulative diff, but trades "full plan" for the AC matrix so the
packet stays bounded to what's actually being judged. A reviewer that needs the whole plan to judge one
AC is a signal the AC is under-specified — fix the AC, do not widen the packet.

**Gate budget** (execution-doctrine.md rule 1): max **2 re-passes** per scope × lens. The 3rd failure
against the same scope × lens does not escalate to "a human/Opus looks at it" — it **auto-escalates to
re-scope/redesign**. Re-passes count per scope × lens, not per dispatch: re-spawning the executor does
not reset the budget. This is a hard cap, not an expectation — see `references/gate-risk-classes.md`
§4 for the cost calibration it bounds.

**Same-class stop rule** (execution-doctrine.md rule 1, hard): if **two consecutive rounds surface the
same defect class**, the next action is a **design change — not a third review**, even with a re-pass
left in the budget. Recurrence of a class means the review is rediscovering an expanding diff rather
than verifying a bounded route. Name each round's defect class as you go; you cannot apply this rule
if you never labelled the classes. What the design change concretely is:
`references/gate-risk-classes.md` §3b (surface reduction before guard proliferation). Two rounds
finding *different* classes is normal review progress and does not trigger it.

**Tier 1's Completion Report is a different artifact from the retired plan-level one.** The Tier 1 row
above still carries a Completion Report because Tier 1 has no wave/phase record to fall back on — see
the "### Completion Report" section under Tier 1 Sprint Completion below, and `dev-execution/SKILL.md`'s
Exit Criteria note. The Tier 2/3 **plan-level** Completion Report (`.claude/worknotes/<slug>/completion-report.md`)
is **retired**: the reviewer verdict + `commit_refs` is the record for those tiers (execution-doctrine.md,
Bookkeeping demotions).

See `.claude/rules/delegation-modes.md` (Mode E: Reviewer) for reviewer agent specifications and constraints.

### Rich Feature Report Definition-of-Done

At the **end-of-feature** gate, apply the `delivery-report` (route `feature`) eligibility policy.
Dev-execution Tier 2/3 features require a validated rich report; Tier 1 features at 5+ points or with
visible, cross-component, security, migration, high-risk, or material-finding signals are recommended.
An explicit user request always makes the report required. Phase-only gates do not emit duplicate
reports when the parent feature report covers them.

The reviewer runs:

```bash
DELIVERY_REPORT_TIER_SYSTEM="dev-execution" DELIVERY_REPORT_TIER="${FEATURE_TIER:-0}" \
DELIVERY_REPORT_POINTS="${FEATURE_POINTS:-0}" DELIVERY_REPORT_SIGNALS="${FEATURE_SIGNALS:-}" \
DELIVERY_REPORT_MANIFEST="${DELIVERY_REPORT_MANIFEST:-}" DELIVERY_REPORT_HTML="${DELIVERY_REPORT_HTML:-}" \
DELIVERY_REPORT_ASSET_ROOT="${DELIVERY_REPORT_ASSET_ROOT:-.}" \
    .claude/skills/dev-execution/hooks/verify-delivery-report.sh
```

| Result | Gate |
|---|---|
| Required + manifest/HTML present and `delivery-report validate` passes | PASS |
| Required + missing or invalid report | **FAIL — withhold APPROVED** |
| Recommended/optional + no report | PASS with recommendation/status recorded |
| Required + explicit `DELIVERY_REPORT_WAIVER_REASON` | WARN/pass; reviewer must quote the waiver in the final report |

The report is derived evidence, not the completion authority. It must preserve exact git, test,
review, deployment, and owner-held/private-execution truth. Place it in the repository's native
completion-artifact directory, or `.claude/reports/<feature-slug>/` when no convention exists.

Once rendered, `hooks/publish-report.sh` (PF-3 M3) MAY host the report in the atlas capsule store
and link it onto the bound IntentTree node (see `SKILL.md` § "Hosts both `dossier` lifecycle
hooks" table). This is **recommended / non-blocking** — the reviewer never withholds `APPROVED`
because publish/link failed or was skipped (offline atlas, unbound tree, missing `itt` verb, etc.
all degrade to a logged no-op). It stays on the non-blocking side of this DoD row, distinct from
the `verify-delivery-report.sh` gate above.

### Forward Status Reports (recommended, non-blocking)

The `feature` route above is the only **required** report gate. Its three forward-looking siblings —
`delivery-report` routes `program` (end of a plan/epic), `phase` (end of a wave/phase), and
`readiness` (a go/no-go decision) — are **recommended, never blocking**. They are point-in-time
snapshots of work in flight, not completion authority, so:

- A reviewer **never** withholds `APPROVED` because a forward report is absent. There is no
  `verify-*.sh` gate for them by design.
- Produce one when a shareable, evidence-backed status artifact is wanted (a milestone, a stakeholder
  ask, a go/no-go). Skip for a quick conversational status.
- The lifecycle → route map and the command touch-points live in `dev-execution/SKILL.md`
  § "Forward-Looking Status Reports", the two `/dev:execute-*` commands, `/plan:explore` (readiness),
  and the planning skill's "Status & Readiness Reporting" section.

Record a produced forward report's HTML path in the closeout / tracker like any other artifact; do not
add a DoD row for it.

### AOS Writeback Definition-of-Done (gate, not prose — audit P3.9)

A phase is **not done** until its work has landed back in the Agentic OS. This is a **reviewer gate**,
not a remembered step: the reviewer MUST run the writeback check and withhold `APPROVED` on a FAIL.

The reviewer runs, with the bound node/tree resolved per `.claude/rules/intenttree-integration.md`:

```bash
ITT_NODE_ID="${ITT_NODE_ID:-}" INTENTTREE_TREE="${INTENTTREE_TREE:-}" \
    .claude/skills/dev-execution/hooks/verify-writeback.sh   # exit 1 ⇒ withhold APPROVED
```

The reviewer additionally runs, for any phase that built/updated a skill/agent/command/context
artifact, the sibling **SkillMeat save-after** gate (aos-native-by-default P3; D2/D6 — the
executor's look-first instruction is instruct-only per `dev-execution/SKILL.md`'s executor
contract, this is the enforced check):

```bash
PHASE_FILES="${PHASE_FILES:-}" SKILLMEAT_PROJECT="${SKILLMEAT_PROJECT:-}" \
    .claude/skills/dev-execution/hooks/verify-skillmeat-writeback.sh   # exit 1 ⇒ withhold APPROVED
# or: --files-from <progress-or-plan-file>  (reads tasks[].files_affected / files_affected:)
```

| Signal | How verified | Gate |
|---|---|---|
| Bound IntentTree node is `completed` | `verify-writeback.sh` (`itt node get` status) | **HARD** — FAIL (exit 1) blocks APPROVED when a binding exists |
| New AI artifact is checked-for-reuse + saved/updated in SkillMeat enterprise | `verify-skillmeat-writeback.sh` (`skillmeat show` against the enterprise instance) | **HARD** — FAIL (exit 1) blocks APPROVED when a new artifact path is present, `SKILLMEAT_PROJECT` resolves, and the endpoint is reachable |
| AAR / story captured | reviewer confirms the Stop-event writeback hook ran (or `op story scan` shows the entry) | reviewer-confirmed |
| Decisions ingested to the vault | reviewer confirms `meatywiki` ingest (Stop hook) for any decisions the phase made | reviewer-confirmed |

**No-binding escape hatch:** in a repo with no AOS binding (`ITT_NODE_ID`/`INTENTTREE_TREE` unset), the
IntentTree gate is **N/A and passes** — it never blocks a non-AOS project. When `itt` is unreachable
the gate cannot verify and does not block, but the reviewer records writeback as *unverified*.
Likewise, the SkillMeat gate is **N/A and passes** when the phase built no new AI artifact, and
**WARN (unverified, non-blocking)** when the `skillmeat` CLI is missing, `SKILLMEAT_PROJECT` cannot
be resolved, or the enterprise endpoint is unreachable — it never blocks on infra unavailability,
only on a confirmed missing registration.

### Ephemeral Artifact Teardown Definition-of-Done

A plan/feature is **not done** until any artifact it provisioned only for its own duration has been
undeployed — the teardown half of Pre-Execution Artifact Provisioning
(`dev-execution/SKILL.md`'s "Pre-Execution Artifact Provisioning" section). This is a **reviewer
gate**, same posture as the AOS Writeback DoD above: the reviewer runs the provisioning gate in
teardown mode and withholds `APPROVED` on a FAIL.

```bash
PROVISION_TEARDOWN=1 PROVISION_SCOPE="plan:<slug>" \
    .claude/skills/dev-execution/hooks/provision-artifacts.sh   # nonzero (non-2) ⇒ withhold APPROVED
```

| Signal | How verified | Gate |
|---|---|---|
| Plan-scoped `lifecycle: ephemeral` artifacts in `.claude/aos-artifacts.yaml` are undeployed | `provision-artifacts.sh --teardown` (`skillmeat undeploy` against the scope) | **HARD** — FAIL blocks APPROVED when the manifest lists a plan-scoped ephemeral still `status: active` after teardown |
| Artifacts also referenced elsewhere as `permanent`, or with a different/wider `scope`, are left deployed | reviewer confirms via the manifest diff (teardown run is scope-filtered, not a blanket undeploy) | reviewer-confirmed |

**No-manifest escape hatch:** in a repo/plan with no manifest and no ephemeral entries, this gate is
**N/A and passes** — nothing was provisioned, so there is nothing to tear down. When SkillMeat is
unreachable the gate cannot verify and does not block; the reviewer records teardown as *unverified*.

---

## Reviewer Output Template

Reviewer agents must produce a structured report using this template:

```markdown
# Review Report: [Feature/Branch Name]

## Recommendation
[Approve / Approve with minor fixes / Request changes / Block]

## Confidence
[High / Medium / Low] — Brief rationale for confidence level

## Summary
[Concise assessment of overall implementation quality and adherence.]

## Contract Adherence
- Status: [Pass / Partial / Fail]
- Notes: [Details on which acceptance criteria passed/failed, scope drift if any]

## Required Fixes
1. [Blocking issue and fix needed]
2. [Additional blocking issues]

## High-Risk Concerns
- [High-risk issue that may be non-blocking but requires attention]
- ["None identified." if applicable]

## Test/Validation Assessment
- Tests claimed: [List tests agent reported running]
- Tests verified: [Tests confirmed to exist and be relevant]
- Missing tests: [Gaps in coverage, edge cases without tests]

## Architecture / Maintainability Notes
- [Pattern conformance or drift]
- [Code quality observations]

## Scope Drift
- [None / Details of what was added/removed vs. contract]

## Documentation Updates Needed
- [README, CHANGELOG, context files, ADRs, or "None"]

## AOS Writeback DoD (P3.9)
- [verify-writeback.sh (IntentTree): PASS / FAIL / N-A (no binding) / UNVERIFIED (itt offline)]
- [node completed? AAR/story captured? decisions ingested? — a FAIL blocks APPROVE]
- [verify-skillmeat-writeback.sh (SkillMeat): PASS / FAIL / N-A (no new artifact) / UNVERIFIED (CLI missing, project unresolved, or enterprise unreachable) — a FAIL blocks APPROVE]

## Ephemeral Artifact Teardown DoD
- [provision-artifacts.sh --teardown: PASS / FAIL / N-A (no manifest / no ephemerals) / UNVERIFIED (SkillMeat unreachable) — a FAIL blocks APPROVE]

## Rich Feature Report DoD
- [verify-delivery-report.sh: PASS / FAIL / RECOMMENDED / WAIVED — a required missing/invalid report blocks APPROVE]
- [manifest path, HTML path, eligibility tier/size, and any exact waiver reason]

## Final Decision
[One-line merge recommendation: "APPROVE" / "REQUEST CHANGES" / "BLOCK — <reason>"]
```

---

## Test-Rigor Acceptance Criteria

> **Namespace note.** `R1`/`R2`/`R3` here are **test-rigor ACs**. They are unrelated to `R1`–`R9` in
> `references/gate-risk-classes.md`, which are **risk classes** for reviewer-lens selection. Two
> different R-namespaces, deliberately not renamed (cross-file churn for a cosmetic win); read the
> file you are in.

**R3 is standing — it applies to every feature.** R1 and R2 are **conditional**: mandatory when their
trigger applies. A phase/sprint is not complete without whichever apply.

### R3 — One end-to-end pass through the real entry point, early (standing)

**Every feature ships at least one test that exercises the product through its own real entry point** —
the actual CLI command, HTTP route, page, or public API a user or caller reaches — not only through
units, mocks, or components in isolation.

**Land it early: before the first reviewer gate, not as the last task.** This is a cheap standing
requirement, **not a gate** — nothing blocks on it beyond the ordinary DoD — but its value is almost
entirely in the timing. An e2e pass written after implementation confirms what you already believe; the
same test written first finds the wiring that was never connected. On the run that motivated this rule,
one early e2e pass through the real entry point would have caught **half of the first review round's
findings** — findings that instead cost a full review cycle each.

- **"Real entry point" means the one the caller uses.** If shipping a CLI subcommand, invoke the CLI.
  If shipping an endpoint, issue the request. If shipping UI, render through the actual parent route
  or page. Reaching the leaf function directly is a unit test, however integrated it feels.
- **One is enough.** This is not a mandate for an e2e suite. One pass along the primary path, plus the
  narrow tests that actually localize failures (execution-doctrine rule 5).
- **It composes with R2**, which is the stricter conditional form for wiring/dual-surface work.
- **A green unit suite does not satisfy it.** That is precisely the failure mode: 64 isolated tests
  passed while the feature was invisible in production (see R2).

### R1 / R2 — conditional

**R1 — Real-session test (transaction/session/dedup tasks).** Any task touching DB transactions, sessions, savepoints, rollback, or dedup MUST ship ≥1 test against a **real session** (in-memory SQLite suffices for savepoint/rollback semantics), not only `MagicMock(spec=Session)`. Mocks have no transaction state and silently pass on `rollback()`-vs-`begin_nested()` bugs. *(Retro P1: a full-`rollback()` savepoint bug passed all mock tests; caught only by a real-SQLite savepoint test.)*

**R2 — Production-path presence (wiring/dual-surface tasks).** Any task whose AC is "feature X is reachable from surface Y" MUST ship a test that renders/exercises through the **real production entry point** (the actual parent component or call site) and asserts the feature is **present** — not only a component-in-isolation test. Validators MUST trace from the real entry point, not the leaf unit. **A test asserting the feature is *absent* is a smell**, not a passing case. *(Retro P4: an extract button was invisible in production because parents never threaded `parentArtifactId`; 64 isolated tests passed, one even asserted the broken behavior as correct.)*

---

## Story Completion

A user story is complete when:

### Implementation

- [ ] All acceptance criteria met
- [ ] All files in plan created/modified
- [ ] Code follows project architecture
- [ ] No `// TODO` comments left behind

### Testing

- [ ] Unit tests added for new logic
- [ ] Integration tests for API flows
- [ ] **≥1 e2e pass through the real entry point, landed before the first reviewer gate** (test-rigor `R3`, standing)
- [ ] E2E tests for critical user paths
- [ ] Negative test cases included
- [ ] All tests passing
- [ ] **Mutation flows verified against the datastore (Postgres/API read), not the DOM** — optimistic caches and stale renders lie; assert the row/response (CC v3.1 doctrine; see `visual-fidelity.md` R14)

### Quality

- [ ] TypeScript strict mode, no `any`
- [ ] Lint errors resolved
- [ ] Build succeeds
- [ ] No regressions introduced

### Documentation

- [ ] API docs updated if endpoints added
- [ ] Code comments where logic isn't self-evident
- [ ] README updated if applicable

### Review

- [ ] Code reviewed by senior-code-reviewer
- [ ] Feedback addressed

### Tracking

- [ ] PR created and linked to story
- [ ] Progress tracker shows "complete"
- [ ] Request-log item marked done (if applicable)

## Feature Completion (Quick Feature)

A quick feature is complete when:

### Implementation

- [ ] Feature works as described
- [ ] Follows existing patterns
- [ ] No breaking changes

### Quality Gates

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` succeeds

### Tracking

- [ ] Quick plan updated to `status: completed`
- [ ] Request-log item marked done (if from REQ-ID)
- [ ] Issues captured if discovered

## Task Completion

An individual task is complete when:

### Core Criteria

- [ ] Task description fulfilled
- [ ] Success criteria from plan met
- [ ] Files modified as expected

### Code Quality

- [ ] No TypeScript errors
- [ ] Lint clean
- [ ] Tests pass

### Architecture Compliance

- [ ] Follows layered architecture
- [ ] Uses proper patterns (DTOs, ErrorResponse, etc.)
- [ ] Telemetry/logging added where appropriate

### Commit

- [ ] Changes committed with descriptive message
- [ ] References task ID in commit
- [ ] **`git status` clean against the expected file set before pausing/handing off** — in CC v3.1 a single file missed its phase commit and sat dirty for a session; reconcile the working tree against intended changes at every pause

## Tier 1 Sprint Completion

A Tier 1 feature sprint is complete when:

### Implementation

- [ ] Feature Contract authored and approved
- [ ] All Acceptance Criteria from the contract are satisfied (verified)
- [ ] All Validation Requirements from the contract are satisfied

### Testing & Validation

- [ ] Unit tests added for new logic
- [ ] Integration tests for API flows (if applicable)
- [ ] **≥1 e2e pass through the real entry point, landed before the validator gate** (test-rigor `R3`, standing)
- [ ] All tests passing (`pnpm test`, `pytest`, etc.)
- [ ] TypeScript strict mode, no `any`
- [ ] Lint errors resolved
- [ ] Build succeeds
- [ ] No regressions introduced

### Documentation

- [ ] API docs updated if endpoints added
- [ ] Code comments where logic isn't self-evident
- [ ] README updated if applicable
- [ ] CHANGELOG entries added (if required by Feature Contract)

### Completion Report

> This is the Tier 1 **contract-appended** Completion Report — it survives (execution-doctrine.md,
> Bookkeeping demotions; `dev-execution/SKILL.md` Exit Criteria note). It is a different artifact from
> the Tier 2/3 **plan-level** Completion Report (`.claude/worknotes/<slug>/completion-report.md`), which
> is **retired**: for those tiers the reviewer verdict + `commit_refs` is the record instead.

- [ ] Completion Report appended to Feature Contract with:
  - Files changed
  - Tests run and results
  - Validation results
  - Deviations from contract (if any) — sourced from `.claude/worknotes/<slug>/implementation-notes.md`:
    per execution-doctrine.md's "Implementation notes over halt-and-gate", deviations (a conservative
    choice, an assumption, a discovered constraint) are logged there continuously with rationale and
    reviewed at the milestone boundary; this bullet is the summarized record of the survivors at
    contract close, not a re-derivation from scratch
  - Risks/limitations
  - Follow-up recommendations

### Review & Merge

- [ ] `task-completion-validator` review completed and approved (mandatory gate)
- [ ] Review Report confirms all acceptance criteria passed
- [ ] Opus commits changes

---

## Phase Completion

See [./milestone-checks.md] for full phase completion criteria.

Summary:
- [ ] All tasks completed
- [ ] All success criteria met
- [ ] All tests passing
- [ ] Quality gates passed
- [ ] Documentation updated
- [ ] Progress tracker at 100%
- [ ] All commits pushed
- [ ] **Reviewer pass complete per the Mandatory Reviewer Gates matrix above** (Tier 2/3: `task-completion-validator` per phase; `karen` at feature end; Tier 1: already covered above)
- [ ] **End-of-feature rich report gate passed** when the feature meets `delivery-report` (route `feature`) tier/size eligibility; phase-only closeout does not duplicate the parent report

## Validation Templates

### Task Validation

```
@task-completion-validator

Task: {task_id}

Expected outcomes:
- {outcome 1}
- {outcome 2}

Files changed:
- {file list}

Validate:
1. Acceptance criteria met
2. Architecture patterns followed
3. Tests exist and pass
4. No regression
```

### Story Validation

```
@task-completion-validator

Story: ${story_id}

Acceptance criteria from story:
- {criterion 1}
- {criterion 2}

Implementation summary:
- Backend: {what was done}
- Frontend: {what was done}
- Tests: {coverage}

Validate complete implementation.
```

### Phase Validation

```
@task-completion-validator

Phase ${phase_num} FINAL VALIDATION

Failure summary (if this is a re-pass): ${failure_summary}
Touched files: ${touched_files}
AC in question: ${ac_in_question}

Validate:
1. All tasks complete
2. Success criteria met
3. Tests passing
4. No critical issues
5. Ready for next phase
```

Delta context per execution-doctrine.md rule 2 — never `Plan: ${plan_path}` or `Progress: ${progress_file}`
in full. A reviewer that needs the whole plan/progress file to validate one phase is a signal the phase's
ACs are under-specified; fix the ACs, do not widen the packet.

## Common Completion Blockers

### What Blocks Completion

| Issue | Resolution |
|-------|------------|
| Tests failing | Fix before marking complete |
| Type errors | Resolve all TypeScript issues |
| Missing acceptance criteria | Implement missing functionality |
| Unresolved comments | Address all review feedback |
| Breaking changes | Add migration or compatibility |

### When to NOT Mark Complete

Never mark complete if:
- Tests are failing for your changes
- Implementation is partial
- You encountered unresolved errors
- Required files/deps not found
- Review feedback not addressed

### When Blocked

If truly blocked:

1. Document blocker clearly
2. Keep status as `in_progress` or `blocked`
3. Create tracking issue
4. Report to user with:
   - What's blocking
   - What was attempted
   - What's needed to unblock
