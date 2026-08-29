'use strict';
/**
 * Tests for audit-log.js `kind: 'blocked'` — the writer SPEC §5a mandates and the
 * module lacked (node_01M00JTM8FVBK12GF4AYQ7S2JN).
 *
 * Run: `node tests/test-audit-log-blocked.js` (zero deps; exits non-zero on failure).
 *
 * CASE 4 is the whole point of the kind. Before it, a denied leg could only be
 * left unconfirmed — byte-identical to a leg that had not reported yet — so
 * `--unconfirmed` conflated "denied, never ran" with "still pending" and a
 * 100%-denied lane looked exactly like an unused one. If CASE 4 stops
 * discriminating, that conflation is back.
 *
 * CASE 5 is the guard this change was explicitly NOT allowed to weaken. If it
 * stops throwing, an empty realization can read as a measurement again.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BLOCKED_REASONS,
  appendEntry,
  appendRealization,
  appendBlocked,
  readEntries,
  findUnconfirmedEntries,
  findBlockedEntries,
  findFallbackEntries,
  findModelSubstitutions,
  ingestRoutingLog,
} = require('../audit-log');

let passed = 0;
function ok(label) {
  passed++;
  console.log(`  ok — ${label}`);
}

function tmpLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-blocked-test-'));
  return path.join(dir, 'routing-decisions.jsonl');
}

const RECORD = {
  chosen_plugin_id: 'ica',
  model: 'claude-sonnet-5[1m]',
  agent_type_id: 'ica-executor',
  reason: "Selected provider='ica'",
};

// The verbatim shape the two denied ica-executor legs returned (2026-08-14).
const DENIAL = 'Claude Code auto-mode classifier denied Bash(~/ica-claude.sh …): "permission denied"';

// ---------------------------------------------------------------------------
// CASE 1 — a denial is recordable, WITH evidence, naming nothing that ran (AC1)
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  const e = appendBlocked({
    task_id: 'LEG-1',
    routing_record: RECORD,
    blocked_reason: 'permission_denied',
    denial_evidence: DENIAL,
    log_path: log,
  });

  assert.strictEqual(e.kind, 'blocked');
  assert.strictEqual(e.schema_version, 2);
  assert.strictEqual(e.blocked_reason, 'permission_denied');
  assert.strictEqual(e.denial_evidence, DENIAL);

  // The denied INTENT is echoed — that is knowable and useful.
  assert.strictEqual(e.chosen_plugin_id, 'ica');
  assert.strictEqual(e.intended_model, 'claude-sonnet-5[1m]');

  // Nothing ran, so nothing is named. This is the AC1 assertion.
  assert.strictEqual(e.actual_provider_used, null, 'a denial must not name a provider that ran');
  assert.strictEqual(e.realized_model, null, 'a denial must not name a model that ran');
  assert.strictEqual(e.realization_confirmed, false);
  assert.strictEqual(e.realization_evidence, null);
  assert.strictEqual(e.model_substituted, null, 'unknowable, not false — no model ran');

  // SPEC 5a: never fallback_applied for a denial.
  assert.strictEqual(e.fallback_applied, false);
  assert.strictEqual(findFallbackEntries(log).length, 0, 'a denial is not a fallback');

  // And it is not mistakable for a substitution.
  assert.strictEqual(findModelSubstitutions(log).length, 0);

  assert.strictEqual(readEntries(log).length, 1, 'append-only: exactly one entry written');
  ok('CASE 1: a denial is written with evidence, naming no provider or model that ran');
}

// ---------------------------------------------------------------------------
// CASE 2 — evidence and a known reason are both required
// ---------------------------------------------------------------------------
{
  const log = tmpLog();

  assert.throws(
    () => appendBlocked({ task_id: 'LEG-2', blocked_reason: 'permission_denied', log_path: log }),
    /denial_evidence is required/,
    'a denial with no evidence is a rumour'
  );
  assert.throws(
    () => appendBlocked({ task_id: 'LEG-2', blocked_reason: 'permission_denied', denial_evidence: '   ', log_path: log }),
    /denial_evidence is required/,
    'whitespace is not evidence'
  );
  assert.throws(
    () => appendBlocked({ task_id: 'LEG-2', denial_evidence: DENIAL, log_path: log }),
    /blocked_reason is required/
  );

  // An AVAILABILITY failure is a fallback, not a blocked outcome (SPEC 5a).
  assert.throws(
    () => appendBlocked({ task_id: 'LEG-2', blocked_reason: 'rate_limited', denial_evidence: DENIAL, log_path: log }),
    /unknown blocked_reason 'rate_limited'/,
    'the reason vocabulary is closed so --blocked stays queryable'
  );

  assert.throws(() => appendBlocked({ blocked_reason: 'mode_d', denial_evidence: DENIAL, log_path: log }), /task_id is required/);

  assert.strictEqual(fs.existsSync(log), false, 'no rejected call wrote anything');

  // Every SPEC 5a non-availability outcome is expressible.
  assert.deepStrictEqual(
    [...BLOCKED_REASONS].sort(),
    ['mode_d', 'needs_write_authority', 'permission_denied', 'validation_failed'],
    'BLOCKED_REASONS mirrors SPEC 5a\'s "NOT a traversal trigger" column'
  );
  ok('CASE 2: evidence + a closed-vocabulary reason are required; rejects write nothing');
}

// ---------------------------------------------------------------------------
// CASE 3 — a realized field on a denial is REFUSED, never silently dropped
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  const base = { task_id: 'LEG-3', blocked_reason: 'permission_denied', denial_evidence: DENIAL, log_path: log };

  for (const bad of ['actual_provider_used', 'realized_model', 'realization_evidence']) {
    assert.throws(
      () => appendBlocked({ ...base, [bad]: 'claude' }),
      new RegExp(`${bad} must not be set on a blocked entry`),
      `${bad} contradicts the claim that nothing ran`
    );
  }
  assert.throws(
    () => appendBlocked({ ...base, fallback_applied: true }),
    /fallback_applied must not be true/,
    'SPEC 5a: a denial attaches to the content, so no other lane may carry it'
  );

  assert.strictEqual(fs.existsSync(log), false);
  ok('CASE 3: realized fields / fallback_applied on a denial throw rather than being dropped');
}

// ---------------------------------------------------------------------------
// CASE 4 — THE POINT: blocked-and-never-ran is distinguishable from still-pending (AC2)
// ---------------------------------------------------------------------------
{
  const log = tmpLog();

  // Leg A: routed, then DENIED. Nothing ran and nothing ever will.
  appendEntry({ task_id: 'LEG-A', routing_record: RECORD, log_path: log });
  appendBlocked({
    task_id: 'LEG-A',
    routing_record: RECORD,
    blocked_reason: 'permission_denied',
    denial_evidence: DENIAL,
    log_path: log,
  });

  // Leg B: routed and genuinely has not reported yet. This one IS unconfirmed.
  appendEntry({ task_id: 'LEG-B', routing_record: RECORD, log_path: log });

  // Leg C: routed and confirmed by measurement.
  appendEntry({ task_id: 'LEG-C', routing_record: RECORD, log_path: log });
  appendRealization({
    task_id: 'LEG-C',
    chosen_plugin_id: 'ica',
    actual_provider_used: 'ica',
    realized_model: 'claude-sonnet-5[1m]',
    realization_evidence: 'ICA gateway meter row 88213',
    log_path: log,
  });

  const unconfirmed = findUnconfirmedEntries(log).map(e => e.task_id);
  assert.deepStrictEqual(
    unconfirmed,
    ['LEG-B'],
    'only the genuinely-pending leg is unconfirmed — a denial is a settled answer, not an open question'
  );
  assert.ok(!unconfirmed.includes('LEG-A'), 'AC2: denied-and-never-ran must NOT read as still-pending');

  const blocked = findBlockedEntries(log);
  assert.strictEqual(blocked.length, 1);
  assert.strictEqual(blocked[0].task_id, 'LEG-A');
  assert.strictEqual(blocked[0].blocked_reason, 'permission_denied');

  // Reason filtering works, so a fully-denied lane is countable by cause.
  assert.strictEqual(findBlockedEntries(log, 'permission_denied').length, 1);
  assert.strictEqual(findBlockedEntries(log, 'mode_d').length, 0);

  ok('CASE 4: --unconfirmed no longer conflates denied-and-never-ran with still-pending');
}

// ---------------------------------------------------------------------------
// CASE 5 — appendRealization's all-null guard is UNCHANGED (AC3)
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  assert.throws(
    () =>
      appendRealization({
        task_id: 'LEG-5',
        actual_provider_used: null,
        realized_model: null,
        realization_evidence: DENIAL,
        log_path: log,
      }),
    /at least one of actual_provider_used \/ realized_model is required/,
    'AC3: the guard that stops an empty realization reading as a measurement stays'
  );
  // Also still enforced with the fields simply omitted, which is how the denial arrived.
  assert.throws(
    () => appendRealization({ task_id: 'LEG-5', realization_evidence: DENIAL, log_path: log }),
    /at least one of actual_provider_used \/ realized_model is required/
  );
  assert.strictEqual(fs.existsSync(log), false, 'the rejected realization wrote nothing');
  ok('CASE 5: appendRealization still rejects an all-null realization — guard not weakened');
}

// ---------------------------------------------------------------------------
// CASE 6 — ingestRoutingLog carries a blocked leg, and skips a malformed one
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  const res = ingestRoutingLog({
    task_id: 'node_01M00',
    entries: [
      { task_ref: 'leg1', kind: 'decision', chosen_plugin_id: 'ica', intended_model: 'claude-sonnet-5[1m]' },
      { task_ref: 'leg1', kind: 'blocked', blocked_reason: 'permission_denied', denial_evidence: DENIAL },
      // malformed: no evidence
      { task_ref: 'leg2', kind: 'blocked', blocked_reason: 'permission_denied' },
      // malformed: availability reason, not an authorization one
      { task_ref: 'leg3', kind: 'blocked', blocked_reason: 'timeout', denial_evidence: DENIAL },
      // malformed: claims something ran
      { task_ref: 'leg4', kind: 'blocked', blocked_reason: 'mode_d', denial_evidence: DENIAL, actual_provider_used: 'claude' },
    ],
    log_path: log,
  });

  assert.strictEqual(res.counts.blocked, 1, 'exactly one well-formed blocked leg');
  assert.strictEqual(res.counts.decision, 1);
  assert.strictEqual(res.skipped.length, 3, 'the three malformed blocked legs are skipped, not thrown');
  assert.match(res.skipped[0].reason, /no denial_evidence/);
  assert.match(res.skipped[1].reason, /unknown blocked_reason 'timeout'/);
  assert.match(res.skipped[2].reason, /nothing ran/);

  const written = readEntries(log);
  assert.strictEqual(written.length, 2);
  const b = written.find(e => e.kind === 'blocked');
  assert.strictEqual(b.task_id, 'node_01M00::leg1', 'task_ref composes as for any other kind');
  assert.strictEqual(b.actual_provider_used, null);

  // The denied leg is not reported as awaiting confirmation.
  assert.deepStrictEqual(findUnconfirmedEntries(log).map(e => e.task_id), []);

  // dry_run counts it without writing.
  const dry = ingestRoutingLog({
    task_id: 'node_X',
    entries: [{ task_ref: 'l', kind: 'blocked', blocked_reason: 'mode_d', denial_evidence: DENIAL }],
    log_path: tmpLog(),
    dry_run: true,
  });
  assert.strictEqual(dry.counts.blocked, 1);
  assert.strictEqual(dry.written.length, 0);

  ok('CASE 6: ingestRoutingLog writes a blocked leg, skips malformed ones, counts under dry_run');
}

console.log(`\n${passed} case(s) passed.`);
