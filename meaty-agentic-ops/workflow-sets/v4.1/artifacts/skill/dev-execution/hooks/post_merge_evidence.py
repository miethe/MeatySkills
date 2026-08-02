#!/usr/bin/env python3
"""post_merge_evidence.py — engine for the post-merge evidence hook (Shipped Work Ledger M3 L2).

Implements FR-8 (typed `ExternalLink`/`CompletionEvidence` rows for `pr_refs`/`commit_refs` at
merge time) and FR-9 (best-effort CCDash files-touched/tests-pass attachment). Reuses the L1
foundation exclusively — it does not reimplement normalization or HTTP transport:

- ``_evidence_refs`` (fail-closed ref normalizer, D-M3-3 — see the M3 leg contract §3).
- ``_itt_client.IttClient`` (the typed write seam: ``attach_external_link``/``attach_evidence``/
  ``record_validation``/``get_node_full``/``tree_nodes``).
- ``_slug_resolution.scan_frontmatter_scalars`` (the same top-level scalar extractor M2 uses for
  ``feature_slug``/``itt_node_id``/``intenttree_tree``).

Write plan, per ref (D-M3-2 — direct HTTP, not frontmatter/`itt sync import`):
    - one ``ExternalLink`` (system=github|git) per confident normalized ref.
    - one ``CompletionEvidence`` (kind=pull_request|git_commit, delivery_class=shipped) per ref.
    - one ``CompletionEvidence`` (kind=git_merge, delivery_class=shipped) for the landing itself,
      keyed off ``--merge-commit`` / the plan's ``merge_commit:`` field / the current ``git`` HEAD.

FR-9 / CCDash is best-effort ONLY: if a ``ccdash`` CLI is on PATH, shell
``ccdash feature report <slug> --json`` and attach whatever files-touched/tests-pass-shaped keys
it returns via ``record_validation``. Absent/erroring/unparsable CCDash output is a silent skip —
never a hard failure, never a guess at a host (no CCDash host is ever hardcoded here). There is no
write path INTO CCDash; none is attempted.

Idempotent: before ``--apply`` writes, the node's existing ``external_links``/``completion_evidence``
(via ``get_node_full``) are read and any (system, external_id) / (kind, ref_value) pair already
present is skipped and reported as ``already_present`` rather than re-written. External-link writes
are also server-side upsert (per the M3 leg contract §2.1), so this is a belt-and-braces guard, not
the only line of defense.

Dry-run by default; ``--apply`` commits. Never runs ``git commit``/``push``/``stash`` — only a
read-only ``git rev-parse HEAD`` best-effort fallback for the merge SHA.

Python 3.10+ floor (must import on the node's 3.11 and the laptop's 3.12). Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "artifact-tracking" / "scripts"
sys.path.insert(0, str(_SCRIPTS_DIR))
import _evidence_refs as er  # noqa: E402
import _itt_client as itc  # noqa: E402
import _slug_resolution as sr  # noqa: E402

_SCALAR_KEY_RE = re.compile(r"^(?P<key>[A-Za-z_][A-Za-z0-9_-]*):[ \t]*(?P<value>.*)$")


# --------------------------------------------------------------------------------------------
# Minimal, local frontmatter scalar extraction for the ONE field `_slug_resolution` doesn't
# carry (`merge_commit`) — deliberately not importing its private `_frontmatter_bounds`/
# `_strip_scalar_value` helpers across the module boundary; this mirrors their small, tested
# shape rather than reaching into another leg's internals.
# --------------------------------------------------------------------------------------------
def _frontmatter_text(full_text: str) -> str:
    if not full_text.startswith("---"):
        return ""
    first_nl = full_text.find("\n")
    if first_nl == -1 or full_text[:first_nl].strip() != "---":
        return ""
    close = full_text.find("\n---", first_nl)
    if close == -1:
        return ""
    return full_text[first_nl + 1 : close]


def _dequote(value: str) -> str:
    working = value
    in_quote: str | None = None
    for i, ch in enumerate(working):
        if in_quote is not None:
            if ch == in_quote:
                in_quote = None
            continue
        if ch in ("'", '"'):
            in_quote = ch
            continue
        if ch == "#" and i > 0 and working[i - 1] in " \t":
            working = working[:i]
            break
    working = working.strip()
    if len(working) >= 2 and working[0] == working[-1] and working[0] in ("'", '"'):
        working = working[1:-1]
    return working.strip()


def scalar_from_frontmatter(fm_text: str, key: str) -> str | None:
    for line in fm_text.splitlines():
        if not line or line[0] in (" ", "\t", "-", "#"):
            continue
        m = _SCALAR_KEY_RE.match(line)
        if not m or m.group("key") != key:
            continue
        val = _dequote(m.group("value"))
        return val or None
    return None


def git_head(repo_root: str) -> str | None:
    """Best-effort ``git rev-parse HEAD`` — read-only, never raises."""
    try:
        proc = subprocess.run(
            ["git", "-C", repo_root, "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=10,
        )
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    sha = proc.stdout.strip()
    return sha or None


def resolve_node_id_by_slug(client: itc.IttClient, tree_id: str, feature_slug: str) -> str | None:
    """Scan the tree's nodes for one carrying ``meta.feature_slug == feature_slug``. Read-only."""
    for node in client.tree_nodes(tree_id):
        meta = node.get("meta") or {}
        if meta.get("feature_slug") == feature_slug:
            return node.get("id")
    return None


