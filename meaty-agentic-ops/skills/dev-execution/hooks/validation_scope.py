#!/usr/bin/env python3
"""validation_scope.py — symbol-scoped test-scope resolution for the reviewer gate.

The engine behind ``validation-scope.sh``. The wrapper owns the master switch, the
binding guard, and the non-fatal contract; this module owns the actual resolution
(and, in Phase 2, base/head measurement).

WHY THIS EXISTS
---------------
The reviewer gate that approved skillmeat PR #299 (node ``node_01KZ...`` — see
``docs/project_plans/reviewer-gate-validation-scope-hardening-v1.md`` §2/§3.4) approved
a tree in which ``tests/test_enterprise_artifact_upstream.py`` still asserted the OLD,
fabricated-clean-verdict behaviour of ``_dto_to_response()`` in
``skillmeat/api/routers/artifacts/crud.py`` — because that test file was never touched
by the diff the gate reviewed and a diff-scoped selector never found it. A **diff-scoped**
test selector is blind to exactly this case: a symbol's behaviour changed, a test
exercises that symbol by name (not by touching the same lines), and the test file itself
is untouched.

THE FIX: symbol-scoped, not diff-scoped
----------------------------------------
This module computes, from a base tree and a head tree:

1. Which ``*.py`` files changed between the two trees (a plain tree diff — no git
   repository is required; the AC-4 fixture is two directories, not two commits).
2. For each changed file, which ``FunctionDef`` / ``AsyncFunctionDef`` / ``ClassDef``
   symbols enclose the changed lines, on BOTH the base and head side (so a
   deleted/renamed symbol is captured, not just the surviving one) — via ``ast``, never
   a regex over source text.
3. A module-level fallback identity (dotted import path + basename stem) for changes
   that are not symbol-shaped (e.g. a module-level constant).
4. Which test files, anywhere in the tree, *reference* one of those symbols by name —
   via ``grep -lE`` over the tree's test files — even when those test files never
   appear in the diff at all. This is the mechanism that would have caught PR #299.
5. Which test files reference a changed ENDPOINT by its HTTP ROUTE — for a changed
   route handler in a router module, the decorator's path literal (plus the module's
   ``APIRouter(prefix=...)``) is turned into a URL-shaped grep regex. Symbol-scoping
   alone is still blind to a test that drives a changed endpoint purely over HTTP and
   names no changed Python symbol: the gate on the artifact-id exact-first sweep
   reported "no regressions vs base" while
   ``POST /api/v1/artifacts/{artifact_id}/version`` returned 503 for every request,
   because ``tests/integration/test_enterprise_artifact_version_update.py`` spells the
   URL and never the handler name — and so appeared in neither the resolved nor the
   omitted list. Route identities carry the same fanout/budget bounds and the same
   disclosure obligations as symbol identities.

BOUNDED, NOT UNBOUNDED
-----------------------
Symbol-scoped resolution over a whole tree is more expensive than a diff-scoped one, so
three independent bounds cap the cost, and each one DISCLOSES on the result rather than
silently truncating (a silently-empty or silently-truncated scope is the exact failure
class this plan exists to fix):

  * symbol fanout filter  — ``symbols_dropped[]``     (dropped names + why + fanout)
  * test-file cap         — ``scope_truncated``/``omitted_files[]``
  * wall-clock budget     — ``budget_exhausted``/``budget_exhausted_files[]``

Non-Python diffs are reported loudly (``scope_status: "unsupported_language"``), never
as a silently-empty scope.

DETERMINISTIC. No model call (AOS constraint 4). ``grep``/``ast``/``difflib`` only.

Plan: ``docs/project_plans/reviewer-gate-validation-scope-hardening-v1.md`` §3.1, §5
Phase 1. Sibling shell-wrapper/python-engine convention:
``.claude/skills/dev-execution/hooks/mode-d-scan.sh`` + ``mode_d_scan.py``.

PHASE 2 ADDITION — measure_file() and the `measure` CLI subcommand
--------------------------------------------------------------------
§3.2 of the plan: base/head pytest delta for one test file, without ``git
stash`` (never mutates the tree being measured), fail-closed on every one of
the ways this silently goes wrong:

  * R1 (editable-install shadow): before running pytest, every top-level
    package the test file imports that ALSO exists as a local
    package/module directly under the tree being measured is import-checked
    in a preflight subprocess with PYTHONPATH pinned to that tree; if the
    resolved ``__file__`` is not under the tree, the measurement aborts
    fail-closed as ``measurement_failure`` rather than silently measuring
    the wrong package (e.g. a real editable-installed ``skillmeat``).
  * R2 (zero-collected reads as clean): ``collected == 0`` is
    ``measurement_failure``, never ``0 failed``. Every glob/pattern used
    here is a literal argv element, never shell-interpolated.
  * Node-id-level diff: ``newly_failing_node_ids`` is failing-at-head minus
    failing-at-base, not just a count delta -- a file can hold the same
    failure COUNT with a different failure SET.
  * ``pytest-timeout`` absence is recorded on the blob
    (``pytest_timeout_available``), never assumed present (§6).

The real-repo path (`measure` CLI subcommand) reuses ``_materialize_ref``'s
detached, SHA-pinned worktree for the base tree — ``git worktree add
--detach <SHA>``, never ``EnterWorktree`` (worktree-isolation-lane.md:
``baseRef: fresh`` would measure ``origin/<default-branch>``, not the
requested base). Cleanup (``_cleanup_baseline_worktree``) enforces R6's three
guards as hard preconditions, never advisory: confined to
``.claude/worktrees/gate-baseline-<sha12>``, refuses a non-empty
``git status --porcelain``, and refuses the repo root or the caller's own
cwd. Any guard failing is a refusal to widen ``--force``, never a wider one.
"""

import argparse
import ast
import difflib
import importlib.util
import json
import os
import re
import shlex
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Bounds — overridable per-call (the CLI wrapper threads these from env vars),
# defaulting to the plan's §3.1 numbers.
# ---------------------------------------------------------------------------
DEFAULT_MAX_FANOUT_PER_SYMBOL = 40
DEFAULT_MAX_TEST_FILES = 25
DEFAULT_MAX_SCOPE_SECONDS = 900

# Directories never walked when enumerating a tree — noise, not signal, and
# potentially huge (vendored deps, VCS metadata, build output).
#
# `.claude/worktrees` and `.worktrees` are included so a NESTED base checkout
# (materialized by `_materialize_ref` under a workdir that ends up inside the
# tree being walked) is never itself enumerated as "changed" content -- see
# `_default_workdir`'s docstring for why this is defense-in-depth rather than
# the primary fix. Both are two-segment/one-segment alternatives in the SAME
# pattern (not bolted on as a separate check), so `_SKIP_DIR.search(rel)`
# alone still decides skip-or-not for every relpath, exactly as before.
_SKIP_DIR = re.compile(
    r"(^|/)(\.git|node_modules|__pycache__|\.venv|venv|dist|build|\.mypy_cache|"
    r"\.pytest_cache|\.claude/worktrees|\.worktrees)(/|$)"
)

# A file is treated as a "test file" candidate for the grep-resolution step (and for
# the diff-presence union) when its name or path matches either common convention.
_TEST_NAME = re.compile(r"(^|/)(test_[^/]+\.py|[^/]+_test\.py)$")
_TEST_DIR = re.compile(r"(^|/)tests?(/|$)")


