'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { resolve } = require('../resolver.js');
const registryPath = path.join(__dirname, '..', 'model-registry.generated.json');
const input = { task_class: 'second_opinion', model: 'gemini-4-argon', pin_reason: 'approved explicit selection', preapproval_ref: 'req_test', pin_expires: '2099-01-01' };

test('approved non-holder pin that meets the bar selects its eligible lane', () => {
  const record = resolve({ ...input, _registryPath: registryPath });
  assert.equal(record.model_decision.holders[0].verdict, 'chosen');
  assert.ok(record.model_decision.holders[0].q >= record.model_decision.holders[0].bar);
  assert.equal(record.floor_breached, false);
  assert.equal(record.lane, 'gemini_direct');
});

test('a configured holder below the floor remains blocked', () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const spec = registry.task_class_defaults.second_opinion;
  spec.holders.push(input.model);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explicit-floor-'));
  const fixture = path.join(dir, 'registry.json');
  try {
    fs.writeFileSync(fixture, JSON.stringify(registry));
    const record = resolve({ ...input, _registryPath: fixture });
    assert.equal(record.floor_breached, true);
    assert.equal(record.lane, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
