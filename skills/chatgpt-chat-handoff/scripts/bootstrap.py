#!/usr/bin/env python3
"""Preview additive AGENTS.md / CLAUDE.md routers. --apply is explicit and conservative."""
from __future__ import annotations
import argparse
import difflib
import hashlib
import re
import sys
from pathlib import Path

START = "<!-- CGH:BEGIN chatgpt-chat-handoff -->"
END = "<!-- CGH:END chatgpt-chat-handoff -->"
BLOCK = f"""{START}
## ChatGPT Chat handoffs

For a local-agent handoff into ChatGPT Chat (images, Deep Research, web checks, Pro
review, data, visual QA or artifacts), load
`.claude/skills/chatgpt-chat-handoff/SKILL.md` and only the selected route.
Use the existing AOS packet authority where installed; this is its Chat-specific adapter.
Verify approved inputs, current UI capability needs, frozen constraints and output IDs.
Keep image generation separate from QA/export; ingest returns into quarantine only.
Do not route to Work/Codex, automate the browser, or claim registration/source uploads.
Do not hand-edit generated skill mirrors or overwrite human changes.
{END}
"""

class BootstrapError(ValueError):
    pass

def patched(text: str) -> str:
    newline = "\r\n" if "\r\n" in text else "\n"
    desired = BLOCK.replace("\n", newline)
    if re.search(r"(?mi)^\s*(?:<!--\s*)?(?:AUTO.?GENERATED|GENERATED FILE|DO NOT EDIT)\b", text):
        raise BootstrapError("Instruction file appears generated; change its owning compiler/source input instead")
    if text.count(START) != text.count(END) or text.count(START) > 1:
        raise BootstrapError("Malformed/duplicate managed block; review manually")
    if START in text:
        first = text.index(START)
        last = text.index(END, first) + len(END)
        existing = text[first:last].replace("\r\n", "\n")
        if existing != BLOCK.rstrip("\n"):
            raise BootstrapError("Managed block has hand edits; preserve and reconcile manually")
        return text
    separator = "" if not text else (newline if text.endswith(newline) else newline + newline)
    return text + separator + desired

def plan(target: Path) -> list[tuple[Path, bytes, bytes]]:
    target = target.resolve(strict=True)
    skill = target / ".claude/skills/chatgpt-chat-handoff/SKILL.md"
    if not skill.is_file():
        raise BootstrapError("Canonical skill is not staged here; finish duplicate/upstream decision and staging first")
    changes = []
    for name in ("AGENTS.md", "CLAUDE.md"):
        p = target / name
        if p.is_symlink():
            raise BootstrapError(f"Refusing symlink instruction file: {name}")
        before = p.read_bytes() if p.exists() else b""
        after = patched(before.decode("utf-8")).encode("utf-8")
        if before != after:
            changes.append((p, before, after))
    return changes

def apply(changes: list[tuple[Path, bytes, bytes]]) -> None:
    # All files have been checked before any writes. Check current bytes again.
    for p, before, _ in changes:
        actual = p.read_bytes() if p.exists() else b""
        if actual != before:
            raise BootstrapError(f"Concurrent instruction change: {p.name}")
    for p, before, after in changes:
        if p.exists():
            backup = p.with_name(p.name + ".cgh-backup-" + hashlib.sha256(before).hexdigest()[:12])
            if backup.exists() and backup.read_bytes() != before:
                raise BootstrapError("Backup collision; stop rather than overwrite")
            if not backup.exists():
                with backup.open("xb") as stream:
                    stream.write(before)
        p.write_bytes(after)

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        changes = plan(args.target)
        for p, before, after in changes:
            print("".join(difflib.unified_diff(before.decode().splitlines(True), after.decode().splitlines(True),
                  fromfile=str(p), tofile=str(p) + " (proposed)")), end="")
        if args.apply:
            apply(changes)
            print(f"Applied {len(changes)} additive router changes; no skill registration or account writes.")
        else:
            print(f"Dry run: {len(changes)} changes. Review before --apply.")
        return 0
    except (OSError, UnicodeError, BootstrapError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
