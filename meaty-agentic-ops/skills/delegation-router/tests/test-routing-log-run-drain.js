#!/usr/bin/env node
/**
 * test-routing-log-run-drain.js — a REAL workflow run's report, drained into the audit log.
 *
 * Run: `node tests/test-routing-log-run-drain.js` (zero deps; exits non-zero on failure).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM test-workflow-routing-log-shape.js
 * ----------------------------------------------------------------------
 * That file reads workflow SOURCE and proves the payloads are well-shaped. On 2026-08-12 it passed
 * completely while not one payload in this estate had ever reached
 * `.claude/logs/routing-decisions.jsonl` — they were handed to `agent()` on a `_routing_log` opts key
 * the runtime discards. Well-shaped and connected are different properties, and only the first had a
 * test. `skillmeat routing audit` over a workflow run returned nothing, and nothing is
 * indistinguishable from clean. Origin: node_01KZVV9R3EK13DJXS44VCQ8E9C.
 *
 * So this test does not read source and does not construct a payload. It takes the VERBATIM return
 * value of an actual workflow run and drives it through the real ingest path, which is the only thing
 * that can show the wire carries traffic end to end.
 *
 * THE FIXTURE IS A RECORDING, NOT A CONSTRUCTION
 * ----------------------------------------------
 * `fixtures/real-run-wf_2908b911-58f.report.json` is the unedited return value of workflow run
 * `wf_2908b911-58f` (2026-08-12), a two-leg run in which:
 *   - `leg-a-fails-over` dispatched to an agentType that does not exist, genuinely threw, and the
 *     workflow re-dispatched to claude-primary itself — so it carries a decision AND a realization
 *     whose evidence quotes the error the orchestrator actually observed.
 *   - `leg-b-succeeds` dispatched successfully, so nothing ever measured where it ran — it carries a
 *     decision and NO realization.
 * That asymmetry is the point: it is the only shape that can tell a working audit from a falsely
 * clean one. A hand-written fixture would have been symmetric and would have proved less.
 *
 * To re-record after changing the accumulator contract: run any routing-aware workflow, save its
 * return value verbatim, and update FIXTURE. Do not hand-edit this file's fixture to make a test pass
 * — the recording is the evidence.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { ingestRoutingLog, readEntries, findUnconfirmedEntries } = require('../audit-log');

const FIXTURE = path.resolve(__dirname, 'fixtures/real-run-wf_2908b911-58f.report.json');
const TASK_ID = 'node_01KZVV9R3EK13DJXS44VCQ8E9C';

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error(`  FAIL: ${msg}`); }
}
function tmpLog() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rldrain-')), 'routing-decisions.jsonl');
}

const report = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// ---------------------------------------------------------------------------
// CASE 1 — the run actually carried routing entries OUT of the script.
// This is the assertion that was impossible before the wire existed.
// ---------------------------------------------------------------------------
console.log('CASE 1: the recorded run returned a non-empty routing_log');
check(Array.isArray(report.routing_log), 'report has no routing_log array');
check(
  (report.routing_log || []).length > 0,
  'recorded run returned an EMPTY routing_log — the accumulator never reached the return value'
);
check(report.status === 'complete', `recorded run status was ${report.status}, expected complete`);
console.log(`  ${(report.routing_log || []).length} entries came back from run wf_2908b911-58f`);

// ---------------------------------------------------------------------------
// CASE 2 — draining that report writes real entries to the log. AC1 + AC4.
// ---------------------------------------------------------------------------
console.log('CASE 2: ingesting the recorded report writes audit entries');
const log = tmpLog();
const result = ingestRoutingLog({ entries: report, task_id: TASK_ID, log_path: log });

check(result.skipped.length === 0, `ingest skipped ${result.skipped.length} entr(y|ies): ${JSON.stringify(result.skipped)}`);
const written = readEntries(log);
check(written.length > 0, 'AT LEAST ONE audit entry must land — this is the whole point of the wire');
check(
  written.length === report.routing_log.length,
  `wrote ${written.length} entries for ${report.routing_log.length} payloads — the ingest dropped some`
);
check(result.counts.decision === 2, `expected 2 decisions from this recording, got ${result.counts.decision}`);
check(result.counts.realization === 1, `expected 1 realization from this recording, got ${result.counts.realization}`);
check(result.counts.no_task_ref === 0, 'a shipped payload carried no task_ref');
// task_ref is addressing metadata; it must not leak into the stored entry shape.
check(!written.some(e => 'task_ref' in e), 'task_ref leaked into a stored audit entry');
console.log(`  ${written.length} entries written to a real log file`);

// ---------------------------------------------------------------------------
// CASE 3 — AC2: the measured hop confirms, the UNMEASURED one stays unconfirmed.
//
// Both halves matter. "Everything confirmed" is the failure mode of a run-wide task_id, and
// "nothing confirmed" is the failure mode of evidence being dropped.
// ---------------------------------------------------------------------------
console.log('CASE 3: the measured fallback confirms; the leg nothing measured stays UNCONFIRMED');
const unconfirmed = findUnconfirmedEntries(log);
check(
  unconfirmed.length === 1,
  `expected exactly 1 unconfirmed decision (leg-b, which never failed over), got ${unconfirmed.length}`
);
check(
  unconfirmed.length === 1 && /leg-b-succeeds$/.test(unconfirmed[0].task_id),
  `the unconfirmed decision should be leg-b-succeeds, got ${unconfirmed.map(e => e.task_id).join(', ')}`
);
const realization = written.find(e => e.kind === 'realization');
check(!!realization, 'no realization entry was written');
check(realization && realization.realization_confirmed === true, 'the measured fallback did not confirm');
check(
  realization && /orchestrator-observed:/.test(realization.realization_evidence || ''),
  'the realization confirmed without naming what measured it'
);
check(
  realization && realization.actual_provider_used === 'claude' && realization.chosen_plugin_id === 'ica',
  'the realization did not record a provider CHANGE (ica intended, claude realized)'
);
console.log(`  1 unconfirmed (${unconfirmed[0] ? unconfirmed[0].task_id : 'n/a'}), 1 confirmed with evidence`);

// ---------------------------------------------------------------------------
// CASE 4 — THE NEGATIVE CONTROL, and the reason task_ref is required.
//
// Strip task_ref from the SAME recording and every entry collapses onto one task_id. Because
// findUnconfirmedEntries() settles by joining on task_id, leg-a's realization then confirms
// leg-b's decision — a leg nothing ever measured — and the audit reads CLEAN. This is not a
// hypothetical: it is what the first cut of the ingest did, caught by running the wire rather
// than by inspecting it.
// ---------------------------------------------------------------------------
console.log('CASE 4: without task_ref the same run reads FALSELY CLEAN (why task_ref is required)');
const stripped = JSON.parse(JSON.stringify(report));
for (const e of stripped.routing_log) delete e.task_ref;
const badLog = tmpLog();
const badResult = ingestRoutingLog({ entries: stripped, task_id: TASK_ID, log_path: badLog });

check(badResult.counts.no_task_ref === 3, `expected 3 entries flagged no_task_ref, got ${badResult.counts.no_task_ref}`);
check(
  new Set(readEntries(badLog).map(e => e.task_id)).size === 1,
  'stripping task_ref should collapse every entry onto one task_id'
);
check(
  findUnconfirmedEntries(badLog).length === 0,
  'the negative control did not reproduce the cross-settle — if this now fails, the join semantics ' +
    'in audit-log.js changed and the task_ref rationale needs re-deriving, not deleting'
);
console.log('  reproduced: 0 unconfirmed over a decision nothing measured — the failure task_ref prevents');

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed (4 cases) — a real run\'s routing_log reaches the audit log.');
