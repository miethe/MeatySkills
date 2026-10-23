'use strict';

// Actual upstream data, isolated copies, pinned clock: no deployed registry or network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { resolve } = require('./resolver.js');
const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'model-registry.generated.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'needs-envelope-'));
const registryPath = path.join(tmp, 'registry.json');
const now = '2026-10-23T22:00:00Z';
let count = 0;
function run(input = {}, registry = source) {
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  return resolve({ task_class: 'implementation', now, _registryPath: registryPath, ...input });
}
function test(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
function mutate(fn) { const copy = structuredClone(source); fn(copy); return copy; }
const approval = { preapproval_ref: 'req_test_pin', pin_reason: 'approved evaluation', pin_expires: '2026-10-30' };
try {
  test('xs/s cheap-first; m escalates to Sol, never Luna or Astra', () => {
    assert.equal(run({ size: 's' }).model, 'gpt-6-luna');
    const medium = run({ size: 'm' });
    assert.equal(medium.model, 'gpt-6.1-sol');
    assert.equal(medium.identity_ref, 'codex_primary');
    assert(!medium.escalation_ladder.some(c => /astra|fable|luna/.test(c.model)));
    assert.equal(medium.escalation_ladder[0].model, medium.model);
  });
  test('taste_high selects design_judgment holder; baseline stays cheap', () => {
    assert.equal(run({ modifiers: ['taste_high'] }).model, source.task_class_defaults.design_judgment.holders[0]);
    assert.equal(run().model, 'gpt-6-luna');
  });
  test('image_generation resolves through provider table', () => {
    const image = run({ capabilities: ['image_generation'] });
    assert.equal(image.model_decision.canonical_task_class, 'image_generation');
    assert.equal(image.lane, 'codex_subscription_primary');
    const absent = mutate(r => { r.capability_providers.image_generation.lanes = []; });
    assert.equal(run({ capabilities: ['image_generation'] }, absent).floor_breached, true);
  });
  test('unapproved exact pins refused through both APIs', () => {
    assert.throws(() => run({ model: 'gpt-6.1-sol' }), /Unapproved model pin/);
    assert.throws(() => run({ execution_contract: { model: 'gpt-6.1-sol' } }), /Unapproved model pin/);
    assert.equal(run({ model: 'gpt-6.1-sol', ...approval }).model, 'gpt-6.1-sol');
    assert.throws(() => run({ model: 'gpt-6.1-sol', ...approval, pin_expires: '2026-10-22' }), /Unapproved/);
  });
  test('approval gate carrier works; pins cannot bypass envelope', () => {
    const contract = { model: 'gpt-6.1-sol', pin_reason: 'evaluation', pin_expires: '2026-10-30', autonomy: { gates_to_achieve: [{ kind: 'approval', ref: 'req_gate' }] } };
    assert.equal(run({ size: 'm', execution_contract: contract }).model, 'gpt-6.1-sol');
    assert.equal(run({ size: 'm', model: 'gpt-6-luna', ...approval }).floor_breached, true);
  });
  test('retired pin returns class selection and a structured finding', () => {
    const retired = run({ model: 'gpt-6-sol', ...approval });
    assert.equal(retired.model, 'gpt-6-luna');
    assert.equal(retired.needs_decision.findings[0].kind, 'retired_model_pin');
  });
  test('unknown needs, wrong shapes and l/xl fail closed', () => {
    for (const input of [{ size: 'xxl' }, { size: 'l' }, { size: 'xl' }, { capabilities: ['telepathy'] }, { capabilities: 'network' }, { modifiers: ['fastest'] }]) assert.throws(() => run(input));
    assert.throws(() => run({ size: 's', sizing: { shaping: 'needs_plan' } }), /shaping/);
    assert.throws(() => run({ size: 's', human_minutes_est: 0 }), /positive/);
  });
  test('discounted p80 estimate boundary and negative control', () => {
    assert.equal(run({ size: 'm', human_minutes_est: 90 }).model, 'gpt-6.1-sol');
    assert.equal(run({ size: 'm', human_minutes_est: 91 }).floor_breached, true);
    assert.equal(run({ size: 'm', effort: 'high' }).floor_breached, true);
  });
  test('missing, stale and unavailable cell health cannot route or leak into fallback', () => {
    for (const edit of [r => { r.envelope.cells = []; }, r => { r.envelope.cells.forEach(c => { c.health_checked_at = '2026-10-01'; }); }, r => { r.envelope.cells.forEach(c => { c.health_status = 'unavailable'; }); }]) {
      const result = run({ size: 's' }, mutate(edit));
      assert.equal(result.floor_breached, true);
      assert.deepEqual(result.escalation_ladder, []);
      assert.deepEqual(result.fallback_chain, []);
    }
  });
  test('below-bar candidates cannot reappear in escalation', () => {
    const low = mutate(r => { r.models['claude-sonnet-5-5'].scores = { intelligence: 1, taste: 1, speed: 1 }; });
    assert(!run({ size: 's' }, low).escalation_ladder.some(c => c.model === 'claude-sonnet-5-5'));
  });
  test('minimums survive capability and taste class changes', () => {
    const restricted = mutate(r => { r.task_class_defaults.implementation.minimum = { lanes: [], reason: 'disclosure_absolute' }; });
    assert.equal(run({ modifiers: ['taste_high'] }, restricted).floor_breached, true);
    assert.equal(run({ capabilities: ['image_generation'] }, restricted).floor_breached, true);
  });
  test('harness capability is lane-specific, including fallbacks', () => {
    assert.equal(run({ capabilities: ['browser_verification'] }).floor_breached, true);
    const browser = mutate(r => { r.lanes.codex_subscription_primary.harness_capabilities.push('browser_verification'); });
    const result = run({ capabilities: ['browser_verification'] }, browser);
    assert.equal(result.lane, 'codex_subscription_primary');
    assert(result.fallback_chain.every(c => c.lane === 'codex_subscription_primary'));
  });
  test('context capability excludes 400k and accepts 500k', () => {
    const short = mutate(r => { r.models['gpt-6-luna'].max_context = 400000; r.models['gpt-6-luna'].providers.forEach(p => { p.max_context = 400000; }); });
    assert.equal(run({ capabilities: ['long_context_500k'], size: 's' }, short).model, 'gpt-6.1-sol');
    assert.equal(run({ capabilities: ['long_context_500k'], size: 's' }).model, 'gpt-6-luna');
  });
  test('cross_family_review adds a distinct eligible reviewer or refuses', () => {
    const result = run({ modifiers: ['cross_family_review'] });
    assert(result.reviewer);
    assert.notEqual(source.models[result.model].family, source.models[result.reviewer.model].family);
    const noOtherFamily = mutate(r => { for (const model of Object.values(r.models)) if (model.family !== 'openai') model.providers = []; });
    assert.throws(() => run({ modifiers: ['cross_family_review'] }, noOtherFamily), /cross-family reviewer/);
  });
  test('explicit write need produces a write invocation without raising reasoning effort', () => {
    const write = run({ size: 'm', requires_write: true });
    assert.match(write.invocation_template, /--sandbox workspace-write/);
    assert.match(run({ size: 'm', requires_write: true, profile: 'free-tier' }).invocation_template, /--sandbox workspace-write/);
    assert.match(write.invocation_template, /model_reasoning_effort="medium"/);
    assert.match(run({ size: 'm' }).invocation_template, /--sandbox read-only/);
    assert.equal(run({ size: 'm', requires_write: true, profile: 'sandbox=read-only' }).floor_breached, true);
  });
  test('reviewer preserves original class account minimum', () => {
    const reviewed = run({ modifiers: ['cross_family_review'] });
    assert.equal(source.lanes[reviewed.reviewer.lane].attributes.account_relationship, 'personal');
  });
  test('cost_tail_ok records intent without widening envelope', () => {
    assert.equal(run({ size: 'm', modifiers: ['cost_tail_ok'] }).model, 'gpt-6.1-sol');
    assert.throws(() => run({ size: 'l', modifiers: ['cost_tail_ok'] }), /needs_decomposition/);
  });
  test('contract-only needs work and caller objects remain unchanged', () => {
    const input = { effort_size: 'm', execution_contract: { capabilities: [], modifiers: [], sizing: { human_minutes_est: 80, shaping: 'direct' } } };
    const before = JSON.stringify(input);
    assert.equal(run(input).model, 'gpt-6.1-sol');
    assert.equal(JSON.stringify(input), before);
  });
  test('CLI uses abstract needs and refuses a pin without preapproval', () => {
    fs.writeFileSync(registryPath, JSON.stringify(source));
    const needsPath = path.join(tmp, 'needs.json');
    fs.writeFileSync(needsPath, JSON.stringify({ size: 'm' }));
    const cli = path.join(__dirname, 'resolve-cli.js');
    const good = spawnSync(process.execPath, [cli, 'resolve', '--task-class', 'implementation', '--needs-file', needsPath, '--registry', registryPath, '--json'], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).model, 'gpt-6.1-sol');
    const bad = spawnSync(process.execPath, [cli, 'resolve', '--task-class', 'implementation', '--model', 'gpt-6.1-sol', '--registry', registryPath], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Unapproved model pin/);
  });
  console.log(`${count} needs/envelope tests passed`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
