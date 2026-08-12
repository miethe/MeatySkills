/**
 * delegation-router/resolver.js
 *
 * Pure resolver function: given a (model, provider, effort, profile, task_class [, resume_active])
 * tuple, reads the model registry, ranks candidates, applies filters, and emits a RoutingRecord.
 *
 * REGISTRY LOOKUP ORDER (first match wins):
 *   1. Explicit env override   — MODEL_REGISTRY_PATH (absolute path to .yaml or .json)
 *   2. Project-local override  — <cwd>/.claude/config/model-registry.{yaml,generated.json}
 *      Presence is intentional per-project customization, NOT the canonical copy.
 *      This tier is skipped when absent (zero behavior change for projects without it).
 *   3. Global canonical        — ~/.claude/config/model-registry.{yaml,generated.json}
 *      This is the single source of truth. Registry DATA lives here only.
 *
 *   At each tier, the js-yaml → generated-JSON fallback applies:
 *     prefer js-yaml on the YAML; fall back to JSON.parse on .generated.json when js-yaml absent.
 *
 *   Input._registryPath still overrides all tiers (tests only).
 *
 * LEGACY TOML PATH
 *   When `input._configPath` is supplied (a provider-plugins.toml path), the resolver uses
 *   the original TOML-driven scoring. This preserves the existing 33 unit-test fixtures,
 *   which inject a synthetic TOML config. Registry behavior (free-first chains, enabled
 *   gating, allowance awareness) is exercised via the registry path (no _configPath, or an
 *   explicit `_registryPath`).
 *
 * INVARIANTS:
 *   - No child_process, exec, spawn, or shell I/O of any kind.
 *   - Only fs.readFileSync is used (file reads are allowed; shell is not).
 *   - The function is synchronous and side-effect-free (pure decision oracle).
 *   - MUST-stay-primary classes always route to chosen_plugin_id='claude', regardless of input.
 *   - Missing `provider` field in input defaults to 'claude' (AC-F2 resilience).
 *
 * Design spec reference:
 *   docs/project_plans/design-specs/model-registry-router-globalization-v1.md §3, §4
 *   delegation-router-multimodel.md §3 (Shape C)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  MUST_STAY_PRIMARY_CLASSES,
  AGENT_TYPE_ID_MAP,
  validateRoutingRecord,
} = require('./routing-record.js');

const {
  isFeedbackConsumptionEnabled,
  loadFeedbackState,
  humanOverriddenTargets,
  applyChainFeedback,
  applyRankedFeedback,
  buildFeedbackProvenance,
} = require('./routing-feedback.js');

// ---------------------------------------------------------------------------
// TOML parser (minimal, zero-dependency) — legacy provider-plugins.toml path
// ---------------------------------------------------------------------------
// We parse only the subset of TOML used in provider-plugins.toml:
//   [providers.X] sections, [[providers.X.models]] arrays, scalar arrays,
//   and [providers.X.invocation_template] sub-tables.
// No external dependencies — the resolver must run offline.

/**
 * Minimal TOML parser sufficient for provider-plugins.toml.
 * Returns a plain JS object matching the TOML structure.
 *
 * @param {string} tomlText
 * @returns {Object}
 */
function parseToml(tomlText) {
  const result = {};
  const lines = tomlText.split('\n');
  let currentPath = [];  // tracks the current table path
  let currentArrayPath = null;  // tracks the current [[array-of-tables]] path

  function parseValue(raw) {
    raw = raw.trim();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    if (raw.startsWith('[') && raw.endsWith(']')) {
      const inner = raw.slice(1, -1);
      if (!inner.trim()) return [];
      return inner.split(',').map(s => {
        s = s.trim();
        if ((s.startsWith('"') && s.endsWith('"')) ||
            (s.startsWith("'") && s.endsWith("'"))) {
          return s.slice(1, -1);
        }
        return s;
      }).filter(s => s.length > 0);
    }
    return raw;
  }

  let inMultilineArray = false;
  let multilineArrayKey = null;
  let multilineArrayLines = [];

  for (let lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;

    if (inMultilineArray) {
      multilineArrayLines.push(line);
      if (line.includes(']')) {
        const combined = multilineArrayLines.join(' ');
        const match = combined.match(/\[([^\]]*)\]/);
        if (match) {
          const value = parseValue('[' + match[1] + ']');
          let ctx = result;
          const pathKeys = currentArrayPath ? currentArrayPath : currentPath;
          for (const k of pathKeys) {
            if (Array.isArray(ctx)) ctx = ctx[ctx.length - 1];
            if (ctx[k] === undefined) ctx[k] = {};
            ctx = ctx[k];
          }
          if (Array.isArray(ctx)) ctx = ctx[ctx.length - 1];
          ctx[multilineArrayKey] = value;
        }
        inMultilineArray = false;
        multilineArrayKey = null;
        multilineArrayLines = [];
      }
      continue;
    }

    const arrayTableMatch = line.match(/^\[\[([^\]]+)\]\]/);
    if (arrayTableMatch) {
      const keys = arrayTableMatch[1].split('.').map(k => k.trim());
      currentArrayPath = keys;
      currentPath = keys;
      let cur = result;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (Array.isArray(cur[k])) cur = cur[k][cur[k].length - 1];
        else {
          if (cur[k] === undefined) cur[k] = {};
          cur = cur[k];
        }
      }
      const lastKey = keys[keys.length - 1];
      if (!Array.isArray(cur[lastKey])) cur[lastKey] = [];
      cur[lastKey].push({});
      continue;
    }

    const tableMatch = line.match(/^\[([^\]]+)\]/);
    if (tableMatch) {
      const keys = tableMatch[1].split('.').map(k => k.trim());
      currentPath = keys;
      currentArrayPath = null;
      let cur = result;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (Array.isArray(cur[k])) cur = cur[k][cur[k].length - 1];
        else {
          if (cur[k] === undefined) cur[k] = {};
          cur = cur[k];
        }
      }
      const lastKey = keys[keys.length - 1];
      if (Array.isArray(cur[lastKey])) {
        // sub-table inside the last array element — handled via currentArrayPath
      } else {
        if (cur[lastKey] === undefined) cur[lastKey] = {};
      }
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const rawValue = line.slice(eqIdx + 1).trim();

    if (rawValue.startsWith('[') && !rawValue.endsWith(']')) {
      inMultilineArray = true;
      multilineArrayKey = key;
      multilineArrayLines = [rawValue];
      continue;
    }

    const value = parseValue(rawValue);

    let ctx = result;
    const pathToUse = currentArrayPath || currentPath;
    for (const k of pathToUse) {
      if (Array.isArray(ctx[k])) ctx = ctx[k][ctx[k].length - 1];
      else {
        if (ctx[k] === undefined) ctx[k] = {};
        ctx = ctx[k];
      }
    }
    ctx[key] = value;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Config / registry loading
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PLUGINS_TOML_PATH = path.join(REPO_ROOT, '.claude', 'config', 'provider-plugins.toml');
const GLOBAL_CONFIG_DIR = path.join(require('os').homedir(), '.claude', 'config');
const GLOBAL_REGISTRY_YAML_PATH = path.join(GLOBAL_CONFIG_DIR, 'model-registry.yaml');
const GLOBAL_REGISTRY_JSON_PATH = path.join(GLOBAL_CONFIG_DIR, 'model-registry.generated.json');
// Project-local override tier (intentional per-project customization, NOT canonical).
const LOCAL_REGISTRY_YAML_PATH = path.join(REPO_ROOT, '.claude', 'config', 'model-registry.yaml');
const LOCAL_REGISTRY_JSON_PATH = path.join(REPO_ROOT, '.claude', 'config', 'model-registry.generated.json');

