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
 *   node log-cli.js --task-id <id> [--chosen <plugin_id>] [--actual <plugin_id>]
 *                    [--fallback] [--reason <text>]
 *                    [--record <json-string-or-path-to-json-file>]
 *                    [--log-path <path>]
 *   node log-cli.js --help
 *
 * OUTPUT
 *   Prints the written audit entry as pretty JSON to stdout and exits 0.
 *   On an invalid/unwritable request, prints a one-line human-readable message to
 *   stderr (never a raw stack trace as the primary message) and exits non-zero.
 *
 * INVARIANTS:
 *   - Pure aside from the log write itself: no network calls, no model calls. The
 *     only write is the single appendEntry() call (which may create the log file
 *     and its parent directory — see audit-log.js's own INVARIANTS).
 *   - Does NOT modify audit-log.js's writer or entry shape.
 *   - --record may be either an inline JSON string or a filesystem path to a .json
 *     file; chosen_plugin_id/reason are derived from it when --chosen/--reason are
 *     not explicitly passed. Explicit flags always win over record-derived values.
 *   - --actual defaults to the resolved chosen plugin id (the no-fallback case).
 *   - fallback_applied is set true automatically whenever actual !== chosen, even
 *     without --fallback; passing --fallback always forces it true.
 */

'use strict';

const fs = require('fs');

const { appendEntry } = require('./audit-log.js');

function printHelp(stream) {
  stream.write(
    [
      'Usage: node log-cli.js --task-id <id> [--chosen <plugin_id>] [--actual <plugin_id>]',
      '                        [--fallback] [--reason <text>]',
      '                        [--record <json-string-or-path-to-json-file>]',
      '                        [--log-path <path>]',
      '',
      'Appends a routing decision entry to the routing audit log (audit-log.js\'s',
      'appendEntry) and prints the written entry as JSON to stdout, exiting 0. Exits',
      'non-zero with a readable message on stderr when the entry cannot be written.',
      'Pure aside from the log append itself: no network, no model calls.',
      '',
      'Flags:',
      '  --task-id <id>        Task identifier (e.g. TASK-3.2, P2-006). Required.',
      '  --chosen <plugin_id>  Provider id selected by the resolver (chosen_plugin_id).',
      '  --actual <plugin_id>  Provider id that actually executed. Default: --chosen.',
      '  --fallback            Force fallback_applied=true (auto-true when actual != chosen).',
      '  --reason <text>       Human-readable routing rationale.',
      '  --record <json|path>  Full RoutingRecord as an inline JSON string or a path to a',
      '                        .json file. Derives chosen_plugin_id/reason when --chosen/',
      '                        --reason are not given; explicit flags always win.',
      '  --log-path <path>     Override the audit log file path (test/debug only).',
      '  --help, -h            Show this help and exit 0.',
      '',
      'Examples:',
      '  node log-cli.js --task-id P2-006 --chosen ica --reason "free-tier offload"',
      '  node log-cli.js --task-id P2-006 --record ./routing-record.json --actual claude --fallback',
      '',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const args = {
    task_id: undefined,
    chosen: undefined,
    actual: undefined,
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
      case '--actual':
        args.actual = argv[++i];
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
  if (!chosen_plugin_id) {
    throw new Error('--chosen is required when --record does not contain chosen_plugin_id (see --help)');
  }

  const reason = args.reason !== undefined ? args.reason : (record && record.reason) || '';
  const actual_provider_used = args.actual || chosen_plugin_id;
  const fallback_applied = args.fallback || actual_provider_used !== chosen_plugin_id;

  const params = {
    task_id: args.task_id,
    chosen_plugin_id,
    actual_provider_used,
    fallback_applied,
    reason,
  };

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
    entry = appendEntry(params);
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
