/**
 * RoutingRecord — canonical JSON schema for the delegation-router resolver output.
 *
 * Design spec reference: delegation-router-multimodel.md §3 (Shape C, Hybrid/Resolver-Record).
 * Every field documented here MUST be present in every RoutingRecord emitted by resolver.js.
 *
 * Integration seam P2-INT-001: agent_type_id values MUST match agentType definition filenames:
 *   ica          → ica-executor
 *   bob          → bob-delegate-executor
 *   gemini       → gemini-executor
 *   codex        → codex-executor
 *   claude       → 'claude' (native, no agentType wrapper file)
 */

'use strict';

/**
 * @typedef {Object} FallbackEntry
 * @property {string} plugin_id  - Provider id from provider-plugins.toml (e.g. 'ica', 'claude')
 * @property {string} model      - Model name within that provider (e.g. 'sonnet', 'haiku')
 */

/**
 * @typedef {Object} RoutingRecord
 * @property {string}          chosen_plugin_id   - The selected provider id ('claude'|'ica'|'bob'|'gemini'|'codex')
 * @property {string}          model              - The model to use (e.g. 'haiku', 'sonnet', 'opus', 'gpt-5.3-codex')
 * @property {string}          effort             - Effort level ('none'|'low'|'standard'|'high'|'extended'|'xhigh'|'adaptive')
 * @property {string}          agent_type_id      - agentType filename to instantiate (see P2-INT-001 seam)
 * @property {string}          invocation_template - Shell invocation template string (provider-specific; from provider-plugins.toml)
 * @property {string[]}        scope_flags        - Additional CLI scope flags to apply (e.g. ['--sandbox read-only'])
 * @property {string}          stage              - Two-stage structuring indicator: 'A' (primary) | 'B' (schema-validator) | 'none'
 * @property {string}          validation_contract - Structuring contract: 'none' | '{schema}' | custom JSON schema string
 * @property {string}          continuity_mode    - Provider continuity capability: 'stateless' | 'resumable'
 * @property {FallbackEntry[]} fallback_chain     - Ordered fallback candidates; walker stops at first available
 * @property {string}          reason             - Human-readable explanation of routing decision (ranking rationale)
 */

/**
 * MUST-STAY-PRIMARY task classes (design_spec §7).
 * Any task_class in this set is unconditionally routed to provider='claude'.
 * The resolver rejects any non-claude provider assignment for these classes.
 *
 * @readonly
 * @type {string[]}
 */
const MUST_STAY_PRIMARY_CLASSES = [
  'orchestration',
  'verdict',
  'mode-d',
  'council-review',
  'schema-recovery',
  'cross-wave-merge',
  'synthesis',
];

/**
 * Canonical agent_type_id mapping (P2-INT-001 seam).
 * Maps provider_id → agentType definition filename (without .md extension).
 * 'claude' is native (no agentType wrapper); value is 'claude' as a sentinel.
 *
 * @readonly
 * @type {Record<string, string>}
 */
const AGENT_TYPE_ID_MAP = {
  claude: 'claude',
  ica: 'ica-executor',
  bob: 'bob-delegate-executor',
  gemini: 'gemini-executor',
  codex: 'codex-executor',
};

/**
 * Validates that a RoutingRecord has all required fields with correct types.
 * Throws a descriptive error if validation fails.
 *
 * @param {RoutingRecord} record
 * @returns {RoutingRecord} The same record (pass-through for chaining)
 * @throws {Error} If any required field is missing or mistyped
 */
function validateRoutingRecord(record) {
  const required = [
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

  for (const field of required) {
    if (record[field] === undefined || record[field] === null) {
      throw new Error(`RoutingRecord missing required field: '${field}'`);
    }
  }

  if (!Array.isArray(record.scope_flags)) {
    throw new Error(`RoutingRecord.scope_flags must be an array; got ${typeof record.scope_flags}`);
  }

  if (!Array.isArray(record.fallback_chain)) {
    throw new Error(`RoutingRecord.fallback_chain must be an array; got ${typeof record.fallback_chain}`);
  }

  for (const entry of record.fallback_chain) {
    if (typeof entry.plugin_id !== 'string' || typeof entry.model !== 'string') {
      throw new Error(
        `RoutingRecord.fallback_chain entry must have {plugin_id: string, model: string}; got ${JSON.stringify(entry)}`
      );
    }
  }

  if (!['A', 'B', 'none'].includes(record.stage)) {
    throw new Error(`RoutingRecord.stage must be 'A', 'B', or 'none'; got '${record.stage}'`);
  }

  if (!['stateless', 'resumable'].includes(record.continuity_mode)) {
    throw new Error(
      `RoutingRecord.continuity_mode must be 'stateless' or 'resumable'; got '${record.continuity_mode}'`
    );
  }

  return record;
}

/**
 * Creates an empty/default RoutingRecord structure.
 * Useful as a base for the resolver to fill in.
 *
 * @returns {RoutingRecord}
 */
function createEmptyRecord() {
  return {
    chosen_plugin_id: 'claude',
    model: 'sonnet',
    effort: 'standard',
    agent_type_id: AGENT_TYPE_ID_MAP['claude'],
    invocation_template: '',
    scope_flags: [],
    stage: 'A',
    validation_contract: 'none',
    continuity_mode: 'resumable',
    fallback_chain: [],
    reason: '',
  };
}

module.exports = {
  MUST_STAY_PRIMARY_CLASSES,
  AGENT_TYPE_ID_MAP,
  validateRoutingRecord,
  createEmptyRecord,
};
