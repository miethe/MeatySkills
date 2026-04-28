#!/usr/bin/env python3
"""
Update task status in progress file YAML frontmatter.

This script surgically updates a single task's status in a progress file without
loading the full markdown body, preserving all formatting and content.

Usage:
    python update-status.py --file .claude/progress/prd/phase-1-progress.md --task TASK-1.3 --status complete
    python update-status.py --file .claude/progress/prd/phase-1-progress.md --task TASK-1.3 --status blocked --note "Waiting on API"
    python update-status.py -f FILE -t TASK-1 -s completed --started 2026-04-22T10:00Z --completed 2026-04-22T17:00Z --evidence "commit:abc123" --verified-by P16-003
    python update-status.py -f FILE -t TASK-1 -s completed --force
"""

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml


def extract_frontmatter_and_body(filepath: Path) -> Tuple[Optional[Dict[str, Any]], str]:
    """
    Extract YAML frontmatter and markdown body separately.

    Args:
        filepath: Path to progress file

    Returns:
        Tuple of (frontmatter dict, markdown body string)
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        # Check if content starts with frontmatter delimiter
        if not content.strip().startswith('---'):
            print(f"Error: File does not contain YAML frontmatter", file=sys.stderr)
            return None, ""

        # Find the closing delimiter (second ---)
        match = re.match(r'^---\n(.*?\n)---\n(.*)$', content, re.DOTALL)
        if not match:
            print(f"Error: Could not parse YAML frontmatter", file=sys.stderr)
            return None, ""

        frontmatter_str = match.group(1)
        body = match.group(2)

        frontmatter = yaml.safe_load(frontmatter_str)
        return frontmatter, body

    except Exception as e:
        print(f"Error: Could not read {filepath}: {e}", file=sys.stderr)
        return None, ""


def write_frontmatter_and_body(
    filepath: Path,
    frontmatter: Dict[str, Any],
    body: str
) -> None:
    """
    Write updated frontmatter and preserved body back to file.

    Args:
        filepath: Path to progress file
        frontmatter: Updated frontmatter dictionary
        body: Preserved markdown body
    """
    try:
        # Dump frontmatter to YAML string
        frontmatter_yaml = yaml.dump(
            frontmatter,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False
        )

        # Write file with frontmatter delimiters
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write('---\n')
            f.write(frontmatter_yaml)
            f.write('---\n')
            f.write(body)

    except Exception as e:
        print(f"Error: Could not write to {filepath}: {e}", file=sys.stderr)
        raise


def recalculate_metrics(frontmatter: Dict[str, Any]) -> Dict[str, Any]:
    """
    Recalculate progress metrics based on task statuses.

    Args:
        frontmatter: Progress file frontmatter dictionary

    Returns:
        Updated frontmatter with recalculated metrics
    """
    tasks = frontmatter.get('tasks', [])
    if not tasks:
        frontmatter['updated'] = datetime.now().strftime('%Y-%m-%d')
        return frontmatter

    # Count tasks by status
    completed = sum(1 for t in tasks if t.get('status') == 'completed')
    in_progress = sum(1 for t in tasks if t.get('status') == 'in_progress')
    blocked = sum(1 for t in tasks if t.get('status') == 'blocked')
    at_risk = sum(1 for t in tasks if t.get('status') == 'at_risk')
    pending = sum(1 for t in tasks if t.get('status') == 'pending')

    total = len(tasks)

    # Calculate overall progress percentage
    progress = int((completed / total) * 100) if total > 0 else 0

    # Update frontmatter metrics
    frontmatter['total_tasks'] = total
    frontmatter['completed_tasks'] = completed
    frontmatter['in_progress_tasks'] = in_progress
    frontmatter['blocked_tasks'] = blocked
    frontmatter['progress'] = progress

    # Update phase status based on progress
    if progress == 100:
        frontmatter['status'] = 'completed'
    elif blocked > 0 or at_risk > 0:
        frontmatter['status'] = 'at_risk'
    elif in_progress > 0:
        frontmatter['status'] = 'in_progress'
    else:
        frontmatter['status'] = 'pending'

    # Update timestamp
    frontmatter['updated'] = datetime.now().strftime('%Y-%m-%d')

    return frontmatter


def parse_evidence_item(raw: str) -> Dict[str, str]:
    """
    Parse an evidence string into a structured dict.

    Accepts:
      - "key:value"  → {key: value}
      - plain text   → {"note": text}

    Examples:
      "commit:abc123"      → {"commit": "abc123"}
      "screenshot:path"    → {"screenshot": "path"}
      "test:path/to.test"  → {"test": "path/to.test"}
      "plain description"  → {"note": "plain description"}
    """
    if ':' in raw:
        key, _, value = raw.partition(':')
        key = key.strip()
        value = value.strip()
        if key and value:
            return {key: value}
    return {"note": raw.strip()}


def update_task_status(
    filepath: Path,
    task_id: str,
    status: str,
    note: Optional[str] = None,
    started: Optional[str] = None,
    completed_ts: Optional[str] = None,
    evidence: Optional[List[str]] = None,
    verified_by: Optional[List[str]] = None,
    force: bool = False,
) -> Tuple[int, int]:
    """
    Update status of a single task in progress file.

    When status is 'completed', both --started and --completed timestamps must
    be supplied (or at least --evidence), unless --force is given.

    Args:
        filepath: Path to progress file
        task_id: Task identifier (e.g., "TASK-1.3")
        status: New status value
        note: Optional note to add to task
        started: ISO-8601 timestamp for task start
        completed_ts: ISO-8601 timestamp for task completion
        evidence: List of evidence strings (key:value or plain)
        verified_by: List of verifier IDs
        force: Skip completion timestamp requirement (logs WARNING)

    Returns:
        Tuple of (old_progress, new_progress) percentages

    Raises:
        ValueError: If task not found, invalid status, or completion gate fails
        FileNotFoundError: If file doesn't exist
    """
    # Validate status
    valid_statuses = ['pending', 'in_progress', 'completed', 'blocked', 'at_risk',
                      'skipped', 'deferred', 'deviated', 'partial', 'superseded']
    if status not in valid_statuses:
        raise ValueError(f"Invalid status '{status}'. Must be one of: {', '.join(valid_statuses)}")

    # Completion gate: require timestamps (or evidence) unless --force
    if status == 'completed':
        has_timestamps = started is not None and completed_ts is not None
        has_evidence = evidence and len(evidence) > 0
        if not has_timestamps and not has_evidence:
            if force:
                print(
                    f"WARNING: Marking {task_id} completed without started/completed timestamps "
                    f"or evidence. Use --started and --completed for proper tracking.",
                    file=sys.stderr,
                )
            else:
                raise ValueError(
                    f"Cannot mark task '{task_id}' completed without timing signals. "
                    f"Provide --started and --completed timestamps, or --evidence, "
                    f"or use --force to override (logs a warning)."
                )

    # Check file exists
    if not filepath.exists():
        raise FileNotFoundError(f"File not found: {filepath}")

    # Extract frontmatter and body
    frontmatter, body = extract_frontmatter_and_body(filepath)
    if frontmatter is None:
        raise ValueError("Could not extract frontmatter from file")

    # Get current progress
    old_progress = frontmatter.get('progress', 0)

    # Find and update task
    tasks = frontmatter.get('tasks', [])
    task_found = False

    for task in tasks:
        if task.get('id') == task_id:
            task['status'] = status
            if note:
                task['note'] = note
            if started is not None:
                task['started'] = started
            if completed_ts is not None:
                task['completed'] = completed_ts
            if evidence:
                existing_evidence = task.get('evidence', [])
                if not isinstance(existing_evidence, list):
                    existing_evidence = []
                for raw in evidence:
                    existing_evidence.append(parse_evidence_item(raw))
                task['evidence'] = existing_evidence
            if verified_by:
                existing_vb = task.get('verified_by', [])
                if not isinstance(existing_vb, list):
                    existing_vb = []
                for vb in verified_by:
                    if vb not in existing_vb:
                        existing_vb.append(vb)
                task['verified_by'] = existing_vb
            task_found = True
            break

    if not task_found:
        raise ValueError(f"Task '{task_id}' not found in {filepath}")

    # Recalculate metrics
    frontmatter = recalculate_metrics(frontmatter)
    new_progress = frontmatter.get('progress', 0)

    # Write back to file
    write_frontmatter_and_body(filepath, frontmatter, body)

    return old_progress, new_progress


def main():
    """Main entry point for update-status script."""
    parser = argparse.ArgumentParser(
        description="Update task status in progress file",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Mark task as complete with timing
  python update-status.py -f .claude/progress/prd/phase-1-progress.md -t TASK-1.3 -s completed \\
      --started 2026-04-22T10:00Z --completed 2026-04-22T17:00Z

  # Mark complete with evidence
  python update-status.py -f FILE -t TASK-1 -s completed \\
      --evidence "commit:abc123" --evidence "test:path/to.test.tsx" \\
      --verified-by P16-003 --verified-by P16-012-smoke

  # Force complete without timestamps (logs WARNING)
  python update-status.py -f FILE -t TASK-1 -s completed --force

  # Mark task as blocked with note
  python update-status.py -f FILE -t TASK-1.3 -s blocked --note "Waiting on API"

  # Start working on task
  python update-status.py -f FILE -t TASK-1.3 -s in_progress --started 2026-04-22T09:00Z

Valid statuses: pending, in_progress, completed, blocked, at_risk, skipped, deferred, deviated, partial, superseded
        """
    )

    parser.add_argument('--file', '-f', type=Path, required=True, help='Path to progress file')
    parser.add_argument('--task', '-t', required=True, help='Task ID to update (e.g., TASK-1.3)')
    parser.add_argument(
        '--status', '-s', required=True,
        choices=['pending', 'in_progress', 'completed', 'blocked', 'at_risk',
                 'skipped', 'deferred', 'deviated', 'partial', 'superseded'],
        help='New status for the task',
    )
    parser.add_argument('--note', '-n', help='Optional note to add to the task')
    parser.add_argument(
        '--started',
        help='ISO-8601 timestamp when task was started (e.g. 2026-04-22T10:00Z). '
             'Required with --completed when marking completed.',
    )
    parser.add_argument(
        '--completed',
        dest='completed_ts',
        help='ISO-8601 timestamp when task was completed. '
             'Required with --started when marking completed.',
    )
    parser.add_argument(
        '--evidence',
        action='append',
        default=[],
        metavar='KEY:VALUE',
        help='Evidence item (repeatable). Format: "commit:abc123", "screenshot:path", '
             '"test:path/to.test.tsx", or plain text. Appends to task evidence list.',
    )
    parser.add_argument(
        '--verified-by',
        action='append',
        default=[],
        dest='verified_by',
        metavar='TASK_ID',
        help='Verifier task ID (repeatable). Appends to task verified_by list.',
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Allow marking completed without timestamps (logs WARNING to stderr).',
    )

    args = parser.parse_args()

    try:
        old_progress, new_progress = update_task_status(
            args.file,
            args.task,
            args.status,
            note=args.note,
            started=args.started,
            completed_ts=args.completed_ts,
            evidence=args.evidence or None,
            verified_by=args.verified_by or None,
            force=args.force,
        )

        print(f"✓ Updated {args.task} to '{args.status}'")
        if args.note:
            print(f"  Note: {args.note}")
        if args.started:
            print(f"  Started: {args.started}")
        if args.completed_ts:
            print(f"  Completed: {args.completed_ts}")
        if args.evidence:
            print(f"  Evidence: {len(args.evidence)} item(s) added")
        if args.verified_by:
            print(f"  Verified-by: {', '.join(args.verified_by)}")
        print(f"  Progress: {old_progress}% → {new_progress}%")
        sys.exit(0)

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: Unexpected error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
