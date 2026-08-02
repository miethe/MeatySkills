/**
 * delegation-router/audit-log.js
 *
 * Append-only writer to .claude/logs/routing-decisions.jsonl.
 * INVARIANTS:
 *   - Never mutates or deletes existing entries.
 *   - Creates the log file (and parent directory) if absent.
 *   - Each entry is a single-line JSON object followed by newline.
 *   - The writer is synchronous; no async I/O.
 *
 * Design spec reference: delegation-router-multimodel.md §3 (RoutingRecord audit log)
 * PRD reference: FR-6, AC-A1
 * Phase: P2-004
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Default log path — relative to repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_LOG_PATH = path.join(REPO_ROOT, '.claude', 'logs', 'routing-decisions.jsonl');

/**
 * @typedef {Object} AuditEntry
 * @property {string}  task_id            - Task identifier (e.g. 'TASK-3.2', 'P2-006')
 * @property {string}  timestamp          - ISO 8601 UTC timestamp
 * @property {string}  chosen_plugin_id   - Provider selected by the resolver
 * @property {string}  actual_provider_used - The provider that actually executed (post-fallback)
 * @property {boolean} fallback_applied   - Whether a fallback was triggered
 * @property {string}  reason             - Routing decision rationale from RoutingRecord
 * @property {Object}  [routing_record]   - Full RoutingRecord (optional; included when available)
 */

/**
 * Append a routing decision entry to the audit log.
 *
 * @param {Object} params
 * @param {string}  params.task_id              - Task identifier
 * @param {string}  params.chosen_plugin_id     - Provider id selected by resolver
 * @param {string}  params.actual_provider_used - Actual provider used (may differ on fallback)
 * @param {boolean} params.fallback_applied     - Whether fallback was triggered
 * @param {string}  params.reason               - Routing rationale
 * @param {Object}  [params.routing_record]     - Optional full RoutingRecord
 * @param {string}  [params.log_path]           - Override log file path (used in tests)
 * @returns {AuditEntry} The entry that was written
 */
function appendEntry(params) {
  const {
    task_id,
    chosen_plugin_id,
    actual_provider_used,
    fallback_applied = false,
    reason = '',
    routing_record,
    log_path,
  } = params;

  if (!task_id) throw new Error('audit-log.appendEntry: task_id is required');
  if (!chosen_plugin_id) throw new Error('audit-log.appendEntry: chosen_plugin_id is required');
  if (!actual_provider_used) throw new Error('audit-log.appendEntry: actual_provider_used is required');

  const entry = {
    task_id,
    timestamp: new Date().toISOString(),
    chosen_plugin_id,
    actual_provider_used,
    fallback_applied: Boolean(fallback_applied),
    reason,
  };

  if (routing_record) {
    entry.routing_record = routing_record;
  }

  const logPath = log_path || DEFAULT_LOG_PATH;

  // Ensure parent directory exists
  const logDir = path.dirname(logPath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Append-only: append a single newline-terminated JSON line
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line, { encoding: 'utf8' });

  return entry;
}

/**
 * Read all entries from the audit log.
 * Returns an empty array if the log does not exist.
 *
 * @param {string} [log_path] - Override log file path (used in tests)
 * @returns {AuditEntry[]}
 */
function readEntries(log_path) {
  const logPath = log_path || DEFAULT_LOG_PATH;

  if (!fs.existsSync(logPath)) {
    return [];
  }

  const content = fs.readFileSync(logPath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);

  return lines.map((line, idx) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`audit-log.readEntries: malformed JSON at line ${idx + 1}: ${e.message}`);
    }
  });
}

/**
 * Filter entries by predicate.
 * Convenience wrapper for CLI subcommand queries.
 *
 * @param {function(AuditEntry): boolean} predicate
 * @param {string} [log_path]
 * @returns {AuditEntry[]}
 */
function filterEntries(predicate, log_path) {
  return readEntries(log_path).filter(predicate);
}

/**
 * Find entries where the actual_provider_used differs from chosen_plugin_id
 * (i.e., a fallback was triggered).
 *
 * @param {string} [log_path]
 * @returns {AuditEntry[]}
 */
function findFallbackEntries(log_path) {
  return filterEntries(e => e.fallback_applied === true, log_path);
}

/**
 * Find entries by provider.
 *
 * @param {string} provider_id
 * @param {string} [log_path]
 * @returns {AuditEntry[]}
 */
function findByProvider(provider_id, log_path) {
  return filterEntries(e => e.chosen_plugin_id === provider_id, log_path);
}

module.exports = {
  appendEntry,
  readEntries,
  filterEntries,
  findFallbackEntries,
  findByProvider,
  DEFAULT_LOG_PATH,
};
