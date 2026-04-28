#!/usr/bin/env python3
"""audit-coverage.py — Verify CHANGELOG [Unreleased] covers all user-facing commits.

Checks that every reportable commit between two git refs appears in the
[Unreleased] section of CHANGELOG.md (matched by short SHA or subject substring).

Skip patterns are hardcoded below; for the authoritative list see:
  .claude/specs/changelog-spec.md

Exit codes:
  0 — no gaps (all reportable commits present or all skipped)
  1 — gaps found (normal mode)
  2 — strict mode AND gaps found, OR execution error
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# Conventional Commit prefixes that are REPORTABLE (user-facing).
# Source of truth: .claude/specs/changelog-spec.md
REPORTABLE_PREFIXES = {
    "feat",
    "fix",
    "perf",
    "security",
    "revert",
    "deprecate",
    "remove",
}

# Prefixes to SKIP (not user-facing / infrastructure).
SKIP_PREFIXES = {
    "refactor",
    "test",
    "docs",
    "chore",
    "ci",
    "build",
    "style",
    "merge",
}


def parse_args(argv=None):
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(
        description="Audit CHANGELOG [Unreleased] coverage for commits between two git refs."
    )
    parser.add_argument(
        "--from-tag",
        required=True,
        metavar="REF",
        help="Start ref (exclusive), e.g. v0.32.0",
    )
    parser.add_argument(
        "--to-ref",
        default="HEAD",
        metavar="REF",
        help="End ref (inclusive), default: HEAD",
    )
    parser.add_argument(
        "--changelog",
        default="CHANGELOG.md",
        metavar="PATH",
        help="Path to CHANGELOG.md (default: CHANGELOG.md)",
    )
    parser.add_argument(
        "--spec",
        default=".claude/specs/changelog-spec.md",
        metavar="PATH",
        help="Path to changelog spec (informational only in v1)",
    )
    parser.add_argument(
        "--json",
        dest="json_output",
        action="store_true",
        help="Emit JSON to stdout; human output goes to stderr",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit 2 (instead of 1) when gaps are found",
    )
    return parser.parse_args(argv)


def get_commits(from_tag, to_ref):
    """Run git log and return list of (full_sha, subject) tuples.

    Uses --no-merges to skip merge commits.
    Raises RuntimeError on git failure.
    """
    cmd = [
        "git",
        "log",
        "--no-merges",
        "--pretty=format:%H\t%s",
        f"{from_tag}..{to_ref}",
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        raise RuntimeError("git executable not found")

    if result.returncode != 0:
        raise RuntimeError(
            f"git log failed (exit {result.returncode}): {result.stderr.strip()}"
        )

    commits = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t", 1)
        if len(parts) == 2:
            commits.append((parts[0], parts[1]))
        else:
            commits.append((parts[0], ""))
    return commits


def categorize_commit(subject):
    """Categorize a commit subject by its Conventional Commit prefix.

    Returns (category, is_reportable, warning_message_or_None).
    - category: the prefix string, or "unknown" when no prefix detected
    - is_reportable: True if this commit should appear in CHANGELOG
    - warning: non-empty string if the commit has no recognised prefix
    """
    # Match "type(scope)!: ..." or "type!: ..." or "type: ..."
    match = re.match(r"^([a-zA-Z]+)(?:\([^)]*\))?!?:\s+", subject)
    if not match:
        return "unknown", True, f"No Conventional Commit prefix: {subject!r}"

    prefix = match.group(1).lower()
    if prefix in REPORTABLE_PREFIXES:
        return prefix, True, None
    if prefix in SKIP_PREFIXES:
        return prefix, False, None
    # Unrecognised prefix — treat as reportable with a warning
    return prefix, True, f"Unknown prefix {prefix!r} in: {subject!r}"


def extract_unreleased_section(changelog_path):
    """Return the text of the [Unreleased] section from CHANGELOG.md.

    Returns empty string if the section is absent or empty.
    Raises FileNotFoundError if the file does not exist.
    """
    text = Path(changelog_path).read_text(encoding="utf-8")
    # Match from "## [Unreleased]" to the next "## [" heading (or EOF)
    match = re.search(
        r"##\s+\[Unreleased\](.*?)(?=\n##\s+\[|\Z)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    if not match:
        return ""
    return match.group(1)


def normalize_subject(subject):
    """Produce a normalised search token from a commit subject.

    Strips the CC prefix and scope, lowercases, takes first 40 chars.
    """
    # Strip "type(scope)!: " prefix if present
    stripped = re.sub(r"^[a-zA-Z]+(?:\([^)]*\))?!?:\s+", "", subject)
    return stripped.lower()[:40]


def check_coverage(commits, unreleased_text):
    """Check each commit against the unreleased changelog section.

    Returns list of dicts:
      {sha, short_sha, subject, category, is_reportable, matched, warning}
    """
    results = []
    # Lowercase the whole section once for fast substring search
    unreleased_lower = unreleased_text.lower()

    for full_sha, subject in commits:
        short_sha = full_sha[:7]
        category, is_reportable, warning = categorize_commit(subject)

        matched = False
        if is_reportable:
            # Match by short SHA
            if short_sha.lower() in unreleased_lower:
                matched = True
            else:
                # Match by normalised subject substring
                needle = normalize_subject(subject)
                if needle and needle in unreleased_lower:
                    matched = True

        results.append(
            {
                "sha": full_sha,
                "short_sha": short_sha,
                "subject": subject,
                "category": category,
                "is_reportable": is_reportable,
                "matched": matched,
                "warning": warning,
            }
        )
    return results


def format_report(results, from_tag, to_ref):
    """Return a plain-text ASCII table report string."""
    col_sha = 8
    col_cat = 10
    col_status = 8
    col_subject = 60

    def row(sha, cat, status, subject):
        subject_trunc = subject[:col_subject]
        return (
            f"{sha:<{col_sha}}  "
            f"{cat:<{col_cat}}  "
            f"{status:<{col_status}}  "
            f"{subject_trunc}"
        )

    separator = "-" * (col_sha + col_cat + col_status + col_subject + 6)
    header = row("SHA", "CATEGORY", "STATUS", "SUBJECT")

    lines = [
        f"Audit: {from_tag}..{to_ref}",
        separator,
        header,
        separator,
    ]

    for r in results:
        if not r["is_reportable"]:
            status = "SKIP"
        elif r["matched"]:
            status = "OK"
        else:
            status = "GAP"
        lines.append(row(r["short_sha"], r["category"], status, r["subject"]))

    lines.append(separator)
    return "\n".join(lines)


def build_json_output(results, from_tag, to_ref, status_str):
    """Build the JSON output dict."""
    reportable = [r for r in results if r["is_reportable"]]
    matched = [r for r in reportable if r["matched"]]
    gaps = [r for r in reportable if not r["matched"]]
    skipped = [r for r in results if not r["is_reportable"]]

    return {
        "status": status_str,
        "from": from_tag,
        "to": to_ref,
        "total_commits": len(results),
        "reportable": len(reportable),
        "matched": len(matched),
        "gaps": [
            {"sha": r["short_sha"], "subject": r["subject"], "category": r["category"]}
            for r in gaps
        ],
        "skipped": len(skipped),
    }


def main(argv=None):
    args = parse_args(argv)

    out = sys.stdout if not args.json_output else sys.stderr
    json_out = sys.stdout if args.json_output else None

    # --- Collect commits ---
    try:
        commits = get_commits(args.from_tag, args.to_ref)
    except RuntimeError as exc:
        msg = f"ERROR: {exc}\n"
        if args.json_output:
            json.dump({"status": "error", "error": str(exc)}, json_out)
            json_out.write("\n")
        else:
            sys.stderr.write(msg)
        return 2

    # --- Load changelog ---
    changelog_path = Path(args.changelog)
    try:
        unreleased_text = extract_unreleased_section(changelog_path)
    except FileNotFoundError:
        msg = f"ERROR: CHANGELOG not found: {changelog_path}\n"
        if args.json_output:
            json.dump({"status": "error", "error": msg.strip()}, json_out)
            json_out.write("\n")
        else:
            sys.stderr.write(msg)
        return 2

    # --- Analyse coverage ---
    results = check_coverage(commits, unreleased_text)

    # --- Emit warnings ---
    for r in results:
        if r["warning"]:
            out.write(f"WARNING: {r['warning']}\n")

    # --- Determine status ---
    gaps = [r for r in results if r["is_reportable"] and not r["matched"]]
    has_gaps = bool(gaps)
    status_str = "gaps_found" if has_gaps else "clean"

    # --- Human report ---
    report = format_report(results, args.from_tag, args.to_ref)
    out.write(report + "\n")

    reportable_count = sum(1 for r in results if r["is_reportable"])
    matched_count = sum(1 for r in results if r["is_reportable"] and r["matched"])
    out.write(
        f"\nSummary: {len(results)} commits, "
        f"{reportable_count} reportable, "
        f"{matched_count} matched, "
        f"{len(gaps)} gap(s).\n"
    )

    # --- JSON output ---
    if args.json_output:
        payload = build_json_output(results, args.from_tag, args.to_ref, status_str)
        json.dump(payload, json_out, indent=2)
        json_out.write("\n")

    # --- Exit code ---
    if has_gaps:
        return 2 if args.strict else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
