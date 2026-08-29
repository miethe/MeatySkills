#!/usr/bin/env python3
"""Seed a delivery dossier manifest from an implementation plan — deterministically.

The engine behind ``seed-dossier.sh``. It closes spec Sec A.1 step 1: a Tier 2/3 feature that
has just been planned gets its living dossier manifest created *at plan time*, so the
phase-boundary regeneration hook (``update-dossier.sh``, binding-gated on the manifest
existing) is armed instead of dormant.

Deterministic and offline — **no model call sits on this path** (AOS constraint 4). Everything
the seed needs already lives in the plan: frontmatter (``feature_slug``, ``tier``, ``prd_ref``,
``wave_plan.phases[]``, ``open_questions``, ``decisions``) plus the body's ``### Phase P1: …``
headings. The manifest is canonical; the HTML is derived (constraint 2) and is rendered by
``update-dossier.sh``, which this script's wrapper chains to.

Vocabulary ownership stays upstream: the skeleton comes from ``delivery_report.py init --route
dossier`` (so ``domains``/``schema_version``/structural keys are never re-implemented here,
AOS constraint 7); this script then replaces the sections it can derive from the plan.

Never overwrites an existing manifest without ``--force``: the dossier is an *accreting* record,
and clobbering it would destroy phase narratives authored during execution.

Usage:
  seed_dossier.py --plan docs/project_plans/implementation_plans/foo-v1.md
  seed_dossier.py --plan <plan.md> --out .claude/reports/dossier/foo/report.json --json

Exit codes (the wrapper swallows all of them — seeding never blocks planning):
  0  manifest written
  2  usage / unreadable / unparseable plan
  3  manifest already exists (no-op; use --force to re-seed)
  4  below --min-tier (OD-4: Tier 2/3 auto-seed, Tier 0/1 on explicit request)

Spec: docs/skill-development/delivery-dossier/spec.md Sec A.1 (lifecycle), Sec A.6 (contract).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover - reported as a usage error, swallowed by the wrapper
    sys.stderr.write("[seed-dossier] PyYAML required to read plan frontmatter\n")
    sys.exit(2)

VERSION = "0.1.0"
DEFAULT_DOSSIER_ROOT = ".claude/reports/dossier"

# Skill-dir candidates, in the same precedence order update-dossier.sh uses.
SKILL_DIR_CANDIDATES = (
    ".claude/skills/delivery-report",
    "~/.claude/skills/delivery-report",
    "~/.agents/skills/delivery-report",
)

# "### Phase P1: API layer — 6 pts" / "## Phase 2 — Engine" / "### Phase P3: Reconcile ✅"
PHASE_HEADING_RE = re.compile(
    r"^#{2,4}\s*Phase\s+(?P<pid>P?\d+)\s*[:—–-]+\s*(?P<title>.+?)\s*$",
    re.MULTILINE,
)
# Trailing effort/status noise on a phase heading: "— 6 pts", "(6 pts)", "✅ SHIPPED".
HEADING_TRAILER_RE = re.compile(
    r"\s*(?:[—–-]\s*)?(?:\(|\[)?\d+(?:\.\d+)?\s*(?:pts?|points?)(?:\)|\])?\s*$",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------- plan reading

def read_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split a plan doc into (frontmatter mapping, body). Missing frontmatter -> ({}, text)."""
    if not text.startswith("---"):
        return {}, text
    parts = text.split("\n---", 2)
    if len(parts) < 2:
        return {}, text
    raw = parts[0][3:]
    body = parts[1] if len(parts) == 2 else parts[1] + parts[2]
    try:
        data = yaml.safe_load(raw)
    except Exception:  # noqa: BLE001 - a malformed plan header is not fatal to seeding
        return {}, body
    return (data if isinstance(data, dict) else {}), body


def normalize_phase_id(raw: str) -> str:
    """'P1' / '1' / 'p01' -> 'phase-1' (a stage id matching the validator's [A-Za-z0-9._-]+)."""
    digits = re.sub(r"\D", "", str(raw))
    return f"phase-{int(digits)}" if digits else re.sub(r"[^A-Za-z0-9._-]", "-", str(raw)).lower()


