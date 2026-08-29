from __future__ import annotations

import importlib.util
import re
import json
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = SKILL_ROOT / "scripts" / "delivery_report.py"
SPEC = importlib.util.spec_from_file_location("delivery_report", SCRIPT)
assert SPEC and SPEC.loader
dr = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dr)

EXAMPLES = SKILL_ROOT / "examples"


def load(name: str) -> dict:
    return json.loads((EXAMPLES / name).read_text(encoding="utf-8"))


class FeatureRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = load("feature.example.json")

    def test_validates_and_renders_self_contained(self) -> None:
        errors, warnings = dr.validate_manifest(self.data, EXAMPLES)
        self.assertEqual([], errors)
        self.assertEqual([], warnings)
        out = dr.render_report(self.data, EXAMPLES)
        self.assertIn("route-feature", out)
        self.assertIn("<svg", out)
        self.assertIn("Content-Security-Policy", out)
        self.assertEqual([], dr.validate_html(out))
        self.assertNotRegex(out, r'<(?:script|img)[^>]+src=["\']https?://')

    def test_eligibility_required_tier2(self) -> None:
        result = dr.eligibility(self.data)
        self.assertEqual("required", result["decision"])

    def test_unknown_evidence_reference_fails(self) -> None:
        self.data["value_adds"][0]["evidence_refs"] = ["missing"]
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("unknown evidence id" in e for e in errors))

    def test_both_themes_present(self) -> None:
        out = dr.render_report(self.data, EXAMPLES)
        self.assertIn('data-theme="dark"', out)
        self.assertIn('data-theme="light"', out)
        self.assertIn("prefers-color-scheme: dark", out)
        self.assertIn("theme-toggle", out)

    def test_draft_banner_on_nonfinal_truth(self) -> None:
        self.data["report"]["truth_status"] = "partially_verified"
        out = dr.render_report(self.data, EXAMPLES)
        self.assertIn("DRAFT", out)

    def test_bare_string_followup_warns(self) -> None:
        self.data["followups"] = ["just a string"]
        _, warnings = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("promote to a handoff object" in w for w in warnings))


class StatusRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = load("program-status.example.json")

    def test_validates_and_renders_self_contained(self) -> None:
        errors, warnings = dr.validate_manifest(self.data, EXAMPLES)
        self.assertEqual([], errors)
        self.assertEqual([], warnings)
        out = dr.render_report(self.data, EXAMPLES)
        self.assertIn("route-status", out)
        self.assertIn("table class=\"flow\"", out)   # activity flowsheet
        self.assertIn("class=\"tracks\"", out)         # two-track ladder
        self.assertIn("Copy handoff", out)             # per-item handoff
        self.assertEqual([], dr.validate_html(out))

    def test_deterministic_render(self) -> None:
        a = dr.render_report(self.data, EXAMPLES)
        b = dr.render_report(self.data, EXAMPLES)
        self.assertEqual(a, b)

    def test_status_report_is_on_demand(self) -> None:
        self.assertEqual("on_demand", dr.eligibility(self.data)["decision"])

    def test_vital_without_measured_by_fails(self) -> None:
        self.data["vitals"][0].pop("measured_by", None)
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("measured_by" in e for e in errors))

    def test_deferred_without_trigger_fails(self) -> None:
        for item in self.data["items"]:
            if item["kind"] == "deferred":
                item["handoff"].pop("trigger", None)
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("no re-entry trigger" in e for e in errors))

    def test_blocked_external_with_command_fails(self) -> None:
        for item in self.data["items"]:
            if item["kind"] == "blocked_external":
                item["handoff"]["command"] = "/plan-feature"
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("must be null for blocked_external" in e for e in errors))

    def test_domain_outside_vocabulary_fails(self) -> None:
        self.data["items"][0]["domains"] = ["Nonsense"]
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("absent from the closed vocabulary" in e for e in errors))

    def test_flowsheet_column_mismatch_fails(self) -> None:
        self.data["visuals"]["flowsheet"]["rows"][0]["cells"] = [1, 2]
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("cells but" in e for e in errors))


