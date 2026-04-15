"""Shared utilities for NotebookLM sync scripts.

Provides functions to manage notebook mappings, discover target files,
and execute notebooklm CLI commands.
"""

import json
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    from .config import (
        DEFAULT_NOTEBOOK_TITLE,
        EXCLUDE_PATTERNS,
        INCLUDE_DIRS,
        MAPPING_PATH,
        ROOT_INCLUDE_FILES,
    )
except ImportError:
    from config import (
        DEFAULT_NOTEBOOK_TITLE,
        EXCLUDE_PATTERNS,
        INCLUDE_DIRS,
        MAPPING_PATH,
        ROOT_INCLUDE_FILES,
    )


def load_mapping(path: Optional[Path] = None) -> Dict[str, Any]:
    """Load the notebook ID mapping from disk.

    Args:
        path: Path to mapping file. Defaults to ~/.notebooklm/skillmeat-sources.json

    Returns:
        Dictionary containing notebook metadata. Empty dict if file doesn't exist.
    """
    target_path = path or MAPPING_PATH

    if not target_path.exists():
        return {}

    try:
        with open(target_path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"Warning: Could not load mapping from {target_path}: {e}")
        return {}


def save_mapping(data: Dict[str, Any], path: Optional[Path] = None) -> None:
    """Atomically save the notebook ID mapping to disk.

    Creates parent directory if needed. Uses atomic write (write to temp, then rename)
    to prevent corruption.

    Args:
        data: Dictionary to save
        path: Path to mapping file. Defaults to ~/.notebooklm/skillmeat-sources.json
    """
    target_path = path or MAPPING_PATH

    # Ensure parent directory exists
    target_path.parent.mkdir(parents=True, exist_ok=True)

    # Atomic write: write to temp file first, then rename
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        dir=target_path.parent,
        delete=False,
    ) as tmp_file:
        json.dump(data, tmp_file, indent=2)
        tmp_path = Path(tmp_file.name)

    try:
        tmp_path.replace(target_path)
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError(f"Failed to save mapping to {target_path}: {e}")


def get_display_name(filepath: Path) -> str:
    """Compute the display name for a file as it will appear in NotebookLM.

    README.md at the root level keeps its name unchanged. README.md files in
    any subdirectory are renamed to README-{parent_dir}.md to avoid collisions.
    All other files keep their original filename.

    Args:
        filepath: Relative path to the file (relative to project root).

    Returns:
        Display name string to use when uploading.

    Examples:
        >>> get_display_name(Path("README.md"))
        'README.md'
        >>> get_display_name(Path("docs/dev/README.md"))
        'README-dev.md'
        >>> get_display_name(Path("docs/dev/patterns.md"))
        'patterns.md'
    """
    parts = filepath.parts
    if filepath.name == "README.md" and len(parts) > 1:
        return f"README-{filepath.parent.name}.md"
    return filepath.name


def upload_file_with_display_name(
    filepath: Path,
    display_name: str,
    dry_run: bool = False,
) -> Optional[str]:
    """Upload a file to the active notebook, optionally under a different display name.

    If display_name matches filepath.name, the file is uploaded directly. Otherwise
    a temporary copy is created with the desired display name, uploaded, and then
    the temporary directory is cleaned up.

    Args:
        filepath: Path to the actual file on disk.
        display_name: Name the source should appear as in NotebookLM.
        dry_run: If True, simulate without uploading.

    Returns:
        Source ID string, or None on failure.
    """
    if display_name == filepath.name:
        # No rename needed — upload directly
        if dry_run:
            return f"dry-run-source-{display_name}"
        returncode, output = run_notebooklm_cmd(
            ["source", "add", str(filepath), "--json"],
            capture_json=True,
        )
        if returncode != 0 or not output:
            return None
        source_id = output.get("id") or output.get("source", {}).get("id")
        return source_id

    # Rename needed — copy to a temp location with the desired name
    if dry_run:
        return f"dry-run-source-{display_name}"

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir) / display_name
        shutil.copy2(str(filepath), str(tmp_path))

        returncode, output = run_notebooklm_cmd(
            ["source", "add", str(tmp_path), "--json"],
            capture_json=True,
        )

    if returncode != 0 or not output:
        return None
    source_id = output.get("id") or output.get("source", {}).get("id")
    return source_id


def get_target_files(
    base_dir: Path = Path("."),
    include_patterns: Optional[List[str]] = None,
    exclude_patterns: Optional[List[str]] = None,
) -> List[Path]:
    """Discover all markdown files in scope for NotebookLM sync.

    Default scope is defined by ROOT_INCLUDE_FILES (exact filenames at the root)
    and INCLUDE_DIRS (directories searched recursively for *.md files).

    Args:
        base_dir: Base directory to search from. Defaults to current directory.
        include_patterns: Additional directory paths (strings relative to base_dir)
                         to add to INCLUDE_DIRS behaviour.
        exclude_patterns: Additional glob patterns to exclude on top of
                         EXCLUDE_PATTERNS from config.

    Returns:
        Sorted list of relative paths to markdown files.

    Examples:
        # Default scope
        >>> files = get_target_files()

        # Also include an extra directory
        >>> files = get_target_files(include_patterns=["docs/project_plans/ideas"])

        # Exclude beta docs
        >>> files = get_target_files(exclude_patterns=["docs/user/beta/**"])
    """
    base_dir = Path(base_dir).resolve()
    seen: set = set()
    target_files: List[Path] = []

    def _add(path: Path) -> None:
        rel = path.relative_to(base_dir)
        if rel not in seen:
            seen.add(rel)
            target_files.append(rel)

    # 1. Root-level files matching ROOT_INCLUDE_FILES
    for filename in ROOT_INCLUDE_FILES:
        candidate = base_dir / filename
        if candidate.is_file():
            _add(candidate)

    # 2. Directories from INCLUDE_DIRS (plus any extra dirs passed in)
    all_dirs = list(INCLUDE_DIRS)
    if include_patterns:
        all_dirs.extend(include_patterns)

    for dir_path in all_dirs:
        search_dir = base_dir / dir_path
        if search_dir.exists() and search_dir.is_dir():
            for md_file in search_dir.rglob("*.md"):
                if md_file.is_file():
                    _add(md_file)

    # 3. Apply exclude patterns (config defaults + caller-supplied)
    all_excludes = list(EXCLUDE_PATTERNS)
    if exclude_patterns:
        all_excludes.extend(exclude_patterns)

    if all_excludes:
        filtered: List[Path] = []
        for filepath in target_files:
            excluded = False
            for pattern in all_excludes:
                if filepath.match(pattern):
                    excluded = True
                    break
            if not excluded:
                filtered.append(filepath)
        target_files = filtered

    return sorted(target_files)


