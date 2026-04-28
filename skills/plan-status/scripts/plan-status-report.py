#!/usr/bin/env python3
"""
Cross-feature plan status report and triage tool.

Routes:
  Route 1  -- Status Report          (--period / --all)
  Route 2  -- Mismatch Audit         (--mismatches-only)
  Route 6  -- Pre-Plan Intake Status (--route6)
  Route 7  -- Findings Triage        (--route7)
  Route 8  -- Ready to Implement     (--route8)

Discovery flags (additive, default = prd + implementation_plan + progress):
  --include-pre-plan  add design-spec
  --include-meta      add meta-plan
  --include-reports   add report
  --all-types         all three extensions enabled

No new Python dependencies beyond PyYAML (already required by artifact-tracking).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

# ---------------------------------------------------------------------------
# Shared helpers (mirror manage-plan-status.py patterns — no import needed)
# ---------------------------------------------------------------------------

_SCRIPT_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
# .claude/skills/plan-status/scripts/plan-status-report.py
# → parent×4 = repo root  (.claude/skills/plan-status/scripts → plan-status → skills → .claude → repo)
# Overridden at runtime by main() — all consumers read this module attribute lazily
REPO_ROOT = _SCRIPT_REPO_ROOT

# Default scan sets (always included)
DEFAULT_DIRS: Dict[str, List[str]] = {
    "prd": ["docs/project_plans/PRDs"],
    "implementation": ["docs/project_plans/implementation_plans"],
    "progress": [".claude/progress"],
}

# Extension sets (opt-in)
PRE_PLAN_DIRS: Dict[str, List[str]] = {
    "design-spec": ["docs/project_plans/design-specs"],
}

META_DIRS: Dict[str, List[str]] = {
    "meta-plan": [".claude/plans", "docs/project_plans/meta-plans"],
}

REPORT_DIRS: Dict[str, List[str]] = {
    "report": ["docs/project_plans/reports", ".claude/findings"],
}

FINDINGS_DIR = ".claude/findings"

# Statuses treated as "non-complete intentional states" — never auto-fix
INTENTIONAL_NON_COMPLETE = {
    "deferred",
    "future",
    "blocked",
    "partial",
    "deviated",
    "at_risk",
    "shelved",
    "superseded",
    "abandoned",
}

# Canonical "done" statuses
_DONE_STATUSES = {"completed", "complete", "done"}

# Type ordering for per-type table output
TYPE_ORDER = [
    "prd",
    "implementation",
    "progress",
    "design-spec",
    "meta-plan",
    "report",
    "unknown",
]


def _read_frontmatter(filepath: Path) -> Optional[Dict[str, Any]]:
    """Return parsed YAML frontmatter or None on any error."""
    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception:
        return None
    if not content.startswith("---\n"):
        return None
    match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return None
    try:
        fm = yaml.safe_load(match.group(1)) or {}
    except Exception:
        return None
    return fm if isinstance(fm, dict) else None


def _parse_date_field(value: Any) -> Optional[date]:
    """Parse a frontmatter date value to a date object."""
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
            try:
                return datetime.strptime(value, fmt).date()
            except ValueError:
                pass
    return None


def _fmt_date(value: Any) -> str:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value) if value else "unknown"


def _git_first_commit_date(filepath: Path) -> Optional[date]:
    """Return the date of the first commit that introduced *filepath*."""
    try:
        result = subprocess.run(
            [
                "git",
                "log",
                "--diff-filter=A",
                "--follow",
                "--format=%as",
                "--",
                str(filepath),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        lines = result.stdout.strip().splitlines()
        if lines:
            # git log is newest-first; last entry = original add
            d = _parse_date_field(lines[-1].strip())
            return d
    except Exception:
        pass
    return None


def _git_first_author(filepath: Path) -> str:
    """Return the git author who first committed *filepath*."""
    try:
        result = subprocess.run(
            [
                "git",
                "log",
                "--diff-filter=A",
                "--follow",
                "--format=%an",
                "--",
                str(filepath),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
        )
        lines = result.stdout.strip().splitlines()
        if lines:
            return lines[-1].strip()
    except Exception:
        pass
    return "unknown"


def _has_downstream_ref(filepath: Path, all_docs: List[Path]) -> bool:
    """Return True if any other doc references *filepath* in its frontmatter."""
    target = str(filepath)
    target_stem = filepath.stem
    for doc in all_docs:
        if doc == filepath:
            continue
        fm = _read_frontmatter(doc)
        if not fm:
            continue
        # Check prd_ref, plan_ref, related_documents, superseded_by
        for field in (
            "prd_ref",
            "plan_ref",
            "related_documents",
            "superseded_by",
            "promoted_to",
        ):
            val = fm.get(field)
            if val is None:
                continue
            refs = val if isinstance(val, list) else [val]
            for ref in refs:
                ref_str = str(ref) if ref else ""
                if target_stem in ref_str or target in ref_str:
                    return True
    return False


def _build_active_dirs(
    include_pre_plan: bool,
    include_meta: bool,
    include_reports: bool,
) -> Dict[str, List[str]]:
    """Combine DEFAULT_DIRS with any enabled extension sets."""
    dirs: Dict[str, List[str]] = dict(DEFAULT_DIRS)
    if include_pre_plan:
        dirs.update(PRE_PLAN_DIRS)
    if include_meta:
        dirs.update(META_DIRS)
    if include_reports:
        dirs.update(REPORT_DIRS)
    return dirs


def _scanned_types_header(
    include_pre_plan: bool,
    include_meta: bool,
    include_reports: bool,
) -> str:
    types = ["prd", "implementation_plan", "progress"]
    if include_pre_plan:
        types.append("design-spec")
    if include_meta:
        types.append("meta-plan")
    if include_reports:
        types.append("report")
    return f"Scanned: {', '.join(types)}"


# ---------------------------------------------------------------------------
# Route 1 + 2: Status report and mismatch audit
# ---------------------------------------------------------------------------


def _infer_type(frontmatter: Dict[str, Any], filepath: Path) -> str:
    dt = str(frontmatter.get("doc_type") or "")
    ps = str(filepath).replace("\\", "/")
    if (
        dt in ("phase_plan", "progress")
        or "/.claude/progress/" in ps
        or ps.startswith(".claude/progress/")
    ):
        return "progress"
    if dt == "implementation_plan" or "/implementation_plans/" in ps:
        if "/phase-" in ps:
            return "progress"
        return "implementation"
    if dt == "prd" or "/PRDs/" in ps:
        return "prd"
    if dt == "design_spec" or "/design-specs/" in ps:
        return "design-spec"
    if (
        dt == "meta_plan"
        or "/.claude/plans/" in ps
        or ps.startswith(".claude/plans/")
        or "/project_plans/meta-plans/" in ps
    ):
        return "meta-plan"
    if (
        dt == "report"
        or "/reports/" in ps
        or "/.claude/findings/" in ps
        or ps.startswith(".claude/findings/")
    ):
        return "report"
    return "unknown"


def _collect_docs(
    active_dirs: Dict[str, List[str]],
    period_days: Optional[int],
) -> List[Dict[str, Any]]:
    """Collect all planning docs from active directories."""
    cutoff = (date.today() - timedelta(days=period_days)) if period_days else None
    results: List[Dict[str, Any]] = []
    seen: set = set()

    for dir_list in active_dirs.values():
        for dir_str in dir_list:
            dirpath = REPO_ROOT / dir_str
            if not dirpath.exists():
                continue
            for filepath in sorted(dirpath.rglob("*.md")):
                if str(filepath) in seen:
                    continue
                seen.add(str(filepath))

                if cutoff:
                    mtime = date.fromtimestamp(filepath.stat().st_mtime)
                    if mtime < cutoff:
                        continue

                fm = _read_frontmatter(filepath)
                status = fm.get("status", "not set") if fm else "no-frontmatter"
                doc_type = _infer_type(fm or {}, filepath)
                updated = fm.get("updated") if fm else None
                created = fm.get("created") if fm else None

                results.append(
                    {
                        "file": str(filepath.relative_to(REPO_ROOT)),
                        "title": (
                            fm.get("title", filepath.name) if fm else filepath.name
                        ),
                        "status": status,
                        "type": doc_type,
                        "created": _fmt_date(created),
                        "updated": _fmt_date(updated),
                        "frontmatter": fm,
                        # populated by _propagate_status
                        "effective_status": status,
                        "status_source": "raw",
                        # convenience fields from frontmatter
                        "feature_slug": (fm or {}).get("feature_slug") or "",
                        "prd_ref": (fm or {}).get("prd_ref") or "",
                        "plan_ref": (fm or {}).get("plan_ref") or "",
                    }
                )

    return results


# ---------------------------------------------------------------------------
# Status propagation
# ---------------------------------------------------------------------------


def _normalize_status(s: str) -> str:
    """Map synonym statuses to a canonical form for comparison only."""
    return s.lower().strip()


def _is_done(s: str) -> bool:
    return _normalize_status(s) in _DONE_STATUSES


def _progress_rollup(progress_docs: List[Dict[str, Any]]) -> str:
    """
    Compute a rollup status across a group's progress files.

    Returns one of: "completed", "in-progress", "planned".
    """
    if not progress_docs:
        return "planned"

    all_completed = True
    any_active = False

    for doc in progress_docs:
        raw = _normalize_status(doc["status"])
        fm = doc.get("frontmatter") or {}
        tasks = fm.get("tasks", [])
        dict_tasks = [t for t in tasks if isinstance(t, dict)]

        if raw in ("in-progress", "in_progress", "at_risk"):
            any_active = True
            all_completed = False
        elif _is_done(raw):
            # Also verify all tasks (if present) are done
            if dict_tasks:
                tasks_done = all(
                    t.get("status") in ("completed", "done") for t in dict_tasks
                )
                if not tasks_done:
                    all_completed = False
                    any_active = True
        else:
            # planned, draft, not set, etc.
            all_completed = False

    if all_completed:
        return "completed"
    if any_active:
        return "in-progress"
    return "planned"


def _propagate_status(docs: List[Dict[str, Any]]) -> None:
    """
    Compute effective_status and status_source for every doc in-place.

    Groups docs by feature_slug, then:
    - progress rollup from all progress docs in the group
    - impl plan: if raw is done → keep; else if rollup==completed → inferred
    - PRD: if any impl plan effective==completed → inferred from plan;
           elif rollup==completed → inferred from progress; else raw
    Falls back to prd_ref/plan_ref cross-linking when feature_slug is absent.
    """
    # --- 1. Build slug groups ---
    by_slug: Dict[str, List[Dict[str, Any]]] = {}
    no_slug: List[Dict[str, Any]] = []

    for doc in docs:
        slug = doc.get("feature_slug") or ""
        if slug:
            by_slug.setdefault(slug, []).append(doc)
        else:
            no_slug.append(doc)

    # --- 2. Build a secondary cross-reference index (prd_ref / plan_ref) ---
    # file → doc mapping
    file_index: Dict[str, Dict[str, Any]] = {d["file"]: d for d in docs}

    # --- 3. Process each slug group ---
    for slug, group in by_slug.items():
        prds = [d for d in group if d["type"] == "prd"]
        impls = [d for d in group if d["type"] == "implementation"]
        progresses = [d for d in group if d["type"] == "progress"]

        rollup = _progress_rollup(progresses)

        # -- impl plans --
        for impl in impls:
            if _is_done(impl["status"]):
                impl["effective_status"] = impl["status"]
                impl["status_source"] = "raw"
            elif rollup == "completed":
                impl["effective_status"] = "completed (inferred)"
                impl["status_source"] = "inferred_from_progress"
            else:
                impl["effective_status"] = impl["status"]
                impl["status_source"] = "raw"

        # -- PRDs --
        any_impl_completed = any(
            _is_done(impl["effective_status"].replace(" (inferred)", ""))
            for impl in impls
        )
        for prd in prds:
            if any_impl_completed:
                prd["effective_status"] = "completed (inferred from plan)"
                prd["status_source"] = "inferred_from_plan"
            elif rollup == "completed":
                prd["effective_status"] = "completed (inferred from progress)"
                prd["status_source"] = "inferred_from_progress"
            else:
                prd["effective_status"] = prd["status"]
                prd["status_source"] = "raw"

        # Non-PRD/impl/progress docs in the group (design-spec, etc.) keep raw
        for doc in group:
            if doc["type"] not in ("prd", "implementation", "progress"):
                doc["effective_status"] = doc["status"]
                doc["status_source"] = "raw"

    # --- 4. Handle cross-links for docs without a slug ---
    for doc in no_slug:
        fm = doc.get("frontmatter") or {}

        # Try to find a partner via prd_ref / plan_ref
        partner_file = fm.get("prd_ref") or fm.get("plan_ref") or ""
        if partner_file:
            # Normalise: strip leading /
            partner_key = partner_file.lstrip("/")
            partner = file_index.get(partner_key)
            if partner and partner.get("effective_status"):
                eff = partner["effective_status"].replace(" (inferred)", "")
                if _is_done(eff):
                    if doc["type"] == "implementation":
                        doc["effective_status"] = "completed (inferred)"
                        doc["status_source"] = "inferred_from_progress"
                    # PRDs linked via plan_ref to a completed impl
                    elif doc["type"] == "prd":
                        doc["effective_status"] = "completed (inferred from plan)"
                        doc["status_source"] = "inferred_from_plan"

        # Default: raw
        if doc["status_source"] == "raw":
            doc["effective_status"] = doc["status"]
            doc["status_source"] = "raw"


# ---------------------------------------------------------------------------
# Mismatch detection (unchanged logic)
# ---------------------------------------------------------------------------


def _detect_mismatch(doc: Dict[str, Any]) -> Optional[str]:
    """Return a mismatch description, or None if clean."""
    fm = doc.get("frontmatter") or {}
    status = doc["status"]

    if doc["type"] == "progress":
        tasks = fm.get("tasks", [])
        dict_tasks = [t for t in tasks if isinstance(t, dict)]
        if not dict_tasks:
            return None
        total = len(dict_tasks)
        done = sum(1 for t in dict_tasks if t.get("status") in ("completed", "done"))
        if done == total and status not in ("completed", "complete"):
            return f"all {total} tasks done but status={status!r}"
        if status in ("completed", "complete") and done < total:
            pending = [
                t.get("id", "?")
                for t in dict_tasks
                if t.get("status") not in ("completed", "done")
            ]
            return f"status=completed but {len(pending)} tasks still pending: {pending}"

    return None


# ---------------------------------------------------------------------------
# Markdown table helpers
# ---------------------------------------------------------------------------


def _trunc(s: str, n: int) -> str:
    """Truncate string to n chars, adding ellipsis if needed."""
    if len(s) <= n:
        return s
    return s[: n - 1] + "\u2026"


def _md_row(cells: List[str]) -> str:
    return "| " + " | ".join(cells) + " |"


def _md_separator(widths: List[int]) -> str:
    return "| " + " | ".join("-" * max(w, 3) for w in widths) + " |"


def _effective_display(doc: Dict[str, Any]) -> tuple:
    """
    Return (status_cell, raw_cell) for table display.

    status_cell: effective_status with '*' suffix if inferred.
    raw_cell: original status if different from effective (stripped), else blank.
    """
    eff = doc["effective_status"]
    raw = doc["status"]
    src = doc.get("status_source", "raw")

    if src != "raw":
        status_cell = (
            eff.replace(" (inferred from plan)", "*")
            .replace(" (inferred from progress)", "*")
            .replace(" (inferred)", "*")
        )
        # Ensure trailing * if any inference marker
        if "(inferred" in eff and not status_cell.endswith("*"):
            status_cell = status_cell + "*"
        raw_cell = raw if raw != eff else ""
    else:
        status_cell = eff
        raw_cell = ""

    return status_cell, raw_cell


def _prd_ref_basename(doc: Dict[str, Any]) -> str:
    """Return basename of prd_ref for impl/progress rows, else em-dash."""
    if doc["type"] in ("implementation", "progress"):
        prd_ref = doc.get("prd_ref") or ""
        if prd_ref:
            return Path(prd_ref).name
    return "\u2014"


def _status_sort_key(doc: Dict[str, Any]) -> tuple:
    """Sort: completed last, then by feature_slug, then by file."""
    eff = doc["effective_status"].lower()
    is_done = 1 if "completed" in eff or eff in _DONE_STATUSES else 0
    return (is_done, doc.get("feature_slug") or "", doc["file"])


def _build_type_tables(docs: List[Dict[str, Any]]) -> str:
    """Build Markdown 'Documents by Type' section with one table per type."""
    by_type: Dict[str, List[Dict[str, Any]]] = {}
    for doc in docs:
        by_type.setdefault(doc["type"], []).append(doc)

    lines: List[str] = []
    lines.append("## Documents by Type")
    lines.append("")

    headers = [
        "Status",
        "Raw",
        "Title",
        "Feature",
        "Created",
        "Updated",
        "Related PRD",
        "File",
    ]

    for doc_type in TYPE_ORDER:
        type_docs = by_type.get(doc_type)
        if not type_docs:
            continue

        lines.append(f"### {doc_type}")
        lines.append("")

        sorted_docs = sorted(type_docs, key=_status_sort_key)

        rows: List[List[str]] = []
        for doc in sorted_docs:
            status_cell, raw_cell = _effective_display(doc)
            rows.append(
                [
                    status_cell,
                    raw_cell,
                    _trunc(str(doc["title"]), 60),
                    doc.get("feature_slug") or "\u2014",
                    str(doc["created"]),
                    str(doc["updated"]),
                    _prd_ref_basename(doc),
                    f"`{doc['file']}`",
                ]
            )

        # Column widths
        col_widths = [
            max(len(h), max((len(r[i]) for r in rows), default=0))
            for i, h in enumerate(headers)
        ]

        lines.append(_md_row([h.ljust(col_widths[i]) for i, h in enumerate(headers)]))
        lines.append(_md_separator(col_widths))
        for row in rows:
            lines.append(
                _md_row([cell.ljust(col_widths[i]) for i, cell in enumerate(row)])
            )
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Route 1 + 2: run_status_report
# ---------------------------------------------------------------------------


def run_status_report(
    docs: List[Dict[str, Any]],
    mismatches_only: bool,
    fmt: str,
    output_file: Optional[Path],
    header: str,
) -> None:
    # Propagate effective statuses in-place
    _propagate_status(docs)

    # Build effective_status → count mapping (strip * marker for key)
    mismatches: List[Dict] = []
    for doc in docs:
        mm = _detect_mismatch(doc)
        if mm:
            mismatches.append({**doc, "_mismatch": mm})

    # Inferred updates list
    inferred = [d for d in docs if d.get("status_source", "raw") != "raw"]

    if fmt == "json":
        # Build by_status using effective_status (strip * suffix for keys)
        by_eff_status: Dict[str, List[Dict]] = {}
        for doc in docs:
            eff_key = (
                doc["effective_status"]
                .replace(" (inferred from plan)", "")
                .replace(" (inferred from progress)", "")
                .replace(" (inferred)", "")
            )
            by_eff_status.setdefault(eff_key, []).append(doc)

        payload: Dict[str, Any] = {"header": header, "summary": {}}
        if mismatches_only:
            payload["mismatches"] = mismatches
        else:
            # Keep backward-compatible by_status key, but now uses effective status
            payload["by_status"] = by_eff_status
            payload["mismatches"] = mismatches
            payload["summary"] = {k: len(v) for k, v in by_eff_status.items()}
        out = json.dumps(payload, indent=2, default=str)
    else:
        lines: List[str] = ["# Planning Status Report", "", f"_{header}_", ""]

        if not mismatches_only:
            # Summary section
            lines += ["## Summary", ""]

            # Count by effective_status (strip markers for counting)
            summary_counts: Dict[str, int] = {}
            for doc in docs:
                eff_key = (
                    doc["effective_status"]
                    .replace(" (inferred from plan)", "")
                    .replace(" (inferred from progress)", "")
                    .replace(" (inferred)", "")
                )
                summary_counts[eff_key] = summary_counts.get(eff_key, 0) + 1

            for s, cnt in sorted(summary_counts.items()):
                lines.append(f"- **{s}**: {cnt}")

            if inferred:
                lines += ["", "### Inferred Updates", ""]
                for doc in sorted(inferred, key=lambda d: d["file"]):
                    lines.append(
                        f"- `{doc['file']}`: {doc['status']} \u2192 {doc['effective_status']}"
                    )

            lines += [""]
            lines.append(_build_type_tables(docs))

        if mismatches:
            lines += ["## Mismatches", ""]
            for mm in mismatches:
                lines.append(f"- `{mm['file']}`: {mm['_mismatch']}")
            lines.append("")
        elif mismatches_only:
            lines.append("No mismatches found.")

        out = "\n".join(lines)

    if output_file:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(out, encoding="utf-8")
        print(f"Written to {output_file}")
    else:
        print(out)


# ---------------------------------------------------------------------------
# Route 6: Pre-Plan Intake Status
# ---------------------------------------------------------------------------


def _write_or_print(lines: List[str], output_file: Optional[str]) -> None:
    """Emit accumulated lines either to stdout or to a file."""
    body = "\n".join(lines) + "\n"
    if output_file:
        out_path = Path(output_file)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(body, encoding="utf-8")
        print(f"Written to {output_file}")
    else:
        sys.stdout.write(body)


def run_route6(output_file: Optional[str] = None) -> None:
    """Surface design-specs ready to promote, stale shapers, orphans, active meta-plans."""
    lines: List[str] = []
    emit = lines.append
    emit("# Route 6: Pre-Plan Intake Status")
    emit("_Scanned: docs/project_plans/design-specs/, .claude/plans/_")
    emit("")

    today = date.today()
    stale_threshold = timedelta(days=30)

    # --- design-specs ---
    design_dir = REPO_ROOT / "docs/project_plans/design-specs"
    all_design_docs: List[Path] = []
    if design_dir.exists():
        all_design_docs = sorted(design_dir.rglob("*.md"))

    # Collect all docs for orphan check (cross-repo references)
    all_plan_dirs = [
        REPO_ROOT / "docs/project_plans/PRDs",
        REPO_ROOT / "docs/project_plans/implementation_plans",
        REPO_ROOT / ".claude/plans",
        REPO_ROOT / ".claude/progress",
        REPO_ROOT / "docs/project_plans/design-specs",
        REPO_ROOT / "docs/project_plans/reports",
    ]
    all_docs: List[Path] = []
    for d in all_plan_dirs:
        if d.exists():
            all_docs.extend(d.rglob("*.md"))

    ready_to_promote: List[Dict] = []
    stale_shaping: List[Dict] = []
    orphaned: List[Dict] = []

    for filepath in all_design_docs:
        fm = _read_frontmatter(filepath)
        if fm is None:
            continue
        maturity = str(fm.get("maturity", "")).lower()
        prd_ref = fm.get("prd_ref")
        rel_path = str(filepath.relative_to(REPO_ROOT))

        # Ready to promote: maturity=ready AND no prd_ref
        if maturity == "ready" and not prd_ref:
            ready_to_promote.append(
                {
                    "file": rel_path,
                    "title": fm.get("title", filepath.name),
                    "maturity": maturity,
                    "updated": _fmt_date(fm.get("updated")),
                }
            )

        # Stale shaping: maturity=shaping AND updated >30 days ago
        if maturity == "shaping":
            updated = _parse_date_field(fm.get("updated") or fm.get("created"))
            if updated and (today - updated) > stale_threshold:
                stale_shaping.append(
                    {
                        "file": rel_path,
                        "title": fm.get("title", filepath.name),
                        "updated": _fmt_date(fm.get("updated")),
                        "days_stale": (today - updated).days,
                    }
                )

        # Orphaned: no prd_ref in frontmatter AND no inbound references from other docs
        if not prd_ref and maturity not in ("promoted", "shelved"):
            if not _has_downstream_ref(filepath, all_docs):
                orphaned.append(
                    {
                        "file": rel_path,
                        "title": fm.get("title", filepath.name),
                        "maturity": maturity or "unset",
                        "updated": _fmt_date(fm.get("updated")),
                    }
                )

    # --- meta-plans in .claude/plans/ with status in-progress ---
    meta_dir = REPO_ROOT / ".claude/plans"
    active_meta: List[Dict] = []
    if meta_dir.exists():
        for filepath in sorted(meta_dir.rglob("*.md")):
            fm = _read_frontmatter(filepath)
            if fm is None:
                continue
            status = str(fm.get("status", "")).lower()
            if status in ("in-progress", "in_progress"):
                active_meta.append(
                    {
                        "file": str(filepath.relative_to(REPO_ROOT)),
                        "title": fm.get("title", filepath.name),
                        "status": status,
                        "updated": _fmt_date(fm.get("updated")),
                    }
                )

    # --- Emit results ---
    emit("## Design-Specs Ready to Promote")
    if ready_to_promote:
        for item in ready_to_promote:
            emit(f"  - `{item['file']}` — {item['title']} (updated: {item['updated']})")
    else:
        emit("  (none)")

    emit("")
    emit("## Design-Specs Stale in 'shaping' (>30 days)")
    if stale_shaping:
        for item in stale_shaping:
            emit(
                f"  - `{item['file']}` — {item['title']} ({item['days_stale']} days stale)"
            )
    else:
        emit("  (none)")

    emit("")
    emit("## Orphaned Design-Specs (no prd_ref, no inbound references)")
    if orphaned:
        for item in orphaned:
            emit(
                f"  - `{item['file']}` — {item['title']} (maturity: {item['maturity']}, updated: {item['updated']})"
            )
    else:
        emit("  (none)")

    emit("")
    emit("## Active Meta-Plans (.claude/plans/ with status: in-progress)")
    if active_meta:
        for item in active_meta:
            emit(f"  - `{item['file']}` — {item['title']} (updated: {item['updated']})")
    else:
        emit("  (none)")

    _write_or_print(lines, output_file)


# ---------------------------------------------------------------------------
# Route 7: Findings Triage
# ---------------------------------------------------------------------------


def _age_bucket(days: int) -> str:
    if days < 14:
        return "<14d"
    if days < 30:
        return "14-30d"
    if days < 60:
        return "30-60d"
    if days < 90:
        return "60-90d"
    return "90d+"


def _size_bucket(size_bytes: int) -> str:
    if size_bytes < 1024:
        return "<1KB"
    if size_bytes < 5120:
        return "1-5KB"
    if size_bytes < 20480:
        return "5-20KB"
    return "20KB+"


def run_route7(output_file: Optional[str] = None) -> None:
    """Triage .claude/findings/ for archival candidates."""
    lines: List[str] = []
    emit = lines.append
    emit("# Route 7: Findings Triage")
    emit(f"_Scanned: {FINDINGS_DIR}_")
    emit("")

    findings_dir = REPO_ROOT / FINDINGS_DIR
    if not findings_dir.exists():
        emit(f"Findings directory not found: {findings_dir}")
        _write_or_print(lines, output_file)
        return

    today = date.today()
    archive_threshold = timedelta(days=60)

    no_frontmatter: List[Dict] = []
    archive_candidates: List[Dict] = []
    exempt: List[str] = []

    for filepath in sorted(findings_dir.glob("*.md")):
        fm = _read_frontmatter(filepath)
        rel_path = str(filepath.relative_to(REPO_ROOT))
        size = filepath.stat().st_size

        # Files missing frontmatter entirely
        if fm is None:
            no_frontmatter.append(
                {
                    "file": rel_path,
                    "size": size,
                    "size_bucket": _size_bucket(size),
                }
            )
            continue

        # Honor archive_exempt flag
        if fm.get("archive_exempt"):
            exempt.append(rel_path)
            continue

        # Skip if has promoted_to reference
        if fm.get("promoted_to"):
            continue

        # Check first-commit age
        first_commit = _git_first_commit_date(filepath)
        if first_commit is None:
            # Untracked — fall back to mtime
            first_commit = date.fromtimestamp(filepath.stat().st_mtime)

        age_days = (today - first_commit).days

        if age_days > archive_threshold.days:
            author = _git_first_author(filepath)
            archive_candidates.append(
                {
                    "file": rel_path,
                    "title": fm.get("title", filepath.name),
                    "age_days": age_days,
                    "age_bucket": _age_bucket(age_days),
                    "size_bytes": size,
                    "size_bucket": _size_bucket(size),
                    "author": author,
                    "status": fm.get("status", "not set"),
                }
            )

    # Sort candidates by age descending
    archive_candidates.sort(key=lambda x: x["age_days"], reverse=True)

    # Group by size bucket
    by_size: Dict[str, List[Dict]] = {}
    for item in archive_candidates:
        by_size.setdefault(item["size_bucket"], []).append(item)

    # Group by author
    by_author: Dict[str, List[Dict]] = {}
    for item in archive_candidates:
        by_author.setdefault(item["author"], []).append(item)

    emit("## Summary")
    emit(f"  Total findings: {len(list(findings_dir.glob('*.md')))}")
    emit(f"  Missing frontmatter: {len(no_frontmatter)}")
    emit(f"  Archive-exempt: {len(exempt)}")
    emit(f"  Archive candidates (>60d, no promotion): {len(archive_candidates)}")

    if no_frontmatter:
        emit("")
        emit("## Missing Frontmatter (lint targets)")
        for item in no_frontmatter:
            emit(f"  - `{item['file']}` ({item['size_bucket']})")

    if archive_candidates:
        emit("")
        emit("## Archive Candidates by Size Bucket")
        for bucket in ["20KB+", "5-20KB", "1-5KB", "<1KB"]:
            items = by_size.get(bucket, [])
            if items:
                emit("")
                emit(f"  ### {bucket}")
                for item in items:
                    emit(
                        f"    - `{item['file']}` — {item['age_days']}d old, author: {item['author']}, status: {item['status']}"
                    )

        emit("")
        emit("## Archive Candidates by Author")
        for author, items in sorted(by_author.items()):
            emit("")
            emit(f"  ### {author} ({len(items)} files)")
            for item in items:
                emit(
                    f"    - `{item['file']}` ({item['age_bucket']}, {item['size_bucket']})"
                )

        emit("")
        emit("## Archive Candidates by Age Bucket")
        age_groups: Dict[str, List[Dict]] = {}
        for item in archive_candidates:
            age_groups.setdefault(item["age_bucket"], []).append(item)
        for bucket in ["90d+", "60-90d", "30-60d", "14-30d", "<14d"]:
            items = age_groups.get(bucket, [])
            if items:
                emit("")
                emit(f"  ### {bucket} ({len(items)} files)")
                for item in items:
                    emit(f"    - `{item['file']}`")
    else:
        emit("")
        emit("  No archive candidates found.")

    if exempt:
        emit("")
        emit("## Archive-Exempt Files")
        for f in exempt:
            emit(f"  - `{f}`")

    _write_or_print(lines, output_file)


# ---------------------------------------------------------------------------
# Route 8: Ready to Implement (meta-plan wave triage)
# ---------------------------------------------------------------------------

# Labels used to render artifact links compactly
_ARTIFACT_LABELS: Dict[str, str] = {
    "prd": "prd",
    "impl_plan": "impl",
    "design_spec": "spec",
    "spike": "spike",
    "progress_dir": "progress",
}

# Statuses that mean "nothing more to do here"
_WAVE_DONE_STATUSES = _DONE_STATUSES | {"deferred", "future", "shelved", "superseded"}


def _wave_status_from_items(items: List[Dict[str, Any]]) -> str:
    """Auto-derive wave status from item statuses.

    All completed  → completed
    Any in-progress → in-progress
    Any blocked (none in-progress) → blocked
    All deferred → deferred
    Otherwise → planned
    """
    if not items:
        return "planned"
    statuses = [str(item.get("status", "planned")).lower() for item in items]
    if all(s in _DONE_STATUSES for s in statuses):
        return "completed"
    if any(s in ("in-progress", "in_progress") for s in statuses):
        return "in-progress"
    if any(s == "blocked" for s in statuses):
        return "blocked"
    if all(s in ("deferred", "future", "shelved") for s in statuses):
        return "deferred"
    return "planned"


def _next_actionable_wave_from_frontmatter(
    fm: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Parse the structured `waves` list from frontmatter and return the next
    actionable wave.

    Returns a dict with keys:
      wave_id, title, status, items, blocked (bool), artifacts (merged dict)
    Returns None if all waves are done/deferred.
    """
    waves = fm.get("waves")
    if not waves or not isinstance(waves, list):
        return None

    for wave in waves:
        if not isinstance(wave, dict):
            continue

        # Compute effective status
        explicit = wave.get("status")
        if explicit:
            eff_status = str(explicit).lower()
        else:
            eff_status = _wave_status_from_items(wave.get("items") or [])

        # Skip done / deferred waves
        if eff_status in _WAVE_DONE_STATUSES:
            continue

        # Merge all item artifacts into one dict (deduplicated by value)
        merged_artifacts: Dict[str, str] = {}
        seen_paths: set = set()
        for item in wave.get("items") or []:
            for k, v in (item.get("artifacts") or {}).items():
                if v and str(v) not in seen_paths:
                    if k not in merged_artifacts:
                        merged_artifacts[k] = str(v)
                    seen_paths.add(str(v))

        return {
            "wave_id": str(wave.get("id", "")),
            "title": str(wave.get("title", "")),
            "status": eff_status,
            "items": wave.get("items") or [],
            "blocked": eff_status == "blocked",
            "artifacts": merged_artifacts,
        }

    return None


