/**
 * Registry v2 task_class_defaults — tests/test-task-class-defaults.js
 * (routing M1, node_01M4C696HR9WVV6BVZ2FXQZH0Y)
 *
 * 1. GOLDEN: every class in task-class-vocabulary.v1.json resolves, against the committed
 *    registry, to the expected role holder, and the record carries the class_default trail
 *    (holder, q vs bar, set_by evidence) whenever task_class_defaults decided.
 * 2. Scores are READ: a holder whose measured q falls below the class bar is skipped and recorded;
 *    an unmeasured q is never gated.
 * 3. The human override channel still wins: a routing.local.toml routing_policy_override suspends
 *    the class's defaults entry.
 * 4. Still zero model calls: resolver.js requires no process/network module.
 *
 * NO shell, NO child_process. Run: node tests/test-task-class-defaults.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const { resolve, classQuality } = require(path.join(ROOT, 'resolver.js'));
const REGISTRY_JSON = path.join(ROOT, 'model-registry.generated.json');
const VOCAB = JSON.parse(fs.readFileSync(path.join(ROOT, 'task-class-vocabulary.v1.json'), 'utf8'));
const ABSENT_LOCAL = path.join(os.tmpdir(), `dr-tcd-absent-${process.pid}.toml`);

let pass = 0;
let fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  PASS  ${name}`); } catch (e) { fail++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
}
function run(input) {
  return resolve({ model: 'sonnet', identity_ref: 'codex_secondary', _registryPath: REGISTRY_JSON, _localConfigPath: ABSENT_LOCAL, ...input });
}

// ---------------------------------------------------------------------------
// 1. Golden table — one row per vocabulary class. [provider, model, holder_index|null, extra input]
//    holder_index null = task_class_defaults did not decide (documented reason in the row).
// ---------------------------------------------------------------------------
const GOLDEN = {
  exploration:      ['claude', 'claude-haiku-5-5', 0],   // positioning 2026-10-07: Haiku 5.5 owns it
  documentation:    ['ica', 'gpt-5.6-luna', 0],          // free ICA Luna owns public bulk work
  mechanical:       ['ica', 'gpt-5.6-luna', 0],
  second_opinion:   ['codex', 'gpt-6-luna', 0],          // cross-family paid peer
  implementation:   ['claude', 'sonnet', 0],             // label echoes the caller's bare 'sonnet'
  design_judgment:  ['claude', 'claude-opus-5-5', 0],
  raw_strength:     ['codex', 'gpt-6.1-sol', 0],
  // Both native gemini instances are enabled:false, so the walk lands on holder 2 (pre-existing).
  web_research:     ['ica', 'gemini-3.1-pro-preview', 2],
  code_review:      ['codex', 'gpt-6-luna', 0],
  image_generation: ['codex', 'gpt-6-luna', 0],
  svg_generation:   ['claude', 'claude-fable-5-1', 0],   // flagged in evidence: Fable 5.1 auto-route
  video_generation: ['sora', 'sora-2', 0],
  // Tool-less Sol holder needs needs_tools:false (node_01M122PQQ86YWJWDA9GT83PBWQ).
  review:           ['ica', 'gpt-5.6-sol', 0, { needs_tools: false }],
  adjudication:     ['ica', 'gpt-5.6-sol', 0, { needs_tools: false }],
  critique:         ['ica', 'gpt-5.6-sol', 0, { needs_tools: false }],
  advanced_sol:     ['codex', 'gpt-6-astra', 0],
  orchestration:    ['claude', 'claude-opus-5-5', 0],
  mode_d:           ['claude', 'claude-opus-5-5', 0],
  verdict:          ['claude', 'claude-opus-5-5', 0],
  council_review:   ['claude', 'claude-opus-5-5', 0],
  synthesis:        ['claude', 'claude-opus-5-5', 0],
  schema_recovery:  ['claude', 'claude-opus-5-5', 0],
  cross_wave_merge: ['claude', 'claude-opus-5-5', 0],
};

console.log('\n1. golden resolution per vocabulary class');
test('golden table covers exactly the canonical vocabulary', () => {
  assert.deepStrictEqual(Object.keys(GOLDEN).sort(), VOCAB.classes.map(c => c.id).sort());
});
for (const [cls, [provider, model, holderIndex, extra]] of Object.entries(GOLDEN)) {
  test(`${cls} -> ${provider}/${model}`, () => {
    const r = run({ task_class: cls, ...(extra || {}) });
    assert.strictEqual(r.chosen_plugin_id, provider);
    assert.strictEqual(r.model, model);
    assert.ok(r.class_default, `${cls}: expected a class_default trail`);
    assert.strictEqual(r.class_default.source, 'task_class_defaults');
    assert.strictEqual(r.class_default.task_class, cls);
    assert.strictEqual(r.class_default.holder_index, holderIndex);
    assert.ok(['pass', 'unmeasured'].includes(r.class_default.bar_check));
    assert.ok(/^evidence\/.+\.md$/.test(r.class_default.set_by_evidence), r.class_default.set_by_evidence);
    assert.ok(/^[0-9a-f]{16}$/.test(r.class_default.set_by_fingerprint));
    assert.ok(r.reason.includes(`task_class_defaults['${cls}'] holders`), r.reason);
  });
}
test('a tool-needing review leg does not reach the tool-less Sol holder (class_default absent)', () => {
  const r = run({ task_class: 'review' });
  assert.notStrictEqual(r.chosen_plugin_id, 'ica');
  assert.strictEqual(r.class_default, null);
});
test('positioning role map: Haiku 5.5 is a ROLE HOLDER, first in exploration, never only a price fallback', () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY_JSON, 'utf8'));
  const tcd = reg.task_class_defaults;
  assert.strictEqual(tcd.exploration.holders[0], 'claude/claude-haiku-5-5');
  for (const cls of ['documentation', 'mechanical']) {
    assert.ok(tcd[cls].holders.includes('claude/claude-haiku-5-5'));
    assert.ok(tcd[cls].holders.includes('codex/gpt-6-luna'));
  }
  assert.ok(tcd.exploration.set_by.evidence.endsWith('positioning-2026-10-07.md'));
});

// ---------------------------------------------------------------------------
// 2. Scores are read: the bar gate, against a synthetic v2 registry.
// ---------------------------------------------------------------------------
console.log('\n2. bar gate (scores are read at resolve time)');
function writeRegistry(mutator) {
  const reg = JSON.parse(fs.readFileSync(REGISTRY_JSON, 'utf8'));
  mutator(reg);
  const p = path.join(os.tmpdir(), `dr-tcd-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(reg));
  return p;
}
test('a holder re-scored below the class bar is skipped and recorded', () => {
  const p = writeRegistry(reg => { reg.models['claude-haiku-5-5'].scores = { cost: 10, intelligence: 2, taste: 2, speed: 2 }; });
  const r = run({ task_class: 'exploration', _registryPath: p });
  assert.strictEqual(r.chosen_plugin_id, 'ica');
  assert.strictEqual(r.model, 'gpt-5.6-luna');
  assert.strictEqual(r.class_default.holder_index, 1);
  assert.deepStrictEqual(r.class_default.below_bar.map(b => b.holder), ['claude/claude-haiku-5-5']);
  assert.ok(r.class_default.below_bar[0].q < r.class_default.bar);
});
test('an UNMEASURED weighted score is never gated (bar_check: unmeasured)', () => {
  const p = writeRegistry(reg => { reg.models['claude-haiku-5-5'].scores.speed = 'UNMEASURED'; });
  const r = run({ task_class: 'exploration', _registryPath: p });
  assert.strictEqual(r.model, 'claude-haiku-5-5');
  assert.strictEqual(r.class_default.bar_check, 'unmeasured');
  assert.strictEqual(r.class_default.q, null);
});
test('classQuality mirrors the weighted sum and ignores zero weights', () => {
  assert.strictEqual(classQuality({ scores: { intelligence: 7, taste: 7, speed: 9 } }, { w_intelligence: 0.4, w_taste: 0.1, w_speed: 0.5 }), 8);
  assert.strictEqual(classQuality({ scores: { intelligence: 9, taste: 8, speed: 'UNMEASURED' } }, { w_intelligence: 0.6, w_taste: 0.4, w_speed: 0 }), 8.6);
  assert.strictEqual(classQuality({ scores: { intelligence: 9, taste: 'UNMEASURED', speed: 4 } }, { w_intelligence: 0.5, w_taste: 0.5, w_speed: 0 }), null);
});
test('a registry WITHOUT task_class_defaults keeps walking routing_policy (v1 compatibility)', () => {
  const p = writeRegistry(reg => { delete reg.task_class_defaults; reg.version = 1; });
  const r = run({ task_class: 'exploration', _registryPath: p });
  assert.strictEqual(r.model, 'claude-haiku-5-5');
  assert.strictEqual(r.class_default, null);
  assert.ok(r.reason.includes("routing_policy['exploration'] chain"), r.reason);
});

// ---------------------------------------------------------------------------
// 3. The human override channel still wins.
// ---------------------------------------------------------------------------
console.log('\n3. routing.local.toml override suspends the class defaults entry');
test('routing_policy_overrides for a non-floored class beats its task_class_defaults holders', () => {
  const toml = path.join(os.tmpdir(), `dr-tcd-override-${process.pid}.toml`);
  fs.writeFileSync(toml, '[routing_policy_overrides.exploration]\nchain = ["codex/gpt-6-luna"]\n');
  try {
    const r = run({ task_class: 'exploration', _localConfigPath: toml });
    assert.strictEqual(r.chosen_plugin_id, 'codex');
    assert.strictEqual(r.model, 'gpt-6-luna');
    assert.strictEqual(r.class_default, null);
  } finally { fs.unlinkSync(toml); }
});

// ---------------------------------------------------------------------------
// 4. Still zero model calls.
// ---------------------------------------------------------------------------
console.log('\n4. zero model calls on the resolve path');
test('resolver.js requires no process or network module', () => {
  const src = fs.readFileSync(path.join(ROOT, 'resolver.js'), 'utf8');
  for (const mod of ['child_process', 'http', 'https', 'net', 'tls', 'dgram']) {
    assert.ok(!new RegExp(`require\\(['"]${mod}['"]\\)`).test(src), `resolver.js requires '${mod}'`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
