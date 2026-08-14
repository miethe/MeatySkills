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
 * `kind: 'blocked'`     — written by appendBlocked() when the leg was NOT ALLOWED
 *                         to run: a permission denial, a Mode-D boundary hit, a
 *                         schema/validation failure, or missing write authority.
 *                         Nothing executed, so every realized field is null BY
 *                         CONSTRUCTION and `fallback_applied` is always false.
 *                         Carries `blocked_reason` + `denial_evidence`.
 * A legacy v1 entry (no `schema_version`) normalizes to a decision whose
 * realization is UNCONFIRMED — including when it carries actual === chosen,
 * because that is the copied-intent shape, not a measurement.
 *
 * ---------------------------------------------------------------------------
 * WHY 'blocked' IS A THIRD KIND AND NOT A FLAVOUR OF THE OTHER TWO
 * ---------------------------------------------------------------------------
 * SPEC §5a draws the line the fallback chain must not cross: **a denial is a
 * decision about whether this content may take this path; unavailability is a
 * fact about the path.** Before this kind existed the writer could express only
 * two things about a denied leg, and both were wrong:
 *
 *   (a) leave the decision entry unconfirmed — which is byte-identical to a leg
 *       that simply has not reported yet. So `--unconfirmed` conflated "denied,
 *       never ran" with "still pending", and a lane that was 100% denied looked
 *       exactly like a lane nobody had used.
 *   (b) write a realized provider — a lie, and precisely the `actual === chosen`
 *       copied-intent corruption that made the field unauditable across 112 of
 *       123 v1 entries.
 *
 * Hence a distinct kind with no realization dimension at all, rather than a flag
 * on a realization. `appendRealization`'s "at least one realized value" guard is
 * deliberately NOT relaxed to admit a denial: that guard is what stops an empty
 * realization from reading as a measurement (node_01M00JTM8FVBK12GF4AYQ7S2JN).
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Current entry schema version. Absent on v1 entries. */
const SCHEMA_VERSION = 2;

/**
 * The closed set of BLOCKED reasons, mirroring SPEC §5a's "NOT a traversal
 * trigger" column verbatim. These are authorization/correctness outcomes; an
 * availability outcome is a fallback traversal and belongs in a decision or
 * realization entry, never here.
 *
 * The set is closed on purpose — `routing audit --blocked` is only queryable if
 * the reason vocabulary is fixed. Adding a member is a SPEC change: edit §5a's
 * table and this list together, or the log and the spec drift.
 */
const BLOCKED_REASONS = Object.freeze([
  'permission_denied', // the CC permission classifier, a PreToolUse hook, or a user/harness refusal
  'mode_d', // Mode-D boundary hit — the leg must hand back to Opus
  'validation_failed', // schema/validation failure
  'needs_write_authority', // the leg had no authority to write
]);

// Default log path — relative to repo root
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_LOG_PATH = path.join(REPO_ROOT, '.claude', 'logs', 'routing-decisions.jsonl');

/**
 * @typedef {Object} AuditEntry
 * @property {string}  task_id                  - Task identifier (e.g. 'TASK-3.2', 'node_01…')
 * @property {string}  timestamp                - ISO 8601 UTC timestamp
 * @property {number}  schema_version           - 2 for entries written by this module
 * @property {'decision'|'realization'|'blocked'} kind - Intent record, measured-outcome
 *           record, or not-allowed-to-run record
 * @property {string}  [blocked_reason]         - kind 'blocked' only; a BLOCKED_REASONS member
 * @property {string}  [denial_evidence]        - kind 'blocked' only; the verbatim denial and
 *           the invocation it refused. Required — a denial with no evidence is a rumour
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
 * Append a BLOCKED entry recording that the leg was never allowed to run.
 *
 * This is the writer SPEC §5a mandates and the module previously lacked. It is
 * the ONLY honest record for a denial, because a denial has no realized hop to
 * report: `appendRealization` requires at least one realized value and would
 * reject `{actual: null, realized: null}` — correctly, and that guard stays.
 *
 * `chosen_plugin_id` / `intended_model` are the INTENT THAT WAS REFUSED, echoed
 * so a reader can see which lane was denied without joining. They are never
 * read as "what ran": every realized field on this entry is null by
 * construction, and passing one is an error rather than being silently dropped —
 * a caller reaching for `actual_provider_used` on a denial has misunderstood the
 * kind, and quietly accepting it would reintroduce the copied-intent corruption.
 *
 * `fallback_applied` is hard-false for the same reason SPEC §5a forbids it:
 * emitting true would make an authorization event indistinguishable from an
 * infrastructure one, in the one place a reviewer would have caught it.
 *
 * @param {Object}  params
 * @param {string}  params.task_id            - Task identifier of the denied leg
 * @param {string}  params.blocked_reason     - A BLOCKED_REASONS member (e.g. 'permission_denied')
 * @param {string}  params.denial_evidence    - The verbatim denial message and the invocation it
 *                                              refused. Required.
 * @param {string}  [params.chosen_plugin_id] - The provider that was DENIED (intent, not actual);
 *                                              defaults to routing_record.chosen_plugin_id
 * @param {string}  [params.intended_model]   - The model that was DENIED (intent, not actual);
 *                                              defaults to params.model, then routing_record.model
 * @param {string}  [params.model]            - Alias for intended_model
 * @param {string}  [params.reason]           - Optional free-text note
 * @param {Object}  [params.routing_record]   - Optional full RoutingRecord
 * @param {string}  [params.log_path]         - Override log file path (used in tests)
 * @returns {AuditEntry} The entry that was written
 */
