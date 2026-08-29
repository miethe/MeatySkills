/**
 * Project-local override tests — tests/test-local-overrides.js
 *
 * Exercises routing.local.toml override semantics layered on top of the GLOBAL
 * model registry (resolver.js registry path). Overrides are discovered at
 * process.cwd()/.claude/config/routing.local.toml, or injected via
 * input._localConfigPath for test isolation.
 *
 * Required scenarios:
 *   (a) absent routing.local.toml → identical decisions to today (regression guard)
 *   (b) disabled_providers=["ica"] for exploration → falls through to claude
 *   (c) disabled_models excludes a model from candidacy
 *   (d) priority_overrides re-ranks a specific instance
 *   (e) MUST-stay cannot be overridden: routing_policy_override routing
 *       orchestration to ica is IGNORED → still claude
 *
 * NO shell, NO child_process. Node built-in assert + fs only.
 *
 * Run: node .claude/skills/delegation-router/tests/test-local-overrides.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

let passCount = 0;
let failCount = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passCount++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failures.push({ name, error: e.message });
    failCount++;
  }
}

function describe(suiteName, fn) {
  console.log(`\n${suiteName}`);
  fn();
}

const resolverPath = path.join(__dirname, '..', 'resolver.js');
const { resolve } = require(resolverPath);

// ---------------------------------------------------------------------------
// Synthetic registry fixture (mirrors test-registry-resolver.js)
// ---------------------------------------------------------------------------

function baseRegistry() {
  return {
    version: 1,
    routing_policy: {
      exploration:    { chain: ['ica/claude-haiku-4-5', 'claude/claude-haiku-4-5'], enabled: true },
      mechanical:     { chain: ['ica/claude-haiku-4-5', 'ica/gemma-4-26b-a4b-it', 'claude/claude-haiku-4-5'], enabled: true },
      implementation: { chain: ['claude/claude-sonnet-4-6'], enabled: true },
      orchestration:  { chain: ['claude/claude-opus-4-8'] },
    },
    must_stay_primary: ['orchestration', 'verdict', 'mode_d', 'council_review', 'synthesis'],
    models: {
      'claude-opus-4-8': {
        family: 'claude', class: 'opus', sampling: 'deterministic', status: 'active',
        providers: [
          { provider: 'claude', model_id: 'claude-opus-4-8', cost_tier: 'premium', allowance: 'billed', enabled: true, priority: 1 },
        ],
      },
      'claude-sonnet-4-6': {
        family: 'claude', class: 'sonnet', sampling: 'deterministic', status: 'active',
        providers: [
          { provider: 'claude', model_id: 'claude-sonnet-4-6', cost_tier: 'standard', allowance: 'billed', enabled: true, priority: 1 },
          { provider: 'ica', model_id: 'claude-sonnet-4-6', cost_tier: 'standard', allowance: 'shared_token_pool', enabled: true, priority: 2 },
        ],
      },
      'claude-haiku-4-5': {
        family: 'claude', class: 'haiku', sampling: 'stochastic', status: 'active',
        providers: [
          { provider: 'ica', model_id: 'claude-haiku-4-5', cost_tier: 'free', allowance: 'unlimited', enabled: true, priority: 1 },
          { provider: 'claude', model_id: 'claude-haiku-4-5', cost_tier: 'billed', allowance: 'billed', enabled: true, priority: 2 },
        ],
      },
      'gemma-4-26b': {
        family: 'open', class: 'gemma', sampling: 'stochastic', status: 'active',
        providers: [
          { provider: 'ica', model_id: 'gemma-4-26b-a4b-it', cost_tier: 'free', allowance: 'unlimited', enabled: true, priority: 1 },
        ],
      },
    },
  };
}

let tmpCounter = 0;
function tmpFile(ext) {
  tmpCounter += 1;
  return path.join(os.tmpdir(), `dr-override-${process.pid}-${tmpCounter}.${ext}`);
}

function writeRegistry(reg) {
  const p = tmpFile('json');
  fs.writeFileSync(p, JSON.stringify(reg), 'utf8');
  return p;
}

function writeLocalToml(text) {
  const p = tmpFile('toml');
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

/**
 * Resolve against a synthetic registry, optionally injecting a routing.local.toml.
 * Cleans up all temp files afterward.
 */
function resolveWith(reg, params, localTomlText) {
  const regPath = writeRegistry(reg);
  const tomlPath = localTomlText !== undefined ? writeLocalToml(localTomlText) : null;
  const input = { ...params, _registryPath: regPath };
  // When NO local toml is provided, point discovery at a guaranteed-absent path so the
  // test never accidentally picks up a real cwd routing.local.toml.
  input._localConfigPath = tomlPath || path.join(os.tmpdir(), `dr-absent-${process.pid}-${tmpCounter}.toml`);
  try {
    return resolve(input);
  } finally {
    fs.unlinkSync(regPath);
    if (tomlPath) fs.unlinkSync(tomlPath);
  }
}

