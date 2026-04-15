#!/usr/bin/env python3
"""Update a single NotebookLM source when a file changes.

Called by Claude Code hook to sync individual file changes to NotebookLM.
Designed to be silent by default and never fail the hook.

Usage:
    python scripts/notebooklm_sync/update.py CLAUDE.md
    python scripts/notebooklm_sync/update.py docs/dev/foo.md --verbose
    python scripts/notebooklm_sync/update.py README.md --dry-run
    python scripts/notebooklm_sync/update.py skillmeat/web/README.md --force-add
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import NoReturn, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from .config import MAPPING_PATH
    from .utils import (
        NotebookLMAuthError,
        get_display_name,
        get_notebook_id,
        is_in_scope,
        load_mapping,
        run_notebooklm_cmd,
        save_mapping,
        upload_file_with_display_name,
    )
except ImportError:
    from config import MAPPING_PATH
    from utils import (
        NotebookLMAuthError,
        get_display_name,
        get_notebook_id,
        is_in_scope,
        load_mapping,
        run_notebooklm_cmd,
        save_mapping,
        upload_file_with_display_name,
    )


def log_verbose(msg: str, verbose: bool) -> None:
    """Print message only if verbose mode is enabled.

    Args:
        msg: Message to print
        verbose: Whether verbose mode is enabled
    """
    if verbose:
        print(f"[notebooklm-sync] {msg}", file=sys.stderr)


def log_error(msg: str, verbose: bool) -> None:
    """Print error message only if verbose mode is enabled.

    Args:
        msg: Error message to print
        verbose: Whether verbose mode is enabled
    """
    if verbose:
        print(f"[notebooklm-sync] ERROR: {msg}", file=sys.stderr)


def normalize_filepath(filepath: str) -> Path:
    """Normalize a filepath to be relative to the project root.

    Handles:
    - ./foo.md -> foo.md
    - /absolute/path/to/project/foo.md -> foo.md
    - foo.md -> foo.md

    Args:
        filepath: Path to normalize (string)

    Returns:
        Normalized Path object relative to current directory
    """
    path = Path(filepath)

    # If it's absolute, try to make it relative to cwd
    if path.is_absolute():
        try:
            path = path.relative_to(Path.cwd())
        except ValueError:
            # Path is outside cwd, use as-is
            pass

    # Normalize away any ./ prefix
    return path


def update_source(
    filepath: Path,
    verbose: bool = False,
    dry_run: bool = False,
    force_add: bool = False,
) -> int:
    """Update or add a NotebookLM source for a changed file.

    Args:
        filepath: Path to the file that changed
        verbose: Enable verbose output
        dry_run: Don't actually make changes, just show what would happen
        force_add: Add file even if it's not in the default scope

    Returns:
        Exit code (0 = success, non-zero = error)
    """
    try:
        # 1. Normalize the file path
        norm_path = normalize_filepath(str(filepath))
        log_verbose(f"Processing file: {norm_path}", verbose)
        display_name = get_display_name(norm_path)

        # 2. Check if file is in scope
        if not force_add and not is_in_scope(norm_path):
            log_verbose(f"File not in sync scope, skipping: {norm_path}", verbose)
            return 0

        # 3. Load mapping from disk
        mapping = load_mapping()

        # 4. Check if mapping exists (notebook initialized)
        notebook_id = mapping.get("notebook_id")
        if not notebook_id:
            log_verbose("No notebook initialized. Run init.py first.", verbose)
            return 0

        log_verbose(f"Using notebook: {notebook_id}", verbose)

        # 5. Set active notebook
        if not dry_run:
            returncode, _ = run_notebooklm_cmd(["use", notebook_id])
            if returncode != 0:
                log_error(f"Failed to set active notebook: {notebook_id}", verbose)
                return 0  # Don't fail the hook

        # 6. Check if file is already tracked
        sources = mapping.get("sources", {})
        filepath_str = str(norm_path)
        existing_source = sources.get(filepath_str)

        if existing_source:
            # UPDATE: Delete old source and add new one
            source_id = existing_source.get("source_id")
            log_verbose(f"Updating existing source: {filepath_str}", verbose)

            if dry_run:
                log_verbose(f"[DRY RUN] Would delete source: {source_id}", verbose)
                log_verbose(f"[DRY RUN] Would add source: {filepath_str}", verbose)
            else:
                # Delete old source
                returncode, _ = run_notebooklm_cmd(
                    ["source", "delete", source_id, "-y"]
                )
                if returncode != 0:
                    log_error(f"Failed to delete old source: {source_id}", verbose)
                    # Continue anyway - we'll try to add the new one
                else:
                    log_verbose(f"Deleted old source: {source_id}", verbose)

                # Add new source (using display name if different from filename)
                new_source_id = upload_file_with_display_name(
                    norm_path, display_name, dry_run=False
                )

                if not new_source_id:
                    log_error(f"Failed to add new source: {filepath_str}", verbose)
                    return 0  # Don't fail the hook

                log_verbose(f"Added new source: {new_source_id}", verbose)

                # Update mapping entry
                mapping["sources"][filepath_str] = {
                    "source_id": new_source_id,
                    "display_name": display_name,
                    "last_synced": datetime.now(timezone.utc).isoformat(),
                }
                save_mapping(mapping)
        else:
            # NEW FILE: Add source
            log_verbose(f"Adding new source: {filepath_str}", verbose)

            if dry_run:
                log_verbose(f"[DRY RUN] Would add source: {filepath_str} (as {display_name})", verbose)
            else:
                # Add source (using display name if different from filename)
                new_source_id = upload_file_with_display_name(
                    norm_path, display_name, dry_run=False
                )

                if not new_source_id:
                    log_error(f"Failed to add source: {filepath_str}", verbose)
                    return 0  # Don't fail the hook

                log_verbose(f"Added source: {new_source_id}", verbose)

                # Ensure sources dict exists
                if "sources" not in mapping:
                    mapping["sources"] = {}

                mapping["sources"][filepath_str] = {
                    "source_id": new_source_id,
                    "display_name": display_name,
                    "last_synced": datetime.now(timezone.utc).isoformat(),
                }
                save_mapping(mapping)

        log_verbose("Sync complete", verbose)
        return 0

    except NotebookLMAuthError as e:
        # Auth errors get a clear message but still don't fail the hook
        log_error(str(e), verbose)
        return 0
    except Exception as e:
        # Catch ALL exceptions - never fail the hook
        log_error(f"Unexpected error: {e}", verbose)
        return 0


def main() -> int:
    """Main entry point.

    Returns:
        Exit code (always 0 to avoid failing hooks)
    """
    parser = argparse.ArgumentParser(
        description="Update a single NotebookLM source when a file changes",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s CLAUDE.md
  %(prog)s docs/dev/foo.md --verbose
  %(prog)s README.md --dry-run
        """.strip(),
    )

    parser.add_argument(
        "filepath",
        type=str,
        help="Path to the file that changed",
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
        help="Show what would be done without making changes",
    )

    parser.add_argument(
        "--force-add",
        action="store_true",
        help="Add file even if it's not in the default scope",
    )

    args = parser.parse_args()

    return update_source(
        filepath=Path(args.filepath),
        verbose=args.verbose,
        dry_run=args.dry_run,
        force_add=args.force_add,
    )


if __name__ == "__main__":
    sys.exit(main())