// Project-local override file (per-repo). Discovered relative to the INVOKING project's cwd
// (NOT REPO_ROOT) — the engine is global, the override is per-project. Absent = no overrides.
const LOCAL_CONFIG_RELPATH = path.join('.claude', 'config', 'routing.local.toml');

/**
 * Loads and parses provider-plugins.toml (legacy path).
 * @param {string} [overridePath]
 * @returns {Object}
 */
function loadPluginsConfig(overridePath) {
  const tomlPath = overridePath || PLUGINS_TOML_PATH;
  const tomlText = fs.readFileSync(tomlPath, 'utf8');
  return parseToml(tomlText);
}

/**
 * Loads the model registry. PURE — no shell.
 *
 * Lookup order (first match wins):
 *   1. Explicit test override path (_registryPath from input — handled by callers).
 *   2. MODEL_REGISTRY_PATH env var (absolute path to .yaml or .json).
 *   3. Project-local override  — <cwd>/.claude/config/model-registry.{yaml,generated.json}
 *      (intentional per-project customization, NOT the canonical data).
 *   4. Global canonical        — ~/.claude/config/model-registry.{yaml,generated.json}
 *      (single source of truth).
 *
 * At each tier the js-yaml → generated-JSON fallback applies: prefer js-yaml on the YAML;
 * fall back to JSON.parse on .generated.json when js-yaml is not importable.
 *
 * @param {string} [overridePath]  Explicit path (tests, or _registryPath from input).
 * @returns {Object} Parsed registry
 */
function loadRegistry(overridePath) {
  // Explicit test/debug override — takes precedence over all tiers.
  if (overridePath) {
    if (overridePath.endsWith('.json')) {
      return JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    }
    const yaml = require('js-yaml');
    return yaml.load(fs.readFileSync(overridePath, 'utf8'));
  }

  // Tier 1 — env override (absolute path).
  const envPath = process.env.MODEL_REGISTRY_PATH;
  if (envPath) {
    if (envPath.endsWith('.json')) {
      return JSON.parse(fs.readFileSync(envPath, 'utf8'));
    }
    try {
      const yaml = require('js-yaml');
      return yaml.load(fs.readFileSync(envPath, 'utf8'));
    } catch (e) {
      // js-yaml absent — attempt JSON.parse if there is a companion generated JSON.
      const companion = envPath.replace(/\.(yaml|yml)$/, '.generated.json');
      if (fs.existsSync(companion)) return JSON.parse(fs.readFileSync(companion, 'utf8'));
      throw new Error(`[delegation-router] MODEL_REGISTRY_PATH='${envPath}': failed to load YAML and no companion .generated.json found.`);
    }
  }

  let yamlLib = null;
  try {
    yamlLib = require('js-yaml');
  } catch (e) {
    yamlLib = null;
  }

  // Tier 2 — project-local override (per-project customization; NOT canonical data).
  if (yamlLib && fs.existsSync(LOCAL_REGISTRY_YAML_PATH)) {
    return _loadYamlWithStalenessCheck(yamlLib, LOCAL_REGISTRY_YAML_PATH, LOCAL_REGISTRY_JSON_PATH);
  }
  if (!yamlLib && fs.existsSync(LOCAL_REGISTRY_JSON_PATH)) {
    return JSON.parse(fs.readFileSync(LOCAL_REGISTRY_JSON_PATH, 'utf8'));
  }

  // Tier 3 — global canonical (single source of truth: ~/.claude/config/).
  if (yamlLib && fs.existsSync(GLOBAL_REGISTRY_YAML_PATH)) {
    return _loadYamlWithStalenessCheck(yamlLib, GLOBAL_REGISTRY_YAML_PATH, GLOBAL_REGISTRY_JSON_PATH);
  }
  if (fs.existsSync(GLOBAL_REGISTRY_JSON_PATH)) {
    return JSON.parse(fs.readFileSync(GLOBAL_REGISTRY_JSON_PATH, 'utf8'));
  }

  throw new Error(
    '[delegation-router] No model registry found. Expected global canonical at ' +
    GLOBAL_REGISTRY_YAML_PATH + ' (or .generated.json). ' +
    'Run: python3 .claude/skills/delegation-router/scripts/build-model-registry.py ' +
    '--in ~/.claude/config/model-registry.yaml --out ~/.claude/config/model-registry.generated.json'
  );
}

/**
 * Helper: load a YAML registry file and emit a staleness warning when the companion
 * generated JSON's sha256 stamp disagrees.  Returns the parsed registry object.
 *
 * @param {Object} yamlLib     Loaded js-yaml instance.
 * @param {string} yamlPath    Path to the .yaml file.
 * @param {string} jsonPath    Path to the companion .generated.json (for staleness check).
 * @returns {Object}
 */
function _loadYamlWithStalenessCheck(yamlLib, yamlPath, jsonPath) {
  const yamlBytes = fs.readFileSync(yamlPath);
  if (fs.existsSync(jsonPath)) {
    try {
      const generated = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const stampedSha = generated && generated._yaml_sha256;
      if (stampedSha) {
        const liveSha = crypto.createHash('sha256').update(yamlBytes).digest('hex');
        if (liveSha !== stampedSha) {
          console.warn(
            `[delegation-router] ${jsonPath} is STALE: its _yaml_sha256 ` +
            `does not match ${yamlPath}. Regenerate with ` +
            'python3 .claude/skills/delegation-router/scripts/build-model-registry.py ' +
            `--in ${yamlPath} --out ${jsonPath} ` +
            '(using authoritative YAML for this run).'
          );
        }
      }
    } catch (e) {
      // Generated JSON unreadable/unparsable — ignore; YAML is authoritative.
    }
  }
  return yamlLib.load(yamlBytes);
}