def is_in_scope(filepath: Union[str, Path]) -> bool:
    """Check if a file is in scope for NotebookLM sync.

    A file is in scope if:
    - Its name is in ROOT_INCLUDE_FILES and it is at the project root (no parent dirs)
    - It lives under one of the INCLUDE_DIRS directories
    - It is not excluded by any EXCLUDE_PATTERNS entry

    Args:
        filepath: Path to check (relative or absolute)

    Returns:
        True if file is in scope, False otherwise.
    """
    path = Path(filepath)
    parts = path.parts
    filepath_str = str(path)

    # Check root-level inclusion by exact filename
    if len(parts) == 1 and path.name in ROOT_INCLUDE_FILES:
        return True

    # Check directory-based inclusion
    in_include_dir = False
    for dir_path in INCLUDE_DIRS:
        if filepath_str.startswith(dir_path + "/") or filepath_str == dir_path:
            in_include_dir = True
            break

    if not in_include_dir:
        return False

    # Apply exclusion patterns
    for pattern in EXCLUDE_PATTERNS:
        if path.match(pattern):
            return False

    return True


class NotebookLMAuthError(Exception):
    """Raised when NotebookLM authentication has expired or is invalid."""
    pass


def _check_auth_error(stdout: str, stderr: str) -> bool:
    """Check if CLI output indicates an authentication error."""
    combined = (stdout + stderr).lower()
    return "authentication expired" in combined or (
        "accounts.google.com" in combined and "signin" in combined
    )


def run_notebooklm_cmd(
    args: List[str],
    capture_json: bool = False,
) -> Tuple[int, Union[str, Dict[str, Any]]]:
    """Execute a notebooklm CLI command.

    Args:
        args: Command arguments (without 'notebooklm' prefix)
        capture_json: If True, parse and return JSON output instead of raw string

    Returns:
        Tuple of (return_code, output_or_parsed_json).
        - return_code: Exit code from subprocess
        - output: Raw string output (if capture_json=False) or parsed dict (if True)
                 Empty string or empty dict on error.

    Raises:
        NotebookLMAuthError: If the CLI reports expired/invalid authentication.
    """
    cmd = ["notebooklm"] + args

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
        )

        # Check for auth errors before processing output
        if result.returncode != 0 and _check_auth_error(result.stdout, result.stderr):
            raise NotebookLMAuthError(
                "NotebookLM authentication expired. Run 'notebooklm login' to re-authenticate."
            )

        if capture_json:
            # Try to parse JSON output
            if result.returncode == 0 and result.stdout.strip():
                try:
                    return result.returncode, json.loads(result.stdout)
                except json.JSONDecodeError as e:
                    print(f"Warning: Failed to parse JSON output: {e}")
                    return result.returncode, {}
            # Also try parsing error JSON (CLI may return JSON errors on stderr)
            if result.returncode != 0 and result.stderr.strip():
                try:
                    err_json = json.loads(result.stderr)
                    if _check_auth_error(json.dumps(err_json), ""):
                        raise NotebookLMAuthError(
                            "NotebookLM authentication expired. Run 'notebooklm login' to re-authenticate."
                        )
                except json.JSONDecodeError:
                    pass
            return result.returncode, {}
        else:
            return result.returncode, result.stdout

    except NotebookLMAuthError:
        raise
    except FileNotFoundError:
        print("Error: 'notebooklm' command not found. Is it installed?")
        return 1, "" if not capture_json else {}
    except Exception as e:
        print(f"Error executing notebooklm command: {e}")
        return 1, "" if not capture_json else {}


def get_notebook_id() -> Optional[str]:
    """Get the initialized notebook ID from the mapping file.

    Returns:
        Notebook ID string, or None if not initialized.
    """
    mapping = load_mapping()
    return mapping.get("notebook_id")


def get_file_mtime(filepath: Path) -> Optional[str]:
    """Get file modification time as ISO timestamp.

    Args:
        filepath: Path to the file to check

    Returns:
        ISO 8601 formatted timestamp string (e.g., "2024-01-30T14:23:45"),
        or None if file doesn't exist.

    Examples:
        >>> mtime = get_file_mtime(Path("README.md"))
        >>> print(mtime)
        2024-01-30T14:23:45
    """
    if not filepath.exists():
        return None

    try:
        mtime_timestamp = filepath.stat().st_mtime
        mtime_dt = datetime.fromtimestamp(mtime_timestamp)
        return mtime_dt.isoformat(timespec="seconds")
    except (OSError, ValueError) as e:
        print(f"Warning: Could not get mtime for {filepath}: {e}")
        return None
