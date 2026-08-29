/**
 * Versioned task-class vocabulary and external-feedback join tests.
 *
 * Run: node meaty-agentic-ops/skills/delegation-router/tests/test-task-class-vocabulary.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

const {
  loadTaskClassVocabulary,
  loadRoutingFeedbackContract,
  vocabularyIndexes,
  canonicalizeLegacyTaskClass,
  validateFeedbackJoin,
} = require('../task-class-vocabulary.js');
const {
  loadRegistry,
  MUST_STAY_PRIMARY_CLASSES,
} = require('../resolver.js');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passCount++;
  } catch (error) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
    failCount++;
  }
}

const vocabulary = loadTaskClassVocabulary();
const contract = loadRoutingFeedbackContract();
const producer = contract.accepted_producers.ccdash;

function payload(overrides = {}) {
  return {
    producer: 'ccdash',
    contract_id: contract.contract_id,
    contract_version: contract.contract_version,
    taxonomy_id: vocabulary.taxonomy_id,
    taxonomy_version: vocabulary.taxonomy_version,
    taxonomy_digest: vocabulary.taxonomy_digest,
    mapping_id: producer.mapping_id,
    mapping_version: producer.mapping_version,
    mapping_digest: producer.mapping_digest,
    source_skill_name: 'dev-execution',
    task_class: 'implementation',
    ...overrides,
  };
}

test('vocabulary has unique canonical ids and aliases', () => {
  const { canonical, aliases } = vocabularyIndexes(vocabulary);
  assert.equal(canonical.size, vocabulary.classes.length);
  assert.ok(aliases.size > 0);
});

test('contract pins the exact vocabulary digest', () => {
  assert.equal(contract.taxonomy.taxonomy_digest, vocabulary.taxonomy_digest);
});

test('every live routing_policy key is in the canonical vocabulary', () => {
  const registry = loadRegistry(path.join(__dirname, '..', 'model-registry.generated.json'));
  const { canonical } = vocabularyIndexes(vocabulary);
  for (const taskClass of Object.keys(registry.routing_policy || {})) {
    assert.ok(canonical.has(taskClass), `missing routing_policy class '${taskClass}'`);
  }
});

test('every code-level MUST-stay spelling maps to a protected canonical class', () => {
  const { canonical } = vocabularyIndexes(vocabulary);
  for (const taskClass of MUST_STAY_PRIMARY_CLASSES) {
    const canonicalTaskClass = canonicalizeLegacyTaskClass(taskClass, vocabulary);
    assert.ok(canonicalTaskClass, `missing MUST-stay class or alias '${taskClass}'`);
    assert.equal(canonical.get(canonicalTaskClass).status, 'must_stay_primary');
  }
});

test('legacy workflow alias canonicalizes without becoming an external spelling', () => {
  assert.equal(canonicalizeLegacyTaskClass('mode-d', vocabulary), 'mode_d');
  assert.equal(canonicalizeLegacyTaskClass('mechanical-tasks', vocabulary), 'mechanical');
  assert.equal(canonicalizeLegacyTaskClass('not-a-class', vocabulary), null);
});

test('pinned canonical routable class validates but cannot actuate while disabled', () => {
  assert.deepEqual(validateFeedbackJoin(payload()), {
    accepted: false,
    join_valid: true,
    canonical_task_class: 'implementation',
    reason: 'live_consumption_disabled',
  });
});

for (const [name, override, expectedReason] of [
  ['missing source skill', { source_skill_name: undefined }, 'invalid_source_skill_name'],
  ['unknown source skill', { source_skill_name: 'not-a-skill' }, 'unmapped_source_skill_name'],
  ['mismatched source and class', { source_skill_name: 'planning' }, 'source_task_class_mismatch'],
  ['unknown class', { task_class: 'dev-execution' }, 'source_task_class_mismatch'],
  ['legacy alias', { task_class: 'code-review' }, 'source_task_class_mismatch'],
  ['telemetry-only bucket mismatch', { task_class: '_unclassified' }, 'source_task_class_mismatch'],
  ['mapped telemetry-only bucket', { source_skill_name: 'codex', task_class: '_unclassified' }, 'telemetry_only_class'],
  ['taxonomy version mismatch', { taxonomy_version: '2.0.0' }, 'taxonomy_mismatch'],
  ['taxonomy digest mismatch', { taxonomy_digest: 'sha256:deadbeef' }, 'taxonomy_mismatch'],
  ['mapping mismatch', { mapping_version: '2.0.0' }, 'mapping_mismatch'],
  ['unknown producer', { producer: 'other' }, 'unknown_producer'],
]) {
  test(`${name} has no empirical join`, () => {
    const result = validateFeedbackJoin(payload(override));
    assert.equal(result.accepted, false);
    assert.equal(result.reason, expectedReason);
  });
}

for (const [sourceSkillName, taskClass] of [
  ['planning', 'orchestration'],
  ['release', 'mode_d'],
  ['enterprise-demo-deploy', 'mode_d'],
]) {
  test(`mapped MUST-stay class '${taskClass}' is immune to empirical adjustment`, () => {
    const result = validateFeedbackJoin(payload({
      source_skill_name: sourceSkillName,
      task_class: taskClass,
    }));
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'must_stay_primary_no_adjustment');
  });
}

test('all pinned source rules have a valid canonical or telemetry-only target', () => {
  const { canonical } = vocabularyIndexes(vocabulary);
  const telemetryOnly = new Set(vocabulary.telemetry_only);
  const rules = producer.source_task_class_rules;
  // Pinned rule count — a hardcoded number on purpose, so silently LOSING a rule fails the suite.
  // Was 17 at mapping v1.0.0; the v1.1.0 bump (51f8b05) landed 36 rules without updating this
  // assertion, leaving the suite red. Bump this together with `mapping_version` + `mapping_digest`.
  assert.equal(Object.keys(rules).length, 36, `mapping ${producer.mapping_version} rule count`);
  for (const [sourceSkillName, taskClass] of Object.entries(rules)) {
    assert.ok(sourceSkillName);
    assert.ok(canonical.has(taskClass) || telemetryOnly.has(taskClass), `${sourceSkillName} -> ${taskClass}`);
  }
});

test('every pinned source rule is enforced by the join validator', () => {
  const { canonical } = vocabularyIndexes(vocabulary);
  for (const [sourceSkillName, taskClass] of Object.entries(producer.source_task_class_rules)) {
    const result = validateFeedbackJoin(payload({
      source_skill_name: sourceSkillName,
      task_class: taskClass,
    }));
    if ((vocabulary.telemetry_only || []).includes(taskClass)) {
      assert.equal(result.reason, 'telemetry_only_class', sourceSkillName);
    } else if (canonical.get(taskClass).status === 'must_stay_primary') {
      assert.equal(result.reason, 'must_stay_primary_no_adjustment', sourceSkillName);
    } else {
      assert.equal(result.join_valid, true, sourceSkillName);
      assert.equal(result.accepted, false, sourceSkillName);
      assert.equal(result.reason, 'live_consumption_disabled', sourceSkillName);
    }
  }
});

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