def _wave_next_actionable_heuristic(content: str) -> Optional[Dict[str, Any]]:
    """Fallback: parse the next actionable wave from Markdown header patterns.

    Looks for headings like 'Wave N: Title' or 'Wave A: Title' and returns
    the first one not marked completed/done.
    """
    wave_re = re.compile(
        r"^#{1,4}\s+Wave\s+([A-Za-z0-9]+)[:\s]+(.+?)$", re.MULTILINE
    )
    done_re = re.compile(r"\b(complete|completed|done|shipped|deferred)\b", re.I)

    for m in wave_re.finditer(content):
        wave_id = m.group(1).strip()
        wave_title = m.group(2).strip()
        # Grab the next ~300 chars after the heading to check inline status
        snippet = content[m.end() : m.end() + 300]
        if done_re.search(snippet[:80]):
            continue
        return {
            "wave_id": wave_id,
            "title": wave_title,
            "status": "planned",
            "items": [],
            "blocked": False,
            "artifacts": {},
        }
    return None


def _phase_progress_description(progress_dir: str) -> Optional[str]:
    """Scan a progress dir for the next incomplete phase file.

    Returns a string like 'Phase 3 next' or 'Phase 3 (2/5 tasks)' or None.
    """
    dir_path = REPO_ROOT / progress_dir
    if not dir_path.exists():
        return None

    phase_re = re.compile(r"phase-(\d+)", re.I)
    candidates: List[tuple] = []

    for fp in sorted(dir_path.glob("phase-*.md")):
        m = phase_re.search(fp.name)
        phase_num = int(m.group(1)) if m else 999
        fm = _read_frontmatter(fp)
        if fm is None:
            continue
        status = str(fm.get("status", "")).lower()
        if status in _DONE_STATUSES:
            continue
        tasks = [t for t in (fm.get("tasks") or []) if isinstance(t, dict)]
        if tasks:
            done = sum(
                1 for t in tasks if t.get("status") in ("completed", "done")
            )
            candidates.append((phase_num, f"Phase {phase_num} ({done}/{len(tasks)} tasks)"))
        else:
            candidates.append((phase_num, f"Phase {phase_num} next"))

    if candidates:
        candidates.sort()
        return candidates[0][1]
    return None


