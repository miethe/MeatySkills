#!/usr/bin/env python3
"""Render, validate, and export evidence-backed, self-contained delivery reports.

One route-discriminated manifest (report.route) serves both a backward-looking
`feature` report (one finished thing) and forward-looking `program`/`phase`/`readiness`
reports (many things in flight, each carrying a copyable agent handoff).

Deterministic and offline: no model call, no network. The manifest is canonical; the
HTML is derived. The validator is the honesty mechanism and runs before every render.
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import mimetypes
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


VERSION = "0.1.0"
SCHEMA_VERSION = "1.0"
FEATURE_ROUTE = "feature"
STATUS_ROUTES = {"program", "phase", "readiness"}
ALL_ROUTES = {FEATURE_ROUTE} | STATUS_ROUTES

MAX_MEDIA_BYTES = 8 * 1024 * 1024
MAX_TOTAL_MEDIA_BYTES = 25 * 1024 * 1024
ALLOWED_MEDIA_TYPES = {
    "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml",
}
TRUTH_LABELS = {
    "verified", "partially_verified", "not_executed", "owner_data_absent", "branch_local", "shipped",
}
ITEM_KINDS = {"shipped", "partial", "not_started", "blocked_external", "deferred", "finding"}
# handoff required for these kinds; findings only when marked actionable.
HANDOFF_REQUIRED_KINDS = {"partial", "not_started", "blocked_external", "deferred"}
DOMAIN_GROUP_CLASS = {"build": "build", "knowledge": "know", "governance": "gov"}
DEFAULT_DOMAINS = {
    "UI": "build", "Engine": "build", "Interop": "build", "Infra": "build",
    "Evidence": "knowledge", "Research": "knowledge", "Validation": "knowledge",
    "Governance": "governance", "Compliance": "governance", "Legal": "governance", "Release": "governance",
}
EXPORT_TARGETS = {"skillmeat", "intenttree", "meatywiki", "ccdash"}


class ReportError(ValueError):
    """Raised for invalid manifests or unsafe render inputs."""


def e(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def ascii_entities(text: str) -> str:
    """Encode non-ASCII to numeric HTML entities (Appendix C pitfall 1: safe in body text)."""
    return "".join(c if ord(c) < 128 else "&#%d;" % ord(c) for c in text)


# --------------------------------------------------------------------------- IO

def load_manifest(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ReportError(f"cannot read manifest: {exc}") from exc
    suffix = path.suffix.lower()
    try:
        if suffix == ".json":
            data = json.loads(raw)
        elif suffix in {".yaml", ".yml"}:
            try:
                import yaml  # type: ignore
            except ImportError as exc:
                raise ReportError("YAML manifests require PyYAML; use JSON or install pyyaml") from exc
            data = yaml.safe_load(raw)
        else:
            raise ReportError("manifest must use .json, .yaml, or .yml")
    except (json.JSONDecodeError, ReportError) as exc:
        raise ReportError(f"invalid manifest: {exc}") from exc
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as a report error
        raise ReportError(f"invalid YAML manifest: {exc}") from exc
    if not isinstance(data, dict):
        raise ReportError("manifest root must be an object")
    return data


def route_of(data: dict[str, Any]) -> str:
    return str((data.get("report") or {}).get("route") or "")


def repo_root_of(data: dict[str, Any]) -> Path | None:
    repo = ((data.get("report") or {}).get("generated_from") or {}).get("repo")
    return Path(repo) if repo else None


def resolve_asset(path_text: str, asset_root: Path) -> Path:
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", path_text):
        raise ReportError(f"remote or URI media is forbidden: {path_text}")
    root = asset_root.resolve()
    candidate = (root / path_text).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ReportError(f"media escapes asset root: {path_text}") from exc
    return candidate


def media_data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{payload}"


# --------------------------------------------------------------------- eligibility

def eligibility(data: dict[str, Any]) -> dict[str, Any]:
    """Feature-route tier/size gate (ported). Forward routes are on-demand."""
    route = route_of(data)
    if route in STATUS_ROUTES:
        policy = data.get("report_policy") or {}
        decision = "required" if policy.get("explicit_request") or policy.get("required") else "on_demand"
        return {"decision": decision, "effective_decision": decision, "route": route,
                "reasons": ["forward-looking status report is produced on request"]}

    policy = data.get("report_policy") or {}
    system = policy.get("tier_system", "custom")
    tier = int(policy.get("tier", 0) or 0)
    points = float(policy.get("estimated_points", 0) or 0)
    signals = set(policy.get("signals") or [])

    reasons: list[str] = []
    decision = "optional"
    if policy.get("explicit_request"):
        decision = "required"; reasons.append("explicit user request")
    elif policy.get("required"):
        decision = "required"; reasons.append("manifest report_policy.required")
    elif system == "dev-execution" and tier >= 2:
        decision = "required"; reasons.append(f"dev-execution Tier {tier}")
    elif system == "aos" and tier >= 3:
        decision = "required"; reasons.append(f"AOS Tier {tier}")
    elif system == "aos" and tier == 2:
        decision = "recommended"; reasons.append("AOS Tier 2 reusable workflow")
    elif system == "dev-execution" and tier == 1 and points >= 5:
        decision = "recommended"; reasons.append(f"Tier 1 feature estimated at {points:g} points")
    elif system == "dev-execution" and tier == 1 and signals:
        decision = "recommended"; reasons.append("Tier 1 material signal: " + ", ".join(sorted(signals)))

    waiver = str(policy.get("waiver_reason") or "").strip()
    effective = "waived" if decision == "required" and waiver else decision
    if waiver:
        reasons.append(f"waiver recorded: {waiver}")
    return {"decision": decision, "effective_decision": effective, "route": route,
            "tier_system": system, "tier": tier, "estimated_points": points,
            "reasons": reasons or ["below default reporting threshold"], "waiver_reason": waiver or None}


# ---------------------------------------------------------------------- validation

def all_evidence_refs(data: dict[str, Any]) -> Iterable[tuple[str, str]]:
    for section in ("value_adds", "changes", "findings", "items"):
        for index, item in enumerate(data.get(section) or []):
            if isinstance(item, dict):
                for ref in item.get("evidence_refs") or []:
                    yield f"{section}[{index}]", str(ref)
    for section in ("validation", "metrics", "media"):
        for index, item in enumerate(data.get(section) or []):
            if isinstance(item, dict) and item.get("evidence_ref"):
                yield f"{section}[{index}]", str(item["evidence_ref"])


def _repo_available(repo: Path | None) -> bool:
    """A repo we can actually inspect. When absent (portable manifests, CI without the
    tree) existence/grep checks cannot run and are skipped rather than failed."""
    return repo is not None and repo.is_dir()


def _check_repo_path(repo: Path | None, rel: str) -> bool | None:
    """True/False if the repo is available; None (unknown, skip) when it is not."""
    if not _repo_available(repo):
        return None
    try:
        return (repo / rel).resolve().exists()  # type: ignore[union-attr]
    except OSError:
        return False


def _grep_present(repo: Path | None, rel: str, needle: str) -> bool | None:
    if not _repo_available(repo):
        return None
    try:
        target = (repo / rel).resolve()  # type: ignore[union-attr]
    except OSError:
        return False
    if not target.is_file():
        return False
    try:
        text = target.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return needle in text


def validate_handoff(prefix: str, handoff: dict[str, Any], kind: str,
                     default_repo: Path | None, errors: list[str], warnings: list[str]) -> None:
    """Blocking handoff rules (spec Sec 3.3). Filesystem-only checks; no network."""
    if not isinstance(handoff, dict):
        errors.append(f"{prefix}.handoff must be an object")
        return
    command = handoff.get("command", "MISSING")
    if command == "MISSING":
        errors.append(f"{prefix}.handoff.command is required (use null for human-only acts)")
    if kind == "blocked_external" and command not in (None,):
        errors.append(f"{prefix}.handoff.command must be null for blocked_external (no agent path exists)")

    repo = handoff.get("repo")
    if not isinstance(repo, str) or not repo.strip():
        errors.append(f"{prefix}.handoff.repo is required")
    elif not repo.startswith("/"):
        errors.append(f"{prefix}.handoff.repo must be an ABSOLUTE path: {repo}")
    handoff_repo = Path(repo) if isinstance(repo, str) and repo.strip() else default_repo

    if not str(handoff.get("prompt") or "").strip():
        errors.append(f"{prefix}.handoff.prompt is required and must stand alone")
    elif len(str(handoff["prompt"]).split()) > 60:
        warnings.append(f"{prefix}.handoff.prompt exceeds ~60 words; tighten to the first action + one constraint")

    for rel in handoff.get("paths") or []:
        if _check_repo_path(handoff_repo, str(rel)) is False:
            errors.append(f"{prefix}.handoff path not found at render time: {rel}")

    for rid in handoff.get("requirement_ids") or []:
        paths = handoff.get("paths") or []
        checks = [_grep_present(handoff_repo, str(p), str(rid)) for p in paths]
        # skip when the repo is unavailable (all None); fail only when we could look and found nothing.
        if paths and all(c is not None for c in checks) and not any(checks):
            errors.append(f"{prefix}.handoff requirement id not grep-present in any listed path: {rid}")

    if kind == "deferred" and not str(handoff.get("trigger") or "").strip():
        errors.append(f"{prefix} is deferred but its handoff carries no re-entry trigger")

    tracker = handoff.get("tracker")
    if isinstance(tracker, str) and tracker.strip() and "node_" in tracker:
        if not re.search(r"node_[A-Za-z0-9]+", tracker):
            warnings.append(f"{prefix}.handoff.tracker looks like an IntentTree node but the id is malformed")


def _validate_common(data: dict[str, Any], asset_root: Path,
                     errors: list[str], warnings: list[str]) -> set[str]:
    if data.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version must be {SCHEMA_VERSION!r}")

    report = data.get("report")
    if not isinstance(report, dict):
        errors.append("report must be an object")
        report = {}
    if route_of(data) not in ALL_ROUTES:
        errors.append("report.route must be feature, program, phase, or readiness")
    if report.get("truth_status") not in TRUTH_LABELS:
        errors.append("report.truth_status uses an unknown truth label")
    for field in ("title", "generated_by", "generated_at"):
        if not report.get(field):
            errors.append(f"report.{field} is required")

    repo = repo_root_of(data)
    if repo is not None and not str((report.get("generated_from") or {}).get("repo", "")).startswith("/"):
        errors.append("report.generated_from.repo must be an ABSOLUTE path")

    # evidence index
    evidence_ids: set[str] = set()
    for index, record in enumerate(data.get("evidence") or []):
        if not isinstance(record, dict):
            errors.append(f"evidence[{index}] must be an object")
            continue
        evidence_id = str(record.get("id") or "")
        if not re.fullmatch(r"[A-Za-z0-9._-]+", evidence_id):
            errors.append(f"evidence[{index}].id is invalid")
        elif evidence_id in evidence_ids:
            errors.append(f"duplicate evidence id: {evidence_id}")
        evidence_ids.add(evidence_id)
        if not record.get("label") or not record.get("kind"):
            errors.append(f"evidence[{index}] requires label and kind")
        # existence-check evidence paths too (spec Sec 7.5) — only when the repo is present.
        if record.get("path") and _check_repo_path(repo, str(record["path"])) is False:
            warnings.append(f"evidence[{index}] path not found under generated_from.repo: {record['path']}")

    for location, ref in all_evidence_refs(data):
        if ref not in evidence_ids:
            errors.append(f"{location} references unknown evidence id: {ref}")

    # media
    total_bytes = 0
    for index, item in enumerate(data.get("media") or []):
        if not isinstance(item, dict):
            errors.append(f"media[{index}] must be an object")
            continue
        if item.get("type") not in {"screenshot", "illustration"}:
            errors.append(f"media[{index}].type must be screenshot or illustration")
        if item.get("type") == "illustration" and not item.get("provider"):
            warnings.append(f"media[{index}] is an illustration with no provider recorded (Sec 5.1 audit trail)")
        if not item.get("alt") or not item.get("caption"):
            errors.append(f"media[{index}] requires non-empty alt and caption")
        try:
            asset = resolve_asset(str(item.get("path") or ""), asset_root)
            if not asset.is_file():
                errors.append(f"media[{index}] file not found: {asset}")
                continue
            size = asset.stat().st_size
            total_bytes += size
            if size > MAX_MEDIA_BYTES:
                errors.append(f"media[{index}] exceeds 8 MB: {asset.name}")
            mime = mimetypes.guess_type(asset.name)[0] or ""
            if mime not in ALLOWED_MEDIA_TYPES:
                errors.append(f"media[{index}] unsupported media type: {mime or asset.suffix}")
            if item.get("sensitive"):
                errors.append(f"media[{index}] is marked sensitive; redact or remove before rendering")
        except ReportError as exc:
            errors.append(f"media[{index}]: {exc}")
    if total_bytes > MAX_TOTAL_MEDIA_BYTES:
        errors.append("combined media exceeds 25 MB")

    return evidence_ids


def _validate_feature(data: dict[str, Any], errors: list[str], warnings: list[str]) -> None:
    for field in ("executive_summary", "problem", "solution"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            errors.append(f"{field} must be a non-empty string")
    for field in ("value_adds", "changes", "validation", "evidence"):
        if not isinstance(data.get(field), list) or not data[field]:
            errors.append(f"{field} must contain at least one item")

    # A non-final truth_status renders a visible DRAFT banner (see render_feature); the
    # truth label itself is already validated in _validate_common, so nothing to block here.
    passed = any(i.get("status") == "passed" for i in data.get("validation") or [] if isinstance(i, dict))
    nonexec = any(i.get("status") in {"not_executed", "owner_data_absent", "unverified"}
                  for i in data.get("validation") or [] if isinstance(i, dict))
    if not passed and not nonexec:
        errors.append("validation requires a passed check or an explicit non-execution truth state")

    for index, fu in enumerate(data.get("followups") or []):
        if isinstance(fu, str):
            warnings.append(f"followups[{index}] is a bare string; promote to a handoff object (Sec 7.1)")
        elif isinstance(fu, dict):
            validate_handoff(f"followups[{index}]", fu.get("handoff", {}), "partial",
                             repo_root_of(data), errors, warnings)

    for index, diagram in enumerate(data.get("diagrams") or []):
        if not isinstance(diagram, dict) or diagram.get("type") != "flow":
            errors.append(f"diagrams[{index}] must be a flow object")
            continue
        nodes = diagram.get("nodes") or []
        if not 2 <= len(nodes) <= 8:
            errors.append(f"diagrams[{index}] must contain 2 to 8 nodes")
        node_ids = {str(n.get("id")) for n in nodes if isinstance(n, dict)}
        if len(node_ids) != len(nodes):
            errors.append(f"diagrams[{index}] node IDs must be unique")
        for edge in diagram.get("edges") or []:
            if edge.get("from") not in node_ids or edge.get("to") not in node_ids:
                errors.append(f"diagrams[{index}] edge references an unknown node")

    if not data.get("risks"):
        warnings.append("risks is empty; state residual truth explicitly")


def _validate_status(data: dict[str, Any], errors: list[str], warnings: list[str]) -> None:
    vitals = data.get("vitals")
    if not isinstance(vitals, list) or not vitals:
        errors.append("vitals must contain at least one headline number")
    for index, v in enumerate(vitals or []):
        if not isinstance(v, dict):
            errors.append(f"vitals[{index}] must be an object")
            continue
        for field in ("key", "value"):
            if not str(v.get(field) or "").strip():
                errors.append(f"vitals[{index}].{field} is required")
        if not str(v.get("measured_by") or "").strip():
            errors.append(f"vitals[{index}] needs a measured_by (a headline number with no method is an assertion)")

    domains = data.get("domains")
    if not isinstance(domains, dict) or not domains:
        errors.append("domains must be a non-empty closed vocabulary (name -> group)")
        domains = {}
    for name, group in domains.items():
        if group not in DOMAIN_GROUP_CLASS:
            errors.append(f"domains[{name}] group must be build, knowledge, or governance")

    items = data.get("items")
    if not isinstance(items, list) or not items:
        errors.append("items must contain at least one reportable item")
    seen_ids: set[str] = set()
    repo = repo_root_of(data)
    for index, item in enumerate(items or []):
        if not isinstance(item, dict):
            errors.append(f"items[{index}] must be an object")
            continue
        iid = str(item.get("id") or "")
        prefix = f"items[{index}]({iid or '?'})"
        if not re.fullmatch(r"[A-Za-z0-9._-]+", iid):
            errors.append(f"{prefix}.id is invalid")
        elif iid in seen_ids:
            errors.append(f"duplicate item id: {iid}")
        seen_ids.add(iid)
        if not str(item.get("title") or "").strip():
            errors.append(f"{prefix}.title is required")
        kind = item.get("kind")
        if kind not in ITEM_KINDS:
            errors.append(f"{prefix}.kind must be one of {sorted(ITEM_KINDS)}")
        doms = item.get("domains") or []
        if not 1 <= len(doms) <= 3:
            errors.append(f"{prefix}.domains must carry 1 to 3 domains")
        for d in doms:
            if domains and d not in domains:
                errors.append(f"{prefix} uses domain '{d}' absent from the closed vocabulary")
        handoff = item.get("handoff")
        needs_handoff = kind in HANDOFF_REQUIRED_KINDS
        if needs_handoff and not isinstance(handoff, dict):
            errors.append(f"{prefix} kind={kind} requires a handoff")
        elif isinstance(handoff, dict):
            validate_handoff(prefix, handoff, str(kind), repo, errors, warnings)

    for index, c in enumerate(data.get("corrections") or []):
        if not isinstance(c, dict):
            errors.append(f"corrections[{index}] must be an object")
            continue
        for field in ("claimed", "actual", "verified_by"):
            if not str(c.get(field) or "").strip():
                errors.append(f"corrections[{index}].{field} is required")

    _validate_visuals(data.get("visuals") or {}, errors)


def _validate_visuals(visuals: dict[str, Any], errors: list[str]) -> None:
    flow = visuals.get("flowsheet")
    if isinstance(flow, dict):
        cols = flow.get("columns") or []
        if not cols:
            errors.append("visuals.flowsheet.columns must be non-empty")
        for ri, row in enumerate(flow.get("rows") or []):
            cells = row.get("cells") or []
            if len(cells) != len(cols):
                errors.append(f"visuals.flowsheet.rows[{ri}] has {len(cells)} cells but {len(cols)} columns")
    ladder = visuals.get("ladder")
    if isinstance(ladder, dict):
        if not ladder.get("tracks"):
            errors.append("visuals.ladder.tracks must be non-empty")
        for ti, track in enumerate(ladder.get("tracks") or []):
            for si, step in enumerate(track.get("steps") or []):
                if step.get("state") not in {"done", "part", "blocked", "none"}:
                    errors.append(f"visuals.ladder.tracks[{ti}].steps[{si}].state is invalid")


def validate_manifest(data: dict[str, Any], asset_root: Path,
                      force_required: bool = False) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    route = route_of(data)
    evidence_ids = _validate_common(data, asset_root, errors, warnings)
    if route == FEATURE_ROUTE:
        _validate_feature(data, errors, warnings)
    elif route in STATUS_ROUTES:
        _validate_status(data, errors, warnings)

    # required-report visual/evidence minimums (feature route)
    if route == FEATURE_ROUTE:
        policy = eligibility(data)
        visual_count = len(data.get("media") or []) + len(data.get("diagrams") or []) + len(data.get("metrics") or [])
        if force_required or policy["effective_decision"] == "required":
            if len(evidence_ids) < 2:
                errors.append("required reports need at least two evidence records")
            if visual_count == 0 and not str(data.get("no_visual_reason") or "").strip():
                errors.append("required reports need a relevant visual or no_visual_reason")
        elif policy["effective_decision"] == "recommended" and visual_count == 0:
            warnings.append("recommended report has no visual")
    return errors, warnings


def validate_html(content: str) -> list[str]:
    errors: list[str] = []
    checks = {
        "external script": r"<script\b[^>]*\bsrc\s*=",
        "external stylesheet": r"<link\b[^>]*\bhref\s*=",
        "remote image/media": r"<(?:img|video|audio|source)\b[^>]*\bsrc\s*=\s*['\"]?\s*(?:https?:)?//",
        "remote CSS URL": r"url\(\s*['\"]?\s*(?:https?:)?//",
        "embedded frame": r"<(?:iframe|object|embed)\b",
    }
    for label, pattern in checks.items():
        if re.search(pattern, content, flags=re.IGNORECASE):
            errors.append(f"HTML contains forbidden {label}")
    if "Content-Security-Policy" not in content:
        errors.append("HTML is missing Content-Security-Policy")
    if "default-src 'none'" not in content:
        errors.append("HTML CSP does not default to no external resources")
    return errors


# ------------------------------------------------------------------------ shared render

CSP = ("default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
       "font-src data:; connect-src 'none'; media-src data:; frame-src 'none'; object-src 'none'; "
       "base-uri 'none'; form-action 'none'")


def _assets() -> tuple[str, str]:
    root = Path(__file__).resolve().parent.parent
    css = (root / "assets" / "report.css").read_text(encoding="utf-8")
    js = (root / "assets" / "report.js").read_text(encoding="utf-8")
    return css, js


def dom_class(domains_map: dict[str, str], name: str) -> str:
    group = domains_map.get(name) or DEFAULT_DOMAINS.get(name, "build")
    return DOMAIN_GROUP_CLASS.get(group, "build")


def dom_chips(domains_map: dict[str, str], names: list[str]) -> str:
    chips = "".join(
        '<span class="dom dom-%s">%s</span>' % (dom_class(domains_map, d), e(d)) for d in names
    )
    return '<span class="doms">%s</span>' % chips


def refs_html(refs: Iterable[str]) -> str:
    refs = list(refs)
    if not refs:
        return ""
    return '<div class="refs">' + "".join(
        f'<a class="ref" href="#evidence-{e(ref)}">{e(ref)}</a>' for ref in refs
    ) + "</div>"


def theme_toggle() -> str:
    return '<button class="theme-toggle" type="button" aria-label="Toggle colour theme">Theme</button>'


# ----- handoff copy component (shared by feature followups + status items) -----

def payload_text(title: str, domains: list[str], handoff: dict[str, Any], constraints: str) -> str:
    command = handoff.get("command")
    lines = [command if command else "human decision -- no agent path", ""]
    lines.append("Task: %s" % title)
    if domains:
        lines.append("Domains: %s" % ", ".join(domains))
    if handoff.get("repo"):
        lines.append("Repo: %s" % handoff["repo"])
    lines.append("")
    if handoff.get("paths"):
        lines.append("Paths:")
        lines += ["  - %s" % p for p in handoff["paths"]]
        lines.append("")
    if handoff.get("requirement_ids"):
        lines.append("Requirement IDs: %s" % ", ".join(handoff["requirement_ids"]))
    if handoff.get("gates"):
        lines.append("Gates: %s (blocked-external, human-only)" % ", ".join(handoff["gates"]))
    if handoff.get("tracker"):
        lines.append("Tracker: %s" % handoff["tracker"])
    if handoff.get("trigger"):
        lines.append("Re-entry trigger: %s" % handoff["trigger"])
    lines.append("")
    lines.append("Prompt:")
    lines.append(str(handoff.get("prompt", "")))
    if constraints:
        lines.append("")
        lines.append("Constraints: %s" % constraints)
    return "\n".join(lines)


def handoff_block(title: str, domains: list[str], handoff: dict[str, Any],
                  repo: Path | None, constraints: str) -> str:
    command = handoff.get("command")
    human = command is None
    rows = []
    cmd_html = ('<span class="cmd human">human decision &mdash; no agent path</span>'
                if human else '<span class="cmd">%s</span>' % e(command))
    rows.append('<div class="ns-row"><span class="kk">Command</span><span class="vv">%s</span></div>' % cmd_html)
    if handoff.get("repo"):
        rows.append('<div class="ns-row"><span class="kk">Repo</span><span class="vv">%s</span></div>' % e(handoff["repo"]))
    if handoff.get("paths"):
        parts = []
        for p in handoff["paths"]:
            missing = _check_repo_path(repo, str(p)) is False
            parts.append('<span class="miss">%s (missing)</span>' % e(p) if missing else e(p))
        rows.append('<div class="ns-row"><span class="kk">Paths</span><span class="vv">%s</span></div>'
                    % "<br />".join(parts))
    if handoff.get("requirement_ids"):
        ids = "".join('<span class="idc">%s</span>' % e(i) for i in handoff["requirement_ids"])
        rows.append('<div class="ns-row"><span class="kk">IDs</span><span class="vv">%s</span></div>' % ids)
    if handoff.get("gates"):
        gs = "".join('<span class="idc gate">%s</span>' % e(g) for g in handoff["gates"])
        rows.append('<div class="ns-row"><span class="kk">Gates</span><span class="vv">%s</span></div>' % gs)
    if handoff.get("tracker"):
        rows.append('<div class="ns-row"><span class="kk">Tracker</span><span class="vv">%s</span></div>' % e(handoff["tracker"]))
    if handoff.get("trigger"):
        rows.append('<div class="ns-row"><span class="kk">Trigger</span><span class="vv">%s</span></div>' % e(handoff["trigger"]))
    summary = "Human action" if human else "Next step"
    cls = "ns human" if human else "ns"
    return (
        '<details class="%s"><summary>%s</summary><div class="ns-body">' % (cls, summary)
        + "".join(rows)
        + '<p class="ns-prompt">%s</p>' % e(handoff.get("prompt", ""))
        + '<div class="ns-foot"><button class="copy-btn" type="button">Copy handoff</button></div>'
        + '<pre class="ns-payload">%s</pre>' % e(payload_text(title, domains, handoff, constraints))
        + "</div></details>"
    )


# --------------------------------------------------------------------- feature render

def render_metrics(metrics: list[dict[str, Any]]) -> str:
    if not metrics:
        return ""
    row_h, width = 84, 900
    height = 54 + row_h * len(metrics)
    frags = [
        f'<div class="chart"><svg viewBox="0 0 {width} {height}" role="img" aria-label="Before and after metrics">',
        '<style>.m-label{fill:currentColor;font:600 14px system-ui}.m-value{fill:gray;font:12px system-ui}'
        '.m-before{fill:gray}.m-after{fill:#38bdf8}</style>',
    ]
    for idx, metric in enumerate(metrics):
        before = metric.get("before")
        after = float(metric.get("after", 0))
        values = [abs(after)] + ([abs(float(before))] if before is not None else [])
        scale = 560 / max(values + [1])
        y = 24 + idx * row_h
        frags.append(f'<text class="m-label" x="0" y="{y + 15}">{e(metric.get("label", "Metric"))}</text>')
        unit = e(metric.get("unit", ""))
        if before is not None:
            bw = max(2, abs(float(before)) * scale)
            frags.append(f'<rect class="m-before" x="250" y="{y}" width="{bw:.1f}" height="22" rx="5"/>')
            frags.append(f'<text class="m-value" x="{min(830, 258 + bw):.1f}" y="{y + 16}">before {e(before)} {unit}</text>')
        aw = max(2, abs(after) * scale)
        ay = y + 30
        frags.append(f'<rect class="m-after" x="250" y="{ay}" width="{aw:.1f}" height="22" rx="5"/>')
        frags.append(f'<text class="m-value" x="{min(830, 258 + aw):.1f}" y="{ay + 16}">after {e(metric.get("after"))} {unit}</text>')
    frags.append("</svg></div>")
    return "".join(frags)


def render_flow(diagram: dict[str, Any]) -> str:
    nodes = diagram.get("nodes") or []
    edges = diagram.get("edges") or []
    count = len(nodes)
    width = max(720, count * 220)
    height = 250
    box_w, box_h = 170, 92
    gap = (width - count * box_w) / (count + 1)
    positions: dict[str, tuple[float, float]] = {}
    frags = [
        f'<div class="diagram"><h3>{e(diagram.get("title", "Flow"))}</h3>',
        f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{e(diagram.get("title", "Flow"))}">',
        '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">'
        '<path d="M0,0 L8,4 L0,8 z" fill="gray"/></marker></defs>',
        '<style>.d-box{fill:none;stroke:#38bdf8;stroke-width:2}.d-title{fill:currentColor;font:700 14px system-ui}'
        '.d-detail{fill:gray;font:12px system-ui}.d-edge{stroke:gray;stroke-width:2;marker-end:url(#arrow)}'
        '.d-elabel{fill:gray;font:11px system-ui}</style>',
    ]
    for idx, node in enumerate(nodes):
        x = gap + idx * (box_w + gap)
        y = 70 + (16 if idx % 2 else 0)
        positions[str(node.get("id"))] = (x, y)
    for edge in edges:
        start = positions.get(str(edge.get("from")))
        end = positions.get(str(edge.get("to")))
        if not start or not end:
            continue
        x1, y1 = start[0] + box_w, start[1] + box_h / 2
        x2, y2 = end[0], end[1] + box_h / 2
        frags.append(f'<line class="d-edge" x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2 - 9:.1f}" y2="{y2:.1f}"/>')
        if edge.get("label"):
            frags.append(f'<text class="d-elabel" x="{(x1+x2)/2:.1f}" y="{(y1+y2)/2-8:.1f}" text-anchor="middle">{e(edge["label"])}</text>')
    for node in nodes:
        x, y = positions[str(node.get("id"))]
        frags.append(f'<rect class="d-box" x="{x:.1f}" y="{y:.1f}" width="{box_w}" height="{box_h}" rx="13"/>')
        frags.append(f'<text class="d-title" x="{x + 15:.1f}" y="{y + 34:.1f}">{e(str(node.get("label", ""))[:30])}</text>')
        if node.get("detail"):
            frags.append(f'<text class="d-detail" x="{x + 15:.1f}" y="{y + 60:.1f}">{e(str(node.get("detail", ""))[:46])}</text>')
    frags.append("</svg>")
    if diagram.get("caption"):
        frags.append(f'<p class="muted">{e(diagram["caption"])}</p>')
    frags.append("</div>")
    return "".join(frags)


def render_feature(data: dict[str, Any], asset_root: Path) -> str:
    css, js = _assets()
    report = data["report"]
    domains_map = data.get("domains") or {}
    title = report["title"]
    policy = eligibility(data)
    draft = report.get("truth_status") not in {"verified", "shipped"}
    constraints = str(report.get("constraints") or "")

    toc_items = [("overview", "Overview"), ("value", "Value"), ("changes", "What changed"),
                 ("visuals", "Visuals"), ("findings", "Findings"), ("validation", "Validation"),
                 ("risks", "Residual truth"), ("evidence", "Evidence")]
    toc = "".join(f'<a href="#{a}">{l}</a>' for a, l in toc_items)

    def dom_line(item):
        d = item.get("domains") or []
        return dom_chips(domains_map, d) if d else ""

    value_cards = "".join(
        '<article class="card accent">'
        + (f'<div class="beneficiary">For {e(i.get("beneficiary"))}</div>' if i.get("beneficiary") else "")
        + f'<h3>{e(i.get("title"))}</h3><p>{e(i.get("detail"))}</p>'
        + dom_line(i) + refs_html(i.get("evidence_refs") or []) + "</article>"
        for i in data.get("value_adds") or []
    )
    changes = "".join(
        f'<article class="change"><div class="area">{e(i.get("area"))}</div><div><p>{e(i.get("plain_english"))}</p>'
        + (f'<p class="technical">Technical detail: {e(i.get("technical_detail"))}</p>' if i.get("technical_detail") else "")
        + dom_line(i) + refs_html(i.get("evidence_refs") or []) + "</div></article>"
        for i in data.get("changes") or []
    )
    key_points = "".join(f"<li>{e(p)}</li>" for p in data.get("key_points") or [])
    findings = "".join(
        f'<article class="card"><span class="status {e(i.get("status"))}">{e(i.get("status"))}</span>'
        f'<h3>{e(i.get("title"))}</h3><p>{e(i.get("detail"))}</p><p class="muted">Impact: {e(i.get("impact"))}</p>'
        + dom_line(i) + refs_html(i.get("evidence_refs") or []) + "</article>"
        for i in data.get("findings") or []
    ) or '<p class="muted">No material findings recorded.</p>'
    validation_rows = "".join(
        f'<tr><td><span class="status {e(i.get("status"))}">{e(i.get("status"))}</span>'
        + (f'<br><span class="muted">by {e(i.get("verified_by"))}</span>' if i.get("verified_by") else "")
        + f'</td><td><strong>{e(i.get("name"))}</strong><br><span class="muted">{e(i.get("result"))}</span></td>'
        + (f'<td><code class="copyable">{e(i.get("command"))}</code></td>' if i.get("command") else "<td></td>")
        + f'<td>{refs_html([i["evidence_ref"]]) if i.get("evidence_ref") else ""}</td></tr>'
        for i in data.get("validation") or []
    )
    media_html = "".join(
        '<figure class="visual">'
        f'<img src="{media_data_uri(resolve_asset(str(i["path"]), asset_root))}" alt="{e(i["alt"])}">'
        f'<figcaption><span class="visual-label">{e(i["type"])}</span> &mdash; {e(i["caption"])}'
        + (f' <span class="muted">(via {e(i.get("provider"))})</span>' if i.get("provider") else "")
        + '</figcaption></figure>'
        for i in data.get("media") or []
    )
    metrics_html = render_metrics(data.get("metrics") or [])
    diagrams_html = "".join(render_flow(d) for d in data.get("diagrams") or [])
    no_visual = (f'<div class="card"><strong>No visual included.</strong><p class="muted">{e(data.get("no_visual_reason"))}</p></div>'
                 if data.get("no_visual_reason") else "")
    timeline_html = "".join(
        f'<div class="moment"><strong>{e(i.get("label"))}</strong><span class="muted">{e(i.get("detail"))}</span></div>'
        for i in data.get("timeline") or []
    )
    risks = "".join(f"<li>{e(i)}</li>" for i in data.get("risks") or []) or "<li>None identified after current validation.</li>"

    followups_html = ""
    for fu in data.get("followups") or []:
        if isinstance(fu, str):
            followups_html += f"<li>{e(fu)}</li>"
        elif isinstance(fu, dict):
            block = handoff_block(fu.get("title", ""), [], fu.get("handoff", {}),
                                  repo_root_of(data), constraints)
            followups_html += f'<li><strong>{e(fu.get("title"))}</strong>' \
                              + (f' &mdash; {e(fu.get("detail"))}' if fu.get("detail") else "") + block + "</li>"
    followups_html = followups_html or "<li>No follow-ups recorded.</li>"

    evidence_html = "".join(
        f'<article class="evidence" id="evidence-{e(i.get("id"))}"><div class="evidence-id">{e(i.get("id"))}</div><div>'
        f'<strong>{e(i.get("label"))}</strong><div class="evidence-meta">{e(i.get("kind"))}'
        + (f' &middot; <code>{e(i.get("path"))}</code>' if i.get("path") else "")
        + (f' &middot; commit <code>{e(i.get("commit"))}</code>' if i.get("commit") else "")
        + (f'<br>{e(i.get("note"))}' if i.get("note") else "")
        + "</div></div></article>"
        for i in data.get("evidence") or []
    )

    body = f'''<body class="dr route-feature">
{theme_toggle()}
<header class="hero"><div class="shell">
  <div class="eyebrow">Feature report &middot; {e(report.get('project') or report.get('subject'))}</div>
  <h1>{e(title)}</h1>
  <p class="lede" data-summary>{e(data.get('executive_summary'))}</p>
  <div class="meta">
    <span class="pill {e(report.get('truth_status'))}">{e(report.get('truth_status'))}</span>
    <span class="pill">report {e(policy.get('effective_decision'))}</span>
    <span class="pill">{e(report.get('generated_at'))}</span>
  </div>
  {('<div class="draft-banner">DRAFT &mdash; this artifact does not represent completed work.</div>' if draft else '')}
  <div class="toolbar"><button class="btn" data-copy-summary>Copy summary</button><button class="btn" data-print>Print / save PDF</button></div>
</div></header>
<div class="shell layout">
  <nav class="toc" aria-label="Report sections"><strong>Contents</strong>{toc}</nav>
  <main>
    <section id="overview"><h2>What was delivered</h2><div class="split"><article class="card"><h3>The problem</h3><p>{e(data.get('problem'))}</p></article><article class="card"><h3>The solution</h3><p>{e(data.get('solution'))}</p></article></div></section>
    <section id="value"><h2>Value added</h2><div class="cards">{value_cards}</div></section>
    <section id="changes"><h2>What changed</h2>{changes}{('<h3>Key points</h3><ul class="list">'+key_points+'</ul>' if key_points else '')}</section>
    <section id="visuals"><h2>Visual explanation</h2><div class="visual-grid">{media_html}</div>{metrics_html}{diagrams_html}{no_visual}{('<h3>Delivery timeline</h3><div class="timeline">'+timeline_html+'</div>' if timeline_html else '')}</section>
    <section id="findings"><h2>Findings</h2><div class="cards">{findings}</div></section>
    <section id="validation"><h2>How completion was verified</h2><table class="validation"><thead><tr><th>Status</th><th>Check and result</th><th>Command</th><th>Evidence</th></tr></thead><tbody>{validation_rows}</tbody></table></section>
    <section id="risks"><h2>Residual truth</h2><div class="split"><article class="card"><h3>Risks and limitations</h3><ul class="list">{risks}</ul></article><article class="card"><h3>Follow-ups</h3><ul class="list">{followups_html}</ul></article></div>{(f'<p class="muted">Scope note: {e(report.get("scope_note"))}</p>' if report.get('scope_note') else '')}</section>
    <section id="evidence"><h2>Evidence index</h2>{evidence_html}</section>
  </main>
</div>
<footer><div class="shell">Generated by {e(report.get('generated_by'))} at {e(report.get('generated_at'))}. Source manifest remains canonical.</div></footer>
<script>{js}</script>
</body>'''
    return _document(title, "Feature Report", css, body)


# ---------------------------------------------------------------------- status render

def render_flowsheet(flow: dict[str, Any]) -> str:
    cols = flow.get("columns") or []
    head = "".join(f"<th>{e(c)}</th>" for c in cols)
    rows_html = []
    for row in flow.get("rows") or []:
        tag = f'<span class="tag">{e(row["tag"])}</span>' if row.get("tag") else ""
        cells = []
        for c in row.get("cells") or []:
            if c is None or c == 0:
                cells.append('<td class="cell empty"></td>')
            else:
                d = "d3" if c >= 4 else ("d2" if c >= 2 else "d1")
                cells.append(f'<td class="cell"><span class="dot {d}">{e(c)}</span></td>')
        rows_html.append(f'<tr><th class="rowhead">{e(row.get("label"))}{tag}</th>{"".join(cells)}</tr>')
    legend = "".join(f"<span>{e(l)}</span>" for l in flow.get("legend") or [])
    note = f'<span class="h2-note">{e(flow.get("caption"))}</span>' if flow.get("caption") else ""
    return (f'<section><h2>{e(flow.get("title") or "Activity flowsheet")} {note}</h2>'
            f'<div class="scroller"><table class="flow"><thead><tr><th class="rowhead">Workstream</th>{head}</tr></thead>'
            f'<tbody>{"".join(rows_html)}</tbody></table></div>'
            + (f'<div class="legend">{legend}</div>' if legend else "") + "</section>")


def render_ladder(ladder: dict[str, Any], domains_map: dict[str, str]) -> str:
    tracks_html = []
    for track in ladder.get("tracks") or []:
        note = f' <em>&mdash; {e(track["note"])}</em>' if track.get("note") else ""
        steps = []
        for step in track.get("steps") or []:
            state = step.get("state", "none")
            doms = dom_chips(domains_map, step.get("domains") or []) if step.get("domains") else ""
            ev = f'<span class="ev">{e(step["ev"])}</span>' if step.get("ev") else ""
            label = f'<strong>{e(step["label"])}</strong> ' if step.get("label") else ""
            steps.append(
                f'<div class="step s-{e(state)}"><div class="code">{e(step.get("code"))}<small>{e(state)}</small></div>'
                f'<div class="body">{("<div class=\"domline\">"+doms+"</div>") if doms else ""}{label}{e(step.get("body"))}{ev}</div></div>'
            )
        tracks_html.append(f'<div><div class="track-h">{e(track.get("title"))}{note}</div>{"".join(steps)}</div>')
    here = ""
    if ladder.get("here"):
        h = ladder["here"]
        here = f'<div class="here"><span>{e(h.get("label"))}</span><span>{e(h.get("detail"))}</span></div>'
    note = f'<span class="h2-note">{e(ladder.get("caption"))}</span>' if ladder.get("caption") else ""
    return (f'<section><h2>{e(ladder.get("title") or "Tracks")} {note}</h2>'
            f'<div class="tracks">{"".join(tracks_html)}</div>{here}</section>')


def render_status(data: dict[str, Any], asset_root: Path) -> str:
    css, js = _assets()
    report = data["report"]
    route = route_of(data)
    domains_map = data.get("domains") or {}
    title = report["title"]
    constraints = str(report.get("constraints") or "")
    repo = repo_root_of(data)

    gf = report.get("generated_from") or {}
    eyebrow_parts = [f"{route.title()} status", e(report.get("subject") or report.get("project") or "")]
    if report.get("revision"):
        eyebrow_parts.append(f"rev {e(report['revision'])}")
    if gf.get("ref") or gf.get("commit"):
        eyebrow_parts.append(e(f"{gf.get('ref','')} {gf.get('commit','')}".strip()))
    eyebrow_parts.append(e(report.get("generated_at")))
    eyebrow = '<span class="sep">/</span>'.join(f"<span>{p}</span>" for p in eyebrow_parts if p)

    vitals = "".join(
        f'<div class="vital is-{e(v.get("severity","neutral"))}"><div class="k">{e(v.get("key"))}</div>'
        f'<div class="v">{e(v.get("value"))}</div>'
        + (f'<div class="sub">{e(v.get("sub"))}</div>' if v.get("sub") else "")
        + f'<div class="measured">{e(v.get("measured_by"))}</div></div>'
        for v in data.get("vitals") or []
    )

    corrections = ""
    if data.get("corrections"):
        rows = "".join(
            f'<p><strong>Rev {e(c.get("revision"))} claimed:</strong> {e(c.get("claimed"))}<br>'
            f'<strong>Actually:</strong> {e(c.get("actual"))}<br>'
            f'<span class="muted">Verified by: {e(c.get("verified_by"))}</span></p>'
            for c in data["corrections"]
        )
        corrections = ('<section><h2>Corrections <span class="h2-note">prior-revision claims now known wrong</span></h2>'
                       f'<div class="callout warn"><div class="ct">What changed since the last revision</div>{rows}</div></section>')

    visuals = data.get("visuals") or {}
    flowsheet = render_flowsheet(visuals["flowsheet"]) if visuals.get("flowsheet") else ""
    ladder = render_ladder(visuals["ladder"], domains_map) if visuals.get("ladder") else ""

    pill_class = {"shipped": "p-ok", "partial": "p-part", "not_started": "p-none",
                  "blocked_external": "p-crit", "deferred": "p-deferred", "finding": "p-blocked"}
    item_rows = []
    for item in data.get("items") or []:
        kind = item.get("kind", "")
        label = item.get("status_label") or kind.replace("_", " ")
        doms = dom_chips(domains_map, item.get("domains") or [])
        handoff = item.get("handoff")
        hb = handoff_block(item.get("title", ""), item.get("domains") or [], handoff, repo, constraints) if isinstance(handoff, dict) else ""
        vb = f'<span class="muted"> &middot; {e(item.get("verified_by"))}</span>' if item.get("verified_by") else ""
        note = e(item.get("note")) if item.get("note") else ""
        item_rows.append(
            f'<tr><td>{e(item.get("title"))}</td><td>{doms}</td>'
            f'<td class="nowrap"><span class="pill {pill_class.get(kind,"p-none")}">{e(label)}</span>{vb}</td>'
            f'<td>{note}{hb}</td></tr>'
        )
    items_table = (
        '<section><h2>Items <span class="h2-note">every open item carries a copyable handoff</span></h2>'
        '<div class="scroller"><table class="data"><thead><tr><th>Item</th><th>Domains</th><th>State</th>'
        f'<th>Notes &amp; next step</th></tr></thead><tbody>{"".join(item_rows)}</tbody></table></div></section>'
    )

    # domain key
    groups: dict[str, list[str]] = {"build": [], "know": [], "gov": []}
    for name, group in domains_map.items():
        groups.setdefault(DOMAIN_GROUP_CLASS.get(group, "build"), []).append(name)
    key_rows = ""
    for cls, gname in (("build", "Build"), ("know", "Knowledge"), ("gov", "Governance")):
        names = groups.get(cls) or []
        if names:
            chips = "".join(f'<span class="dom dom-{cls}">{e(n)}</span>' for n in names)
            key_rows += (f'<tr><td><span class="dom dom-{cls}">{gname}</span></td>'
                         f'<td><span class="doms">{chips}</span></td></tr>')
    domain_key = (f'<section><h2>Domain key <span class="h2-note">closed vocabulary used throughout</span></h2>'
                  f'<div class="scroller"><table class="data" style="min-width:520px;"><thead><tr><th>Group</th>'
                  f'<th>Domains</th></tr></thead><tbody>{key_rows}</tbody></table></div></section>') if key_rows else ""

    media_html = "".join(
        '<figure>'
        f'<img src="{media_data_uri(resolve_asset(str(i["path"]), asset_root))}" alt="{e(i["alt"])}">'
        f'<figcaption><b>{e(i["type"])}</b> &mdash; {e(i["caption"])}'
        + (f' (via {e(i.get("provider"))})' if i.get("provider") else "")
        + '</figcaption></figure>'
        for i in data.get("media") or []
    )
    media_section = f'<section><h2>Visuals</h2>{media_html}</section>' if media_html else ""
    no_visual = (f'<section><h2>Visuals</h2><div class="callout"><div class="ct">No visual</div><p>{e(data.get("no_visual_reason"))}</p></div></section>'
                 if data.get("no_visual_reason") and not media_html else "")

    scope = f'<p class="muted">{e(report.get("scope_note"))}</p>' if report.get("scope_note") else ""
    footer_constraints = f'<strong>{e(constraints)}</strong><br /><br />' if constraints else ""

    body = f'''<body class="dr route-status" data-route="{e(route)}">
{theme_toggle()}
<div class="wrap">
<header class="masthead">
  <div class="eyebrow">{eyebrow}</div>
  <h1>{e(title)}</h1>
  {(f'<p class="dek">{e(report.get("scope_note"))}</p>' if report.get("scope_note") else "")}
</header>
<section aria-label="Vitals"><div class="vitals">{vitals}</div></section>
{corrections}
{flowsheet}
{ladder}
{items_table}
{media_section}{no_visual}
{domain_key}
<footer>{footer_constraints}Revision {e(report.get("revision") or 1)}, generated by {e(report.get("generated_by"))} at {e(report.get("generated_at"))}. {scope} Source manifest remains canonical; the handoff prompts are drafting aids &mdash; pasting one starts work, it does not authorize anything.</footer>
</div>
<script>{js}</script>
</body>'''
    return _document(title, f"{route.title()} Status", css, body)


def _document(title: str, kind: str, css: str, body: str) -> str:
    head = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f'<meta http-equiv="Content-Security-Policy" content="{CSP}">\n'
        f'<title>{e(title)} &mdash; {e(kind)}</title>\n<style>{css}</style>\n</head>\n'
    )
    return ascii_entities(head + body + "\n</html>")


def render_report(data: dict[str, Any], asset_root: Path) -> str:
    errors, _ = validate_manifest(data, asset_root)
    if errors:
        raise ReportError("manifest validation failed:\n- " + "\n- ".join(errors))
    route = route_of(data)
    if route == FEATURE_ROUTE:
        return render_feature(data, asset_root)
    return render_status(data, asset_root)


# ------------------------------------------------------------------------ export

def build_export(data: dict[str, Any], target: str, html_path: Path | None,
                 manifest_path: Path) -> dict[str, Any]:
    """Deterministic, offline writeback envelope. Ingestion via subsystem CLIs is
    a documented follow-on (references/aos-integration.md) — never on the render path."""
    report = data.get("report") or {}
    trackers = []
    for item in data.get("items") or []:
        h = item.get("handoff") or {}
        if h.get("tracker"):
            trackers.append({"item": item.get("id"), "tracker": h["tracker"], "kind": item.get("kind")})
    return {
        "envelope_version": "1.0",
        "artifact_type": "delivery-report",
        "target": target,
        "route": route_of(data),
        "title": report.get("title"),
        "subject": report.get("subject") or report.get("project"),
        "revision": report.get("revision"),
        "truth_status": report.get("truth_status"),
        "generated_from": report.get("generated_from"),
        "generated_by": report.get("generated_by"),
        "generated_at": report.get("generated_at"),
        "manifest_path": str(manifest_path),
        "html_path": str(html_path) if html_path else None,
        "tracker_links": trackers,
        "item_count": len(data.get("items") or []),
    }


# --------------------------------------------------------------------------- init

def init_manifest(args: argparse.Namespace) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    common_report = {
        "route": args.route, "title": args.title, "revision": 1,
        "generated_from": {"repo": "/ABSOLUTE/PATH/TO/REPO", "ref": "origin/main", "commit": "TODO"},
        "truth_status": "partially_verified",
        "generated_by": f"delivery-report {VERSION}", "generated_at": now,
        "constraints": "TODO: project invariants a dispatched agent must never violate.",
    }
    if args.route == FEATURE_ROUTE:
        common_report["project"] = args.subject
        return {
            "schema_version": SCHEMA_VERSION,
            "report": common_report,
            "report_policy": {"tier_system": args.tier_system, "tier": args.tier,
                              "estimated_points": args.points, "explicit_request": False, "signals": []},
            "executive_summary": "TODO: problem, delivered outcome, current truth in plain English.",
            "problem": "TODO", "solution": "TODO",
            "value_adds": [{"title": "TODO", "detail": "TODO", "beneficiary": "TODO", "evidence_refs": []}],
            "changes": [{"area": "TODO", "plain_english": "TODO", "evidence_refs": []}],
            "validation": [{"name": "TODO", "command": "TODO", "result": "TODO", "status": "unverified"}],
            "risks": ["TODO or none identified after current validation."],
            "followups": [],
            "media": [], "no_visual_reason": "TODO: add a visual or say why none helps.",
            "evidence": [{"id": "tree", "label": "TODO exact tree/commit", "kind": "tree"}],
        }
    common_report["subject"] = args.subject
    return {
        "schema_version": SCHEMA_VERSION,
        "report": common_report,
        "vitals": [{"key": "TODO", "value": "TODO", "sub": "", "severity": "neutral",
                    "measured_by": "TODO: the command or method that produced this number"}],
        "corrections": [],
        "domains": dict(DEFAULT_DOMAINS),
        "items": [{"id": "todo-1", "title": "TODO", "kind": "not_started", "domains": ["Engine"],
                   "handoff": {"command": "/plan-feature", "repo": "/ABSOLUTE/PATH/TO/REPO",
                               "paths": [], "requirement_ids": [], "gates": [], "tracker": None,
                               "prompt": "TODO: self-contained imperative first action + one constraint."}}],
        "visuals": {},
        "media": [], "no_visual_reason": "",
        "evidence": [],
    }


# --------------------------------------------------------------------------- CLI

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", action="version", version=VERSION)
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="create a report manifest skeleton")
    init.add_argument("--route", choices=sorted(ALL_ROUTES), default="program")
    init.add_argument("--title", required=True)
    init.add_argument("--subject", required=True, help="repo/program name (or project slug for feature route)")
    init.add_argument("--tier-system", choices=("dev-execution", "aos", "custom"), default="dev-execution")
    init.add_argument("--tier", type=int, choices=range(0, 5), default=2)
    init.add_argument("--points", type=float, default=0)
    init.add_argument("--out", type=Path, required=True)

    for name in ("eligibility", "render", "validate", "export"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--manifest", type=Path, required=True)
        if name in {"render", "validate"}:
            cmd.add_argument("--asset-root", type=Path)
        if name == "render":
            cmd.add_argument("--out", type=Path, required=True)
        if name == "validate":
            cmd.add_argument("--html", type=Path)
            cmd.add_argument("--require-report", action="store_true")
            cmd.add_argument("--expect-route", choices=sorted(ALL_ROUTES))
            cmd.add_argument("--expect-tier-system", choices=("dev-execution", "aos", "custom"))
            cmd.add_argument("--expect-tier", type=int, choices=range(0, 5))
        if name == "export":
            cmd.add_argument("--target", choices=sorted(EXPORT_TARGETS), required=True)
            cmd.add_argument("--html", type=Path)
            cmd.add_argument("--out", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "init":
            data = init_manifest(args)
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            print(json.dumps({"ok": True, "manifest": str(args.out), "route": args.route}, indent=2))
            return 0

        data = load_manifest(args.manifest)
        if args.command == "eligibility":
            print(json.dumps(eligibility(data), indent=2))
            return 0

        if args.command == "export":
            envelope = build_export(data, args.target, args.html, args.manifest)
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(envelope, indent=2) + "\n", encoding="utf-8")
            print(json.dumps({"ok": True, "export": str(args.out), "target": args.target}, indent=2))
            return 0

        asset_root = (args.asset_root or args.manifest.parent).resolve()
        if args.command == "render":
            output = render_report(data, asset_root)
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(output, encoding="utf-8")
            print(json.dumps({"ok": True, "html": str(args.out), "bytes": len(output.encode("utf-8")),
                              "route": route_of(data)}, indent=2))
            return 0

        # validate
        errors, warnings = validate_manifest(data, asset_root, force_required=args.require_report)
        if args.expect_route and route_of(data) != args.expect_route:
            errors.append(f"report.route {route_of(data)!r} does not match expected {args.expect_route!r}")
        policy = data.get("report_policy") or {}
        if args.expect_tier_system and policy.get("tier_system") != args.expect_tier_system:
            errors.append(f"report_policy.tier_system {policy.get('tier_system')!r} does not match expected {args.expect_tier_system!r}")
        if args.expect_tier is not None and int(policy.get("tier", -1)) != args.expect_tier:
            errors.append(f"report_policy.tier {policy.get('tier')!r} does not match expected {args.expect_tier}")
        if args.html:
            if not args.html.is_file():
                errors.append(f"HTML file not found: {args.html}")
            else:
                errors.extend(validate_html(args.html.read_text(encoding="utf-8")))
        print(json.dumps({"ok": not errors, "errors": errors, "warnings": warnings,
                          "route": route_of(data)}, indent=2))
        return 0 if not errors else 1
    except (OSError, ReportError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
