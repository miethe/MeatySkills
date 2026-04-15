#!/usr/bin/env python3
"""Initialize NotebookLM notebook with project documentation.

One-time setup that creates a NotebookLM notebook and uploads all target
documentation files.

Usage:
    python scripts/notebooklm_sync/init.py                          # Basic usage
    python scripts/notebooklm_sync/init.py --notebook-title "Foo"   # Custom title
    python scripts/notebooklm_sync/init.py --dry-run                # Show what would be done
    python scripts/notebooklm_sync/init.py --force                  # Reinitialize (deletes notebook)
    python scripts/notebooklm_sync/init.py --refresh                # Reconcile sources, keep notebook
"""

import argparse
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from .config import DEFAULT_NOTEBOOK_TITLE, MAPPING_PATH
    from .utils import (
        NotebookLMAuthError,
        get_display_name,
        get_notebook_id,
        get_target_files,
        load_mapping,
        run_notebooklm_cmd,
        save_mapping,
        upload_file_with_display_name,
    )
except ImportError:
    from config import DEFAULT_NOTEBOOK_TITLE, MAPPING_PATH
    from utils import (
        NotebookLMAuthError,
        get_display_name,
        get_notebook_id,
        get_target_files,
        load_mapping,
        run_notebooklm_cmd,
        save_mapping,
        upload_file_with_display_name,
    )


def check_existing_initialization() -> bool:
    """Check if notebook is already initialized.

    Returns:
        True if initialized (mapping file exists with notebook_id), False otherwise.
    """
    mapping = load_mapping()
    return bool(mapping.get("notebook_id"))


def verify_authentication() -> bool:
    """Verify user is authenticated with NotebookLM.

    Returns:
        True if authenticated, False otherwise.
    """
    try:
        returncode, _ = run_notebooklm_cmd(["auth", "check"])
        return returncode == 0
    except NotebookLMAuthError:
        return False


def create_notebook(title: str, dry_run: bool = False) -> str | None:
    """Create a new NotebookLM notebook.

    Args:
        title: Notebook title
        dry_run: If True, simulate without creating

    Returns:
        Notebook ID string, or None on failure.
    """
    if dry_run:
        print(f"[DRY RUN] Would create notebook: '{title}'")
        return "dry-run-notebook-id"

    print(f"Creating notebook: '{title}'...")
    returncode, output = run_notebooklm_cmd(["create", title, "--json"], capture_json=True)

    if returncode != 0 or not output:
        print(f"Error: Failed to create notebook")
        return None

    # Handle both response formats: {"id": "..."} or {"notebook": {"id": "..."}}
    notebook_id = output.get("id") or output.get("notebook", {}).get("id")
    if not notebook_id:
        print(f"Error: No notebook ID in response: {output}")
        return None

    print(f"Created notebook: {notebook_id}")
    return notebook_id


def set_active_notebook(notebook_id: str, dry_run: bool = False) -> bool:
    """Set the active notebook.

    Args:
        notebook_id: Notebook ID to activate
        dry_run: If True, simulate without setting

    Returns:
        True on success, False on failure.

    Raises:
        NotebookLMAuthError: If authentication has expired.
    """
    if dry_run:
        print(f"[DRY RUN] Would set active notebook: {notebook_id}")
        return True

    print(f"Setting active notebook: {notebook_id}...")
    returncode, _ = run_notebooklm_cmd(["use", notebook_id])

    if returncode != 0:
        print(f"Error: Failed to set active notebook")
        return False

    return True


def upload_file(filepath: Path, dry_run: bool = False) -> str | None:
    """Upload a file to the active notebook.

    Args:
        filepath: Path to file to upload
        dry_run: If True, simulate without uploading

    Returns:
        Source ID string, or None on failure.
    """
    if dry_run:
        return f"dry-run-source-{filepath.name}"

    returncode, output = run_notebooklm_cmd(
        ["source", "add", str(filepath), "--json"],
        capture_json=True,
    )

    if returncode != 0 or not output:
        return None

    # Handle both response formats: {"id": "..."} or {"source": {"id": "..."}}
    source_id = output.get("id") or output.get("source", {}).get("id")
    return source_id