def clean_heading_title(title: str) -> str:
    title = re.sub(r"[✅❌⚠️]", "", title).strip()
    title = HEADING_TRAILER_RE.sub("", title).strip()
    title = re.sub(r"\s*[—–-]\s*$", "", title).strip()
    return title


def phase_titles_from_body(body: str) -> dict[str, str]:
    titles: dict[str, str] = {}
    for match in PHASE_HEADING_RE.finditer(body):
        stage_id = normalize_phase_id(match.group("pid"))
        title = clean_heading_title(match.group("title"))
        if title and stage_id not in titles:
            titles[stage_id] = title
    return titles


def phase_ids_from_frontmatter(fm: dict[str, Any]) -> list[str]:
    """Phase ids in plan order: wave_plan.phases[] first, then the phases map, else []."""
    wave_plan = fm.get("wave_plan")
    if isinstance(wave_plan, dict):
        phases = wave_plan.get("phases")
        if isinstance(phases, list):
            ids = [str(p.get("id")) for p in phases if isinstance(p, dict) and p.get("id")]
            if ids:
                return ids
    phases_map = fm.get("phases")
    if isinstance(phases_map, dict) and phases_map:
        return [str(k) for k in phases_map.keys()]
    if isinstance(phases_map, list) and phases_map:
        return [str(p.get("id")) for p in phases_map if isinstance(p, dict) and p.get("id")]
    return []


def phase_titles_from_frontmatter(fm: dict[str, Any]) -> dict[str, str]:
    titles: dict[str, str] = {}
    phases_map = fm.get("phases")
    if isinstance(phases_map, dict):
        for key, value in phases_map.items():
            if isinstance(value, dict) and value.get("title"):
                titles[normalize_phase_id(key)] = str(value["title"])
            elif isinstance(value, str):
                titles[normalize_phase_id(key)] = value
    return titles


def first_sentence(text: Any, limit: int = 320) -> str:
    if not text:
        return ""
    flat = re.sub(r"\s+", " ", str(text)).strip()
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


def as_text_list(value: Any) -> list[str]:
    """Frontmatter lists are sometimes [str], sometimes [{...}]. Flatten to display strings."""
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for entry in value:
        if isinstance(entry, str) and entry.strip():
            out.append(entry.strip())
        elif isinstance(entry, dict):
            for key in ("question", "decision", "text", "title", "summary"):
                if entry.get(key):
                    out.append(str(entry[key]).strip())
                    break
    return out


def research_ref(fm: dict[str, Any]) -> str | None:
    """The pre-commitment research record, if the plan cites one (spec Sec A.1 step 1)."""
    for key in ("spike_ref", "charter_ref", "feasibility_brief_ref", "feasibility_ref"):
        value = fm.get(key)
        if isinstance(value, str) and value.strip() and value.strip().lower() != "null":
            return value.strip()
    for doc in fm.get("related_documents") or []:
        text = str(doc)
        if re.search(r"(exploration|SPIKE|spikes?|feasibility)", text):
            return text
    return None


# --------------------------------------------------------------------------- repo facts

def git_fact(repo: Path, args: list[str], fallback: str) -> str:
    try:
        out = subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                             text=True, timeout=10, check=False)
    except (OSError, subprocess.SubprocessError):
        return fallback
    value = out.stdout.strip()
    return value if out.returncode == 0 and value else fallback


def resolve_skill_dir() -> Path | None:
    override = os.environ.get("DELIVERY_REPORT_SKILL_DIR", "")
    candidates = ([override] if override else []) + list(SKILL_DIR_CANDIDATES)
    for candidate in candidates:
        path = Path(candidate).expanduser()
        if (path / "scripts" / "delivery_report.py").is_file():
            return path
    return None


