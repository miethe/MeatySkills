// Target-Node: node_01M6H8TAQK9PPV2YCF0MRM55P2
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolve } = require('../resolver.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'observed-routing-'));
const receipt = path.join(dir, 'availability.json');
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3/registry.json')));
const registryPath = path.join(dir, 'registry.json');
fs.writeFileSync(registryPath, JSON.stringify(registry));
const now = Date.now() / 1000;
function row(status, extra = {}) {
  return {status, observed_at: now - 10, expires_at: now + 100, reason: 'provider quota',
    source: 'provider.dispatch.json', until: null, ...extra};
}
function route(lanes, input = {}) {
  fs.writeFileSync(receipt, JSON.stringify({schema: 'aos.lane-availability/1',
    generated_at: now, ttl_seconds: 900, lanes}));
  return resolve({task_class: 'implementation', _registryPath: registryPath,
    availability_path: receipt, ...input});
}
// AC1: fresh quota exclusions apply before lane selection and retain evidence.
const fresh = route({codex_primary: row('LIMITED', {until: now + 100}), codex_secondary: row('AVAILABLE')});
assert.equal(fresh.identity_ref, 'codex_secondary');
const skipped = fresh.lane_decision.candidates.find(c => c.identity_ref === 'codex_primary');
assert.equal(skipped.verdict, 'excluded');
assert.match(skipped.reason, /LIMITED/);
assert.equal(skipped.availability.source, 'provider.dispatch.json');
assert(!fresh.fallback_chain.some(c => c.identity_ref === 'codex_primary'));
const viaCapacity = resolve({task_class: 'implementation', _registryPath: registryPath, capacity: JSON.parse(fs.readFileSync(receipt))});
assert.equal(viaCapacity.identity_ref, 'codex_secondary');
// AC2: rewritten receipts do not renew producer evidence; pending resets still hold.
const stale = route({codex_primary: row('LIMITED', {expires_at: now - 1, until: now - 1})});
assert.equal(stale.identity_ref, 'codex_primary');
const pending = route({codex_primary: row('UNMEASURED', {previous_status: 'LIMITED', expires_at: now - 1, until: now + 100})});
assert.equal(pending.identity_ref, 'codex_secondary');
assert.throws(() => route({}, {identity_ref: 'codex_primary'}), /pin_reason/);
const pinned = route({}, {identity_ref: 'codex_secondary', pin_reason: 'account-specific positive control'});
assert.equal(pinned.identity_ref, 'codex_secondary');
assert.equal(pinned.pin_reason, 'account-specific positive control');
assert.throws(() => route({codex_primary: row('LIMITED')},
  {identity_ref: 'codex_primary', pin_reason: 'must use primary'}), /does not serve/);
// Worst failure: LIMITED must never silently win, including all-holder exhaustion.
const negatives = {codex_primary: row('LIMITED'), codex_secondary: row('LIMITED'),
  'cc1x': row('DOWN'), 'cc-primary': row('LIMITED'), ica: row('AVAILABLE')};
const held = route(negatives);
assert.equal(held.chosen_plugin_id, null);
assert.equal(held.floor_breached, true);
assert.equal(held.fallback_chain.length, 0);
assert(held.availability_decisions['gpt-6-luna'].some(c => c.availability.observed_status === 'LIMITED'));
// Provider skip remains subordinate to the class's absolute personal-account minimum.
const floor = route(negatives, {task_class: 'mode_d'});
assert.equal(floor.chosen_plugin_id, null);
assert(Object.values(floor.availability_decisions).flat().filter(c => c.lane === 'ica_gateway_messages').every(c => c.verdict === 'excluded'));
assert(Object.values(floor.availability_decisions).flat().filter(c => c.lane !== 'claude_subscription').every(c => c.verdict === 'excluded'));
// Provider-level observations also cover ICA's separate paid pool without blocking free rows.
const serving = registry.models['claude-sonnet-5-5'].providers.find(p => p.lane === 'ica_gateway_messages');
serving.allowance = 'shared_token_pool';
fs.writeFileSync(registryPath, JSON.stringify(registry));
const paid = {ica: row('UNMEASURED', {paid_pool: {status: 'LIMITED', observed_at: now - 10, source: 'credit-ledger'}})};
const paidHeld = route(paid, {task_class: 'explicit_test', model: 'claude-sonnet-5-5', pin_reason: 'paid pool boundary fixture'});
assert.notEqual(paidHeld.lane, 'ica_gateway_messages');
serving.allowance = 'unlimited';
fs.writeFileSync(registryPath, JSON.stringify(registry));
const free = route(paid, {task_class: 'explicit_test', model: 'claude-sonnet-5-5', pin_reason: 'free pool boundary fixture'});
assert.equal(free.lane, 'ica_gateway_messages');
console.log('observed availability: AC1, AC2 and silent LIMITED selection boundaries passed');
