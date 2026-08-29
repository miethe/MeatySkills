/**
 * reviewer-gate — the mandatory reviewer gate, as a schema'd workflow stage.
 *
 * Spec:      .claude/specs/workflows/workflow-authoring-spec.md (master contract)
 * Patterns:  .claude/skills/dev-execution/orchestration/workflow-patterns.md (`reviewerGate`)
 * Ruleset:   .claude/skills/dev-execution/references/gate-risk-classes.md §2 (lens selection)
 * Matrix:    .claude/skills/dev-execution/validation/completion-criteria.md
 *
 * WHY THIS EXISTS
 * ---------------
 * `execute-plan` and `execute-contract` already run their reviewer as a schema'd stage. Every
 * OTHER gate in the engine did not: the Tier-0, scaffold, plan-level and ad-hoc/milestone gates
 * were documented as a bare in-session `Task("task-completion-validator", "...")` returning the
 * free text `APPROVED` / `CHANGES_REQUESTED`. That form has three failure modes, and all three
 * were observed on live runs:
 *
 *   1. **The orchestrator blocks in-line.** A bare Agent call is awaited by the main loop. A
 *      reviewer that goes slow or silent stalls the whole session, and there is nothing to read
 *      while it does — the run looks identical to a run that is thinking.
 *   2. **The verdict is unparsed prose.** Nothing forces the reviewer to emit a decision at all.
 *      It can ramble, run out of turns, or end mid-thought, and the orchestrator is left
 *      inferring approval from vibes.
 *   3. **A dead reviewer looks like a quiet one.** No verdict and a rejected verdict are the
 *      same observable (nothing useful came back), so a gate that never ran can be mistaken for
 *      a gate that passed.
 *
 * This workflow fixes all three by construction. What it does NOT do — stated plainly so nobody
 * builds on a promise that isn't here: **there is no wall-clock timeout.** `agent()` exposes no
 * deadline, and a workflow script cannot impose one. The fix is not "the reviewer is killed after
 * N seconds"; it is:
 *
 *   - **The verdict is a validated tool call.** `schema: VERDICT_SCHEMA` forces a StructuredOutput
 *     call and the tool layer makes the agent retry on mismatch. A reviewer cannot finish without
 *     emitting a decision, so "slow" is the only failure left — "ambiguous" is gone.
 *   - **A silent reviewer becomes a recorded failure, not an empty pass.** `agent()` returns null
 *     when the subagent dies on a terminal error after retries. Null is converted into an explicit
 *     `verdict_source: 'gate_failure'` verdict with `approved: false` and a named reason, and it is
 *     `log()`-ed. A gate that could not run NEVER reads as approved, and it never reads as an
 *     ordinary rejection either — the two are distinguishable fields.
 *   - **The wait is observable and out-of-line.** Workflows run in the background: a stalled lens
 *     sits visibly in `/workflows` progress under a named phase instead of freezing the main loop,
 *     and the orchestrator keeps its context.
 *   - **No silent lens fallback.** An unrecognized lens name is a gate failure, not a `||` default.
 *     A `||` fallback to an agent that did not exist is exactly how a "5-lens" council silently
 *     reviewed 4 (2026-08-03 agent-roster-drift AAR).
 *   - **An unverified approval is not an approval** (R3, 2026-08-06). The dominant delegate defect
 *     class in the workflow-v41 window was a green suite over a path production does not take, and
 *     the second was a leg self-reporting a side effect it never performed. So `verification_path`
 *     is a REQUIRED schema field, an approving verdict without an established path is converted
 *     into a `gate_integrity_failure`, and any `self_reported_claims` entry downgrades the
 *     approval to a rejection. Prompt text alone was not enough: the whole failure class consists
 *     of confident reports that satisfied every instruction they were given.
 *
 * CONSUMPTION
 * -----------
 *   Standalone (the common case — any gate outside execute-plan/execute-contract):
 *     Workflow({ name: 'reviewer-gate', args: { scope: {...}, lenses: ['validator'], ... } })
 *
 *   As a sub-workflow: permitted, but only from a TOP-LEVEL workflow (nesting is one level only).
 *   `execute-plan`/`execute-contract` keep their own inline reviewer stages — they already
 *   satisfy this contract, and `execute-plan` conditionally nests `review-council` (ONLY when
 *   execute-plan itself owns the one permitted nesting level — see execute-plan.js's
 *   runCouncil()/`graph.nested` guard; execute-plan is itself a child workflow when invoked by
 *   auto-feature.js, in which case it degrades to a bounded inline council instead of calling
 *   workflow() at all). Re-routing either engine through here would consume a nesting level
 *   neither can assume it owns. This script therefore never calls `workflow()` itself.
 *
 * Four-constraints checklist:
 *   [x] No FS/shell access in script body
 *   [x] Mode D — n/a: this workflow spawns only edit-less reviewers and mutates nothing
 *   [x] All reviewer agents use edit-less agentType (LENS_REVIEWER_MAP, all in .claude/agents/)
 *   [x] No Date.now() / Math.random() / new Date() in script body (timestamps come from args)
 *   [x] meta is a pure literal object
 *   [x] phase() titles match meta.phases exactly
 *   [x] No implementation agents dispatched → no durability/commit instruction needed
 */

// ─── meta (pure literal — no computed values, no function calls) ──────────────

export const meta = {
  name: 'reviewer-gate',
  description: 'The mandatory reviewer gate as a schema\'d workflow stage: runs one or two edit-less reviewer lenses in parallel, forces each verdict through a validated StructuredOutput call, and converts a silent or dead reviewer into an explicit recorded gate failure instead of an in-line hang. Use for any gate outside execute-plan/execute-contract — Tier 0, scaffold, plan-level, milestone, or ad-hoc re-pass.',
  phases: [
    // Measure runs BEFORE Review: the reviewer's test scope and the baseline delta are
    // inputs to its judgment, not commentary on it. phase() titles must match these
    // exactly (authoring constraint).
    { title: 'Measure' },
    { title: 'Review' },
  ],
  whenToUse: 'Any mandatory reviewer gate that is not already inside execute-plan or execute-contract: /dev:quick-feature Tier 0 close, /dev:create-feature scaffold close, the plan-level whole-tree pass, a milestone gate, or a fresh-context re-pass on a delta. Pass lenses chosen by gate-risk-classes.md §2 — one lens by default, a second only with a named trigger.',
}

// ─── inline schemas (script cannot read files — constraint 1) ─────────────────

// The verdict every lens must emit. Deliberately compatible with execute-plan.js /
// execute-contract.js VERDICT_SCHEMA so a verdict is portable across all three gates:
// same `approved` / `reviewer_type` / `required_fixes` / `defect_class` semantics.
const VERDICT_SCHEMA = {
  type: 'object',
  required: ['approved', 'reviewer_type', 'summary', 'verification_path'],
  additionalProperties: false,
  properties: {
    approved: { type: 'boolean' },
    reviewer_type: {
      type: 'string',
      enum: [
        'task-completion-validator',
        'karen',
        'senior-code-reviewer',
        'code-reviewer',
      ],
    },
    // One-line statement of what was judged and how it came out. Required so an approving
    // verdict still carries evidence of having looked at something.
    summary: { type: 'string' },
    required_fixes: { type: 'array', items: { type: 'string' } },
    // The stable class label the same-class stop rule reads (execution-doctrine.md rule 1 /
    // gate-risk-classes.md §3b). Omit rather than guess — an absent class never trips the rule.
    defect_class: { type: 'string' },
    // Acceptance criteria the reviewer actually checked, and its per-AC call. An approving
    // verdict with an empty list is the shape a rubber-stamp takes, and is visible here.
    ac_verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['criterion', 'met'],
        additionalProperties: false,
        properties: {
          criterion: { type: 'string' },
          met: { type: 'boolean' },
          evidence: { type: 'string' },
          // AC-3 (validation-scope hardening). The tests this criterion actually rests on,
          // with the status the reviewer observed. A sibling of R3, not an extension of it:
          // R3 PRESUPPOSES green and asks whether the green path is production's path;
          // this asks the prior question — is the supporting test passing at all? A reviewer
          // can establish perfect path-equivalence for a RED test and approve, so R3 cannot
          // cover this. `applyTestStatusRules` rewrites met:true → met:false when every
          // supporting test is in {failed,xfailed,errored,skipped,not-run}.
          //
          // The status here is a CLAIM. It is cross-checked against the measured per-file
          // counts, because the whole R3 lineage exists because claims got read as evidence
          // (risk R7) — a claimed `passed` contradicted by the measurement is itself a finding.
          supporting_tests: {
            type: 'array',
            items: {
              type: 'object',
              required: ['nodeid', 'status'],
              additionalProperties: false,
              properties: {
                nodeid: { type: 'string' },
                status: {
                  type: 'string',
                  enum: [
                    'passed',
                    'failed',
                    'xfailed',
                    'xpassed',
                    'skipped',
                    'errored',
                    'not-run',
                  ],
                },
              },
            },
          },
        },
      },
    },
    // R3 (verification-path evidence gate, 2026-08-06 workflow-v41 retro). A green suite is
    // evidence about the path THE SUITE takes; the dominant delegate defect class was a suite
    // that exercised a path production does not take — an offline fake echoing `system` where
    // the live API returns `source_system`, a branch made dead by an earlier step but still
    // unit-tested directly, a dry-run validating preconditions `apply` does not. Five
    // occurrences in one program. So the reviewer must NAME how it established the path, and
    // an approving verdict that cannot is handled as a gate-integrity failure below — not as
    // an approval, and not as an ordinary rejection either.
    verification_path: {
      type: 'object',
      required: ['established', 'kind'],
      additionalProperties: false,
      properties: {
        established: { type: 'boolean' },
        kind: {
          type: 'string',
          enum: [
            'live-smoke',
            'path-equivalence',
            'real-endpoint-field-check',
            'production-callsite-trace',
            'not-established',
          ],
        },
        // The entry point production actually takes to reach the changed code.
        production_entrypoint: { type: 'string' },
        // The command transcript / file:line pair / response body that proves it.
        evidence: { type: 'string' },
      },
    },
    // Claims the reviewer had to accept on a leg's own word because no artifact backed them.
    // Any entry here blocks approval by construction: "I registered the node / wrote the file /
    // updated the row" is a claim, and five misreporting findings in seven days came from
    // reading one as evidence.
    self_reported_claims: { type: 'array', items: { type: 'string' } },
    // Set when the reviewer could not judge an AC at all (missing evidence, unreadable
    // surface). Distinct from `required_fixes`: this is "I could not tell", not "this is wrong".
    unverifiable: { type: 'array', items: { type: 'string' } },
  },
}