// ---------------------------------------------------------------------------
// Project-local overrides (routing.local.toml)
// ---------------------------------------------------------------------------
//
// A project may override the GLOBAL model registry WITHOUT editing it, via a
// per-repo `.claude/config/routing.local.toml`. Discovery is relative to the
// invoking project's process.cwd() (the engine is global; the override is local).
// Absent file ⇒ no overrides ⇒ behavior is byte-for-byte identical to today.
//
// Supported override sections (selection-only — Mode-D path globs are consumed by
// the workflow guard, not here):
//   disabled_providers = ["gemini", "codex"]   exclude these providers' instances
//   disabled_models    = ["claude-opus-4-7"]   exclude these registry model KEYS
//   [priority_overrides]                        re-rank a specific instance
//     "ica/claude-haiku-4-5" = 0
//   [routing_policy_overrides]                  project-local chain per task_class,
//     exploration = { chain = ["claude/claude-haiku-4-5"] }   merged over the global policy
//
// HARD INVARIANT: MUST-stay-primary is ABSOLUTE. A routing_policy_override that
// tries to route a MUST-stay class (orchestration / verdict / mode_d /
// council_review / synthesis / the routing-record literals) off `claude` is IGNORED.

/**
 * Discover + parse the project-local override file. PURE — fs read only, no shell.
 * @param {Object} input  resolve() input (reads input._localConfigPath if set)
 * @returns {Object|null} parsed override object, or null when absent.
 */
function loadLocalOverrides(input) {
  let localPath;
  if (input && typeof input._localConfigPath === 'string') {
    localPath = input._localConfigPath;
  } else {
    localPath = path.join(process.cwd(), LOCAL_CONFIG_RELPATH);
  }
  if (!fs.existsSync(localPath)) return null;
  let parsed;
  try {
    parsed = parseToml(fs.readFileSync(localPath, 'utf8'));
  } catch (e) {
    // Malformed local config must never break routing — degrade to no overrides.
    console.warn(`[delegation-router] failed to parse ${localPath}; ignoring local overrides: ${e.message}`);
    return null;
  }
  return parsed;
}

/**
 * Apply project-local overrides ON TOP of a loaded registry. Returns a NEW registry
 * object (does not mutate the input) so the legacy/registry load path stays clean.
 *
 * Selection-only semantics:
 *   - disabled_providers: drop matching provider instances from every model.
 *   - disabled_models: drop matching model keys entirely.
 *   - priority_overrides: set instance.priority for "provider/model_id" keys.
 *   - routing_policy_overrides: shallow-merge per task_class over registry.routing_policy,
 *     but ONLY for non-MUST-stay classes (MUST-stay overrides are dropped + warned).
 *
 * @param {Object} registry          loaded registry
 * @param {Object|null} overrides     parsed routing.local.toml (or null)
 * @param {string[]} registryMustStay normalized must_stay_primary class list
 * @returns {Object} possibly-overridden registry (new object when overrides applied)
 */