def _gather_meta_plan_items() -> List[Dict[str, Any]]:
    """Scan meta-plan directories and return one item per actionable wave."""
    meta_dirs = [
        REPO_ROOT / ".claude/plans",
        REPO_ROOT / "docs/project_plans/meta-plans",
    ]

    items: List[Dict[str, Any]] = []

    for meta_dir in meta_dirs:
        if not meta_dir.exists():
            continue
        for filepath in sorted(meta_dir.rglob("*.md")):
            fm = _read_frontmatter(filepath)
            if fm is None:
                continue

            content = filepath.read_text(encoding="utf-8")
            rel_path = str(filepath.relative_to(REPO_ROOT))
            feature_title = str(fm.get("title", filepath.stem))
            feature_status = str(fm.get("status", "")).lower()

            # Skip meta-plans that are already globally done
            if feature_status in _WAVE_DONE_STATUSES:
                continue

            # Structured waves path
            wave: Optional[Dict[str, Any]] = None
            if fm.get("waves") and isinstance(fm["waves"], list):
                wave = _next_actionable_wave_from_frontmatter(fm)
            else:
                wave = _wave_next_actionable_heuristic(content)

            if wave is None:
                continue

            # Build items_summary from non-completed items in the wave
            wave_items = wave.get("items") or []
            non_done = [
                it
                for it in wave_items
                if str(it.get("status", "planned")).lower() not in _DONE_STATUSES
            ]
            if not wave_items:
                # Heuristic path: no item-level data available
                items_summary = ""
            elif len(non_done) == 0:
                items_summary = "all items completed"
            elif len(non_done) == 1:
                items_summary = str(non_done[0].get("title", ""))
            else:
                raw = ", ".join(str(it.get("title", "")) for it in non_done)
                items_summary = _trunc(raw, 80)

            # Build description: check progress_dir of first non-done item
            description = ""
            for it in non_done:
                progress_dir = (it.get("artifacts") or {}).get("progress_dir")
                if progress_dir:
                    desc = _phase_progress_description(progress_dir)
                    if desc:
                        description = desc
                        break

            items.append(
                {
                    "feature": feature_title,
                    "title": feature_title,
                    "next_wave": f"Wave {wave['wave_id']}: {wave['title']}",
                    "wave_id": wave["wave_id"],
                    "description": description,
                    "blocked": wave["blocked"],
                    "items_summary": items_summary,
                    "artifacts": wave["artifacts"],
                    "source": rel_path,
                }
            )

    return items