// ---------------------------------------------------------------------------
// (a) absent routing.local.toml → identical to today (regression guard)
// ---------------------------------------------------------------------------

describe('(a) absent routing.local.toml → identical decisions (regression guard)', () => {
  test('exploration with no local config → ICA free haiku (unchanged)', () => {
    const reg = baseRegistry();
    const withAbsent = resolveWith(reg, { model: 'haiku', task_class: 'exploration', effort: 'low' });
    assert.strictEqual(withAbsent.chosen_plugin_id, 'ica',
      `absent local config must preserve free-first; got ${withAbsent.chosen_plugin_id}`);
  });

  test('absent config decision is byte-identical across two guaranteed-absent paths', () => {
    const reg = baseRegistry();
    // Run 1: explicit absent local path (resolveWith injects a guaranteed-absent _localConfigPath).
    const a = resolveWith(reg, { model: 'sonnet', task_class: 'implementation' });
    // Run 2: a SECOND, distinct guaranteed-absent _localConfigPath. We must inject an
    // explicit absent path (NOT rely on cwd lacking a routing.local.toml) so the test is
    // robust regardless of what file happens to sit at process.cwd()/.claude/config.
    const regPath = writeRegistry(reg);
    let b;
    try {
      b = resolve({
        model: 'sonnet',
        task_class: 'implementation',
        _registryPath: regPath,
        _localConfigPath: path.join(os.tmpdir(), `dr-absent-bi-${process.pid}-${Date.now()}.toml`),
      });
    } finally {
      fs.unlinkSync(regPath);
    }
    assert.strictEqual(a.chosen_plugin_id, b.chosen_plugin_id);
    assert.strictEqual(a.model, b.model);
  });
});

// ---------------------------------------------------------------------------
// (b) disabled_providers=["ica"] for exploration → falls through to claude
// ---------------------------------------------------------------------------

describe('(b) disabled_providers excludes a provider', () => {
  test('disabled_providers=["ica"] + exploration → claude (not ica)', () => {
    const reg = baseRegistry();
    const toml = `disabled_providers = ["ica"]\n`;
    const record = resolveWith(reg, { model: 'haiku', task_class: 'exploration', effort: 'low' }, toml);
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `disabled ICA provider must drop ICA candidacy → claude; got ${record.chosen_plugin_id}`);
  });

  test('disabled_providers=["ica"] also removes ICA from the fallback chain', () => {
    const reg = baseRegistry();
    const toml = `disabled_providers = ["ica"]\n`;
    const record = resolveWith(reg, { model: 'haiku', task_class: 'mechanical', effort: 'low' }, toml);
    assert.strictEqual(record.chosen_plugin_id, 'claude');
    const icaInChain = (record.fallback_chain || []).some(e => e.plugin_id === 'ica');
    assert.ok(!icaInChain, `ICA must not appear in fallback chain when disabled; chain=${JSON.stringify(record.fallback_chain)}`);
  });
});

// ---------------------------------------------------------------------------
// (c) disabled_models excludes a model from candidacy
// ---------------------------------------------------------------------------

describe('(c) disabled_models excludes a model key', () => {
  test('disabled_models=["gemma-4-26b"] → mechanical chain skips ICA gemma', () => {
    const reg = baseRegistry();
    // Disable ICA haiku via registry so the chain WOULD otherwise reach gemma.
    reg.models['claude-haiku-4-5'].providers[0].enabled = false;
    const toml = `disabled_models = ["gemma-4-26b"]\n`;
    const record = resolveWith(reg, { model: 'haiku', task_class: 'mechanical', effort: 'low' }, toml);
    // ica haiku disabled (registry) + gemma model disabled (local) → claude haiku tail.
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `both free ICA options gone → claude; got ${record.chosen_plugin_id} model=${record.model}`);
    assert.notStrictEqual(record.model, 'gemma-4-26b-a4b-it');
  });

  test('disabled_models can exclude the requested model → claude fallback', () => {
    const reg = baseRegistry();
    const toml = `disabled_models = ["claude-sonnet-4-6"]\n`;
    const record = resolveWith(reg, { model: 'sonnet', provider: 'ica', task_class: 'planning' }, toml);
    // sonnet model removed entirely → no candidates → claude fallback record.
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });
});

// ---------------------------------------------------------------------------
// (d) priority_overrides re-ranks a specific instance
// ---------------------------------------------------------------------------

describe('(d) priority_overrides re-ranks an instance', () => {
  test('promoting ica sonnet via priority_overrides changes ranking tie-break', () => {
    const reg = baseRegistry();
    // Drop the chain so cost/priority ranking decides; both sonnet instances are
    // cost_tier=standard, neither free → priority breaks the tie.
    delete reg.routing_policy.implementation;
    // Baseline: claude (priority 1) beats ica (priority 2).
    const baseline = resolveWith(reg, { model: 'sonnet', task_class: 'planning' });
    assert.strictEqual(baseline.chosen_plugin_id, 'claude');

    // Override: make claude sonnet priority 9, ica sonnet priority 0 → ica wins the tie.
    const toml = [
      '[priority_overrides]',
      '"ica/claude-sonnet-4-6" = 0',
      '"claude/claude-sonnet-4-6" = 9',
      '',
    ].join('\n');
    const reranked = resolveWith(reg, { model: 'sonnet', task_class: 'planning' }, toml);
    assert.strictEqual(reranked.chosen_plugin_id, 'ica',
      `priority_overrides should promote ICA sonnet; got ${reranked.chosen_plugin_id}`);
  });
});

