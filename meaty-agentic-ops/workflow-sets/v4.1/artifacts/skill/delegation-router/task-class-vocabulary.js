'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VOCABULARY_PATH = path.join(__dirname, 'task-class-vocabulary.v1.json');
const FEEDBACK_CONTRACT_PATH = path.join(__dirname, 'routing-feedback-contract.v1.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
  const bytes = fs.readFileSync(filePath);
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function loadTaskClassVocabulary() {
  const vocabulary = readJson(VOCABULARY_PATH);
  return {
    ...vocabulary,
    taxonomy_digest: sha256File(VOCABULARY_PATH),
  };
}

function loadRoutingFeedbackContract() {
  return readJson(FEEDBACK_CONTRACT_PATH);
}

function vocabularyIndexes(vocabulary = loadTaskClassVocabulary()) {
  const canonical = new Map();
  const aliases = new Map();

  for (const entry of vocabulary.classes || []) {
    canonical.set(entry.id, entry);
    for (const alias of entry.legacy_aliases || []) {
      if (canonical.has(alias) || aliases.has(alias)) {
        throw new Error(`duplicate task_class alias '${alias}'`);
      }
      aliases.set(alias, entry.id);
    }
  }

  for (const telemetryOnly of vocabulary.telemetry_only || []) {
    if (canonical.has(telemetryOnly) || aliases.has(telemetryOnly)) {
      throw new Error(`telemetry-only task_class '${telemetryOnly}' collides with routable vocabulary`);
    }
  }

  return { canonical, aliases };
}

/**
 * Compatibility helper for existing workflow calls. External telemetry must use
 * validateFeedbackJoin(), which intentionally rejects aliases.
 */
function canonicalizeLegacyTaskClass(taskClass, vocabulary = loadTaskClassVocabulary()) {
  if (typeof taskClass !== 'string') return null;
  const { canonical, aliases } = vocabularyIndexes(vocabulary);
  if (canonical.has(taskClass)) return taskClass;
  return aliases.get(taskClass) || null;
}

function reject(reason, taskClass = null) {
  return {
    accepted: false,
    join_valid: false,
    canonical_task_class: taskClass,
    reason,
  };
}

/**
 * Validate an externally-produced telemetry key before any empirical routing
 * adjustment is considered. This is deliberately separate from resolve():
 * legacy workflow callers retain their current fallback behavior, while a
 * CCDash payload cannot turn an unknown or coincidental string match into a
 * live routing prior.
 */
function validateFeedbackJoin(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return reject('invalid_payload');
  }

  const vocabulary = loadTaskClassVocabulary();
  const contract = loadRoutingFeedbackContract();
  const producerContract = (contract.accepted_producers || {})[payload.producer];

  if (payload.contract_id !== contract.contract_id ||
      payload.contract_version !== contract.contract_version) {
    return reject('contract_mismatch');
  }
  if (payload.taxonomy_id !== vocabulary.taxonomy_id ||
      payload.taxonomy_version !== vocabulary.taxonomy_version ||
      payload.taxonomy_digest !== vocabulary.taxonomy_digest ||
      payload.taxonomy_digest !== contract.taxonomy.taxonomy_digest) {
    return reject('taxonomy_mismatch');
  }
  if (!producerContract) {
    return reject('unknown_producer');
  }
  if (payload.mapping_id !== producerContract.mapping_id ||
      payload.mapping_version !== producerContract.mapping_version ||
      payload.mapping_digest !== producerContract.mapping_digest) {
    return reject('mapping_mismatch');
  }
  if (typeof payload.source_skill_name !== 'string' || !payload.source_skill_name) {
    return reject('invalid_source_skill_name');
  }
  if (typeof payload.task_class !== 'string') {
    return reject('invalid_task_class');
  }

  const expectedTaskClass =
    (producerContract.source_task_class_rules || {})[payload.source_skill_name];
  if (!expectedTaskClass) {
    return reject('unmapped_source_skill_name');
  }
  if (payload.task_class !== expectedTaskClass) {
    return reject('source_task_class_mismatch');
  }

  if ((vocabulary.telemetry_only || []).includes(payload.task_class)) {
    return reject('telemetry_only_class', payload.task_class);
  }

  const { canonical } = vocabularyIndexes(vocabulary);
  const entry = canonical.get(payload.task_class);
  if (!entry) {
    return reject('unknown_or_alias_task_class');
  }
  if (entry.status === 'must_stay_primary') {
    return reject('must_stay_primary_no_adjustment', entry.id);
  }
  if (entry.status !== 'routable') {
    return reject('non_routable_task_class', entry.id);
  }

  if (contract.live_consumption !== 'enabled') {
    return {
      accepted: false,
      join_valid: true,
      canonical_task_class: entry.id,
      reason: 'live_consumption_disabled',
    };
  }

  return {
    accepted: true,
    join_valid: true,
    canonical_task_class: entry.id,
    reason: 'pinned_join',
  };
}

module.exports = {
  VOCABULARY_PATH,
  FEEDBACK_CONTRACT_PATH,
  sha256File,
  loadTaskClassVocabulary,
  loadRoutingFeedbackContract,
  vocabularyIndexes,
  canonicalizeLegacyTaskClass,
  validateFeedbackJoin,
};