def _gather_in_progress_plans() -> List[Dict[str, Any]]:
    """Scan implementation plans for in-progress status and next phase."""
    impl_dir = REPO_ROOT / "docs/project_plans/implementation_plans"
    if not impl_dir.exists():
        return []

    items: List[Dict[str, Any]] = []

    for filepath in sorted(impl_dir.rglob("*.md")):
        fm = _read_frontmatter(filepath)
        if fm is None:
            continue
        status = str(fm.get("status", "")).lower()
        if status not in ("in-progress", "in_progress", "approved"):
            continue
        # Skip phase sub-files (they live inside the impl plan dir)
        if "/phase-" in str(filepath):
            continue

        rel_path = str(filepath.relative_to(REPO_ROOT))
        title = str(fm.get("title", filepath.stem))
        feature_slug = str(fm.get("feature_slug") or "")

        # Find next incomplete phase via .claude/progress/<slug>/
        description = ""
        if feature_slug:
            # Check with version suffix patterns (e.g. slug-v1/)
            matching_dirs = list(
                (REPO_ROOT / ".claude/progress").glob(f"{feature_slug}*/")
            )
            for pd in sorted(matching_dirs):
                desc = _phase_progress_description(str(pd.relative_to(REPO_ROOT)))
                if desc:
                    description = desc
                    break

        items.append(
            {
                "feature": title,
                "title": title,
                "next_wave": "In-progress",
                "wave_id": "",
                "description": description,
                "blocked": False,
                "items_summary": status,
                "artifacts": {"impl_plan": rel_path},
                "source": rel_path,
            }
        )

    return items


