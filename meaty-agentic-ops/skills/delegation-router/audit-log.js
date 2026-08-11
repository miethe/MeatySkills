/**
 * delegation-router/audit-log.js
 *
 * Append-only writer to .claude/logs/routing-decisions.jsonl.
 * INVARIANTS:
 *   - Never mutates or deletes existing entries.
 *   - Creates the log file (and parent directory) if absent.
 *   - Each entry is a single-line JSON object followed by newline.
 *   - The writer is synchronous; no async I/O.
 *   - INTENT AND REALIZATION ARE SEPARATE. A realized provider/model is never
 *     defaulted from the intent, and "confirmed" is carried by evidence, not by
 *     a caller's assertion.
 *
 * Design spec reference: delegation-router-multimodel.md §3 (RoutingRecord audit log)
 * PRD reference: FR-6, AC-A1
 * Phase: P2-004; schema v2 added by node_01KZS5A4S1YEZBPVBRFXWM3RY4.
 *
 * ---------------------------------------------------------------------------
 * WHY SCHEMA v2 EXISTS (read before "simplifying" any of this back)
 * ---------------------------------------------------------------------------
 * v1 had two defects that made the log unable to detect the substitution it
 * exists to detect. Both were measured on 2026-08-11 across the two live logs
 * in this estate (123 entries):
 *
 *   1. `actual_provider_used` was REQUIRED, and the documented Pattern B call
 *      satisfied it with `record.chosen_plugin_id` — a copy of the intent. So
 *      the field could never disagree with the decision it was meant to audit:
 *      112 of 123 entries (91%) had actual === chosen. A required field with no
 *      way to say "not yet known" does not get left blank; it gets faked.
 *   2. There was NO MODEL DIMENSION AT ALL (0 of 123 entries carried one).
 *      Provider and model fail independently, and in the in-process dispatch
 *      path the provider is decided by the session's own ANTHROPIC_BASE_URL —
 *      so routing to a provider is a no-op there and the MODEL is the only
 *      dimension the decision actually controls. It was the dimension the log
 *      could not see. A Haiku-for-Sonnet substitution was therefore invisible,
 *      and one shipped three real defects on a precision-sensitive gate while
 *      the audit log showed a clean entry naming a model that never ran.
 *
 * So in v2: realized fields default to null (unconfirmed), never to the intent;
 * `realization_confirmed` is true only when the caller states WHAT MEASURED IT
 * (`realization_evidence`); and both models are recorded so a substitution is
 * detectable rather than inferable.
 *
 * ---------------------------------------------------------------------------
 * ENTRY SHAPES
 * ---------------------------------------------------------------------------
 * `kind: 'decision'`    — written at resolve time by appendEntry(). Carries the
 *                         intent (chosen_plugin_id, intended_model). Realized
 *                         fields are null unless the caller has actually
 *                         measured them.
 * `kind: 'realization'` — written after execution by appendRealization(). Carries
 *                         the measured hop and requires evidence. Never mutates
 *                         the decision entry (append-only); readers join on
 *                         task_id.
 * A legacy v1 entry (no `schema_version`) normalizes to a decision whose
 * realization is UNCONFIRMED — including when it carries actual === chosen,
 * because that is the copied-intent shape, not a measurement.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Current entry schema version. Absent on v1 entries. */
const SCHEMA_VERSION = 2;

// Default log path — relative to repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_LOG_PATH = path.join(REPO_ROOT, '.claude', 'logs', 'routing-decisions.jsonl');

