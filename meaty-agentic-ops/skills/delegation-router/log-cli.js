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

const { appendEntry, appendRealization } = require('./audit-log.js');

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
      '',
      'Appends a routing entry to the routing audit log and prints the written entry as',
      'JSON to stdout, exiting 0. Exits non-zero with a readable message on stderr when',
      'the entry cannot be written. Pure aside from the log append itself: no network,',
      'no model calls.',
      '',
      'Two entry kinds:',
      '  decision (default)  What the resolver DECIDED: provider + model intent.',
      '  --realization       What actually RAN, measured after the fact. Requires',
      '                      --evidence and at least one of --actual/--realized-model.',
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
      '  --fallback            Force fallback_applied=true (auto-true when a measured',
      '                        --actual differs from --chosen).',
      '  --reason <text>       Human-readable routing rationale.',
      '  --record <json|path>  Full RoutingRecord as an inline JSON string or a path to a',
      '                        .json file. Derives chosen_plugin_id/intended_model/reason',
      '                        when the explicit flags are not given.',
      '  --log-path <path>     Override the audit log file path (test/debug only).',
      '  --help, -h            Show this help and exit 0.',
      '',
      'Examples:',
      '  node log-cli.js --task-id P2-006 --chosen ica --intended-model "claude-sonnet-5[1m]" \\',
      '    --reason "free-tier offload"',
      '  node log-cli.js --realization --task-id P2-006 --actual ica \\',
      '    --realized-model "claude-haiku-4-5[1m]" --evidence "ccdash session S-abc123"',
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
    fallback: false,
    reason: undefined,
    record: undefined,
    log_path: undefined,
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
    entry = args.realization ? appendRealization(params) : appendEntry(params);
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
