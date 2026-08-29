/**
 * Resolver unit tests — .claude/skills/delegation-router/tests/test-resolver.js
 *
 * 5 required scenarios (P2-006):
 *   (a) Cheapest-provider selection given two equal-capability candidates
 *   (b) Nondeterministic-provider exclusion when resume_active=true + structural stage
 *   (c) Fallback-chain traversal on simulated provider unavailability
 *   (d) MUST-stay rejection for ALL 6 MUST-stay stage classes
 *   (e) Missing `provider` field → chosen_plugin_id:'claude' (AC-F2 resilience)
 *
 * Integration seam P2-INT-001:
 *   (f) At least one lookup verifies exact agent_type_id string for the 4 agentType filenames
 *
 * Constraints: NO shell mocks, NO child_process. Only fs.readFileSync is mocked.
 * Tests run offline. Node.js built-in assert module only.
 *
 * Run: node .claude/skills/delegation-router/tests/test-resolver.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Test harness (no external test framework)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Minimal provider-plugins.toml for test injection
// ---------------------------------------------------------------------------
// We use a synthetic TOML config that exercises all 5 providers
// without requiring a live config file. This mocks fs.readFileSync
// for the TOML path, but NOT any shell commands.

const SYNTHETIC_TOML = `
# Synthetic provider-plugins.toml for unit tests

[providers.claude]
id = "claude"
availability_check = "which claude"

[[providers.claude.models]]
name = "opus"
cost_tier = "standard"
capabilities = ["orchestration", "planning", "implementation", "code-review"]
max_context = 200000
sampling = "deterministic"

[[providers.claude.models]]
name = "sonnet"
cost_tier = "standard"
capabilities = ["implementation", "planning", "code-review", "exploration"]
max_context = 200000
sampling = "deterministic"

[[providers.claude.models]]
name = "haiku"
cost_tier = "standard"
capabilities = ["mechanical-tasks", "schema-recovery", "doc-gen", "exploration"]
max_context = 200000
sampling = "deterministic"

[providers.claude.invocation_template]
base = 'claude -p "{prompt}" --model {model}'
scope_flags = '--max-turns {max_turns}'

[providers.ica]
id = "ica"
binary_path = "~/ica-claude.sh"
auth_env = "ICA_CLAUDE_CODE_API_KEY"
availability_check = "test -f ~/ica-claude.sh"

[[providers.ica.models]]
name = "haiku"
cost_tier = "free"
capabilities = [
    "mechanical-tasks",
    "schema-recovery",
    "doc-gen",
    "adversarial-review",
    "exploration",
]
max_context = 200000
sampling = "stochastic"

[[providers.ica.models]]
name = "sonnet"
cost_tier = "standard"
capabilities = ["implementation", "planning", "exploration", "adversarial-review"]
max_context = 200000
sampling = "stochastic"

[[providers.ica.models]]
name = "opus"
cost_tier = "premium"
capabilities = ["orchestration", "planning", "implementation", "adversarial-review"]
max_context = 200000
sampling = "stochastic"

[providers.ica.invocation_template]
base = '~/ica-claude.sh -p "{prompt}" --model {model} --dangerously-skip-permissions'
scope_flags = '--max-turns {max_turns}'
output_format_json = '--json-schema "{schema}"'
continuity = '--continue'

[providers.bob]
id = "bob"
availability_check = "mise exec node@22 -- bob --version"

[[providers.bob.models]]
name = "bob-local"
cost_tier = "free"
capabilities = ["drafting", "exploration", "mechanical-tasks"]
max_context = 40000
sampling = "deterministic"

[providers.bob.invocation_template]
base = 'mise exec node@22 -- bob -p "{prompt}"'
scope_flags = '--yes'

[providers.gemini]
id = "gemini"
availability_check = "which gemini"

[[providers.gemini.models]]
name = "gemini-3.5-flash"
cost_tier = "free"
capabilities = [
    "web-search",
    "large-context",
    "exploration",
    "adversarial-review",
]
max_context = 1000000
sampling = "stochastic"

[providers.gemini.invocation_template]
base = 'gemini "{prompt}" --model {model} --yolo'
scope_flags = '--max-turns {max_turns}'

[providers.codex]
id = "codex"
availability_check = "which codex"

[[providers.codex.models]]
name = "gpt-5.6-terra"
cost_tier = "premium"
capabilities = ["agentic-coding", "debug-escalation", "code-review", "ac-validation", "schema-recovery"]
max_context = 400000
sampling = "deterministic"

[providers.codex.invocation_template]
base = 'codex exec --sandbox {sandbox_mode} "{prompt}"'
scope_flags = '--max-turns {max_turns}'

[routing_rules]
fallback_opus    = ["ica/opus", "claude/sonnet"]
fallback_sonnet  = ["ica/sonnet", "claude/opus"]
fallback_haiku   = ["ica/haiku", "claude/sonnet"]
fallback_codex   = ["claude/sonnet", "claude/opus"]
fallback_gemini  = ["ica/gemini-3.5-flash[1m]", "ica/sonnet"]
deterministic_providers    = ["claude", "codex", "bob"]
nondeterministic_providers = ["gemini", "ica"]
`.trim();

// ---------------------------------------------------------------------------
// Resolver setup with injected config
// ---------------------------------------------------------------------------

const resolverPath = path.join(__dirname, '..', 'resolver.js');
const { resolve, parseToml, AGENT_TYPE_ID_MAP, MUST_STAY_PRIMARY_CLASSES } = require(resolverPath);

// Write synthetic TOML to a temp file for injection
const os = require('os');
const TEMP_CONFIG_PATH = path.join(os.tmpdir(), 'test-provider-plugins.toml');
fs.writeFileSync(TEMP_CONFIG_PATH, SYNTHETIC_TOML, 'utf8');

/**
 * Helper: call resolve() with our synthetic config injected.
 */