def _gather_ready_to_plan() -> List[Dict]:
    """Return design-specs with maturity=ready and no prd_ref."""
    design_dir = REPO_ROOT / "docs/project_plans/design-specs"
    if not design_dir.exists():
        return []
    results: List[Dict] = []
    for filepath in sorted(design_dir.rglob("*.md")):
        if filepath.name == "README.md":
            continue
        fm = _read_frontmatter(filepath)
        if fm is None:
            continue
        maturity = str(fm.get("maturity", "")).lower()
        if maturity != "ready":
            continue
        if fm.get("prd_ref"):
            continue
        status = str(fm.get("status", "")).lower()
        if status in _DONE_STATUSES or status in INTENTIONAL_NON_COMPLETE:
            continue
        results.append(
            {
                "feature": fm.get("feature_slug") or filepath.stem,
                "file": str(filepath.relative_to(REPO_ROOT)),
                "updated": _fmt_date(fm.get("updated")),
            }
        )
    return results


def _gather_ready_to_research() -> List[Dict]:
    """Return design-specs in shaping/idea maturity + SPIKE charters without findings."""
    design_dir = REPO_ROOT / "docs/project_plans/design-specs"
    results: List[Dict] = []
    if design_dir.exists():
        for filepath in sorted(design_dir.rglob("*.md")):
            if filepath.name == "README.md":
                continue
            fm = _read_frontmatter(filepath)
            if fm is None:
                continue
            maturity = str(fm.get("maturity", "")).lower()
            if maturity not in ("shaping", "idea"):
                continue
            status = str(fm.get("status", "")).lower()
            if status in _DONE_STATUSES or status in INTENTIONAL_NON_COMPLETE:
                continue
            results.append(
                {
                    "feature": fm.get("feature_slug") or filepath.stem,
                    "state": f"Design spec ({maturity})",
                    "source": str(filepath.relative_to(REPO_ROOT)),
                }
            )

    # SPIKE charters without matching findings
    charters_dir = REPO_ROOT / "docs/project_plans/SPIKEs/charters"
    spikes_dir = REPO_ROOT / "docs/project_plans/SPIKEs"
    if charters_dir.exists():
        for charter in sorted(charters_dir.glob("*.md")):
            fm = _read_frontmatter(charter)
            if fm is None:
                continue
            slug = fm.get("feature_slug") or charter.stem
            status = str(fm.get("status", "")).lower()
            if status in _DONE_STATUSES or status in INTENTIONAL_NON_COMPLETE:
                continue
            has_findings = any(
                slug.replace("-charter", "") in f.name
                for f in spikes_dir.glob("*.md")
                if "finding" in f.name or "spike" in f.name.lower()
            )
            if not has_findings:
                results.append(
                    {
                        "feature": slug,
                        "state": "SPIKE charter (no findings)",
                        "source": str(charter.relative_to(REPO_ROOT)),
                    }
                )
    return results


