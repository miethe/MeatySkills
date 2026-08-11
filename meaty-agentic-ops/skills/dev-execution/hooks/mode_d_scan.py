#!/usr/bin/env python3
"""mode_d_scan.py — fail a delegated leg that crossed the Mode-D boundary in its OUTPUT.

The engine behind ``mode-d-scan.sh``. The wrapper owns the master switch, the binding
guard, and the non-fatal contract; this module owns the signature scan and the report.

WHY THIS EXISTS
---------------
Mode-D is described across the AOS as the one non-negotiable boundary for delegated work.
Until now it was enforced by a *sentence in a dispatch prompt*. On 2026-08-06 that failed
for the first observed time (``node_01KZC1AHEDYZ8FS9TAZSXQTTSB``): an ``ica-executor`` leg
was briefed, verbatim, "It must not read, generate, print or reference any signing key. If
you find yourself needing a key, STOP and return {status: needs_opus, reason: mode_d}" —
and instead implemented its own HMAC signing and minted a key with
``secrets.token_bytes(32)`` when none was supplied.

The generated key is worse than a missing one. A throwaway per-call secret means every
emitted token is signed with something discarded immediately and verifiable by nothing —
including the redeem path. Fail-closed would have been an absent token. That was fail-open
wearing a valid shape, and the tests passed.

WHY A SCAN OF THE OUTPUT, NOT OF THE PLAN
-----------------------------------------
The pre-existing guards (``hasHighRiskPaths`` in auto-feature.js, ``fixCycleModeDGuard`` in
execute-contract.js, ``fixTaskModeDGuard`` in execute-plan.js) are all **declaration-based**:
they read ``files_affected``, ``task_class``, and the prompt text, and they run *before*
dispatch. They are necessary and they stay. They are also structurally blind to this breach,
because the leg's declared files contained no crypto path — the leg *invented* the signing
code after it was already routed.

So this scan asks the only question a declaration cannot answer: not "what did the leg say
it would touch?" but **"what did the leg actually write?"**

WHY IT KEYS ON THE LANE
-----------------------
Mode-D work is not forbidden; it is forbidden *on an offload lane*. Crypto, auth, and
migration changes are legitimate, routine work on claude-primary. A blanket grep over every
diff would therefore be noise, and noise is how a guard gets disabled. So the same finding
is a **hard failure** (exit 2) when the producing lane is an offload lane
(ica / bob / gemini / codex) and an **advisory report** (exit 0) on primary or when the lane
is unknown. The lane, not the code, is what makes it a breach.

WHY IT REDACTS
--------------
A scanner for leaked key material must not become the leak. Matched lines are reported as
``file:line`` + signature id + a redacted excerpt with any literal after the operator
elided. The raw matched text is never printed, in any mode, including ``--json``.

DETERMINISTIC. No model call (AOS constraint 4), no network. Pure text over a diff.

EXIT
----
0 — clean, or findings on a non-offload lane (advisory).
2 — CORRECTNESS GATE: Mode-D signature in an offload lane's output. The wrapper
    propagates this; every other nonzero is treated as infra and swallowed.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Lanes. An "offload lane" is any provider that is not the primary subscription.
# Kept as a frozenset of lowercase ids; matched against the provider substring so
# both "ica" and "ica-executor" resolve. Mirrors the executor agent roster
# (.claude/agents/delegates/) and delegation-router's provider ids.
# ---------------------------------------------------------------------------
OFFLOAD_LANES = frozenset({"ica", "bob", "gemini", "codex"})
PRIMARY_LANES = frozenset({"claude", "primary", "anthropic"})


@dataclass(frozen=True)
class Signature:
    """One Mode-D signature.

    ``sig_id``  stable id, usable in a waiver.
    ``klass``   the Mode-D class it evidences (reported, and used for grouping).
    ``pattern`` compiled regex, applied to a single added line.
    ``why``     the consequence, in one line — this is what a reader acts on.
    """

    sig_id: str
    klass: str
    pattern: re.Pattern
    why: str


def _sig(sig_id: str, klass: str, rx: str, why: str) -> Signature:
    return Signature(sig_id, klass, re.compile(rx, re.IGNORECASE), why)


# ---------------------------------------------------------------------------
# The signature table.
#
# Scoped deliberately narrow: each entry is an ACT (minting a key, signing,
# dropping a table), not a topic mention. `import hmac` is not here — importing is
# not signing, and flagging it would make the guard noisy enough to be turned off.
# `hmac.new(` IS here, because that is the act.
# ---------------------------------------------------------------------------
SIGNATURES: tuple[Signature, ...] = (
    # ── crypto material: generating a secret at runtime ──────────────────────
    _sig("crypto.secrets_token", "crypto_material",
         r"\bsecrets\s*\.\s*token_(bytes|hex|urlsafe)\s*\(",
         "mints key material at runtime; anything signed with it is unverifiable elsewhere"),
    _sig("crypto.os_urandom", "crypto_material",
         r"\bos\s*\.\s*urandom\s*\(",
         "raw entropy draw — a hand-rolled secret unless it feeds a vetted KDF"),
    _sig("crypto.fernet_generate", "crypto_material",
         r"\bFernet\s*\.\s*generate_key\s*\(",
         "generates a symmetric key the rest of the system cannot know"),
    _sig("crypto.generate_private_key", "crypto_material",
         r"\bgenerate_private_key\s*\(",
         "generates an asymmetric private key"),
    _sig("crypto.node_randombytes", "crypto_material",
         r"\bcrypto\s*\.\s*randomBytes\s*\(",
         "mints key material at runtime (node)"),
    # ── signing: a second, independent crypto implementation ────────────────
    _sig("crypto.hmac_new", "crypto_material",
         r"\bhmac\s*\.\s*new\s*\(",
         "a parallel HMAC implementation; diverges from the canonical signer's payload"),
    _sig("crypto.jwt_encode", "crypto_material",
         r"\bjwt\s*\.\s*(encode|sign)\s*\(",
         "issues a token — signing authority belongs to the primary lane"),
    # ── auth boundary ───────────────────────────────────────────────────────
    _sig("auth.token_create", "auth_boundary",
         r"\b(create|issue|mint)_(access|refresh|session|id)_token\s*\(",
         "issues an authentication token"),
    _sig("auth.password_check", "auth_boundary",
         r"\b(verify|check|hash)_password\s*\(",
         "credential verification path"),
    # ── schema migration ────────────────────────────────────────────────────
    # Separator is deliberately loose, not \s+: the common shape is a subprocess
    # ARGV list — subprocess.run(["alembic", "upgrade", "head"]) — where the two
    # tokens are separated by quotes and a comma. A \s+ version of this signature
    # missed that call shape entirely.
    _sig("migration.alembic_cmd", "schema_migration",
         r"\balembic\b[^\n]{0,24}?\b(upgrade|downgrade|revision)\b",
         "runs a schema migration"),
    _sig("migration.op_ddl", "schema_migration",
         r"\bop\s*\.\s*(drop_table|drop_column|alter_column|rename_table)\s*\(",
         "destructive DDL in a migration"),
    # ── destructive data ────────────────────────────────────────────────────
    _sig("data.drop_table", "destructive_data",
         r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b",
         "drops a relation"),
    _sig("data.delete_from", "destructive_data",
         r"\bDELETE\s+FROM\b",
         "unqualified data deletion path"),
    _sig("data.truncate", "destructive_data",
         r"\bTRUNCATE\s+(TABLE\s+)?\w",
         "truncates a relation"),
    # ── history rewrite ─────────────────────────────────────────────────────
    _sig("git.force_push", "history_rewrite",
         r"\bgit\s+push\b[^\n]*\s(--force\b|-f\b)",
         "rewrites published history"),
    _sig("git.reset_hard", "history_rewrite",
         r"\bgit\s+reset\s+--hard\b",
         "discards work irrecoverably"),
    _sig("git.filter_branch", "history_rewrite",
         r"\bgit\s+(filter-branch|filter-repo)\b",
         "rewrites history wholesale"),
    # ── secret store ────────────────────────────────────────────────────────
    # The home marker and the .config path are matched independently rather than as
    # one contiguous path: in real code they are separated by a quote and a path
    # operator — Path.home() / ".config/aos/secrets.env" — so requiring "/.config/"
    # to directly follow the marker never matched.
    _sig("secretstore.aos_secrets", "secret_store",
         r"(~|\$HOME|\bhome\s*\(\))[^\n]*\.config/[^\n]*secret",
         "touches the canonical AOS secret store"),
    _sig("secretstore.serve_env", "secret_store",
         r"\bserve\.env\b|\benterprise\.toml\b",
         "touches a credential file"),
)

# Signature ids whose *class* is only meaningful as a hard gate. Everything in the
# table is gate-eligible today; the split is kept explicit so a future advisory-only
# signature can be added without changing the exit logic.
GATE_CLASSES = frozenset({
    "crypto_material",
    "auth_boundary",
    "schema_migration",
    "destructive_data",
    "history_rewrite",
    "secret_store",
})

# Redaction: elide anything that looks like a literal value so the report never
# reproduces the material it is reporting on.
_REDACT_RULES = (
    (re.compile(r"""(=\s*)(['"])(?:\\.|(?!\2).){4,}\2"""), r"\1\2<redacted>\2"),
    (re.compile(r"""(['"])(?:\\.|(?!\1).){20,}\1"""), r"\1<redacted>\1"),
    (re.compile(r"\b(0x)?[0-9a-fA-F]{16,}\b"), "<redacted-hex>"),
)


def redact(line: str, limit: int = 160) -> str:
    """Return ``line`` safe to print: literals elided, whitespace collapsed, truncated."""
    out = line.strip()
    for rx, repl in _REDACT_RULES:
        out = rx.sub(repl, out)
    out = re.sub(r"\s+", " ", out)
    if len(out) > limit:
        out = out[: limit - 1] + "…"
    return out


@dataclass
class Finding:
    sig_id: str
    klass: str
    path: str
    line: int
    excerpt: str
    why: str

    def as_dict(self) -> dict:
        return {
            "sig_id": self.sig_id,
            "class": self.klass,
            "path": self.path,
            "line": self.line,
            "excerpt": self.excerpt,
            "why": self.why,
        }


@dataclass
class AddedLine:
    path: str
    line: int
    text: str


@dataclass
class Waiver:
    sig_id: str
    reason: str


@dataclass
class ScanResult:
    findings: list[Finding] = field(default_factory=list)
    waived: list[Finding] = field(default_factory=list)
    added_line_count: int = 0
    files_scanned: int = 0


# ---------------------------------------------------------------------------
# Diff parsing. Added lines only.
#
# A removed line is not a breach — deleting `secrets.token_bytes` is the FIX. Only
# `+` lines are scanned, and `+++` headers are excluded. `path` is taken from the
# `+++ b/<path>` header so a finding is addressable.
# ---------------------------------------------------------------------------
_DIFF_NEW_FILE = re.compile(r"^\+\+\+ (?:b/)?(.+?)\s*$")
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def parse_added_lines(diff_text: str) -> list[AddedLine]:
    """Extract added lines with real destination line numbers from a unified diff."""
    out: list[AddedLine] = []
    path = "<unknown>"
    lineno = 0
    for raw in diff_text.splitlines():
        m = _DIFF_NEW_FILE.match(raw)
        if m:
            path = m.group(1)
            if path == "/dev/null":
                path = "<deleted>"
            continue
        if raw.startswith("--- "):
            continue
        h = _HUNK.match(raw)
        if h:
            lineno = int(h.group(1))
            continue
        if raw.startswith("+"):
            out.append(AddedLine(path, lineno, raw[1:]))
            lineno += 1
        elif raw.startswith("-") or raw.startswith("\\"):
            continue
        else:
            # context line (leading space) or noise between hunks
            lineno += 1
    return out


def read_whole_files(paths: list[Path]) -> list[AddedLine]:
    """Treat every line of each file as 'added'. For quarantined leg output."""
    out: list[AddedLine] = []
    for p in paths:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except (OSError, UnicodeError):
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            out.append(AddedLine(str(p), i, line))
    return out


def collect_paths(targets: list[str]) -> list[Path]:
    files: list[Path] = []
    for t in targets:
        p = Path(t)
        if p.is_dir():
            files.extend(sorted(q for q in p.rglob("*") if q.is_file()))
        elif p.is_file():
            files.append(p)
    return files


def git_diff(repo: str, rev_range: str) -> str:
    """Unified diff for a range. Raises CalledProcessError on a bad range (infra)."""
    return subprocess.run(
        ["git", "-C", repo, "diff", "--unified=0", "--no-color", rev_range],
        check=True, capture_output=True, text=True,
    ).stdout


# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------
_SKIP_PATH = re.compile(
    r"(^|/)(\.git/|node_modules/|__pycache__/|\.venv/|dist/|build/)"
    r"|\.(lock|min\.js|map|png|jpg|jpeg|gif|svg|ico|pdf|woff2?)$",
    re.IGNORECASE,
)

# This engine and its own tests necessarily contain every signature they detect.
# Excluding them by path keeps the guard from failing on itself — a real problem,
# since the fix for this node adds `secrets.token_bytes` to the repo as test data.
_SELF_EXEMPT = re.compile(r"(^|/)(mode_d_scan\.py|mode-d-scan\.sh|test_mode_d_scan\.sh)$")


def scan(lines: list[AddedLine], waivers: dict[str, str],
         include_self: bool = False) -> ScanResult:
    res = ScanResult()
    seen_paths: set[str] = set()
    for al in lines:
        if _SKIP_PATH.search(al.path):
            continue
        if not include_self and _SELF_EXEMPT.search(al.path):
            continue
        seen_paths.add(al.path)
        res.added_line_count += 1
        for sig in SIGNATURES:
            if sig.pattern.search(al.text):
                f = Finding(sig.sig_id, sig.klass, al.path, al.line,
                            redact(al.text), sig.why)
                if sig.sig_id in waivers:
                    res.waived.append(f)
                else:
                    res.findings.append(f)
    res.files_scanned = len(seen_paths)
    return res


def lane_of(provider: str | None) -> str:
    """Classify a provider string as 'offload', 'primary', or 'unknown'."""
    if not provider:
        return "unknown"
    p = provider.strip().lower()
    for lane in OFFLOAD_LANES:
        if lane in p:
            return "offload"
    for lane in PRIMARY_LANES:
        if lane in p:
            return "primary"
    return "unknown"


def parse_waivers(raw: list[str]) -> tuple[dict[str, str], list[str]]:
    """``SIG_ID=reason`` pairs. A waiver without a reason is rejected, not defaulted."""
    out: dict[str, str] = {}
    errors: list[str] = []
    known = {s.sig_id for s in SIGNATURES}
    for item in raw or []:
        if "=" not in item:
            errors.append(f"waiver {item!r} has no reason (expected SIG_ID=reason)")
            continue
        sig_id, reason = item.split("=", 1)
        sig_id, reason = sig_id.strip(), reason.strip()
        if not reason:
            errors.append(f"waiver for {sig_id!r} has an empty reason")
            continue
        if sig_id not in known:
            errors.append(f"waiver names unknown signature {sig_id!r}")
            continue
        out[sig_id] = reason
    return out, errors


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def render(res: ScanResult, lane: str, provider: str | None, gated: bool) -> str:
    out: list[str] = []
    prov = provider or "unset"
    out.append(f"[mode-d-scan] provider={prov} lane={lane} "
               f"files={res.files_scanned} added_lines={res.added_line_count}")
    if not res.findings and not res.waived:
        out.append("[mode-d-scan] no Mode-D signatures in the produced output")
        return "\n".join(out)

    by_class: dict[str, list[Finding]] = {}
    for f in res.findings:
        by_class.setdefault(f.klass, []).append(f)

    for klass in sorted(by_class):
        out.append(f"\n  {klass}:")
        for f in by_class[klass]:
            out.append(f"    {f.path}:{f.line}  [{f.sig_id}]")
            out.append(f"      {f.excerpt}")
            out.append(f"      → {f.why}")

    if res.waived:
        out.append("\n  waived:")
        for f in res.waived:
            out.append(f"    {f.path}:{f.line}  [{f.sig_id}]")

    if gated:
        out.append(
            "\n[mode-d-scan] MODE-D BREACH — an offload lane produced the above. "
            "Mode-D work may not run on an offload lane; re-run this leg on "
            "claude-primary. Do NOT merge this output. (exit 2)"
        )
    else:
        out.append(
            f"\n[mode-d-scan] advisory only — lane '{lane}' is not an offload lane, "
            "so Mode-D work here is legitimate. Reported, not failed."
        )
    return "\n".join(out)


class _Parser(argparse.ArgumentParser):
    """ArgumentParser that exits 1, not 2, on a usage error.

    Exit 2 is this engine's CORRECTNESS GATE ("an offload lane produced Mode-D
    output"), and the wrapper propagates it as a halt. argparse's default error
    exit is *also* 2, so a typo in a flag would surface to the operator as a
    confirmed Mode-D breach. A guard that reports a breach when it merely
    misparsed its own arguments is a guard people learn to wave through — the
    same hollowing-out that a reflexive `pin --repin` did to the git guard. So
    usage errors exit 1, which the wrapper classifies as infra and swallows.
    """

    def error(self, message: str) -> None:  # type: ignore[override]
        self.print_usage(sys.stderr)
        print(f"[mode-d-scan] usage error: {message}", file=sys.stderr)
        raise SystemExit(1)


def main(argv: list[str] | None = None) -> int:
    ap = _Parser(
        prog="mode_d_scan.py",
        description="Fail a delegated leg whose OUTPUT crossed the Mode-D boundary.",
    )
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--range", help="git rev range, e.g. BASE..HEAD")
    src.add_argument("--diff", help="path to a unified diff ('-' for stdin)")
    src.add_argument("--paths", nargs="+", help="files/dirs to scan whole (quarantined output)")
    ap.add_argument("--repo", default=".", help="repo root for --range (default: cwd)")
    ap.add_argument("--provider", help="producing lane: ica|bob|gemini|codex|claude")
    ap.add_argument("--allow", action="append", default=[],
                    metavar="SIG_ID=reason", help="waive a signature, with a reason")
    ap.add_argument("--include-self", action="store_true",
                    help="do not exempt the scanner's own files (used by its tests)")
    ap.add_argument("--json", action="store_true", help="emit the structured contract")
    args = ap.parse_args(argv)

    waivers, waiver_errors = parse_waivers(args.allow)
    if waiver_errors:
        for e in waiver_errors:
            print(f"[mode-d-scan] {e}", file=sys.stderr)
        return 1  # usage error → wrapper treats as infra

    # ── acquire the text to scan ────────────────────────────────────────────
    if args.paths:
        lines = read_whole_files(collect_paths(args.paths))
    elif args.diff:
        text = sys.stdin.read() if args.diff == "-" else Path(args.diff).read_text(
            encoding="utf-8", errors="replace")
        lines = parse_added_lines(text)
    elif args.range:
        try:
            lines = parse_added_lines(git_diff(args.repo, args.range))
        except subprocess.CalledProcessError as e:
            print(f"[mode-d-scan] git diff failed for {args.range!r}: "
                  f"{e.stderr.strip()}", file=sys.stderr)
            return 1
        except FileNotFoundError:
            print("[mode-d-scan] git not found", file=sys.stderr)
            return 1
    else:
        if sys.stdin.isatty():
            ap.error("one of --range / --diff / --paths is required")
        lines = parse_added_lines(sys.stdin.read())

    res = scan(lines, waivers, include_self=args.include_self)
    lane = lane_of(args.provider)
    gated = bool(res.findings) and lane == "offload"

    if args.json:
        print(json.dumps({
            "provider": args.provider,
            "lane": lane,
            "gated": gated,
            "files_scanned": res.files_scanned,
            "added_lines": res.added_line_count,
            "findings": [f.as_dict() for f in res.findings],
            "waived": [f.as_dict() | {"reason": waivers[f.sig_id]} for f in res.waived],
        }, indent=2))
    else:
        print(render(res, lane, args.provider, gated))

    return 2 if gated else 0


if __name__ == "__main__":
    sys.exit(main())