// ─── lens → reviewer routing (no silent fallback) ─────────────────────────────
//
// Every value MUST be an edit-less agent present in .claude/agents/ (constraint 3);
// tests/test_workflow_agent_roster.py fails the build on a phantom name.
// `karen-final-tree-only` is a PLACEMENT of the karen lens (one whole-tree pass per feature),
// not a different reviewer — gate-risk-classes.md § "Karen placement".

const LENS_REVIEWER_MAP = {
  validator: 'task-completion-validator',
  security: 'senior-code-reviewer',
  karen: 'karen',
  'karen-final-tree-only': 'karen',
}

// ─── lens → execution capability (D1, node_01M08FAYAGN5QYF77C1ZVA146B) ────────
//
// Whether a lens's underlying agent can run Bash/tests/scripts at all determines whether it
// can independently establish a `live-smoke` / `real-endpoint-field-check` verification_path,
// or observe a cited test's real status. A lens with no execution capability that reports
// `not-run` for a cited test is reporting a limit of ITS OWN judgment, not a finding about the
// code — treating that report as a defect (the pre-fix behaviour) makes a `[security, ...]`
// gate structurally unapprovable regardless of code quality (see the node for three live
// rounds of exactly this failure). This map is NOT derived from agent definitions at runtime
// (constraint 1 — no FS access from the script body): it is a hand-maintained mirror, and it
// WILL go stale silently if an agent's tool grants change without a matching edit here.
//
//   validator (task-completion-validator): disallowedTools = Write, Edit, MultiEdit only —
//     Bash is available (.claude/agents/reviewers/task-completion-validator.md). Can run and
//     observe a cited test itself.
//   security (senior-code-reviewer): disallowedTools EXPLICITLY includes Bash
//     (.claude/agents/reviewers/senior-code-reviewer.md) — cannot run anything. This is the
//     defect this map exists to fix.
//   karen / karen-final-tree-only: disallowedTools = Write, Edit, MultiEdit only — Bash is
//     available (.claude/agents/reviewers/karen.md), exactly like the validator lens. `true`.
//
// This map states TOOL AVAILABILITY and nothing else. It was briefly set `karen: false` as a
// "conservative" choice on the reasoning that karen only ever judges a whole tree and is never
// paired with `security`. Both halves were wrong, and the value is load-bearing in BOTH
// directions, so a wrong entry is never merely cautious:
//
//   - too lenient: a `false` lens's `not-run`-only criteria are excused into `unverifiable`
//     instead of rejecting, and its honest `established:false` can be delegated away. For a lens
//     that CAN run the test, both are a free pass on work it simply did not do.
//   - too strict: `establishingLens` counts only lenses whose capability is `=== true`, so a
//     `false` karen that genuinely established a `live-smoke` path does not satisfy any OTHER
//     lens's delegation. gate-risk-classes.md §2 assigns `[security, karen]` to the
//     `irreversible-outward` class (and `[security, validator, karen]` to `authz-boundary`), so
//     with `karen: false` a `[security, karen]` gate has NO eligible establishing lens and
//     security's honest `established:false` becomes an integrity failure — reintroducing exactly
//     the unapprovable-gate defect this map exists to fix, on the pairing the node named as
//     recurring next (registrar-hardening M2, the undeploy destructive guard).
const LENS_EXECUTION_CAPABILITY = {
  validator: true,
  security: false,
  karen: true,
  'karen-final-tree-only': true,
}

// Appended to a non-executing lens's prompt (D1). Stops it from reporting an execution gap in
// ITS OWN judgment as though it were a finding about the code, and from claiming a verification
// path kind that requires running something.
const NON_EXECUTING_LENS_ADDENDUM = `NO EXECUTION CAPABILITY — this lens cannot run Bash/tests/scripts (see LENS_EXECUTION_CAPABILITY
in the gate script). Because of that:
  - Never set \`verification_path.kind\` to \`live-smoke\` or \`real-endpoint-field-check\` — both
    require running something, which you cannot do. \`path-equivalence\` and
    \`production-callsite-trace\` are still open to you: both are read-only code tracing.
  - The MEASURED STATUSES supplied to you below (if any) are ESTABLISHED FACTS about a test's
    real outcome, not something you have to run to know. If the measurement shows a cited
    nodeid as \`passed\`, cite it as \`passed\` — you did not run it, but its status is not unknown
    to you. Only report \`not-run\` for a nodeid the measurement itself does not cover.
  - For a criterion whose verification depends on running something you cannot run AND that the
    measurement does not cover: put it in \`unverifiable\` with a concrete "what would settle
    it" (e.g. "an executing lens runs \`tests/test_foo.py::test_bar\` and reports the real
    status"). Do not mark it not-met for lack of YOUR OWN execution capability — that is a gap
    in what you personally can prove, not evidence the behaviour is broken or missing.
  - STAGED ARTIFACTS are your route to first-hand verification of an EXECUTION side effect.
    Where the gate supplies "Staged evidence artifacts" below, those are files the orchestrator
    wrote BEFORE this gate ran, holding the verbatim output/content itself. Reading one with
    Read is a direct observation of the artifact — it is NOT taking a leg's word — so a claim
    a staged artifact substantiates does NOT belong in \`self_reported_claims\`. Read them.`

const LENS_BRIEF = {
  validator:
    'AC-mapping lens. For each acceptance criterion, decide met / not-met and name the concrete evidence (a real command transcript, a file:line, a test name). A green suite is NOT evidence on its own — it can sit over a defect on a path nobody tested, so for every criterion resting on tests you must establish and name the verification path (see the VERIFICATION-PATH RULE below). Never accept a fabricated or absent transcript; if evidence is missing, list the criterion under `unverifiable` rather than marking it met.',
  security:
    'Adversarial defect-finding lens. Trace the code, do not read the claims. Hunt fail-open defaults (check the PRODUCER of a value, not just the field), the soft delegate/caller/sibling of anything just hardened, tests that pin unsafe behaviour, and hardening that is unreachable from the path production takes. You are not doing AC bookkeeping — that is the validator lens.',
  karen:
    'Whole-tree reality-check lens. Judge what actually works end-to-end against what is claimed complete. Do not dispatch further reviewers — return your own verdict.',
  'karen-final-tree-only':
    'Whole-tree reality-check lens, scoped to the final assembled tree. Judge what actually works end-to-end against what is claimed complete. Do not dispatch further reviewers — return your own verdict.',
}

// ─── the R3 evidence rules, verbatim in every lens prompt ────────────────────
//
// Stated as prompt text AND enforced mechanically below (applyEvidenceRules). The prompt is
// what lets a reviewer comply; the enforcement is what makes non-compliance visible instead
// of approving. Grounding: docs/project_plans/reports/workflow-v41-delegate-retro-2026-08-06.md
// (leg B — 8 delegate-bug + 5 misreporting findings in 7 days, one dominant signature).