/**
 * @typedef {Object} AuditEntry
 * @property {string}  task_id                  - Task identifier (e.g. 'TASK-3.2', 'node_01…')
 * @property {string}  timestamp                - ISO 8601 UTC timestamp
 * @property {number}  schema_version           - 2 for entries written by this module
 * @property {'decision'|'realization'} kind     - Intent record or measured-outcome record
 * @property {string}  chosen_plugin_id         - Provider selected by the resolver (the INTENT)
 * @property {?string} intended_model           - Model selected by the resolver (the INTENT)
 * @property {?string} actual_provider_used     - Provider that actually ran; null = unconfirmed
 * @property {?string} realized_model           - Model that actually ran; null = unconfirmed
 * @property {boolean} realization_confirmed    - True only when evidence was supplied
 * @property {?string} realization_evidence     - What measured the realized hop
 * @property {boolean} [realization_confirmed_claimed] - Present when a caller claimed
 *           confirmation without evidence; the claim is recorded, never honoured
 * @property {boolean} fallback_applied         - Whether a provider fallback was triggered
 * @property {?boolean} model_substituted       - intended !== realized; null when unknowable
 * @property {string}  reason                   - Routing decision rationale from RoutingRecord
 * @property {Object}  [routing_record]         - Full RoutingRecord (optional; when available)
 */

/**
 * Non-empty-string test. Guards against '' and whitespace-only evidence being
 * treated as a measurement.
 *
 * @param {*} v
 * @returns {boolean}
 */