function applyLocalOverrides(registry, overrides, registryMustStay) {
  if (!overrides) return registry;

  const disabledProviders = new Set(
    Array.isArray(overrides.disabled_providers) ? overrides.disabled_providers.map(String) : []
  );
  const disabledModels = new Set(
    Array.isArray(overrides.disabled_models) ? overrides.disabled_models.map(String) : []
  );
  // priority_overrides keys are quoted in TOML ("ica/claude-haiku-4-5" = 0); the minimal
  // parser keeps the surrounding quotes in the key. Strip them so lookups by the bare
  // "provider/model_id" signature match.
  const priorityOverrides = {};
  if (overrides.priority_overrides && typeof overrides.priority_overrides === 'object') {
    for (const [k, v] of Object.entries(overrides.priority_overrides)) {
      const bare = String(k).replace(/^["']|["']$/g, '');
      priorityOverrides[bare] = v;
    }
  }
  const policyOverrides = (overrides.routing_policy_overrides && typeof overrides.routing_policy_overrides === 'object')
    ? overrides.routing_policy_overrides
    : {};

  const hasModelOrInstanceOverride =
    disabledProviders.size > 0 || disabledModels.size > 0 || Object.keys(priorityOverrides).length > 0;
  const hasPolicyOverride = Object.keys(policyOverrides).length > 0;
  if (!hasModelOrInstanceOverride && !hasPolicyOverride) return registry;

  // Shallow clone + rebuild models map so we never mutate the loaded registry.
  const next = { ...registry };

  if (hasModelOrInstanceOverride) {
    const models = registry.models || {};
    const nextModels = {};
    for (const [key, entry] of Object.entries(models)) {
      if (disabledModels.has(key)) continue;  // drop whole model
      const providers = (entry.providers || [])
        .filter(inst => !disabledProviders.has(inst.provider))
        .map(inst => {
          const overrideKey = `${inst.provider}/${inst.model_id}`;
          if (Object.prototype.hasOwnProperty.call(priorityOverrides, overrideKey)) {
            const p = Number(priorityOverrides[overrideKey]);
            if (!Number.isNaN(p)) return { ...inst, priority: p };
          }
          return inst;
        });
      nextModels[key] = { ...entry, providers };
    }
    next.models = nextModels;
  }

  if (hasPolicyOverride) {
    const basePolicy = registry.routing_policy || {};
    const nextPolicy = { ...basePolicy };
    for (const [taskClass, override] of Object.entries(policyOverrides)) {
      // MUST-stay classes can NEVER be re-routed by a local override.
      if (isMustStay(taskClass, registryMustStay)) {
        console.warn(
          `[delegation-router] routing.local.toml routing_policy_overrides['${taskClass}'] ` +
          `targets a MUST-stay-primary class; IGNORED (MUST-stay cannot be overridden).`
        );
        continue;
      }
      nextPolicy[taskClass] = { ...(basePolicy[taskClass] || {}), ...override };
    }
    next.routing_policy = nextPolicy;
  }

  return next;
}

// ---------------------------------------------------------------------------
// Allowance / cost helpers (registry path)
// ---------------------------------------------------------------------------

// Only `allowance: unlimited` is genuinely-free (cost-shifted, $0 to primary budget).
// shared_token_pool / billed / local are NOT free for free-first auto-selection.
function isGenuinelyFree(instance) {
  return instance && instance.allowance === 'unlimited';
}

const COST_TIER_RANK = { free: 0, standard: 1, premium: 2, billed: 2 };

// ---------------------------------------------------------------------------
// Determinism filter (shared by both paths)
// ---------------------------------------------------------------------------

/**
 * Determine if a task_class is structural (matters for resume safety).
 * Structural = output affects downstream session state (implementation, planning, validation).
 * Non-structural = exploratory/advisory (skeptic votes, completeness critics, web search).
 */
function isStructural(task_class) {
  const nonStructural = [
    'web-search',
    'web_research',
    'exploration',
    'adversarial-review',
    'skeptic-vote',
    'completeness-critic',
    'large-context',
    'second_opinion',
    'second-opinion',
  ];
  return !nonStructural.includes(task_class);
}

// Providers whose sampling is stochastic at the gateway level (nondeterministic).
// Used by the registry path's determinism filter (resume + structural).
const NONDETERMINISTIC_PROVIDERS = ['gemini', 'ica'];

// ---------------------------------------------------------------------------
// Registry resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a (possibly bare) model name to the set of matching registry model keys.
 * Bare names like 'haiku'/'sonnet'/'opus' match by `class`; versioned ids / provider
 * model_ids match by exact/prefix.
 *
 * @param {Object} registry
 * @param {string} model
 * @returns {string[]} list of registry model keys (may be empty)
 */
function matchRegistryModels(registry, model) {
  const models = registry.models || {};
  if (!model) return Object.keys(models);

  const lower = String(model).toLowerCase();
  const keys = Object.keys(models);

  // 1. Exact model-key match (e.g. 'claude-haiku-4-5').
  if (models[model]) return [model];

  // 2. class match (e.g. 'haiku' → every model whose class === 'haiku').
  //    `auto_select: false` marks a fallback-only lane: reachable by exact key or provider
  //    model_id (both explicit, handled above/below) but never picked by a bare class name.
  //    Before this flag the constraint lived only in prose descriptors the resolver cannot read.
  const byClass = keys.filter(k =>
    (models[k].class || '').toLowerCase() === lower && models[k].auto_select !== false);

  // 3. provider model_id exact/prefix match (e.g. 'gpt-5.6-terra', 'bob-local',
  //    'gemini-3.5-flash').
  const byModelId = keys.filter(k =>
    (models[k].providers || []).some(p => {
      const id = (p.model_id || '').toLowerCase();
      return id === lower || id.startsWith(lower);
    })
  );

  // 4. model-key prefix match (e.g. 'gemini-3' → 'gemini-3.5-flash').
  const byKeyPrefix = keys.filter(k => k.toLowerCase().startsWith(lower));

  // Merge preserving order of specificity, de-duped.
  const ordered = [];
  for (const list of [byClass, byModelId, byKeyPrefix]) {
    for (const k of list) if (!ordered.includes(k)) ordered.push(k);
  }
  return ordered;
}

/**
 * Build a candidate instance descriptor from a registry model + provider instance.
 */
function makeInstanceCandidate(modelKey, modelEntry, instance) {
  return {
    modelKey,
    modelEntry,
    instance,
    providerId: instance.provider,
    modelId: instance.model_id,
    cost_tier: instance.cost_tier,
    allowance: instance.allowance,
    priority: typeof instance.priority === 'number' ? instance.priority : 99,
    free: isGenuinelyFree(instance),
  };
}

/**
 * Enumerate enabled, live candidate instances for a list of registry model keys.
 * Skips scaffolded models, disabled models, and disabled provider instances.
 */
function enabledInstancesForModels(registry, modelKeys) {
  const models = registry.models || {};
  const out = [];
  for (const key of modelKeys) {
    const entry = models[key];
    if (!entry) continue;
    if (entry.status === 'scaffolded' || entry.status === 'deprecated') continue;
    if (entry.enabled === false) continue;  // model-level master toggle
    for (const inst of (entry.providers || [])) {
      if (inst.enabled === false) continue;  // per-instance toggle
      out.push(makeInstanceCandidate(key, entry, inst));
    }
  }
  return out;
}

/**
 * Resolve a routing_policy chain entry "provider/model_id" against the registry to a
 * concrete enabled instance candidate, or null if it is disabled / scaffolded / absent.
 */
function resolveChainEntry(registry, entry) {
  const slash = entry.indexOf('/');
  if (slash === -1) return null;
  const providerId = entry.slice(0, slash);
  const modelId = entry.slice(slash + 1);
  const models = registry.models || {};
  for (const [key, mEntry] of Object.entries(models)) {
    if (mEntry.status === 'scaffolded' || mEntry.status === 'deprecated') continue;
    if (mEntry.enabled === false) continue;
    for (const inst of (mEntry.providers || [])) {
      if (inst.provider !== providerId) continue;
      if (inst.model_id !== modelId) continue;
      if (inst.enabled === false) return null;  // explicitly disabled instance
      return makeInstanceCandidate(key, mEntry, inst);
    }
  }
  return null;
}

/**
 * Map a task_class (which may use hyphen or underscore variants) to a routing_policy key.
 */
function routingPolicyKeyFor(task_class) {
  if (!task_class) return null;
  const candidates = [
    task_class,
    task_class.replace(/-/g, '_'),
    task_class.replace(/_/g, '-'),
  ];
  return candidates;
}

// ---------------------------------------------------------------------------
// Core resolver (dispatch)
// ---------------------------------------------------------------------------

/**
 * Resolve a routing tuple to an immutable RoutingRecord.
 *
 * @param {Object} input
 * @param {string}  input.model
 * @param {string}  [input.provider]
 * @param {string}  [input.effort]
 * @param {string}  [input.profile]
 * @param {string}  input.task_class
 * @param {boolean} [input.resume_active]
 * @param {string}  [input._configPath]   - INTERNAL: legacy provider-plugins.toml path (tests)
 * @param {string}  [input._registryPath] - INTERNAL: override registry path (tests)
 * @returns {import('./routing-record.js').RoutingRecord}
 */
function resolve(input) {
  const record = (input && input._configPath)
    ? resolveFromToml(input)
    : resolveFromRegistry(input);
  return stampContextClass(record, input);
}

/**
 * Stamp the caller's declared `context_class` (C1–C4) onto the emitted record.
 *
 * Applied once here rather than at each of the four record-construction sites, so every
 * resolution path — registry, TOML, MUST-stay, determinism-filter — carries it uniformly.
 *
 * This is a PASSTHROUGH for audit only: it lets realized burn be joined against the class the
 * plan declared (Claude-5 plan doctrine §3). It is never read on the resolve path and never
 * influences ranking, so it is stamped AFTER selection by construction. Unlike `context_ref`
 * it carries no context, so it is not gated on MUST-stay/provider.
 *
 * @param {RoutingRecord} record
 * @param {Object} input - the original resolve() input; `input.context_class` is optional
 * @returns {RoutingRecord} the same record, with context_class set and re-validated
 */
function stampContextClass(record, input) {
  if (!record) return record;
  const declared = input && input.context_class;
  record.context_class = (declared === undefined || declared === '') ? null : declared;
  return validateRoutingRecord(record);
}

// ---------------------------------------------------------------------------
// Registry-based resolution (new, default path)
// ---------------------------------------------------------------------------

function resolveFromRegistry(input) {
  const {
    model,
    effort = 'standard',
    profile = null,
    task_class,
    resume_active = false,
    _registryPath,
  } = input;

  const requestedProvider = (input.provider && typeof input.provider === 'string')
    ? input.provider
    : 'claude';

  const loadedRegistry = loadRegistry(_registryPath);
  const registryMustStay = (loadedRegistry.must_stay_primary || []).map(normalizeClass);

  // ----- Project-local overrides (routing.local.toml) — selection-only, MUST-stay-safe -----
  const localOverrides = loadLocalOverrides(input);
  const registry = applyLocalOverrides(loadedRegistry, localOverrides, registryMustStay);
  const routingPolicy = registry.routing_policy || {};

  // ----- MUST-stay-primary override (registry ∪ routing-record literals) -----
  if (isMustStay(task_class, registryMustStay)) {
    // MUST-stay model lookup must be override-independent: pass the PRE-override
    // loadedRegistry so a project's disabled_providers/disabled_models cannot strip
    // the real claude instance and force a degraded hardcoded sonnet fallback.
    return buildRegistryMustStayRecord(
      loadedRegistry, model, effort,
      `MUST-stay-primary: task_class='${task_class}' is protected; non-claude providers are rejected`
    );
  }

  // ----- Determinism filter (resume + structural stage) -----
  const structural = isStructural(task_class);
  const excludeNondeterministic = resume_active && structural;

  if (excludeNondeterministic && NONDETERMINISTIC_PROVIDERS.includes(requestedProvider)) {
    // Override-independent MUST-stay lookup (see note above): use loadedRegistry so the
    // claude fallback resolves to the real requested-model instance, not a degraded one.
    return buildRegistryMustStayRecord(
      loadedRegistry, model, effort,
      `Determinism filter: provider='${requestedProvider}' is nondeterministic and resume_active=true for structural stage '${task_class}'; routing to claude`
    );
  }

  // ----- Empirical routing feedback (DI-1, §2.4 Option C) -----
  // Read-only, default-deny, and reached ONLY here — after the MUST-stay and determinism early
  // returns above, so a protected class cannot be touched even by a bug in this block. Two
  // independent gates must pass (pinned contract `live_consumption` + the AOS_ROUTING_FEEDBACK
  // kill switch); with neither flipped this is a zero-cost no-op and selection is byte-identical
  // to pre-DI-1 behavior.
  const feedbackGate = isFeedbackConsumptionEnabled({
    env: input._feedbackEnv || process.env,
    contract: input._feedbackContract,
  });
  const feedbackOverrides = feedbackGate.enabled
    ? loadFeedbackState({ statePath: input._feedbackStatePath, env: input._feedbackEnv, now: input._feedbackNow }).overrides
    : {};
  // Human-pinned classes/instances are immune: the operator's routing.local.toml outranks the
  // machine state file (§2.4.5.1 structural precedence).
  const humanTargets = humanOverriddenTargets(localOverrides);
  let feedbackProvenance = null;

  // ----- Candidate selection -----
  let chosen = null;
  let selectionReason = '';

  // 1. Explicit-provider override: if the caller named a provider AND the registry has an
  //    enabled instance of the requested model on that provider, honor it (subject to the
  //    determinism filter already applied above).
  const modelKeys = matchRegistryModels(registry, model);
  const modelInstances = enabledInstancesForModels(registry, modelKeys);

  // `priority` is a WITHIN-model rank (which lane to prefer for one model), so it must never
  // be compared across different models. matchRegistryModels() already returns keys in
  // preference order (exact key, then class match in registry-declaration order), so that
  // rank is the cross-model signal and `priority` only breaks ties inside one model.
  //
  // Without this, an ICA-only model outranks every current-gen one on a `--provider ica`
  // request: having no subscription row, its ICA lane is priority 1, while a current-gen
  // model's ICA lane is priority 2 (priority 1 being its subscription row). That silently
  // resolved `--model sonnet --provider ica` to claude-sonnet-4-5[1m], two generations stale.
  const modelKeyRank = new Map(modelKeys.map((k, i) => [k, i]));
  const byModelThenPriority = (a, b) =>
    ((modelKeyRank.get(a.modelKey) ?? 99) - (modelKeyRank.get(b.modelKey) ?? 99)) ||
    (a.priority - b.priority);

  if (input.provider && typeof input.provider === 'string') {
    const explicit = modelInstances
      .filter(c => c.providerId === requestedProvider)
      .filter(c => !(excludeNondeterministic && NONDETERMINISTIC_PROVIDERS.includes(c.providerId)))
      .sort(byModelThenPriority)[0];
    if (explicit) {
      chosen = explicit;
      selectionReason = `explicit provider='${requestedProvider}' honored for model='${model}'`;
    }
  }

  // 2. routing_policy chain (free-first): walk the chain for this task_class top-down.
  if (!chosen) {
    const keys = routingPolicyKeyFor(task_class) || [];
    let policy = null;
    let policyKey = null;
    for (const k of keys) {
      if (routingPolicy[k]) { policy = routingPolicy[k]; policyKey = k; break; }
    }
    if (policy && policy.enabled !== false && Array.isArray(policy.chain)) {
      // 2a. Empirical-feedback re-rank (DI-1 / §2.4.5.2). A pure (chain, feedback) → chain'
      //     reorder applied BEFORE the position-based walk, so the walk itself is untouched:
      //     demotion-only, at most one position, nothing ever removed. When feedback is disabled
      //     or absent this returns the identical array.
      const fb = applyChainFeedback({
        taskClass: policyKey,
        chain: policy.chain,
        feedbackOverrides,
        humanTargets,
        isMustStay: isMustStay(policyKey, registryMustStay),
        registry,
      });
      for (const entry of fb.chain) {
        const cand = resolveChainEntry(registry, entry);
        if (!cand) continue;  // disabled / scaffolded / absent — skip
        if (excludeNondeterministic && NONDETERMINISTIC_PROVIDERS.includes(cand.providerId)) continue;
        chosen = cand;
        selectionReason = fb.applied
          ? `routing_policy['${policyKey}'] chain free-first (empirical-feedback re-ranked): selected '${entry}'`
          : `routing_policy['${policyKey}'] chain free-first: selected '${entry}'`;
        if (fb.applied) {
          feedbackProvenance = buildFeedbackProvenance({
            taskClass: policyKey,
            actuation: 'chain_demotion',
            displacements: fb.displacements,
            selectedEntry: entry,
          });
        }
        break;
      }
    } else if (policy && policy.enabled === false) {
      selectionReason = `routing_policy['${policyKey}'] disabled`;
    }
  }

  // 3. Cost/priority ranking over the requested model's enabled instances
  //    (free-first, then priority). Used when no chain pins the order.
  if (!chosen && modelInstances.length > 0) {
    const ranked = modelInstances
      .filter(c => !(excludeNondeterministic && NONDETERMINISTIC_PROVIDERS.includes(c.providerId)))
      .sort((a, b) => {
        // Genuinely-free first.
        if (a.free !== b.free) return a.free ? -1 : 1;
        // Then cheaper cost_tier.
        const ct = (COST_TIER_RANK[a.cost_tier] ?? 3) - (COST_TIER_RANK[b.cost_tier] ?? 3);
        if (ct !== 0) return ct;
        // Then lower priority value.
        return a.priority - b.priority;
      });
    // 3a. Secondary feedback path (§2.4.5.2) for a task_class with NO routing_policy chain: the
    //     SAME one-position demotion, applied to the already-ranked list rather than by mutating
    //     `priority`. `priority` is a within-model rank that must never be compared across models
    //     (b0ab62d), so a cross-model demotion cannot be expressed through it without corrupting
    //     that invariant. Note we never emit priority_overrides — that lever is a proven no-op for
    //     every chain-routed class and lives in the human channel besides.
    const fbRanked = applyRankedFeedback(ranked, {
      taskClass: task_class,
      feedbackOverrides,
      humanTargets,
      isMustStay: isMustStay(task_class, registryMustStay),
      registry,
    });
    const finalRanked = fbRanked.applied ? fbRanked.ranked : ranked;
    if (finalRanked.length > 0) {
      chosen = finalRanked[0];
      selectionReason = fbRanked.applied
        ? `cost/priority ranking for model='${model}' (free-first, then priority; empirical-feedback re-ranked)`
        : `cost/priority ranking for model='${model}' (free-first, then priority)`;
      if (fbRanked.applied) {
        feedbackProvenance = buildFeedbackProvenance({
          taskClass: task_class,
          actuation: 'priority_nudge',
          displacements: fbRanked.displacements,
          selectedEntry: `${chosen.providerId}/${chosen.modelId}`,
        });
      }
    }
  }

  // 4. Last resort: claude fallback.
  if (!chosen) {
    return buildRegistryMustStayRecord(
      registry, model, effort,
      `No enabled candidates for (model='${model}', provider='${requestedProvider}', task_class='${task_class}'); falling back to claude`
    );
  }

  const fallbackChain = buildRegistryFallbackChain(registry, chosen, task_class, excludeNondeterministic);
  const agentTypeId = AGENT_TYPE_ID_MAP[chosen.providerId] || 'claude';
  const sampling = chosen.modelEntry.sampling;
  const continuityMode = sampling === 'stochastic' ? 'stateless' : 'resumable';
  const invocationTemplate = buildRegistryInvocation(chosen, profile, effort);

  const record = {
    chosen_plugin_id: chosen.providerId,
    model: deriveModelLabel(input.model, chosen),
    effort,
    agent_type_id: agentTypeId,
    invocation_template: invocationTemplate,
    scope_flags: buildScopeFlags(chosen.providerId, profile, effort),
    stage: 'A',
    validation_contract: inferValidationContract(chosen.providerId, task_class),
    continuity_mode: continuityMode,
    fallback_chain: fallbackChain,
    reason: buildRegistryReason(chosen, requestedProvider, task_class, selectionReason, excludeNondeterministic),
    // 14th field (additive, optional). Non-null ONLY when an empirical adjustment was actually
    // applied, so its presence in the audit log is itself the signal that feedback moved a
    // decision — `skillmeat routing audit` can filter on it without parsing the reason string.
    routing_feedback: feedbackProvenance,
  };

  return validateRoutingRecord(record);
}

/**
 * Preserve the caller's bare model label when they asked for one (keeps the
 * RoutingRecord.model stable for callers/tests that use 'haiku'/'sonnet'); otherwise
 * emit the registry model_id.
 */
function deriveModelLabel(requestedModel, chosen) {
  if (!requestedModel) return chosen.modelId;
  // If the caller asked by class (bare name), echo it back.
  const lower = String(requestedModel).toLowerCase();
  if ((chosen.modelEntry.class || '').toLowerCase() === lower) return requestedModel;
  // If the caller asked by the exact model_id or its prefix, echo theirs.
  const id = (chosen.modelId || '').toLowerCase();
  if (id === lower || id.startsWith(lower)) return requestedModel;
  return chosen.modelId;
}

function normalizeClass(c) {
  return String(c || '');
}

function isMustStay(task_class, registryMustStay) {
  if (!task_class) return false;
  const variants = [task_class, task_class.replace(/-/g, '_'), task_class.replace(/_/g, '-')];
  // routing-record.js literal list (7 protected classes incl schema-recovery, cross-wave-merge, synthesis).
  for (const v of variants) {
    if (MUST_STAY_PRIMARY_CLASSES.includes(v)) return true;
  }
  // registry must_stay_primary (normalize underscores/hyphens both ways).
  const reg = (registryMustStay || []).map(s => String(s));
  for (const v of variants) {
    if (reg.includes(v)) return true;
  }
  return false;
}

function buildRegistryFallbackChain(registry, chosen, task_class, excludeNondeterministic) {
  const chain = [];
  const seen = new Set();

  // Prefer the task_class routing_policy chain tail (entries after the chosen one).
  const routingPolicy = registry.routing_policy || {};
  const keys = routingPolicyKeyFor(task_class) || [];
  let policy = null;
  for (const k of keys) { if (routingPolicy[k]) { policy = routingPolicy[k]; break; } }

  if (policy && Array.isArray(policy.chain)) {
    for (const entry of policy.chain) {
      const cand = resolveChainEntry(registry, entry);
      if (!cand) continue;
      if (cand.providerId === chosen.providerId && cand.modelId === chosen.modelId) continue;
      if (excludeNondeterministic && NONDETERMINISTIC_PROVIDERS.includes(cand.providerId)) continue;
      const sig = `${cand.providerId}/${cand.modelId}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      chain.push({ plugin_id: cand.providerId, model: cand.modelId });
    }
  }

  // Also add other enabled instances of the SAME model (priority order) as fallbacks.
  const sameModel = enabledInstancesForModels(registry, [chosen.modelKey])
    .filter(c => !(c.providerId === chosen.providerId && c.modelId === chosen.modelId))
    .filter(c => !(excludeNondeterministic && NONDETERMINISTIC_PROVIDERS.includes(c.providerId)))
    .sort((a, b) => a.priority - b.priority);
  for (const c of sameModel) {
    const sig = `${c.providerId}/${c.modelId}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    chain.push({ plugin_id: c.providerId, model: c.modelId });
  }

  // Always ensure claude is the final safety net.
  const hasClaude = chain.some(e => e.plugin_id === 'claude');
  if (!hasClaude && chosen.providerId !== 'claude') {
    const claudeSonnet = findClaudeSonnet(registry);
    chain.push({ plugin_id: 'claude', model: claudeSonnet });
  }

  return chain;
}

function findClaudeSonnet(registry) {
  const models = registry.models || {};
  for (const [key, entry] of Object.entries(models)) {
    if ((entry.class || '') !== 'sonnet') continue;
    const claudeInst = (entry.providers || []).find(p => p.provider === 'claude');
    if (claudeInst) return claudeInst.model_id;
  }
  return 'claude-sonnet-5';
}

function buildRegistryMustStayRecord(registry, model, effort, reason) {
  // Find the requested model on claude, else claude sonnet.
  const models = registry.models || {};
  let modelId = null;
  let modelEntry = null;

  const modelKeys = matchRegistryModels(registry, model);
  for (const key of modelKeys) {
    const entry = models[key];
    if (!entry) continue;
    const claudeInst = (entry.providers || []).find(p => p.provider === 'claude' && p.enabled !== false);
    if (claudeInst) { modelId = claudeInst.model_id; modelEntry = entry; break; }
  }
  if (!modelId) {
    modelId = findClaudeSonnet(registry);
    for (const [, entry] of Object.entries(models)) {
      if ((entry.class || '') === 'sonnet') { modelEntry = entry; break; }
    }
  }

  const record = {
    chosen_plugin_id: 'claude',
    model: deriveModelLabel(model, { modelId, modelEntry: modelEntry || {}, providerId: 'claude' }),
    effort,
    agent_type_id: AGENT_TYPE_ID_MAP['claude'],
    invocation_template: `claude -p "{prompt}" --model ${modelId} --dangerously-skip-permissions`,
    scope_flags: [],
    stage: 'A',
    validation_contract: 'none',
    continuity_mode: 'resumable',
    fallback_chain: [],
    reason,
  };

  return validateRoutingRecord(record);
}

function buildRegistryInvocation(chosen, profile, effort) {
  const providerId = chosen.providerId;
  const modelId = chosen.modelId;
  switch (providerId) {
    case 'claude':
      return `claude -p "{prompt}" --model ${modelId} --dangerously-skip-permissions`;
    case 'ica': {
      // ICA gpt-5.6-*-dzus are a free-to-us agentic *Codex* lane: ICA can't serve them on
      // the /responses API Codex speaks (Azure api-version-gated), so ~/ica-codex.sh
      // auto-starts a local Responses→Chat shim and drives `codex` against it. Route them
      // to that wrapper, NOT ica-gpt.sh (which is the Claude-Code /messages lane).
      // See agentic_meta_dev/infra/ica-codex-shim/ (shipped 2026-07-29).
      if (/-dzus$/i.test(modelId)) {
        const sandboxMode = sandboxModeFor(profile, effort);
        return `~/ica-codex.sh exec --skip-git-repo-check --sandbox ${sandboxMode} -m ${modelId} "{prompt}"`;
      }
      // Other GPT models on ICA (e.g. gpt-5.5-gus) 400 on the raw gateway: Claude Code
      // attaches `output_config` on /messages and the Azure backend rejects it. Route gpt-*
      // through the ica-gpt.sh param-strip shim wrapper (it lazily + idempotently self-starts
      // the /messages proxy — no always-on daemon). Claude/Gemini ICA models stay on the raw
      // ica-claude.sh path. See agentic_meta_dev/infra/ica-gpt-shim/.
      if (/gpt/i.test(modelId)) {
        return `~/ica-gpt.sh -p "{prompt}" --model ${modelId} --dangerously-skip-permissions`;
      }
      return `~/ica-claude.sh -p "{prompt}" --model ${modelId} --dangerously-skip-permissions`;
    }
    case 'gemini':
      return `gemini "{prompt}" --model ${modelId} --yolo`;
    case 'bob':
      return `mise exec node@22 -- bob -p "{prompt}"`;
    case 'codex': {
      const sandboxMode = sandboxModeFor(profile, effort);
      return `codex exec --sandbox ${sandboxMode} "{prompt}"`;
    }
    default:
      return `${providerId} "{prompt}" --model ${modelId}`;
  }
}

function buildRegistryReason(chosen, requestedProvider, task_class, selectionReason, excludeNondeterministic) {
  let reason = `Selected provider='${chosen.providerId}', model_id='${chosen.modelId}' for task_class='${task_class}'`;
  reason += `; cost_tier='${chosen.cost_tier}', allowance='${chosen.allowance}'`;
  reason += `, free=${chosen.free}`;
  if (selectionReason) reason += `; ${selectionReason}`;
  if (requestedProvider !== chosen.providerId) {
    reason += `; requested provider '${requestedProvider}' not used`;
  }
  if (excludeNondeterministic) {
    reason += '; nondeterministic providers excluded (resume_active=true, structural stage)';
  }
  return reason;
}

// ---------------------------------------------------------------------------
// Legacy TOML resolution (preserves existing 33-test fixture behavior)
// ---------------------------------------------------------------------------

function candidateScore(modelEntry) {
  const tierScore = COST_TIER_RANK[modelEntry.cost_tier] ?? 3;
  const deterministicBonus = modelEntry.sampling === 'deterministic' ? 0 : 0.5;
  return tierScore + deterministicBonus;
}

function resolveFromToml(input) {
  const {
    model,
    effort = 'standard',
    profile = null,
    task_class,
    resume_active = false,
    _configPath,
  } = input;

  const requestedProvider = (input.provider && typeof input.provider === 'string')
    ? input.provider
    : 'claude';

  const config = loadPluginsConfig(_configPath);
  const providers = config.providers || {};
  const routingRules = config.routing_rules || {};
  const nondeterministicProviders = routingRules.nondeterministic_providers || [];

  if (MUST_STAY_PRIMARY_CLASSES.includes(task_class)) {
    return buildTomlMustStayRecord(model, effort, config, `MUST-stay-primary: task_class='${task_class}' is in the 7 protected classes; non-claude providers are rejected`);
  }

  const isStructuralStage = isStructural(task_class);
  const excludeNondeterministic = resume_active && isStructuralStage;

  if (excludeNondeterministic && nondeterministicProviders.includes(requestedProvider)) {
    return buildTomlMustStayRecord(
      model, effort, config,
      `Determinism filter: provider='${requestedProvider}' is nondeterministic and resume_active=true for structural stage '${task_class}'; routing to claude`
    );
  }

  const candidates = buildTomlCandidates(requestedProvider, model, providers, routingRules, excludeNondeterministic, nondeterministicProviders);

  if (candidates.length === 0) {
    return buildTomlMustStayRecord(
      model, effort, config,
      `No valid candidates found for (model='${model}', provider='${requestedProvider}', task_class='${task_class}'); falling back to claude`
    );
  }

  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];

  const fallbackChain = buildTomlFallbackChain(best.providerId, model, routingRules, providers, excludeNondeterministic, nondeterministicProviders);
  const agentTypeId = AGENT_TYPE_ID_MAP[best.providerId] || 'claude';
  const invocationTemplate = buildInvocationTemplate(best.providerId, best.modelEntry, profile, effort, providers);
  const continuityMode = best.modelEntry.sampling === 'stochastic' ? 'stateless' : 'resumable';

  const record = {
    chosen_plugin_id: best.providerId,
    model: best.modelEntry.name,
    effort,
    agent_type_id: agentTypeId,
    invocation_template: invocationTemplate,
    scope_flags: buildScopeFlags(best.providerId, profile, effort),
    stage: 'A',
    validation_contract: inferValidationContract(best.providerId, task_class),
    continuity_mode: continuityMode,
    fallback_chain: fallbackChain,
    reason: buildTomlReason(best, requestedProvider, model, task_class, resume_active, excludeNondeterministic),
  };

  return validateRoutingRecord(record);
}

function buildTomlCandidates(requestedProvider, model, providers, routingRules, excludeNondeterministic, nondeterministicProviders) {
  const candidates = [];

  const primaryProvider = providers[requestedProvider];
  if (primaryProvider && primaryProvider.models) {
    const modelEntry = findModel(primaryProvider.models, model);
    if (modelEntry) {
      if (!excludeNondeterministic || !nondeterministicProviders.includes(requestedProvider)) {
        candidates.push({
          providerId: requestedProvider,
          modelEntry,
          score: candidateScore(modelEntry) - 10,
        });
      }
    }
  }

  if (candidates.length === 0) {
    for (const [pid, providerData] of Object.entries(providers)) {
      if (!providerData.models) continue;
      if (excludeNondeterministic && nondeterministicProviders.includes(pid)) continue;
      const modelEntry = findModel(providerData.models, model);
      if (modelEntry) {
        candidates.push({ providerId: pid, modelEntry, score: candidateScore(modelEntry) });
      }
    }
  }

  if (candidates.length === 0) {
    const fallbackKey = `fallback_${model.replace(/-/g, '_')}`;
    const fallbackList = routingRules[fallbackKey] || [];
    for (const entry of fallbackList) {
      const [pid, mname] = entry.split('/');
      if (!pid || !mname) continue;
      if (excludeNondeterministic && nondeterministicProviders.includes(pid)) continue;
      const pData = providers[pid];
      if (!pData || !pData.models) continue;
      const mEntry = findModel(pData.models, mname);
      if (mEntry && !candidates.find(c => c.providerId === pid && c.modelEntry.name === mname)) {
        candidates.push({ providerId: pid, modelEntry: mEntry, score: candidateScore(mEntry) + 0.1 });
      }
    }
  }

  return candidates;
}

function findModel(models, name) {
  if (!Array.isArray(models)) return undefined;
  const exact = models.find(m => m.name === name);
  if (exact) return exact;
  return models.find(m => m.name && m.name.startsWith(name));
}

function buildTomlFallbackChain(chosenProviderId, model, routingRules, providers, excludeNondeterministic, nondeterministicProviders) {
  const fallbackKey = `fallback_${model.replace(/-/g, '_')}`;
  const fallbackList = routingRules[fallbackKey] || [];
  const chain = [];

  for (const entry of fallbackList) {
    const [pid, mname] = entry.split('/');
    if (!pid || !mname) continue;
    if (pid === chosenProviderId) continue;
    if (excludeNondeterministic && nondeterministicProviders.includes(pid)) continue;
    chain.push({ plugin_id: pid, model: mname });
  }

  const hasClaudeFallback = chain.some(e => e.plugin_id === 'claude');
  if (!hasClaudeFallback && chosenProviderId !== 'claude') {
    const claudeProvider = providers['claude'];
    if (claudeProvider && claudeProvider.models) {
      const claudeSonnet = findModel(claudeProvider.models, 'sonnet');
      if (claudeSonnet) chain.push({ plugin_id: 'claude', model: 'sonnet' });
    }
  }

  return chain;
}

function buildInvocationTemplate(providerId, modelEntry, profile, effort, providers) {
  const providerData = providers[providerId];
  if (!providerData || !providerData.invocation_template) return '';
  const tmpl = providerData.invocation_template;
  let base = tmpl.base || '';
  base = base.replace('{model}', modelEntry.name);
  if (providerId === 'codex') {
    base = base.replace('{sandbox_mode}', sandboxModeFor(profile, effort));
  }
  return base;
}

function buildTomlMustStayRecord(model, effort, config, reason) {
  const providers = config.providers || {};
  const claudeProvider = providers['claude'] || {};
  const claudeModels = claudeProvider.models || [];
  const modelEntry = findModel(claudeModels, model) || findModel(claudeModels, 'sonnet') || { name: 'sonnet' };
  const invocationTemplate = buildInvocationTemplate('claude', modelEntry, null, effort, providers);

  const record = {
    chosen_plugin_id: 'claude',
    model: modelEntry.name,
    effort,
    agent_type_id: AGENT_TYPE_ID_MAP['claude'],
    invocation_template: invocationTemplate,
    scope_flags: [],
    stage: 'A',
    validation_contract: 'none',
    continuity_mode: 'resumable',
    fallback_chain: [],
    reason,
  };

  return validateRoutingRecord(record);
}

function buildTomlReason(best, requestedProvider, model, task_class, resume_active, excludeNondeterministic) {
  let reason = `Selected provider='${best.providerId}', model='${best.modelEntry.name}' for task_class='${task_class}'`;
  reason += `; cost_tier='${best.modelEntry.cost_tier}', sampling='${best.modelEntry.sampling}'`;
  if (requestedProvider !== best.providerId) {
    reason += `; requested provider '${requestedProvider}' had no matching model for '${model}', fell back to '${best.providerId}'`;
  }
  if (excludeNondeterministic) {
    reason += '; nondeterministic providers excluded (resume_active=true, structural stage)';
  }
  return reason;
}

// ---------------------------------------------------------------------------
// Shared helpers (both paths)
// ---------------------------------------------------------------------------

function sandboxModeFor(profile, effort) {
  if (profile && profile.includes('sandbox=')) {
    return profile.split('sandbox=')[1].split(' ')[0];
  }
  if (effort === 'xhigh') return 'danger-full-access';
  if (effort === 'high' || effort === 'extended') return 'workspace-write';
  return 'read-only';
}

function buildScopeFlags(providerId, profile, effort) {
  const flags = [];
  if (providerId === 'codex') {
    flags.push(`--sandbox ${sandboxModeFor(profile, effort)}`);
  }
  return flags;
}

function inferValidationContract(providerId, task_class) {
  if (providerId === 'codex') return '{schema}';
  if (task_class === 'schema-recovery') return '{schema}';
  return 'none';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  resolve,
  parseToml,           // exported for tests
  loadPluginsConfig,   // exported for tests
  loadRegistry,        // exported for tests
  loadLocalOverrides,  // exported for tests
  applyLocalOverrides, // exported for tests
  MUST_STAY_PRIMARY_CLASSES,
  AGENT_TYPE_ID_MAP,
  findModel,
  matchRegistryModels,
};