def _is_test_file(relpath: str) -> bool:
    return bool(_TEST_NAME.search(relpath) or _TEST_DIR.search(relpath))


def _is_dunder(name: str) -> bool:
    return name.startswith("__") and name.endswith("__") and len(name) > 4


# ---------------------------------------------------------------------------
# Result contract
# ---------------------------------------------------------------------------
@dataclass
class SymbolDrop:
    symbol: str
    #: "too_short" | "dunder" | "fanout" | "route_not_discriminating"
    #: A ``route:<path>``-prefixed ``symbol`` is an endpoint identity, not a
    #: Python name (see step 4b).
    reason: str
    fanout: int | None = None

    def as_dict(self) -> dict:
        return {"symbol": self.symbol, "reason": self.reason, "fanout": self.fanout}


@dataclass
class ScopeResult:
    scope_status: str  # "ok" | "unsupported_language" | "no_changes"
    test_scope: list[str] = field(default_factory=list)
    matched_symbols: dict[str, list[str]] = field(default_factory=dict)
    changed_symbols: list[str] = field(default_factory=list)
    symbols_dropped: list[SymbolDrop] = field(default_factory=list)
    diff_files: list[str] = field(default_factory=list)
    scope_truncated: bool = False
    omitted_files: list[str] = field(default_factory=list)
    budget_exhausted: bool = False
    budget_exhausted_files: list[str] = field(default_factory=list)
    resolution_command: str = ""
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "scope_status": self.scope_status,
            "test_scope": self.test_scope,
            "matched_symbols": self.matched_symbols,
            "changed_symbols": self.changed_symbols,
            "symbols_dropped": [d.as_dict() for d in self.symbols_dropped],
            "diff_files": self.diff_files,
            "scope_truncated": self.scope_truncated,
            "omitted_files": self.omitted_files,
            "budget_exhausted": self.budget_exhausted,
            "budget_exhausted_files": self.budget_exhausted_files,
            "resolution_command": self.resolution_command,
            "notes": self.notes,
        }


# ---------------------------------------------------------------------------
# Phase 2 — measure_file() result contract
# ---------------------------------------------------------------------------
@dataclass
class FileMeasurement:
    file: str
    base_collected: int = 0
    base_passed: int = 0
    base_failed: int = 0
    base_errors: int = 0
    base_xfailed: int = 0
    head_collected: int = 0
    head_passed: int = 0
    head_failed: int = 0
    head_errors: int = 0
    head_xfailed: int = 0
    newly_failing_node_ids: list[str] = field(default_factory=list)
    # A test that STOPPED being collected at head. Disclosed rather than
    # gated: deleting a test is legitimate, silently losing one is not.
    collected_regression: bool = False
    disappeared_node_ids: list[str] = field(default_factory=list)
    measurement_failure: bool = False
    failure_reason: str = ""
    pytest_timeout_available: bool = False
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "file": self.file,
            "measurement_failure": self.measurement_failure,
            "failure_reason": self.failure_reason,
            "pytest_timeout_available": self.pytest_timeout_available,
            "base": {
                "collected": self.base_collected,
                "passed": self.base_passed,
                "failed": self.base_failed,
                "errors": self.base_errors,
                "xfailed": self.base_xfailed,
            },
            "head": {
                "collected": self.head_collected,
                "passed": self.head_passed,
                "failed": self.head_failed,
                "errors": self.head_errors,
                "xfailed": self.head_xfailed,
            },
            "delta": {
                "failed": self.head_failed - self.base_failed,
                "collected": self.head_collected - self.base_collected,
            },
            "newly_failing_node_ids": self.newly_failing_node_ids,
            "collected_regression": self.collected_regression,
            "disappeared_node_ids": self.disappeared_node_ids,
            "notes": self.notes,
        }


# ---------------------------------------------------------------------------
# Step 1 — tree diff (plain filesystem comparison; no git repo required so the
# same resolver serves both a real git base/head pair materialized to disk by
# the CLI, and the static two-directory AC-4 fixture).
# ---------------------------------------------------------------------------
def _walk(root: Path) -> dict[str, Path]:
    """relative-posix-path -> absolute path, for every regular file under root."""
    out: dict[str, Path] = {}
    if not root.is_dir():
        return out
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if _SKIP_DIR.search(rel):
            continue
        out[rel] = p
    return out


def _changed_files(base_map: dict[str, Path], head_map: dict[str, Path]) -> set[str]:
    changed: set[str] = set()
    for rel in set(base_map) | set(head_map):
        bp, hp = base_map.get(rel), head_map.get(rel)
        if bp is None or hp is None:
            changed.add(rel)
            continue
        try:
            if bp.read_bytes() != hp.read_bytes():
                changed.add(rel)
        except OSError:
            changed.add(rel)
    return changed


# ---------------------------------------------------------------------------
# Step 2 — changed line ranges (per side) via difflib, then AST-mapped to the
# enclosing symbol(s) on that side.
# ---------------------------------------------------------------------------
def _diff_line_numbers(base_text: str, head_text: str) -> tuple[set[int], set[int]]:
    base_lines = base_text.splitlines()
    head_lines = head_text.splitlines()
    sm = difflib.SequenceMatcher(None, base_lines, head_lines, autojunk=False)
    base_changed: set[int] = set()
    head_changed: set[int] = set()
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        base_changed.update(range(i1 + 1, i2 + 1))
        head_changed.update(range(j1 + 1, j2 + 1))
    return base_changed, head_changed


def _enclosing_symbols(source: str, changed_lines: set[int]) -> set[str]:
    """Leaf names of every FunctionDef/AsyncFunctionDef/ClassDef whose line range
    contains at least one changed line -- at every nesting depth that encloses it
    (both the method AND its owning class), so a rename/move is still caught via
    either identity. Never raises: a file that fails to parse contributes no
    symbols from this side (the module-identity fallback still applies)."""
    if not changed_lines:
        return set()
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return set()

    found: set[str] = set()

    def visit(node: ast.AST) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                start = child.lineno
                end = getattr(child, "end_lineno", start) or start
                if any(start <= ln <= end for ln in changed_lines):
                    found.add(child.name)
                visit(child)
            else:
                visit(child)

    visit(tree)
    return found


