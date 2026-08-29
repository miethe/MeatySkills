/**
 * test-context-class.js — the `context_class` audit passthrough (13th RoutingRecord field).
 *
 * Contract under test (Claude-5 plan doctrine §3 / §4):
 *   - a declared C1–C4 is carried onto the emitted record, unchanged, on every resolve path;
 *   - omitting it is backward-compatible (defaults to null, never throws);
 *   - an out-of-vocabulary value is rejected at validation time;
 *   - it is a PASSTHROUGH: it must not influence provider/model selection;
 *   - unlike context_ref it is NOT gated on MUST-stay/provider, because it carries no context.
 */

const assert = require('assert');
const { resolve } = require('../resolver.js');
const {
  CONTEXT_CLASSES,
  validateRoutingRecord,
  finalizeRoutingRecord,
  createEmptyRecord,
} = require('../routing-record.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('context_class passthrough');

const OFFLOADABLE = { model: 'sonnet', provider: 'ica', effort: 'high', task_class: 'implementation' };
const MUST_STAY = { model: 'opus', provider: 'ica', effort: 'high', task_class: 'verdict' };

test('vocabulary is exactly C1–C4', () => {
  assert.deepStrictEqual(CONTEXT_CLASSES, ['C1', 'C2', 'C3', 'C4']);
});

test('a declared class is carried through unchanged', () => {
  for (const cls of CONTEXT_CLASSES) {
    const record = resolve({ ...OFFLOADABLE, context_class: cls });
    assert.strictEqual(record.context_class, cls, `expected ${cls}`);
  }
});

test('omitting it defaults to null (backward-compatible with 12-field callers)', () => {
  const record = resolve({ ...OFFLOADABLE });
  assert.strictEqual(record.context_class, null);
});

test('empty string normalizes to null rather than leaking a falsy label', () => {
  const record = resolve({ ...OFFLOADABLE, context_class: '' });
  assert.strictEqual(record.context_class, null);
});

test('an out-of-vocabulary value is rejected', () => {
  assert.throws(
    () => resolve({ ...OFFLOADABLE, context_class: 'C9' }),
    /context_class must be one of C1\|C2\|C3\|C4/
  );
});

test('it does not influence selection (same decision with and without)', () => {
  const withClass = resolve({ ...OFFLOADABLE, context_class: 'C4' });
  const without = resolve({ ...OFFLOADABLE });
  assert.strictEqual(withClass.chosen_plugin_id, without.chosen_plugin_id);
  assert.strictEqual(withClass.model, without.model);
  assert.strictEqual(withClass.agent_type_id, without.agent_type_id);
});

test('it survives a MUST-stay override (unlike context_ref, it is not gated)', () => {
  const record = resolve({ ...MUST_STAY, context_class: 'C4' });
  assert.strictEqual(record.chosen_plugin_id, 'claude', 'MUST-stay must still force claude');
  assert.strictEqual(record.context_class, 'C4', 'context_class carries no context, so it is not cleared');
});

test('createEmptyRecord seeds it as null', () => {
  assert.strictEqual(createEmptyRecord().context_class, null);
});

test('validateRoutingRecord tolerates absence (11/12-field legacy records)', () => {
  const legacy = createEmptyRecord();
  delete legacy.context_class;
  assert.doesNotThrow(() => validateRoutingRecord(legacy));
});

test('finalizeRoutingRecord defaults it without clearing a real value', () => {
  const bare = createEmptyRecord();
  delete bare.context_class;
  assert.strictEqual(finalizeRoutingRecord(bare, 'implementation').context_class, null);

  const held = createEmptyRecord();
  held.context_class = 'C2';
  assert.strictEqual(finalizeRoutingRecord(held, 'verdict').context_class, 'C2');
});

console.log(`\n${passed} passed`);
