'use strict';
/**
 * Tests for audit-log.js schema v2 — the intent/realization and provider/model
 * separations (node_01KZS5A4S1YEZBPVBRFXWM3RY4), plus the chosen_plugin_id
 * derivation that made the documented Pattern B call throw
 * (node_01KZS33HCND9T13BW7FGRQ8WAA).
 *
 * Run: `node tests/test-audit-log-realization.js` (zero deps; exits non-zero on failure).
 *
 * CASE 1 is the shipped v1 Pattern B call verbatim. If it stops asserting
 * unconfirmed, the log is back to auditing a copy of its own intent.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  appendEntry,
  appendRealization,
  readEntries,
  readNormalizedEntries,
  normalizeEntry,
  findUnconfirmedEntries,
  findModelSubstitutions,
  findFallbackEntries,
  SCHEMA_VERSION,
} = require('../audit-log');

let passed = 0;
function ok(label) {
  passed++;
  console.log(`  ok — ${label}`);
}

function tmpLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-test-'));
  return path.join(dir, 'routing-decisions.jsonl');
}

const RECORD = {
  chosen_plugin_id: 'ica',
  model: 'claude-sonnet-5[1m]',
  agent_type_id: 'ica-executor',
  reason: "Selected provider='ica'",
};

// ---------------------------------------------------------------------------
// CASE 1 — the shipped v1 Pattern B call: actual === chosen is NOT confirmation
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  const e = appendEntry({
    task_id: 'TASK-3.2',
    routing_record: RECORD,
    actual_provider_used: RECORD.chosen_plugin_id, // the v1 example's copied intent
    fallback_applied: false,
    log_path: log,
  });

  assert.strictEqual(e.schema_version, SCHEMA_VERSION);
  assert.strictEqual(e.kind, 'decision');
  assert.strictEqual(
    e.realization_confirmed,
    false,
    'copying the intent into actual_provider_used must never count as confirmation'
  );
  assert.strictEqual(e.realization_evidence, null);
  assert.strictEqual(e.realized_model, null);
  assert.strictEqual(
    e.model_substituted,
    null,
    'model_substituted must be null (unknowable), never false, when a realized model is missing'
  );
  assert.deepStrictEqual(findUnconfirmedEntries(log).map(x => x.task_id), ['TASK-3.2']);
  ok('CASE 1: actual===chosen stays unconfirmed and is surfaced by findUnconfirmedEntries');
}

// ---------------------------------------------------------------------------
// CASE 2 — realized fields are never defaulted from the intent
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  const e = appendEntry({ task_id: 'T2', routing_record: RECORD, log_path: log });
  assert.strictEqual(e.chosen_plugin_id, 'ica');
  assert.strictEqual(e.intended_model, 'claude-sonnet-5[1m]');
  assert.strictEqual(e.actual_provider_used, null);
  assert.strictEqual(e.realized_model, null);
  assert.strictEqual(e.realization_confirmed, false);
  ok('CASE 2: a decision with no measurement records nulls, not the intent');
}

// ---------------------------------------------------------------------------
// CASE 3 — chosen_plugin_id / intended_model derive from routing_record
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  // The documented Pattern B call passes routing_record but no top-level
  // chosen_plugin_id; v1 threw here and the decision went unlogged.
  const e = appendEntry({
    task_id: 'T3',
    routing_record: RECORD,
    fallback_applied: false,
    log_path: log,
  });
  assert.strictEqual(e.chosen_plugin_id, 'ica');
  assert.strictEqual(e.intended_model, 'claude-sonnet-5[1m]');
  assert.strictEqual(readEntries(log).length, 1, 'the entry must actually be written');

  assert.throws(
    () => appendEntry({ task_id: 'T3b', log_path: log }),
    /chosen_plugin_id is required/,
    'still an error when neither a param nor a record supplies the provider'
  );
  assert.throws(() => appendEntry({ routing_record: RECORD, log_path: log }), /task_id is required/);
  ok('CASE 3: provider/model derive from routing_record; genuine omissions still error');
}

// ---------------------------------------------------------------------------
// CASE 4 — confirmation is carried by evidence, not by a caller's assertion
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  const claimed = appendEntry({
    task_id: 'T4',
    routing_record: RECORD,
    actual_provider_used: 'ica',
    realized_model: 'claude-haiku-4-5[1m]',
    realization_confirmed: true, // asserted, with nothing to back it
    log_path: log,
  });
  assert.strictEqual(claimed.realization_confirmed, false);
  assert.strictEqual(
    claimed.realization_confirmed_claimed,
    true,
    'an unbacked confirmation claim is recorded, not silently dropped'
  );

  const evidenced = appendEntry({
    task_id: 'T4b',
    routing_record: RECORD,
    actual_provider_used: 'ica',
    realized_model: 'claude-haiku-4-5[1m]',
    realization_evidence: 'ccdash session S-abc123, gateway meter row 2026-08-11T19:30Z',
    log_path: log,
  });
  assert.strictEqual(evidenced.realization_confirmed, true);
  assert.strictEqual(evidenced.model_substituted, true);

  const blank = appendEntry({
    task_id: 'T4c',
    routing_record: RECORD,
    actual_provider_used: 'ica',
    realization_evidence: '   ',
    log_path: log,
  });
  assert.strictEqual(blank.realization_confirmed, false, 'whitespace is not evidence');
  ok('CASE 4: realization_confirmed requires non-empty evidence; claims are recorded as claims');
}

// ---------------------------------------------------------------------------
// CASE 5 — appendRealization: the post-execution, evidence-required path
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  appendEntry({ task_id: 'T5', routing_record: RECORD, log_path: log });

  assert.throws(
    () =>
      appendRealization({
        task_id: 'T5',
        actual_provider_used: 'ica',
        realized_model: 'claude-haiku-4-5[1m]',
        log_path: log,
      }),
    /realization_evidence is required/,
    'a realization without evidence is refused — a self-report is not a measurement'
  );
  assert.throws(
    () => appendRealization({ task_id: 'T5', realization_evidence: 'transcript', log_path: log }),
    /at least one of actual_provider_used \/ realized_model/
  );

  const r = appendRealization({
    task_id: 'T5',
    chosen_plugin_id: 'ica',
    intended_model: 'claude-sonnet-5[1m]',
    actual_provider_used: 'ica',
    realized_model: 'claude-haiku-4-5[1m]',
    realization_evidence: 'agent definition pin model: haiku, read at .claude/agents/delegates/ica-executor.md:5',
    log_path: log,
  });
  assert.strictEqual(r.kind, 'realization');
  assert.strictEqual(r.realization_confirmed, true);
  assert.strictEqual(r.model_substituted, true);

  // Append-only: the decision entry is untouched and both lines survive.
  const all = readEntries(log);
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].kind, 'decision');
  assert.strictEqual(all[0].realized_model, null, 'the decision entry was not mutated');

  // A confirmed realization clears the decision from the unconfirmed set.
  assert.deepStrictEqual(findUnconfirmedEntries(log), []);
  assert.deepStrictEqual(findModelSubstitutions(log), [
    {
      task_id: 'T5',
      intended_model: 'claude-sonnet-5[1m]',
      realized_model: 'claude-haiku-4-5[1m]',
      evidence:
        'agent definition pin model: haiku, read at .claude/agents/delegates/ica-executor.md:5',
    },
  ]);
  ok('CASE 5: appendRealization requires evidence, never mutates, and settles the join');
}

// ---------------------------------------------------------------------------
// CASE 6 — a realization entry may omit intended_model; it recovers from the decision
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  appendEntry({ task_id: 'T6', routing_record: RECORD, log_path: log });
  appendRealization({
    task_id: 'T6',
    actual_provider_used: 'ica',
    realized_model: 'claude-haiku-4-5[1m]',
    realization_evidence: 'gateway meter',
    log_path: log,
  });
  const subs = findModelSubstitutions(log);
  assert.strictEqual(subs.length, 1);
  assert.strictEqual(subs[0].intended_model, 'claude-sonnet-5[1m]');
  ok('CASE 6: intended_model recovered from the decision when the realization omits it');
}

// ---------------------------------------------------------------------------
// CASE 7 — an UNCONFIRMED realized_model cannot establish a substitution
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  appendEntry({
    task_id: 'T7',
    routing_record: RECORD,
    realized_model: 'claude-haiku-4-5[1m]', // no evidence
    log_path: log,
  });
  assert.deepStrictEqual(
    findModelSubstitutions(log),
    [],
    'an unconfirmed realized model proves neither compliance nor substitution'
  );
  assert.strictEqual(findUnconfirmedEntries(log).length, 1);
  ok('CASE 7: unconfirmed realized values are excluded from substitution findings');
}

// ---------------------------------------------------------------------------
// CASE 8 — legacy v1 entries read as unconfirmed decisions
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  // A verbatim v1 line as found in the live logs (91% of 123 entries had actual === chosen).
  const legacy = {
    task_id: 'node_01KZRNWXAMGZZ639VV6K376N5H',
    timestamp: '2026-08-11T19:30:36.731Z',
    chosen_plugin_id: 'ica',
    actual_provider_used: 'ica',
    fallback_applied: false,
    reason: "Selected provider='ica', model_id='claude-sonnet-5[1m]'",
  };
  fs.writeFileSync(log, JSON.stringify(legacy) + '\n', 'utf8');

  const n = normalizeEntry(legacy);
  assert.strictEqual(n.legacy, true);
  assert.strictEqual(n.schema_version, 1);
  assert.strictEqual(n.kind, 'decision');
  assert.strictEqual(n.realization_confirmed, false, 'a v1 actual is a copied intent, not a measurement');
  assert.strictEqual(n.actual_provider_used, 'ica', 'the v1 value is retained for provenance');
  assert.strictEqual(n.realized_model, null);
  assert.strictEqual(n.model_substituted, null);

  assert.strictEqual(findUnconfirmedEntries(log).length, 1);
  assert.strictEqual(readNormalizedEntries(log)[0].legacy, true);
  ok('CASE 8: legacy entries normalize to unconfirmed decisions and are surfaced');
}

// ---------------------------------------------------------------------------
// CASE 9 — fallback_applied auto-derives only from a MEASURED provider
// ---------------------------------------------------------------------------
{
  const log = tmpLog();
  const e = appendEntry({
    task_id: 'T9',
    routing_record: RECORD,
    actual_provider_used: 'claude',
    realization_evidence: 'ica binary absent; fell back',
    log_path: log,
  });
  assert.strictEqual(e.fallback_applied, true);
  assert.strictEqual(findFallbackEntries(log).length, 1);

  const noMeasure = appendEntry({ task_id: 'T9b', routing_record: RECORD, log_path: log });
  assert.strictEqual(
    noMeasure.fallback_applied,
    false,
    'no measured provider means no fallback claim in either direction'
  );
  ok('CASE 9: fallback_applied derives from a measured provider, never from a null');
}

console.log(`\n${passed} case(s) passed.`);