function isPresent(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Build the realization half of an entry from caller params, applying the two
 * rules that make the log honest:
 *   - a realized value is used only when the caller supplied it (never the intent);
 *   - `realization_confirmed` is true only when evidence accompanies a realized value.
 *
 * @param {Object} params
 * @param {?string} intended_model
 * @returns {Object} realization fields
 */
function buildRealization(params, intended_model) {
  const actual_provider_used = isPresent(params.actual_provider_used)
    ? params.actual_provider_used
    : null;
  const realized_model = isPresent(params.realized_model) ? params.realized_model : null;
  const realization_evidence = isPresent(params.realization_evidence)
    ? params.realization_evidence
    : null;

  const hasRealizedValue = actual_provider_used !== null || realized_model !== null;
  const realization_confirmed = Boolean(realization_evidence) && hasRealizedValue;

  const out = {
    actual_provider_used,
    realized_model,
    realization_confirmed,
    realization_evidence,
  };

  // A caller asking for confirmation without evidence does not get it — but the
  // discrepancy is recorded rather than silently dropped, so the gap is visible
  // to `--unconfirmed` readers instead of looking like an ordinary omission.
  if (params.realization_confirmed === true && !realization_confirmed) {
    out.realization_confirmed_claimed = true;
  }

  // Unknowable, not false: a missing model on either side means the log cannot
  // say whether a substitution happened. Collapsing that to `false` is how v1
  // reported a clean run over a Haiku-for-Sonnet swap.
  out.model_substituted =
    realized_model !== null && intended_model !== null && intended_model !== undefined
      ? realized_model !== intended_model
      : null;

  return out;
}

/**
 * Append a routing DECISION entry to the audit log.
 *
 * `chosen_plugin_id` may be omitted when `routing_record` carries it — the v1
 * signature required it as a top-level param and did not fall back to the
 * record, so the documented Pattern B example threw and the decision went
 * unlogged (node_01KZS33HCND9T13BW7FGRQ8WAA).
 *
 * @param {Object}  params
 * @param {string}  params.task_id                - Task identifier
 * @param {string}  [params.chosen_plugin_id]     - Provider id selected by resolver;
 *                                                  defaults to routing_record.chosen_plugin_id
 * @param {string}  [params.intended_model]       - Model selected by resolver; defaults to
 *                                                  params.model, then routing_record.model
 * @param {string}  [params.model]                - Alias for intended_model
 * @param {string}  [params.actual_provider_used] - Provider that actually ran, IF MEASURED.
 *                                                  Never defaulted from the intent.
 * @param {string}  [params.realized_model]       - Model that actually ran, IF MEASURED
 * @param {string}  [params.realization_evidence] - What measured the realized hop; required
 *                                                  for realization_confirmed to be true
 * @param {boolean} [params.realization_confirmed] - A request, not an assertion: honoured only
 *                                                  when evidence is present
 * @param {boolean} [params.fallback_applied]     - Whether fallback was triggered; auto-true
 *                                                  when a measured provider differs from intent
 * @param {string}  [params.reason]               - Routing rationale
 * @param {Object}  [params.routing_record]       - Optional full RoutingRecord
 * @param {string}  [params.log_path]             - Override log file path (used in tests)
 * @returns {AuditEntry} The entry that was written
 */
function appendEntry(params) {
  const { task_id, reason = '', routing_record, log_path } = params;

  if (!task_id) throw new Error('audit-log.appendEntry: task_id is required');

  const chosen_plugin_id =
    params.chosen_plugin_id || (routing_record && routing_record.chosen_plugin_id);
  if (!chosen_plugin_id) {
    throw new Error(
      'audit-log.appendEntry: chosen_plugin_id is required (pass it, or a routing_record carrying it)'
    );
  }

  const intended_model =
    params.intended_model ||
    params.model ||
    (routing_record && routing_record.model) ||
    null;

  const realization = buildRealization(params, intended_model);

  const fallback_applied = Boolean(
    params.fallback_applied ||
      (realization.actual_provider_used !== null &&
        realization.actual_provider_used !== chosen_plugin_id)
  );

  const entry = {
    task_id,
    timestamp: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    kind: 'decision',
    chosen_plugin_id,
    intended_model,
    ...realization,
    fallback_applied,
    reason,
  };

  if (routing_record) {
    entry.routing_record = routing_record;
  }

  return writeEntry(entry, log_path);
}

/**
 * Append a REALIZATION entry recording what actually ran, after execution.
 *
 * This is the only path that can produce `realization_confirmed: true`, and it
 * requires `realization_evidence` — the whole point being that a self-report
 * from the executing leg is not a measurement. State what witnessed it: a
 * gateway meter row, a CCDash session id, a transcript path, a shelled-out
 * command's own output.
 *
 * The decision entry is never mutated (append-only); readers join on task_id.
 *
 * @param {Object}  params
 * @param {string}  params.task_id                - Task identifier of the decision
 * @param {string}  [params.chosen_plugin_id]     - Intended provider, echoed for standalone reads
 * @param {string}  [params.intended_model]       - Intended model, echoed for standalone reads
 * @param {string}  [params.actual_provider_used] - Provider that actually ran
 * @param {string}  [params.realized_model]       - Model that actually ran
 * @param {string}  params.realization_evidence   - What measured it. Required.
 * @param {string}  [params.reason]               - Optional note
 * @param {string}  [params.log_path]             - Override log file path (used in tests)
 * @returns {AuditEntry} The entry that was written
 */
function appendRealization(params) {
  const { task_id, reason = '', log_path } = params;

  if (!task_id) throw new Error('audit-log.appendRealization: task_id is required');
  if (!isPresent(params.realization_evidence)) {
    throw new Error(
      'audit-log.appendRealization: realization_evidence is required — state what measured the realized hop (a self-report is not a measurement)'
    );
  }
  if (!isPresent(params.actual_provider_used) && !isPresent(params.realized_model)) {
    throw new Error(
      'audit-log.appendRealization: at least one of actual_provider_used / realized_model is required'
    );
  }

  const intended_model = params.intended_model || null;
  const realization = buildRealization({ ...params, realization_confirmed: true }, intended_model);

  const chosen_plugin_id = params.chosen_plugin_id || null;
  const fallback_applied = Boolean(
    chosen_plugin_id !== null &&
      realization.actual_provider_used !== null &&
      realization.actual_provider_used !== chosen_plugin_id
  );

  const entry = {
    task_id,
    timestamp: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    kind: 'realization',
    chosen_plugin_id,
    intended_model,
    ...realization,
    fallback_applied,
    reason,
  };

  return writeEntry(entry, log_path);
}

/**
 * Shared append-only writer.
 *
 * @param {AuditEntry} entry
 * @param {string} [log_path]
 * @returns {AuditEntry}
 */
function writeEntry(entry, log_path) {
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
 * Normalize any entry — v1 or v2 — to the v2 field set for reading.
 *
 * The load-bearing rule: a v1 entry is UNCONFIRMED even when it carries
 * `actual_provider_used`, because v1 required that field and the documented
 * call satisfied it with the intent. Treating a v1 actual as a measurement
 * would re-import the exact false assurance v2 exists to remove.
 *
 * @param {Object} entry
 * @returns {AuditEntry & {legacy: boolean}}
 */
function normalizeEntry(entry) {
  const legacy = entry.schema_version === undefined;
  if (!legacy) {
    return { ...entry, legacy: false };
  }

  return {
    ...entry,
    schema_version: 1,
    kind: 'decision',
    intended_model: entry.intended_model || null,
    // Retained verbatim for provenance, but not read as a measurement — see above.
    actual_provider_used: entry.actual_provider_used || null,
    realized_model: null,
    realization_confirmed: false,
    realization_evidence: null,
    model_substituted: null,
    legacy: true,
  };
}

/**
 * Read all entries normalized to the v2 field set.
 *
 * @param {string} [log_path]
 * @returns {Array<AuditEntry & {legacy: boolean}>}
 */
function readNormalizedEntries(log_path) {
  return readEntries(log_path).map(normalizeEntry);
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

/**
 * Find DECISION entries whose realized hop was never confirmed.
 *
 * A decision is confirmed when either it carries evidence itself, or a later
 * `realization` entry for the same task_id does. Everything else — including
 * every v1 entry and every entry that merely copied the intent — is unconfirmed.
 *
 * This is what `skillmeat routing audit --unconfirmed` surfaces: entries whose
 * ledger value is an intent that nothing ever checked.
 *
 * @param {string} [log_path]
 * @returns {Array<AuditEntry & {legacy: boolean}>}
 */
function findUnconfirmedEntries(log_path) {
  const entries = readNormalizedEntries(log_path);

  const confirmedTaskIds = new Set(
    entries.filter(e => e.realization_confirmed === true).map(e => e.task_id)
  );

  return entries.filter(
    e => e.kind === 'decision' && !confirmedTaskIds.has(e.task_id)
  );
}

/**
 * Find task_ids where a CONFIRMED realized model differs from the intended one.
 *
 * Only confirmed realizations count — an unconfirmed realized_model cannot
 * establish a substitution any more than it can establish compliance.
 *
 * @param {string} [log_path]
 * @returns {Array<{task_id: string, intended_model: ?string, realized_model: ?string, evidence: ?string}>}
 */
function findModelSubstitutions(log_path) {
  const entries = readNormalizedEntries(log_path);

  // A realization entry may omit intended_model; recover it from the decision.
  const intendedByTask = new Map();
  for (const e of entries) {
    if (e.kind === 'decision' && e.intended_model) {
      intendedByTask.set(e.task_id, e.intended_model);
    }
  }

  const out = [];
  for (const e of entries) {
    if (!e.realization_confirmed || !e.realized_model) continue;
    const intended = e.intended_model || intendedByTask.get(e.task_id) || null;
    if (intended && intended !== e.realized_model) {
      out.push({
        task_id: e.task_id,
        intended_model: intended,
        realized_model: e.realized_model,
        evidence: e.realization_evidence || null,
      });
    }
  }
  return out;
}

module.exports = {
  appendEntry,
  appendRealization,
  readEntries,
  readNormalizedEntries,
  normalizeEntry,
  filterEntries,
  findFallbackEntries,
  findByProvider,
  findUnconfirmedEntries,
  findModelSubstitutions,
  SCHEMA_VERSION,
  DEFAULT_LOG_PATH,
};