def _gather_open_questions() -> List[Dict]:
    """Scan planning docs for unresolved open_questions in frontmatter."""
    scan_dirs = [
        REPO_ROOT / "docs/project_plans/PRDs",
        REPO_ROOT / "docs/project_plans/design-specs",
        REPO_ROOT / "docs/project_plans/implementation_plans",
        REPO_ROOT / "docs/project_plans/meta-plans",
    ]
    results: List[Dict] = []
    for d in scan_dirs:
        if not d.exists():
            continue
        for filepath in sorted(d.rglob("*.md")):
            if filepath.name == "README.md":
                continue
            fm = _read_frontmatter(filepath)
            if fm is None:
                continue
            oqs_raw = fm.get("open_questions")
            if not oqs_raw or not isinstance(oqs_raw, list):
                continue
            rel_path = str(filepath.relative_to(REPO_ROOT))
            for oq in oqs_raw:
                if isinstance(oq, str):
                    question = oq.strip()
                    oq_status = "unresolved"
                elif isinstance(oq, dict):
                    question = str(oq.get("question", "")).strip()
                    oq_status = str(oq.get("status", "unresolved")).lower()
                else:
                    continue
                if not question:
                    continue
                if oq_status in ("resolved", "answered"):
                    continue
                results.append({"document": rel_path, "question": question})
    return results