def delete_existing_notebook(notebook_id: str, dry_run: bool = False) -> bool:
    """Delete an existing notebook.

    Args:
        notebook_id: Notebook ID to delete
        dry_run: If True, simulate without deleting

    Returns:
        True on success, False on failure.
    """
    if dry_run:
        print(f"[DRY RUN] Would delete notebook: {notebook_id}")
        return True

    print(f"Deleting existing notebook: {notebook_id}...")
    returncode, _ = run_notebooklm_cmd(["delete", notebook_id, "--force"])

    if returncode != 0:
        print(f"Warning: Failed to delete existing notebook (may not exist)")
        return False

    return True


def refresh_notebook(
    dry_run: bool = False,
    verbose: bool = False,
    include_patterns: list[str] | None = None,
    exclude_patterns: list[str] | None = None,
    notebook_id: str | None = None,
) -> int:
    """Reconcile notebook sources with the current scope without recreating the notebook.

    Computes a diff between the tracked sources in the mapping and the files
    currently returned by get_target_files(), then removes out-of-scope sources
    and adds newly in-scope sources.

    Args:
        dry_run: If True, show what would be done without executing.
        verbose: Enable verbose output.
        include_patterns: Additional glob patterns to include.
        exclude_patterns: Additional glob patterns to exclude.
        notebook_id: Target a specific notebook by ID, overriding the mapped notebook.
            If not provided, the notebook ID from the mapping file is used.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    # Require existing initialization (or a --notebook-id override)
    mapping = load_mapping()
    mapped_notebook_id = mapping.get("notebook_id")

    if notebook_id:
        # User explicitly targeting a specific notebook
        if mapped_notebook_id and mapped_notebook_id != notebook_id:
            print(f"Switching notebook target: {mapped_notebook_id} -> {notebook_id}")
        effective_notebook_id = notebook_id
        # Update mapping to point to the new target
        mapping["notebook_id"] = notebook_id
    elif mapped_notebook_id:
        effective_notebook_id = mapped_notebook_id
    else:
        print("Error: No notebook found. Run init.py first (without --refresh).")
        print(f"  Or specify a notebook with --notebook-id <ID>")
        print(f"  Mapping file: {MAPPING_PATH}")
        return 1

    print(f"Refreshing notebook: {effective_notebook_id}")
    if mapping.get("notebook_title"):
        print(f"  Title: {mapping['notebook_title']}")
    print()

    # Verify authentication
    if not dry_run and not verify_authentication():
        print("Error: Not authenticated with NotebookLM.")
        print()
        print("Run: notebooklm auth login")
        return 1

    # Set as active notebook
    if not set_active_notebook(effective_notebook_id, dry_run=dry_run):
        return 1

    # Discover current target files
    print()
    print("Discovering documentation files...")
    if verbose and (include_patterns or exclude_patterns):
        print(f"  Include patterns: {include_patterns or 'default'}")
        print(f"  Exclude patterns: {exclude_patterns or 'default'}")
    target_files = get_target_files(
        include_patterns=include_patterns,
        exclude_patterns=exclude_patterns,
    )
    target_paths = {str(f) for f in target_files}
    print(f"Found {len(target_files)} files currently in scope")

    # Compute diff against tracked sources
    tracked_sources: Dict[str, Dict] = mapping.get("sources", {})
    tracked_paths = set(tracked_sources.keys())

    to_remove = tracked_paths - target_paths   # tracked but no longer in scope
    to_add = target_paths - tracked_paths       # in scope but not yet tracked
    up_to_date = tracked_paths & target_paths   # already tracked and still in scope

    print()
    print("Diff:")
    print(f"  To remove (out of scope): {len(to_remove)}")
    print(f"  To add (newly in scope):  {len(to_add)}")
    print(f"  Up to date (no change):   {len(up_to_date)}")

    if not to_remove and not to_add:
        print()
        print("Nothing to do — sources already match current scope.")
        return 0

    if verbose:
        if to_remove:
            print()
            print("Sources to remove:")
            for path in sorted(to_remove):
                src = tracked_sources[path]
                print(f"  - {path} (source_id={src.get('source_id', '?')})")
        if to_add:
            print()
            print("Sources to add:")
            for path in sorted(to_add):
                print(f"  + {path}")

    changed = False
    failed_remove: List[str] = []
    failed_add: List[Path] = []
    current_time = datetime.now(timezone.utc).isoformat()

    # Remove out-of-scope sources
    if to_remove:
        print()
        print(f"Removing {len(to_remove)} out-of-scope source(s)...")
        remove_list = sorted(to_remove)
        for i, path in enumerate(remove_list, 1):
            source_entry = tracked_sources[path]
            source_id = source_entry.get("source_id", "")
            display = source_entry.get("display_name", Path(path).name)
            print(f"  [{i}/{len(remove_list)}] Removing {display}...", end=" ")

            if dry_run:
                print("[DRY RUN]")
            else:
                returncode, _ = run_notebooklm_cmd(["source", "delete", source_id, "-y"])
                if returncode == 0:
                    print("OK")
                    del tracked_sources[path]
                    changed = True
                else:
                    print("FAILED")
                    failed_remove.append(path)

                # Rate limit: sleep 1s between calls, skip on last item
                if i < len(remove_list):
                    time.sleep(1)

        if dry_run:
            # Simulate the removals so up-to-date counts are accurate in summary
            for path in remove_list:
                del tracked_sources[path]
            changed = True

    # Add newly in-scope sources
    if to_add:
        print()
        print(f"Adding {len(to_add)} new source(s)...")
        add_list = sorted(to_add)
        for i, path_str in enumerate(add_list, 1):
            filepath = Path(path_str)
            display_name = get_display_name(filepath)
            if verbose:
                label = (
                    f"{filepath}"
                    if display_name == filepath.name
                    else f"{filepath} (as {display_name})"
                )
                print(f"  [{i}/{len(add_list)}] {label}...", end=" ")
            else:
                print(f"  [{i}/{len(add_list)}] {display_name}...", end=" ")

            if dry_run:
                print("[DRY RUN]")
                tracked_sources[path_str] = {
                    "source_id": f"dry-run-source-{filepath.name}",
                    "title": display_name,
                    "display_name": display_name,
                    "added_at": current_time,
                    "last_synced": current_time,
                }
                changed = True
            else:
                source_id = upload_file_with_display_name(
                    filepath, display_name, dry_run=False
                )
                if source_id:
                    print("OK")
                    if verbose:
                        print(f"    Source ID: {source_id}")
                    tracked_sources[path_str] = {
                        "source_id": source_id,
                        "title": display_name,
                        "display_name": display_name,
                        "added_at": current_time,
                        "last_synced": current_time,
                    }
                    changed = True
                else:
                    print("FAILED")
                    failed_add.append(filepath)

                # Rate limit: sleep 1s between calls, skip on last item
                if i < len(add_list):
                    time.sleep(1)

    # Save mapping only if changes were made
    if changed and not dry_run:
        mapping["sources"] = tracked_sources
        save_mapping(mapping)

    # Print summary
    removed_count = len(to_remove) - len(failed_remove)
    added_count = len(to_add) - len(failed_add)
    print()
    print("=" * 60)
    print("REFRESH SUMMARY")
    print("=" * 60)
    print(f"Notebook ID:  {effective_notebook_id}")
    print(f"Removed:      {removed_count} of {len(to_remove)} (failed: {len(failed_remove)})")
    print(f"Added:        {added_count} of {len(to_add)} (failed: {len(failed_add)})")
    print(f"Unchanged:    {len(up_to_date)}")

    if failed_remove:
        print()
        print("Failed to remove:")
        for path in failed_remove:
            print(f"  - {path}")

    if failed_add:
        print()
        print("Failed to add:")
        for filepath in failed_add:
            print(f"  - {filepath}")

    if changed and not dry_run:
        print()
        print(f"Mapping saved to: {MAPPING_PATH}")

    if dry_run:
        print()
        print("[DRY RUN] No changes were made.")

    return 1 if (failed_remove or failed_add) else 0


def init_notebook(
    title: str = DEFAULT_NOTEBOOK_TITLE,
    dry_run: bool = False,
    force: bool = False,
    refresh: bool = False,
    include_patterns: list[str] | None = None,
    exclude_patterns: list[str] | None = None,
    notebook_id: str | None = None,
    verbose: bool = False,
) -> int:
    """Initialize NotebookLM notebook with documentation.

    Creates a new notebook and uploads all target documentation files.
    Use --refresh to reconcile sources in an existing notebook without
    deleting it. Use --force to delete and recreate the notebook entirely.

    Args:
        title: Notebook title.
        dry_run: If True, show what would be done without executing.
        force: If True, reinitialize even if already initialized (deletes notebook).
        refresh: If True, reconcile sources without recreating the notebook.
            When combined with notebook_id, targets that specific notebook.
        include_patterns: Additional glob patterns to include.
        exclude_patterns: Additional glob patterns to exclude.
        notebook_id: Target a specific notebook by ID. Works with both init
            (use existing notebook instead of creating a new one) and --refresh
            (override the mapped notebook target). Use 'notebooklm list --json'
            to find IDs.
        verbose: Enable verbose output.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    # Refresh mode: reconcile sources, keep existing notebook
    if refresh:
        return refresh_notebook(
            dry_run=dry_run,
            verbose=verbose,
            include_patterns=include_patterns,
            exclude_patterns=exclude_patterns,
            notebook_id=notebook_id,
        )

    # Check if already initialized
    if check_existing_initialization():
        if not force and not notebook_id:
            print(f"Error: Notebook already initialized.")
            print(f"  Mapping file: {MAPPING_PATH}")
            print(f"  Notebook ID: {get_notebook_id()}")
            print()
            print("Use --force to reinitialize (will delete existing notebook).")
            print("Use --refresh to reconcile sources without recreating the notebook.")
            return 1

        # Force reinitialize - delete existing
        if force:
            existing_id = get_notebook_id()
            if existing_id:
                delete_existing_notebook(existing_id, dry_run=dry_run)

    # Verify authentication
    if not dry_run and not verify_authentication():
        print("Error: Not authenticated with NotebookLM.")
        print()
        print("Run: notebooklm auth login")
        return 1

    # Use existing notebook or create new one
    if notebook_id:
        if verbose:
            print(f"Using existing notebook: {notebook_id}")
    else:
        # Create notebook
        notebook_id = create_notebook(title, dry_run=dry_run)
        if not notebook_id:
            return 1

    # Set as active
    if not set_active_notebook(notebook_id, dry_run=dry_run):
        return 1

    # Discover target files
    print()
    print("Discovering documentation files...")
    if verbose and (include_patterns or exclude_patterns):
        print(f"  Include patterns: {include_patterns or 'default'}")
        print(f"  Exclude patterns: {exclude_patterns or 'default'}")
    target_files = get_target_files(
        include_patterns=include_patterns,
        exclude_patterns=exclude_patterns,
    )
    print(f"Found {len(target_files)} files to upload")

    # Upload files
    print()
    print("Uploading files...")
    sources: Dict[str, Dict] = {}
    failed: List[Path] = []
    current_time = datetime.now(timezone.utc).isoformat()

    for i, filepath in enumerate(target_files, 1):
        display_name = get_display_name(filepath)
        if verbose:
            label = f"{filepath}" if display_name == filepath.name else f"{filepath} (as {display_name})"
            print(f"  [{i}/{len(target_files)}] {label}...", end=" ")
        else:
            print(f"  [{i}/{len(target_files)}] {display_name}...", end=" ")

        source_id = upload_file_with_display_name(filepath, display_name, dry_run=dry_run)

        if source_id:
            print("OK")
            if verbose:
                print(f"    Source ID: {source_id}")
            sources[str(filepath)] = {
                "source_id": source_id,
                "title": display_name,
                "display_name": display_name,
                "added_at": current_time,
                "last_synced": current_time,
            }
        else:
            print("FAILED")
            failed.append(filepath)

    # Build and save mapping
    if not dry_run:
        mapping = {
            "notebook_id": notebook_id,
            "notebook_title": title,
            "created_at": current_time,
            "sources": sources,
        }
        save_mapping(mapping)

    # Print summary
    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Notebook ID: {notebook_id}")
    print(f"Notebook Title: {title}")
    print(f"Total files found: {len(target_files)}")
    print(f"Successfully uploaded: {len(sources)}")
    print(f"Failed: {len(failed)}")

    if failed:
        print()
        print("Failed files:")
        for filepath in failed:
            print(f"  - {filepath}")

    if not dry_run:
        print()
        print(f"Mapping saved to: {MAPPING_PATH}")

    if dry_run:
        print()
        print("[DRY RUN] No changes were made.")

    return 1 if failed else 0


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Initialize NotebookLM notebook with project documentation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                                           # Basic usage
  %(prog)s --notebook-title "Foo"                    # Custom title
  %(prog)s --dry-run                                 # Show what would be done
  %(prog)s --force                                   # Reinitialize (delete existing notebook)
  %(prog)s --refresh                                 # Reconcile sources, keep existing notebook
  %(prog)s --refresh --dry-run                       # Preview reconciliation without making changes
  %(prog)s --include "docs/project_plans/PRDs/**" --include "docs/archive/*.md"
  %(prog)s --exclude "docs/user/beta/**"
  %(prog)s --notebook-id abc123                      # Use existing notebook
  %(prog)s --refresh --notebook-id e837f0f4          # Refresh targeting a specific notebook
  %(prog)s --notebook-id abc123 --refresh --dry-run  # Preview refresh on specific notebook
  %(prog)s --verbose                                 # Detailed output
        """,
    )
    parser.add_argument(
        "--notebook-title",
        default=DEFAULT_NOTEBOOK_TITLE,
        help=f"Notebook title (default: {DEFAULT_NOTEBOOK_TITLE})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without executing",
    )

    # --force and --refresh are mutually exclusive
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--force",
        action="store_true",
        help="Reinitialize even if already initialized (deletes existing notebook)",
    )
    mode_group.add_argument(
        "--refresh",
        action="store_true",
        help=(
            "Reconcile sources with current scope without recreating the notebook "
            "(requires existing initialization; preserves audio overviews and notes)"
        ),
    )

    parser.add_argument(
        "--include",
        action="append",
        metavar="PATTERN",
        help="Add glob pattern to include (repeatable, added to defaults)",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        metavar="PATTERN",
        help="Add glob pattern to exclude (repeatable)",
    )
    parser.add_argument(
        "--notebook-id",
        metavar="ID",
        help=(
            "Target a specific notebook by ID (works with init and --refresh; "
            "use 'notebooklm list --json' to find IDs)"
        ),
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="More detailed output during upload",
    )

    args = parser.parse_args()

    try:
        return init_notebook(
            title=args.notebook_title,
            dry_run=args.dry_run,
            force=args.force,
            refresh=args.refresh,
            include_patterns=args.include,
            exclude_patterns=args.exclude,
            notebook_id=args.notebook_id,
            verbose=args.verbose,
        )
    except NotebookLMAuthError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
