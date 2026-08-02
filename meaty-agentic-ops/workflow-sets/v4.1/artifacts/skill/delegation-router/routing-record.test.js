'use strict';
/**
 * Tests for the RoutingRecord context_ref invariant (delegation-context-bundle-v2 P3-006).
 * Run: `node routing-record.test.js` (zero deps; exits non-zero on failure).
 *
 * Covers: context_ref is the additive 12th field (existing 11-field records still validate);
 * MUST-STAY classes and bob always emit context_ref: null even when a non-null path is passed
 * (FR-10, governance — a bundle never leaks onto a non-delegatable leg).
 */
const assert = require('assert');
const {
  MUST_STAY_PRIMARY_CLASSES,
  validateRoutingRecord,
  finalizeRoutingRecord,
  createEmptyRecord,
} = require('./routing-record');

function baseFlatLeg() {
  const r = createEmptyRecord();
  r.chosen_plugin_id = 'ica';
  r.agent_type_id = 'ica-executor';
  return r;
}

// 1) Additive/backward-compatible: an 11-field record (no context_ref) still validates.
(function test_backward_compatible_11_field() {
  const r = createEmptyRecord();
  delete r.context_ref;
  assert.doesNotThrow(() => validateRoutingRecord(r));
})();

// 2) createEmptyRecord defaults context_ref to null.
(function test_empty_record_default_null() {
  assert.strictEqual(createEmptyRecord().context_ref, null);
})();

// 3) A flat delegatable leg (ica, non-MUST-STAY class) keeps its non-null context_ref.
(function test_flat_leg_keeps_context_ref() {
  const r = baseFlatLeg();
  r.context_ref = '/tmp/bundle.md';
  finalizeRoutingRecord(r, 'implementation');
  assert.strictEqual(r.context_ref, '/tmp/bundle.md');
})();

// 4) MUST-STAY classes ALWAYS null context_ref, even when a caller passes a path.
(function test_must_stay_forces_null() {
  for (const cls of MUST_STAY_PRIMARY_CLASSES) {
    const r = baseFlatLeg();
    r.context_ref = '/tmp/should-not-leak.md';
    finalizeRoutingRecord(r, cls);
    assert.strictEqual(r.context_ref, null, `MUST-STAY '${cls}' must null context_ref`);
  }
})();

// 5) bob ALWAYS nulls context_ref (deferred transport DEF-1), even on a non-MUST-STAY class.
(function test_bob_forces_null() {
  const r = createEmptyRecord();
  r.chosen_plugin_id = 'bob';
  r.agent_type_id = 'bob-delegate-executor';
  r.context_ref = '/tmp/should-not-leak.md';
  finalizeRoutingRecord(r, 'implementation');
  assert.strictEqual(r.context_ref, null);
})();

// 6) Type guard: a non-string, non-null context_ref is rejected.
(function test_type_guard() {
  const r = baseFlatLeg();
  r.context_ref = 42;
  assert.throws(() => validateRoutingRecord(r), /context_ref must be a string path or null/);
})();

console.log('routing-record.test.js: all assertions passed');