def _build_artifact_links(artifacts: Dict[str, str], max_links: int = 3) -> str:
    """Render artifact dict as space-separated markdown links.

    Uses short labels: prd, impl, spec, spike, progress.
    Only includes artifact types that exist (non-empty values).
    Deduplicates paths. Truncates to max_links most relevant links.
    """
    # Priority order for display
    priority = ["prd", "impl_plan", "design_spec", "spike", "progress_dir"]
    seen_paths: set = set()
    links: List[str] = []

    # Emit in priority order first
    for key in priority:
        val = artifacts.get(key)
        if val and val not in seen_paths:
            label = _ARTIFACT_LABELS.get(key, key)
            links.append(f"[{label}]({val})")
            seen_paths.add(val)

    # Then any remaining keys
    for key, val in artifacts.items():
        if key in priority:
            continue
        if val and val not in seen_paths:
            label = _ARTIFACT_LABELS.get(key, key)
            links.append(f"[{label}]({val})")
            seen_paths.add(val)

    return " ".join(links[:max_links])


def run_route8(fmt: str = "markdown", output_file: Optional[Path] = None) -> None:
    """Route 8: Ready-to-implement view — meta-plan wave triage."""
    meta_items = _gather_meta_plan_items()
    impl_items = _gather_in_progress_plans()
    ready_to_plan = _gather_ready_to_plan()
    ready_to_research = _gather_ready_to_research()
    open_questions = _gather_open_questions()

    # Combine: meta-plan actionable waves + in-progress impl plans (deduplicate
    # by source so a meta-plan item referencing the same impl plan doesn't double)
    meta_sources = {it["source"] for it in meta_items}
    filtered_impl = [it for it in impl_items if it["source"] not in meta_sources]

    # Separate blocked from actionable
    blocked_meta = [it for it in meta_items if it["blocked"]]
    actionable_meta = [it for it in meta_items if not it["blocked"]]
    implement_items = actionable_meta + filtered_impl

    if fmt == "json":
        payload = {
            "route": 8,
            "ready_to_implement": [
                {
                    "feature": it["feature"],
                    "next_wave": it["next_wave"],
                    "wave_id": it["wave_id"],
                    "items": it.get("items_summary", ""),
                    "description": it["description"],
                    "artifacts": it["artifacts"],
                    "source": it["source"],
                }
                for it in implement_items
            ],
            "blocked": [
                {
                    "feature": it["feature"],
                    "next_wave": it["next_wave"],
                    "wave_id": it["wave_id"],
                    "items": it.get("items_summary", ""),
                    "artifacts": it["artifacts"],
                    "source": it["source"],
                }
                for it in blocked_meta
            ],
            "ready_to_plan": ready_to_plan,
            "ready_to_research": ready_to_research,
            "open_questions": open_questions,
        }
        out = json.dumps(payload, indent=2, default=str)
    else:
        lines: List[str] = [
            "# Route 8: Ready to Implement",
            "",
            "_Meta-plan wave triage — next actionable waves and in-progress plans_",
            "",
        ]

        # --- Ready to Implement table ---
        lines.append("## Ready to Implement")
        lines.append("")

        if implement_items:
            headers = ["Priority", "Feature", "Next Wave", "Items", "Artifacts", "Source"]
            rows: List[List[str]] = []
            for i, it in enumerate(implement_items, 1):
                artifact_links = _build_artifact_links(it["artifacts"])
                rows.append(
                    [
                        str(i),
                        _trunc(str(it["feature"]), 40),
                        _trunc(str(it["next_wave"]), 35),
                        _trunc(str(it.get("items_summary", "")), 60),
                        artifact_links,
                        f"`{it['source']}`",
                    ]
                )

            col_widths = [
                max(len(h), max((len(r[i]) for r in rows), default=0))
                for i, h in enumerate(headers)
            ]
            lines.append(
                _md_row([h.ljust(col_widths[i]) for i, h in enumerate(headers)])
            )
            lines.append(_md_separator(col_widths))
            for row in rows:
                lines.append(
                    _md_row([cell.ljust(col_widths[i]) for i, cell in enumerate(row)])
                )
        else:
            lines.append("_(none)_")

        lines.append("")

        # --- Blocked section ---
        if blocked_meta:
            lines.append("## Blocked Waves")
            lines.append("")
            for it in blocked_meta:
                artifact_links = _build_artifact_links(it["artifacts"])
                lines.append(
                    f"- **{_trunc(it['feature'], 50)}** — {it['next_wave']}: "
                    f"{_trunc(it.get('items_summary', ''), 60)}"
                    + (f" | {artifact_links}" if artifact_links else "")
                )
            lines.append("")

        # --- Ready to Plan ---
        lines.append("## Ready to Plan")
        lines.append("")
        lines.append("Design specs at `ready` maturity needing PRD promotion.")
        lines.append("")
        lines.append("| Feature | Design Spec | Updated |")
        lines.append("|---------|-------------|---------|")
        if ready_to_plan:
            for item in ready_to_plan:
                lines.append(
                    f"| {item['feature']} | `{item['file']}` | {item['updated']} |"
                )
        else:
            lines.append("| — | (none) | — |")
        lines.append("")

        # --- Ready to Research ---
        lines.append("## Ready to Research")
        lines.append("")
        lines.append("Items needing SPIKE research or design-spec development.")
        lines.append("")
        lines.append("| Feature | Current State | Source |")
        lines.append("|---------|---------------|--------|")
        if ready_to_research:
            for item in ready_to_research:
                lines.append(
                    f"| {item['feature']} | {item['state']} | `{item['source']}` |"
                )
        else:
            lines.append("| — | (none) | — |")
        lines.append("")

        # --- Open Questions ---
        lines.append("## Open Questions")
        lines.append("")
        lines.append("Unresolved questions across planning documents.")
        lines.append("")
        lines.append("| Document | Question |")
        lines.append("|----------|----------|")
        if open_questions:
            for item in open_questions:
                q = _trunc(item["question"], 80)
                lines.append(f"| `{item['document']}` | {q} |")
        else:
            lines.append("| — | (none) |")
        lines.append("")

        out = "\n".join(lines)

    if output_file:
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(out, encoding="utf-8")
        print(f"Written to {output_file}")
    else:
        print(out)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cross-feature plan status reporting and triage.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Route 1: status report for last 3 weeks
  python plan-status-report.py --period 21

  # Route 1: all docs, JSON output
  python plan-status-report.py --all --format json

  # Route 1: save report
  python plan-status-report.py --all --format markdown \\
    --output docs/project_plans/reports/planning-status/$(date +%Y-%m-%d)-planning-artifacts-status.md

  # Route 2: mismatches only
  python plan-status-report.py --all --mismatches-only

  # Include extra types
  python plan-status-report.py --all --all-types
  python plan-status-report.py --period 21 --include-pre-plan --include-meta

  # Route 6: pre-plan intake
  python plan-status-report.py --route6

  # Route 7: findings triage
  python plan-status-report.py --route7

  # Route 8: ready-to-implement wave triage
  python plan-status-report.py --route8
  python plan-status-report.py --route8 --format json
