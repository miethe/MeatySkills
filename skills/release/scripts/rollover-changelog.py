#!/usr/bin/env python3
"""Rollover the [Unreleased] section of a Keep-a-Changelog file to a versioned release.

Usage
-----
    python rollover-changelog.py --version 0.33.0 --date 2026-05-01
    python rollover-changelog.py --version 0.33.0 --date 2026-05-01 --dry-run
    python rollover-changelog.py --version 0.33.0 --date 2026-05-01 --json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

UNRELEASED_HEADING = "## [Unreleased]"
# Matches "## [X.Y.Z] - YYYY-MM-DD" (the canonical Keep-a-Changelog format)
_VERSION_HEADING_RE = re.compile(
    r"^## \[(\d+\.\d+\.\d+(?:[^\]]*)?)\] - (\d{4}-\d{2}-\d{2})", re.MULTILINE
)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Exit codes
EXIT_OK = 0
EXIT_ERROR = 2

# Status values for --json output
STATUS_ROLLED = "rolled"
STATUS_ALREADY_ROLLED = "already_rolled"
STATUS_EMPTY_ROLLOVER = "empty_rollover"
STATUS_ERROR = "error"


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class RolloverResult:
    status: str
    version: str
    date: str
    file: str
    message: str
    new_content: Optional[str] = field(default=None, repr=False)


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------


def _validate_date(date_str: str) -> None:
    """Raise ValueError if *date_str* is not YYYY-MM-DD."""
    if not _DATE_RE.match(date_str):
        raise ValueError(f"Date must be YYYY-MM-DD, got: {date_str!r}")
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"Invalid calendar date: {date_str!r}")


def _has_entries_between(
    content: str, unreleased_pos: int, next_section_pos: int
) -> bool:
    """Return True when there is at least one non-blank line between the
    [Unreleased] heading and the next ``## [`` heading (or end of file)."""
    between = content[unreleased_pos:next_section_pos]
    # Strip the heading line itself
    lines = between.splitlines()[1:]
    return any(line.strip() for line in lines)


def process_changelog(content: str, version: str, date: str) -> RolloverResult:
    """Analyse *content* and compute the rollover.

    Returns a :class:`RolloverResult` with *new_content* set when a write
    should be performed (``None`` when no change is needed).
    """
    new_heading = f"## [{version}] - {date}"

    # 1. Check if the target version is already present (idempotency guard).
    already_present = bool(
        re.search(
            rf"^## \[{re.escape(version)}\]",
            content,
            re.MULTILINE,
        )
    )

    # 2. Locate [Unreleased].
    unreleased_match = re.search(
        r"^## \[Unreleased\]",
        content,
        re.MULTILINE,
    )

    if unreleased_match is None:
        if already_present:
            return RolloverResult(
                status=STATUS_ALREADY_ROLLED,
                version=version,
                date=date,
                file="",
                message=(
                    f"Version [{version}] already present; "
                    "[Unreleased] section not found — nothing to do."
                ),
            )
        return RolloverResult(
            status=STATUS_ERROR,
            version=version,
            date=date,
            file="",
            message=(
                "No ## [Unreleased] section found and target version is absent. "
                "Cannot perform rollover."
            ),
        )

    # Idempotency: [Unreleased] exists but target version is already present too.
    if already_present:
        return RolloverResult(
            status=STATUS_ALREADY_ROLLED,
            version=version,
            date=date,
            file="",
            message=(
                f"Version [{version}] already present in changelog — nothing to do."
            ),
        )

    unreleased_start = unreleased_match.start()
    unreleased_end = unreleased_match.end()

    # Find the position of the *next* versioned heading after [Unreleased].
    next_version_match = _VERSION_HEADING_RE.search(content, unreleased_end)
    next_section_pos = (
        next_version_match.start() if next_version_match else len(content)
    )

    # 3. Detect empty [Unreleased] section.
    is_empty = not _has_entries_between(content, unreleased_start, next_section_pos)

    # 4. Build new content.
    #    Structure: ... <everything before [Unreleased]>
    #               ## [Unreleased]\n\n
    #               ## [X.Y.Z] - YYYY-MM-DD\n
    #               ... <everything from next_section_pos onward>
    before = content[:unreleased_start]
    after = content[next_section_pos:]

    # Preserve the block between [Unreleased] heading and next version section,
    # but strip leading blank lines (they'll be replaced by a single blank line
    # after the new [Unreleased] heading).
    existing_block = content[unreleased_end:next_section_pos]
    # Strip leading newlines from the block; keep trailing.
    existing_block_stripped = existing_block.lstrip("\n")

    new_content = (
        before
        + UNRELEASED_HEADING
        + "\n\n"
        + new_heading
        + "\n"
        + existing_block_stripped
        + after
    )

    status = STATUS_EMPTY_ROLLOVER if is_empty else STATUS_ROLLED
    message = (
        f"Rolled [Unreleased] → [{version}] - {date}."
        if not is_empty
        else (
            f"WARNING: [Unreleased] section was empty; "
            f"rolled to [{version}] - {date} anyway."
        )
    )

    return RolloverResult(
        status=status,
        version=version,
        date=date,
        file="",
        message=message,
        new_content=new_content,
    )