def build_actions(refs: list[er.EvidenceRef], merge_sha: str | None) -> list[dict]:
    """Turn confident refs (+ the merge landing itself) into a flat write plan."""
    actions: list[dict] = []
    for ref in refs:
        label = f"{ref.kind}" + (f":{ref.repo}" if ref.repo else "")
        actions.append({
            "type": "external_link",
            "system": ref.system,
            "external_id": ref.ident,
            "external_path": ref.url,
            "context_label": label,
        })
        ev_kind = "pull_request" if ref.kind == "pull_request" else "git_commit"
        actions.append({
            "type": "evidence",
            "kind": ev_kind,
            "label": ref.raw,
            "ref_value": ref.url or ref.ident,
            "delivery_class": "shipped",
        })
    if merge_sha:
        actions.append({
            "type": "evidence",
            "kind": "git_merge",
            "label": "merge",
            "ref_value": merge_sha,
            "delivery_class": "shipped",
        })
    return actions


def existing_keys(node_full: dict) -> tuple[set[tuple], set[tuple]]:
    ext: set[tuple] = set()
    for entry in node_full.get("external_links") or []:
        if isinstance(entry, dict):
            ext.add((entry.get("system"), entry.get("external_id")))
    evid: set[tuple] = set()
    for entry in node_full.get("completion_evidence") or []:
        if isinstance(entry, dict):
            evid.add((entry.get("kind"), entry.get("ref_value")))
    return ext, evid


def classify_actions(
    actions: list[dict], existing_ext: set[tuple], existing_evid: set[tuple]
) -> tuple[list[dict], list[dict]]:
    would_write: list[dict] = []
    already_present: list[dict] = []
    for action in actions:
        if action["type"] == "external_link":
            key = (action["system"], action["external_id"])
            bucket = already_present if key in existing_ext else would_write
        else:
            key = (action["kind"], action.get("ref_value"))
            bucket = already_present if key in existing_evid else would_write
        bucket.append(action)
    return would_write, already_present


def ccdash_report(feature_slug: str) -> dict | None:
    """FR-9, best-effort ONLY. Never hardcodes a host — shells whatever `ccdash` is on PATH."""
    ccdash_bin = shutil.which("ccdash")
    if not ccdash_bin:
        return None
    try:
        proc = subprocess.run(
            [ccdash_bin, "feature", "report", feature_slug, "--json"],
            capture_output=True, text=True, timeout=30,
        )
    except Exception:
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


_CCDASH_COUNT_KEYS = ("files_touched", "files_changed", "tests_pass", "tests_passed", "tests_total")


def extract_ccdash_counts(data: dict | None) -> dict:
    if not isinstance(data, dict):
        return {}
    counts: dict = {}
    for key in _CCDASH_COUNT_KEYS:
        if key in data:
            counts[key] = data[key]
    summary = data.get("summary")
    if isinstance(summary, dict):
        for key in _CCDASH_COUNT_KEYS:
            if key in summary and key not in counts:
                counts[key] = summary[key]
    return counts


def gather(plan_path: Path) -> dict:
    """Read-only: parse the plan file's frontmatter fields this hook needs. Never raises on
    malformed frontmatter — mirrors `_evidence_refs.parse_frontmatter_list`'s best-effort shape."""
    text = plan_path.read_text(encoding="utf-8")
    fm_text = _frontmatter_text(text)
    scalars = sr.scan_frontmatter_scalars(plan_path)
    return {
        "feature_slug": scalars.get("feature_slug"),
        "itt_node_id": scalars.get("itt_node_id"),
        "intenttree_tree": scalars.get("intenttree_tree"),
        "merge_commit": scalar_from_frontmatter(fm_text, "merge_commit"),
        "commit_refs": er.parse_frontmatter_list(text, "commit_refs"),
        "pr_refs": er.parse_frontmatter_list(text, "pr_refs"),
    }


