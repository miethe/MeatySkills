'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const registry = require('../model-registry.generated.json');
const { resolveModel } = require('../resolver');
const expected = {
  exploration: 'gpt-6-luna', documentation: 'gpt-6.1-terra', mechanical: 'gpt-6.1-terra',
  second_opinion: 'gpt-6.1-terra', implementation: 'gpt-6.1-terra',
  design_judgment: 'gpt-6.1-sol', raw_strength: 'gpt-6.1-sol', code_review: 'gpt-6.1-terra',
  image_generation: 'gpt-6.1-terra', council_review: 'gpt-6.1-sol',
  synthesis: 'gpt-6.1-sol', schema_recovery: 'gpt-6.1-sol', cross_wave_merge: 'gpt-6.1-sol',
};
for (const [name, first] of Object.entries(expected)) test(`${name} chain boundary`, () => {
  assert.equal(registry.task_class_defaults[name].holders[0], first);
  assert.deepEqual(registry.routing_policy[name].chain, registry.task_class_defaults[name].holders);
  assert.ok(!registry.routing_policy[name].chain.some(id => id === 'gpt-6-sol' || id.startsWith('gpt-5.6-')));
});
for (const name of ['implementation', 'code_review', 'design_judgment']) test(`${name} model selection`, () => {
  assert.equal(resolveModel(registry, {task_class: name}).chosenModel, expected[name]);
});