function appendBlocked(params) {
  const { task_id, reason = '', routing_record, log_path } = params || {};

  if (!task_id) throw new Error('audit-log.appendBlocked: task_id is required');

  if (!isPresent(params.denial_evidence)) {
    throw new Error(
      'audit-log.appendBlocked: denial_evidence is required — quote the refusal and the invocation it refused (a denial with no evidence is a rumour)'
    );
  }

  if (!isPresent(params.blocked_reason)) {
    throw new Error(
      `audit-log.appendBlocked: blocked_reason is required — one of: ${BLOCKED_REASONS.join(', ')}`
    );
  }
  if (!BLOCKED_REASONS.includes(params.blocked_reason)) {
    throw new Error(
      `audit-log.appendBlocked: unknown blocked_reason '${params.blocked_reason}' — expected one of: ${BLOCKED_REASONS.join(', ')}. An AVAILABILITY failure is not a blocked outcome; log it as a fallback instead (SPEC 5a).`
    );
  }

  // Refuse, never drop. A realized field on a blocked entry is a contradiction:
  // the whole claim of this kind is that nothing ran.
  for (const f of ['actual_provider_used', 'realized_model', 'realization_evidence']) {
    if (isPresent(params[f])) {
      throw new Error(
        `audit-log.appendBlocked: ${f} must not be set on a blocked entry — nothing ran. If something DID run, this is a realization, not a denial.`
      );
    }
  }
  if (params.fallback_applied === true) {
    throw new Error(
      'audit-log.appendBlocked: fallback_applied must not be true for a blocked outcome (SPEC 5a) — a denial attaches to the content, so no other lane may carry it'
    );
  }

  const chosen_plugin_id =
    params.chosen_plugin_id || (routing_record && routing_record.chosen_plugin_id) || null;
  const intended_model =
    params.intended_model || params.model || (routing_record && routing_record.model) || null;

  const entry = {
    task_id,
    timestamp: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    kind: 'blocked',
    chosen_plugin_id,
    intended_model,
    // Null BY CONSTRUCTION, not by omission — nothing ran, so there is nothing to name.
    actual_provider_used: null,
    realized_model: null,
    realization_confirmed: false,
    realization_evidence: null,
    // Unknowable, not false: no model ran, so no substitution can be asserted either way.
    model_substituted: null,
    fallback_applied: false,
    blocked_reason: params.blocked_reason,
    denial_evidence: params.denial_evidence,
    reason,
  };

  if (routing_record) {
    entry.routing_record = routing_record;
  }

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
 * A task with a `blocked` entry is EXCLUDED, and that exclusion is the point of
 * the kind. "Unconfirmed" means *nobody has checked yet* — an open question. A
 * denial is a settled answer: it will never be confirmed, because nothing ran
 * and nothing is going to. Leaving denials in here is what made a 100%-denied
 * lane read as an idle one, and let a broken offload lane stay `not_started`
 * through two filings. Use `findBlockedEntries()` to see them.
 *
 * @param {string} [log_path]
 * @returns {Array<AuditEntry & {legacy: boolean}>}
 */
function findUnconfirmedEntries(log_path) {
  const entries = readNormalizedEntries(log_path);

  const confirmedTaskIds = new Set(
    entries.filter(e => e.realization_confirmed === true).map(e => e.task_id)
  );
  const blockedTaskIds = new Set(
    entries.filter(e => e.kind === 'blocked').map(e => e.task_id)
  );

  return entries.filter(
    e =>
      e.kind === 'decision' &&
      !confirmedTaskIds.has(e.task_id) &&
      !blockedTaskIds.has(e.task_id)
  );
}

/**
 * Find BLOCKED entries — legs that were not allowed to run.
 *
 * The reader half of `appendBlocked`. `blocked_reason` is a closed vocabulary
 * (BLOCKED_REASONS), so callers may filter on it without string-sniffing.
 *
 * @param {string} [log_path]
 * @param {string} [blocked_reason] - Optional: restrict to one BLOCKED_REASONS member
 * @returns {Array<AuditEntry & {legacy: boolean}>}
 */
function findBlockedEntries(log_path, blocked_reason) {
  const blocked = readNormalizedEntries(log_path).filter(e => e.kind === 'blocked');
  return isPresent(blocked_reason)
    ? blocked.filter(e => e.blocked_reason === blocked_reason)
    : blocked;
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

// ---------------------------------------------------------------------------
// INGEST — the wire between a workflow run and this log
// ---------------------------------------------------------------------------
/**
 * WHY THIS EXISTS (read before removing it as a thin wrapper)
 * ----------------------------------------------------------
 * Workflow scripts cannot `require()` this module or touch the filesystem —
 * that is constraint 1 of the workflow-authoring contract. So for a year they
 * expressed their routing decisions as a `_routing_log` key on the `agent()`
 * opts bag, which nothing has ever read: it is not in the documented opts
 * allowlist, so the runtime discards it. 14 payloads across 5 workflows were
 * written and dropped, which made `skillmeat routing audit` over a workflow run
 * empty BY CONSTRUCTION — and an empty audit log reads exactly like a clean one.
 * Measured 2026-08-12 (node_01KZVV9R3EK13DJXS44VCQ8E9C).
 *
 * The wire is therefore: the workflow ACCUMULATES its entries in a plain array
 * and returns them as `routing_log` on its ExecutionReport (no FS, no require —
 * an array push is neither), and the post-run caller — Opus, on claude-primary,
 * where the write belongs — hands that array to this function.
 *
 * Two properties this function must keep:
 *   - VALIDATE-THEN-WRITE, in two passes. The log is append-only, so a throw
 *     halfway through a 14-entry batch leaves 6 entries and no way to retract
 *     them. Nothing is written until every entry is known to be writable.
 *   - SKIPS ARE LOUD. A rejected entry is returned in `skipped` and makes the
 *     CLI exit non-zero. Dropping one silently would rebuild the failure this
 *     whole function exists to end, one layer further in.
 *   - PER-LEG TASK IDENTITY, not one id for the whole run. See below — this one
 *     is subtle and getting it wrong reintroduces false confirmation.
 *
 * ---------------------------------------------------------------------------
 * WHY `task_ref` EXISTS (measured 2026-08-12, before it shipped)
 * ---------------------------------------------------------------------------
 * `findUnconfirmedEntries()` settles a decision by JOINING ON task_id: any entry
 * with `realization_confirmed: true` marks every decision sharing that task_id as
 * confirmed. That is correct for one leg — the realization is the measurement of
 * that decision.
 *
 * It is catastrophic if a whole run shares one task_id. A run with five routing
 * decisions and one measured fallback would report ALL FIVE as confirmed, on the
 * strength of evidence about a different leg entirely. `routing audit --unconfirmed`
 * would return clean while four decisions had never been measured at all — the same
 * false-assurance shape as the empty audit log this wire was built to fix, one layer in.
 *
 * So each entry carries a `task_ref`: a stable per-leg discriminator (the site's own
 * label — `${p.id}:ac-validate`, `fix-cycle-2`, `evidence-scribe:stage-a`). A
 * decision and the realization that measures it use the SAME ref, so they join;
 * different legs get different refs, so they never cross-settle. The batch
 * `task_id` remains the run's identity and is composed as `<task_id>::<task_ref>`,
 * keeping every entry traceable to the run it came from.
 *
 * An entry with NO task_ref falls back to the bare batch id. That is accepted (a
 * single-leg workflow is legitimate) but it is counted and returned in
 * `counts.no_task_ref`, because two or more such entries in one batch are exactly
 * the cross-settle hazard above.
 *
 * @param {Object}   params
 * @param {Array<Object>|Object} params.entries - The workflow's `routing_log` array, or the
 *                                    whole report object (its `.routing_log` is used).
 * @param {string}   [params.task_id] - Batch-level task id (a node id, run id, or plan id).
 *                                    Composed with each entry's `task_ref` as
 *                                    `<task_id>::<task_ref>`. Workflow scripts do not know
 *                                    this; the caller does.
 * @param {string}   [params.log_path] - Override log file path (used in tests)
 * @param {boolean}  [params.dry_run]  - Validate only; write nothing.
 * @returns {{written: AuditEntry[], skipped: Array<{index: number, reason: string}>,
 *            counts: {decision: number, realization: number, defaulted_kind: number},
 *            dry_run: boolean}}
 */
function ingestRoutingLog(params) {
  const { task_id: batch_task_id, log_path, dry_run = false } = params || {};

  const raw = Array.isArray(params && params.entries)
    ? params.entries
    : params && params.entries && Array.isArray(params.entries.routing_log)
      ? params.entries.routing_log
      : null;

  if (raw === null) {
    throw new Error(
      'audit-log.ingestRoutingLog: entries must be an array, or an object carrying a routing_log array'
    );
  }

  const skipped = [];
  const planned = [];
  let defaulted_kind = 0;
  let no_task_ref = 0;

  // ---- pass 1: validate everything, write nothing ----
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      skipped.push({ index, reason: 'not a JSON object' });
      return;
    }

    // Per-leg identity — see "WHY task_ref EXISTS" above. An explicit task_id on the
    // entry always wins; otherwise the batch id is scoped by the leg's own ref.
    let task;
    if (isPresent(entry.task_id)) {
      task = entry.task_id;
    } else if (isPresent(batch_task_id) && isPresent(entry.task_ref)) {
      task = `${batch_task_id}::${entry.task_ref}`;
    } else if (isPresent(entry.task_ref)) {
      task = entry.task_ref;
    } else {
      task = batch_task_id;
      if (isPresent(task)) no_task_ref += 1;
    }
    if (!isPresent(task)) {
      skipped.push({
        index,
        reason: 'no task_id or task_ref on the entry and none supplied for the batch',
      });
      return;
    }

    // A missing `kind` normalizes to 'decision', matching normalizeEntry()'s rule
    // for a v1 entry. Counted so the caller can see it was inferred, not stated.
    let kind = entry.kind;
    if (!isPresent(kind)) {
      kind = 'decision';
      defaulted_kind += 1;
    }
    if (kind !== 'decision' && kind !== 'realization' && kind !== 'blocked') {
      skipped.push({ index, reason: `unknown kind '${entry.kind}'` });
      return;
    }

    if (kind === 'decision') {
      const chosen =
        entry.chosen_plugin_id || (entry.routing_record && entry.routing_record.chosen_plugin_id);
      if (!isPresent(chosen)) {
        skipped.push({ index, reason: 'decision entry has no chosen_plugin_id' });
        return;
      }
    } else if (kind === 'blocked') {
      // Validated here rather than only in appendBlocked(): pass 1 must write
      // nothing, so a malformed blocked leg has to be skippable, not throwable.
      if (!isPresent(entry.denial_evidence)) {
        skipped.push({
          index,
          reason: 'blocked entry has no denial_evidence — a denial with no evidence is a rumour',
        });
        return;
      }
      if (!BLOCKED_REASONS.includes(entry.blocked_reason)) {
        skipped.push({
          index,
          reason: `blocked entry has unknown blocked_reason '${entry.blocked_reason}' — expected one of: ${BLOCKED_REASONS.join(', ')}`,
        });
        return;
      }
      if (
        isPresent(entry.actual_provider_used) ||
        isPresent(entry.realized_model) ||
        entry.fallback_applied === true
      ) {
        skipped.push({
          index,
          reason:
            'blocked entry names a realized provider/model or claims fallback_applied — nothing ran (SPEC 5a)',
        });
        return;
      }
    } else {
      if (!isPresent(entry.realization_evidence)) {
        skipped.push({
          index,
          reason:
            'realization entry has no realization_evidence — a self-report is not a measurement',
        });
        return;
      }
      if (!isPresent(entry.actual_provider_used) && !isPresent(entry.realized_model)) {
        skipped.push({
          index,
          reason: 'realization entry names neither actual_provider_used nor realized_model',
        });
        return;
      }
    }

    // task_ref is addressing metadata, not part of the audit entry shape; the composed
    // task_id already carries it. Strip it so it cannot look like a logged field.
    const { task_ref: _task_ref, ...entryFields } = entry;
    planned.push({ kind, params: { ...entryFields, task_id: task, log_path } });
  });

  const counts = {
    decision: planned.filter(p => p.kind === 'decision').length,
    realization: planned.filter(p => p.kind === 'realization').length,
    blocked: planned.filter(p => p.kind === 'blocked').length,
    defaulted_kind,
    no_task_ref,
  };

  if (dry_run) {
    return { written: [], skipped, counts, dry_run: true };
  }

  // ---- pass 2: write ----
  const WRITERS = {
    decision: appendEntry,
    realization: appendRealization,
    blocked: appendBlocked,
  };
  const written = planned.map(p => WRITERS[p.kind](p.params));

  return { written, skipped, counts, dry_run: false };
}

// The CLI for this lives in log-cli.js (`--ingest`), which is this estate's single
// headless entry point over the writer. A second `require.main` block here would
// split that surface in two, and the copy people found first would be the one that
// did not grow the next flag.

module.exports = {
  BLOCKED_REASONS,
  appendEntry,
  appendRealization,
  appendBlocked,
  findBlockedEntries,
  ingestRoutingLog,
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