# ---------------------------------------------------------------------------
# Step 4 — grep resolution over the tree's test files.
# ---------------------------------------------------------------------------
def _grep_files_for_symbol(symbol: str, candidates: list[Path]) -> list[Path]:
    """`grep -lE '\\b<symbol>\\b' <candidate files>` -- explicit file list rather than
    a directory walk, since step 1 already enumerated the tree once; functionally
    equivalent to `grep -rlE` over the test roots, and avoids re-walking."""
    if not candidates:
        return []
    pattern = rf"\b{re.escape(symbol)}\b"
    try:
        proc = subprocess.run(
            ["grep", "-lE", pattern, *[str(c) for c in candidates]],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return []
    # grep exit codes: 0 = matches found, 1 = no matches, >=2 = error.
    if proc.returncode not in (0, 1):
        return []
    return [Path(line) for line in proc.stdout.splitlines() if line]


def _grep_files_for_regex(pattern: str, candidates: list[Path]) -> list[Path]:
    """``grep -lE <pattern> <candidate files>`` for an already-built regex.

    The symbol path (:func:`_grep_files_for_symbol`) wraps its needle in ``\\b``
    word boundaries, which is wrong for a URL-shaped needle whose first and
    last characters are ``/``. Same bounded, deterministic mechanism otherwise.
    """
    if not candidates:
        return []
    try:
        proc = subprocess.run(
            ["grep", "-lE", pattern, *[str(c) for c in candidates]],
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return []
    if proc.returncode not in (0, 1):
        return []
    return [Path(line) for line in proc.stdout.splitlines() if line]


# ---------------------------------------------------------------------------
# Step 4b — ENDPOINT-scoped resolution (an endpoint is an identity too).
#
# WHY: a symbol-scoped selector is still blind to one case that a diff-scoped
# one is also blind to — a test that exercises a changed ENDPOINT purely
# through its HTTP route, naming no changed Python symbol at all. That is not
# hypothetical: the reviewer gate on this very branch reported "no regressions
# vs base" while ``POST /api/v1/artifacts/{artifact_id}/version`` was returning
# 503 for EVERY request, because the only test file that boots that route
# (``tests/integration/test_enterprise_artifact_version_update.py``) names the
# URL, never the handler ``push_artifact_content``. It appeared in neither the
# resolved nor the omitted list, so its absence was not even disclosed.
#
# So: for a changed router file, the route path literal on a changed handler's
# decorator is treated as a first-class identity alongside the symbol names,
# and test files are grepped for a URL-shaped regex derived from it.
# ---------------------------------------------------------------------------

#: HTTP verbs that appear as ``@router.<verb>(...)`` route decorators.
_ROUTE_DECORATOR_VERBS = frozenset(
    {"get", "post", "put", "patch", "delete", "head", "options", "api_route"}
)

#: A path placeholder: ``{artifact_id}`` / ``{artifact_id:path}``.
_PATH_PLACEHOLDER_RE = re.compile(r"\{[^}]*\}")


def _router_prefix(tree: ast.AST) -> str:
    """Best-effort ``APIRouter(prefix="/x")`` literal for a router module.

    Returns ``""`` when the prefix is absent or not a literal — the derived
    endpoint regex then simply matches on the route path alone, which is
    looser but never wrong.
    """
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
        if name != "APIRouter":
            continue
        for kw in node.keywords:
            if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                if isinstance(kw.value.value, str):
                    return kw.value.value
    return ""


def _route_paths_for_changed_handlers(source: str, changed_lines: set[int]) -> set[str]:
    """Route paths declared by handlers that enclose at least one changed line.

    A decorator's own lines count as part of the handler for this purpose: a
    change to the ``responses=`` map or the dependency list is a change to the
    endpoint's observable contract just as much as a change to its body.
    Never raises — an unparseable file contributes nothing here.
    """
    if not changed_lines:
        return set()
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return set()

    prefix = _router_prefix(tree)
    paths: set[str] = set()

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        starts = [node.lineno] + [d.lineno for d in node.decorator_list]
        start = min(starts)
        end = getattr(node, "end_lineno", node.lineno) or node.lineno
        if not any(start <= ln <= end for ln in changed_lines):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            fn = dec.func
            if (
                not isinstance(fn, ast.Attribute)
                or fn.attr not in _ROUTE_DECORATOR_VERBS
            ):
                continue
            for arg in dec.args:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    paths.add(prefix + arg.value)
                    break
    return paths


def _endpoint_regex(route_path: str) -> str | None:
    """Turn a route path into a grep regex that matches how tests spell URLs.

    ``/artifacts/{artifact_id:path}/version`` becomes
    ``/artifacts/[^"'[:space:]]*/version`` so it matches an f-string like
    ``f"/api/v1/artifacts/{artifact.id}/version"`` — placeholders are
    interpolated at the call site, so they cannot be matched literally, but the
    literal segments around them can.

    Returns ``None`` when the path has no literal segment substantial enough to
    be discriminating (a bare ``/`` or ``/{id}``), rather than emitting a
    regex that would match most of the tree.
    """
    chunks = [c for c in _PATH_PLACEHOLDER_RE.split(route_path) if c not in ("", "/")]
    if not chunks:
        return None
    # Require some real literal text, not just separators.
    if sum(len(c.strip("/")) for c in chunks) < 4:
        return None
    return "[^\"'[:space:]]*".join(re.escape(c) for c in chunks)


def _check_not_nested(base_dir: Path, head_dir: Path) -> str | None:
    """Return an error message if one resolved tree contains the other in a
    way that would actually corrupt the walk, else None. Uses RESOLVED
    absolute paths (symlinks and `..` included) -- a string-prefix check on
    the raw arguments would miss exactly the case this exists to catch (a
    relative `--workdir` resolved against a cwd that is itself inside the
    tree being diffed).

    A nested base/head pair can normally never yield a meaningful diff:
    walking the outer tree would enumerate the entire inner checkout as
    "changed" content (every file present in one map and absent from the
    other), producing a whole-repo scope that LOOKS like a valid result.
    Silently producing that result is the actual harm -- the wrapper's
    non-fatal contract turns a nonsense scope into a silent gate pass, never
    an error anyone sees. So this fails closed via a raised error, not a
    best-effort skip.

    EXCEPTION, deliberately: nesting under a path `_walk()` already skips
    (chiefly `.git` -- see `_SKIP_DIR`) is harmless, because `_walk()` never
    enumerates it as "changed" content in the first place. Without this
    exception, the ordinary main-checkout case would ALWAYS trip this check
    (git-common-dir for a main checkout is `<repo>/.git`, which is trivially
    "inside" `<repo>` == head_dir, even though nothing about that is
    corrupting the walk). This check exists for nesting `_SKIP_DIR` does NOT
    already neutralize -- e.g. a custom `--workdir`/`--head-dir` pair that
    lands one tree inside the other under a path that IS walked.

    Identical resolved paths (base_dir == head_dir) are NOT nesting -- that
    is the legitimate "no_changes" case and must not be rejected here.
    """
    b = base_dir.resolve()
    h = head_dir.resolve()
    if b == h:
        return None
    for inner, outer, inner_label, outer_label in (
        (b, h, "base_dir", "head_dir"),
        (h, b, "head_dir", "base_dir"),
    ):
        try:
            rel = inner.relative_to(outer)
        except ValueError:
            continue
        if _SKIP_DIR.search(rel.as_posix()):
            continue
        return (
            f"{inner_label} {inner} is nested inside {outer_label} {outer} "
            "under a path that would actually be walked -- a nested "
            "base/head pair can never yield a meaningful diff there "
            "(walking the outer tree would enumerate the inner checkout "
            "itself as 'changed'); refusing rather than producing a "
            "whole-repo scope"
        )
    return None


def _resolution_command_repr(kept_symbols: list[str], head_dir: Path) -> str:
    """A single, auditable string documenting the effective unioned grep query --
    what was actually run was one `grep -lE` invocation per surviving symbol (needed
    to compute per-symbol fanout for the bound), which is semantically the union this
    string represents. Recorded so scope membership is auditable per §3.1."""
    if not kept_symbols:
        return ""
    alternation = "|".join(re.escape(s) for s in kept_symbols)
    return (
        f"grep -rlE {shlex.quote(chr(92) + 'b(' + alternation + chr(92) + 'b)')} "
        f"{shlex.quote(str(head_dir))}  # (executed per-symbol for fanout accounting)"
    )


# ---------------------------------------------------------------------------
# The resolver
# ---------------------------------------------------------------------------
def resolve_test_scope(
    base_dir: Path,
    head_dir: Path,
    *,
    max_fanout: int | None = None,
    max_test_files: int | None = None,
    max_seconds: float | None = None,
) -> ScopeResult:
    """Resolve the symbol-scoped test scope for the change between two trees.

    ``base_dir``/``head_dir`` are plain directory trees -- NOT git SHAs and NOT
    required to be git repositories. This is what lets the same resolver serve both
    a real git base/head pair (materialized to disk once by the CLI wrapper) and the
    AC-4 fixture's static ``base/``/``head/`` directories.
    """
    base_dir = Path(base_dir)
    head_dir = Path(head_dir)
    max_fanout = DEFAULT_MAX_FANOUT_PER_SYMBOL if max_fanout is None else max_fanout
    max_test_files = DEFAULT_MAX_TEST_FILES if max_test_files is None else max_test_files
    max_seconds = DEFAULT_MAX_SCOPE_SECONDS if max_seconds is None else max_seconds

    nested_error = _check_not_nested(base_dir, head_dir)
    if nested_error:
        raise ValueError(nested_error)

    start = time.monotonic()

    base_map = _walk(base_dir)
    head_map = _walk(head_dir)
    changed = _changed_files(base_map, head_map)

    py_changed = sorted(f for f in changed if f.endswith(".py"))
    non_py_changed = sorted(f for f in changed if not f.endswith(".py"))

    if not py_changed:
        if changed:
            return ScopeResult(
                scope_status="unsupported_language",
                diff_files=non_py_changed,
                notes=[
                    "the diff between base_dir and head_dir touches no *.py files; "
                    "symbol-scoped resolution is python-only, so scope is reported "
                    "empty and LOUD rather than silently empty",
                ],
            )
        return ScopeResult(scope_status="no_changes", notes=["base_dir and head_dir are identical"])

    # ---- Step 2/3: changed symbols per file (both sides) + module identity ----
    raw_symbols: set[str] = set()
    raw_routes: set[str] = set()
    for rel in py_changed:
        base_path, head_path = base_map.get(rel), head_map.get(rel)
        try:
            base_text = base_path.read_text(encoding="utf-8", errors="replace") if base_path else None
        except OSError:
            base_text = None
        try:
            head_text = head_path.read_text(encoding="utf-8", errors="replace") if head_path else None
        except OSError:
            head_text = None

        if base_text is not None and head_text is not None:
            base_lines, head_lines = _diff_line_numbers(base_text, head_text)
        elif head_text is not None:  # newly added file: every line is "changed"
            base_lines, head_lines = set(), set(range(1, head_text.count("\n") + 2))
        elif base_text is not None:  # deleted file: every line is "changed"
            base_lines, head_lines = set(range(1, base_text.count("\n") + 2)), set()
        else:
            continue

        if base_text is not None:
            raw_symbols |= _enclosing_symbols(base_text, base_lines)
            raw_routes |= _route_paths_for_changed_handlers(base_text, base_lines)
        if head_text is not None:
            raw_symbols |= _enclosing_symbols(head_text, head_lines)
            raw_routes |= _route_paths_for_changed_handlers(head_text, head_lines)

        # module-level identity fallback (step 3): dotted import path + stem.
        raw_symbols.add(rel[: -len(".py")].replace("/", "."))
        raw_symbols.add(Path(rel).stem)

    # ---- Bound 1a: length/dunder filter ----
    symbols_dropped: list[SymbolDrop] = []
    length_filtered: list[str] = []
    for name in sorted(raw_symbols):
        if len(name) < 5:
            symbols_dropped.append(SymbolDrop(name, "too_short"))
        elif _is_dunder(name):
            symbols_dropped.append(SymbolDrop(name, "dunder"))
        else:
            length_filtered.append(name)

    # ---- Candidate test files (grep universe): every test-shaped *.py file
    # present in head_dir (falling back to base_dir for a file deleted at head). ----
    candidate_rel = sorted(
        {rel for rel in head_map if rel.endswith(".py") and _is_test_file(rel)}
        | {rel for rel in base_map if rel.endswith(".py") and _is_test_file(rel) and rel not in head_map}
    )
    candidate_paths = [head_map.get(rel, base_map.get(rel)) for rel in candidate_rel]
    candidate_paths = [p for p in candidate_paths if p is not None]
    rel_by_path = {p: rel for rel, p in zip(candidate_rel, candidate_paths)}

    # ---- Bound 1b (fanout) + per-file matched-symbol accumulation, budget-checked. ----
    matched_symbols: dict[str, set[str]] = {}
    kept_symbols: list[str] = []
    budget_exhausted = False
    unrun_symbols: list[str] = []

    for idx, name in enumerate(length_filtered):
        if time.monotonic() - start > max_seconds:
            budget_exhausted = True
            unrun_symbols = length_filtered[idx:]
            break
        matches = _grep_files_for_symbol(name, candidate_paths)
        fanout = len(matches)
        if fanout > max_fanout:
            symbols_dropped.append(SymbolDrop(name, "fanout", fanout))
            continue
        kept_symbols.append(name)
        for m in matches:
            rel = rel_by_path.get(m)
            if rel is None:
                continue
            matched_symbols.setdefault(rel, set()).add(name)

    # ---- Bound 1c: ENDPOINT-scoped pass — a changed route is an identity too. ----
    # Same fanout bound and wall-clock budget as the symbol pass. Runs AFTER the
    # symbol pass so a tight budget degrades the cheaper-to-lose signal first,
    # and every drop is disclosed on ``symbols_dropped`` (reason ``fanout``)
    # exactly like a symbol drop — never silently.
    kept_routes: list[str] = []
    for route in sorted(raw_routes):
        if time.monotonic() - start > max_seconds:
            budget_exhausted = True
            break
        pattern = _endpoint_regex(route)
        if pattern is None:
            symbols_dropped.append(
                SymbolDrop(f"route:{route}", "route_not_discriminating")
            )
            continue
        matches = _grep_files_for_regex(pattern, candidate_paths)
        fanout = len(matches)
        if fanout > max_fanout:
            symbols_dropped.append(SymbolDrop(f"route:{route}", "fanout", fanout))
            continue
        kept_routes.append(route)
        for m in matches:
            rel = rel_by_path.get(m)
            if rel is None:
                continue
            matched_symbols.setdefault(rel, set()).add(f"route:{route}")

    budget_exhausted_files: list[str] = []
    if budget_exhausted:
        # The files whose membership could not be fully determined: any candidate
        # never confirmed via a completed symbol grep before time ran out.
        budget_exhausted_files = sorted(set(candidate_rel) - set(matched_symbols))

    # ---- diff-present test files: always retained regardless of rank. ----
    diff_test_files = {rel for rel in py_changed if _is_test_file(rel)}
    for rel in diff_test_files:
        matched_symbols.setdefault(rel, set())

    # ---- Bound 2: file cap, diff files always kept. ----
    ranked_others = sorted(
        (rel for rel in matched_symbols if rel not in diff_test_files),
        key=lambda rel: (-len(matched_symbols[rel]), rel),
    )
    remaining_budget = max(max_test_files - len(diff_test_files), 0)
    kept_others = ranked_others[:remaining_budget]
    omitted = ranked_others[remaining_budget:]
    scope_truncated = bool(omitted)

    test_scope = sorted(diff_test_files | set(kept_others))
    final_matched_symbols = {
        rel: sorted(matched_symbols[rel]) for rel in test_scope
    }

    return ScopeResult(
        scope_status="ok",
        test_scope=test_scope,
        matched_symbols=final_matched_symbols,
        changed_symbols=sorted(kept_symbols) + [f"route:{r}" for r in kept_routes],
        symbols_dropped=symbols_dropped,
        diff_files=sorted(changed),
        scope_truncated=scope_truncated,
        omitted_files=omitted,
        budget_exhausted=budget_exhausted,
        budget_exhausted_files=budget_exhausted_files,
        resolution_command=_resolution_command_repr(kept_symbols, head_dir),
        notes=(
            ["one or more symbols exceeded the fanout bound and were dropped -- see symbols_dropped"]
            if any(d.reason == "fanout" for d in symbols_dropped)
            else []
        )
        + (
            [
                "wall-clock budget exhausted before all symbols were resolved; "
                f"{len(unrun_symbols)} symbol(s) never greped: {', '.join(unrun_symbols[:20])}"
                + (" …" if len(unrun_symbols) > 20 else "")
            ]
            if budget_exhausted
            else []
        ),
    )


# ---------------------------------------------------------------------------
# Phase 2 — measure_file(): base/head pytest delta for one test file (§3.2)
# ---------------------------------------------------------------------------
def _pytest_timeout_available() -> bool:
    """§6: never assume ``pytest-timeout`` is installed -- check and record."""
    return importlib.util.find_spec("pytest_timeout") is not None


def _top_level_imports(source: str) -> set[str]:
    """Every top-level module name a source file imports (``import x.y`` and
    ``from x.y import z`` both contribute ``x``). Never raises: an unparsable
    file contributes no names (the caller treats that as "nothing to check",
    not as a failure of its own)."""
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return set()
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.level == 0:
                names.add(node.module.split(".")[0])
    return names


def _locally_shadowable_packages(tree_dir: Path, test_file: str) -> list[str]:
    """Top-level names ``test_file`` imports that ALSO exist as a package or
    module directly under ``tree_dir`` -- i.e. names an editable install (or
    any other entry earlier on sys.path) could shadow. This is what makes
    the R1 check generic rather than hard-coded to "skillmeat": whatever
    hermetic package a fixture ships is exactly what gets checked."""
    path = tree_dir / test_file
    try:
        source = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    local: list[str] = []
    for name in sorted(_top_level_imports(source)):
        if (tree_dir / name).is_dir() or (tree_dir / f"{name}.py").is_file():
            local.append(name)
    return local


def _assert_import_shadow(
    tree_dir: Path, test_file: str, python_bin: str
) -> tuple[bool, str]:
    """R1 mitigation (§3.2 point 2, plan risk R1): for every locally-shadowable
    top-level package ``test_file`` imports, assert that importing it with
    PYTHONPATH pinned to ``tree_dir`` resolves a ``__file__`` actually under
    ``tree_dir`` -- not a same-named package that happens to be on sys.path
    from an editable install elsewhere (e.g. the real ``skillmeat`` repo).
    Returns ``(ok, message)``; ``ok=False`` means "abort the measurement",
    never "proceed and hope"."""
    local_packages = _locally_shadowable_packages(tree_dir, test_file)
    if not local_packages:
        return True, "no locally-shadowable packages referenced by this test file"

    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(tree_dir) + (os.pathsep + existing if existing else "")

    script = "; ".join(f"import {name}; print({name}.__file__ or '')" for name in local_packages)
    try:
        proc = subprocess.run(
            [python_bin, "-c", script],
            cwd=str(tree_dir),
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, f"import-shadow preflight for {local_packages} could not run: {e}"

    if proc.returncode != 0:
        return False, (
            f"import-shadow preflight failed to import {local_packages} under "
            f"{tree_dir}: {proc.stderr.strip()[-500:]}"
        )

    tree_resolved = str(tree_dir.resolve())
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    for line in lines:
        resolved = str(Path(line.strip()).resolve())
        if not resolved.startswith(tree_resolved):
            return False, (
                f"import-shadow: {line.strip()!r} resolved OUTSIDE the measured tree "
                f"({tree_resolved}) -- almost certainly an editable install or another "
                "sys.path entry shadowing the fixture/worktree package (plan risk R1); "
                "measurement aborted fail-closed rather than reporting a number "
                "measured against the wrong tree"
            )
    return True, f"import-shadow check passed for {local_packages}"


_SUMMARY_OUTCOME_RE = re.compile(r"(\d+)\s+(passed|failed|error(?:s)?|skipped|xfailed|xpassed)")
_NODE_STATUS_RE = re.compile(r"^(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\s+(\S+)")


def _parse_pytest_output(stdout: str, stderr: str) -> dict:
    """Parse ``pytest -q --tb=no -rA``'s own summary, never a re-derived count.

    Returns ``{"collected": int, "passed": int, "failed": int, "errors": int,
    "xfailed": int, "node_ids": {status: [nodeid, ...]}}``. ``collected`` is
    the sum of every outcome category pytest itself reported on the final
    summary line (passed+failed+error+skipped+xfailed+xpassed) -- if that
    line is absent or unparsable, collected stays 0 and the caller (per
    R2/§3.2 property 3) treats that as measurement_failure, never as a clean
    "0 failed" run.
    """
    output = stdout + "\n" + stderr
    node_ids: dict[str, list[str]] = {}
    for line in output.splitlines():
        m = _NODE_STATUS_RE.match(line.strip())
        if m:
            node_ids.setdefault(m.group(1), []).append(m.group(2))

    # The final summary line: pytest's own accounting, not a re-derivation.
    # In "-q" (quiet) mode this is a bare "N passed in 0.01s" with no "="
    # decoration at all; in verbose mode it is wrapped in "=== ... ===".
    # Match on content (" in <float>s", at least one outcome word), not on
    # decoration, so both shapes are recognized.
    summary_line = ""
    for line in output.splitlines():
        stripped = line.strip("= \t")
        if re.search(r"\bin\s+[\d.]+s\b", stripped) and _SUMMARY_OUTCOME_RE.search(stripped):
            summary_line = stripped
    counts: dict[str, int] = {}
    for num, label in _SUMMARY_OUTCOME_RE.findall(summary_line):
        counts[label] = counts.get(label, 0) + int(num)

    return {
        "collected": sum(counts.values()),
        "passed": counts.get("passed", 0),
        "failed": counts.get("failed", 0),
        "errors": counts.get("error", 0) + counts.get("errors", 0),
        "xfailed": counts.get("xfailed", 0),
        "node_ids": node_ids,
    }


def _run_pytest_one_file(
    tree_dir: Path,
    test_file: str,
    *,
    max_seconds: float | None,
    python_bin: str,
) -> dict:
    """Run pytest against exactly ``test_file`` inside ``tree_dir``, isolated
    from any ancestor conftest/ini (``--confcutdir``/``--rootdir`` pinned to
    ``tree_dir``) and with PYTHONPATH pinned so the tree's own packages are
    resolved ahead of anything else on the path. Never uses ``git stash`` --
    this only ever reads ``tree_dir``, it never touches a working tree the
    caller might still be using.
    """
    result: dict = {
        "collected": 0, "passed": 0, "failed": 0, "errors": 0, "xfailed": 0,
        "node_ids": {}, "measurement_failure": False, "failure_reason": "",
    }

    ok, msg = _assert_import_shadow(tree_dir, test_file, python_bin)
    if not ok:
        result["measurement_failure"] = True
        result["failure_reason"] = msg
        return result

    tree_abs = tree_dir.resolve()
    timeout_available = _pytest_timeout_available()
    cmd = [
        python_bin, "-m", "pytest", "-q", "--tb=no", "-rA", "--no-header",
        # --color=no is load-bearing: _NODE_STATUS_RE anchors on ^FAILED/^PASSED, and a
        # FORCE_COLOR/PY_COLORS environment makes pytest emit ANSI-prefixed summary lines
        # even when captured — counts still parse, node ids silently vanish.
        "--color=no",
        "-p", "no:cacheprovider",
        f"--confcutdir={tree_abs}",
        f"--rootdir={tree_abs}",
    ]
    if timeout_available and max_seconds:
        cmd.append(f"--timeout={int(max_seconds)}")
    cmd.append(test_file)

    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(tree_dir) + (os.pathsep + existing if existing else "")

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(tree_dir),
            env=env,
            capture_output=True,
            text=True,
            timeout=(max_seconds if max_seconds else None),
        )
    except subprocess.TimeoutExpired:
        result["measurement_failure"] = True
        result["failure_reason"] = f"pytest timed out after {max_seconds}s measuring {test_file}"
        return result
    except OSError as e:
        result["measurement_failure"] = True
        result["failure_reason"] = f"could not launch pytest for {test_file}: {e}"
        return result

    parsed = _parse_pytest_output(proc.stdout, proc.stderr)
    result.update(
        collected=parsed["collected"],
        passed=parsed["passed"],
        failed=parsed["failed"],
        errors=parsed["errors"],
        xfailed=parsed["xfailed"],
        node_ids=parsed["node_ids"],
    )

    if result["collected"] == 0:
        result["measurement_failure"] = True
        result["failure_reason"] = (
            f"pytest collected 0 items for {test_file} (rc={proc.returncode}) -- "
            "treated as measurement_failure, never as '0 failed' (R2 / §3.2 property 3). "
            f"stderr tail: {proc.stderr.strip()[-500:]}"
        )
    elif result["errors"]:
        # A collection/setup ERROR is NOT a measurement. It must never be read
        # as "0 failed", and the `collected == 0` guard above structurally
        # CANNOT catch it: pytest's summary for a collection error is
        # "1 error in 0.01s", so collected == sum(outcomes) == 1, not 0.
        #
        # Observed fail-open this closes (probe, 2026-08-10): base = 2 passed,
        # head = collection error from a missing third-party import, and the
        # measurement returned measurement_failure=False, newly_failing=[],
        # delta_failed=0 -- i.e. two tests stopped running entirely and it read
        # as CLEAN. The import-shadow preflight only covers packages that both
        # the test file imports AND exist locally under the tree, so an error
        # from anything else (absent third-party module, syntax error, a
        # conftest raising at collection) sails past it. Third door onto the
        # same fail-open-wearing-a-valid-shape class as R1/R2.
        result["measurement_failure"] = True
        result["failure_reason"] = (
            f"pytest reported {result['errors']} error(s) for {test_file} "
            f"(rc={proc.returncode}) -- an error means these tests did not RUN, so the "
            "counts are not a measurement; failing closed rather than reporting "
            f"'{result['failed']} failed'. errored: "
            f"{', '.join(result['node_ids'].get('ERROR', [])) or '(unnamed)'}. "
            f"stderr tail: {proc.stderr.strip()[-500:]}"
        )
    return result


def measure_file(
    base_dir: Path,
    head_dir: Path,
    test_file: str,
    *,
    max_seconds: float | None = None,
    python_bin: str | None = None,
) -> FileMeasurement:
    """Measure the base/head pytest delta for exactly one test file (§3.2).

    ``base_dir``/``head_dir`` are plain directory trees -- same contract as
    ``resolve_test_scope`` -- so a real git base/head pair (materialized
    once by the CLI's ``measure`` subcommand) and the AC-4 fixture's static
    ``base/``/``head/`` directories are both first-class callers. Runs
    pytest exactly twice (once per tree), each fully isolated from the
    other, and diffs the failing node-id SETS -- not just counts, since a
    file can hold the same failure count with a different failure set.
    """
    base_dir = Path(base_dir)
    head_dir = Path(head_dir)
    python_bin = python_bin or sys.executable

    base = _run_pytest_one_file(base_dir, test_file, max_seconds=max_seconds, python_bin=python_bin)
    head = _run_pytest_one_file(head_dir, test_file, max_seconds=max_seconds, python_bin=python_bin)

    if base["measurement_failure"] or head["measurement_failure"]:
        reasons = [r for r in (base.get("failure_reason"), head.get("failure_reason")) if r]
        return FileMeasurement(
            file=test_file,
            measurement_failure=True,
            failure_reason=" | ".join(reasons),
            pytest_timeout_available=_pytest_timeout_available(),
        )

    base_failed_ids = set(base["node_ids"].get("FAILED", []))
    head_failed_ids = set(head["node_ids"].get("FAILED", []))
    newly_failing = sorted(head_failed_ids - base_failed_ids)

    # A node that was collected at base and is absent at head ran NOWHERE at
    # head, so it can carry no signal -- and its absence subtracts from
    # `failed`, which is exactly how a disappearance can look like an
    # improvement. Deleting a test is legitimate, so this is DISCLOSED rather
    # than failed-closed; what is not acceptable is for it to be silent.
    def _all_ids(run: dict) -> set[str]:
        return {nid for ids in run["node_ids"].values() for nid in ids}

    disappeared = sorted(_all_ids(base) - _all_ids(head))
    collected_regression = head["collected"] < base["collected"] or bool(disappeared)
    notes: list[str] = []
    if collected_regression:
        notes.append(
            f"collected {base['collected']} node(s) at base and {head['collected']} at head"
            + (f"; {len(disappeared)} stopped being collected" if disappeared else "")
            + " -- a test that no longer runs cannot evidence an AC, and its absence "
            "lowers the `failed` count, so this is reported rather than netted out"
        )

    return FileMeasurement(
        file=test_file,
        collected_regression=collected_regression,
        disappeared_node_ids=disappeared,
        notes=notes,
        base_collected=base["collected"],
        base_passed=base["passed"],
        base_failed=base["failed"],
        base_errors=base["errors"],
        base_xfailed=base["xfailed"],
        head_collected=head["collected"],
        head_passed=head["passed"],
        head_failed=head["failed"],
        head_errors=head["errors"],
        head_xfailed=head["xfailed"],
        newly_failing_node_ids=newly_failing,
        pytest_timeout_available=_pytest_timeout_available(),
    )


# ---------------------------------------------------------------------------
# Phase 2 — cleanup guard for a baseline measurement worktree (§3.2, risk R6).
# Refuses, never widens --force. Confined to .claude/worktrees/gate-baseline-*.
# ---------------------------------------------------------------------------
#
# Widened (see `_default_workdir`) to also confine to the new anchored
# default location -- `<git-common-dir>/aos-validation-scope/validation-scope-
# <sha12>` -- alongside the original `.claude/worktrees/gate-baseline-<sha>`
# shape. Both alternatives require the SAME specific parent-directory name
# this module itself creates (`gate-baseline-` under `.claude/worktrees`, or
# `validation-scope-` under a directory literally named
# `aos-validation-scope`) -- this is additive, not a general "any
# validation-scope-* basename anywhere" relaxation, so guard 1 still refuses
# to touch a directory this module did not create the shape of. A custom
# `--workdir` override that names its parent directory something else falls
# outside both alternatives and cleanup is refused (non-fatal), never forced.
_BASELINE_WT_RE = re.compile(
    r"(^|/)\.claude/worktrees/gate-baseline-[0-9a-f]{6,}$"
    r"|(^|/)aos-validation-scope/validation-scope-[0-9a-f]{6,}$"
)


def _cleanup_baseline_worktree(repo: Path, wt: Path) -> tuple[bool, str]:
    """Remove a detached baseline measurement worktree -- ONLY when all three
    R6 guards hold. A guard failing is a refusal, never a wider --force.
    """
    wt_resolved = wt.resolve()
    repo_resolved = repo.resolve()

    if not _BASELINE_WT_RE.search(wt_resolved.as_posix()):
        return False, (
            f"refusing cleanup: {wt_resolved} is not a confined "
            ".claude/worktrees/gate-baseline-<sha> path (R6 guard 1)"
        )
    if wt_resolved == repo_resolved:
        return False, "refusing cleanup: resolved path is the repo root (R6 guard 3)"
    if wt_resolved == Path.cwd().resolve():
        return False, (
            "refusing cleanup: resolved path is the caller's own cwd -- "
            "never operate on the caller's own worktree (R6 guard 3)"
        )

    status_proc = subprocess.run(
        ["git", "-C", str(wt_resolved), "status", "--porcelain"],
        capture_output=True, text=True, check=False,
    )
    if status_proc.returncode != 0:
        return False, (
            f"refusing cleanup: `git status --porcelain` failed in {wt_resolved}: "
            f"{status_proc.stderr.strip()}"
        )
    if status_proc.stdout.strip():
        return False, (
            f"refusing cleanup: {wt_resolved} has uncommitted changes (R6 guard 2):\n"
            f"{status_proc.stdout}"
        )

    remove_proc = subprocess.run(
        ["git", "-C", str(repo_resolved), "worktree", "remove", "--force", str(wt_resolved)],
        capture_output=True, text=True, check=False,
    )
    if remove_proc.returncode != 0:
        return False, f"cleanup failed: {remove_proc.stderr.strip()}"
    return True, f"removed {wt_resolved}"


# ---------------------------------------------------------------------------
# CLI — real-repo entry point. Materializes git refs to on-disk trees, then
# defers to resolve_test_scope(). Subcommand shape is deliberately additive:
# "resolve" (Phase 1) and "measure" (Phase 2) are siblings; neither modifies
# the other.
# ---------------------------------------------------------------------------
def _git_common_dir(repo: Path) -> Path:
    """Absolute path to the MAIN repo's shared `.git` directory -- resolved
    correctly even when `repo` is itself a linked worktree, since
    `git rev-parse --git-common-dir` returns the shared `.git`, never the
    worktree's own `.git` file/`.git/worktrees/<name>` sub-path.

    Resolved against `repo` before returning: from the MAIN checkout this
    prints the bare relative string ".git", not an absolute path, so a
    caller that joined onto it blindly from a different cwd would get a
    silently-wrong location.
    """
    out = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--git-common-dir"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    common = Path(out)
    if not common.is_absolute():
        common = (repo / common).resolve()
    return common


def _default_workdir(repo: Path) -> Path:
    """Where `--base-ref` worktrees are materialized when `--workdir` is not
    given -- ANCHORED OUTSIDE any linked worktree.

    The prior default (`.claude/worktrees`, resolved against cwd) is the
    root cause this function exists to fix: when cwd is itself a linked
    worktree (e.g. `.claude/worktrees/exec-foo`, the default lane for
    execute-plan/autopilot/execute-contract), that relative default
    resolves to `<that worktree>/.claude/worktrees`, nesting the newly
    materialized base checkout INSIDE the head tree being diffed. Every
    file in the nested base checkout then reads as "changed" (present in
    head_map, absent from base_map), producing a whole-repo scope instead
    of the actual few-file diff.

    Anchoring on the main repo's shared `.git` directory (via
    `_git_common_dir`, which resolves correctly from inside a worktree)
    means the base checkout can never land inside ANY worktree, head or
    otherwise -- it is a sibling of every worktree, not a descendant of one.
    """
    return _git_common_dir(repo) / "aos-validation-scope"


def _materialize_ref(repo: Path, ref: str, workdir: Path) -> Path:
    """Detached, SHA-pinned checkout of `ref` from `repo` under `workdir`.

    Mirrors the mechanism §3.2 specifies for baseline measurement (`git worktree add
    --detach <SHA>`, never `EnterWorktree` -- see worktree-isolation-lane.md and
    `.claude/rules/`), used here only to obtain the base tree's *content* for AST
    symbol extraction. Phase 2 owns the fuller measurement-worktree contract
    (PYTHONPATH assertion, collected>0 assertion); this is the lighter subset that
    scope resolution alone needs.
    """
    sha = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", ref], capture_output=True, text=True, check=True
    ).stdout.strip()
    wt = workdir / f"validation-scope-{sha[:12]}"
    if not wt.exists():
        subprocess.run(
            ["git", "-C", str(repo), "worktree", "add", "--detach", str(wt), sha],
            check=True,
            capture_output=True,
            text=True,
        )
    actual = subprocess.run(
        ["git", "-C", str(wt), "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()
    if actual != sha:
        raise RuntimeError(f"materialized worktree HEAD {actual} != requested {sha} (fail-closed)")
    return wt


class _Parser(argparse.ArgumentParser):
    """Usage errors exit 1, never 2 -- mirrors mode_d_scan.py's rationale: this
    module has no correctness-gate exit code of its own today, but keeping the
    convention consistent avoids a future gate exit code colliding with a typo'd
    flag's exit status."""

    def error(self, message: str) -> None:  # type: ignore[override]
        self.print_usage(sys.stderr)
        print(f"[validation-scope] usage error: {message}", file=sys.stderr)
        raise SystemExit(1)


def _build_parser() -> argparse.ArgumentParser:
    ap = _Parser(
        prog="validation_scope.py",
        description="Symbol-scoped test-scope resolution for the reviewer gate.",
    )
    sub = ap.add_subparsers(dest="command", required=True)

    resolve = sub.add_parser("resolve", help="resolve the symbol-scoped test scope")
    tree_src = resolve.add_mutually_exclusive_group(required=True)
    tree_src.add_argument("--base-dir", help="base tree directory (fixture / already-checked-out mode)")
    tree_src.add_argument("--base-ref", help="git ref to materialize as the base tree")
    resolve.add_argument("--head-dir", help="head tree directory (default: --repo, or cwd)")
    resolve.add_argument("--repo", default=".", help="repo root, used with --base-ref (default: cwd)")
    resolve.add_argument(
        "--workdir",
        default=None,
        help=(
            "where to materialize --base-ref worktrees "
            "(default: <git-common-dir>/aos-validation-scope, anchored "
            "outside any linked worktree so a run from inside "
            ".claude/worktrees/<name> never nests the base checkout inside "
            "the head tree)"
        ),
    )
    resolve.add_argument("--max-fanout", type=int, default=None)
    resolve.add_argument("--max-test-files", type=int, default=None)
    resolve.add_argument("--max-seconds", type=float, default=None)
    resolve.add_argument("--json", action="store_true", help="emit the structured contract")

    measure = sub.add_parser(
        "measure", help="measure the base/head pytest delta for one test file (§3.2, AC-2)"
    )
    measure_src = measure.add_mutually_exclusive_group(required=True)
    measure_src.add_argument("--base-dir", help="base tree directory (fixture / already-checked-out mode)")
    measure_src.add_argument("--base-ref", help="git ref to materialize (detached, SHA-pinned) as the base tree")
    measure.add_argument("--head-dir", help="head tree directory (default: --repo, or cwd)")
    measure.add_argument("--repo", default=".", help="repo root, used with --base-ref (default: cwd)")
    measure.add_argument(
        "--workdir",
        default=None,
        help=(
            "where to materialize --base-ref worktrees "
            "(default: <git-common-dir>/aos-validation-scope, anchored "
            "outside any linked worktree)"
        ),
    )
    measure.add_argument("--file", required=True, help="test file path, relative to both trees")
    measure.add_argument("--max-seconds", type=float, default=None, help="per-invocation pytest timeout")
    measure.add_argument(
        "--cleanup",
        action="store_true",
        help="remove the --base-ref baseline worktree after measuring (R6-guarded; refuses rather than widening --force)",
    )
    measure.add_argument("--json", action="store_true", help="emit the structured contract")

    return ap


def _cmd_resolve(args: argparse.Namespace) -> int:
    repo = Path(args.repo)
    baseline_wt: Path | None = None
    if args.base_dir:
        base_dir = Path(args.base_dir)
    else:
        workdir = Path(args.workdir) if args.workdir else _default_workdir(repo)
        workdir.mkdir(parents=True, exist_ok=True)
        try:
            base_dir = _materialize_ref(repo, args.base_ref, workdir)
            baseline_wt = base_dir
        except (subprocess.CalledProcessError, RuntimeError) as e:
            print(f"[validation-scope] could not materialize base ref {args.base_ref!r}: {e}", file=sys.stderr)
            return 1

    head_dir = Path(args.head_dir) if args.head_dir else Path(args.repo)

    rc = 0
    try:
        result = resolve_test_scope(
            base_dir=base_dir,
            head_dir=head_dir,
            max_fanout=args.max_fanout,
            max_test_files=args.max_test_files,
            max_seconds=args.max_seconds,
        )
    except ValueError as e:
        # Containment failure (base/head nested) or any other resolution-time
        # refusal -- fail closed, never fabricate a scope. Cleanup below still
        # runs for whatever this invocation materialized (AC4 applies
        # regardless of whether resolution itself succeeded).
        print(f"[validation-scope] refusing to resolve: {e}", file=sys.stderr)
        rc = 1
        result = None

    if result is not None:
        if args.json:
            print(json.dumps(result.as_dict(), indent=2))
        else:
            print(f"[validation-scope] scope_status={result.scope_status} "
                  f"test_scope={len(result.test_scope)} files "
                  f"changed_symbols={len(result.changed_symbols)} "
                  f"scope_truncated={result.scope_truncated} "
                  f"budget_exhausted={result.budget_exhausted}")
            for f in result.test_scope:
                syms = ", ".join(result.matched_symbols.get(f, []))
                print(f"  {f}  <- {syms}")

    if baseline_wt is not None:
        # Only ever cleans up a worktree THIS invocation materialized via
        # --base-ref -- never when the caller passed --base-dir directly
        # (baseline_wt stays None on that path, see above). Best-effort:
        # a refused/failed cleanup is disclosed on stderr, never turned into
        # a nonzero exit of its own (mirrors _cmd_measure's --cleanup path).
        _removed, msg = _cleanup_baseline_worktree(repo, baseline_wt)
        print(f"[validation-scope] cleanup: {msg}", file=sys.stderr)

    return rc


def _cmd_measure(args: argparse.Namespace) -> int:
    repo = Path(args.repo)
    baseline_wt: Path | None = None
    if args.base_dir:
        base_dir = Path(args.base_dir)
    else:
        workdir = Path(args.workdir) if args.workdir else _default_workdir(repo)
        workdir.mkdir(parents=True, exist_ok=True)
        try:
            # Reuses the same detached, SHA-pinned mechanism resolve_test_scope's
            # --base-ref path uses (§3.2: rev-parse ONCE, `git worktree add
            # --detach`, verify HEAD == the resolved SHA, abort on mismatch).
            base_dir = _materialize_ref(repo, args.base_ref, workdir)
            baseline_wt = base_dir
        except (subprocess.CalledProcessError, RuntimeError) as e:
            print(f"[validation-scope] could not materialize base ref {args.base_ref!r}: {e}", file=sys.stderr)
            return 1

    head_dir = Path(args.head_dir) if args.head_dir else repo

    result = measure_file(
        base_dir=base_dir,
        head_dir=head_dir,
        test_file=args.file,
        max_seconds=args.max_seconds,
    )

    if args.json:
        print(json.dumps(result.as_dict(), indent=2))
    else:
        print(
            f"[validation-scope] file={result.file} "
            f"measurement_failure={result.measurement_failure} "
            f"base={result.base_passed}p/{result.base_failed}f "
            f"head={result.head_passed}p/{result.head_failed}f "
            f"delta_failed={result.head_failed - result.base_failed} "
            f"newly_failing={len(result.newly_failing_node_ids)}"
        )
        for nid in result.newly_failing_node_ids:
            print(f"  + {nid}")
        if result.measurement_failure:
            print(f"  reason: {result.failure_reason}", file=sys.stderr)

    if args.cleanup and baseline_wt is not None:
        _removed, msg = _cleanup_baseline_worktree(repo, baseline_wt)
        print(f"[validation-scope] cleanup: {msg}", file=sys.stderr)
        # Cleanup is best-effort disclosure, not a correctness gate of its
        # own -- a refused cleanup (R6 guard tripped) never turns a
        # successful measurement into a nonzero exit; it is logged loudly
        # instead. See _cleanup_baseline_worktree's docstring: a refusal
        # here is deliberate, never a wider --force.

    return 0


def main(argv: list[str] | None = None) -> int:
    ap = _build_parser()
    args = ap.parse_args(argv)
    if args.command == "resolve":
        return _cmd_resolve(args)
    if args.command == "measure":
        return _cmd_measure(args)
    ap.error(f"unknown command {args.command!r}")  # pragma: no cover - argparse guards this
    return 1


if __name__ == "__main__":
    sys.exit(main())