const EVIDENCE_RULES = `VERIFICATION-PATH RULE — a green suite is evidence about the path THE SUITE takes, never about
the path production takes. Before you treat any criterion as met on the strength of tests,
establish which ONE of these you actually saw, and name it in \`verification_path\`:
  - live-smoke ................. the real entry point run against the real dependency, output shown
  - path-equivalence ........... the seam the test drives IS the object production calls — name both
                                 call sites (file:line) and show they resolve to the same thing
  - real-endpoint-field-check ... every field/key name in a fake checked against a real response or
                                 schema (observed: a fake echoed \`system\` where the live API
                                 returns \`source_system\` — all tests green, feature could not work)
  - production-callsite-trace ... you traced production's entry point to the changed code and it is
                                 reachable (observed: a branch made dead by an earlier
                                 comment-stripping step, still covered by its own unit tests)
If none of the four holds, the criterion is NOT met and the suite is not evidence for it. Check the
dry-run/apply split too: a dry-run that validates a different precondition set than \`apply\` is the
same defect wearing a different hat. Set \`verification_path.established\` true ONLY for one of the
four kinds — withholding it costs nothing, and an approving verdict without it is recorded as a
gate-integrity failure rather than an approval.

SELF-REPORT RULE — never accept a leg's, a report's, or a summary's statement that a side effect
happened as evidence that it happened. "I registered the node / wrote the file / updated the row /
published the artifact" is a claim; the evidence is the artifact itself — the row, the file on
disk, the response body, the diff hunk. Verify each one yourself, or list it in
\`self_reported_claims\`, which blocks approval by construction.

STAGED-ARTIFACT RULE — the counterpart to the SELF-REPORT RULE, and the ONLY sanctioned way an
execution side effect becomes verifiable to a lens that cannot execute. When the gate supplies
"Staged evidence artifacts", each entry names a file the orchestrator wrote BEFORE the gate ran,
containing the verbatim artifact — the command transcript, the row, the response body, the diff
hunk. Reading that file yourself IS first-hand verification for the claim it carries: the SELF-REPORT
RULE names "the file on disk" as evidence, and this is that file. So:
  - Read every staged artifact whose claim bears on a criterion you are judging. Do not skip one
    and then list its claim as self-reported — the artifact was staged precisely so you need not.
  - A claim SUBSTANTIATED by a staged artifact you actually read does NOT go in
    \`self_reported_claims\`. Cite the artifact path as the evidence in \`ac_verdicts\`.
  - A staged artifact that is MISSING, empty, unreadable, or that does not actually show what its
    claim says it shows substantiates NOTHING. Say so explicitly, and the claim goes back to
    \`self_reported_claims\` (or the criterion to \`unverifiable\`) exactly as before. A path in
    this list is a pointer, never a promise — the file's CONTENT is the evidence, and an
    artifact that fails to substantiate its claim is a finding in its own right, not a neutral.`

// ─── the validation-scope rules, verbatim in every lens prompt ────────────────
//
// Grounding: skillmeat PR #299 (2026-08-09). A feature-sprint-executor changed
// `_dto_to_response()` in artifacts/crud.py and validated by running only the test file it
// had also edited. This gate returned approved:true, required_fixes:[], 4/4 ACs met. Two
// defects sat inside the blast radius and were invisible to it:
//   1. tests/test_enterprise_artifact_upstream.py was UNTOUCHED by the diff and asserted the
//      exact fail-open behaviour the change removed (3 failed / 15 passed). Never run.
//   2. The file it DID run is ~61-red at base, so red there carried no signal at all.
// Structurally: a fix is scoped per FILE, but the tests for a behaviour are scoped per
// BEHAVIOUR and live wherever that behaviour is exercised. The diff is the wrong index into
// the test suite. Hence: for TEST SELECTION the scope is the resolved scope below, while the
// existing "do not widen your reading" instruction still governs reading cost.

const VALIDATION_SCOPE_RULES = `TEST-SCOPE RULE — your scope for READING is the changed files above, but your scope for TEST
SELECTION is the resolved scope below, which is deliberately WIDER. It was computed by
symbol reference: every test file that names a symbol this diff changed, including files the
diff never touched. A test file can assert the exact behaviour a change removes without
appearing in the diff at all — that is the defect this gate exists to catch, and "the files I
edited" can never see it. Do not narrow the test scope back to the diff.

BASELINE-DELTA RULE — a red test file proves nothing on its own if it was ALREADY red. Judge
regressions by the measured per-file delta below (base counts vs head counts, and the set of
node ids failing at head that were not failing at base), never by the absolute red count. A
file that is 61-red at base and 61-red at head has told you nothing; a file that gained one
NEW failing node id has told you everything. Conversely: a test that stopped being collected
at head ran NOWHERE, so it cannot evidence anything, and its absence LOWERS the failure count —
if the measurement reports a collected-regression or a disappeared node id, treat it as a
regression, never as an improvement.

NON-LOCAL-FIX RULE — a required_fix must be something an implementer can discharge locally,
pre-merge, with the tools they have right now. "Prove the GitHub Actions workflow runs green on
GitHub's infrastructure", "verify once CI runs", "confirm after the merge" are NOT
required_fixes — nobody can satisfy them before merging, and a fix cycle spent trying is a fix
cycle burned on nothing. If the only way to settle something is post-merge CI or remote
infrastructure, say so in \`unverifiable\` instead of writing it as a required_fix; the gate
strips a matching required_fix mechanically and, if it was your only one, records the verdict as
a gate-integrity failure rather than an actionable rejection.

RED-TEST-AC RULE — never mark an acceptance criterion met on the strength of a test that is
failing, xfailing, erroring, skipped, or was never run. List each criterion's real support in
\`ac_verdicts[].supporting_tests\` as {nodeid, status}, using the measured status below rather
than your expectation of it. A criterion whose only support is red is NOT met: say so, with
the node ids and their statuses as the reason. Every status you report is cross-checked against
the measurement, and a claimed status the measurement contradicts is itself recorded as a
finding — so report what was measured, not what should have been true.

MEASUREMENT-INTEGRITY RULE — if the measurement below is absent, failed, or reports a
truncated scope, say so plainly and do NOT compensate by approving on the narrower evidence.
An unmeasurable scope makes affected criteria \`unverifiable\`, never met.`

// ─── helpers (pure functions — no primitives called here) ─────────────────────

function asList(value) {
  if (!value) return []
  return Array.isArray(value) ? value.filter(v => v != null && v !== '') : [value]
}

function bullets(items, emptyText) {
  const list = asList(items)
  if (!list.length) return `  (${emptyText})`
  return list.map(item => `  - ${item}`).join('\n')
}

/**
 * Render one `evidence_artifacts[]` entry for the reviewer prompt.
 *
 * The contract is deliberately permissive on SHAPE and strict on MEANING. An entry may be a
 * bare path string, or `{path, claim}` naming the side effect the file substantiates. Anything
 * else is stringified rather than dropped: a malformed entry the reviewer can still see is
 * safer than a silently swallowed one, because the reviewer's fallback (list the claim under
 * `self_reported_claims`) is the SAFE direction. Nothing here asserts the file exists — this
 * script cannot read the filesystem, and must never imply it verified something it did not.
 * The reviewer reads the file; an absent or non-substantiating artifact is its finding to make.
 */
function describeEvidenceArtifact(entry) {
  if (entry && typeof entry === 'object') {
    const path = entry.path || entry.file || '(no path given)'
    return entry.claim ? `${path} — substantiates: ${entry.claim}` : String(path)
  }
  return String(entry)
}

/**
 * Defensive parse of a value that may arrive as an object OR as a JSON-encoded string.
 * The args channel has been observed delivering a string where an object was expected
 * (see the gateArgs parse below, and plan OQ-2), and this script cannot read files — the
 * measurement blob can only arrive through args, so it needs the same defence.
 */
function parseMaybeJson(value) {
  if (value == null) return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (err) {
    log(`Advisory: validation_evidence arrived as a string that is not valid JSON (${err && err.message}); treating the measurement as ABSENT rather than guessing at its shape.`)
    return null
  }
}

/**
 * Normalize a validation-scope evidence blob (the output of
 * `.claude/skills/dev-execution/hooks/validation-scope.sh`) into the shape this gate
 * enforces on. Everything is derived defensively: a malformed blob degrades to
 * `evidence_present: false`, which the enforcement path treats as a gate-integrity
 * failure — NOT as a clean full-scope run. A missing measurement must never be the
 * cheaper option than a failing one.
 */
