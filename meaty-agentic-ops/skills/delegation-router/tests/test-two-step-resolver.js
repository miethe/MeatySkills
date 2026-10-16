'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolve } = require('../resolver.js');

const fixture = path.join(__dirname, 'fixtures', 'v3', 'registry.json');
const cli = path.join(__dirname, '..', 'resolve-cli.js');
const registry = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-v3-'));
const registryPath = path.join(temp, 'registry.json');
fs.writeFileSync(registryPath, JSON.stringify(registry));

function capacity(lanes = {}, identities = {}) { return { generated_at: 'test', lanes, identities }; }

const unavailableSecondary = resolve({
  task_class: 'implementation', _registryPath: registryPath,
  capacity: capacity({ codex_subscription_secondary: { state: 'unavailable', reason: 'account offline' } }, { codex_secondary: { available: false, reason: 'account offline' } }),
});
assert.equal(unavailableSecondary.model, 'gpt-6-luna');
assert.equal(unavailableSecondary.lane, 'codex_subscription_primary');
assert.equal(unavailableSecondary.identity_ref, 'codex_primary');
assert(unavailableSecondary.model_decision.holders.every(item => item.verdict && item.reason));
assert(unavailableSecondary.lane_decision.candidates.every(item => item.verdict && item.reason));

const bothCodexUnavailable = resolve({
  task_class: 'implementation', _registryPath: registryPath,
  capacity: capacity({
    codex_subscription_primary: { state: 'unavailable' },
    codex_subscription_secondary: { state: 'unavailable' },
  }, { codex_primary: { available: false }, codex_secondary: { available: false } }),
});
assert.equal(bothCodexUnavailable.model, 'claude-sonnet-5-5');
assert.equal(bothCodexUnavailable.lane, 'claude_subscription');
assert.match(bothCodexUnavailable.reason, /registry v3 selected/);

const orchestration = resolve({ task_class: 'orchestration', _registryPath: registryPath, capacity: capacity({ codex_subscription_primary: { state: 'admitted' } }) });
assert.equal(orchestration.chosen_plugin_id, 'claude');
assert.equal(orchestration.lane, 'claude_subscription');
assert(!orchestration.lane_decision.candidates.some(item => item.lane.startsWith('codex_') && item.verdict === 'eligible'));

const modeD = resolve({ task_class: 'mode_d', _registryPath: registryPath, capacity: capacity({ ica_gateway_messages: { state: 'admitted' } }) });
assert.equal(modeD.lane, 'claude_subscription');
assert.equal(modeD.lane_decision.candidates.find(item => item.lane === 'ica_gateway_messages').verdict, 'excluded');

const explicit = resolve({ task_class: 'explicit_test', model: 'claude-sonnet-5-5', _registryPath: registryPath });
assert.equal(explicit.lane, 'ica_gateway_messages');
assert.equal(explicit.lane_decision.candidates[0].lane, 'ica_gateway_messages');

const refused = Object.fromEntries(registry.lane_order.map(lane => [lane, { state: 'refused', reason: '403' }]));
const capacityPath = path.join(temp, 'capacity.json');
fs.writeFileSync(capacityPath, JSON.stringify(capacity(refused)));
const floorRun = spawnSync(process.execPath, [cli, 'resolve', '--task-class', 'implementation', '--capacity-file', capacityPath, '--registry', registryPath, '--json'], { encoding: 'utf8' });
assert.equal(floorRun.status, 1);
const floorRecord = JSON.parse(floorRun.stdout);
assert.equal(floorRecord.floor_breached, true);
assert.equal(floorRecord.chosen_plugin_id, null);
assert.equal(floorRecord.chosen_model, undefined);
assert.equal(floorRecord.floor.model, 'claude-sonnet-5');
assert.match(floorRecord.reason, /floor_breached/);

console.log('test-two-step-resolver.js: all v3 resolver assertions passed');
