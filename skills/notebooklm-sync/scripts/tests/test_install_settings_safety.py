"""Regression tests for notebooklm-sync's install.py settings.json safety.

Guards against a destructive bug in ``patch_settings_json()``: an existing
``.claude/settings.json`` that failed to parse was silently treated as an empty
dict and then unconditionally overwritten, wiping every hook, permission block,
and unrelated key while exit status stayed 0.

This suite exists because the upstream copy of the skill was previously
unguarded: the fix landed only in a downstream consumer (skillmeat, PR #395),
so the next upstream -> downstream sync would have reverted it with nothing
here to notice. These tests are that guard.

Run with: ``pytest skills/notebooklm-sync/scripts/tests``

The installer is not an importable package, so the module is loaded by path.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest

# tests/ -> scripts/ -> install.py
INSTALL_PY = Path(__file__).resolve().parents[1] / "install.py"


def _load_install_module(path: Path, module_name: str) -> ModuleType:
    """Load install.py by path (it is not an importable package)."""
    spec = importlib.util.spec_from_file_location(module_name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


install_module = _load_install_module(INSTALL_PY, "notebooklm_install")
patch_settings_json = install_module.patch_settings_json
SettingsParseError = install_module.SettingsParseError
install = install_module.install


MALFORMED_JSON = '{"hooks": {"PostToolUse": [],}}'  # trailing comma


def test_malformed_settings_json_raises_and_is_not_overwritten(tmp_path):
    """Core regression: a malformed settings.json must never be touched."""
    settings_path = tmp_path / "settings.json"
    settings_path.write_bytes(MALFORMED_JSON.encode("utf-8"))
    original_bytes = settings_path.read_bytes()

    with pytest.raises(SettingsParseError):
        patch_settings_json(settings_path)

    assert settings_path.read_bytes() == original_bytes


def test_malformed_settings_json_surfaces_nonzero_exit(tmp_path):
    """The installer must surface the parse failure as a non-zero exit status,
    not just raise an exception that happens to have the right type."""
    settings_path = tmp_path / ".claude" / "settings.json"
    settings_path.parent.mkdir(parents=True)
    settings_path.write_bytes(MALFORMED_JSON.encode("utf-8"))
    original_bytes = settings_path.read_bytes()

    # Drive the real call-site path inside install(): payload copy + hook
    # install + patch_settings_json, using no_init to skip the subprocess.
    exit_code = install(
        project_name="demo",
        target_dir=tmp_path,
        no_init=True,
    )

    assert exit_code != 0
    assert settings_path.read_bytes() == original_bytes


def test_non_dict_top_level_json_raises_and_is_not_overwritten(tmp_path):
    """A syntactically valid but non-object top-level JSON value (e.g. a bare
    list) is also a parse-level failure and must not be overwritten."""
    settings_path = tmp_path / "settings.json"
    settings_path.write_bytes(b"[]")
    original_bytes = settings_path.read_bytes()

    with pytest.raises(SettingsParseError):
        patch_settings_json(settings_path)

    assert settings_path.read_bytes() == original_bytes


def test_happy_path_preserves_unknown_keys_and_appends_hook(tmp_path):
    """A valid settings.json carrying unrelated keys and an existing
    PostToolUse hook must keep everything and gain the NotebookLM hook
    appended to the array (not replacing it)."""
    settings_path = tmp_path / "settings.json"
    existing = {
        "permissions": {"allow": ["Bash(git status:*)"]},
        "env": {"SOME_VAR": "1"},
        "hooks": {
            "PreToolUse": [
                {
                    "matcher": "Bash",
                    "hooks": [{"type": "command", "command": "echo pre"}],
                }
            ],
            "PostToolUse": [
                {
                    "matcher": "Write",
                    "hooks": [{"type": "command", "command": "echo existing"}],
                }
            ],
        },
    }
    settings_path.write_text(json.dumps(existing, indent=2))

    changed = patch_settings_json(settings_path)
    assert changed is True

    result = json.loads(settings_path.read_text())
    assert result["permissions"] == existing["permissions"]
    assert result["env"] == existing["env"]
    assert result["hooks"]["PreToolUse"] == existing["hooks"]["PreToolUse"]

    post_tool_use = result["hooks"]["PostToolUse"]
    assert len(post_tool_use) == 2
    assert post_tool_use[0] == existing["hooks"]["PostToolUse"][0]
    commands = [
        h.get("command") for entry in post_tool_use for h in entry.get("hooks", [])
    ]
    assert any("notebooklm-sync-hook.sh" in (c or "") for c in commands)


def test_idempotent_second_call_returns_false_and_does_not_duplicate(tmp_path):
    """Calling patch_settings_json twice must not duplicate the hook entry."""
    settings_path = tmp_path / "settings.json"
    settings_path.write_text(json.dumps({}))

    first = patch_settings_json(settings_path)
    assert first is True

    after_first = json.loads(settings_path.read_text())
    post_tool_use_count = len(after_first["hooks"]["PostToolUse"])

    second = patch_settings_json(settings_path)
    assert second is False

    after_second = json.loads(settings_path.read_text())
    assert len(after_second["hooks"]["PostToolUse"]) == post_tool_use_count


def test_missing_settings_json_is_created_with_hook(tmp_path):
    """A settings.json that does not exist yet is created (not treated as an
    error) and gains the NotebookLM hook."""
    settings_path = tmp_path / "settings.json"
    assert not settings_path.exists()

    changed = patch_settings_json(settings_path)
    assert changed is True
    assert settings_path.exists()

    result = json.loads(settings_path.read_text())
    commands = [
        h.get("command")
        for entry in result["hooks"]["PostToolUse"]
        for h in entry.get("hooks", [])
    ]
    assert any("notebooklm-sync-hook.sh" in (c or "") for c in commands)


def test_dry_run_on_malformed_settings_json_reports_abort_not_success(tmp_path):
    """dry_run against a malformed settings.json must report the abort (raise)
    rather than pretending the dry-run succeeded."""
    settings_path = tmp_path / "settings.json"
    settings_path.write_bytes(MALFORMED_JSON.encode("utf-8"))
    original_bytes = settings_path.read_bytes()

    with pytest.raises(SettingsParseError):
        patch_settings_json(settings_path, dry_run=True)

    assert settings_path.read_bytes() == original_bytes


def test_interrupted_write_leaves_existing_settings_intact(tmp_path, monkeypatch):
    """The write must be atomic. If serialisation dies part-way through, the
    original settings.json must still be the original — not a truncated or
    empty file. A non-atomic `open(settings_path, "w")` truncates the real file
    before the first byte is written, so this is the only assertion that
    distinguishes the two implementations behaviourally."""
    settings_path = tmp_path / "settings.json"
    existing = {"permissions": {"allow": ["Bash(git status:*)"]}}
    settings_path.write_text(json.dumps(existing, indent=2))
    original_bytes = settings_path.read_bytes()

    def exploding_dump(*_args, **_kwargs):
        raise IOError("disk full, mid-dump")

    monkeypatch.setattr(install_module.json, "dump", exploding_dump)

    with pytest.raises(IOError):
        patch_settings_json(settings_path)

    assert settings_path.read_bytes() == original_bytes
    assert json.loads(settings_path.read_text()) == existing
