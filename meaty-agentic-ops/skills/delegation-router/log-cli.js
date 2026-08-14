#!/usr/bin/env node
/**
 * delegation-router/log-cli.js
 *
 * Headless CLI wrapper over audit-log.js's `appendEntry()`. Lets a non-Claude-Code
 * harness (Codex, a shell script, a markdown-driven phase-owner agent, …) LOG a
 * routing decision it already resolved (e.g. via resolve-cli.js) to the routing
 * audit log, without re-implementing the writer.
 *
 * USAGE
 *   node log-cli.js --task-id <id> [--chosen <plugin_id>] [--intended-model <id>]
 *                    [--actual <plugin_id>] [--realized-model <id>] [--evidence <text>]
 *                    [--fallback] [--reason <text>]
 *                    [--record <json-string-or-path-to-json-file>]
 *                    [--log-path <path>]
 *   node log-cli.js --realization --task-id <id> --evidence <text>
 *                    [--actual <plugin_id>] [--realized-model <id>] [...]
 *   node log-cli.js --help
 *
 * OUTPUT
 *   Prints the written audit entry as pretty JSON to stdout and exits 0.
 *   On an invalid/unwritable request, prints a one-line human-readable message to
 *   stderr (never a raw stack trace as the primary message) and exits non-zero.
 *
 * INVARIANTS:
 *   - Pure aside from the log write itself: no network calls, no model calls. The
 *     only write is the single appendEntry()/appendRealization() call (which may
 *     create the log file and its parent directory — see audit-log.js's own
 *     INVARIANTS).
 *   - Does NOT modify audit-log.js's writer or entry shape.
 *   - --record may be either an inline JSON string or a filesystem path to a .json
 *     file; chosen_plugin_id/intended_model/reason are derived from it when the
 *     explicit flags are not passed. Explicit flags always win over record-derived
 *     values.
 *   - **--actual does NOT default to the chosen plugin id.** Omitted means
 *     UNCONFIRMED, which is a different fact from "ran where we intended" — the v1
 *     default made those two indistinguishable in 91% of live entries. Pass --actual
 *     only when you measured it.
 *   - --evidence is what turns a realized provider/model into a CONFIRMED one. Without
 *     it the values are recorded but stay unconfirmed; audit-log.js owns that rule.
 *   - fallback_applied is set true automatically whenever a MEASURED actual differs
 *     from chosen; passing --fallback always forces it true.
 */

'use strict';

const fs = require('fs');

const {
  appendEntry,
  appendRealization,
  appendBlocked,
  ingestRoutingLog,
  BLOCKED_REASONS,
  DEFAULT_LOG_PATH,
} = require('./audit-log.js');