def run(args: argparse.Namespace) -> int:
    """Execute the rollover based on parsed *args*. Returns an exit code."""
    # Validate date format early.
    try:
        _validate_date(args.date)
    except ValueError as exc:
        _emit_error(args, str(exc), args.version, args.date, str(args.file))
        return EXIT_ERROR

    changelog_path = Path(args.file)
    try:
        content = changelog_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        _emit_error(
            args,
            f"Changelog file not found: {changelog_path}",
            args.version,
            args.date,
            str(changelog_path),
        )
        return EXIT_ERROR

    result = process_changelog(content, args.version, args.date)
    result.file = str(changelog_path)

    if result.status == STATUS_ERROR:
        _emit_result(args, result)
        return EXIT_ERROR

    if result.status == STATUS_ALREADY_ROLLED:
        _emit_result(args, result)
        return EXIT_OK

    # STATUS_ROLLED or STATUS_EMPTY_ROLLOVER — a write is needed.
    assert result.new_content is not None

    if args.dry_run:
        _emit_dry_run(args, result)
        return EXIT_OK

    # Atomic write: write to .tmp then replace.
    tmp_path = changelog_path.with_suffix(changelog_path.suffix + ".tmp")
    try:
        tmp_path.write_text(result.new_content, encoding="utf-8")
        os.replace(tmp_path, changelog_path)
    except OSError as exc:
        tmp_path.unlink(missing_ok=True)
        _emit_error(
            args,
            f"Failed to write changelog: {exc}",
            args.version,
            args.date,
            str(changelog_path),
        )
        return EXIT_ERROR

    _emit_result(args, result)
    return EXIT_OK


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------


def _emit_result(args: argparse.Namespace, result: RolloverResult) -> None:
    if args.json:
        payload = {
            "status": result.status,
            "version": result.version,
            "date": result.date,
            "file": result.file,
            "message": result.message,
        }
        print(json.dumps(payload))
        if result.status in (STATUS_EMPTY_ROLLOVER,):
            print(f"WARNING: {result.message}", file=sys.stderr)
    else:
        if result.status == STATUS_ERROR:
            print(f"ERROR: {result.message}", file=sys.stderr)
        elif result.status in (STATUS_ALREADY_ROLLED, STATUS_EMPTY_ROLLOVER):
            print(f"WARN: {result.message}", file=sys.stderr)
        else:
            print(result.message)


def _emit_dry_run(args: argparse.Namespace, result: RolloverResult) -> None:
    if args.json:
        payload = {
            "status": result.status,
            "version": result.version,
            "date": result.date,
            "file": result.file,
            "message": f"[dry-run] {result.message}",
            "diff_preview": result.new_content,
        }
        print(json.dumps(payload))
    else:
        print(f"[dry-run] {result.message}")
        print("--- intended new content (first 40 lines) ---", file=sys.stderr)
        lines = (result.new_content or "").splitlines()
        for line in lines[:40]:
            print(line, file=sys.stderr)
        if len(lines) > 40:
            print(f"... ({len(lines) - 40} more lines)", file=sys.stderr)


def _emit_error(
    args: argparse.Namespace,
    message: str,
    version: str,
    date: str,
    file: str,
) -> None:
    if args.json:
        payload = {
            "status": STATUS_ERROR,
            "version": version,
            "date": date,
            "file": file,
            "message": message,
        }
        print(json.dumps(payload))
    print(f"ERROR: {message}", file=sys.stderr)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Roll over [Unreleased] section in a Keep-a-Changelog file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--version",
        required=True,
        metavar="X.Y.Z",
        help="Target version string (e.g. 0.33.0)",
    )
    parser.add_argument(
        "--date",
        required=True,
        metavar="YYYY-MM-DD",
        help="Release date in YYYY-MM-DD format",
    )
    parser.add_argument(
        "--file",
        default="CHANGELOG.md",
        metavar="PATH",
        help="Path to the changelog file (default: CHANGELOG.md)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON to stdout; human messages go to stderr",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print intended changes without modifying the file",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    """Entry point; returns exit code."""
    parser = build_parser()
    args = parser.parse_args(argv)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