// ---------------------------------------------------------------------------
// (e) MUST-stay cannot be overridden by routing_policy_overrides
// ---------------------------------------------------------------------------

describe('(e) MUST-stay cannot be overridden by a local routing_policy_override', () => {
  test('routing_policy_override routing orchestration to ica is IGNORED → claude', () => {
    const reg = baseRegistry();
    const toml = [
      '[routing_policy_overrides.orchestration]',
      'chain = ["ica/claude-haiku-4-5"]',
      '',
    ].join('\n');
    const record = resolveWith(reg, { model: 'haiku', provider: 'ica', task_class: 'orchestration' }, toml);
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `orchestration is MUST-stay; local override must be ignored → claude; got ${record.chosen_plugin_id}`);
    assert.strictEqual(record.agent_type_id, 'claude');
  });

  test('routing_policy_override for a NON-MUST-stay class IS honored', () => {
    const reg = baseRegistry();
    // Force exploration onto claude haiku via a local chain override (legal — not MUST-stay).
    const toml = [
      '[routing_policy_overrides.exploration]',
      'chain = ["claude/claude-haiku-4-5"]',
      '',
    ].join('\n');
    const record = resolveWith(reg, { model: 'haiku', task_class: 'exploration', effort: 'low' }, toml);
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `non-MUST-stay override should reroute exploration to claude; got ${record.chosen_plugin_id}`);
  });

  test('synthesis (registry must_stay) override to ica is IGNORED → claude', () => {
    const reg = baseRegistry();
    const toml = [
      '[routing_policy_overrides.synthesis]',
      'chain = ["ica/claude-haiku-4-5"]',
      '',
    ].join('\n');
    const record = resolveWith(reg, { model: 'haiku', provider: 'ica', task_class: 'synthesis' }, toml);
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });
});

// ---------------------------------------------------------------------------
// (f) MUST-stay model lookup is override-independent (adversarial — proves Fix 2)
//
// A project's disabled_providers/disabled_models must NOT be able to strip the real
// claude instance for a MUST-stay class and degrade the record to a hardcoded sonnet
// fallback. The MUST-stay short-circuit resolves against the PRE-override registry.
// ---------------------------------------------------------------------------

describe('(f) MUST-stay model lookup is override-independent (Fix 2)', () => {
  test('disabled_providers=["claude"] on orchestration → still real claude opus instance', () => {
    const reg = baseRegistry();
    const toml = `disabled_providers = ["claude"]\n`;
    const record = resolveWith(reg, { model: 'opus', provider: 'ica', task_class: 'orchestration' }, toml);
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `MUST-stay must stay claude regardless of disabled_providers; got ${record.chosen_plugin_id}`);
    assert.strictEqual(record.agent_type_id, 'claude');
    assert.ok(record.invocation_template.startsWith('claude -p'),
      `invocation must start with 'claude -p'; got ${record.invocation_template}`);
    // Fix 2: model resolves to the REAL requested-model claude instance (opus), not the
    // hardcoded sonnet fallback that a post-override registry (claude stripped) would force.
    assert.ok(/claude-opus-4-8/.test(record.invocation_template),
      `model must be the real claude opus instance, not the sonnet fallback; got ${record.invocation_template}`);
    assert.notStrictEqual(record.model, 'claude-sonnet-4-6');
  });

  test('disabled_models removing the needed claude opus on orchestration → still real claude opus', () => {
    const reg = baseRegistry();
    const toml = `disabled_models = ["claude-opus-4-8"]\n`;
    const record = resolveWith(reg, { model: 'opus', provider: 'ica', task_class: 'orchestration' }, toml);
    assert.strictEqual(record.chosen_plugin_id, 'claude');
    assert.strictEqual(record.agent_type_id, 'claude');
    assert.ok(record.invocation_template.startsWith('claude -p'),
      `invocation must start with 'claude -p'; got ${record.invocation_template}`);
    // Without Fix 2, disabling the opus model key would erase the opus instance from the
    // post-override registry and degrade the record to the sonnet fallback.
    assert.ok(/claude-opus-4-8/.test(record.invocation_template),
      `model must remain the real claude opus instance; got ${record.invocation_template}`);
    assert.notStrictEqual(record.model, 'claude-sonnet-4-6');
  });
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failures.length > 0) {
  console.error('\nFailed tests:');
  for (const f of failures) {
    console.error(`  - ${f.name}`);
    console.error(`    ${f.error}`);
  }
  process.exit(1);
} else {
  console.log('All local-override tests passed.');
  process.exit(0);
}