function normalizeMeasurement(raw) {
  const blob = parseMaybeJson(raw)
  if (!blob || typeof blob !== 'object') {
    return {
      evidence_present: false,
      reason: 'no validation_scope evidence supplied to the gate',
      files_run: [],
      scope_truncated: false,
      scope_status: null,
      regressions: [],
      measurement_failures: [],
      status_by_nodeid: {},
    }
  }

  const scope = blob.scope || blob
  const measurements = asList(blob.measurements)
  const filesRun = measurements.map(m => m && m.file).filter(Boolean)

  // A regression is a NEW failing node id, a collected-regression, or a disappeared node —
  // all three are "this change made things worse", and only the first is visible in counts.
  const regressions = []
  const measurementFailures = []
  const statusByNodeId = {}

  for (const m of measurements) {
    if (!m || typeof m !== 'object') continue
    if (m.measurement_failure) {
      measurementFailures.push({ file: m.file || '(unnamed)', reason: m.failure_reason || 'unspecified' })
      continue
    }
    for (const nodeid of asList(m.newly_failing_node_ids)) {
      regressions.push({ file: m.file, nodeid, kind: 'newly-failing' })
      statusByNodeId[nodeid] = 'failed'
    }
    for (const nodeid of asList(m.disappeared_node_ids)) {
      regressions.push({ file: m.file, nodeid, kind: 'no-longer-collected' })
      statusByNodeId[nodeid] = 'not-run'
    }
    if (m.collected_regression && !asList(m.disappeared_node_ids).length) {
      regressions.push({ file: m.file, nodeid: null, kind: 'collected-regression' })
    }
    // Measured statuses, so a reviewer's claimed status can be contradicted (risk R7).
    const nodeStatuses = (m.head && m.head.node_status) || m.node_status || null
    if (nodeStatuses && typeof nodeStatuses === 'object') {
      for (const [nodeid, status] of Object.entries(nodeStatuses)) {
        if (typeof status === 'string') statusByNodeId[nodeid] = status
      }
    }
  }

  return {
    evidence_present: true,
    reason: null,
    files_run: filesRun,
    scope_truncated: Boolean(scope.scope_truncated) || Boolean(scope.budget_exhausted),
    scope_status: scope.scope_status || null,
    omitted_files: asList(scope.omitted_files),
    test_scope: asList(scope.test_scope),
    regressions,
    measurement_failures: measurementFailures,
    status_by_nodeid: statusByNodeId,
  }
}

/** The measurement rendered for the reviewer prompt. Never a bare "see attached". */
function measurementBrief(measurement) {
  if (!measurement.evidence_present) {
    return `  (NO MEASUREMENT AVAILABLE — ${measurement.reason}. Treat every criterion resting on tests as \`unverifiable\`; do not approve on the narrower diff-scoped evidence.)`
  }
  const lines = []
  lines.push(`  scope_status: ${measurement.scope_status || 'unknown'}${measurement.scope_truncated ? '  ⚠ TRUNCATED — affected criteria are `unverifiable`, never met' : ''}`)
  lines.push(`  test files in resolved scope (${measurement.test_scope.length}): ${measurement.test_scope.join(', ') || '(none)'}`)
  lines.push(`  test files actually measured (${measurement.files_run.length}): ${measurement.files_run.join(', ') || '(none)'}`)
  if (measurement.omitted_files && measurement.omitted_files.length) {
    lines.push(`  ⚠ omitted from scope by a bound: ${measurement.omitted_files.join(', ')}`)
  }
  if (measurement.measurement_failures.length) {
    lines.push(`  ⚠ MEASUREMENT FAILED on ${measurement.measurement_failures.length} file(s) — these are not "0 failed":`)
    for (const f of measurement.measurement_failures) lines.push(`      ${f.file}: ${f.reason}`)
  }
  if (measurement.regressions.length) {
    lines.push(`  ⚠ ${measurement.regressions.length} REGRESSION(S) vs the base commit:`)
    for (const r of measurement.regressions) {
      lines.push(`      [${r.kind}] ${r.nodeid || r.file}`)
    }
    lines.push('    Each of these is worse-than-base. You may not approve over one without naming it.')
  } else {
    lines.push('  no regressions vs base (no new failing node ids, nothing stopped being collected)')
  }
  return lines.join('\n')
}

/**
 * Reviewer prompt. Carries the DELTA only, per execution-doctrine.md rule 2:
 * the failure summary (re-pass only), the touched files, and the ACs in question.
 * Never the full plan, never the cumulative diff, never the progress file.
 */
function reviewPrompt(args, lens, reviewerType, measurement) {
  const scope = args.scope || {}
  const isRepass = Boolean(args.failure_summary)
  const canExecute = LENS_EXECUTION_CAPABILITY[lens] !== false

  return `${LENS_BRIEF[lens]}
${canExecute ? '' : `\n${NON_EXECUTING_LENS_ADDENDUM}\n`}

You are the **${lens}** lens on the mandatory reviewer gate for: ${scope.title || scope.id || 'the change under review'}
Scope kind: ${scope.kind || 'change'}${scope.tier != null ? ` (tier ${scope.tier})` : ''}${scope.id ? `\nScope id: ${scope.id}` : ''}${args.plan_ref ? `\nPlan/contract ref: ${args.plan_ref}` : ''}${args.timestamp ? `\nGate timestamp: ${args.timestamp}` : ''}
${isRepass ? `\nThis is a RE-PASS. What the previous round rejected:\n${args.failure_summary}\n` : ''}
Acceptance criteria in question:
${bullets(args.acceptance_criteria, 'none supplied — say so in `unverifiable` rather than inventing criteria')}

Files changed (this is the scope of your READING — do not widen it; your TEST-SELECTION scope is
the wider resolved scope in the measurement below):
${bullets(args.files_changed, 'none supplied')}

Measured validation scope and base→head delta:
${measurementBrief(measurement)}
${asList(args.evidence_refs).length ? `\nEvidence the implementer offered (verify it, do not trust it):\n${bullets(args.evidence_refs, '')}\n` : ''}${asList(args.evidence_artifacts).length ? `\nStaged evidence artifacts — files written BEFORE this gate ran, holding the verbatim artifact.\nReading one is FIRST-HAND verification for the claim it carries (see the STAGED-ARTIFACT RULE):\n${bullets(asList(args.evidence_artifacts).map(describeEvidenceArtifact), '')}\n` : ''}${args.notes ? `\nOperator notes:\n${args.notes}\n` : ''}
Read the code and the evidence. Run read-only commands where they settle a question.

${EVIDENCE_RULES}

${VALIDATION_SCOPE_RULES}

You MUST end by calling StructuredOutput exactly once with your verdict:
  - approved: true only if every acceptance criterion above is met AND you found no blocking defect.
  - reviewer_type: "${reviewerType}".
  - summary: one line — what you judged and how it came out.
  - required_fixes: one entry per blocking item, each specific enough to act on without you.
  - defect_class: a short stable label for the dominant defect class when rejecting (e.g.
    "fail-open-default", "untested-path", "missing-ac-evidence"). Omit it rather than guessing —
    a wrong label mis-fires the same-class stop rule.
  - ac_verdicts: one entry per acceptance criterion, with the evidence you actually saw.
  - unverifiable: criteria you could not judge, and why.
  - verification_path: established / kind / production_entrypoint / evidence, per the
    VERIFICATION-PATH RULE above. Required on every verdict, approving or not.
  - self_reported_claims: every claim you had to take on a leg's word for lack of an artifact.
  - ac_verdicts[].supporting_tests: {nodeid, status} per criterion, using the MEASURED status
    above. A criterion supported only by red/absent tests must be met:false with the node ids
    named as the reason — the gate enforces this and will downgrade a met:true that violates it.

Do NOT write, edit, or commit anything — you are an edit-less reviewer. Do NOT dispatch other
agents. Do NOT report approval you cannot evidence: withholding approval is cheap, and a
rubber-stamp is the one outcome this gate cannot recover from.`
}

/** The verdict synthesized when a lens produced nothing. Never mistakable for a real one. */
function gateFailureVerdict(lens, reviewerType, reason) {
  return {
    approved: false,
    reviewer_type: reviewerType,
    verdict_source: 'gate_failure',
    lens,
    gate_failure_reason: reason,
    summary: `Gate FAILED TO RUN on the ${lens} lens (${reviewerType}): ${reason}`,
    required_fixes: [
      `The ${lens} lens produced no verdict (${reason}). This is NOT an approval and NOT an ordinary rejection — the gate did not run. Re-dispatch this lens, or record an explicit operator override, before treating the scope as reviewed.`,
    ],
  }
}

// ─── R3 enforcement: an unverified approval is not an approval ────────────────

// Only these four are a path. 'not-established' is deliberately absent: it is the reviewer
// saying it could not do this, which is honest and must not read as satisfaction of the rule.
const VERIFICATION_KINDS = new Set([
  'live-smoke',
  'path-equivalence',
  'real-endpoint-field-check',
  'production-callsite-trace',
])