class HandoffFilesystemTests(unittest.TestCase):
    """Existence-check + grep-verify only fire when the repo is present on disk."""

    def _program_pointing_at(self, repo: str) -> dict:
        data = load("program-status.example.json")
        data["report"]["generated_from"]["repo"] = repo
        for item in data["items"]:
            if item.get("handoff"):
                item["handoff"]["repo"] = repo
        return data

    def test_missing_path_fails_when_repo_present(self) -> None:
        data = self._program_pointing_at(str(SKILL_ROOT))
        for item in data["items"]:
            if item.get("handoff"):
                item["handoff"]["paths"] = ["NOPE-does-not-exist.md"]
        errors, _ = dr.validate_manifest(data, EXAMPLES)
        self.assertTrue(any("path not found at render time" in e for e in errors))

    def test_present_path_passes(self) -> None:
        data = self._program_pointing_at(str(SKILL_ROOT))
        for item in data["items"]:
            if item.get("handoff"):
                item["handoff"]["paths"] = ["SPEC.md"]
                item["handoff"]["requirement_ids"] = []
        errors, _ = dr.validate_manifest(data, EXAMPLES)
        self.assertEqual([], [e for e in errors if "path not found" in e])

    def test_bogus_requirement_id_fails_when_repo_present(self) -> None:
        data = self._program_pointing_at(str(SKILL_ROOT))
        for item in data["items"]:
            if item.get("handoff"):
                item["handoff"]["paths"] = ["SPEC.md"]
                item["handoff"]["requirement_ids"] = ["ZZ-9999-not-real"]
        errors, _ = dr.validate_manifest(data, EXAMPLES)
        self.assertTrue(any("not grep-present" in e for e in errors))

    def test_checks_skipped_when_repo_absent(self) -> None:
        # committed example uses a placeholder repo path => checks skip, manifest is clean.
        data = load("program-status.example.json")
        errors, warnings = dr.validate_manifest(data, EXAMPLES)
        self.assertEqual([], errors)
        self.assertEqual([], warnings)


class MediaSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = load("feature.example.json")

    def test_sensitive_media_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "shot.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
            self.data["media"] = [{"type": "screenshot", "path": "shot.svg", "alt": "UI",
                                   "caption": "The app.", "sensitive": True}]
            errors, _ = dr.validate_manifest(self.data, root)
            self.assertTrue(any("marked sensitive" in e for e in errors))

    def test_asset_escape_fails(self) -> None:
        self.data["media"] = [{"type": "illustration", "path": "../SPEC.md", "alt": "x",
                               "caption": "y", "provider": "gemini-cli"}]
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("escapes asset root" in e for e in errors))

    def test_local_media_embedded_as_data_uri(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "shot.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', encoding="utf-8")
            self.data["media"] = [{"type": "illustration", "path": "shot.svg", "alt": "flow",
                                   "caption": "Generated; not a screenshot.", "provider": "gemini-cli"}]
            out = dr.render_report(self.data, root)
            self.assertIn("data:image/svg+xml;base64,", out)


class DossierRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = load("dossier.example.json")

    def test_validates_and_renders_self_contained(self) -> None:
        errors, warnings = dr.validate_manifest(self.data, EXAMPLES)
        self.assertEqual([], errors)
        self.assertEqual([], warnings)
        out = dr.render_report(self.data, EXAMPLES)
        self.assertIn("route-dossier", out)
        self.assertIn('class="stages"', out)          # stage timeline
        self.assertIn("oq-grid", out)                  # open-question panel
        self.assertIn("dec-log", out)                  # decision log
        self.assertIn("You are here", out)             # active-stage "you are here"
        self.assertIn("Copy handoff", out)             # open-item handoff
        self.assertIn("data:image/png;base64,", out)   # inline screenshot
        self.assertEqual([], dr.validate_html(out))
        self.assertNotRegex(out, r'<(?:script|img)[^>]+src=["\']https?://')

    def test_deterministic_render(self) -> None:
        self.assertEqual(dr.render_report(self.data, EXAMPLES), dr.render_report(self.data, EXAMPLES))

    def test_draft_banner_on_nonfinal_truth(self) -> None:
        # example is partially_verified => a visible DRAFT banner and the active stage surfaces.
        out = dr.render_report(self.data, EXAMPLES)
        self.assertIn("DRAFT", out)
        self.assertIn("Silent-refresh transport", out)  # the active (phase-2) stage

    def test_dossier_is_on_demand_not_tier_gated(self) -> None:
        self.data["report_policy"].pop("explicit_request", None)
        self.assertEqual("on_demand", dr.eligibility(self.data)["decision"])

    def test_empty_stages_fails(self) -> None:
        self.data["stages"] = []
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("at least one lifecycle stage" in e for e in errors))

    def test_duplicate_stage_id_fails(self) -> None:
        self.data["stages"][1]["id"] = self.data["stages"][0]["id"]
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("duplicate stage id" in e for e in errors))

    def test_bad_stage_kind_fails(self) -> None:
        self.data["stages"][0]["kind"] = "invent"
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("kind must be one of" in e for e in errors))

    def test_bad_stage_state_fails(self) -> None:
        self.data["stages"][0]["state"] = "in_progress"
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("state must be one of" in e for e in errors))

    def test_answered_oq_without_answer_fails(self) -> None:
        for oq in self.data["open_questions"]:
            if oq["id"] == "oq-2":
                oq["answer"] = None
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("marked answered but carries no answer" in e for e in errors))

    def test_bad_oq_status_fails(self) -> None:
        self.data["open_questions"][0]["status"] = "maybe"
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("status must be one of" in e for e in errors))

    def test_malformed_decision_fails(self) -> None:
        self.data["decisions"][0]["decision"] = ""
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any(".decision is required" in e for e in errors))

    def test_unknown_stage_evidence_ref_fails(self) -> None:
        self.data["stages"][0]["evidence_refs"] = ["nope"]
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("unknown evidence id" in e for e in errors))

    def test_deferred_item_without_trigger_fails(self) -> None:
        for item in self.data["items"]:
            if item["kind"] == "deferred":
                item["handoff"].pop("trigger", None)
        errors, _ = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("no re-entry trigger" in e for e in errors))

    def test_blocking_oq_without_channel_warns(self) -> None:
        for oq in self.data["open_questions"]:
            if oq["id"] == "oq-1":
                oq.pop("channel", None)
        _, warnings = dr.validate_manifest(self.data, EXAMPLES)
        self.assertTrue(any("blocking but has no channel" in w for w in warnings))


