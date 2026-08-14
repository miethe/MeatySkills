#!/usr/bin/env python3
# Stop hook — drain workflow routing_log payloads into .claude/logs/routing-decisions.jsonl.
#
# WHY THIS EXISTS
#   The delegation-router `withRouting()` helper (deployed in every workflow via the fleet sync)
#   puts a `routing_log` array into each workflow's RETURN ENVELOPE. Nothing consumed it: the wire
#   (producer) landed, the sink (consumer) never did, and the consumer's own node was closed on the
#   producer half anyway (node_01KZVV9R3EK13DJXS44VCQ8E9C → reopened as
#   node_01KZYDYVAD8N82NHZMTEKR7YH2). `_routing_log` has 14 write sites and 0 consumers; an empty
#   `skillmeat routing audit` reads as "clean" when it actually means "nothing was ever ingested".
#   This hook is that missing consumer.
#
# WHY A Stop HOOK, NOT PostToolUse/Workflow
#   Workflows ALWAYS run in the background here. A background tool's PostToolUse fires at LAUNCH
#   with status "async_launched" and NO result (Claude Code hooks ref, verified 2026-08-14), so a
#   PostToolUse/Workflow hook would never see `routing_log` — it would be inert, the exact trap this
#   node exists to end. The workflow's returned envelope reaches only the orchestrator, landing in
#   the main-session transcript as a <task-notification> block that names the completed run's
#   <output-file> (a clean JSON carrying .result.routing_log) and its <task-id>. Stop fires once per
#   turn on claude-primary and is HANDED transcript_path, so it is the one automatic carrier with
#   access to the envelope. The write lands on claude-primary, where it belongs (workflow scripts
#   cannot do FS work — four-constraints).
#
# CONTRACT
#   stdin : Stop hook JSON {transcript_path, session_id, cwd, ...}. Also accepts --transcript <path>
#           for testing without the harness.
#   writes: appends to <repo>/.claude/logs/routing-decisions.jsonl VIA the deployed
#           delegation-router log-cli.js --ingest (constraint 7: never re-implement the writer).
#           Idempotent across turns via a ledger of already-ingested task ids
#           (<repo>/.claude/logs/.routing-ingested.json).
#   stdout: {"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"…"}} ONLY when it
#           ingested at least one new run. Silent otherwise.
#   stderr: ONE summary line when payloads were found but could not be written (writer absent, or
#           log-cli non-zero). Deliberately NOT silent — see the `unwritten` branch in main().
#   exit  : ALWAYS 0. Every failure path (no python fields, unreadable transcript, missing node,
#           unreadable .output, log-cli error) degrades to a warning or silence — a routing-audit
#           sink must never block a turn from completing. No network, no model call.
#
# DEPLOYMENT
#   Upstream source of record: `agentic_meta_dev/infra/hooks/routing-log-sink.py` (the same lane as
#   `finding_filing_check.sh`; see docs/ARTIFACT-UPSTREAM-REGISTRY.md). It is registered in SkillMeat
#   as `hook:routing-log-sink` and deployed per-project to `<repo>/.claude/hooks/`, with the Stop
#   registration in that project's `.claude/settings.json`. Edit the upstream, never a deployed copy.
#
#   It needs the `delegation-router` skill deployed in the same project — that is where the
#   log-cli.js/audit-log.js writer lives. Without it the hook warns (above) rather than no-oping.
#
#   Repo root comes from CLAUDE_PROJECT_DIR, then `git rev-parse --show-toplevel`, then a path
#   heuristic — so the file works from either deploy depth. It is NOT inferred from directory depth
#   alone: upstream sits at <repo>/infra/hooks/ and the deployment at <repo>/.claude/hooks/, and
#   relying on both being two levels deep was a coincidence, not a contract.