/** Why an approving verdict fails the verification-path rule, or null when it passes. */
function verificationGap(verdict) {
  const vp = verdict.verification_path
  if (!vp) return 'no verification_path on an approving verdict — the gate cannot tell whether the evidence exercises the path production takes'
  if (vp.established !== true) return `verification_path.established is ${JSON.stringify(vp.established)} (kind '${vp.kind}') on an approving verdict — the reviewer approved without establishing the production path`
  if (!VERIFICATION_KINDS.has(vp.kind)) return `verification_path.kind '${vp.kind}' is not one of the four real paths (${[...VERIFICATION_KINDS].join(' | ')}) — established:true is unsupported`
  return null
}

/**
 * D4 (AC2, node_01M08FAYAGN5QYF77C1ZVA146B round 2). `approved:false` with every AC `met:true`,
 * nothing `unverifiable`, no `required_fixes`, and no `self_reported_claims` names no defect at
 * all — an orchestrator cannot run a fix cycle against a finding nobody made. Runs BEFORE
 * `applyEvidenceRules`/`applyTestStatusRules` on the RAW lens verdict, because it is a shape
 * check on what the lens itself emitted, not a consequence of downstream enforcement.
 *
 * Deliberately does NOT fire on the legitimate self-reported-side-effect downgrade
 * (`applyEvidenceRules`'s `claims.length` branch): that downgrade only ever runs on a verdict
 * that arrived `approved:true` (its own guard is `!verdict.approved` → return unchanged) and
 * `self_reported_claims` non-empty, whereas this rule requires `approved:false` on the RAW
 * verdict AND `self_reported_claims` empty — the two conditions cannot both hold for the same
 * verdict, so the checks are structurally disjoint rather than ordered around each other.
 */
function applyIncoherenceRule(verdict) {
  if (verdict.verdict_source !== 'reviewer') return verdict
  if (verdict.approved !== false) return verdict

  const acVerdicts = asList(verdict.ac_verdicts)
  if (!acVerdicts.length) return verdict
  if (!acVerdicts.every(ac => ac && ac.met === true)) return verdict
  if (asList(verdict.unverifiable).length) return verdict
  if (asList(verdict.required_fixes).length) return verdict
  if (asList(verdict.self_reported_claims).length) return verdict

  const reason = `INCOHERENT_VERDICT_SHAPE: the ${verdict.lens} lens (${verdict.reviewer_type}) returned approved:false with every one of ${acVerdicts.length} acceptance criterion(a) met:true, no unverifiable entries, no required_fixes, and no self_reported_claims — this shape names no actionable defect.`
  log(`GATE INTEGRITY FAILURE on the ${verdict.lens} lens: ${reason}`)
  return {
    ...verdict,
    approved: false,
    verdict_source: 'gate_integrity_failure',
    defect_class: 'incoherent-verdict-shape',
    integrity_reason: reason,
    summary: `Gate INTEGRITY FAILURE on the ${verdict.lens} lens (${verdict.reviewer_type}): ${reason}`,
    required_fixes: [
      `The ${verdict.lens} lens returned an unactionable verdict shape (INCOHERENT_VERDICT_SHAPE): rejected with every AC met, nothing unverifiable, and no required fixes named. Re-dispatch this lens for an actual finding, or record an explicit operator override. Do NOT run a fix cycle against a defect nobody named.`,
    ],
  }
}

/**
 * The two R3 rules, applied to a real verdict. Their outcomes differ deliberately:
 *
 *   - self-reported side effects ⇒ an ordinary REJECTION. The missing artifact is implementer
 *     work, so a fix cycle is exactly the right next action.
 *   - an unverified approval ⇒ a GATE-INTEGRITY failure, mirroring execute-plan.js
 *     gateIntegrityResult(). The verdict exists but cannot be trusted, and what did not finish
 *     is the REVIEWER — a fix cycle would edit blind against a finding nobody made.
 *
 * D3 (AC1, node_01M08FAYAGN5QYF77C1ZVA146B). Exception to the second rule: a lens with no
 * execution capability (LENS_EXECUTION_CAPABILITY) that honestly reports
 * `verification_path.established:false` is not lying or slacking — it is reporting a limit of
 * its own judgment. That is NOT a gate-integrity failure PROVIDED (a) some OTHER, EXECUTING
 * lens in this SAME gate round actually established one of the four real path kinds
 * (`gateContext.anyExecutingLensEstablishedPath`), and (b) this lens declared the criteria it
 * could not settle itself in `unverifiable` rather than silently approving over them. Both
 * conditions must hold — a non-executing lens's bare say-so is not enough on its own; the gate
 * still needs a real path from SOMEWHERE, just not necessarily from this lens.
 */
function applyEvidenceRules(verdict, gateContext = {}) {
  if (verdict.verdict_source !== 'reviewer' || !verdict.approved) return verdict

  const claims = asList(verdict.self_reported_claims)
  if (claims.length) {
    log(`Gate REJECTION on the ${verdict.lens} lens: approved with ${claims.length} self-reported claim(s) and no artifact evidence. Downgrading the approval — a report of a side effect is not the side effect.`)
    return {
      ...verdict,
      approved: false,
      downgraded_from_approval: 'self_reported_side_effect',
      defect_class: verdict.defect_class || 'self-reported-side-effect',
      required_fixes: [
        ...asList(verdict.required_fixes),
        ...claims.map(claim => `Produce artifact evidence — the row, the file on disk, the response body, or the diff hunk — for the side effect reported as "${claim}". A leg's own report of it is not evidence that it happened.`),
      ],
    }
  }

  const gap = verificationGap(verdict)
  if (!gap) return verdict

  const canExecute = LENS_EXECUTION_CAPABILITY[verdict.lens] !== false
  if (!canExecute) {
    const vp = verdict.verification_path
    const honestlyUnestablished = Boolean(vp) && vp.established === false
    const declaredUnverifiable = asList(verdict.unverifiable).length > 0
    if (honestlyUnestablished && declaredUnverifiable && gateContext.anyExecutingLensEstablishedPath) {
      log(`Gate DELEGATION on the ${verdict.lens} lens: no execution capability, honestly declared verification_path.established:false, and named ${asList(verdict.unverifiable).length} unverifiable criterion(a) — the ${gateContext.establishingLens} lens already established a real verification path in this gate round. NOT a gate-integrity failure.`)
      return { ...verdict, verification_path_delegated: gateContext.establishingLens }
    }
  }

  log(`GATE INTEGRITY FAILURE on the ${verdict.lens} lens (${verdict.reviewer_type}): ${gap}. Recording as a gate-integrity failure, NOT as an approval and NOT as a rejection. The caller must NOT run a fix cycle.`)
  return {
    ...verdict,
    approved: false,
    verdict_source: 'gate_integrity_failure',
    integrity_reason: gap,
    summary: `Gate INTEGRITY FAILURE on the ${verdict.lens} lens (${verdict.reviewer_type}): ${gap}`,
    required_fixes: [
      `The ${verdict.lens} lens approved without establishing a verification path (${gap}). This is NOT an approval and NOT an ordinary rejection — what did not finish is the reviewer, not the implementer. Re-dispatch this lens and require one of live-smoke | path-equivalence | real-endpoint-field-check | production-callsite-trace, or record an explicit operator override. Do NOT run a fix cycle: nothing has been found yet.`,
    ],
  }
}

// ─── AC-3 enforcement: an AC backed only by a red test is not met ─────────────

// Statuses that cannot support a criterion. `xpassed` is deliberately ABSENT: it passed,
// however confusingly. `not-run` and `errored` are here because a test that did not run
// carries no information at all — the most common way this gate got fooled.
const NON_SUPPORTING_STATUSES = new Set(['failed', 'xfailed', 'errored', 'skipped', 'not-run'])

/**
 * The reviewer's claimed status for a node id, reconciled against the measurement.
 * The measurement WINS (risk R7): every rule in the R3 lineage exists because a claim got
 * read as evidence. A contradiction is returned so it can be recorded as its own finding
 * rather than silently resolved in the reviewer's favour.
 */
function reconcileStatus(claimed, measurement) {
  const measured = measurement.status_by_nodeid[claimed.nodeid]
  if (!measured || measured === claimed.status) {
    return { nodeid: claimed.nodeid, status: claimed.status, contradicted: false }
  }
  return {
    nodeid: claimed.nodeid,
    status: measured,
    claimed_status: claimed.status,
    contradicted: true,
  }
}

/** D2 (AC3): the "what would settle it" message for an AC deferred to `unverifiable` because
 * this lens has no execution capability and every supporting test is `not-run`. */
