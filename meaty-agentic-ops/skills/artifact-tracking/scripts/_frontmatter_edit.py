"""Targeted, format-preserving edits to a markdown file's YAML frontmatter.

WHY THIS EXISTS
---------------
The writer scripts in this directory used to mutate a parsed dict and then re-emit the
WHOLE frontmatter block through ``yaml.safe_dump``. A one-line status change therefore
produced a 29-insertion / 16-deletion diff, with five classes of regression in keys the
caller never named:

===========================  ===================================  ==============================
regression                   before                               after (round-trip)
===========================  ===================================  ==============================
non-ASCII escaped            ``title: "Doctrine v1 — rollout"``   ``title: "Doctrine v1 \\u2014 …"``
bare date requoted           ``created: 2026-07-30``              ``created: '2026-07-30'``
list indentation flattened   ``  - docs/foo.md``                  ``- docs/foo.md``
quoting/wrapping churn       ``  - "demotions land: …"``          ``- 'demotions land: … \\n  …'``
block scalar collapsed       ``note: >`` + indented lines         ``note: a folded scalar …``
===========================  ===================================  ==============================

Every one of those is valid YAML that parses back to an equivalent object, so no validator
catches them — but the diff stops being evidence. A reviewer cannot cheaply confirm that a
bookkeeping commit is only bookkeeping when the one intended line is buried in twenty lines
of formatting noise, and the escaped em-dash reaches every human- and HTML-facing surface
that renders the raw title.

So this module edits LINES, not a dict. Untouched keys are byte-identical after a write
because their lines are never re-emitted — a property held by construction, not by trusting
a serializer's options. This is the same approach ``validate-plan-frontmatter.py --apply``
already documents for the ``status:`` token; that logic stays where it is (it is a
single-key autofix with its own reporting), and this module is the general form the
multi-key writers share.

WHAT IS PRESERVED
-----------------
* Untouched lines: byte-identical, always.
* On a scalar-to-scalar ``set``: the spacing after ``key:``, the existing quote style, and
  any trailing ``# comment`` on that line.
* On ``append``: the existing block's item indentation, and flow style (``[a, b]`` stays
  flow rather than being expanded to a block list).
* On a new key or a new list: the file's own dominant list indentation, sniffed from the
  frontmatter itself rather than assumed.

NOT HANDLED (deliberately)
--------------------------
* Nested keys. ``set("a.b", …)`` sets a top-level key literally named ``a.b``, matching the
  dict-assignment semantics the callers always had.
* CRLF files, and files whose frontmatter does not open with exactly ``---\\n`` — these
  already fell through the callers' own extraction regex before this module existed.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

import yaml

__all__ = [
    "FrontmatterEditError",
    "FrontmatterEditor",
    "normalize_scalars",
]

# A column-0 mapping key. Keys in this corpus are identifiers; a quoted or otherwise exotic
# key simply does not match, and its line is then treated as opaque (a block boundary).
_TOP_KEY_RE = re.compile(r"^(?P<key>[A-Za-z_][A-Za-z0-9_.\-]*)[ \t]*:(?P<rest>.*)$")
_FM_RE = re.compile(r"^---\n(?P<fm>.*?)\n---\n?(?P<body>.*)$", re.DOTALL)
_SEQ_ITEM_RE = re.compile(r"^(?P<indent>[ \t]*)-(?:[ \t]|$)")
# `|`, `>`, `|-`, `>+`, `|2`, … — a value token that means "a block scalar follows".
_BLOCK_SCALAR_RE = re.compile(r"^[|>][+-]?\d*$")

_DEFAULT_SEQ_INDENT = 2


class FrontmatterEditError(ValueError):
    """A requested edit cannot be applied to this document."""


def normalize_scalars(value: Any) -> Any:
    """Recursively render dates/datetimes as ISO strings, for SCHEMA VALIDATION only.

    The schemas describe dates as strings, so a validation view needs this. It must never
    reach the write path: converting ``created: 2026-07-30`` to a string is exactly the
    round-trip that requoted it on disk.
    """
    if isinstance(value, dict):
        return {key: normalize_scalars(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize_scalars(item) for item in value]
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _split_value_and_comment(rest: str) -> Tuple[str, str, str]:
    """Split the text after ``key:`` into (leading whitespace, value token, suffix).

    ``suffix`` keeps trailing whitespace plus any inline ``# comment`` verbatim, so
    swapping a value cannot silently eat an annotation. Quote state is tracked, so a ``#``
    inside a quoted scalar is not mistaken for a comment.
    """
    quote = ""
    comment_at: Optional[int] = None
    i, n = 0, len(rest)
    while i < n:
        char = rest[i]
        if quote:
            if quote == '"' and char == "\\":
                i += 2
                continue
            if char == quote:
                if quote == "'" and i + 1 < n and rest[i + 1] == "'":
                    i += 2  # '' is an escaped quote inside a single-quoted scalar
                    continue
                quote = ""
        elif char in ("'", '"'):
            quote = char
        elif char == "#" and (i == 0 or rest[i - 1] in " \t"):
            comment_at = i
            break
        i += 1

    region = rest if comment_at is None else rest[:comment_at]
    comment = "" if comment_at is None else rest[comment_at:]

    token = region.strip()
    lead = region[: len(region) - len(region.lstrip())]
    trail = region[len(region.rstrip()):]
    return lead, token, trail + comment


def _detect_quote(token: str) -> str:
    if len(token) >= 2 and token[0] == token[-1] and token[0] in ("'", '"'):
        return token[0]
    return ""


def _is_flow_sequence(token: str) -> bool:
    return token.startswith("[") and token.endswith("]")


def _emit_key_lines(key: str, value: Any, seq_indent: int) -> List[str]:
    """Render ``key: value`` as frontmatter lines, correctly quoted and never wrapped.

    PyYAML is asked to serialize a ONE-KEY mapping, so all of its correctness (when a
    scalar needs quoting, how a nested map indents) is reused for the value being written
    while nothing else in the document is handed to the dumper. ``allow_unicode`` keeps an
    em-dash an em-dash; the enormous width disables the line wrapping that hard-wrapped
    long list items mid-string.
    """
    dumped = yaml.safe_dump(
        {key: value},
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
        width=10 ** 9,
    )
    lines = dumped.rstrip("\n").split("\n")

    if not lines or not lines[0].startswith(f"{key}:"):
        # An exotic key PyYAML chose to quote or reorder. Emit the key verbatim so we never
        # rename a caller's field, and let the dumped value follow inline.
        return [f"{key}: {yaml.safe_dump(value, allow_unicode=True, width=10 ** 9, default_flow_style=True).rstrip().rstrip('.').rstrip()}"]

    # PyYAML block-dumps sequences indentless (`key:\n- a`). Re-indent every continuation
    # line uniformly, which preserves relative structure for nested values too.
    if seq_indent and len(lines) > 1:
        pad = " " * seq_indent
        lines = [lines[0]] + [(pad + ln if ln.strip() else ln) for ln in lines[1:]]
    return lines


class FrontmatterEditor:
    """Line-level editor over one document's frontmatter."""

    def __init__(self, fm_lines: List[str], body: str) -> None:
        self._lines = fm_lines
        self._body = body

    # ---------------------------------------------------------------- construction
    @classmethod
    def from_text(cls, text: str) -> Optional["FrontmatterEditor"]:
        """Build an editor, or return None when *text* has no parseable frontmatter."""
        if not text.startswith("---\n"):
            return None
        match = _FM_RE.match(text)
        if not match:
            return None
        return cls(match.group("fm").split("\n"), match.group("body"))

    def frontmatter_text(self) -> str:
        return "\n".join(self._lines)

    def render(self) -> str:
        return f"---\n{self.frontmatter_text()}\n---\n{self._body}"

    def metadata(self) -> Any:
        """Parse the CURRENT lines. Callers validate this, so it cannot drift from disk.

        The trailing newline matters and is not cosmetic: a document whose LAST key is a
        folded/literal block scalar parses to a value with no trailing ``\\n`` when the text
        stops mid-line, and with one when it does not. On disk that line is always followed
        by ``\\n---``, so parsing without it would hand callers — and the schema validator —
        a value the file does not actually contain.
        """
        return yaml.safe_load(self.frontmatter_text() + "\n")

    # ------------------------------------------------------------------- internals
    def _iter_top_keys(self):
        """Yield (key, line_index) for every column-0 mapping key, skipping block bodies."""
        i = 0
        while i < len(self._lines):
            match = _TOP_KEY_RE.match(self._lines[i])
            if match:
                yield match.group("key"), i
                i = self._block_span(i)[1]
                continue
            i += 1

    def _find_key(self, key: str) -> Optional[int]:
        for found, index in self._iter_top_keys():
            if found == key:
                return index
        return None

    def _block_span(self, start: int) -> Tuple[int, int]:
        """Return the ``[start, end)`` line range owned by the top-level key at *start*.

        A following line belongs to the block when it is indented or is a column-0
        sequence item (``- x`` under an indentless list). Blank lines and column-0 comments
        are only absorbed when a genuinely owned line follows them — otherwise they are
        the spacing or section header that precedes the NEXT key, and stay put.
        """
        end = start + 1
        last_owned = end
        while end < len(self._lines):
            line = self._lines[end]
            if line.strip() == "" or line.lstrip().startswith("#"):
                end += 1                       # provisional: only kept if more follows
                continue
            if line[0] in (" ", "\t") or _SEQ_ITEM_RE.match(line):
                end += 1
                last_owned = end
                continue
            break
        return start, last_owned

    def _insertion_point(self) -> int:
        """Where a brand-new key goes: after the last real key line.

        Trailing blank lines and column-0 comments at the bottom of the block keep their
        place, matching how a dict append used to land before the closing ``---``.
        """
        index = len(self._lines)
        while index > 0:
            line = self._lines[index - 1]
            if line.strip() == "" or line.lstrip().startswith("#"):
                index -= 1
                continue
            break
        return index

    def _dominant_seq_indent(self) -> int:
        """Sniff the file's own list indentation, for a list this file does not have yet."""
        counts: Dict[int, int] = {}
        for line in self._lines:
            match = _SEQ_ITEM_RE.match(line)
            if match:
                width = len(match.group("indent").expandtabs(4))
                counts[width] = counts.get(width, 0) + 1
        if not counts:
            return _DEFAULT_SEQ_INDENT
        return max(counts.items(), key=lambda kv: (kv[1], -kv[0]))[0]

    def _seq_indent_of_block(self, start: int, end: int) -> Optional[int]:
        for line in self._lines[start + 1:end]:
            match = _SEQ_ITEM_RE.match(line)
            if match:
                return len(match.group("indent").expandtabs(4))
        return None

    def _item_line(self, value: Any, indent: int) -> str:
        """Render one sequence item at *indent*, reusing PyYAML for the value itself."""
        lines = _emit_key_lines("_", [value], indent)
        if len(lines) < 2:  # pragma: no cover - a one-element list always dumps a body
            raise FrontmatterEditError(f"cannot render list item {value!r}")
        return "\n".join(lines[1:])

    # ----------------------------------------------------------------- public edits
    def set(self, key: str, value: Any) -> None:
        """Set *key* to *value*, touching only that key's lines."""
        index = self._find_key(key)
        seq_indent = self._dominant_seq_indent()

        if index is None:
            self._lines[self._insertion_point():self._insertion_point()] = _emit_key_lines(
                key, value, seq_indent)
            return

        start, end = self._block_span(index)
        match = _TOP_KEY_RE.match(self._lines[start])
        assert match is not None  # _find_key only returns lines that matched
        lead, old_token, suffix = _split_value_and_comment(match.group("rest"))

        existing_seq_indent = self._seq_indent_of_block(start, end)
        new_lines = _emit_key_lines(
            key, value, existing_seq_indent if existing_seq_indent is not None else seq_indent)

        single_line_before = (end - start) == 1 and old_token != "" \
            and not _BLOCK_SCALAR_RE.match(old_token)
        if single_line_before and len(new_lines) == 1:
            # The common path (status, updated, planning_maturity): swap the value token and
            # keep this line's own spacing, quote style, and trailing comment.
            new_token = new_lines[0][len(key) + 1:].strip()
            quote = _detect_quote(old_token)
            if quote and not _detect_quote(new_token) and self._quotable(new_token, quote):
                new_token = f"{quote}{new_token}{quote}"
            self._lines[start] = f"{key}:{lead or ' '}{new_token}{suffix}"
            return

        self._lines[start:end] = new_lines

    @staticmethod
    def _quotable(token: str, quote: str) -> bool:
        """Whether *token* can be wrapped in *quote* without needing escapes."""
        if quote == "'":
            return "'" not in token
        return '"' not in token and "\\" not in token

    def append(self, key: str, value: Any) -> None:
        """Append *value* to the list at *key*, creating the list when absent."""
        index = self._find_key(key)

        if index is None:
            indent = self._dominant_seq_indent()
            at = self._insertion_point()
            self._lines[at:at] = [f"{key}:", self._item_line(value, indent)]
            return

        start, end = self._block_span(index)
        match = _TOP_KEY_RE.match(self._lines[start])
        assert match is not None
        lead, token, suffix = _split_value_and_comment(match.group("rest"))

        if _is_flow_sequence(token):
            # `tags: [a, b]` — keep it flow rather than expanding it to a block list.
            items = yaml.safe_load(token)
            if not isinstance(items, list):  # pragma: no cover - `[...]` always loads a list
                raise FrontmatterEditError(f"Field '{key}' is not a list; cannot append.")
            items.append(value)
            rendered = yaml.safe_dump(
                items, default_flow_style=True, allow_unicode=True, width=10 ** 9,
            ).rstrip("\n")
            if rendered.endswith("..."):  # PyYAML may append a document-end marker
                rendered = rendered[: -len("...")].rstrip("\n")
            self._lines[start] = f"{key}:{lead or ' '}{rendered}{suffix}"
            return

        if token != "" and not _BLOCK_SCALAR_RE.match(token):
            parsed = yaml.safe_load(token)
            if parsed is not None:
                raise FrontmatterEditError(f"Field '{key}' is not a list; cannot append.")

        last_item = None
        for offset in range(end - 1, start, -1):
            if _SEQ_ITEM_RE.match(self._lines[offset]):
                last_item = offset
                break

        if last_item is None:
            # `key:` with an empty/null value, or a block scalar being replaced by a list.
            indent = self._dominant_seq_indent()
            self._lines[start:end] = [f"{key}:{suffix}", self._item_line(value, indent)]
            return

        indent = self._seq_indent_of_block(start, end)
        self._lines.insert(
            last_item + 1,
            self._item_line(value, indent if indent is not None else self._dominant_seq_indent()),
        )
