#!/usr/bin/env python3
"""Remove orphaned sources from NotebookLM.

Orphaned sources are files tracked in the mapping but deleted locally.
This script removes them from NotebookLM and updates the mapping.

Usage:
    python scripts/notebooklm_sync/cleanup.py              # Interactive with confirmation
    python scripts/notebooklm_sync/cleanup.py --dry-run    # Preview
    python scripts/notebooklm_sync/cleanup.py --force      # No confirmation (for scripts)
    python scripts/notebooklm_sync/cleanup.py -v           # Verbose output
"""

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from .config import MAPPING_PATH
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
    from utils import (
        NotebookLMAuthError,
        get_notebook_id,
        get_target_files,
        load_mapping,
        run_notebooklm_cmd,
        save_mapping,
    )


def log_verbose(msg: str, verbose: bool) -> None:
    """Print message only if verbose mode is enabled.

    Args:
        msg: Message to print
        verbose: Whether verbose mode is enabled
    """
    if verbose:
        print(f"[notebooklm-sync] {msg}")


def get_orphaned_sources(mapping: Dict) -> List[Tuple[str, str]]:
    """Find all orphaned sources (tracked but deleted locally).

    Args:
        mapping: Loaded mapping dictionary

    Returns:
        List of tuples: (filepath, source_id)
    """
    sources = mapping.get("sources", {})
    tracked_files = set(sources.keys())
    in_scope_files = set(str(f) for f in get_target_files())
    orphaned_files = tracked_files - in_scope_files

    orphaned = []
    for filepath in sorted(orphaned_files):
        source_info = sources[filepath]
        source_id = source_info.get("source_id", "")
        orphaned.append((filepath, source_id))

    return orphaned


def delete_source(source_id: str, verbose: bool = False) -> bool:
    """Delete a source from NotebookLM.

    Args:
        source_id: The source ID to delete
        verbose: Enable verbose output

    Returns:
        True if deletion succeeded, False otherwise
    """
    returncode, _ = run_notebooklm_cmd(["source", "delete", source_id, "-y"])
    if returncode != 0:
        log_verbose(f"Failed to delete source: {source_id}", verbose)
        return False
    return True


def cleanup_orphaned_sources(
    verbose: bool = False,
    dry_run: bool = False,
    force: bool = False,
) -> int:
    """Remove orphaned sources from NotebookLM.

    Args:
        verbose: Enable verbose output
        dry_run: Don't actually make changes, just show what would happen
        force: Skip confirmation prompt

    Returns:
        Exit code (0 = success, 1 = error)
    """
    # Load mapping
    mapping = load_mapping()

    if not mapping:
        print("No mapping file found. Run init.py first.")
        return 1

    notebook_id = mapping.get("notebook_id")
    if not notebook_id:
        print("No notebook initialized. Run init.py first.")
        return 1

    log_verbose(f"Using notebook: {notebook_id}", verbose)

    # Find orphaned sources
    orphaned = get_orphaned_sources(mapping)

    if not orphaned:
        print("No orphaned sources found.")
        return 0

    # Display orphaned sources
    print(f"Found {len(orphaned)} orphaned source{'s' if len(orphaned) != 1 else ''}:")
    for filepath, _ in orphaned:
        print(f"  - {filepath}")
    print()

    # Dry run mode
    if dry_run:
        print("[DRY RUN] Would delete the above sources from NotebookLM.")
        return 0

    # Confirmation prompt (unless --force)
    if not force:
        prompt = f"Delete {len(orphaned)} orphaned source{'s' if len(orphaned) != 1 else ''} from NotebookLM? [y/N]: "
        try:
            response = input(prompt).strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nAborted.")
            return 1

        if response not in ("y", "yes"):
            print("Aborted.")
            return 0

    print()

    # Set active notebook
    try:
        returncode, _ = run_notebooklm_cmd(["use", notebook_id])
    except NotebookLMAuthError as e:
        print(f"\nERROR: {e}")
        return 1
    if returncode != 0:
        print(f"Error: Failed to set active notebook: {notebook_id}")
        return 1

    # Delete each orphaned source
    deleted_count = 0
    failed_count = 0
    total = len(orphaned)

    for i, (filepath, source_id) in enumerate(orphaned, start=1):
        print(f"[{i}/{total}] Deleting {filepath}...", end=" ", flush=True)

        if not source_id:
            print("SKIP (no source_id)")
            failed_count += 1
            continue

        try:
            if delete_source(source_id, verbose):
                print("OK")
                del mapping["sources"][filepath]
                deleted_count += 1
            else:
                print("FAILED")
                failed_count += 1
        except NotebookLMAuthError as e:
            print(f"\nERROR: {e}")
            return 1

    # Save mapping atomically
    print()
    if deleted_count > 0:
        save_mapping(mapping)
        print("Mapping saved.")

    print(f"Completed: {deleted_count} deleted, {failed_count} failed.")

    return 0 if failed_count == 0 else 1


def main() -> int:
    """Main entry point.

    Returns:
        Exit code (0 for success, 1 for error)
    """
    parser = argparse.ArgumentParser(
        description="Remove orphaned sources from NotebookLM",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s              # Interactive with confirmation
  %(prog)s --dry-run    # Preview what would be deleted
  %(prog)s --force      # No confirmation (for scripts)
  %(prog)s -v           # Verbose output
        """.strip(),
    )

    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose output",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be deleted without actually deleting",
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip confirmation prompt (for automation)",
    )

    args = parser.parse_args()

    return cleanup_orphaned_sources(
        verbose=args.verbose,
        dry_run=args.dry_run,
        force=args.force,
    )


if __name__ == "__main__":
    sys.exit(main())