function unverifiableExecutionGapMessage(ac) {
  const ids = asList(ac.supporting_tests).map(t => t.nodeid).filter(Boolean).join(', ')
  return `Criterion "${ac.criterion}" cites ${ids || 'a test with no nodeid'} as not-run, but this lens has no execution capability (LENS_EXECUTION_CAPABILITY) and cannot run it itself. What would settle it: an executing lens (e.g. the validator lens) runs the cited test(s) and reports the real status, or the caller supplies validation_evidence covering them.`
}

/**
 * AC-3 + the AC-2 regression check, applied to a real verdict.
 *
 * Outcomes differ deliberately, and the split matters:
 *
 *   - an AC met:true whose supporting tests are all red/absent  ⇒ ordinary REJECTION.
 *     The missing work is implementer-side (make the test pass, or drop the AC), so a fix
 *     cycle is exactly the right next action. `defect_class: 'ac-backed-by-red-test'`.
 *   - a missing/failed measurement, or an approval standing over a measured regression
 *     ⇒ GATE-INTEGRITY failure. The verdict exists but cannot be trusted, and what did not
 *     finish is the REVIEWER (or the measurement), not the implementer — a fix cycle would
 *     edit blind against a finding nobody made. Mirrors applyEvidenceRules' R3 branch.
 *   - D2 (AC3, node_01M08FAYAGN5QYF77C1ZVA146B round 3): an AC met:true whose supporting tests
 *     are non-passing SOLELY because every one is `not-run`, on a lens with no execution
 *     capability ⇒ deferred to `unverifiable`, `met` left as emitted, NO required_fix, NO
 *     `ac-backed-by-red-test`. A lens that cannot run a test did not fail to demonstrate
 *     anything — it reported the limit of its own judgment, and this rule is what stopped that
 *     honest report from auto-flipping into a manufactured defect. NARROW: any ACTUAL failure
 *     status (failed/xfailed/errored/skipped) among the supporting tests still rejects, on
 *     EVERY lens including non-executing ones — only a pure not-run set is exempt.
 */
function applyTestStatusRules(verdict, measurement) {
  if (verdict.verdict_source !== 'reviewer') return verdict

  // Reconcile every claimed status against the measurement, on approving AND rejecting
  // verdicts — a contradicted status is a finding regardless of the verdict it sat in.
  const contradictions = []
  const acVerdicts = asList(verdict.ac_verdicts).map(ac => {
    const supporting = asList(ac.supporting_tests).map(t => {
      const reconciled = reconcileStatus(t, measurement)
      if (reconciled.contradicted) {
        contradictions.push(
          `criterion "${ac.criterion}": reviewer reported ${reconciled.nodeid} as '${reconciled.claimed_status}', the measurement shows '${reconciled.status}'`,
        )
      }
      return reconciled
    })
    return { ...ac, supporting_tests: supporting }
  })

  const canExecute = LENS_EXECUTION_CAPABILITY[verdict.lens] !== false

  // An AC claimed met whose support is entirely non-supporting. An AC with NO declared
  // supporting_tests is left alone here: that is R3/`unverifiable` territory, and inventing
  // a rejection from an empty list would fire on every gate whose scope has no tests at all.
  // Split further (D2/AC3): a non-executing lens whose non-supporting set is PURELY not-run
  // defers to unverifiable instead of rejecting; any actual failure status still rejects.
  const redBacked = []
  const executionGapDeferred = []
  for (const ac of acVerdicts) {
    if (!ac.met) continue
    const supporting = asList(ac.supporting_tests)
    if (!supporting.length) continue
    if (!supporting.every(t => NON_SUPPORTING_STATUSES.has(t.status))) continue
    const allNotRun = supporting.every(t => t.status === 'not-run')
    if (!canExecute && allNotRun) {
      executionGapDeferred.push(ac)
    } else {
      redBacked.push(ac)
    }
  }

  let adjusted = { ...verdict, ac_verdicts: acVerdicts }
  if (contradictions.length) {
    adjusted = { ...adjusted, measured_status_contradictions: contradictions }
    log(`Gate FINDING on the ${verdict.lens} lens: ${contradictions.length} claimed test status(es) contradicted by the measurement. The measurement wins.`)
  }

  if (executionGapDeferred.length) {
    log(`Gate DEFERRAL on the ${verdict.lens} lens: ${executionGapDeferred.length} criterion(a) reported met on not-run-only tests, but this lens has no execution capability — deferring to unverifiable instead of rejecting; \`met\` is left as emitted.`)
    adjusted = {
      ...adjusted,
      unverifiable: [
        ...asList(adjusted.unverifiable),
        ...executionGapDeferred.map(unverifiableExecutionGapMessage),
      ],
    }
  }

  if (redBacked.length) {
    const named = redBacked.map(ac => {
      const ids = asList(ac.supporting_tests).map(t => `${t.nodeid} (${t.status})`).join(', ')
      return `Criterion "${ac.criterion}" was reported MET but every supporting test is non-passing: ${ids}. Make the test pass or drop the criterion — a red test is not evidence for the behaviour it fails to demonstrate.`
    })
    log(`Gate REJECTION on the ${verdict.lens} lens: ${redBacked.length} acceptance criterion(a) reported met on red/absent tests. Rewriting each to met:false.`)
    adjusted = {
      ...adjusted,
      approved: false,
      downgraded_from_approval: verdict.approved ? 'ac_backed_by_red_test' : adjusted.downgraded_from_approval,
      defect_class: adjusted.defect_class || 'ac-backed-by-red-test',
      ac_verdicts: acVerdicts.map(ac =>
        redBacked.includes(ac)
          ? {
              ...ac,
              met: false,
              not_met_reason: `every supporting test is non-passing: ${asList(ac.supporting_tests).map(t => `${t.nodeid} (${t.status})`).join(', ')}`,
            }
          : ac,
      ),
      required_fixes: [...asList(adjusted.required_fixes), ...named],
    }
  }

  // From here on, only APPROVING verdicts can be downgraded to an integrity failure —
  // a rejection already carries the right next action.
  if (!adjusted.approved) return adjusted

  if (!measurement.evidence_present) {
    const gap = `approved with no validation-scope measurement (${measurement.reason}) — the gate cannot tell which test files the change actually affects, nor whether any of them regressed`
    log(`GATE INTEGRITY FAILURE on the ${verdict.lens} lens: ${gap}. NOT an approval, NOT a rejection. Do not run a fix cycle.`)
    return gateIntegrityFrom(adjusted, gap, 'Produce the measurement — run `.claude/skills/dev-execution/hooks/validation-scope.sh` (or pass `validation_evidence`) and re-dispatch this lens. Do NOT run a fix cycle: nothing has been found yet.')
  }

  if (measurement.measurement_failures.length) {
    const files = measurement.measurement_failures.map(f => f.file).join(', ')
    const gap = `approved while the measurement FAILED on ${measurement.measurement_failures.length} file(s) (${files}) — a file whose measurement failed is not a file with zero failures`
    log(`GATE INTEGRITY FAILURE on the ${verdict.lens} lens: ${gap}.`)
    return gateIntegrityFrom(adjusted, gap, `Repair the measurement for ${files} and re-dispatch this lens. A measurement_failure is never '0 failed'.`)
  }

  if (measurement.regressions.length) {
    const named = measurement.regressions.map(r => `[${r.kind}] ${r.nodeid || r.file}`).join(', ')
    const gap = `approved over ${measurement.regressions.length} measured regression(s) vs the base commit: ${named}`
    log(`GATE INTEGRITY FAILURE on the ${verdict.lens} lens: ${gap}. An approval standing over a measured regression is the exact defect this gate was hardened to stop.`)
    return gateIntegrityFrom(adjusted, gap, `Each regression is worse-than-base and must be fixed or explicitly justified: ${named}. Re-dispatch this lens once the delta is clean, or record an explicit operator override.`)
  }

  return adjusted
}

/** Shared shape for a validation-scope integrity failure. Mirrors applyEvidenceRules' branch. */
function gateIntegrityFrom(verdict, gap, fix) {
  return {
    ...verdict,
    approved: false,
    verdict_source: 'gate_integrity_failure',
    integrity_reason: gap,
    summary: `Gate INTEGRITY FAILURE on the ${verdict.lens} lens (${verdict.reviewer_type}): ${gap}`,
    required_fixes: [...asList(verdict.required_fixes), fix],
  }
}

// ─── D5 enforcement: a required_fix must be locally dischargeable pre-merge ───
//
// Grounding: node_01M08FAYAGN5QYF77C1ZVA146B round 3 — a required_fix demanded artifact
// evidence "that the two GitHub Actions workflows actually run green on GitHub's
// infrastructure", which is not establishable by ANY actor, locally, before merge.

