#!/usr/bin/env python3
"""
Migrate markdown frontmatter to CCDash-aligned schema fields.

Modes:
  --scan    Report files missing schema_version/doc_type
  --dry-run Preview migration changes without writing
  --migrate Apply migration changes in place
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml


DEFAULT_DIRECTORIES = [
    "docs/project_plans/PRDs",
    "docs/project_plans/implementation_plans",
    "docs/project_plans/SPIKEs",
    ".claude/progress",
    ".claude/worknotes",
]

LEGACY_TYPE_TO_DOC_TYPE = {
    "progress": "progress",
    "context": "context",
    "bug-fixes": "bug_fix",
    "observations": "observation",
    "quick-feature-plan": "quick_feature",
}

SLUG_PATTERN = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")


@dataclass
class MigrationCandidate:
    path: Path
    metadata: Dict[str, Any]
    body: str
    missing_schema_version: bool
    missing_doc_type: bool


def extract_frontmatter_and_body(path: Path) -> Tuple[Optional[Dict[str, Any]], str]:
    """Extract YAML frontmatter and markdown body."""
    try:
        content = path.read_text(encoding="utf-8")
    except Exception:
        return None, ""

    if not content.startswith("---\n"):
        return None, ""

    match = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.DOTALL)
    if not match:
        return None, ""

    try:
        metadata = yaml.safe_load(match.group(1)) or {}
    except Exception:
        return None, ""

    if not isinstance(metadata, dict):
        return None, ""

    return metadata, match.group(2)


def write_frontmatter_and_body(path: Path, metadata: Dict[str, Any], body: str) -> None:
    """Write updated frontmatter and body."""
    frontmatter = yaml.safe_dump(metadata, default_flow_style=False, sort_keys=False)
    path.write_text(f"---\n{frontmatter}---\n{body}", encoding="utf-8")


def infer_doc_type(path: Path, metadata: Dict[str, Any]) -> Optional[str]:
    """Infer doc_type from existing fields or path heuristics."""
    existing = metadata.get("doc_type")
    if isinstance(existing, str) and existing:
        return existing

    legacy_type = metadata.get("type")
    if isinstance(legacy_type, str) and legacy_type in LEGACY_TYPE_TO_DOC_TYPE:
        return LEGACY_TYPE_TO_DOC_TYPE[legacy_type]

    path_str = f"/{path.as_posix()}"

    if "/docs/project_plans/PRDs/" in path_str:
        return "prd"
    if "/docs/project_plans/SPIKEs/" in path_str:
        return "spike"
    if "/docs/project_plans/implementation_plans/" in path_str:
        if re.search(r"/phase-[0-9]+", path_str) or path.name.startswith("phase-"):
            return "phase_plan"
        return "implementation_plan"

    if "/.claude/progress/quick-features/" in path_str:
        return "quick_feature"
    if "/.claude/progress/" in path_str:
        return "progress"

    if "/.claude/worknotes/observations/" in path_str:
        return "observation"
    if "/.claude/worknotes/fixes/" in path_str:
        return "bug_fix"
    if "/.claude/worknotes/" in path_str:
        return "context"

    if "report" in path.stem.lower():
        return "report"

    return None


def normalize_slug(value: str) -> Optional[str]:
    """Normalize text into a valid kebab-case slug."""
    slug = value.strip().lower()
    slug = slug.replace("_", "-")
    slug = re.sub(r"[^a-z0-9-]", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    if not slug or not SLUG_PATTERN.match(slug):
        return None
    return slug


def infer_feature_slug(path: Path, metadata: Dict[str, Any]) -> Optional[str]:
    """Infer feature_slug from frontmatter or filename conventions."""
    existing = metadata.get("feature_slug")
    if isinstance(existing, str) and existing:
        return existing

    prd = metadata.get("prd")
    if isinstance(prd, str):
        slug = normalize_slug(prd)
        if slug:
            return slug

    stem = path.stem

    if stem.lower() in {"context", "readme", "index"}:
        stem = path.parent.name

    if stem.startswith("phase-") and re.match(r".+-v\d+$", path.parent.name):
        stem = path.parent.name

    stem = re.sub(r"-v\d+$", "", stem)
    stem = re.sub(r"-phase-[0-9]+.*$", "", stem)
    stem = re.sub(r"-progress$", "", stem)

    return normalize_slug(stem)


def find_markdown_files(directories: List[Path]) -> List[Path]:
    """Find markdown files in target directories."""
    files: List[Path] = []
    seen = set()

    for directory in directories:
        if not directory.exists():
            continue

        for path in sorted(directory.rglob("*.md")):
            key = str(path)
            if key in seen:
                continue
            seen.add(key)
            files.append(path)

    return files


def collect_candidates(paths: List[Path]) -> List[MigrationCandidate]:
    """Collect migration candidates that have parseable frontmatter."""
    candidates: List[MigrationCandidate] = []

    for path in paths:
        metadata, body = extract_frontmatter_and_body(path)
        if metadata is None:
            continue

        candidate = MigrationCandidate(
            path=path,
            metadata=metadata,
            body=body,
            missing_schema_version=("schema_version" not in metadata),
            missing_doc_type=("doc_type" not in metadata),
        )
        candidates.append(candidate)

    return candidates


def apply_migration_fields(path: Path, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Return migrated metadata map with inferred defaults."""
    migrated = dict(metadata)

    if "schema_version" not in migrated:
        migrated["schema_version"] = 2

    if "doc_type" not in migrated:
        inferred_doc_type = infer_doc_type(path, migrated)
        if inferred_doc_type is not None:
            migrated["doc_type"] = inferred_doc_type

    if "feature_slug" not in migrated:
        inferred_feature_slug = infer_feature_slug(path, migrated)
        if inferred_feature_slug is not None:
            migrated["feature_slug"] = inferred_feature_slug

    doc_type = migrated.get("doc_type")
    if doc_type == "implementation_plan" and "prd_ref" not in migrated:
        migrated["prd_ref"] = None

    if doc_type == "phase_plan":
        if "prd_ref" not in migrated:
            migrated["prd_ref"] = None
        if "plan_ref" not in migrated:
            migrated["plan_ref"] = None

    if doc_type == "progress":
        if "type" not in migrated:
            migrated["type"] = "progress"
        if "prd" not in migrated:
            inferred_prd = infer_feature_slug(path, migrated)
            if inferred_prd is not None:
                migrated["prd"] = inferred_prd

    if doc_type == "context" and "type" not in migrated:
        migrated["type"] = "context"

    if doc_type == "bug_fix" and "type" not in migrated:
        migrated["type"] = "bug-fixes"

    if doc_type == "observation" and "type" not in migrated:
        migrated["type"] = "observations"

    return migrated


