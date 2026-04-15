#!/usr/bin/env python3
"""Batch sync multiple files to NotebookLM.

Finds stale (modified since last sync) and untracked (in scope but not synced)
files and syncs them to NotebookLM with rate limiting.

Usage:
    python scripts/notebooklm_sync/batch.py              # Sync all stale + untracked
    python scripts/notebooklm_sync/batch.py --stale-only # Only stale files
    python scripts/notebooklm_sync/batch.py --dry-run    # Preview what would sync
    python scripts/notebooklm_sync/batch.py --limit 10   # Max 10 files
"""

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from .config import MAPPING_PATH
    from .status import get_stale_files
    from .utils import (
        NotebookLMAuthError,
        get_notebook_id,
        get_target_files,
        load_mapping,
        run_notebooklm_cmd,
        save_mapping,
    )
except ImportError:
    from config import MAPPING_PATH
    from status import get_stale_files
    from utils import (
        NotebookLMAuthError,
        get_notebook_id,
        get_target_files,
        load_mapping,
        run_notebooklm_cmd,
        save_mapping,
    )


# Rate limiting delay between syncs (seconds)
SYNC_DELAY_SECONDS = 1.0


def log(msg: str, verbose: bool = True) -> None:
    """Print message to stderr.

    Args:
        msg: Message to print
        verbose: Whether to print (always prints if True)
    """
    if verbose:
        print(msg, file=sys.stderr)


def log_progress(current: int, total: int, filepath: str, verbose: bool) -> None:
    """Print progress message.

    Args:
        current: Current file number (1-indexed)
        total: Total number of files
        filepath: Path being processed
        verbose: Whether verbose mode is enabled
    """
    if verbose:
        print(f"[{current}/{total}] Syncing {filepath}...", file=sys.stderr)


def get_untracked_files(mapping: Dict[str, Any]) -> List[str]:
    """Find files in scope but not yet tracked.

    Args:
        mapping: Loaded mapping dictionary

    Returns:
        Sorted list of untracked filepaths
    """
    sources = mapping.get("sources", {})
    tracked_files = set(sources.keys())
    in_scope_files = set(str(f) for f in get_target_files())
    untracked = in_scope_files - tracked_files
    return sorted(untracked)


def sync_single_file(
    filepath: str,
    mapping: Dict[str, Any],
    verbose: bool = False,
    dry_run: bool = False,
) -> Tuple[bool, Dict[str, Any]]:
    """Sync a single file to NotebookLM.

    Args:
        filepath: Path to the file to sync
        mapping: Current mapping dictionary (modified in place on success)
        verbose: Enable verbose output
        dry_run: Don't actually make changes

    Returns:
        Tuple of (success, updated_mapping)
    """
    sources = mapping.get("sources", {})
    existing_source = sources.get(filepath)

    if existing_source:
        # UPDATE: Delete old source and add new one
        source_id = existing_source.get("source_id")

        if dry_run:
            if verbose:
                log(f"  [DRY RUN] Would update: delete {source_id}, add new", verbose)
            return True, mapping

        # Delete old source
        returncode, _ = run_notebooklm_cmd(["source", "delete", source_id, "-y"])
        if returncode != 0:
            log(f"  WARNING: Failed to delete old source: {source_id}", verbose)
            # Continue anyway - try to add the new one

        # Add new source
        returncode, output = run_notebooklm_cmd(
            ["source", "add", filepath, "--json"],
            capture_json=True,
        )

        if returncode != 0 or not output:
            log(f"  ERROR: Failed to add source: {filepath}", verbose)
            return False, mapping

        # Update mapping with new source_id
        new_source_id = output.get("id") or output.get("source", {}).get("id")
        if not new_source_id:
            log("  ERROR: No source ID in response", verbose)
            return False, mapping

        mapping["sources"][filepath] = {
            "source_id": new_source_id,
            "last_synced": datetime.now(timezone.utc).isoformat(),
        }

    else:
        # NEW FILE: Add source
        if dry_run:
            if verbose:
                log(f"  [DRY RUN] Would add new source", verbose)
            return True, mapping

        returncode, output = run_notebooklm_cmd(
            ["source", "add", filepath, "--json"],
            capture_json=True,
        )

        if returncode != 0 or not output:
            log(f"  ERROR: Failed to add source: {filepath}", verbose)
            return False, mapping

        new_source_id = output.get("id") or output.get("source", {}).get("id")
        if not new_source_id:
            log("  ERROR: No source ID in response", verbose)
            return False, mapping

        # Ensure sources dict exists
        if "sources" not in mapping:
            mapping["sources"] = {}

        mapping["sources"][filepath] = {
            "source_id": new_source_id,
            "last_synced": datetime.now(timezone.utc).isoformat(),
        }

    return True, mapping