function printHelp(stream) {
  stream.write(
    [
      'Usage: node log-cli.js --task-id <id> [--chosen <plugin_id>] [--intended-model <id>]',
      '                        [--actual <plugin_id>] [--realized-model <id>] [--evidence <text>]',
      '                        [--fallback] [--reason <text>]',
      '                        [--record <json-string-or-path-to-json-file>]',
      '                        [--log-path <path>]',
      '       node log-cli.js --realization --task-id <id> --evidence <text>',
      '                        [--actual <plugin_id>] [--realized-model <id>] [...]',
      '       node log-cli.js --blocked --task-id <id> --blocked-reason <reason>',
      '                        --denial-evidence <text> [--chosen <plugin_id>] [...]',
      '',
      'Appends a routing entry to the routing audit log and prints the written entry as',
      'JSON to stdout, exiting 0. Exits non-zero with a readable message on stderr when',
      'the entry cannot be written. Pure aside from the log append itself: no network,',
      'no model calls.',
      '',
      'Three entry kinds:',
      '  decision (default)  What the resolver DECIDED: provider + model intent.',
      '  --realization       What actually RAN, measured after the fact. Requires',
      '                      --evidence and at least one of --actual/--realized-model.',
      '  --blocked           What was NOT ALLOWED to run: a permission denial, a',
      '                      Mode-D boundary hit, a validation failure, or missing',
      '                      write authority (SPEC 5a). Requires --blocked-reason and',
      '                      --denial-evidence; rejects --actual/--realized-model,',
      '                      because nothing ran. Keeps a denied leg out of',
      '                      --unconfirmed, where it used to look merely pending.',
      '',
      'Flags:',
      '  --task-id <id>        Task identifier (e.g. TASK-3.2, node_01…). Required.',
      '  --chosen <plugin_id>  Provider id selected by the resolver (chosen_plugin_id).',
      '  --intended-model <id> Model id selected by the resolver. Default: record.model.',
      '  --actual <plugin_id>  Provider id that actually executed. NOT defaulted from',
      '                        --chosen: omit it when you did not measure it.',
      '  --realized-model <id> Model id that actually executed, when measured.',
      '  --evidence <text>     What measured the realized hop (session id, meter row,',
      '                        transcript path). Required for a confirmed realization —',
      '                        an executing leg\'s own self-report is not a measurement.',
      '  --realization         Write a realization entry instead of a decision entry.',
      '  --blocked             Write a blocked entry instead of a decision entry.',
      `  --blocked-reason <r>  Required with --blocked. One of: ${BLOCKED_REASONS.join(', ')}.`,
      '                        An AVAILABILITY failure is NOT one of these — that is a',
      '                        fallback, and belongs on a decision/realization entry.',
      '  --denial-evidence <t> Required with --blocked. The verbatim refusal and the',
      '                        invocation it refused. A denial with no evidence is a rumour.',
      '  --fallback            Force fallback_applied=true (auto-true when a measured',
      '                        --actual differs from --chosen). Invalid with --blocked:',
      '                        a denial attaches to the content, so no lane may carry it.',
      '  --reason <text>       Human-readable routing rationale.',
      '  --record <json|path>  Full RoutingRecord as an inline JSON string or a path to a',
      '                        .json file. Derives chosen_plugin_id/intended_model/reason',
      '                        when the explicit flags are not given.',
      '  --log-path <path>     Override the audit log file path (test/debug only).',
      '  --help, -h            Show this help and exit 0.',
      '',
      'Batch mode — draining a workflow run:',
      '  --ingest <json|->     Path to a workflow ExecutionReport (or a bare array) whose',
      '                        `routing_log` entries are written in one pass. This is the',
      '                        wire between a Dynamic Workflow and this log: workflow',
      '                        scripts cannot require() or touch the FS, so they accumulate',
      '                        entries and RETURN them, and the post-run caller ingests',
      '                        them here — on claude-primary, where the write belongs.',
      '                        Each entry carries its own kind/provider/evidence; --task-id',
      '                        supplies the task for any entry lacking one (a workflow does',
      '                        not know its node id, the caller does). Other single-entry',
      '                        flags are ignored in this mode.',
      '  --dry-run             With --ingest: validate every entry, write nothing.',
      '',
      'Examples:',
      '  node log-cli.js --task-id P2-006 --chosen ica --intended-model "claude-sonnet-5[1m]" \\',
      '    --reason "free-tier offload"',
      '  node log-cli.js --realization --task-id P2-006 --actual ica \\',
      '    --realized-model "claude-haiku-4-5[1m]" --evidence "ccdash session S-abc123"',
      '  node log-cli.js --blocked --task-id P2-006 --chosen ica \\',
      '    --blocked-reason permission_denied \\',
      '    --denial-evidence "auto-mode classifier denied Bash(~/ica-claude.sh …)"',
      '  node log-cli.js --ingest report.json --task-id node_01KZVV9R3EK13DJXS44VCQ8E9C',
      '',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const args = {
    task_id: undefined,
    chosen: undefined,
    intended_model: undefined,
    actual: undefined,
    realized_model: undefined,
    evidence: undefined,
    realization: false,
    blocked: false,
    blocked_reason: undefined,
    denial_evidence: undefined,
    fallback: false,
    reason: undefined,
    record: undefined,
    log_path: undefined,
    ingest: undefined,
    dry_run: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--task-id':
        args.task_id = argv[++i];
        break;
      case '--chosen':
        args.chosen = argv[++i];
        break;
      case '--intended-model':
        args.intended_model = argv[++i];
        break;
      case '--actual':
        args.actual = argv[++i];
        break;
      case '--realized-model':
        args.realized_model = argv[++i];
        break;
      case '--evidence':
        args.evidence = argv[++i];
        break;
      case '--realization':
        args.realization = true;
        break;
      case '--blocked':
        args.blocked = true;
        break;
      case '--blocked-reason':
        args.blocked_reason = argv[++i];
        break;
      case '--denial-evidence':
        args.denial_evidence = argv[++i];
        break;
      case '--fallback':
        args.fallback = true;
        break;
      case '--reason':
        args.reason = argv[++i];
        break;
      case '--record':
        args.record = argv[++i];
        break;
      case '--log-path':
        args.log_path = argv[++i];
        break;
      case '--ingest':
        args.ingest = argv[++i];
        break;
      case '--dry-run':
        args.dry_run = true;
        break;
      default:
        throw new Error(`unrecognized argument '${flag}' (see --help)`);
    }
  }

  return args;
}

/**
 * Resolve --record into a parsed RoutingRecord object, accepting either an inline
 * JSON string or a filesystem path to a .json file.
 *
 * @param {string} recordArg
 * @returns {Object}
 */
function loadRecord(recordArg) {
  let raw;
  if (fs.existsSync(recordArg)) {
    raw = fs.readFileSync(recordArg, 'utf8');
  } else {
    raw = recordArg;
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`--record could not be parsed as JSON (tried as inline string) — ${err.message}`);
  }
}