""",
    )

    # Time range
    time_group = parser.add_mutually_exclusive_group()
    time_group.add_argument(
        "--period",
        type=int,
        metavar="N",
        help="Limit to docs modified in last N days (default: 21)",
    )
    time_group.add_argument(
        "--all", action="store_true", help="All docs regardless of age"
    )

    # Filters
    parser.add_argument(
        "--mismatches-only",
        action="store_true",
        help="Route 2: only show mismatch cases",
    )

    # Discovery flags
    parser.add_argument(
        "--include-pre-plan",
        action="store_true",
        help="Add design-spec to discovery",
    )
    parser.add_argument(
        "--include-meta", action="store_true", help="Add meta-plan to discovery"
    )
    parser.add_argument(
        "--include-reports", action="store_true", help="Add report to discovery"
    )
    parser.add_argument(
        "--all-types",
        action="store_true",
        help="Enable all three extension sets",
    )

    # Output
    parser.add_argument(
        "--format",
        choices=["markdown", "json"],
        default="markdown",
        help="Output format",
    )
    parser.add_argument(
        "--output", type=Path, metavar="FILE", help="Write output to file"
    )

    # Explicit route selection
    parser.add_argument(
        "--route6",
        action="store_true",
        help="Route 6: Pre-Plan Intake Status",
    )
    parser.add_argument(
        "--route7", action="store_true", help="Route 7: Findings Triage"
    )
    parser.add_argument(
        "--route8", "--whats-next",
        action="store_true",
        dest="route8",
        help="Route 8: What's Next? (meta-plan wave triage + actionable priorities)",
    )

    parser.add_argument(
        "--repo",
        type=Path,
        metavar="PATH",
        default=None,
        help=(
            "Repository root to scan (overrides auto-detection). "
            "Defaults to CWD when it contains a .claude/ directory, "
            "otherwise falls back to the path derived from the script location."
        ),
    )

    args = parser.parse_args()

    # --- Resolve REPO_ROOT ---
    # Priority: explicit --repo > CWD (when it has .claude/) > script-location fallback
    global REPO_ROOT
    if args.repo is not None:
        REPO_ROOT = args.repo.resolve()
    elif (Path.cwd() / ".claude").is_dir():
        REPO_ROOT = Path.cwd()
    # else: keep the module-level _SCRIPT_REPO_ROOT value already assigned

    # Resolve discovery flags
    inc_pre_plan = args.include_pre_plan or args.all_types
    inc_meta = args.include_meta or args.all_types
    inc_reports = args.include_reports or args.all_types

    header = _scanned_types_header(inc_pre_plan, inc_meta, inc_reports)

    # Change to repo root so relative paths resolve correctly
    import os

    os.chdir(REPO_ROOT)

    if args.route6:
        run_route6(output_file=args.output)
        return

    if args.route7:
        run_route7(output_file=args.output)
        return

    if args.route8:
        run_route8(fmt=args.format, output_file=args.output)
        return

    # Default: Route 1 / Route 2
    period_days: Optional[int] = None
    if args.all:
        period_days = None
    elif args.period:
        period_days = args.period
    else:
        period_days = 21  # default

    active_dirs = _build_active_dirs(inc_pre_plan, inc_meta, inc_reports)
    docs = _collect_docs(active_dirs, period_days)

    run_status_report(
        docs=docs,
        mismatches_only=args.mismatches_only,
        fmt=args.format,
        output_file=args.output,
        header=header,
    )


if __name__ == "__main__":
    main()
