'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { resolve } = require('../resolver');

const registry = path.join(__dirname, '../registry/examples/recorded-fallback/model-registry.generated.json');
const emptyObservation = { schema: 'aos.lane-availability/1', lanes: {} };

for (const task_class of ['design_judgment', 'raw_strength']) {
  const run = input => resolve({ task_class, _registryPath: registry,
    capacity: emptyObservation, ...input });

  test(`${task_class}: selects the newer holder with probe state unmeasured`, () => {
    const record = run({});
    assert.equal(record.model, 'gpt-6.2-sol');
    assert.deepEqual(record.fallback_chain.map(row => row.model), ['claude-opus-5-5']);
    assert.equal(record.model_decision.holders.at(-1).verdict, 'awaiting_unavailability');
  });

  test(`${task_class}: a lane-wide usage limit retains the native route`, () => {
    const capacity = { ...emptyObservation, lanes: { standard: { state: 'unavailable', reason: 'usage limit' } } };
    const record = run({ capacity });
    assert.equal(record.model, 'claude-opus-5-5');
    assert.deepEqual(record.fallback_chain, []);
    assert.equal(record.availability_decisions['gpt-6.2-sol'][0].availability.reason, 'usage limit');
  });

  for (const reason of ['serving error', 'model usage limit', 'model not found']) {
    test(`${task_class}: a recorded ${reason} admits the older holder`, () => {
      const receipt = { state: 'unavailable', reason };
      const capacity = { ...emptyObservation, models: { 'gpt-6.2-sol': receipt } };
      const routeWithNative = run({ capacity });
      assert.equal(routeWithNative.model, 'claude-opus-5-5');
      assert.deepEqual(routeWithNative.fallback_chain.map(row => row.model), ['gpt-6.1-sol']);

      const record = run({ capacity: { ...capacity, lanes: { native: { state: 'unavailable', reason: 'serving error' } } } });
      assert.equal(record.model, 'gpt-6.1-sol');
      assert.deepEqual(record.fallback_chain, []);
      assert.deepEqual(record.model_unavailability['gpt-6.2-sol'], receipt);
      assert.equal(record.availability_decisions['gpt-6.2-sol'][0].availability.reason, reason);
    });
  }

  test(`${task_class}: missing evidence does not enable the older holder`, () => {
    const capacity = {
      ...emptyObservation,
      lanes: { standard: { state: 'unavailable' }, native: { state: 'unavailable' } },
      models: { 'gpt-6.2-sol': { state: 'unavailable', reason: ' ' } },
    };
    const record = run({ capacity });
    assert.equal(record.model_decision.chosen, null);
    assert.equal(record.floor_breached, true);
    assert.equal(record.model_decision.holders.at(-1).verdict, 'awaiting_unavailability');
  });
}