def has_changes(before: Dict[str, Any], after: Dict[str, Any]) -> bool:
    """Check if metadata changed."""
    return before != after


def render_diff(path: Path, old_content: str, new_content: str) -> str:
    """Render unified diff for dry-run preview."""
    diff = difflib.unified_diff(
        old_content.splitlines(keepends=True),
        new_content.splitlines(keepends=True),
        fromfile=f"a/{path}",
        tofile=f"b/{path}",
    )
    return "".join(diff)


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(description="Migrate markdown frontmatter to CCDash schema fields")

    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument("--scan", action="store_true", help="Scan for files missing schema_version/doc_type")
    mode_group.add_argument("--dry-run", action="store_true", help="Preview migration changes without writing")
    mode_group.add_argument("--migrate", action="store_true", help="Apply migration changes")

    parser.add_argument(
        "--directory",
        "-d",
        action="append",
        type=Path,
        help="Directory to include (repeatable). Defaults to project plan/progress/worknotes roots.",
    )

    args = parser.parse_args()

    directories = args.directory or [Path(item) for item in DEFAULT_DIRECTORIES]
    files = find_markdown_files(directories)
    candidates = collect_candidates(files)

    needing_scan = [c for c in candidates if c.missing_schema_version or c.missing_doc_type]

    if args.scan:
        print(f"Scanned files: {len(files)}")
        print(f"Frontmatter files: {len(candidates)}")
        print(f"Missing schema_version/doc_type: {len(needing_scan)}")
        for candidate in needing_scan:
            missing = []
            if candidate.missing_schema_version:
                missing.append("schema_version")
            if candidate.missing_doc_type:
                missing.append("doc_type")
            print(f"- {candidate.path} :: missing {', '.join(missing)}")
        sys.exit(0)

    changed = 0

    for candidate in candidates:
        migrated_metadata = apply_migration_fields(candidate.path, candidate.metadata)
        if not has_changes(candidate.metadata, migrated_metadata):
            continue

        old_content = candidate.path.read_text(encoding="utf-8")
        new_frontmatter = yaml.safe_dump(migrated_metadata, default_flow_style=False, sort_keys=False)
        new_content = f"---\n{new_frontmatter}---\n{candidate.body}"

        if args.dry_run:
            diff = render_diff(candidate.path, old_content, new_content)
            if diff:
                print(diff, end="")
        elif args.migrate:
            write_frontmatter_and_body(candidate.path, migrated_metadata, candidate.body)

        changed += 1

    mode = "Dry-run" if args.dry_run else "Migrated"
    print(f"{mode} files: {changed}")


if __name__ == "__main__":
    main()