def skeleton_from_cli(cli: Path, title: str, slug: str, tier: int, points: float) -> dict[str, Any]:
    """Own the vocabulary upstream: the skeleton (domains, schema_version, structure) comes from
    `delivery_report.py init --route dossier`, never from a copy of it here (constraint 7)."""
    python = os.environ.get("DELIVERY_REPORT_PYTHON") or sys.executable or "python3"
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "skeleton.json"
        subprocess.run(
            [python, str(cli), "init", "--route", "dossier", "--title", title,
             "--subject", slug, "--tier", str(tier), "--points", str(points), "--out", str(out)],
            capture_output=True, text=True, timeout=60, check=True,
        )
        return json.loads(out.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- seed assembly

def build_manifest(plan_path: Path, repo: Path, fm: dict[str, Any], body: str,
                   slug: str, tier: int, skeleton: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    plan_rel = os.path.relpath(plan_path.resolve(), repo)
    plan_title = str(fm.get("title") or slug).replace("Implementation Plan:", "").strip()

    fm_titles = phase_titles_from_frontmatter(fm)
    body_titles = phase_titles_from_body(body)
    phase_ids = [normalize_phase_id(p) for p in phase_ids_from_frontmatter(fm)]
    if not phase_ids:
        phase_ids = sorted(body_titles, key=lambda s: int(re.sub(r"\D", "", s) or 0))
    if not phase_ids:
        phase_ids = ["phase-1"]

    # ---- stages: the lifecycle spine (research -> plan -> execute xN -> validate)
    stages: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    seen_evidence: set[str] = set()

    def add_evidence(eid: str, label: str, kind: str, path: str | None = None) -> str | None:
        if not label or eid in seen_evidence:
            return eid if eid in seen_evidence else None
        record: dict[str, Any] = {"id": eid, "label": label, "kind": kind}
        if path:
            record["path"] = path
        evidence.append(record)
        seen_evidence.add(eid)
        return eid

    add_evidence("plan", f"Implementation plan: {plan_rel}", "doc", plan_rel)
    prd_ref = fm.get("prd_ref")
    if isinstance(prd_ref, str) and prd_ref.strip() and prd_ref.strip().lower() != "null":
        add_evidence("prd", f"PRD: {prd_ref.strip()}", "doc", prd_ref.strip())

    research = research_ref(fm)
    if research:
        add_evidence("research", f"Pre-commitment research: {research}", "doc", research)
        stages.append({
            "id": "research", "label": "Research / feasibility", "kind": "research", "state": "done",
            "narrative": f"Pre-commitment research concluded before planning; recorded at {research}.",
            "outcome": "Research concluded; the plan below is its committed follow-through.",
            "completed": None, "domains": ["Research"], "evidence_refs": ["research"],
        })

    scope = first_sentence(fm.get("scope") or fm.get("architecture_summary"))
    effort = str(fm.get("effort_estimate") or "").strip()
    plan_outcome = f"Plan authored: {len(phase_ids)} execution phase(s)"
    plan_outcome += f", {effort}." if effort else "."
    stages.append({
        "id": "plan", "label": "Planning pass", "kind": "plan", "state": "done",
        "narrative": scope or f"Implementation plan authored for {slug}.",
        "outcome": plan_outcome, "completed": now,
        "domains": ["Engine"], "evidence_refs": [r for r in ("plan", "prd") if r in seen_evidence],
    })

    for stage_id in phase_ids:
        label = body_titles.get(stage_id) or fm_titles.get(stage_id) or stage_id.replace("-", " ").title()
        stages.append({
            "id": stage_id, "label": label, "kind": "execute", "state": "pending",
            "narrative": "Pending — the phase-closing agent authors this stage's narrative, "
                         "outcome, decisions, and evidence at the phase boundary.",
            "outcome": None, "started": None, "completed": None,
            "domains": ["Engine"], "evidence_refs": [],
        })

    stages.append({
        "id": "validate", "label": "End-to-end validation", "kind": "validate", "state": "pending",
        "narrative": "Pending — fills at the validate stage with the validation table and "
                     "final evidence; cross-links the enforced `feature` delivery report.",
        "outcome": None, "started": None, "completed": None,
        "domains": ["Validation"], "evidence_refs": [],
    })

    # ---- open questions + decisions the plan already declares (agent-enriched frontmatter)
    open_questions: list[dict[str, Any]] = []
    for index, question in enumerate(as_text_list(fm.get("open_questions")), start=1):
        open_questions.append({
            "id": f"oq-{index}", "question": question,
            "context": f"Carried from the plan's frontmatter at seed time ({plan_rel}).",
            "status": "open", "blocking": False, "raised_in_stage": "plan", "raised_at": now,
            "answer": None, "answered_by": None, "answered_at": None,
            "channel": {"type": "instruction",
                        "detail": "Reply in chat, or edit this OQ's answer in the manifest; "
                                  "the next phase close folds it in.",
                        "request_id": None},
        })

    decisions: list[dict[str, Any]] = []
    for index, decision in enumerate(as_text_list(fm.get("decisions")), start=1):
        decisions.append({
            "id": f"dec-{index}", "decision": decision,
            "rationale": "Recorded in the plan's decisions block at planning time.",
            "alternatives": [], "decided_in_stage": "plan", "decided_at": now,
            "decided_by": str(fm.get("owner") or "planning"), "evidence_refs": ["plan"],
        })

    # ---- the one open item at seed time: execute the plan
    tracker = None
    for key in ("itt_node_id", "source_artifact_id", "intenttree_tree"):
        if fm.get(key):
            tracker = str(fm[key])
            break
    items = [{
        "id": "execute-plan", "title": f"Execute the implementation plan for {slug}",
        "kind": "not_started", "domains": ["Engine"],
        "detail": f"{len(phase_ids)} phase(s) planned, none executed. The dossier accretes a stage "
                  "narrative at each phase boundary.",
        "handoff": {
            "command": f"/dev:execute-plan {plan_rel}", "repo": str(repo),
            "paths": [plan_rel], "requirement_ids": [], "gates": [], "tracker": tracker,
            "prompt": f"Execute the implementation plan at {plan_rel} phase by phase. "
                      "At each phase close, author that stage into the dossier manifest before "
                      "the regeneration hook runs.",
        },
    }]

    # ---- assemble on top of the CLI-owned skeleton
    manifest = dict(skeleton)
    report = dict(manifest.get("report") or {})
    report.update({
        "route": "dossier",
        "title": f"Delivery Dossier: {plan_title}",
        "project": slug,
        "revision": 1,
        "truth_status": "not_executed",
        "generated_from": {
            "repo": str(repo),
            "ref": git_fact(repo, ["rev-parse", "--abbrev-ref", "HEAD"], "unknown"),
            "commit": git_fact(repo, ["rev-parse", "--short", "HEAD"], "unknown"),
        },
        "generated_by": f"seed_dossier {VERSION} (plan-time seed)",
        "generated_at": now,
        "constraints": f"The manifest is canonical; the HTML is derived. Follow the phase gates in "
                       f"{plan_rel}; never hand-maintain this record as a parallel tracker.",
    })
    manifest["report"] = report
    manifest["report_policy"] = {
        "tier_system": "dev-execution", "tier": tier,
        "estimated_points": float(re.sub(r"[^\d.]", "", str(fm.get("effort_estimate") or "0")) or 0),
        "explicit_request": False,
        "signals": [f"seeded at plan time from {plan_rel}"],
    }
    manifest["vitals"] = [
        {"key": "Phases", "value": f"0/{len(phase_ids)}", "sub": "done", "severity": "neutral",
         "measured_by": "stages[] entries with kind==execute and state==done vs total"},
        {"key": "Open questions", "value": str(len(open_questions)),
         "sub": "carried from the plan", "severity": "warn" if open_questions else "ok",
         "measured_by": "open_questions[] with status==open"},
        {"key": "Tier", "value": str(tier), "sub": "dev-execution", "severity": "neutral",
         "measured_by": f"plan frontmatter tier: in {plan_rel}"},
    ]
    manifest["stages"] = stages
    manifest["open_questions"] = open_questions
    manifest["decisions"] = decisions
    manifest["items"] = items
    manifest["corrections"] = []
    manifest["media"] = []
    manifest["no_visual_reason"] = ("Seeded at plan time — nothing has been built yet. "
                                    "Screenshots and evidence accrue at phase closes.")
    manifest["evidence"] = evidence
    return manifest


# --------------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--plan", required=True, type=Path, help="implementation plan markdown")
    parser.add_argument("--out", type=Path, help="manifest path (default: "
                                                 f"{DEFAULT_DOSSIER_ROOT}/<slug>/report.json)")
    parser.add_argument("--repo", type=Path, help="project root (default: git toplevel, else cwd)")
    parser.add_argument("--feature-slug", help="override the plan's feature_slug")
    parser.add_argument("--min-tier", type=int, default=2,
                        help="skip below this tier (OD-4: Tier 2/3 auto-seed). 0 disables the gate.")
    parser.add_argument("--force", action="store_true", help="re-seed over an existing manifest")
    parser.add_argument("--json", action="store_true", help="emit a machine-readable result")
    args = parser.parse_args(argv)

    def emit(payload: dict[str, Any], code: int) -> int:
        if args.json:
            print(json.dumps(payload, indent=2))
        elif payload.get("message"):
            stream = sys.stdout if code == 0 else sys.stderr
            stream.write(f"[seed-dossier] {payload['message']}\n")
        return code

    if not args.plan.is_file():
        return emit({"ok": False, "status": "no_plan",
                     "message": f"plan not found: {args.plan}"}, 2)

    try:
        text = args.plan.read_text(encoding="utf-8")
    except OSError as exc:
        return emit({"ok": False, "status": "unreadable", "message": str(exc)}, 2)

    fm, body = read_frontmatter(text)
    slug = (args.feature_slug or str(fm.get("feature_slug") or "").strip()
            or args.plan.stem).strip().strip('"')
    if not slug:
        return emit({"ok": False, "status": "no_slug",
                     "message": "plan carries no feature_slug and none was supplied"}, 2)

    repo = args.repo or Path(git_fact(Path.cwd(), ["rev-parse", "--show-toplevel"], str(Path.cwd())))
    repo = repo.resolve()

    try:
        tier = int(re.sub(r"\D", "", str(fm.get("tier"))) or 0)
    except (TypeError, ValueError):
        tier = 0
    if args.min_tier > 0 and tier < args.min_tier:
        return emit({"ok": True, "status": "skipped_tier", "tier": tier, "slug": slug,
                     "message": f"tier {tier} below --min-tier {args.min_tier}; "
                                "seed on explicit request with --min-tier 0"}, 4)

    out = args.out or (repo / DEFAULT_DOSSIER_ROOT / slug / "report.json")
    if out.exists() and not args.force:
        return emit({"ok": True, "status": "exists", "manifest": str(out), "slug": slug,
                     "message": f"dossier already seeded at {out} (accreting record; "
                                "--force to re-seed)"}, 3)

    skill_dir = resolve_skill_dir()
    if skill_dir is None:
        return emit({"ok": False, "status": "no_cli",
                     "message": "delivery_report.py not found; cannot seed"}, 2)

    plan_title = str(fm.get("title") or slug).replace("Implementation Plan:", "").strip()
    try:
        skeleton = skeleton_from_cli(skill_dir / "scripts" / "delivery_report.py",
                                     f"Delivery Dossier: {plan_title}", slug, max(tier, 0) or 2,
                                     float(re.sub(r"[^\d.]", "",
                                                  str(fm.get("effort_estimate") or "0")) or 0))
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError) as exc:
        return emit({"ok": False, "status": "skeleton_failed", "message": str(exc)}, 2)

    manifest = build_manifest(args.plan, repo, fm, body, slug, tier, skeleton)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    return emit({
        "ok": True, "status": "seeded", "manifest": str(out), "slug": slug, "tier": tier,
        "stages": [s["id"] for s in manifest["stages"]],
        "open_questions": len(manifest["open_questions"]),
        "message": f"seeded dossier for {slug}: {len(manifest['stages'])} stages -> {out}",
    }, 0)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
