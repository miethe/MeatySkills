#!/usr/bin/env python3
"""Install the NotebookLM sync system into a target project.

Deploys scripts, config, and Claude Code hook into any project directory.

Usage:
  python .claude/skills/notebooklm-sync/scripts/install.py [options]

Options:
  --project-name NAME       Project name (default: inferred from directory name)
  --notebook-title TITLE    NotebookLM notebook title (default: project name)
  --include-dirs DIR        Directories to sync, repeatable (default: ["docs"])
  --root-files FILE         Root-level files to sync, repeatable (default: ["README.md", "CHANGELOG.md"])
  --exclude-patterns PAT    Glob patterns to exclude, repeatable
  --target-dir DIR          Target project directory (default: cwd)
  --dry-run                 Show what would be done
  --no-hook                 Skip hook installation
  --no-init                 Skip running init.py after install
  --force                   Overwrite existing installation
  --preserve-config         Preserve existing config.py on --force (default when --force)
  --no-preserve-config      Render fresh config.py even on --force
  --update                  Re-deploy scripts only: equivalent to --force --no-hook --no-init
                            (preserves config.py by default)
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from string import Template

# Skill dir is one level above this scripts/ directory
SKILL_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = SKILL_DIR / "assets"
PAYLOAD_DIR = ASSETS_DIR / "payload"
CONFIG_TEMPLATE = ASSETS_DIR / "config.py.template"
HOOK_SH = ASSETS_DIR / "hook.sh"


def slugify(name: str) -> str:
    """Convert a project name to a safe slug for use in filenames.

    Args:
        name: Project name string

    Returns:
        Lowercase slug with non-alphanumeric characters replaced by hyphens
    """
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug


def render_config(
    project_slug: str,
    notebook_title: str,
    root_files: list[str],
    include_dirs: list[str],
    exclude_patterns: list[str],
) -> str:
    """Render the config.py template with the given values.

    Args:
        project_slug: Slug used for the mapping file name
        notebook_title: Default notebook title
        root_files: List of root-level files to include
        include_dirs: List of directories to include recursively
        exclude_patterns: List of glob patterns to exclude

    Returns:
        Rendered config.py content as a string
    """
    template_text = CONFIG_TEMPLATE.read_text()

    # Use repr() so Python list literals are valid Python syntax
    rendered = template_text.format(
        root_files=repr(root_files),
        include_dirs=repr(include_dirs),
        exclude_patterns=repr(exclude_patterns),
        project_slug=project_slug,
        notebook_title=notebook_title,
    )
    return rendered


def patch_settings_json(settings_path: Path, dry_run: bool = False) -> bool:
    """Add the NotebookLM sync hook entry to .claude/settings.json.

    Reads the existing settings, finds or creates the hooks.PostToolUse array,
    and appends the hook entry if not already present. Writes back with indent=2.

    Args:
        settings_path: Path to the settings.json file
        dry_run: If True, show what would be done without writing

    Returns:
        True if the file was (or would be) modified, False if already present
    """
    hook_entry = {
        "_comment": "NotebookLM sync hook - syncs markdown docs to NotebookLM when modified. Logs to ~/.notebooklm/sync.log",
        "matcher": "Write|Edit",
        "hooks": [
            {
                "type": "command",
                "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/notebooklm-sync-hook.sh",
            }
        ],
    }

    # Load existing settings (or start fresh)
    if settings_path.exists():
        try:
            with open(settings_path, "r") as f:
                settings = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"  Warning: Could not parse {settings_path}: {e}")
            settings = {}
    else:
        settings = {}

    # Navigate to hooks.PostToolUse, creating intermediate keys as needed
    if "hooks" not in settings:
        settings["hooks"] = {}
    if "PostToolUse" not in settings["hooks"]:
        settings["hooks"]["PostToolUse"] = []

    post_tool_use = settings["hooks"]["PostToolUse"]

    # Check if the hook is already present (by command value)
    hook_command = hook_entry["hooks"][0]["command"]
    for existing in post_tool_use:
        for h in existing.get("hooks", []):
            if h.get("command") == hook_command:
                print(f"  Hook already present in {settings_path}, skipping.")
                return False

    if dry_run:
        print(f"  [DRY RUN] Would append NotebookLM hook to {settings_path}")
        return True

    post_tool_use.append(hook_entry)

    settings_path.parent.mkdir(parents=True, exist_ok=True)
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")

    return True


def install(
    project_name: str | None = None,
    notebook_title: str | None = None,
    include_dirs: list[str] | None = None,
    root_files: list[str] | None = None,
    exclude_patterns: list[str] | None = None,
    target_dir: Path | None = None,
    dry_run: bool = False,
    no_hook: bool = False,
    no_init: bool = False,
    force: bool = False,
    preserve_config: bool | None = None,
    config_args_explicit: bool = False,
) -> int:
    """Deploy the NotebookLM sync system into the target project.

    Args:
        project_name: Project name (inferred from directory if not given)
        notebook_title: NotebookLM notebook title (defaults to project_name)
        include_dirs: Directories to sync recursively
        root_files: Root-level files to include
        exclude_patterns: Glob patterns to exclude
        target_dir: Target project directory (defaults to cwd)
        dry_run: Show what would be done without executing
        no_hook: Skip Claude Code hook installation
        no_init: Skip running init.py after install
        force: Overwrite existing installation
        preserve_config: Preserve existing config.py on --force (default: True when force=True).
            Ignored when config_args_explicit=True.
        config_args_explicit: True when the caller explicitly passed config-related args
            (--include-dirs, --root-files, --exclude-patterns, --notebook-title), which
            forces a fresh config render even if preserve_config is True.

    Returns:
        Exit code (0 = success, 1 = failure)
    """
    # preserve_config defaults to True when --force is used
    if preserve_config is None:
        preserve_config = force
    target = (target_dir or Path.cwd()).resolve()

    # Infer project name from directory
    if not project_name:
        project_name = target.name

    if not notebook_title:
        notebook_title = project_name

    # Apply defaults
    if include_dirs is None:
        include_dirs = ["docs"]
    if root_files is None:
        root_files = ["README.md", "CHANGELOG.md"]
    if exclude_patterns is None:
        exclude_patterns = []

    project_slug = slugify(project_name)

    print(f"Installing NotebookLM sync into: {target}")
    print(f"  Project name:    {project_name}")
    print(f"  Notebook title:  {notebook_title}")
    print(f"  Project slug:    {project_slug}")
    print(f"  Include dirs:    {include_dirs}")
    print(f"  Root files:      {root_files}")
    if exclude_patterns:
        print(f"  Exclude:         {exclude_patterns}")
    print()

    # --- 1. Copy payload scripts ---
    dest_scripts = target / "scripts" / "notebooklm_sync"

    if dest_scripts.exists() and not force:
        print(f"Error: {dest_scripts} already exists. Use --force to overwrite.")
        return 1

    # Determine whether we will restore an existing config.py after the copy
    existing_config = dest_scripts / "config.py"
    should_restore_config = (
        force
        and preserve_config
        and not config_args_explicit
        and existing_config.exists()
    )

    if dry_run:
        print(f"[DRY RUN] Would copy payload to: {dest_scripts}")
        if should_restore_config:
            print(f"[DRY RUN] Would preserve existing config.py (use --no-preserve-config to override)")
    else:
        saved_config: str | None = None
        if dest_scripts.exists():
            if should_restore_config:
                saved_config = existing_config.read_text()
            shutil.rmtree(dest_scripts)
        shutil.copytree(str(PAYLOAD_DIR), str(dest_scripts))
        print(f"Copied scripts to: {dest_scripts}")
        if saved_config is not None:
            existing_config.write_text(saved_config)
            print("Preserved existing config.py")

    # --- 2. Render and write config.py ---
    # Skip rendering if we already restored the existing config above.
    config_dest = dest_scripts / "config.py"
    skip_config_render = not dry_run and should_restore_config

    if not skip_config_render:
        config_content = render_config(
            project_slug=project_slug,
            notebook_title=notebook_title,
            root_files=root_files,
            include_dirs=include_dirs,
            exclude_patterns=exclude_patterns,
        )

        if dry_run:
            print(f"[DRY RUN] Would write config to: {config_dest}")
        else:
            config_dest.write_text(config_content)
            print(f"Wrote config to: {config_dest}")

    # --- 3. Install Claude Code hook ---
    if not no_hook:
        hooks_dir = target / ".claude" / "hooks"
        hook_dest = hooks_dir / "notebooklm-sync-hook.sh"

        if dry_run:
            print(f"[DRY RUN] Would copy hook to: {hook_dest}")
            print(f"[DRY RUN] Would patch: {target / '.claude' / 'settings.json'}")
        else:
            hooks_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(HOOK_SH), str(hook_dest))
            hook_dest.chmod(hook_dest.stat().st_mode | 0o755)
            print(f"Installed hook: {hook_dest}")

            settings_path = target / ".claude" / "settings.json"
            patch_settings_json(settings_path, dry_run=False)
            print(f"Patched settings: {settings_path}")
    else:
        print("Skipping hook installation (--no-hook).")

    # --- 4. Run init.py ---
    if not no_init and not dry_run:
        print()
        print(f"Running init.py --notebook-title '{notebook_title}'...")
        init_script = dest_scripts / "init.py"
        result = subprocess.run(
            [sys.executable, str(init_script), "--notebook-title", notebook_title],
            cwd=str(target),
        )
        if result.returncode != 0:
            print(f"Warning: init.py exited with code {result.returncode}")
    elif no_init:
        print()
        print("Skipping init.py (--no-init).")
    elif dry_run:
        print(f"[DRY RUN] Would run: python {dest_scripts / 'init.py'} --notebook-title '{notebook_title}'")

    print()
    print("Installation complete.")
    return 0


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Install the NotebookLM sync system into a project",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Install with defaults into current directory
  python .claude/skills/notebooklm-sync/scripts/install.py

  # Install with custom settings
  python .claude/skills/notebooklm-sync/scripts/install.py \\
    --project-name "MyProject" \\
    --notebook-title "MyProject Docs" \\
    --include-dirs docs --include-dirs notes \\
    --root-files README.md

  # Dry run to preview
  python .claude/skills/notebooklm-sync/scripts/install.py --dry-run

  # Install into a different directory
  python .claude/skills/notebooklm-sync/scripts/install.py --target-dir /path/to/project

  # Reinstall (overwrite existing)
  python .claude/skills/notebooklm-sync/scripts/install.py --force

  # Reinstall but render a fresh config (discard customizations)
  python .claude/skills/notebooklm-sync/scripts/install.py --force --no-preserve-config

  # Re-deploy scripts only (common case: updated payload, keep config, no hook/init)
  python .claude/skills/notebooklm-sync/scripts/install.py --update
        """.strip(),
    )

    parser.add_argument(
        "--project-name",
        metavar="NAME",
        help="Project name (default: inferred from directory name)",
    )
    parser.add_argument(
        "--notebook-title",
        metavar="TITLE",
        help="NotebookLM notebook title (default: project name)",
    )
    parser.add_argument(
        "--include-dirs",
        action="append",
        metavar="DIR",
        dest="include_dirs",
        help="Directories to sync recursively (repeatable, default: docs)",
    )
    parser.add_argument(
        "--root-files",
        action="append",
        metavar="FILE",
        dest="root_files",
        help="Root-level files to sync (repeatable, default: README.md CHANGELOG.md)",
    )
    parser.add_argument(
        "--exclude-patterns",
        action="append",
        metavar="PAT",
        dest="exclude_patterns",
        help="Glob patterns to exclude (repeatable)",
    )
    parser.add_argument(
        "--target-dir",
        metavar="DIR",
        help="Target project directory (default: current directory)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without making changes",
    )
    parser.add_argument(
        "--no-hook",
        action="store_true",
        help="Skip Claude Code hook installation",
    )
    parser.add_argument(
        "--no-init",
        action="store_true",
        help="Skip running init.py after install",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing installation",
    )
    # --preserve-config / --no-preserve-config use store_true / store_false on the same dest.
    # Neither flag sets a default here; parser.set_defaults below leaves the value as None
    # when neither flag is passed, letting install() apply its own "default to force" logic.
    parser.add_argument(
        "--preserve-config",
        action="store_true",
        dest="preserve_config",
        help="Preserve existing config.py when using --force (default when --force is set)",
    )
    parser.add_argument(
        "--no-preserve-config",
        action="store_false",
        dest="preserve_config",
        help="Render a fresh config.py even when using --force",
    )
    parser.set_defaults(preserve_config=None)
    parser.add_argument(
        "--update",
        action="store_true",
        help=(
            "Re-deploy script files only: equivalent to --force --no-hook --no-init. "
            "Preserves existing config.py by default."
        ),
    )

    args = parser.parse_args()

    # --update expands to --force --no-hook --no-init
    force = args.force or args.update
    no_hook = args.no_hook or args.update
    no_init = args.no_init or args.update

    # Detect whether any config-related args were explicitly provided by the user
    config_args_explicit = any([
        args.notebook_title is not None,
        args.include_dirs is not None,
        args.root_files is not None,
        args.exclude_patterns is not None,
    ])

    target_dir = Path(args.target_dir) if args.target_dir else None

    return install(
        project_name=args.project_name,
        notebook_title=args.notebook_title,
        include_dirs=args.include_dirs,
        root_files=args.root_files,
        exclude_patterns=args.exclude_patterns,
        target_dir=target_dir,
        dry_run=args.dry_run,
        no_hook=no_hook,
        no_init=no_init,
        force=force,
        preserve_config=args.preserve_config,
        config_args_explicit=config_args_explicit,
    )


if __name__ == "__main__":
    sys.exit(main())