def batch_sync(
    dry_run: bool = False,
    verbose: bool = False,
    stale_only: bool = False,
    untracked_only: bool = False,
    limit: int | None = None,
) -> int:
    """Batch sync multiple files to NotebookLM.

    Args:
        dry_run: Show what would be synced without syncing
        verbose: Show detailed progress
        stale_only: Only sync stale files (skip untracked)
        untracked_only: Only sync untracked files (skip stale)
        limit: Maximum number of files to sync

    Returns:
        Exit code (0 = success, 1 = any failure)
    """
    # Load mapping
    mapping = load_mapping()

    # Check if notebook is initialized
    notebook_id = mapping.get("notebook_id")
    if not notebook_id:
        log("ERROR: No notebook initialized. Run init.py first.", True)
        return 1

    # Build list of files to sync
    files_to_sync: List[Tuple[str, str]] = []  # (filepath, category)

    if not untracked_only:
        stale = get_stale_files(mapping)
        for filepath, _, _ in stale:
            files_to_sync.append((filepath, "stale"))

    if not stale_only:
        untracked = get_untracked_files(mapping)
        for filepath in untracked:
            files_to_sync.append((filepath, "untracked"))

    # Remove duplicates while preserving order
    seen: Set[str] = set()
    unique_files: List[Tuple[str, str]] = []
    for filepath, category in files_to_sync:
        if filepath not in seen:
            seen.add(filepath)
            unique_files.append((filepath, category))
    files_to_sync = unique_files

    # Apply limit
    if limit is not None and limit > 0:
        files_to_sync = files_to_sync[:limit]

    total = len(files_to_sync)

    if total == 0:
        log("No files to sync.", True)
        return 0

    # Summary
    stale_count = sum(1 for _, cat in files_to_sync if cat == "stale")
    untracked_count = sum(1 for _, cat in files_to_sync if cat == "untracked")

    if dry_run:
        log(f"[DRY RUN] Would sync {total} files:", True)
    else:
        log(f"Syncing {total} files to NotebookLM...", True)

    if stale_count > 0:
        log(f"  - Stale: {stale_count}", True)
    if untracked_count > 0:
        log(f"  - Untracked: {untracked_count}", True)
    log("", True)

    # Set active notebook (unless dry run)
    if not dry_run:
        try:
            returncode, _ = run_notebooklm_cmd(["use", notebook_id])
        except NotebookLMAuthError as e:
            log(f"\nERROR: {e}", True)
            return 1
        if returncode != 0:
            log(f"ERROR: Failed to set active notebook: {notebook_id}", True)
            return 1

    # Track results
    success_count = 0
    failure_count = 0

    # Process each file
    for idx, (filepath, category) in enumerate(files_to_sync, start=1):
        log_progress(idx, total, filepath, verbose)

        try:
            success, mapping = sync_single_file(filepath, mapping, verbose, dry_run)
        except NotebookLMAuthError as e:
            log(f"\nERROR: {e}", True)
            return 1

        if success:
            success_count += 1
            if verbose:
                log(f"  OK ({category})", verbose)
        else:
            failure_count += 1
            log(f"  FAILED: {filepath}", True)

        # Rate limiting delay (skip on last file and dry run)
        if not dry_run and idx < total:
            time.sleep(SYNC_DELAY_SECONDS)

    # Save mapping atomically after all syncs complete
    if not dry_run and success_count > 0:
        save_mapping(mapping)
        if verbose:
            log("\nMapping saved.", verbose)

    # Summary
    log("", True)
    if dry_run:
        log(f"[DRY RUN] Would sync {success_count} files.", True)
    else:
        log(f"Completed: {success_count} synced, {failure_count} failed.", True)

    return 1 if failure_count > 0 else 0


def main() -> int:
    """Main entry point.

    Returns:
        Exit code (0 = success, 1 = any failure)
    """
    parser = argparse.ArgumentParser(
        description="Batch sync multiple files to NotebookLM",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                   # Sync all stale + untracked files
  %(prog)s --stale-only      # Only sync files modified since last sync
  %(prog)s --untracked-only  # Only sync files not yet tracked
  %(prog)s --dry-run         # Preview what would be synced
  %(prog)s --limit 10        # Sync at most 10 files
  %(prog)s -v                # Verbose output
        """.strip(),
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be synced without actually syncing",
    )

    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Show detailed progress",
    )

    parser.add_argument(
        "--stale-only",
        action="store_true",
        help="Only sync stale files (modified since last sync)",
    )

    parser.add_argument(
        "--untracked-only",
        action="store_true",
        help="Only sync untracked files (in scope but not yet synced)",
    )

    parser.add_argument(
        "--limit",
        type=int,
        metavar="N",
        help="Limit to N files (for rate limiting)",
    )

    args = parser.parse_args()

    # Validate mutually exclusive options
    if args.stale_only and args.untracked_only:
        parser.error("--stale-only and --untracked-only are mutually exclusive")

    return batch_sync(
        dry_run=args.dry_run,
        verbose=args.verbose,
        stale_only=args.stale_only,
        untracked_only=args.untracked_only,
        limit=args.limit,
    )


if __name__ == "__main__":
    sys.exit(main())
