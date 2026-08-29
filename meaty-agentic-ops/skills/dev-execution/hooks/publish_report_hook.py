#!/usr/bin/env python3
"""Compose M1's export + M2's actuation into one phase/plan-close publish action.

The engine behind ``publish-report.sh`` (M3, design contract D3 in
``.claude/worknotes/delivery-report-hosting-and-linking/implementation-notes.md``). It never
renders anything and never talks to atlas/IntentTree directly — it shells out to the two
existing, closed scripts in the sibling ``delivery-report`` skill:

  1. ``delivery_report.py export --target atlas`` (M1) — turns a report manifest + its already-
     rendered HTML into a writeback envelope carrying ``instance_key``/``link_identity`` (D1/D2).
  2. ``publish_report.py`` (M2) — atlas-ingests the HTML, resolves scope, runs the R1 guardrail,
     and writes the IntentTree link.

Both scripts are treated as read-only dependencies (AOS constraint 7 — talk to a subsystem
through its CLI, never re-implement it); this module does not import or duplicate their logic.

Dossier deference (risk R4): for the singular per-feature routes (``feature``/``dossier``), if a
live delivery-dossier manifest already exists for the same feature slug, this engine switches its
target to that dossier manifest (and its rendered HTML) instead of publishing the manifest it was
given — the dossier is the one living per-feature record; this engine must never spawn a second,
competing one. Routes ``phase``/``program``/``readiness`` are legitimately N-per-scope and are
never deferred.

No-collapse (risk R1b / DI-283, the M3 headline AC): for the recurring routes the caller supplies
``--instance-key`` (the wrapper derives it deterministically from the phase/milestone id or
decision date — never from ``subject`` or a timestamp, per D1). Its absence for those routes is a
local, non-fatal skip (exit 4) — this module refuses to invent one.

Exit codes (consumed ONLY by the wrapper `publish-report.sh`, which always exits 0 itself):
  0  published (or, under --dry-run, would publish) — M2 exit 0
  1  guardrail rejected the resolved node (R1) — M2 exit 1; the wrapper logs this LOUDLY
  2  export or atlas/resolution/usage failure — M1 or M2 exit 2 (or a subprocess launch failure)
  3  `itt link report` verb unavailable on the installed CLI (D5) — M2 exit 3, benign skip
  4  local skip: no manifest/HTML/instance-key to act on — never reaches M1/M2
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

STATUS_ROUTES = {"program", "phase", "readiness"}
SINGULAR_ROUTES = {"feature", "dossier"}
DEFAULT_DOSSIER_ROOT = ".claude/reports/dossier"


def slugify(text: Any) -> str:
    text = str(text or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def emit(payload: dict[str, Any], code: int) -> int:
    payload.setdefault("ok", code == 0)
    sys.stdout.write(json.dumps(payload) + "\n")
    return code


def load_manifest(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def report_route_and_subject(data: dict[str, Any]) -> tuple[str, str]:
    report = data.get("report") or {}
    route = str(report.get("route") or "")
    subject = str(report.get("subject") or report.get("project") or "")
    return route, subject


def resolve_dossier_defer(manifest_path: Path, data: dict[str, Any]) -> Path | None:
    """Return the live dossier manifest path to defer to, or None if no deference applies."""
    route, subject = report_route_and_subject(data)
    if route not in SINGULAR_ROUTES:
        return None
    slug = slugify(subject)
    if not slug:
        return None
    dossier_path = Path(DEFAULT_DOSSIER_ROOT) / slug / "report.json"
    try:
        if dossier_path.is_file() and dossier_path.resolve() != manifest_path.resolve():
            return dossier_path
    except OSError:
        return None
    return None


def run(cmd: list[str], timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", type=Path, required=True,
                         help="report manifest (report.json) to publish")
    parser.add_argument("--html", type=Path,
                         help="rendered HTML for the manifest (default: <manifest-dir>/index.html)")
    parser.add_argument("--anchor-node-id", required=True,
                         help="feature ANCHOR node_id — forwarded to publish_report.py verbatim")
    parser.add_argument("--instance-key", default=None,
                         help="D1 instance key for recurring routes; required for "
                              "phase/program/readiness, ignored for feature/dossier")
    parser.add_argument("--project", default=None, help="atlas project slug passthrough")
    parser.add_argument("--skill-dir", required=True,
                         help="resolved delivery-report skill dir (contains scripts/*.py)")
    parser.add_argument("--python", default=sys.executable, help="interpreter for the two scripts")
    parser.add_argument("--itt-bin", default=None)
    parser.add_argument("--atlas-repo", default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    manifest_path = args.manifest
    data = load_manifest(manifest_path)
    if data is None:
        return emit({"status": "local_skip", "reason": f"unreadable manifest: {manifest_path}"}, 4)

    deferred_to = resolve_dossier_defer(manifest_path, data)
    if deferred_to is not None:
        deferred_data = load_manifest(deferred_to)
        if deferred_data is not None:
            manifest_path, data = deferred_to, deferred_data

    route, subject = report_route_and_subject(data)
    if not route or not subject:
        return emit({"status": "local_skip", "reason": "manifest carries no report.route/subject"}, 4)

    html_path = args.html or (manifest_path.parent / "index.html")
    if not html_path.is_file():
        return emit({"status": "local_skip", "route": route,
                     "reason": f"rendered HTML not found at {html_path} — publish requires an "
                               f"already-rendered report, never renders one itself"}, 4)

    instance_key = args.instance_key
    if route in STATUS_ROUTES:
        if not instance_key:
            return emit({"status": "local_skip", "route": route,
                         "reason": f"no instance_key derivable for recurring route {route!r} — "
                                   f"refusing to fall back to subject or a timestamp (D1)"}, 4)
    else:
        instance_key = None  # feature/dossier: never send an instance_key even if one leaked in

    skill_dir = Path(args.skill_dir)
    export_cli = skill_dir / "scripts" / "delivery_report.py"
    publish_cli = skill_dir / "scripts" / "publish_report.py"
    if not export_cli.is_file() or not publish_cli.is_file():
        return emit({"status": "local_skip",
                     "reason": f"delivery-report scripts not found under {skill_dir}"}, 4)

    with tempfile.TemporaryDirectory(prefix="publish-report-") as tmpdir:
        envelope_path = Path(tmpdir) / "envelope.json"
        export_cmd = [args.python, str(export_cli), "export", "--manifest", str(manifest_path),
                      "--target", "atlas", "--html", str(html_path), "--out", str(envelope_path)]
        if instance_key:
            export_cmd += ["--instance-key", instance_key]
        try:
            export_result = run(export_cmd)
        except (OSError, subprocess.SubprocessError) as exc:
            return emit({"status": "export_error", "route": route,
                         "reason": f"export subprocess failed to launch: {exc}"}, 2)
        if export_result.returncode != 0:
            return emit({"status": "export_error", "route": route,
                         "reason": (export_result.stderr or export_result.stdout or "").strip()}, 2)
        if not envelope_path.is_file():
            return emit({"status": "export_error", "route": route,
                         "reason": "export reported success but wrote no envelope"}, 2)

        publish_cmd = [args.python, str(publish_cli), "--envelope", str(envelope_path),
                       "--anchor-node-id", args.anchor_node_id, "--json"]
        if args.project:
            publish_cmd += ["--project", args.project]
        if args.itt_bin:
            publish_cmd += ["--itt-bin", args.itt_bin]
        if args.atlas_repo:
            publish_cmd += ["--atlas-repo", args.atlas_repo]
        try:
            publish_result = run(publish_cmd, timeout=150)
        except (OSError, subprocess.SubprocessError) as exc:
            return emit({"status": "publish_error", "route": route,
                         "reason": f"publish subprocess failed to launch: {exc}"}, 2)

        detail = (publish_result.stdout or publish_result.stderr or "").strip()
        code = publish_result.returncode
        payload = {"route": route, "subject": subject, "instance_key": instance_key,
                   "manifest": str(manifest_path), "deferred_to_dossier": deferred_to is not None,
                   "detail": detail}
        if code == 0:
            payload["status"] = "published"
            return emit(payload, 0)
        if code == 1:
            payload["status"] = "guardrail_rejected"
            return emit(payload, 1)
        if code == 3:
            payload["status"] = "verb_unavailable"
            return emit(payload, 3)
        payload["status"] = "publish_error"
        return emit(payload, 2)


if __name__ == "__main__":
    sys.exit(main())