class CliTests(unittest.TestCase):
    def test_init_render_validate_export_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "report.json"
            self.assertEqual(0, dr.main([
                "init", "--route", "program", "--title", "T", "--subject", "s", "--out", str(manifest)]))
            # skeleton has TODO handoffs pointing at a placeholder repo => checks skip; still valid shape
            data = json.loads(manifest.read_text())
            data["report"].pop("generated_from", None)
            manifest.write_text(json.dumps(data))
            html = root / "index.html"
            self.assertEqual(0, dr.main(["render", "--manifest", str(manifest),
                                         "--asset-root", str(root), "--out", str(html)]))
            self.assertTrue(html.is_file())
            self.assertEqual(0, dr.main(["validate", "--manifest", str(manifest),
                                         "--asset-root", str(root), "--html", str(html)]))
            export = root / "wb.json"
            self.assertEqual(0, dr.main(["export", "--manifest", str(manifest),
                                         "--target", "intenttree", "--out", str(export)]))
            self.assertTrue(export.is_file())

    def test_expect_route_mismatch_fails(self) -> None:
        code = dr.main(["validate", "--manifest", str(EXAMPLES / "feature.example.json"),
                        "--asset-root", str(EXAMPLES), "--expect-route", "program"])
        self.assertEqual(1, code)

    def test_init_dossier_skeleton_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / "report.json"
            self.assertEqual(0, dr.main([
                "init", "--route", "dossier", "--title", "T", "--subject", "s", "--out", str(manifest)]))
            data = json.loads(manifest.read_text())
            self.assertEqual("dossier", data["report"]["route"])
            self.assertTrue(data["stages"])
            self.assertTrue(data["open_questions"])
            self.assertTrue(data["decisions"])
            html = root / "index.html"
            self.assertEqual(0, dr.main(["render", "--manifest", str(manifest),
                                         "--asset-root", str(root), "--out", str(html)]))
            self.assertTrue(html.is_file())
            self.assertEqual(0, dr.main(["validate", "--manifest", str(manifest),
                                         "--asset-root", str(root), "--html", str(html),
                                         "--expect-route", "dossier"]))

    def test_dossier_expect_route_mismatch_fails(self) -> None:
        code = dr.main(["validate", "--manifest", str(EXAMPLES / "dossier.example.json"),
                        "--asset-root", str(EXAMPLES), "--expect-route", "program"])
        self.assertEqual(1, code)


class PythonFloorTests(unittest.TestCase):
    """The stated runtime floor is Python 3.10+ (SPEC Sec 6), and the agentic node runs 3.11.

    A backslash inside an f-string *expression* is legal only from 3.12 (PEP 701). One such
    literal made the whole CLI raise SyntaxError on import under 3.11 — silently disabling the
    dossier hooks on the node while every laptop test passed on 3.12. `ast.parse(feature_version=)`
    does NOT catch it (the tokenizer is always the running interpreter's), so the guard is lexical.
    """

    def test_no_backslash_inside_fstring_expressions(self) -> None:
        offenders: list[str] = []
        for lineno, line in enumerate(SCRIPT.read_text(encoding="utf-8").splitlines(), start=1):
            if not re.search(r"""(?<![A-Za-z0-9_])[fF][rR]?['"]""", line):
                continue
            # Scan only the {...} expression segments of the line.
            for expr in re.findall(r"\{([^{}]*)\}", line):
                if "\\" in expr:
                    offenders.append(f"{SCRIPT.name}:{lineno}: {line.strip()[:110]}")
                    break
        self.assertEqual(
            [], offenders,
            "backslash inside an f-string expression is a SyntaxError before Python 3.12 — "
            "hoist the value into a variable above the f-string:\n" + "\n".join(offenders),
        )


if __name__ == "__main__":
    unittest.main()