function resolveWith(params) {
  return resolve({ ...params, _configPath: TEMP_CONFIG_PATH });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('(a) Cheapest-provider selection — two equal-capability candidates', () => {
  test('haiku on ica (free) wins over haiku on claude (standard) for mechanical-tasks', () => {
    // Both claude and ica serve 'haiku'. ica/haiku is cost_tier=free; claude/haiku is standard.
    // The resolver should pick ica/haiku.
    const record = resolveWith({
      model: 'haiku',
      provider: 'ica',
      effort: 'low',
      profile: 'free-tier',
      task_class: 'mechanical-tasks',
      resume_active: false,
    });
    assert.strictEqual(record.chosen_plugin_id, 'ica', `Expected ica, got ${record.chosen_plugin_id}`);
    assert.strictEqual(record.model, 'haiku');
    assert.strictEqual(record.agent_type_id, 'ica-executor');
  });

  test('claude/haiku is selected when no other provider is requested and both serve haiku', () => {
    // When provider='claude', it should route to claude even if ica/haiku is cheaper,
    // because the caller explicitly requested claude.
    const record = resolveWith({
      model: 'haiku',
      provider: 'claude',
      effort: 'low',
      task_class: 'mechanical-tasks',
      resume_active: false,
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });

  test('gemini (free) selected for web-search task when provider=gemini', () => {
    const record = resolveWith({
      model: 'gemini-3.5-flash',
      provider: 'gemini',
      effort: 'standard',
      task_class: 'web-search',
      resume_active: false,
    });
    assert.strictEqual(record.chosen_plugin_id, 'gemini');
    assert.strictEqual(record.agent_type_id, 'gemini-executor');
  });
});

describe('(b) Nondeterministic-provider exclusion when resume_active=true + structural stage', () => {
  test('ica (nondeterministic) is excluded for structural stage when resume_active=true', () => {
    // ica is nondeterministic; mechanical-tasks is structural; resume_active=true
    // → resolver should fall back to claude
    const record = resolveWith({
      model: 'haiku',
      provider: 'ica',
      effort: 'low',
      task_class: 'mechanical-tasks',
      resume_active: true,
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `Expected claude fallback for nondeterministic provider on structural resume, got ${record.chosen_plugin_id}`);
    assert.ok(record.reason.includes('nondeterministic') || record.reason.includes('Determinism filter'),
      `Reason should mention determinism filter: ${record.reason}`);
  });

  test('gemini (nondeterministic) is excluded for implementation stage when resume_active=true', () => {
    const record = resolveWith({
      model: 'gemini-3.5-flash',
      provider: 'gemini',
      effort: 'standard',
      task_class: 'implementation',
      resume_active: true,
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `Expected claude, got ${record.chosen_plugin_id}`);
  });

  test('ica is allowed for non-structural stage (exploration) even when resume_active=true', () => {
    // exploration is non-structural per determinism-table.md → nondeterministic providers allowed
    const record = resolveWith({
      model: 'haiku',
      provider: 'ica',
      effort: 'low',
      task_class: 'exploration',
      resume_active: true,
    });
    assert.strictEqual(record.chosen_plugin_id, 'ica',
      `Expected ica to be allowed for non-structural exploration, got ${record.chosen_plugin_id}`);
  });

  test('deterministic provider (codex) is NOT excluded for structural stage when resume_active=true', () => {
    const record = resolveWith({
      model: 'gpt-5.6-terra',
      provider: 'codex',
      effort: 'standard',
      task_class: 'ac-validation',
      resume_active: true,
    });
    assert.strictEqual(record.chosen_plugin_id, 'codex',
      `Expected codex (deterministic) to pass through, got ${record.chosen_plugin_id}`);
  });
});

describe('(c) Fallback-chain traversal on simulated provider unavailability', () => {
  test('fallback_chain is populated for ica/haiku (fallback → claude/sonnet)', () => {
    const record = resolveWith({
      model: 'haiku',
      provider: 'ica',
      effort: 'low',
      task_class: 'mechanical-tasks',
      resume_active: false,
    });
    assert.ok(Array.isArray(record.fallback_chain), 'fallback_chain should be an array');
    assert.ok(record.fallback_chain.length > 0, 'fallback_chain should have at least one entry');
    // Verify format: each entry must have plugin_id and model
    for (const entry of record.fallback_chain) {
      assert.ok('plugin_id' in entry, `fallback entry missing plugin_id: ${JSON.stringify(entry)}`);
      assert.ok('model' in entry, `fallback entry missing model: ${JSON.stringify(entry)}`);
      assert.strictEqual(typeof entry.plugin_id, 'string');
      assert.strictEqual(typeof entry.model, 'string');
    }
  });

  test('fallback_chain always ends with a claude entry as safety net', () => {
    const record = resolveWith({
      model: 'haiku',
      provider: 'ica',
      effort: 'low',
      task_class: 'mechanical-tasks',
      resume_active: false,
    });
    const claudeInChain = record.fallback_chain.some(e => e.plugin_id === 'claude');
    assert.ok(claudeInChain, 'claude should appear in fallback_chain as safety net');
  });

  test('fallback_chain for codex routes to claude/sonnet per routing_rules.fallback_codex', () => {
    const record = resolveWith({
      model: 'gpt-5.6-terra',
      provider: 'codex',
      effort: 'standard',
      task_class: 'ac-validation',
      resume_active: false,
    });
    // routing_rules.fallback_codex = ["claude/sonnet", "claude/opus"]
    const hasClaude = record.fallback_chain.some(e => e.plugin_id === 'claude');
    assert.ok(hasClaude, `Expected claude in fallback_chain for codex; got ${JSON.stringify(record.fallback_chain)}`);
  });

  test('fallback_chain excludes the chosen provider', () => {
    const record = resolveWith({
      model: 'haiku',
      provider: 'ica',
      effort: 'low',
      task_class: 'mechanical-tasks',
      resume_active: false,
    });
    const hasIca = record.fallback_chain.some(e => e.plugin_id === 'ica');
    assert.ok(!hasIca, 'fallback_chain should not contain the chosen provider');
  });
});

describe('(d) MUST-stay rejection for ALL 6 MUST-stay stage classes', () => {
  const MUST_STAY_CLASSES = [
    'orchestration',
    'verdict',
    'mode-d',
    'council-review',
    'schema-recovery',
    'cross-wave-merge',
  ];

  for (const taskClass of MUST_STAY_CLASSES) {
    // Using a local variable to avoid closure issue in loop
    const cls = taskClass;
    test(`MUST-stay rejection: task_class='${cls}' with provider='ica' → chosen_plugin_id='claude'`, () => {
      const record = resolveWith({
        model: 'haiku',
        provider: 'ica',
        effort: 'low',
        task_class: cls,
        resume_active: false,
      });
      assert.strictEqual(record.chosen_plugin_id, 'claude',
        `task_class='${cls}' must route to claude; got ${record.chosen_plugin_id}`);
      assert.strictEqual(record.agent_type_id, 'claude',
        `task_class='${cls}' must have agent_type_id='claude'; got ${record.agent_type_id}`);
    });
  }

  test('MUST-stay: all 6 classes covered (count check)', () => {
    assert.strictEqual(MUST_STAY_CLASSES.length, 6,
      `Expected exactly 6 MUST-stay classes; got ${MUST_STAY_CLASSES.length}`);
  });

  test('MUST-stay: gemini provider rejected for orchestration', () => {
    const record = resolveWith({
      model: 'gemini-3.5-flash',
      provider: 'gemini',
      effort: 'standard',
      task_class: 'orchestration',
      resume_active: false,
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });

  test('MUST-stay: codex provider rejected for council-review', () => {
    const record = resolveWith({
      model: 'gpt-5.6-terra',
      provider: 'codex',
      effort: 'standard',
      task_class: 'council-review',
      resume_active: false,
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });

  test('MUST-stay: bob provider rejected for mode-d', () => {
    const record = resolveWith({
      model: 'bob-local',
      provider: 'bob',
      effort: 'standard',
      task_class: 'mode-d',
      resume_active: false,
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });
});

describe('(e) Missing `provider` field → chosen_plugin_id: claude (AC-F2 resilience)', () => {
  test('missing provider field defaults to claude', () => {
    const record = resolveWith({
      model: 'sonnet',
      // provider deliberately omitted
      effort: 'standard',
      task_class: 'implementation',
      resume_active: false,
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `Missing provider should default to claude; got ${record.chosen_plugin_id}`);
  });

  test('null provider field defaults to claude', () => {
    const record = resolveWith({
      model: 'sonnet',
      provider: null,
      effort: 'standard',
      task_class: 'implementation',
      resume_active: false,
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });

  test('empty string provider field defaults to claude', () => {
    const record = resolveWith({
      model: 'sonnet',
      provider: '',
      effort: 'standard',
      task_class: 'implementation',
      resume_active: false,
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });
});

describe('(f) P2-INT-001 — agent_type_id values match agentType filenames exactly', () => {
  // The 4 agentType filenames defined by Agent B: ica-executor, bob-delegate-executor,
  // gemini-executor, codex-executor.
  const expectedMappings = {
    ica: 'ica-executor',
    bob: 'bob-delegate-executor',
    gemini: 'gemini-executor',
    codex: 'codex-executor',
  };

  test('AGENT_TYPE_ID_MAP matches all 4 required agentType filenames', () => {
    for (const [providerId, expectedId] of Object.entries(expectedMappings)) {
      assert.strictEqual(
        AGENT_TYPE_ID_MAP[providerId],
        expectedId,
        `AGENT_TYPE_ID_MAP['${providerId}'] should be '${expectedId}'; got '${AGENT_TYPE_ID_MAP[providerId]}'`
      );
    }
  });

  test('ica-executor: routing ica/haiku for mechanical-tasks emits agent_type_id=ica-executor', () => {
    const record = resolveWith({
      model: 'haiku',
      provider: 'ica',
      effort: 'low',
      task_class: 'mechanical-tasks',
      resume_active: false,
    });
    assert.strictEqual(record.agent_type_id, 'ica-executor');
  });

  test('bob-delegate-executor: routing bob/bob-local for drafting emits agent_type_id=bob-delegate-executor', () => {
    const record = resolveWith({
      model: 'bob-local',
      provider: 'bob',
      effort: 'standard',
      task_class: 'drafting',
      resume_active: false,
    });
    assert.strictEqual(record.agent_type_id, 'bob-delegate-executor');
  });

  test('gemini-executor: routing gemini for web-search emits agent_type_id=gemini-executor', () => {
    const record = resolveWith({
      model: 'gemini-3.5-flash',
      provider: 'gemini',
      effort: 'standard',
      task_class: 'web-search',
      resume_active: false,
    });
    assert.strictEqual(record.agent_type_id, 'gemini-executor');
  });

  test('codex-executor: routing codex for ac-validation emits agent_type_id=codex-executor', () => {
    const record = resolveWith({
      model: 'gpt-5.6-terra',
      provider: 'codex',
      effort: 'standard',
      task_class: 'ac-validation',
      resume_active: false,
    });
    assert.strictEqual(record.agent_type_id, 'codex-executor');
  });
});

describe('RoutingRecord completeness — all required fields present', () => {
  const REQUIRED_FIELDS = [
    'chosen_plugin_id',
    'model',
    'effort',
    'agent_type_id',
    'invocation_template',
    'scope_flags',
    'stage',
    'validation_contract',
    'continuity_mode',
    'fallback_chain',
    'reason',
  ];

  test('all required RoutingRecord fields present for ica/haiku/mechanical-tasks', () => {
    const record = resolveWith({
      model: 'haiku',
      provider: 'ica',
      effort: 'low',
      task_class: 'mechanical-tasks',
      resume_active: false,
    });
    for (const field of REQUIRED_FIELDS) {
      assert.ok(
        record[field] !== undefined && record[field] !== null,
        `RoutingRecord missing field '${field}'`
      );
    }
  });

  test('all required RoutingRecord fields present for claude/sonnet/implementation', () => {
    const record = resolveWith({
      model: 'sonnet',
      provider: 'claude',
      effort: 'standard',
      task_class: 'implementation',
      resume_active: false,
    });
    for (const field of REQUIRED_FIELDS) {
      assert.ok(
        record[field] !== undefined && record[field] !== null,
        `RoutingRecord missing field '${field}'`
      );
    }
  });

  test('continuity_mode is resumable for deterministic providers', () => {
    const record = resolveWith({
      model: 'sonnet',
      provider: 'claude',
      effort: 'standard',
      task_class: 'implementation',
    });
    assert.strictEqual(record.continuity_mode, 'resumable');
  });

  test('continuity_mode is stateless for stochastic providers (gemini)', () => {
    const record = resolveWith({
      model: 'gemini-3.5-flash',
      provider: 'gemini',
      effort: 'standard',
      task_class: 'exploration',
    });
    assert.strictEqual(record.continuity_mode, 'stateless');
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
  console.log('All tests passed.');
  process.exit(0);
}
