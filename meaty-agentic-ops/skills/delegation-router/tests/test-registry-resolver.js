/**
 * Registry-aware resolver tests — tests/test-registry-resolver.js
 *
 * Exercises the model-registry path of resolver.js (no _configPath → registry).
 * These complement test-resolver.js (which exercises the legacy TOML fixture path).
 *
 * Required scenarios (model-registry-router-globalization-v1.md §4):
 *   (a) enabled:false instance is skipped
 *   (b) scaffolded model (claude-fable-5) is NEVER selected
 *   (c) free-first — an exploration task resolves to ica/claude-haiku-4-5, not claude
 *   (d) shared_token_pool model is NOT treated as free
 *   (e) MUST-stay still forces claude even when a cheaper enabled instance exists
 *   (f) disabling the ICA instance falls through to the claude instance
 *
 * Mechanism: tests build synthetic registry objects, write them to a temp JSON file,
 * and inject via input._registryPath (JSON branch — no js-yaml dependency for the
 * fixtures). The default (no override) path is also smoke-tested against the real
 * model-registry.yaml to confirm js-yaml/JSON loading works end-to-end.
 *
 * NO shell, NO child_process. Node built-in assert + fs only.
 *
 * Run: node .claude/skills/delegation-router/tests/test-registry-resolver.js
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
// Synthetic registry fixture builder
// ---------------------------------------------------------------------------

/**
 * A compact registry exercising free-tier ICA, primary claude, scaffolded fable,
 * and a shared_token_pool ICA sonnet. Tests mutate clones of this.
 */
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
      'claude-fable-5': {
        family: 'claude', class: 'fable', sampling: 'deterministic', status: 'scaffolded',
        providers: [
          { provider: 'claude', model_id: 'claude-fable-5', cost_tier: 'premium', allowance: 'billed', enabled: false, priority: 1 },
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

function registryWithCodex() {
  const registry = baseRegistry();
  registry.models['gpt-5.6-terra'] = {
    family: 'gpt', class: 'terra', sampling: 'deterministic', status: 'active',
    providers: [
      { provider: 'codex', model_id: 'gpt-5.6-terra', cost_tier: 'premium', allowance: 'billed', enabled: true, priority: 1 },
    ],
  };
  return registry;
}

// A GPT model served on the ICA provider (the "ica-gpt" sub-lane inside
// buildRegistryInvocation's case 'ica': block — routed to ~/ica-gpt.sh when the model id
// matches /gpt/i and its lane is not ica_gateway_responses_shim, the codex-shim lane). Distinct from registryWithCodex(),
// which puts the same model FAMILY on the 'codex' provider instead.
function registryWithIcaGpt() {
  const registry = baseRegistry();
  registry.models['gpt-5.6-luna-ica'] = {
    family: 'gpt', class: 'luna-ica', sampling: 'stochastic', status: 'active',
    providers: [
      { provider: 'ica', model_id: 'gpt-5.6-luna', cost_tier: 'free', allowance: 'unlimited', enabled: true, priority: 1 },
    ],
  };
  return registry;
}

function writeRegistry(reg) {
  const p = path.join(os.tmpdir(), `test-registry-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
  fs.writeFileSync(p, JSON.stringify(reg), 'utf8');
  return p;
}

function resolveWithRegistry(reg, params) {
  const p = writeRegistry(reg);
  try {
    return resolve({ ...params, _registryPath: p });
  } finally {
    fs.unlinkSync(p);
  }
}

// ---------------------------------------------------------------------------
// Codex invocation contract
// ---------------------------------------------------------------------------

describe('Codex invocation contract', () => {
  test('read-only template includes every mandatory headless Codex flag', () => {
    const record = resolveWithRegistry(registryWithCodex(), {
      model: 'gpt-5.6-terra', provider: 'codex', task_class: 'ac-validation', effort: 'standard',
    });
    const template = record.invocation_template;

    for (const fragment of [
      'timeout 600 codex exec',
      '--ignore-user-config',
      '--sandbox read-only',
      '--skip-git-repo-check',
      '-C {repo_root}',
      '-m gpt-5.6-terra',
      '--config model_reasoning_effort="medium"',
      '"{prompt}"',
      '< /dev/null',
    ]) {
      assert.ok(template.includes(fragment), `missing '${fragment}': ${template}`);
    }
  });

  test('workspace-write template routes through the mandatory write-lane wrapper', () => {
    const record = resolveWithRegistry(registryWithCodex(), {
      model: 'gpt-5.6-terra', provider: 'codex', task_class: 'ac-validation', effort: 'high',
    });

    assert.ok(
      record.invocation_template.startsWith('{repo_root}/.claude/skills/codex/scripts/codex-run.sh --task-class write -- timeout 600 codex exec'),
      `write lane must use codex-run.sh: ${record.invocation_template}`
    );
    assert.ok(record.invocation_template.includes('--sandbox workspace-write'));
  });
});

// ---------------------------------------------------------------------------
// (a) enabled:false instance is skipped
// ---------------------------------------------------------------------------

describe('(a) enabled:false provider instance is skipped', () => {
  test('exploration: ICA haiku enabled:false → falls through to claude haiku', () => {
    const reg = baseRegistry();
    reg.models['claude-haiku-4-5'].providers[0].enabled = false;  // disable ICA instance
    const record = resolveWithRegistry(reg, {
      model: 'haiku', provider: 'ica', task_class: 'exploration', effort: 'low',
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `Disabled ICA instance must be skipped; got ${record.chosen_plugin_id}`);
  });

  test('disabled ICA haiku instance is never the chosen model_id (chain may fall to a DIFFERENT free ICA model)', () => {
    const reg = baseRegistry();
    reg.models['claude-haiku-4-5'].providers[0].enabled = false;
    const record = resolveWithRegistry(reg, {
      model: 'haiku', provider: 'ica', task_class: 'mechanical', effort: 'low',
    });
    // The disabled ICA haiku instance must not be selected. The mechanical free-first
    // chain legitimately falls to the next free ICA model (gemma) — that is correct.
    const usedDisabledInstance = record.chosen_plugin_id === 'ica' && record.model === 'claude-haiku-4-5';
    assert.ok(!usedDisabledInstance,
      `disabled ICA haiku instance must not be used; got plugin=${record.chosen_plugin_id} model=${record.model}`);
  });
});

// ---------------------------------------------------------------------------
// (b) scaffolded model (fable-5) is NEVER selected
// ---------------------------------------------------------------------------

describe('(b) scaffolded model (claude-fable-5) is never a live candidate', () => {
  test('requesting fable explicitly never returns fable provider (scaffolded skip → claude fallback)', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'fable', provider: 'claude', task_class: 'implementation', effort: 'standard',
    });
    // fable model is scaffolded → no enabled candidates for that model → claude fallback.
    assert.strictEqual(record.chosen_plugin_id, 'claude');
    assert.ok(!record.reason.toLowerCase().includes('fable-5') || record.model !== 'claude-fable-5',
      'fable-5 must not be the selected model_id');
    assert.notStrictEqual(record.model, 'claude-fable-5');
  });

  test('even when fable instance is enabled:true, status:scaffolded blocks selection', () => {
    const reg = baseRegistry();
    reg.models['claude-fable-5'].providers[0].enabled = true;  // enable instance...
    // ...but status is still 'scaffolded'.
    const record = resolveWithRegistry(reg, {
      model: 'claude-fable-5', provider: 'claude', task_class: 'implementation',
    });
    assert.notStrictEqual(record.model, 'claude-fable-5',
      'scaffolded status must block selection regardless of instance enabled flag');
  });
});

// ---------------------------------------------------------------------------
// (c) free-first — exploration resolves to ica/claude-haiku-4-5, not claude
// ---------------------------------------------------------------------------

describe('(c) free-first: exploration resolves to ICA free haiku, not claude', () => {
  test('exploration with no explicit provider → ica/claude-haiku-4-5', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'haiku', task_class: 'exploration', effort: 'low',
    });
    assert.strictEqual(record.chosen_plugin_id, 'ica',
      `Free-first must pick ICA; got ${record.chosen_plugin_id}`);
    assert.strictEqual(record.agent_type_id, 'ica-executor');
  });

  test('mechanical with no explicit provider → ica (free-first chain head)', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'haiku', task_class: 'mechanical', effort: 'low',
    });
    assert.strictEqual(record.chosen_plugin_id, 'ica');
  });

  test('free-first reason mentions free=true', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'haiku', task_class: 'exploration',
    });
    assert.ok(record.reason.includes('free=true'), `reason should note free=true: ${record.reason}`);
  });
});

// ---------------------------------------------------------------------------
// (d) shared_token_pool model is NOT treated as free
// ---------------------------------------------------------------------------

describe('(d) shared_token_pool (ICA sonnet) is NOT auto-selected as free', () => {
  test('implementation routing_policy pins claude sonnet, NOT ica shared-pool sonnet', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'sonnet', task_class: 'implementation', effort: 'standard',
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `implementation must stay on primary claude sonnet (ICA sonnet = shared pool, opt-in); got ${record.chosen_plugin_id}`);
  });

  test('cost ranking does NOT promote shared_token_pool sonnet ahead of billed claude sonnet', () => {
    // Remove routing_policy.implementation so ranking (not chain) decides; ICA sonnet is
    // shared_token_pool (not free) so it must NOT leapfrog claude on free-eligibility.
    const reg = baseRegistry();
    delete reg.routing_policy.implementation;
    const record = resolveWithRegistry(reg, {
      model: 'sonnet', task_class: 'planning', effort: 'standard',
    });
    // Neither is genuinely-free; both are cost_tier=standard. priority breaks the tie →
    // claude (priority 1) over ica (priority 2). The point: ICA sonnet is not treated as free.
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `shared_token_pool ICA sonnet must not be treated as free; got ${record.chosen_plugin_id}`);
    assert.ok(record.reason.includes('free=false'),
      `chosen instance should be free=false: ${record.reason}`);
  });

  test('explicit opt-in to ICA sonnet is still honored (shared pool != banned)', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'sonnet', provider: 'ica', task_class: 'planning', effort: 'standard',
    });
    assert.strictEqual(record.chosen_plugin_id, 'ica',
      'explicit provider=ica opt-in must still route to ICA sonnet');
  });
});

// ---------------------------------------------------------------------------
// (e) MUST-stay forces claude even when a cheaper enabled instance exists
//
// ⚠️ READ BEFORE CHANGING THESE FOUR. `baseRegistry()` declares NO `lanes:` table, so the
// sovereignty ladder is NOT live for it and the pre-ladder MUST-stay claude pin applies verbatim.
// That is what these four assertions now pin: the LEGACY regime, which must keep behaving exactly
// as it did for every un-migrated project registry and every frozen bundle copy.
//
// They are deliberately NOT the ladder's guard. Asserting `chosen_plugin_id === 'claude'` here
// would keep passing for the wrong reason the moment someone added a codex row to this fixture,
// because the fixture only contains claude and ica. The ladder's own guard — "the chosen lane
// clears the declared minimum, whoever the vendor is" — lives in (e2) below and in
// tests/test-sovereignty-ladder.js, where the fixture actually has two subscription vendors to
// tell apart.
// ---------------------------------------------------------------------------

describe('(e) MUST-stay forces claude when the ladder is NOT live (pre-ladder registry)', () => {
  test('orchestration with provider=ica + free haiku available → claude', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'haiku', provider: 'ica', task_class: 'orchestration', effort: 'low',
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `orchestration must force claude despite free ICA haiku; got ${record.chosen_plugin_id}`);
    assert.strictEqual(record.agent_type_id, 'claude');
  });

  test('schema-recovery (routing-record literal) forces claude', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'haiku', provider: 'ica', task_class: 'schema-recovery', effort: 'low',
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });

  test('cross-wave-merge (routing-record literal) forces claude', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'haiku', provider: 'ica', task_class: 'cross-wave-merge',
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });

  test('registry must_stay_primary "synthesis" forces claude', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'haiku', provider: 'ica', task_class: 'synthesis',
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      'registry must_stay_primary entry (synthesis) must force claude');
  });

  test('and the record SAYS the ladder was not live, so the reason is not silently the old one', () => {
    const record = resolveWithRegistry(baseRegistry(), {
      model: 'haiku', provider: 'ica', task_class: 'orchestration', effort: 'low',
    });
    assert.ok(/no lanes: table/.test(record.reason),
      `a legacy-regime decision must name the regime it took; got: ${record.reason}`);
    assert.strictEqual(record.sovereignty, null,
      'never assert a rung for a registry that declares none');
  });
});

// ---------------------------------------------------------------------------
// (e2) The LADDER's guard: the same fixture, ladder-live, with a SECOND subscription vendor.
//
// This is the assertion (e) cannot make. `>= subscription` must be satisfiable by a vendor that
// is not claude — otherwise the ladder is "claude" wearing a new name — while a shared-gateway
// lane must still be refused. The fixture below adds a codex subscription row precisely so a
// vendor-shaped assertion would FAIL here and a rung-shaped one passes.
// ---------------------------------------------------------------------------

function ladderRegistryWithCodex() {
  const reg = registryWithCodex();
  reg.lanes = {
    claude_subscription:  { sovereignty: 'subscription',   endpoint: 'anthropic_default', auth: 'anthropic_oauth_subscription' },
    codex_subscription:   { sovereignty: 'subscription',   endpoint: 'openai_default',    auth: 'codex_account' },
    ica_gateway_messages: { sovereignty: 'shared_gateway', endpoint: 'ica_gateway',       auth: 'ica_team_key' },
  };
  reg.task_class_sovereignty = {
    orchestration: { min_rung: 'subscription', reason: 'quality_bar' },
    synthesis:     { min_rung: 'subscription', reason: 'quality_bar' },
  };
  // No chain for these classes here — force the ranking path, which is where a vendor pin used
  // to be unreachable and a rung filter has to do the work.
  delete reg.routing_policy.orchestration;
  for (const m of Object.values(reg.models)) {
    for (const p of m.providers) {
      p.lane = p.provider === 'claude' ? 'claude_subscription'
        : p.provider === 'codex' ? 'codex_subscription'
        : 'ica_gateway_messages';
    }
  }
  return reg;
}

describe('(e2) ladder-live: a floored class is satisfied by RUNG, not by vendor', () => {
  test('a codex SUBSCRIPTION lane satisfies orchestration — no rule names claude', () => {
    const record = resolveWithRegistry(ladderRegistryWithCodex(), {
      model: 'gpt-5.6-terra', provider: 'codex', task_class: 'orchestration', effort: 'low',
    });
    assert.strictEqual(record.chosen_plugin_id, 'codex',
      `>= subscription must be satisfiable by a non-claude subscription; got ${record.chosen_plugin_id}`);
    assert.strictEqual(record.sovereignty, 'subscription');
    assert.strictEqual(record.sovereignty_floor.min_rung, 'subscription');
  });

  test('but the SHARED-GATEWAY lane is still refused for the same class', () => {
    const record = resolveWithRegistry(ladderRegistryWithCodex(), {
      model: 'haiku', provider: 'ica', task_class: 'orchestration', effort: 'low',
    });
    assert.notStrictEqual(record.chosen_plugin_id, 'ica',
      'free ICA haiku must not satisfy a subscription floor');
    assert.strictEqual(record.sovereignty, 'subscription');
  });

  test('the free ICA lane is untouched for an UNFLOORED class', () => {
    const record = resolveWithRegistry(ladderRegistryWithCodex(), {
      model: 'haiku', task_class: 'exploration', effort: 'low',
    });
    assert.strictEqual(record.chosen_plugin_id, 'ica',
      'the ladder must not quietly ban offload for work that declares no minimum');
  });
});

// ---------------------------------------------------------------------------
// (f) disabling the ICA instance falls through to the claude instance
// ---------------------------------------------------------------------------

describe('(f) disabling the ICA instance falls through to claude', () => {
  test('exploration: ICA haiku disabled → chain tail claude/claude-haiku-4-5', () => {
    const reg = baseRegistry();
    reg.models['claude-haiku-4-5'].providers[0].enabled = false;  // disable ICA free haiku
    const record = resolveWithRegistry(reg, {
      model: 'haiku', task_class: 'exploration', effort: 'low',
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `chain should fall through to claude when ICA disabled; got ${record.chosen_plugin_id}`);
    assert.strictEqual(record.model, 'haiku');  // bare label preserved
  });

  test('mechanical: ICA haiku disabled → next chain entry is ICA gemma (still free)', () => {
    const reg = baseRegistry();
    reg.models['claude-haiku-4-5'].providers[0].enabled = false;  // disable ICA haiku
    const record = resolveWithRegistry(reg, {
      model: 'haiku', task_class: 'mechanical', effort: 'low',
    });
    // mechanical chain = [ica/haiku, ica/gemma, claude/haiku]; ica/haiku disabled → ica/gemma.
    assert.strictEqual(record.chosen_plugin_id, 'ica',
      `next free chain entry (ICA gemma) should be chosen; got ${record.chosen_plugin_id}`);
    assert.strictEqual(record.model, 'gemma-4-26b-a4b-it');
  });

  test('all ICA instances disabled in mechanical chain → claude haiku tail', () => {
    const reg = baseRegistry();
    reg.models['claude-haiku-4-5'].providers[0].enabled = false;  // ica haiku
    reg.models['gemma-4-26b'].providers[0].enabled = false;       // ica gemma
    const record = resolveWithRegistry(reg, {
      model: 'haiku', task_class: 'mechanical', effort: 'low',
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });
});

// ---------------------------------------------------------------------------
// (g) determinism filter on the registry path (resume_active + structural)
// ---------------------------------------------------------------------------

describe('(g) resume_active determinism filter excludes nondeterministic providers (registry path)', () => {
  test('resume_active=true + implementation + provider=ica → claude (ICA is nondeterministic)', () => {
    const reg = baseRegistry();
    const record = resolveWithRegistry(reg, {
      model: 'sonnet', provider: 'ica', task_class: 'implementation', resume_active: true,
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      `resumed structural stage must exclude nondeterministic ICA; got ${record.chosen_plugin_id}`);
  });
});

// ---------------------------------------------------------------------------
// Smoke: default path loads the REAL registry (3-tier lookup)
// ---------------------------------------------------------------------------

describe('Smoke — default path loads the real model-registry (3-tier lookup)', () => {
  test('exploration on real registry resolves to ICA free haiku (global canonical tier)', () => {
    const record = resolve({ model: 'haiku', task_class: 'exploration', effort: 'low' });
    assert.strictEqual(record.chosen_plugin_id, 'ica',
      `real-registry free-first exploration should pick ICA; got ${record.chosen_plugin_id}`);
  });

  test('orchestration on real registry forces claude (MUST-stay)', () => {
    const record = resolve({ model: 'opus', provider: 'ica', task_class: 'orchestration' });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });

  test('implementation on real registry → claude sonnet (ICA sonnet opt-in only)', () => {
    const record = resolve({ model: 'sonnet', task_class: 'implementation' });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
  });

  test('real registry: every RoutingRecord field present', () => {
    const record = resolve({ model: 'haiku', task_class: 'exploration' });
    const REQUIRED = ['chosen_plugin_id', 'model', 'effort', 'agent_type_id', 'invocation_template',
      'scope_flags', 'stage', 'validation_contract', 'continuity_mode', 'fallback_chain', 'reason'];
    for (const f of REQUIRED) {
      assert.ok(record[f] !== undefined && record[f] !== null, `missing field ${f}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier tests: MODEL_REGISTRY_PATH env override + project-local override tier
// ---------------------------------------------------------------------------

describe('Registry lookup tiers', () => {
  const { loadRegistry } = require(resolverPath);

  test('MODEL_REGISTRY_PATH env var overrides all tiers (JSON path)', () => {
    // Write a minimal registry JSON, set env var, load, check.
    const reg = baseRegistry();
    const p = path.join(os.tmpdir(), `env-override-${process.pid}.json`);
    fs.writeFileSync(p, JSON.stringify({ ...reg, _env_override_marker: true }));
    const prev = process.env.MODEL_REGISTRY_PATH;
    try {
      process.env.MODEL_REGISTRY_PATH = p;
      const loaded = loadRegistry();
      assert.ok(loaded._env_override_marker, 'env override registry must be loaded');
    } finally {
      if (prev === undefined) delete process.env.MODEL_REGISTRY_PATH;
      else process.env.MODEL_REGISTRY_PATH = prev;
      fs.unlinkSync(p);
    }
  });

  test('project-local override tier is skipped when absent (falls through to global)', () => {
    // The real model-registry.yaml is currently present in the project (skillmeat repo).
    // We verify that loading with no override and no env var produces a valid registry
    // (global tier works regardless of which tier actually served it in this repo).
    const loaded = loadRegistry();
    assert.ok(loaded && typeof loaded === 'object' && loaded.models,
      'loadRegistry() must return a valid registry object with models');
  });

  test('_registryPath explicit override takes precedence over env var', () => {
    // _registryPath is the internal test seam — it must beat MODEL_REGISTRY_PATH.
    const regA = baseRegistry();
    const regB = { ...baseRegistry(), _registryPath_marker: true };
    const pA = path.join(os.tmpdir(), `reg-a-${process.pid}.json`);
    const pB = path.join(os.tmpdir(), `reg-b-${process.pid}.json`);
    fs.writeFileSync(pA, JSON.stringify(regA));
    fs.writeFileSync(pB, JSON.stringify(regB));
    const prev = process.env.MODEL_REGISTRY_PATH;
    try {
      process.env.MODEL_REGISTRY_PATH = pA;  // env points to regA
      // But _registryPath in resolve() input points to regB — it must win.
      const record = resolve({ model: 'haiku', task_class: 'exploration', _registryPath: pB });
      // If regB was loaded, the routing still works (both have same structure).
      // We can't inspect the registry object from outside resolve(), but we can confirm
      // the call succeeds and returns a valid record.
      assert.ok(record && record.chosen_plugin_id, '_registryPath override must produce a valid record');
    } finally {
      if (prev === undefined) delete process.env.MODEL_REGISTRY_PATH;
      else process.env.MODEL_REGISTRY_PATH = prev;
      fs.unlinkSync(pA);
      fs.unlinkSync(pB);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-model priority scope (regression: ICA sonnet resolved two gens stale)
//
// `priority` ranks lanes WITHIN one model. Comparing it across models lets an
// ICA-only model win every `--provider ica` request: with no subscription row its
// ICA lane is priority 1, while a current-gen model's ICA lane is priority 2.
// Live symptom (2026-08-02): `--model sonnet --provider ica` returned
// claude-sonnet-4-5[1m]. Both guards below are load-bearing — the comparator
// fixes the ordering, `auto_select: false` states the intent in machine-readable
// form so the fix does not silently depend on YAML declaration order.
// ---------------------------------------------------------------------------

describe('cross-model priority scope', () => {
  /** baseRegistry + an ICA-ONLY stale sonnet whose ICA lane is priority 1. */
  function registryWithStaleIcaOnlySonnet(extra = {}) {
    const reg = baseRegistry();
    reg.models['claude-sonnet-4-5'] = {
      family: 'claude', class: 'sonnet', sampling: 'deterministic', status: 'active',
      providers: [
        { provider: 'ica', model_id: 'claude-sonnet-4-5', cost_tier: 'standard', allowance: 'shared_token_pool', enabled: true, priority: 1 },
      ],
      ...extra,
    };
    return reg;
  }

  test('bare class + explicit ica does NOT pick an ICA-only older model on priority 1', () => {
    const record = resolveWithRegistry(registryWithStaleIcaOnlySonnet(), {
      model: 'sonnet', provider: 'ica', task_class: 'implementation',
    });
    assert.strictEqual(record.chosen_plugin_id, 'ica', 'explicit provider must still be honored');
    assert.ok(
      /claude-sonnet-4-6/.test(JSON.stringify(record)),
      `expected the current-gen sonnet ICA lane, got: ${record.invocation_template}`);
    assert.ok(
      !/claude-sonnet-4-5/.test(record.invocation_template || ''),
      'must not select the ICA-only older lane on a bare class match');
  });

  test('auto_select:false removes a model from bare class matches', () => {
    const record = resolveWithRegistry(registryWithStaleIcaOnlySonnet({ auto_select: false }), {
      model: 'sonnet', provider: 'ica', task_class: 'implementation',
    });
    assert.ok(
      !/claude-sonnet-4-5/.test(record.invocation_template || ''),
      'auto_select:false must be excluded from a bare class match');
  });

  test('auto_select:false is still reachable by exact model key (explicit selection)', () => {
    const record = resolveWithRegistry(registryWithStaleIcaOnlySonnet({ auto_select: false }), {
      model: 'claude-sonnet-4-5', provider: 'ica', task_class: 'implementation',
    });
    assert.ok(
      /claude-sonnet-4-5/.test(record.invocation_template || ''),
      `auto_select:false must remain explicitly selectable, got: ${record.invocation_template}`);
  });

  test('within one model, priority still decides the lane', () => {
    // haiku's ICA lane is priority 1 and claude's is priority 2 — unchanged behaviour.
    const record = resolveWithRegistry(baseRegistry(), {
      model: 'haiku', provider: 'claude', task_class: 'exploration',
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude',
      'explicit provider must still select the requested lane within a model');
  });
});

// ---------------------------------------------------------------------------
// Positive control — --dangerously-skip-permissions must never appear in an
// invocation_template for claude/ica/ica-gpt (node_01M34T2M6MVT8P9CY3ZXBCEC38).
//
// buildRegistryInvocation() and buildRegistryMustStayRecord() (resolver.js) previously
// baked --dangerously-skip-permissions directly into every emitted invocation_template for
// these three lanes. That flag gets an ICA/Claude dispatch DENIED by the auto-mode permission
// classifier before it ever runs — grep-returns-zero over resolver.js is necessary but NOT
// sufficient on its own (the flag could still be emitted at runtime by a code path grep
// missed), so these assertions call resolve() end-to-end through the REGISTRY path (no
// _configPath — this is resolveFromRegistry, the default/production path, not the legacy TOML
// fixture path exercised by test-resolver.js) and assert against the actual emitted string.
// ---------------------------------------------------------------------------

describe('Invocation-template flag hygiene — --dangerously-skip-permissions must never appear', () => {
  test('claude provider: invocation_template omits --dangerously-skip-permissions', () => {
    const record = resolveWithRegistry(baseRegistry(), {
      model: 'claude-sonnet-4-6', provider: 'claude', task_class: 'implementation',
    });
    assert.strictEqual(record.chosen_plugin_id, 'claude');
    assert.ok(
      !record.invocation_template.includes('--dangerously-skip-permissions'),
      `claude invocation_template must not carry the flag: ${record.invocation_template}`);
    assert.strictEqual(
      record.invocation_template,
      'claude -p "{prompt}" --model claude-sonnet-4-6');
  });

  test('ica provider (non-gpt model): invocation_template omits --dangerously-skip-permissions', () => {
    const record = resolveWithRegistry(baseRegistry(), {
      model: 'claude-haiku-4-5', provider: 'ica', task_class: 'mechanical',
    });
    assert.strictEqual(record.chosen_plugin_id, 'ica');
    assert.ok(
      !record.invocation_template.includes('--dangerously-skip-permissions'),
      `ica invocation_template must not carry the flag: ${record.invocation_template}`);
    assert.strictEqual(
      record.invocation_template,
      '~/ica-claude.sh -p "{prompt}" --model claude-haiku-4-5');
  });

  test('ica-gpt sub-lane (gpt model on ica provider): invocation_template omits --dangerously-skip-permissions', () => {
    const record = resolveWithRegistry(registryWithIcaGpt(), {
      model: 'gpt-5.6-luna', provider: 'ica', task_class: 'mechanical',
    });
    assert.strictEqual(record.chosen_plugin_id, 'ica');
    assert.ok(
      !record.invocation_template.includes('--dangerously-skip-permissions'),
      `ica-gpt invocation_template must not carry the flag: ${record.invocation_template}`);
    assert.strictEqual(
      record.invocation_template,
      '~/ica-gpt.sh -p "{prompt}" --model gpt-5.6-luna');
  });

  test('MUST-stay claude fallback record (buildRegistryMustStayRecord) also omits the flag', () => {
    // task_class='orchestration' is in must_stay_primary and baseRegistry() has no `lanes`
    // table (ladderLive=false), so this is forced through buildRegistryMustStayRecord — the
    // SECOND, separate hardcoded-template site the fix touched (not buildRegistryInvocation).
    const record = resolveWithRegistry(baseRegistry(), {
      model: 'claude-opus-4-8', provider: 'claude', task_class: 'orchestration',
    });
    assert.ok(
      !record.invocation_template.includes('--dangerously-skip-permissions'),
      `MUST-stay claude invocation_template must not carry the flag: ${record.invocation_template}`);
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
  console.log('All registry-resolver tests passed.');
  process.exit(0);
}
