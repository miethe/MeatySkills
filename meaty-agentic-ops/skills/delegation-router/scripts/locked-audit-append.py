#!/usr/bin/env python3
"""Serialize canonical JSONL audit appends and native-intent deduplication.

Requires Python 3 and POSIX ``fcntl.flock``. The adjacent lock file is only a
crash-released mutex; the canonical routing ledger remains the sole dedup store.
"""

import fcntl
import json
import os
import sys
from pathlib import Path


def fail(code: str) -> int:
    sys.stderr.write(code + "\n")
    return 2


def same_intent(old: dict, new: dict) -> bool:
    old_record = old.get("routing_record")
    new_record = new.get("routing_record")
    if not isinstance(old_record, dict) or not isinstance(new_record, dict):
        return False
    return (
        old.get("task_id") == new.get("task_id")
        and old.get("chosen_plugin_id") == new.get("chosen_plugin_id")
        and old.get("intended_model") == new.get("intended_model")
        and old_record.get("effort") == new_record.get("effort")
        and old.get("reason") == new.get("reason")
    )


def read_ledger(path: Path) -> list[dict]:
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return []
    except OSError:
        raise ValueError("ledger_unreadable") from None
    if not raw:
        return []
    if not raw.endswith(b"\n"):
        raise ValueError("ledger_partial_line")
    rows = []
    for line in raw.splitlines():
        if not line:
            raise ValueError("ledger_malformed")
        try:
            row = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("ledger_malformed") from None
        if not isinstance(row, dict):
            raise ValueError("ledger_malformed")
        rows.append(row)
    return rows


def main() -> int:
    if len(sys.argv) != 3:
        return fail("invalid_arguments")
    ledger = Path(sys.argv[1])
    native_key = sys.argv[2] or None
    try:
        entry = json.load(sys.stdin)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return fail("entry_malformed")
    if not isinstance(entry, dict):
        return fail("entry_malformed")

    try:
        ledger.parent.mkdir(parents=True, exist_ok=True)
        lock_path = ledger.with_name(ledger.name + ".lock")
        with lock_path.open("a+b") as lock:
            os.chmod(lock_path, 0o600)
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            rows = read_ledger(ledger)
            if native_key:
                matches = [
                    row for row in rows
                    if row.get("kind") == "decision"
                    and (row.get("native_event_key") == native_key or row.get("task_id") == native_key)
                ]
                if matches:
                    if len(matches) != 1 or not same_intent(matches[0], entry):
                        return fail("native_intent_conflict")
                    sys.stdout.write('{"status":"duplicate"}\n')
                    return 0
            payload = (json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
            fd = os.open(ledger, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            try:
                os.fchmod(fd, 0o600)
                written = 0
                while written < len(payload):
                    count = os.write(fd, payload[written:])
                    if count <= 0:
                        raise OSError("nonprogressing_write")
                    written += count
                os.fsync(fd)
            finally:
                os.close(fd)
            if native_key:
                sys.stdout.write('{"status":"written"}\n')
            return 0
    except ValueError as exc:
        return fail(str(exc))
    except OSError:
        return fail("ledger_write_failed")


if __name__ == "__main__":
    raise SystemExit(main())
