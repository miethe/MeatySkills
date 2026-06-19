#!/usr/bin/env python3
"""
Efficient artifact metadata querying from markdown frontmatter.

Supports legacy artifact filters and CCDash frontmatter filters across planning,
progress, and worknote directories.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml


DEFAULT_DIRECTORIES = [
    "docs/project_plans/PRDs",
    "docs/project_plans/implementation_plans",
    "docs/project_plans/SPIKEs",
    ".claude/progress",
    ".claude/worknotes",
]


@dataclass
class ArtifactMetadata:
    """Lightweight frontmatter metadata record."""

    filepath: str
    type: str
    doc_type: Optional[str]
    title: str
    status: str
    prd: Optional[str] = None
    feature_slug: Optional[str] = None
    priority: Optional[str] = None
    phase: Optional[int] = None
    overall_progress: Optional[int] = None
    owners: Optional[List[str]] = None
    contributors: Optional[List[str]] = None
    started: Optional[str] = None
    completed: Optional[str] = None
    blockers_count: int = 0
    total_tasks: Optional[int] = None
    completed_tasks: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def extract_frontmatter_only(filepath: Path) -> Optional[Dict[str, Any]]:
    """Extract frontmatter without reading full markdown body."""
    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception as exc:
        print(f"Warning: Could not read {filepath}: {exc}", file=sys.stderr)
        return None

    if not content.startswith("---\n"):
        return None

    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return None

    try:
        metadata = yaml.safe_load(match.group(1))
    except Exception as exc:
        print(f"Warning: Invalid YAML frontmatter in {filepath}: {exc}", file=sys.stderr)
        return None

    if not isinstance(metadata, dict):
        return None
    return metadata


def load_artifact_metadata(filepath: Path) -> Optional[ArtifactMetadata]:
    """Load metadata from a markdown file frontmatter."""
    frontmatter = extract_frontmatter_only(filepath)
    if frontmatter is None:
        return None

    owners = frontmatter.get("owners")
    owner = frontmatter.get("owner")
    owners_list: List[str] = []

    if isinstance(owners, list):
        owners_list.extend(str(item) for item in owners)
    if owner and isinstance(owner, str):
        owners_list.append(owner)

    metadata = ArtifactMetadata(
        filepath=str(filepath),
        type=str(frontmatter.get("type") or "unknown"),
        doc_type=frontmatter.get("doc_type"),
        title=str(frontmatter.get("title") or filepath.name),
        status=str(frontmatter.get("status") or "unknown"),
        prd=frontmatter.get("prd") or frontmatter.get("prd_ref"),
        feature_slug=frontmatter.get("feature_slug") or frontmatter.get("prd"),
        priority=frontmatter.get("priority"),
        phase=frontmatter.get("phase"),
        overall_progress=frontmatter.get("overall_progress") or frontmatter.get("progress"),
        owners=owners_list,
        contributors=frontmatter.get("contributors") or [],
        started=frontmatter.get("started"),
        completed=frontmatter.get("completed"),
        blockers_count=len(frontmatter.get("blockers", [])) if isinstance(frontmatter.get("blockers"), list) else 0,
        total_tasks=frontmatter.get("total_tasks"),
        completed_tasks=frontmatter.get("completed_tasks"),
    )
    return metadata


def find_artifacts(directories: List[Path], pattern: str = "*.md") -> List[Path]:
    """Find markdown artifacts in one or more directories."""
    files: List[Path] = []
    seen = set()

    for directory in directories:
        if not directory.exists():
            continue

        for filepath in sorted(directory.rglob(pattern)):
            path_str = str(filepath)
            if path_str in seen:
                continue
            seen.add(path_str)
            files.append(filepath)

    return files


def filter_artifacts(
    artifacts: List[ArtifactMetadata],
    artifact_type: Optional[str] = None,
    doc_type: Optional[str] = None,
    status: Optional[str] = None,
    prd: Optional[str] = None,
    phase: Optional[int] = None,
    owner: Optional[str] = None,
    contributor: Optional[str] = None,
    feature_slug: Optional[str] = None,
    priority: Optional[str] = None,
    has_blockers: Optional[bool] = None,
) -> List[ArtifactMetadata]:
    """Filter metadata records by supported predicates."""
    filtered = artifacts

    if artifact_type:
        filtered = [
            item
            for item in filtered
            if item.type == artifact_type or (item.doc_type is not None and item.doc_type == artifact_type)
        ]

    if doc_type:
        filtered = [item for item in filtered if item.doc_type == doc_type]

    if status:
        filtered = [item for item in filtered if item.status == status]

    if prd:
        filtered = [item for item in filtered if item.prd == prd]

    if phase is not None:
        filtered = [item for item in filtered if item.phase == phase]

    if owner:
        filtered = [item for item in filtered if item.owners and owner in item.owners]

    if contributor:
        filtered = [item for item in filtered if item.contributors and contributor in item.contributors]

    if feature_slug:
        filtered = [item for item in filtered if item.feature_slug == feature_slug]

    if priority:
        filtered = [item for item in filtered if item.priority == priority]

    if has_blockers is not None:
        if has_blockers:
            filtered = [item for item in filtered if item.blockers_count > 0]
        else:
            filtered = [item for item in filtered if item.blockers_count == 0]

    return filtered


def aggregate_metrics(artifacts: List[ArtifactMetadata]) -> Dict[str, Any]:
    """Compute aggregate metrics for query results."""
    if not artifacts:
        return {
            "total_artifacts": 0,
            "by_type": {},
            "by_doc_type": {},
            "by_status": {},
            "by_feature_slug": {},
            "total_blockers": 0,
            "average_progress": 0,
            "total_tasks": 0,
            "completed_tasks": 0,
            "task_completion_rate": 0,
        }

    by_type: Dict[str, int] = {}
    by_doc_type: Dict[str, int] = {}
    by_status: Dict[str, int] = {}
    by_feature_slug: Dict[str, int] = {}

    total_blockers = 0
    progress_values: List[int] = []
    total_tasks = 0
    completed_tasks = 0

    for artifact in artifacts:
        by_type[artifact.type] = by_type.get(artifact.type, 0) + 1
        if artifact.doc_type:
            by_doc_type[artifact.doc_type] = by_doc_type.get(artifact.doc_type, 0) + 1
        by_status[artifact.status] = by_status.get(artifact.status, 0) + 1

        if artifact.feature_slug:
            by_feature_slug[artifact.feature_slug] = by_feature_slug.get(artifact.feature_slug, 0) + 1

        total_blockers += artifact.blockers_count

        if artifact.overall_progress is not None:
            progress_values.append(int(artifact.overall_progress))

        if artifact.total_tasks is not None:
            total_tasks += int(artifact.total_tasks)
        if artifact.completed_tasks is not None:
            completed_tasks += int(artifact.completed_tasks)

    average_progress = sum(progress_values) / len(progress_values) if progress_values else 0

    return {
        "total_artifacts": len(artifacts),
        "by_type": by_type,
        "by_doc_type": by_doc_type,
        "by_status": by_status,
        "by_feature_slug": by_feature_slug,
        "total_blockers": total_blockers,
        "average_progress": round(average_progress, 1),
        "total_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "task_completion_rate": round((completed_tasks / total_tasks * 100), 1) if total_tasks else 0,
    }


def format_table_output(artifacts: List[ArtifactMetadata]) -> str:
    """Render table output for terminal use."""
    if not artifacts:
        return "No artifacts found."

    lines = [
        "=" * 124,
        f"Found {len(artifacts)} artifact(s)",
        "=" * 124,
        f"{'DocType':<20} {'Status':<14} {'Feature':<24} {'Priority':<10} {'Phase':<6} {'Title':<38}",
        "-" * 124,
    ]

    for artifact in artifacts:
        doc_type = (artifact.doc_type or artifact.type or "unknown")[:19]
        status = artifact.status[:13]
        feature = (artifact.feature_slug or "N/A")[:23]
        priority = (artifact.priority or "N/A")[:9]
        phase = str(artifact.phase) if artifact.phase is not None else "N/A"
        title = artifact.title[:37]
        lines.append(f"{doc_type:<20} {status:<14} {feature:<24} {priority:<10} {phase:<6} {title:<38}")

    lines.append("=" * 124)
    return "\n".join(lines)


def format_json_output(artifacts: List[ArtifactMetadata]) -> str:
    """Render JSON output."""
    return json.dumps([artifact.to_dict() for artifact in artifacts], indent=2)


def format_summary_output(artifacts: List[ArtifactMetadata]) -> str:
    """Render aggregate summary output."""
    metrics = aggregate_metrics(artifacts)
    lines = [
        "=" * 70,
        "Artifact Query Summary",
        "=" * 70,
        f"Total Artifacts: {metrics['total_artifacts']}",
        "",
        "By Legacy Type:",
    ]

    for key, value in sorted(metrics["by_type"].items()):
        lines.append(f"  {key}: {value}")

    lines.append("")
    lines.append("By Doc Type:")
    for key, value in sorted(metrics["by_doc_type"].items()):
        lines.append(f"  {key}: {value}")

    lines.append("")
    lines.append("By Status:")
    for key, value in sorted(metrics["by_status"].items()):
        lines.append(f"  {key}: {value}")

    if metrics["by_feature_slug"]:
        lines.append("")
        lines.append("By Feature Slug:")
        for key, value in sorted(metrics["by_feature_slug"].items()):
            lines.append(f"  {key}: {value}")

    lines.extend(
        [
            "",
            f"Total Blockers: {metrics['total_blockers']}",
            f"Average Progress: {metrics['average_progress']}%",
            f"Total Tasks: {metrics['total_tasks']}",
            f"Completed Tasks: {metrics['completed_tasks']}",
            f"Task Completion Rate: {metrics['task_completion_rate']}%",
            "=" * 70,
        ]
    )
    return "\n".join(lines)


def query_artifacts(
    directories: List[Path],
    artifact_type: Optional[str] = None,
    doc_type: Optional[str] = None,
    status: Optional[str] = None,
    prd: Optional[str] = None,
    phase: Optional[int] = None,
    owner: Optional[str] = None,
    contributor: Optional[str] = None,
    feature_slug: Optional[str] = None,
    priority: Optional[str] = None,
    has_blockers: Optional[bool] = None,
    output_format: str = "table",
    aggregate: bool = False,
) -> str:
    """Query metadata and return formatted results."""
    filepaths = find_artifacts(directories)

    artifacts: List[ArtifactMetadata] = []
    for filepath in filepaths:
        metadata = load_artifact_metadata(filepath)
        if metadata:
            artifacts.append(metadata)

    filtered = filter_artifacts(
        artifacts,
        artifact_type=artifact_type,
        doc_type=doc_type,
        status=status,
        prd=prd,
        phase=phase,
        owner=owner,
        contributor=contributor,
        feature_slug=feature_slug,
        priority=priority,
        has_blockers=has_blockers,
    )

    if aggregate or output_format == "summary":
        return format_summary_output(filtered)
    if output_format == "json":
        return format_json_output(filtered)
    return format_table_output(filtered)


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(
        description="Query artifact metadata from markdown frontmatter",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python query_artifacts.py --status in-progress
  python query_artifacts.py --doc-type prd --priority high
  python query_artifacts.py --directory .claude/progress --type progress --format json
""",
    )

    parser.add_argument(
        "--directory",
        "-d",
        action="append",
        type=Path,
        help="Directory to search (repeatable). Defaults to project planning/progress/worknotes roots.",
    )
    parser.add_argument("--type", "-t", help="Legacy type filter (e.g., progress, context)")
    parser.add_argument("--doc-type", help="CCDash doc_type filter (e.g., prd, implementation_plan)")
    parser.add_argument("--status", "-s", help="Filter by status")
    parser.add_argument("--prd", "-p", help="Filter by prd/prd_ref")
    parser.add_argument("--phase", type=int, help="Filter by phase number")
    parser.add_argument("--owner", "-o", help="Filter by owner")
    parser.add_argument("--contributor", "-c", help="Filter by contributor")
    parser.add_argument("--feature-slug", help="Filter by feature_slug")
    parser.add_argument("--priority", help="Filter by priority")
    parser.add_argument("--has-blockers", action="store_true", help="Only results with blockers")
    parser.add_argument("--no-blockers", action="store_true", help="Only results without blockers")
    parser.add_argument("--format", "-f", choices=["table", "json", "summary"], default="table")
    parser.add_argument("--aggregate", "-a", action="store_true", help="Show aggregate metrics")

    args = parser.parse_args()

    if args.has_blockers and args.no_blockers:
        print("Error: Cannot use --has-blockers and --no-blockers together", file=sys.stderr)
        sys.exit(1)

    has_blockers = True if args.has_blockers else False if args.no_blockers else None

    directories = args.directory or [Path(path) for path in DEFAULT_DIRECTORIES]

    try:
        result = query_artifacts(
            directories=directories,
            artifact_type=args.type,
            doc_type=args.doc_type,
            status=args.status,
            prd=args.prd,
            phase=args.phase,
            owner=args.owner,
            contributor=args.contributor,
            feature_slug=args.feature_slug,
            priority=args.priority,
            has_blockers=has_blockers,
            output_format=args.format,
            aggregate=args.aggregate,
        )
        print(result)
        sys.exit(0)
    except Exception as exc:  # pragma: no cover - defensive CLI error path
        print(f"Error querying artifacts: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