import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def _repo_root():
    """The project this sink writes into.

    Resolution order matters, because this file is deployed to more than one depth: the upstream
    source of record is `<repo>/infra/hooks/`, while a SkillMeat deployment lands it at
    `<repo>/.claude/hooks/`. Both happen to be two levels deep, so the old
    dirname(dirname(HERE)) worked by coincidence — not a property to rely on in a fleet artifact
    that any repo may place anywhere.

    `CLAUDE_PROJECT_DIR` is exported into every hook process by Claude Code and names the project
    root directly, so it is authoritative when present. `git rev-parse --show-toplevel` is the
    fallback for a manual/test invocation; the path heuristic is the last resort.
    """
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env and os.path.isdir(env):
        return os.path.abspath(env)
    try:
        out = subprocess.run(
            ["git", "-C", HERE, "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except Exception:
        pass
    return os.path.dirname(os.path.dirname(HERE))


REPO_ROOT = _repo_root()
LOG_CLI = os.path.join(REPO_ROOT, ".claude", "skills", "delegation-router", "log-cli.js")
LOG_PATH = os.path.join(REPO_ROOT, ".claude", "logs", "routing-decisions.jsonl")
LEDGER = os.path.join(REPO_ROOT, ".claude", "logs", ".routing-ingested.json")

# A completed workflow notification, verbatim from the transcript. The block names both the
# absolute output-file and the task id; we read the file (clean JSON) rather than un-escaping the
# inline <result>.
_NOTIF = re.compile(
    r"<task-notification>(?P<body>.*?)</task-notification>", re.DOTALL
)
_TASK_ID = re.compile(r"<task-id>\s*([^<\s]+)\s*</task-id>")
_OUTFILE = re.compile(r"<output-file>\s*([^<\s]+\.output)\s*</output-file>")
_STATUS = re.compile(r"<status>\s*([^<\s]+)\s*</status>")
# Launch tool_result pairs a Task ID with a workflow Run ID; used for provenance so the logged
# task_id is the wf_ run id when it can be recovered, falling back to the ephemeral task id.
# Task ids are bare alphanumerics and run ids are `wf_<alnum-dash>`; both character classes stop
# at the escaped `\n` that separates the lines in the transcript's JSON-encoded tool_result (a
# broad `\S+` would swallow the literal backslash-n and never match the run id — measured
# 2026-08-14).
_LAUNCH_PAIR = re.compile(r"Task ID:\s*([A-Za-z0-9]+).*?Run ID:\s*(wf_[A-Za-z0-9-]+)", re.DOTALL)


def _read_ledger():
    try:
        with open(LEDGER, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        seen = data.get("ingested_task_ids")
        return set(seen) if isinstance(seen, list) else set()
    except Exception:
        return set()


def _write_ledger(seen):
    try:
        os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
        with open(LEDGER, "w", encoding="utf-8") as fh:
            json.dump({"ingested_task_ids": sorted(seen)}, fh, indent=2)
    except Exception:
        pass  # non-fatal: a lost ledger risks a duplicate, never a lost turn


def _load_transcript_text(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    except Exception:
        return None


def _task_to_run_map(text):
    out = {}
    for tid, rid in _LAUNCH_PAIR.findall(text):
        out.setdefault(tid, rid)
    return out


def _completed_workflow_runs(text):
    """Yield (task_id, output_file) for completed notifications that carry routing_log."""
    for m in _NOTIF.finditer(text):
        body = m.group("body")
        if "routing_log" not in body:
            continue
        st = _STATUS.search(body)
        if not st or st.group(1) != "completed":
            continue
        tid = _TASK_ID.search(body)
        of = _OUTFILE.search(body)
        if not tid or not of:
            continue
        yield tid.group(1), of.group(1)


def _routing_log_from_output(output_file):
    try:
        with open(output_file, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return None
    result = data.get("result")
    if not isinstance(result, dict):
        return None
    rl = result.get("routing_log")
    return rl if isinstance(rl, list) and rl else None


def _ingest(routing_log, log_task_id):
    """Hand the routing_log to the deployed log-cli.js --ingest. Returns True on a clean write."""
    if not os.path.isfile(LOG_CLI):
        return False  # main() reports this once per invocation, not once per run
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(prefix="routing-log-sink-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"routing_log": routing_log}, fh)
        proc = subprocess.run(
            ["node", LOG_CLI, "--ingest", tmp, "--task-id", log_task_id,
             "--log-path", LOG_PATH],
            capture_output=True, text=True, timeout=30,
        )
        return proc.returncode == 0
    except Exception:
        return False
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.remove(tmp)
            except Exception:
                pass


def main():
    transcript_path = None
    argv = sys.argv[1:]
    if "--transcript" in argv:
        i = argv.index("--transcript")
        if i + 1 < len(argv):
            transcript_path = argv[i + 1]
    if not transcript_path:
        raw = ""
        try:
            raw = sys.stdin.read()
        except Exception:
            raw = ""
        if raw.strip():
            try:
                transcript_path = (json.loads(raw) or {}).get("transcript_path")
            except Exception:
                transcript_path = None
    if not transcript_path or not os.path.isfile(transcript_path):
        return 0

    text = _load_transcript_text(transcript_path)
    if not text or "routing_log" not in text:
        return 0

    seen = _read_ledger()
    run_map = _task_to_run_map(text)

    newly = 0
    unwritten = 0
    for task_id, output_file in _completed_workflow_runs(text):
        if task_id in seen:
            continue
        routing_log = _routing_log_from_output(output_file)
        if routing_log is None:
            # No usable payload (empty/absent/unreadable). Mark processed so we do not re-open the
            # unreadable file every turn; a genuinely missing file just yields nothing.
            seen.add(task_id)
            continue
        log_task_id = run_map.get(task_id, task_id)
        if _ingest(routing_log, log_task_id):
            seen.add(task_id)
            newly += 1
        else:
            # NOT added to `seen`: an un-ingested payload must stay pending so it lands once the
            # writer is provisioned, rather than being silently consumed now.
            unwritten += len(routing_log)

    if unwritten:
        # LOUD, once per invocation. A missing writer while payloads are waiting is the precise
        # failure this sink exists to end — an empty routing-decisions.jsonl that reads as "clean"
        # when it means "nothing was ever ingested". Silence here would reproduce that one layer
        # out, in any repo that deployed this hook without the delegation-router skill.
        hint = (
            f"the writer is absent at {LOG_CLI} — provision it with: skillmeat deploy "
            f"delegation-router --type skill --project {REPO_ROOT}"
            if not os.path.isfile(LOG_CLI)
            else f"log-cli.js exited non-zero (see {LOG_CLI})"
        )
        sys.stderr.write(
            f"[routing-log-sink] {unwritten} routing decision(s) NOT logged: {hint}\n"
        )

    if newly:
        _write_ledger(seen)
        msg = (
            f"[routing-log-sink] ingested {newly} workflow routing decision(s) into "
            f".claude/logs/routing-decisions.jsonl"
        )
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "Stop",
                "additionalContext": msg,
            }
        }))
    else:
        # Persist any task ids we marked processed-but-empty so we do not rescan them forever.
        _write_ledger(seen)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Absolute backstop: a sink must never fail a turn.
        sys.exit(0)