def main(argv: list[str] | None = None, client: itc.IttClient | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Post-merge evidence hook engine — Shipped Work Ledger M3 L2 (FR-8, FR-9). "
                    "Dry-run by default; --apply to commit."
    )
    ap.add_argument("--plan-file", required=True, help="plan file to read commit_refs/pr_refs/merge_commit/feature_slug from")
    ap.add_argument("--node-id", default=None, help="explicit bound node id (else resolved via --tree + feature_slug)")
    ap.add_argument("--tree", default=None, help="tree id, used only to resolve --node-id when it is not given")
    ap.add_argument("--merge-commit", default=None, help="merge SHA/ref for the git_merge evidence row")
    ap.add_argument("--repo-root", default=".", help="repo root for the git-HEAD fallback")
    ap.add_argument("--default-repo", default=None, help="repo name for bare refs (e.g. bare PR integers)")
    ap.add_argument("--apply", action="store_true", help="write evidence (default: dry-run)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args(argv)

    plan_path = Path(args.plan_file)
    if not plan_path.exists():
        sys.stderr.write(f"error: plan file not found: {plan_path}\n")
        return 1

    plan = gather(plan_path)

    node_id = args.node_id or plan["itt_node_id"]
    tree_id = args.tree or plan["intenttree_tree"]

    client = client or itc.IttClient()

    if not node_id:
        feature_slug = plan["feature_slug"]
        if not tree_id or not feature_slug:
            sys.stderr.write(
                "error: no node id given/resolvable — need --node-id, or a plan itt_node_id, or "
                "(--tree + a plan feature_slug) to resolve one\n"
            )
            return 1
        try:
            node_id = resolve_node_id_by_slug(client, tree_id, feature_slug)
        except itc.IttError as exc:
            sys.stderr.write(f"error: {exc}\n")
            return 1
        if not node_id:
            sys.stderr.write(f"error: no node in tree {tree_id} carries feature_slug={feature_slug!r}\n")
            return 1

    merge_sha = args.merge_commit or plan["merge_commit"] or git_head(args.repo_root)

    refs, skipped = er.normalize_refs(plan["commit_refs"], plan["pr_refs"], default_repo=args.default_repo)
    actions = build_actions(refs, merge_sha)

    node_full: dict | None = None
    read_warning: str | None = None
    try:
        node_full = client.get_node_full(node_id)
    except itc.IttError as exc:
        read_warning = str(exc)

    if node_full:
        existing_ext, existing_evid = existing_keys(node_full)
    else:
        existing_ext, existing_evid = set(), set()

    would_write, already_present = classify_actions(actions, existing_ext, existing_evid)

    ccdash_counts: dict = {}
    if plan["feature_slug"]:
        ccdash_counts = extract_ccdash_counts(ccdash_report(plan["feature_slug"]))

    applied: list[dict] = []
    errors: list[dict] = []
    if args.apply:
        for action in would_write:
            try:
                if action["type"] == "external_link":
                    client.attach_external_link(
                        node_id,
                        system=action["system"],
                        external_id=action["external_id"],
                        external_path=action.get("external_path"),
                        context_label=action.get("context_label"),
                    )
                else:
                    client.attach_evidence(
                        node_id,
                        kind=action["kind"],
                        label=action.get("label"),
                        ref_value=action.get("ref_value"),
                        delivery_class=action.get("delivery_class"),
                    )
                applied.append(action)
            except itc.IttError as exc:
                errors.append({"action": action, "error": str(exc)})

        if ccdash_counts:
            validation_action = {
                "type": "validation",
                "command": f"ccdash feature report {plan['feature_slug']}",
                "environment": ccdash_counts,
            }
            try:
                client.record_validation(
                    node_id,
                    command=validation_action["command"],
                    status="reported",
                    kind="ccdash",
                    environment=ccdash_counts,
                )
                applied.append(validation_action)
            except itc.IttError as exc:
                errors.append({"action": validation_action, "error": str(exc)})

    summary = {
        "mode": "apply" if args.apply else "dry-run",
        "node_id": node_id,
        "feature_slug": plan["feature_slug"],
        "merge_sha": merge_sha,
        "would_write": len(would_write),
        "already_present": len(already_present),
        "skipped_refs": len(skipped),
        "applied": len(applied),
        "errors": len(errors),
        "ccdash_counts": ccdash_counts,
        "node_read_warning": read_warning,
    }

    if args.json:
        print(json.dumps({
            "summary": summary,
            "would_write": would_write,
            "already_present": already_present,
            "skipped_refs": [{"raw": s.raw, "reason": s.reason} for s in skipped],
            "errors": errors,
        }, indent=2))
    else:
        verb = "APPLY" if args.apply else "DRY-RUN"
        print(f"[post-merge-evidence] {verb} node={node_id} plan={plan_path}")
        for action in would_write:
            tag = "WROTE" if action in applied else "would-write"
            print(f"  [{tag}] {action.get('type')} kind/system={action.get('kind') or action.get('system')} "
                  f"ref={action.get('ref_value') or action.get('external_id')}")
        for action in already_present:
            print(f"  [already_present] {action.get('type')} ref={action.get('ref_value') or action.get('external_id')}")
        for s in skipped:
            print(f"  [skipped] {s.raw!r} — {s.reason}")
        if ccdash_counts:
            tag = "attached" if (args.apply and not errors) else "would-attach"
            print(f"  [{tag}] ccdash validation counts={ccdash_counts}")
        for e in errors:
            print(f"  ERROR: {e['action'].get('type')} — {e['error']}")
        if read_warning:
            print(f"  warning: could not read existing node state for idempotency check: {read_warning}")
        print("\n  summary:")
        for k, v in summary.items():
            print(f"    {k}={v}")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