/**
 * Build appendEntry() params from parsed CLI args, applying the derivation and
 * fallback-detection rules described in this file's INVARIANTS.
 *
 * @param {ReturnType<typeof parseArgs>} args
 * @returns {Object} params for audit-log.js's appendEntry()
 */
function buildEntryParams(args) {
  if (!args.task_id) {
    throw new Error('--task-id is required (see --help)');
  }

  let record;
  if (args.record !== undefined) {
    record = loadRecord(args.record);
  }

  const chosen_plugin_id = args.chosen || (record && record.chosen_plugin_id);
  const intended_model = args.intended_model || (record && record.model) || undefined;
  const reason = args.reason !== undefined ? args.reason : (record && record.reason) || '';

  // A blocked entry describes what was NOT ALLOWED to run. It carries the denied
  // intent and the refusal, and by construction names nothing that executed —
  // hence its own flags rather than reusing --actual/--evidence, which would
  // invite exactly the "write a realized provider" reflex SPEC 5a forbids.
  if (args.blocked) {
    if (args.realization) {
      throw new Error('--blocked and --realization are mutually exclusive: a denied leg never ran');
    }
    if (!args.denial_evidence) {
      throw new Error(
        '--denial-evidence is required with --blocked — quote the refusal and the invocation it refused (see --help)'
      );
    }
    if (!args.blocked_reason) {
      throw new Error(
        `--blocked-reason is required with --blocked — one of: ${BLOCKED_REASONS.join(', ')} (see --help)`
      );
    }
    if (args.actual || args.realized_model) {
      throw new Error(
        '--actual / --realized-model are invalid with --blocked: nothing ran. If something DID run, this is a realization.'
      );
    }
    const params = {
      task_id: args.task_id,
      blocked_reason: args.blocked_reason,
      denial_evidence: args.denial_evidence,
      reason,
    };
    if (chosen_plugin_id) params.chosen_plugin_id = chosen_plugin_id;
    if (intended_model) params.intended_model = intended_model;
    if (record) params.routing_record = record;
    if (args.log_path) params.log_path = args.log_path;
    return params;
  }

  // A realization entry describes what RAN; it needs no resolver intent to be valid,
  // and audit-log.js recovers intended_model from the decision entry when omitted.
  if (args.realization) {
    if (!args.evidence) {
      throw new Error(
        '--evidence is required with --realization — state what measured the realized hop (see --help)'
      );
    }
    if (!args.actual && !args.realized_model) {
      throw new Error(
        '--realization needs at least one of --actual / --realized-model (see --help)'
      );
    }
    const params = {
      task_id: args.task_id,
      realization_evidence: args.evidence,
      reason,
    };
    if (chosen_plugin_id) params.chosen_plugin_id = chosen_plugin_id;
    if (intended_model) params.intended_model = intended_model;
    if (args.actual) params.actual_provider_used = args.actual;
    if (args.realized_model) params.realized_model = args.realized_model;
    if (args.log_path) params.log_path = args.log_path;
    return params;
  }

  if (!chosen_plugin_id) {
    throw new Error('--chosen is required when --record does not contain chosen_plugin_id (see --help)');
  }

  const params = {
    task_id: args.task_id,
    chosen_plugin_id,
    reason,
  };

  if (intended_model) params.intended_model = intended_model;

  // Deliberately NOT `args.actual || chosen_plugin_id`. Omitted stays omitted:
  // audit-log.js records null (unconfirmed) rather than a copy of the intent.
  if (args.actual) params.actual_provider_used = args.actual;
  if (args.realized_model) params.realized_model = args.realized_model;
  if (args.evidence) params.realization_evidence = args.evidence;

  // Only a MEASURED actual can imply a fallback; --fallback still forces it.
  if (args.fallback || (args.actual && args.actual !== chosen_plugin_id)) {
    params.fallback_applied = true;
  }

  if (record) {
    params.routing_record = record;
  }
  if (args.log_path) {
    params.log_path = args.log_path;
  }

  return params;
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp(argv.length === 0 ? process.stderr : process.stdout);
    process.exit(argv.length === 0 ? 2 : 0);
    return;
  }

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`log-cli: ${err.message}\n`);
    process.exit(2);
    return;
  }

  // --ingest is a BATCH mode and returns before the single-entry path below: it takes a
  // whole workflow's `routing_log` array at once, which is the shape the wire between a
  // workflow run and this log actually has. The single-entry flags do not apply to it.
  if (args.ingest !== undefined) {
    if (args.ingest === undefined || args.ingest === null || args.ingest === '') {
      process.stderr.write('log-cli: --ingest needs a path to a report/array JSON file (or - for stdin)\n');
      process.exit(2);
      return;
    }

    let text;
    try {
      text = args.ingest === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(args.ingest, 'utf8');
    } catch (err) {
      process.stderr.write(`log-cli: cannot read ${args.ingest} — ${err.message}\n`);
      process.exit(2);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      process.stderr.write(`log-cli: ${args.ingest} is not valid JSON — ${err.message}\n`);
      process.exit(2);
      return;
    }

    let result;
    try {
      result = ingestRoutingLog({
        entries: parsed,
        task_id: args.task_id,
        log_path: args.log_path,
        dry_run: args.dry_run,
      });
    } catch (err) {
      process.stderr.write(`log-cli: could not ingest routing_log — ${err.message}\n`);
      process.exit(2);
      return;
    }

    // Every written kind must be summed here. Omitting one under-reports the
    // ingest, and the kind most likely to be forgotten is the one a reviewer most
    // needs to see: a wholly-denied lane would otherwise report `ingested: 0`.
    const total =
      result.counts.decision + result.counts.realization + result.counts.blocked;
    process.stdout.write(
      JSON.stringify(
        {
          ingested: total,
          decisions: result.counts.decision,
          realizations: result.counts.realization,
          blocked: result.counts.blocked,
          defaulted_kind: result.counts.defaulted_kind,
          no_task_ref: result.counts.no_task_ref,
          skipped: result.skipped,
          dry_run: result.dry_run,
          log_path: args.log_path || DEFAULT_LOG_PATH,
        },
        null,
        2
      ) + '\n'
    );

    // Two or more entries with no task_ref collapse onto one task_id, and
    // findUnconfirmedEntries() settles decisions by joining on task_id — so one leg's
    // realization would mark the others confirmed on evidence about something else.
    // Warn rather than fail: a legitimate single-leg batch is indistinguishable at this
    // layer, and the caller is the one who knows. Silence is how the original bug survived.
    if (result.counts.no_task_ref > 1) {
      process.stderr.write(
        `WARNING: ${result.counts.no_task_ref} entries carried no task_ref, so they share the task_id ` +
          `'${args.task_id}'. A confirmed realization among them will mark the others CONFIRMED too — ` +
          `audit --unconfirmed would read clean on decisions nothing measured. Give each leg a task_ref ` +
          `(see audit-log.js "WHY task_ref EXISTS").\n`
      );
    }

    // A skipped entry exits non-zero even though the rest were written. Reporting a
    // partial ingest as success is the same false assurance an empty audit log gave.
    process.exit(result.skipped.length > 0 ? 1 : 0);
    return;
  }

  let params;
  try {
    params = buildEntryParams(args);
  } catch (err) {
    process.stderr.write(`log-cli: ${err.message}\n`);
    process.exit(2);
    return;
  }

  let entry;
  try {
    if (args.blocked) entry = appendBlocked(params);
    else if (args.realization) entry = appendRealization(params);
    else entry = appendEntry(params);
  } catch (err) {
    process.stderr.write(`log-cli: could not write audit entry — ${err.message}\n`);
    process.exit(1);
    return;
  }

  process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, loadRecord, buildEntryParams, main };