const NON_LOCAL_FIX_PATTERNS = [
  /github\s+actions?/i,
  /\bafter\s+(the\s+)?merge\b/i,
  /\bonce\s+(the\s+)?(ci|pipeline|workflow)\s+run/i,
  /\bwait(?:ing)?\s+for\s+(the\s+)?(ci|pipeline|build)\b/i,
  /\bruns?\s+green\s+on\b/i,
  /\bon\s+github\x27?s?\s+infrastructure\b/i,
  /\bremote\s+infrastructure\b/i,
]

function matchesNonLocalFixPattern(fix) {
  return typeof fix === 'string' && NON_LOCAL_FIX_PATTERNS.some(re => re.test(fix))
}

/**
 * D5 (AC4). A required_fix demanding proof of something only observable post-merge on remote
 * infrastructure cannot be discharged by an implementer working locally pre-merge. Matching
 * entries are pulled out of `required_fixes` and recorded separately in
 * `non_dischargeable_fixes`, which is surfaced on the returned envelope (script body) alongside
 * the per-verdict field set here. If that was the verdict's ONLY blocking fix, the verdict
 * becomes a gate-integrity failure — an ordinary rejection needs at least one actionable next
 * step, and one left with none names no path forward, echoing what applyIncoherenceRule polices
 * for the AC shape, applied here to the fix list instead.
 *
 * Applies to any not-approved verdict regardless of verdict_source: gate-authored required_fix
 * text (gate_failure / gate_integrity_failure branches above) never matches these patterns, so
 * this is a no-op on those verdicts in practice, not a special case to guard against.
 */
function applyNonLocalFixRule(verdict) {
  if (verdict.approved) return verdict
  const fixes = asList(verdict.required_fixes)
  if (!fixes.length) return verdict

  const nonLocal = fixes.filter(matchesNonLocalFixPattern)
  if (!nonLocal.length) return verdict

  const remaining = fixes.filter(fix => !matchesNonLocalFixPattern(fix))
  log(`Gate FINDING on the ${verdict.lens} lens: ${nonLocal.length} required_fix(es) demand something undischargeable locally pre-merge — stripping from blocking_fixes: ${nonLocal.join(' | ')}`)

  const updated = {
    ...verdict,
    required_fixes: remaining,
    non_dischargeable_fixes: [...asList(verdict.non_dischargeable_fixes), ...nonLocal],
  }

  if (remaining.length) return updated

  const reason = `every required_fix on the ${verdict.lens} lens demanded something undischargeable locally pre-merge: ${nonLocal.join(' | ')}`
  log(`GATE INTEGRITY FAILURE on the ${verdict.lens} lens: ${reason}. An implementer cannot act on a fix that requires post-merge infrastructure.`)
  return {
    ...updated,
    verdict_source: 'gate_integrity_failure',
    defect_class: 'non-dischargeable-required-fix',
    integrity_reason: reason,
    summary: `Gate INTEGRITY FAILURE on the ${verdict.lens} lens (${verdict.reviewer_type}): every required_fix was undischargeable pre-merge.`,
    required_fixes: [
      `The ${verdict.lens} lens's only required_fix(es) demanded something undischargeable locally pre-merge (${nonLocal.join(' | ')}). Re-dispatch this lens for a locally-actionable finding, or record an explicit operator override. Do NOT run a fix cycle against an unsatisfiable demand.`,
    ],
  }
}

// ─── stage: one lens, schema'd, fail-loud ─────────────────────────────────────

/**
 * The Measure stage. Preferred path is the CALLER running validation-scope.sh and passing
 * the blob as `args.validation_evidence` — but a caller can simply forget, and enforcement
 * that only fires when someone remembered is not enforcement. So the gate owns a fallback:
 * dispatch `task-completion-validator` (already Bash-capable and already denied
 * Write/Edit/MultiEdit, so no new roster entry and no agent-roster-drift risk) with the sole
 * instruction to run the hook and return its JSON verbatim.
 *
 * This script cannot run shell itself (authoring constraint 1: no FS/shell in the script
 * body), which is the whole reason this is an agent dispatch rather than three lines of code.
 */
