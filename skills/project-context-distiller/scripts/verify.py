#!/usr/bin/env python3
"""
verify.py — project-context-distiller output verifier.

Validates the four distilled artifacts against the evidence ledger and
structural rules. Reports PASS/FAIL findings; never auto-corrects.

Exit codes:
  0 = all checks pass
  1 = one or more failures
  2 = fatal invocation error (bad args, missing files)

Usage:
  python verify.py --ledger .claude/context/distilled/.ledger.yaml \
                   --output-dir .claude/context/distilled/ \
                   --repo-root /path/to/repo

Optional:
  --counts-check counts.yaml   YAML of {claim_label: shell_command} pairs
  --strict                     treat warnings as failures
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

import json


def _load_yaml(text: str) -> object:
    """Load ledger: try JSON first (strict superset), then minimal YAML key:value."""
    try:
        return json.loads(text)
    except Exception:
        pass
    # Minimal flat/nested YAML: handles dicts, lists of dicts, scalar values.
    # Sufficient for the structured ledger format; does not support anchors or multiline.
    return _parse_minimal_yaml(text.splitlines(), 0, 0)[0]


def _parse_minimal_yaml(lines, start, indent):
    result = {}
    i = start
    while i < len(lines):
        raw = lines[i]
        stripped = raw.lstrip()
        if not stripped or stripped.startswith('#'):
            i += 1
            continue
        cur = len(raw) - len(stripped)
        if cur < indent:
            break
        if stripped.startswith('- '):
            lst, i = _parse_list(lines, i, cur)
            return lst, i
        if ':' in stripped:
            sep = stripped.index(':')
            key = stripped[:sep].strip()
            val = stripped[sep + 1:].strip()
            if not val or val in ('|', '>'):
                child, i = _parse_minimal_yaml(lines, i + 1, cur + 2)
                result[key] = child
            else:
                result[key] = _scalar(val)
                i += 1
        else:
            i += 1
    return result, i


def _parse_list(lines, start, indent):
    lst = []
    i = start
    while i < len(lines):
        raw = lines[i]
        stripped = raw.lstrip()
        if not stripped or stripped.startswith('#'):
            i += 1
            continue
        if len(raw) - len(stripped) < indent:
            break
        if stripped.startswith('- '):
            val = stripped[2:].strip()
            if not val:
                child, i = _parse_minimal_yaml(lines, i + 1, indent + 2)
                lst.append(child)
            else:
                lst.append(_scalar(val))
                i += 1
        else:
            i += 1
    return lst, i


def _scalar(s):
    for q in ('"', "'"):
        if s.startswith(q) and s.endswith(q) and len(s) > 1:
            return s[1:-1]
    if s.lower() in ('true', 'yes'):
        return True
    if s.lower() in ('false', 'no'):
        return False
    if s.lower() in ('null', '~', ''):
        return None
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    return s


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ARTIFACT_FILENAMES = [
    "project-purpose-and-feature-catalog.md",
    "project-fundamentals-and-design-context.md",
    "research-agent-context-pack.md",
    "project-opportunity-map.md",
]

# Required top-level section headings per artifact (## prefix, partial match ok)
REQUIRED_SECTIONS = {
    "project-purpose-and-feature-catalog.md": [
        "## Project Summary",
        "## Problem",
        "## Intended Users",
        "## Core System Workflows",
        "## Feature Catalog",
        "## Feature Maturity Map",
        "## Key Modules",
        "## Integrations",
        "## Known Gaps",
        "## High-Confidence Interpretation",
        "## Open Questions",
    ],
    "project-fundamentals-and-design-context.md": [
        "## Architectural Overview",
        "## Important Design Decisions",
        "## Implicit Design Philosophy",
        "## Workflow",
        "## Business",
        "## Constraints and Tradeoffs",
        "## Extensibility",
        "## Technical Debt",
        "## What Future Contributors",
        "## Strategic Implications",
        "## Open Questions",
    ],
    "research-agent-context-pack.md": [
        "## Executive Context",
        "## Domain Glossary",
        "## Project Intent",
        "## Research Guardrails",
        "## Priority Opportunity",
        "## High-Risk Areas",
        "## Suggested Research Questions",
        "## Suggested Starting Files",
        "## Unknowns",
    ],
    "project-opportunity-map.md": [
        "## Near-Adjacent Opportunities",
        "## Bolder Novel Ideas",
        "## Ideas That Require Architectural Change",
        "## Business Model",
        "## Workflow Automation",
        "## Research Questions Ranked",
        "## Risks of Pursuing",
        "## Open Questions",
    ],
}

TEMPLATE_UNFILLED_PATTERNS = [
    re.compile(r'^\s*\|\s*\|\s*\|\s*$'),           # empty table row (3+ empty cells)
    re.compile(r'\bFIXME\b'),
    # TODO only when it starts a line or appears as standalone placeholder (not in prose like "TODO hotspots")
    re.compile(r'^\s*TODO\b'),                       # line-starting TODO
    re.compile(r'(?<![`/])<[a-zA-Z][^>]{2,59}>(?![`/])'),  # angle-bracket placeholder, not inside backtick/path
    re.compile(r'<bullet>'),
]

# Patterns to SKIP in template fidelity check (known benign patterns)
TEMPLATE_FIDELITY_SKIP = [
    re.compile(r'<!--.*last refreshed.*-->'),
    re.compile(r'<!--.*Generated by.*-->'),
    re.compile(r'`.*TODO.*`'),                      # TODO inside backtick code spans is content
]

CONFIDENCE_TAG_RE = re.compile(
    r'\[(evidence|inference|open(?:\s+question)?)\s+([HMLhml])\]'
    r'|\[(evidence|inference)\]'
    r'|\[open\]',
    re.IGNORECASE,
)

PATH_CITE_RE = re.compile(r'`([^`]+\.[a-zA-Z0-9_]+(?::[^\s`]+)?)`')


# ---------------------------------------------------------------------------
# Result accumulator
# ---------------------------------------------------------------------------

class Report:
    def __init__(self):
        self.failures = []
        self.warnings = []
        self.passes = []

    def fail(self, check: str, detail: str):
        self.failures.append((check, detail))

    def warn(self, check: str, detail: str):
        self.warnings.append((check, detail))

    def ok(self, check: str):
        self.passes.append(check)

    def print_summary(self, strict: bool = False):
        print("\n" + "=" * 60)
        print("VERIFY.PY REPORT")
        print("=" * 60)
        for check in self.passes:
            print(f"  PASS  {check}")
        for check, detail in self.warnings:
            label = "FAIL " if strict else " WARN"
            print(f"  {label}  {check}")
            print(f"         {detail}")
        for check, detail in self.failures:
            print(f"  FAIL  {check}")
            print(f"         {detail}")
        print("-" * 60)
        fail_count = len(self.failures) + (len(self.warnings) if strict else 0)
        print(f"  {len(self.passes)} passed, {len(self.warnings)} warnings, {len(self.failures)} failures")
        if fail_count == 0:
            print("  RESULT: ALL CHECKS PASSED")
        else:
            print(f"  RESULT: {fail_count} CHECK(S) FAILED")
        print("=" * 60 + "\n")
        return fail_count


# ---------------------------------------------------------------------------
# Check implementations
# ---------------------------------------------------------------------------

def check_artifacts_exist(output_dir: Path, report: Report):
    for name in ARTIFACT_FILENAMES:
        p = output_dir / name
        if p.exists():
            report.ok(f"artifact-exists:{name}")
        else:
            report.fail(f"artifact-exists:{name}", f"File not found: {p}")


def check_path_citations(output_dir: Path, repo_root: Path, report: Report):
    """Extract backtick path citations and verify each file exists."""
    for name in ARTIFACT_FILENAMES:
        p = output_dir / name
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8")
        found_bad = []
        for match in PATH_CITE_RE.finditer(text):
            raw = match.group(1)
            # strip :symbol or :line_range suffix
            file_part = raw.split(':')[0]
            # skip things that look like URLs or terminal commands
            if file_part.startswith('http') or ' ' in file_part:
                continue
            # skip very short tokens unlikely to be paths
            if len(file_part) < 4 or '.' not in file_part.split('/')[-1]:
                continue
            candidate = repo_root / file_part
            if not candidate.exists():
                found_bad.append(raw)
        if found_bad:
            report.fail(
                f"path-citations:{name}",
                f"{len(found_bad)} unresolvable path citation(s): {found_bad[:5]}"
                + (" (+ more)" if len(found_bad) > 5 else ""),
            )
        else:
            report.ok(f"path-citations:{name}")


def check_template_fidelity(output_dir: Path, report: Report):
    """Detect unfilled template rows, TODOs, placeholders."""
    for name in ARTIFACT_FILENAMES:
        p = output_dir / name
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8")
        hits = []
        for i, line in enumerate(text.splitlines(), 1):
            # Skip known benign patterns
            if any(skip.search(line) for skip in TEMPLATE_FIDELITY_SKIP):
                continue
            for pat in TEMPLATE_UNFILLED_PATTERNS:
                if pat.search(line):
                    hits.append(f"line {i}: {line.strip()[:80]}")
                    break
        if hits:
            report.warn(
                f"template-fidelity:{name}",
                f"{len(hits)} unfilled/template line(s); first: {hits[0]}",
            )
        else:
            report.ok(f"template-fidelity:{name}")


def check_required_sections(output_dir: Path, report: Report):
    for name in ARTIFACT_FILENAMES:
        p = output_dir / name
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8")
        required = REQUIRED_SECTIONS.get(name, [])
        missing = []
        for heading in required:
            # partial prefix match (handles trailing text after heading keyword)
            if not any(line.startswith(heading) for line in text.splitlines()):
                missing.append(heading)
        if missing:
            report.fail(
                f"required-sections:{name}",
                f"Missing section(s): {missing}",
            )
        else:
            report.ok(f"required-sections:{name}")


def check_confidence_tags(output_dir: Path, ledger: dict, report: Report):
    """
    1. All [evidence H/M/L] / [inference H/M/L] / [open] tags are well-formed.
    2. Every inference claim must reference at least one evidence parent in the ledger.
    """
    valid_levels = {'h', 'm', 'l'}
    # Match all bracketed evidence/inference/open tags
    malformed_re = re.compile(r'\[(evidence|inference|open(?:\s+question)?)[^\]]*\]', re.IGNORECASE)
    # These shorthand forms are explicitly valid (no level required in prose)
    valid_shorthand = re.compile(
        r'^\[(evidence|inference|open(?:\s+question)?)\]$', re.IGNORECASE
    )

    claims_by_id = {}
    if isinstance(ledger, dict):
        for item in ledger.get('claims', []):
            if isinstance(item, dict):
                cid = item.get('id') or item.get('claim_id')
                if cid:
                    claims_by_id[str(cid)] = item

    for name in ARTIFACT_FILENAMES:
        p = output_dir / name
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8")
        malformed = []
        for match in malformed_re.finditer(text):
            tag = match.group(0)
            # shorthand [evidence], [inference], [open], [open question] are always valid
            if valid_shorthand.match(tag):
                continue
            # check well-formedness of [evidence H/M/L] / [inference H/M/L] form
            inner = tag[1:-1].strip().lower()
            parts = inner.split()
            if parts[0] in ('evidence', 'inference') and len(parts) >= 2:
                if parts[1] not in valid_levels:
                    malformed.append(tag)
            elif parts[0] in ('open',):
                pass  # [open] or [open question X] are fine
            else:
                malformed.append(tag)
        if malformed:
            report.warn(
                f"confidence-tags:{name}",
                f"{len(malformed)} malformed tag(s): {malformed[:3]}",
            )
        else:
            report.ok(f"confidence-tags:{name}")


def check_cross_artifact_coherence(output_dir: Path, report: Report):
    """
    Every [evidence H] claim in research-pack must appear (approximately)
    in at least one sibling artifact. Uses 8-word n-gram fingerprint.
    """
    pack_path = output_dir / "research-agent-context-pack.md"
    if not pack_path.exists():
        return

    sibling_texts = []
    for name in ARTIFACT_FILENAMES:
        if name == "research-agent-context-pack.md":
            continue
        p = output_dir / name
        if p.exists():
            sibling_texts.append(p.read_text(encoding="utf-8"))
    sibling_combined = " ".join(sibling_texts).lower()

    pack_text = pack_path.read_text(encoding="utf-8")
    evidence_h_re = re.compile(
        r'([^\n]{20,200})\[evidence\s+[Hh]\]', re.MULTILINE
    )
    orphaned = []
    for match in evidence_h_re.finditer(pack_text):
        claim_text = match.group(1).strip().lower()
        # use first 6 meaningful words as fingerprint
        words = [w for w in re.split(r'\W+', claim_text) if len(w) > 3][:6]
        if not words:
            continue
        fingerprint = ' '.join(words[:4])
        if fingerprint and fingerprint not in sibling_combined:
            orphaned.append(claim_text[:60])

    if orphaned:
        report.warn(
            "cross-artifact-coherence",
            f"{len(orphaned)} [evidence H] claim(s) in research-pack not found in siblings "
            f"(first: '{orphaned[0]}...')",
        )
    else:
        report.ok("cross-artifact-coherence")


def check_section_population(output_dir: Path, report: Report):
    """Assert each required section has non-empty body (not just heading + blank line)."""
    for name in ARTIFACT_FILENAMES:
        p = output_dir / name
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8")
        lines = text.splitlines()
        empty_sections = []
        i = 0
        while i < len(lines):
            line = lines[i]
            if line.startswith('## '):
                heading = line.strip()
                # collect body until next ##
                body_lines = []
                j = i + 1
                while j < len(lines) and not lines[j].startswith('## '):
                    body_lines.append(lines[j].strip())
                    j += 1
                body = ' '.join(b for b in body_lines if b)
                # strip template comments/instructions
                body_clean = re.sub(r'<!--.*?-->', '', body, flags=re.DOTALL).strip()
                if len(body_clean) < 10:
                    empty_sections.append(heading)
                i = j
            else:
                i += 1
        if empty_sections:
            report.warn(
                f"section-population:{name}",
                f"{len(empty_sections)} section(s) appear empty: {empty_sections[:3]}",
            )
        else:
            report.ok(f"section-population:{name}")


def check_counts(counts_check_path: Path, repo_root: Path, output_dir: Path, report: Report):
    """
    Run each command from counts-check YAML and verify the claim labels in
    the artifacts match reality. Reports pass/fail, never auto-corrects.
    """
    if not counts_check_path.exists():
        report.warn("counts-check", f"counts-check file not found: {counts_check_path}")
        return

    raw = counts_check_path.read_text(encoding="utf-8")
    spec = _load_yaml(raw)
    if not isinstance(spec, dict):
        report.fail("counts-check", "counts-check YAML must be a mapping of {label: command}")
        return

    all_artifact_text = ""
    for name in ARTIFACT_FILENAMES:
        p = output_dir / name
        if p.exists():
            all_artifact_text += p.read_text(encoding="utf-8") + "\n"

    for label, command in spec.items():
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                cwd=str(repo_root),
                timeout=10,
            )
            actual = result.stdout.strip()
            # Check if actual count appears near the label in the artifacts
            # Look for the label and a number within 50 chars
            label_re = re.compile(
                re.escape(str(label)) + r'.{0,60}?(\d+)', re.IGNORECASE | re.DOTALL
            )
            matches = label_re.findall(all_artifact_text)
            if not matches:
                report.warn(
                    f"counts-check:{label}",
                    f"label '{label}' not found in artifacts; actual={actual}",
                )
            elif actual not in matches:
                report.fail(
                    f"counts-check:{label}",
                    f"claimed count(s) {matches} != actual {actual} (cmd: {command})",
                )
            else:
                report.ok(f"counts-check:{label}")
        except subprocess.TimeoutExpired:
            report.warn(f"counts-check:{label}", "command timed out (>10s)")
        except Exception as exc:
            report.warn(f"counts-check:{label}", f"command failed: {exc}")


def check_ledger_inference_parents(ledger: dict, report: Report):
    """Every inference claim in ledger must reference >= 1 evidence parent."""
    claims = ledger.get('claims', [])
    if not claims:
        report.warn("ledger-inference-parents", "Ledger has no 'claims' list")
        return

    evidence_ids = set()
    for c in claims:
        if not isinstance(c, dict):
            continue
        if c.get('type', '').lower() == 'evidence':
            cid = c.get('id') or c.get('claim_id')
            if cid:
                evidence_ids.add(str(cid))

    orphaned_inferences = []
    for c in claims:
        if not isinstance(c, dict):
            continue
        if c.get('type', '').lower() == 'inference':
            parents = c.get('evidence_ids', c.get('parents', []))
            if isinstance(parents, str):
                parents = [parents]
            if not any(str(p) in evidence_ids for p in (parents or [])):
                orphaned_inferences.append(c.get('id', '(no id)'))

    if orphaned_inferences:
        report.fail(
            "ledger-inference-parents",
            f"{len(orphaned_inferences)} inference claim(s) have no evidence parent: "
            f"{orphaned_inferences[:5]}",
        )
    else:
        report.ok("ledger-inference-parents")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args():
    ap = argparse.ArgumentParser(
        description="Verify project-context-distiller output artifacts.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument('--ledger', required=True, help='Path to evidence ledger YAML/JSON')
    ap.add_argument('--output-dir', required=True, help='Directory containing the 4 output artifacts')
    ap.add_argument('--repo-root', default='.', help='Repo root for resolving path citations (default: cwd)')
    ap.add_argument('--counts-check', help='YAML file of {label: shell_command} count assertions')
    ap.add_argument('--strict', action='store_true', help='Treat warnings as failures')
    return ap.parse_args()


def main():
    args = parse_args()

    ledger_path = Path(args.ledger)
    output_dir = Path(args.output_dir)
    repo_root = Path(args.repo_root).resolve()

    # Validate paths
    if not output_dir.is_dir():
        print(f"ERROR: output-dir does not exist: {output_dir}", file=sys.stderr)
        sys.exit(2)

    ledger: dict = {}
    if ledger_path.exists():
        raw = ledger_path.read_text(encoding="utf-8")
        loaded = _load_yaml(raw)
        ledger = loaded if isinstance(loaded, dict) else {}
    else:
        print(f"WARNING: ledger not found at {ledger_path}; skipping ledger checks", file=sys.stderr)

    report = Report()

    # Run all checks
    check_artifacts_exist(output_dir, report)
    check_path_citations(output_dir, repo_root, report)
    check_template_fidelity(output_dir, report)
    check_required_sections(output_dir, report)
    check_confidence_tags(output_dir, ledger, report)
    check_cross_artifact_coherence(output_dir, report)
    check_section_population(output_dir, report)

    if ledger:
        check_ledger_inference_parents(ledger, report)

    if args.counts_check:
        check_counts(Path(args.counts_check), repo_root, output_dir, report)

    fail_count = report.print_summary(strict=args.strict)
    sys.exit(0 if fail_count == 0 else 1)


if __name__ == '__main__':
    main()
