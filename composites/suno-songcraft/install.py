#!/usr/bin/env python3
"""Install these local Codex skills without overwriting existing skills by default.
Python 3.10+, standard library only. No network, account access, or AGENTS.md edits.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
NAMES = ('suno-songcraft', 'genre-lyricist')


def install(destination: Path, names: tuple[str, ...] = NAMES, *, dry_run: bool = False,
            replace_with_backup: bool = False, source_root: Path = ROOT) -> list[dict[str, str]]:
    """Preflight all targets, then install each atomically with per-skill rollback."""
    dest = destination.expanduser().resolve()
    if not names or len(set(names)) != len(names) or any(n not in NAMES for n in names):
        raise ValueError('Choose one or both distinct skill names from the bundle.')
    plan: list[tuple[str, Path, Path]] = []
    for name in names:
        source = (source_root/'skills'/name).resolve()
        target = dest/name
        if not (source/'SKILL.md').is_file():
            raise FileNotFoundError(f'Missing skill entrypoint: {source}')
        if target.resolve() == source or source in target.resolve().parents:
            raise ValueError('Destination cannot be inside the source skill.')
        if (target.exists() or target.is_symlink()) and not replace_with_backup:
            raise FileExistsError(f'{target} already exists; use --replace-with-backup explicitly to update.')
        plan.append((name, source, target))
    records: list[dict[str, str]] = []
    if dry_run:
        return [dict(name=n, destination=str(t), action='would replace with backup' if t.exists() or t.is_symlink() else 'would install') for n, s, t in plan]
    dest.mkdir(parents=True, exist_ok=True)
    for name, source, target in plan:
        # Keep temporary installs and backups outside the skills discovery directory.
        stage_root = Path(tempfile.mkdtemp(prefix='.songcraft-stage-', dir=dest.parent))
        staged = stage_root/name
        backup: Path | None = None
        try:
            shutil.copytree(source, staged, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
            if target.exists() or target.is_symlink():
                backups = dest.parent/'.skill-backups'
                backups.mkdir(parents=True, exist_ok=True)
                stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
                backup = backups/f'{name}-{stamp}'
                target.rename(backup)
            try:
                staged.rename(target)
            except OSError:
                if backup is not None and not (target.exists() or target.is_symlink()):
                    backup.rename(target)
                raise
            record = dict(name=name, destination=str(target), action='installed')
            if backup is not None: record['backup'] = str(backup)
            records.append(record)
        finally:
            shutil.rmtree(stage_root, ignore_errors=True)
    return records


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dest', type=Path, default=Path.home()/'.agents/skills')
    parser.add_argument('--only', choices=NAMES)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--replace-with-backup', action='store_true')
    args = parser.parse_args(argv)
    try:
        records = install(args.dest, (args.only,) if args.only else NAMES,
                          dry_run=args.dry_run, replace_with_backup=args.replace_with_backup)
        for row in records:
            print(f"{row['action']}: {row['name']} -> {row['destination']}")
            if 'backup' in row: print(f"  Previous version: {row['backup']}")
        if not args.dry_run:
            print('Installed local files only. Invoke the skills in Codex; restart it if discovery has not refreshed.')
        return 0
    except (OSError, ValueError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