async function runMeasureStage(args) {
  const supplied = normalizeMeasurement(args.validation_evidence)
  if (supplied.evidence_present) {
    log(`Measure: using caller-supplied validation evidence (${supplied.files_run.length} file(s) measured, ${supplied.regressions.length} regression(s)).`)
    return supplied
  }

  if (args.skip_measure_fallback) {
    log('Measure: no caller-supplied evidence and skip_measure_fallback set — the gate will treat the measurement as ABSENT, which blocks approval as a gate-integrity failure.')
    return supplied
  }

  const baseRef = args.base_ref || args.base || 'HEAD~1'
  const repo = args.repo_root || '.'
  log(`Measure: no caller-supplied evidence — dispatching the fallback runner (base=${baseRef}).`)

  let blob = null
  try {
    blob = await agent(
      `Run ONE command and return its output. Do not review anything. Do not edit anything.

    cd ${repo} && bash .claude/skills/dev-execution/hooks/validation-scope.sh --json --base-ref ${baseRef}

Return the command's JSON on stdout VERBATIM as your entire answer — no commentary, no
markdown fence, no summary, no interpretation. If the command fails or the hook is absent,
return exactly: {"scope_status": "hook_unavailable"}

Do NOT substitute your own judgment for the measurement. Do NOT fabricate counts. This output
is consumed mechanically as a gate input, and an invented number here defeats the gate.`,
      {
        phase: 'Measure',
        label: 'gate:measure',
        agentType: 'task-completion-validator',
        schema: {
          type: 'object',
          required: ['scope_status'],
          properties: {
            scope_status: { type: 'string' },
            test_scope: { type: 'array', items: { type: 'string' } },
            scope_truncated: { type: 'boolean' },
            budget_exhausted: { type: 'boolean' },
            omitted_files: { type: 'array', items: { type: 'string' } },
            measurements: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    )
  } catch (err) {
    log(`Measure: fallback runner threw (${err && err.message ? err.message : err}). Measurement stays ABSENT — the gate blocks rather than approving on unmeasured evidence.`)
    return supplied
  }

  if (!blob || blob.scope_status === 'hook_unavailable') {
    log('Measure: fallback runner returned no usable measurement (hook unavailable or agent died). Measurement stays ABSENT.')
    return supplied
  }

  const measured = normalizeMeasurement(blob)
  log(`Measure: fallback produced a measurement — ${measured.files_run.length} file(s), ${measured.regressions.length} regression(s), truncated=${measured.scope_truncated}.`)
  return measured
}

async function runLens(args, lens, measurement) {
  const reviewerType = LENS_REVIEWER_MAP[lens]

  // No silent fallback: an unknown lens is a failure, not a default reviewer. A `||` default
  // is how a lens silently disappears from a gate that still reports its full lens count.
  if (!reviewerType) {
    const known = Object.keys(LENS_REVIEWER_MAP).join(', ')
    log(`GATE FAILURE: unknown lens '${lens}' — no reviewer mapping. Known lenses: ${known}. Not falling back to a default reviewer.`)
    return gateFailureVerdict(lens, 'task-completion-validator', `unknown lens '${lens}' (known: ${known})`)
  }

  let verdict = null
  try {
    verdict = await agent(reviewPrompt(args, lens, reviewerType, measurement), {
      phase: 'Review',
      label: `gate:${lens}`,
      agentType: reviewerType,
      schema: VERDICT_SCHEMA,
    })
  } catch (err) {
    const reason = `reviewer threw: ${err && err.message ? err.message : err}`
    log(`GATE FAILURE: ${lens} lens (${reviewerType}) threw — ${reason}. Recording as a gate failure, NOT as a rejection.`)
    return gateFailureVerdict(lens, reviewerType, reason)
  }

  // null ⇒ the subagent died on a terminal error after retries, or the user skipped it.
  // Either way no decision exists. Do not let it read as an empty rejection.
  if (!verdict) {
    log(`GATE FAILURE: ${lens} lens (${reviewerType}) returned no verdict (agent died after retries, or was skipped). Recording as a gate failure, NOT as an approval or a rejection.`)
    return gateFailureVerdict(lens, reviewerType, 'reviewer returned no structured verdict (died after retries, or skipped)')
  }

  return { ...verdict, verdict_source: 'reviewer', lens }
}

// ─── script body ──────────────────────────────────────────────────────────────

phase('Measure')

// Named-workflow invocations can deliver args as a JSON-encoded string (observed live
// 2026-08-04: two gate runs returned gate_ran:false "no lenses supplied" on object args);
// parse defensively so a transport quirk can never read as a scope with no lenses.
const gateArgs = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const lenses = asList(gateArgs.lenses)

// Arg validation is itself a loud failure. A gate invoked with no lenses must not return a
// cheerful empty pass — that is the exact shape of "the gate never ran but nothing said so".
if (!lenses.length) {
  log('GATE FAILURE: reviewer-gate invoked with no `lenses`. Refusing to return an approval. Pass lenses per gate-risk-classes.md §2 — one lens by default, a second only with a named trigger.')
  return {
    approved: false,
    gate_ran: false,
    scope: gateArgs.scope || null,
    verdicts: [],
    gate_failures: [
      {
        lens: null,
        reviewer_type: null,
        reason: 'no lenses supplied — reviewer-gate cannot approve a scope it was given no lens to review',
      },
    ],
    gate_integrity_failures: [],
    escalate: true,
    verification_paths: [],
    validation_scope: {
      evidence_present: false,
      files_run: [],
      scope_truncated: false,
      regressions: [],
    },
    self_reported_claims: [],
    non_dischargeable_fixes: [],
    blocking_fixes: [
      'Re-invoke reviewer-gate with an explicit `lenses` array (see gate-risk-classes.md §2 step 1/2).',
    ],
    summary: 'Gate did not run: no lenses supplied.',
  }
}

// A two-lens gate must name its trigger (gate-risk-classes.md §2 step 2). Advisory here — the
// classification lives in the plan, not in this script — but recorded so an unjustified second
// lens is auditable after the fact rather than accumulating silently.
if (lenses.length > 1 && !gateArgs.gate_lens_reason) {
  log(`Advisory: ${lenses.length} lenses requested (${lenses.join(', ')}) with no gate_lens_reason. A two-lens gate with no named trigger (untrusted-input | authz-boundary | irreversible-outward | ambiguity-tie) is a classification error, not a cautious default — gate-risk-classes.md §2 step 2.`)
}

// The measurement is an INPUT to every lens, so it runs once, before any reviewer, and its
// result is shared. Sequential-before-parallel is deliberate: the reviewers cannot judge test
// scope without it, and running it per-lens would measure the same trees N times.
const measurement = await runMeasureStage(gateArgs)

phase('Review')

log(`Reviewer gate: ${lenses.length} lens(es) — ${lenses.map(l => `${l} → ${LENS_REVIEWER_MAP[l] || 'UNMAPPED'}`).join(', ')}`)

// Lenses are independent judgments of the same scope, and the gate's outcome needs all of them,
// so a barrier is correct here (not a pipeline). Each thunk is internally fail-safe, so
// parallel() never yields a bare null for a lens.
const results = await parallel(lenses.map(lens => () => runLens(gateArgs, lens, measurement)))

// parallel() maps a thrown thunk to null. runLens catches its own errors, so a null here means
// the harness itself dropped the thunk — still a gate failure, never a pass.
const rawVerdicts = results.map((verdict, index) =>
  verdict || gateFailureVerdict(lenses[index], LENS_REVIEWER_MAP[lenses[index]] || null, 'workflow harness returned no result for this lens')
)

// D3 (AC1): gate-wide context computed from the RAW verdicts, before any enforcement pass has
// a chance to rewrite anyone's verdict — a non-executing lens's delegation eligibility depends
// on whether some OTHER, EXECUTING lens in THIS gate round itself established a real path, not
// on what enforcement did to any verdict afterward.
const establishingLens = rawVerdicts.find(v =>
  v.verdict_source === 'reviewer' && LENS_EXECUTION_CAPABILITY[v.lens] === true && !verificationGap(v)
)
const gateContext = {
  anyExecutingLensEstablishedPath: Boolean(establishingLens),
  establishingLens: establishingLens ? establishingLens.lens : null,
}

// D4 → R3/D3 → AC-3/D2 → D5, in that order, on the RAW lens verdict, so no downstream consumer
// ever sees an un-adjusted verdict. applyIncoherenceRule runs first because it is a shape check
// on what the lens itself emitted, independent of (and prior to) any enforcement rewrite;
// applyNonLocalFixRule runs last because it operates on whatever required_fixes survive every
// upstream pass, including fixes those passes themselves added.
const verdicts = rawVerdicts
  .map(applyIncoherenceRule)
  .map(v => applyEvidenceRules(v, gateContext))
  .map(v => applyTestStatusRules(v, measurement))
  .map(applyNonLocalFixRule)

const gateFailures = verdicts
  .filter(v => v.verdict_source === 'gate_failure')
  .map(v => ({ lens: v.lens, reviewer_type: v.reviewer_type, reason: v.gate_failure_reason }))

const integrityFailures = verdicts
  .filter(v => v.verdict_source === 'gate_integrity_failure')
  .map(v => ({ lens: v.lens, reviewer_type: v.reviewer_type, reason: v.integrity_reason }))

const rejecting = verdicts.filter(v => v.verdict_source === 'reviewer' && !v.approved)

// Approval requires THREE things: every lens approved, every lens actually ran, and every
// approving lens established a verification path. Neither a gate failure nor an unverified
// approval is ever absorbed into an approval, however many other lenses were happy.
const approved = gateFailures.length === 0 && integrityFailures.length === 0 && rejecting.length === 0

const blockingFixes = verdicts.flatMap(v => (v.approved ? [] : asList(v.required_fixes)))

// The same-class stop rule needs the class from THIS round to compare against the next one.
// Surfaced on the envelope so the caller does not have to dig through per-lens verdicts.
const defectClasses = [...new Set(verdicts.filter(v => !v.approved && v.defect_class).map(v => v.defect_class))]

if (approved) {
  log(`Gate APPROVED: all ${verdicts.length} lens(es) returned an approving verdict with an established verification path (${verdicts.map(v => `${v.lens}:${v.verification_path && v.verification_path.kind}`).join(', ')}).`)
} else {
  log(`Gate NOT APPROVED — ${gateFailures.length} gate failure(s), ${integrityFailures.length} integrity failure(s), ${rejecting.length} rejection(s). Do not commit or mark complete. Defect class(es): ${defectClasses.length ? defectClasses.join(', ') : 'none named'}.`)
}

return {
  approved,
  // false when NO lens produced a real verdict — the gate is absent, not negative. The caller
  // must not treat this like a rejection it can fix; there is nothing to fix yet.
  gate_ran: verdicts.some(v => v.verdict_source === 'reviewer'),
  scope: gateArgs.scope || null,
  lenses,
  gate_lens_reason: gateArgs.gate_lens_reason || null,
  verdicts,
  gate_failures: gateFailures,
  // Verdicts that EXIST but cannot be trusted (approved with no verification path). Distinct
  // from gate_failures (nothing came back) and from rejections (a finding to fix): the next
  // action is re-dispatch or an explicit override, never a fix cycle.
  gate_integrity_failures: integrityFailures,
  // True when the gate's own execution is what needs attention, rather than the code.
  escalate: gateFailures.length > 0 || integrityFailures.length > 0,
  // Per-lens record of how (or whether) the production path was established.
  verification_paths: verdicts.map(v => ({
    lens: v.lens,
    established: Boolean(v.verification_path && v.verification_path.established),
    kind: (v.verification_path && v.verification_path.kind) || 'not-established',
    production_entrypoint: (v.verification_path && v.verification_path.production_entrypoint) || null,
    evidence: (v.verification_path && v.verification_path.evidence) || null,
  })),
  // What the gate actually measured, so a caller (or a later reader of the run record) can
  // tell an approval over a MEASURED-clean delta from an approval over no measurement at all.
  // The two are indistinguishable without this, and that indistinguishability is what let
  // skillmeat PR #299 through with 4/4 ACs "met".
  validation_scope: {
    evidence_present: measurement.evidence_present,
    files_run: measurement.files_run,
    scope_truncated: measurement.scope_truncated,
    scope_status: measurement.scope_status,
    omitted_files: measurement.omitted_files || [],
    regressions: measurement.regressions,
    measurement_failures: measurement.measurement_failures,
  },
  // Statuses a reviewer claimed that the measurement contradicted (risk R7).
  measured_status_contradictions: verdicts.flatMap(v => asList(v.measured_status_contradictions)),
  self_reported_claims: verdicts.flatMap(v => asList(v.self_reported_claims)),
  // D5 (AC4): required_fixes stripped for demanding something undischargeable locally
  // pre-merge (e.g. "GitHub Actions runs green on GitHub's infrastructure"). Surfaced
  // separately from blocking_fixes so a caller can see the gate removed them, not that nobody
  // wrote them.
  non_dischargeable_fixes: verdicts.flatMap(v => asList(v.non_dischargeable_fixes)),
  defect_classes: defectClasses,
  blocking_fixes: blockingFixes,
  unverifiable: verdicts.flatMap(v => asList(v.unverifiable)),
  summary: approved
    ? `Gate approved by ${verdicts.map(v => `${v.lens}/${v.reviewer_type}`).join(' + ')}.`
    : `Gate not approved: ${gateFailures.length} lens(es) failed to run, ${integrityFailures.length} approved without establishing a verification path, ${rejecting.length} rejected.`,
}
