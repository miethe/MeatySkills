"""Tests for publish_report.py (M2, design contract D3/D4/D5).

Fully offline and deterministic: the itt CLI boundary is faked via the `runner` parameter every
itt-talking function threads through, and the atlas HTTP boundary (node_01M14WH846J90CXZHK1EEGH1G6
— upload happens over HTTP now, never a local subprocess) is faked via the `uploader` parameter
`atlas_ingest`/`publish` thread through. No real subprocess, no network, no live atlas/itt
instance required.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SKILL_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = SKILL_ROOT / "scripts" / "publish_report.py"
SPEC = importlib.util.spec_from_file_location("publish_report", SCRIPT)
assert SPEC and SPEC.loader
pr = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pr)


ATLAS_URL = "http://10.42.10.76:8042"
PROJECT_SLUG = "agentic-meta-dev"
ASSET_ID = "abc123"
PREVIEW_URL = f"{ATLAS_URL}/api/preview/asset/{ASSET_ID}/html"

# atlas_ingest() existence-checks html_path on the real filesystem before ever calling the (faked)
# uploader, so tests need a real file here — content is irrelevant since the actual HTTP calls are
# intercepted by FakeEnv.uploader.
_HTML_TMP = tempfile.NamedTemporaryFile(suffix=".html", delete=False)
_HTML_TMP.write(b"<html><body>report</body></html>")
_HTML_TMP.close()
HTML_PATH = Path(_HTML_TMP.name)


class FakeEnv:
    """Dispatches every subprocess.run-shaped call the engine makes, by inspecting argv.

    Models the REAL `itt` CLI's arg order deliberately strictly: `--json` is a GLOBAL option and
    MUST appear immediately after the binary, before the subcommand (`itt --json node get ID`).
    A prior round of this suite let `--json` appear anywhere, which is exactly why 30 passing
    tests missed `itt_get_node`/`itt_link_report` sending it in the wrong position (that shipped a
    guardrail that rejected every link, live). This fake now REJECTS the wrong order the same way
    the real CLI does (`Error: No such option '--json'`, exit 2) so the suite can never again pass
    with broken arg order — a fake that is more permissive than the real tool is a liability.
    """

    def __init__(self, *, nodes: dict[str, dict] | None = None, verb_available: bool = True,
                atlas_ok: bool = True, link_ok: bool = True, asset_id: str = ASSET_ID,
                url_status: int = 200):
        self.nodes = nodes or {}
        self.verb_available = verb_available
        self.atlas_ok = atlas_ok
        self.link_ok = link_ok
        self.asset_id = asset_id
        self.url_status = url_status
        self.calls: list[list[str]] = []
        self.upload_calls: list[tuple] = []

    def url_checker(self, url: str) -> int:
        """Fakes atlas_ingest()'s reachability check — never makes a real network call."""
        return self.url_status

    def uploader(self, atlas_url, project_slug, html_path, **kwargs) -> str:
        """Fakes the HTTP resolve-project + multipart-upload pair `atlas_ingest()` calls —
        never makes a real network call. Mirrors the real `_default_atlas_uploader` contract:
        raises PublishError on failure, returns an asset id on success."""
        self.upload_calls.append((atlas_url, project_slug, html_path))
        if not self.atlas_ok:
            raise pr.PublishError("atlas unreachable (fake)")
        return self.asset_id

    def runner(self, cmd, **_kwargs) -> subprocess.CompletedProcess:
        # _kwargs: swallows cwd/capture_output/text/timeout/check — the real subprocess.run
        # kwargs the engine passes; this fake dispatches purely on argv. Only `itt ...` calls
        # reach here now — atlas ingest is HTTP, faked via self.uploader instead.
        cmd = list(cmd)
        self.calls.append(cmd)

        # `--json` is a GLOBAL option: valid ONLY as rest[0].
        rest = cmd[1:]
        if "--json" in rest:
            if rest[0] != "--json":
                return subprocess.CompletedProcess(
                    cmd, 2, stdout="", stderr="Error: No such option '--json'")
            body = rest[1:]
        else:
            body = rest

        if body[0] == "link" and body[1] == "report":
            if len(body) > 2 and body[2] == "--help":
                if self.verb_available:
                    return subprocess.CompletedProcess(cmd, 0, stdout="Usage: itt link report ...", stderr="")
                return subprocess.CompletedProcess(cmd, 2, stdout="", stderr="Error: No such command 'report'.")
            # the actual write
            if not self.verb_available:
                return subprocess.CompletedProcess(cmd, 2, stdout="", stderr="Error: No such command 'report'.")
            if not self.link_ok:
                return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="link write failed")
            node_id = body[2]
            return subprocess.CompletedProcess(
                cmd, 0, stdout=json.dumps({"id": "extlink_1", "node_id": node_id}), stderr="")

        if body[0] == "node" and body[1] == "get":
            node_id = body[2]
            node = self.nodes.get(node_id)
            if node is None:
                return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="404 not found")
            return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(node), stderr="")

        raise AssertionError(f"unexpected command in test: {cmd}")

    def write_calls(self) -> list[list[str]]:
        """Calls that would mutate IntentTree (the actual `itt link report <node> ...` write,
        never the `--help` probe). Recognizes `--json` as the required first arg (per real `itt`),
        immediately followed by `link report <node_id>`."""
        out = []
        for c in self.calls:
            if len(c) < 5 or c[1] != "--json" or c[2:4] != ["link", "report"]:
                continue
            if c[4] == "--help":
                continue
            out.append(c)
        return out


def make_envelope(route: str = "feature", subject: str = "my-feature",
                  instance_key: str | None = None) -> dict:
    base = f"report:{route}:{subject}"
    identity = f"{base}:{instance_key}" if instance_key else base
    return {
        "envelope_version": "1.0", "artifact_type": "delivery-report", "target": "atlas",
        "route": route, "title": "A Title", "subject": subject, "instance_key": instance_key,
        "link_identity": identity, "revision": 1, "truth_status": "verified",
        "generated_from": None, "generated_by": "delivery-report 0.1.0",
        "generated_at": "2026-08-02T00:00:00Z", "manifest_path": "report.json",
        "html_path": str(HTML_PATH), "tracker_links": [], "item_count": 0,
    }


class SlugifyTests(unittest.TestCase):
    def test_slugify_normalizes(self) -> None:
        self.assertEqual("my-feature", pr.slugify("My Feature"))
        self.assertEqual("my-feature", pr.slugify("my_feature!!"))
        self.assertEqual("", pr.slugify(None))


class IttJsonArgOrderTests(unittest.TestCase):
    """`--json` is a GLOBAL `itt` option and MUST precede the subcommand (`itt --json node get
    ID`, never `itt node get ID --json`). Getting this wrong is silent and total: every
    `itt_get_node` call returns None, so the guardrail concludes every node is missing and rejects
    every link — fails safe, but fails ALWAYS, which reads exactly like a working guardrail. These
    tests assert the exact argv shape directly against a capturing runner (not FakeEnv, which
    would itself reject the wrong order and mask a regression as "some subprocess failed" rather
    than "the arg order is wrong")."""

    def _capturing_runner(self):
        calls: list[list[str]] = []

        def runner(cmd, **_kwargs):
            calls.append(list(cmd))
            return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")

        return calls, runner

    def test_itt_get_node_sends_json_as_first_arg(self) -> None:
        calls, runner = self._capturing_runner()
        pr.itt_get_node("itt", "n1", runner=runner)
        self.assertEqual(1, len(calls))
        cmd = calls[0]
        self.assertEqual("itt", cmd[0])
        self.assertEqual("--json", cmd[1])
        self.assertEqual(["node", "get", "n1"], cmd[2:5])

    def test_itt_get_node_with_include_still_sends_json_first(self) -> None:
        calls, runner = self._capturing_runner()
        pr.itt_get_node("itt", "n1", include="ancestors", runner=runner)
        cmd = calls[0]
        self.assertEqual("--json", cmd[1])
        self.assertEqual(["node", "get", "n1", "--include", "ancestors"], cmd[2:7])

    def test_itt_link_report_sends_json_as_first_arg(self) -> None:
        calls, runner = self._capturing_runner()
        pr.itt_link_report("itt", "n1", "http://example/x", "phase", "my-feature",
                           None, None, None, "report:phase:my-feature:m1", runner=runner)
        cmd = calls[0]
        self.assertEqual("itt", cmd[0])
        self.assertEqual("--json", cmd[1])
        self.assertEqual(["link", "report", "n1"], cmd[2:5])

    def test_fake_env_rejects_json_in_the_wrong_position(self) -> None:
        # the inverted assertion the reviewer asked for: a fake that would have accepted the OLD
        # (broken) arg order must itself fail loudly, so this suite can never again pass with it.
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "work_package"}})
        result = env.runner(["itt", "node", "get", "n1", "--json"])
        self.assertEqual(2, result.returncode)
        self.assertIn("No such option", result.stderr)


class GuardrailTests(unittest.TestCase):
    """The C2 AC: the guardrail rejects a deliberately-wrong-scope node and writes nothing."""

    def test_correct_scope_writes(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "work_package",
                                    "meta": {"feature_slug": "my-feature"}}})
        envelope = make_envelope(route="feature", subject="my-feature")
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertTrue(result["written"])
        self.assertEqual([], result["guardrail_violations"])
        self.assertEqual(1, len(env.write_calls()))
        self.assertIn("report:feature:my-feature", env.write_calls()[0])

    def test_wrong_feature_slug_rejects_and_writes_nothing(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "work_package",
                                    "meta": {"feature_slug": "someone-elses-feature"}}})
        envelope = make_envelope(route="feature", subject="my-feature")
        with self.assertRaises(pr.GuardrailRejection) as ctx:
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        payload = json.loads(str(ctx.exception))
        self.assertTrue(payload["guardrail_violations"])
        self.assertIn("misattribution", payload["guardrail_violations"][0])
        self.assertEqual([], env.write_calls(), "no itt link write must occur on rejection")

    def test_wrong_type_rejects_and_writes_nothing(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "step",
                                    "meta": {"feature_slug": "my-feature"}}})
        envelope = make_envelope(route="feature", subject="my-feature")
        with self.assertRaises(pr.GuardrailRejection) as ctx:
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        payload = json.loads(str(ctx.exception))
        self.assertTrue(any("allow-set" in v for v in payload["guardrail_violations"]))
        self.assertEqual([], env.write_calls())

    def test_nonexistent_node_rejects(self) -> None:
        env = FakeEnv(nodes={})
        envelope = make_envelope(route="feature", subject="my-feature")
        with self.assertRaises(pr.GuardrailRejection) as ctx:
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="does-not-exist", runner=env.runner, url_checker=env.url_checker)
        payload = json.loads(str(ctx.exception))
        self.assertTrue(any("does not exist" in v for v in payload["guardrail_violations"]))
        self.assertEqual([], env.write_calls())

    def test_guardrail_still_hosts_report_even_on_rejection(self) -> None:
        # Hosting carries no misattribution risk; only the LINK does (see module docstring).
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "work_package",
                                    "meta": {"feature_slug": "other"}}})
        envelope = make_envelope(route="feature", subject="my-feature")
        with self.assertRaises(pr.GuardrailRejection):
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual(1, len(env.upload_calls))


class LiveTypeTaxonomyTests(unittest.TestCase):
    """Fix 1 regression: the route allow-sets are pinned to the real NodeType enum
    (`../intenttree/backend/src/intenttree/models/enums.py:8-28`), not an inferred guess. A
    `milestone`-typed phase node — the observed real-world shape for a plan milestone in this very
    initiative (e.g. node_01KYWGX689GTWBPXGAZH0J2GMM, "M1 -- Report-aware ingest...") — must be
    ACCEPTED by the guardrail, or the phase route (M3's primary route) would be permanently inert."""

    def test_milestone_typed_phase_node_is_accepted(self) -> None:
        env = FakeEnv(nodes={
            "n1": {"id": "n1", "type": "work_area", "meta": {"feature_slug": "my-feature"},
                  "children": [{"id": "m1", "type": "milestone"}]},
            "m1": {"id": "m1", "type": "milestone", "meta": {"feature_slug": "my-feature"}},
        })
        envelope = make_envelope(route="phase", subject="my-feature", instance_key="m1")
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual("m1", result["resolved_node_id"])
        self.assertEqual([], result["guardrail_violations"])
        self.assertTrue(result["written"])

    def test_milestone_type_accepted_directly_by_guardrail(self) -> None:
        node = {"id": "m1", "type": "milestone", "meta": {"feature_slug": "my-feature"}}
        self.assertEqual([], pr.check_guardrail(node, "phase", "my-feature"))

    def test_work_area_typed_feature_anchor_is_accepted(self) -> None:
        # the live "Delivery Dossier" feature node is a work_area root, not a work_package.
        node = {"id": "n1", "type": "work_area", "meta": {"feature_slug": "delivery-dossier"}}
        self.assertEqual([], pr.check_guardrail(node, "feature", "delivery-dossier"))
        self.assertEqual([], pr.check_guardrail(node, "dossier", "delivery-dossier"))

    def test_root_typed_program_ancestor_is_accepted(self) -> None:
        node = {"id": "r1", "type": "root", "meta": {"feature_slug": "x"}}
        self.assertEqual([], pr.check_guardrail(node, "program", "x"))
        env = FakeEnv(nodes={"n1": {"id": "n1", "ancestors": [{"id": "r1", "type": "root"}]}})
        scope = pr.resolve_scope("itt", "program", "n1", None, runner=env.runner)
        self.assertEqual("r1", scope.node_id)
        self.assertFalse(scope.fell_back)


class ScopeResolutionTests(unittest.TestCase):
    """resolve_scope() returns a ScopeResolution(node_id, fell_back, reason) — never a bare
    string — so a fallback (falling back to the anchor because no more-specific node was found)
    is always visible to the caller, never silent."""

    def test_feature_and_dossier_resolve_to_anchor(self) -> None:
        env = FakeEnv()
        feature = pr.resolve_scope("itt", "feature", "n1", None, runner=env.runner)
        dossier = pr.resolve_scope("itt", "dossier", "n1", None, runner=env.runner)
        self.assertEqual(("n1", False, None), tuple(feature))
        self.assertEqual(("n1", False, None), tuple(dossier))
        self.assertEqual([], env.calls, "feature/dossier resolution needs no itt round-trip")

    def test_phase_resolves_to_matching_child(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "children": [
            {"id": "c1", "type": "step"}, {"id": "c2", "type": "atomic_task"},
        ]}})
        scope = pr.resolve_scope("itt", "phase", "n1", None, runner=env.runner)
        self.assertEqual("c2", scope.node_id)
        self.assertFalse(scope.fell_back)
        self.assertIsNone(scope.reason)

    def test_phase_falls_back_to_anchor_when_no_matching_child(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "children": [{"id": "c1", "type": "step"}]}})
        scope = pr.resolve_scope("itt", "phase", "n1", None, runner=env.runner)
        self.assertEqual("n1", scope.node_id)
        self.assertTrue(scope.fell_back)
        self.assertIn("no phase/milestone child", scope.reason)

    def test_program_resolves_to_ancestor_root(self) -> None:
        # the genuine ancestor case must still win over the fallback.
        env = FakeEnv(nodes={"n1": {"id": "n1", "ancestors": [
            {"id": "a1", "type": "work_package"}, {"id": "a2", "type": "work_area"},
        ]}})
        scope = pr.resolve_scope("itt", "program", "n1", None, runner=env.runner)
        self.assertEqual("a2", scope.node_id)
        self.assertFalse(scope.fell_back)
        self.assertIsNone(scope.reason)

    def test_program_falls_back_to_anchor_when_no_root_ancestor(self) -> None:
        # a root-level work_package anchor (parent_id: null) is the NORM for a per-initiative
        # node (PF-1/PF-2/PF-3 are all shaped this way) — this must resolve, not raise.
        env = FakeEnv(nodes={"n1": {"id": "n1", "ancestors": [{"id": "a1", "type": "work_package"}]}})
        scope = pr.resolve_scope("itt", "program", "n1", None, runner=env.runner)
        self.assertEqual("n1", scope.node_id)
        self.assertTrue(scope.fell_back)
        self.assertIn("no program-root ancestor", scope.reason)

    def test_readiness_feature_level_uses_anchor(self) -> None:
        env = FakeEnv()
        default_level = pr.resolve_scope("itt", "readiness", "n1", None, runner=env.runner)
        explicit_feature = pr.resolve_scope("itt", "readiness", "n1", "feature", runner=env.runner)
        self.assertEqual(("n1", False, None), tuple(default_level))
        self.assertEqual(("n1", False, None), tuple(explicit_feature))

    def test_readiness_program_level_uses_ancestor_root(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "ancestors": [{"id": "a1", "type": "pillar"}]}})
        scope = pr.resolve_scope("itt", "readiness", "n1", "program", runner=env.runner)
        self.assertEqual("a1", scope.node_id)
        self.assertFalse(scope.fell_back)

    def test_readiness_program_level_falls_back_to_anchor_when_no_root_ancestor(self) -> None:
        # same ancestor walk, same fallback, as `program` — must not diverge.
        env = FakeEnv(nodes={"n1": {"id": "n1", "ancestors": [{"id": "a1", "type": "work_package"}]}})
        scope = pr.resolve_scope("itt", "readiness", "n1", "program", runner=env.runner)
        self.assertEqual("n1", scope.node_id)
        self.assertTrue(scope.fell_back)
        self.assertIn("no program-root ancestor", scope.reason)


class ProgramRouteFallbackTests(unittest.TestCase):
    """Pins the exact production defect: a root-level `work_package` anchor with
    `parent_id: null` (PF-1/PF-2/PF-3's real shape) made the `program` route unusable — it failed
    for a genuinely correct anchor exactly as readily as a wrong one, because the guardrail
    validated the fallback target against PROGRAM_ROOT_TYPES (a set it can never satisfy, since it
    IS the anchor, not a program root). check_guardrail's `fell_back` override fixes this by
    validating a fallback target against FEATURE_ANCHOR_TYPES instead."""

    def test_program_route_with_root_level_work_package_anchor_passes_and_flags_fallback(self) -> None:
        env = FakeEnv(nodes={
            "n1": {"id": "n1", "type": "work_package", "meta": {"feature_slug": "my-feature"},
                  "ancestors": []},
        })
        envelope = make_envelope(route="program", subject="my-feature", instance_key="m1")
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual([], result["guardrail_violations"])
        self.assertTrue(result["written"])
        self.assertEqual("n1", result["resolved_node_id"])
        self.assertTrue(result["scope_fallback"])
        self.assertIn("no program-root ancestor", result["scope_fallback_reason"])

    def test_program_route_fallback_still_rejects_wrong_feature_slug(self) -> None:
        # the fallback relaxes the TYPE check only — the slug check (R1) is untouched.
        env = FakeEnv(nodes={
            "n1": {"id": "n1", "type": "work_package", "meta": {"feature_slug": "someone-else"},
                  "ancestors": []},
        })
        envelope = make_envelope(route="program", subject="my-feature", instance_key="m1")
        with self.assertRaises(pr.GuardrailRejection) as ctx:
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        payload = json.loads(str(ctx.exception))
        self.assertTrue(payload["scope_fallback"])
        self.assertTrue(any("misattribution" in v for v in payload["guardrail_violations"]))
        self.assertEqual([], env.write_calls())

    def test_program_route_genuine_ancestor_does_not_set_fallback_flag(self) -> None:
        env = FakeEnv(nodes={
            "n1": {"id": "n1", "ancestors": [{"id": "root1", "type": "work_area"}]},
            "root1": {"id": "root1", "type": "work_area", "meta": {"feature_slug": "my-feature"}},
        })
        envelope = make_envelope(route="program", subject="my-feature", instance_key="m1")
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual("root1", result["resolved_node_id"])
        self.assertFalse(result["scope_fallback"])
        self.assertNotIn("scope_fallback_reason", result)
        self.assertTrue(result["written"])


class VerbAvailabilityTests(unittest.TestCase):
    """D5: `itt link report` verb-absence is an offline case, not a crash."""

    def test_verb_absent_produces_benign_skip_not_crash(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "work_package",
                                    "meta": {"feature_slug": "my-feature"}}},
                      verb_available=False)
        envelope = make_envelope(route="feature", subject="my-feature")
        with self.assertRaises(pr.VerbUnavailable):
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        # never reached atlas ingest or any resolution/guardrail round-trip — the probe fires first
        atlas_calls = [c for c in env.calls if c[0] == "python3"]
        self.assertEqual([], atlas_calls)

    def test_dry_run_tolerates_verb_absence(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "work_package",
                                    "meta": {"feature_slug": "my-feature"}}},
                      verb_available=False)
        envelope = make_envelope(route="feature", subject="my-feature")
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", dry_run=True, runner=env.runner, url_checker=env.url_checker)
        self.assertTrue(result["would_write"])
        self.assertFalse(result["itt_link_report_available"])
        self.assertEqual([], env.write_calls())

    def test_cli_verb_absent_exits_3(self) -> None:
        with mock.patch.object(pr, "link_verb_available", return_value=False):
            with tempfile.TemporaryDirectory() as tmp:
                envelope_path = Path(tmp) / "wb.json"
                envelope_path.write_text(json.dumps(make_envelope()))
                code = pr.main(["--envelope", str(envelope_path), "--anchor-node-id", "n1"])
        self.assertEqual(3, code)


class DryRunTests(unittest.TestCase):
    def test_dry_run_writes_nothing_but_prints_full_resolution(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "work_package",
                                    "meta": {"feature_slug": "my-feature"}}})
        envelope = make_envelope(route="feature", subject="my-feature")
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", dry_run=True, runner=env.runner, url_checker=env.url_checker)
        for key in ("route", "subject", "resolved_node_id", "link_identity", "url"):
            self.assertIn(key, result)
        self.assertTrue(result["would_write"])
        self.assertNotIn("written", result)
        self.assertEqual([], env.write_calls())

    def test_dry_run_never_calls_atlas_ingest(self) -> None:
        # fix 2: a flag named --dry-run must not create or refresh a hosted asset.
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "work_package",
                                    "meta": {"feature_slug": "my-feature"}}})
        envelope = make_envelope(route="feature", subject="my-feature")
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", dry_run=True, runner=env.runner, url_checker=env.url_checker)
        atlas_calls = [c for c in env.calls if c[0] == "python3"]
        self.assertEqual([], atlas_calls, "--dry-run must never subprocess into atlas ingest")
        self.assertIsNone(result["url"])
        self.assertIn("not_fetched", result["url_status"])

    def test_dry_run_guardrail_rejection_also_never_touches_atlas(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "work_package",
                                    "meta": {"feature_slug": "other-feature"}}})
        envelope = make_envelope(route="feature", subject="my-feature")
        with self.assertRaises(pr.GuardrailRejection) as ctx:
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="n1", dry_run=True, runner=env.runner, url_checker=env.url_checker)
        payload = json.loads(str(ctx.exception))
        self.assertIsNone(payload["url"])
        atlas_calls = [c for c in env.calls if c[0] == "python3"]
        self.assertEqual([], atlas_calls)

    def test_live_path_still_hosts_before_writing(self) -> None:
        # the LIVE (non-dry-run) path keeps its original step order: atlas ingest still runs
        # even though scope resolution/guardrail now happen in the same call — see the
        # `resolution["url"]` coming from a real ingest call, not a skipped one.
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "work_package",
                                    "meta": {"feature_slug": "my-feature"}}})
        envelope = make_envelope(route="feature", subject="my-feature")
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual(PREVIEW_URL, result["url"])
        self.assertEqual(1, len(env.upload_calls))


class AtlasFailureTests(unittest.TestCase):
    def test_unreachable_atlas_is_a_clean_publish_error(self) -> None:
        env = FakeEnv(atlas_ok=False)
        envelope = make_envelope(route="feature", subject="my-feature")
        with self.assertRaises(pr.PublishError):
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)

    def test_missing_html_file_is_a_clean_publish_error(self) -> None:
        # atlas_ingest()'s own html-existence check short-circuits before the (faked) uploader
        # is ever called — mirrors the old "missing atlas_repo checkout" short-circuit, moved to
        # the boundary that still exists post-HTTP-ingest (node_01M14WH846J90CXZHK1EEGH1G6).
        def uploader(*_args, **_kwargs):
            raise AssertionError("uploader must not be called when the HTML file is missing")

        with self.assertRaises(pr.PublishError):
            pr.atlas_ingest(ATLAS_URL, PROJECT_SLUG, Path("/definitely/not/a/real/report.html"),
                            uploader=uploader)

    def test_project_not_found_is_a_clean_publish_error(self) -> None:
        # the real default uploader (_default_atlas_uploader) raises when project_resolver
        # returns no match — exercised here via a fake project_resolver-shaped uploader stand-in
        # that reproduces that contract without a real network call.
        def uploader(*_args, **_kwargs):
            raise pr.PublishError(f"atlas has no project with slug={PROJECT_SLUG!r}")

        with self.assertRaises(pr.PublishError):
            pr.atlas_ingest(ATLAS_URL, PROJECT_SLUG, HTML_PATH, uploader=uploader)


class PreviewUrlVerificationTests(unittest.TestCase):
    """node_01M08Q5HK44RYJCYTQNFPD6J3C: a non-2xx preview URL must never reach an ExternalLink
    write, and an authoring-machine-local target must never accept an upload."""

    def _uploader(self, asset_id: str = ASSET_ID):
        def uploader(atlas_url, project_slug, html_path, **_kwargs):
            return asset_id
        return uploader

    def test_non_2xx_preview_url_is_a_clean_publish_error_before_any_itt_call(self) -> None:
        upload_calls: list[tuple] = []

        def uploader(atlas_url, project_slug, html_path, **_kwargs):
            upload_calls.append((atlas_url, project_slug, html_path))
            return ASSET_ID

        with self.assertRaises(pr.PublishError):
            pr.atlas_ingest(ATLAS_URL, PROJECT_SLUG, HTML_PATH,
                            uploader=uploader, url_checker=lambda _url: 404)
        # AC1: no itt write attempted — atlas_ingest raises before publish() ever calls itt.
        self.assertEqual(1, len(upload_calls))  # only the upload, no itt call

    def test_connection_failure_is_a_clean_publish_error(self) -> None:
        with self.assertRaises(pr.PublishError):
            pr.atlas_ingest(ATLAS_URL, PROJECT_SLUG, HTML_PATH,
                            uploader=self._uploader(), url_checker=lambda _url: -1)

    def test_2xx_preview_url_passes_through_unchanged(self) -> None:
        url = pr.atlas_ingest(ATLAS_URL, PROJECT_SLUG, HTML_PATH,
                              uploader=self._uploader(), url_checker=lambda _url: 200)
        self.assertEqual(PREVIEW_URL, url)

    def test_localhost_target_fails_loudly_before_upload(self) -> None:
        upload_calls: list[tuple] = []

        def uploader(*args, **kwargs):
            upload_calls.append((args, kwargs))
            return ASSET_ID

        with self.assertRaisesRegex(pr.PublishError, "AUTHORING-MACHINE-LOCAL"):
            pr.atlas_ingest("http://localhost:8042", PROJECT_SLUG, HTML_PATH,
                            uploader=uploader, url_checker=lambda _url: 200)
        self.assertEqual([], upload_calls, "a local registry must not receive an upload")

    def test_host_qualified_preview_url_is_declared_durable(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "atomic_task",
                                    "meta": {"feature_slug": "my-feature"}}})
        envelope = make_envelope(route="feature", subject="my-feature")
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt",
                            atlas_url=ATLAS_URL, uploader=env.uploader,
                            anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual("host-qualified", result["preview_url_scope"])
        self.assertTrue(result["preview_url_durable"])


class LinkIdentityPassthroughTests(unittest.TestCase):
    def test_recurring_route_ref_carries_instance_key_verbatim(self) -> None:
        env = FakeEnv(nodes={"n1": {"id": "n1", "type": "atomic_task",
                                    "meta": {"feature_slug": "my-feature"}}})
        envelope = make_envelope(route="phase", subject="my-feature", instance_key="phase-2")
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual("report:phase:my-feature:phase-2", result["link_identity"])
        write_call = env.write_calls()[0]
        ref_index = write_call.index("--ref") + 1
        self.assertEqual("report:phase:my-feature:phase-2", write_call[ref_index])


class NoCollapseRefusalTests(unittest.TestCase):
    """Regression coverage for the D1 no-collapse bypass a follow-on review found:
    `make_envelope()` never previously produced an envelope missing `link_identity`, or a
    recurring route with `instance_key=None` — exactly the two shapes that slipped through the
    old `envelope.get("link_identity") or f"report:{route}:{subject}"` fallback and would have
    silently collapsed two different phase/program/readiness reports onto one link row (DI-283).
    publish_report.py must now REFUSE (PublishError, zero subprocess calls) rather than
    synthesize, independent of the envelope's `target`."""

    def _recurring_envelope_missing_key(self, **overrides) -> dict:
        envelope = make_envelope(route="phase", subject="my-feature")
        envelope.update(overrides)
        return envelope

    def test_recurring_route_with_instance_key_none_refuses(self) -> None:
        envelope = self._recurring_envelope_missing_key(instance_key=None,
                                                         link_identity="report:phase:my-feature")
        env = FakeEnv()
        with self.assertRaises(pr.PublishError) as ctx:
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertIn("instance_key", str(ctx.exception))
        self.assertIn("phase", str(ctx.exception))
        self.assertEqual([], env.calls, "must refuse before any subprocess call")

    def test_recurring_route_with_link_identity_absent_refuses(self) -> None:
        envelope = self._recurring_envelope_missing_key(instance_key="phase-2")
        del envelope["link_identity"]
        env = FakeEnv()
        with self.assertRaises(pr.PublishError):
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual([], env.calls)

    def test_recurring_route_with_link_identity_none_refuses(self) -> None:
        # the shape `build_export`/`compute_link_identity` now actually PRODUCES for e.g.
        # `export --target skillmeat` on a recurring route with no --instance-key.
        envelope = self._recurring_envelope_missing_key(instance_key=None, link_identity=None)
        env = FakeEnv()
        with self.assertRaises(pr.PublishError):
            pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                      anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual([], env.calls)

    def test_feature_route_with_link_identity_absent_is_still_recomputed(self) -> None:
        # the asymmetry is intentional: feature/dossier collapse on (route, subject) BY DESIGN.
        node = {"id": "n1", "type": "work_package", "meta": {"feature_slug": "my-feature"}}
        env = FakeEnv(nodes={"n1": node})
        envelope = make_envelope(route="feature", subject="my-feature")
        del envelope["link_identity"]
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual("report:feature:my-feature", result["link_identity"])
        self.assertTrue(result["written"])

    def test_dossier_route_with_link_identity_absent_is_still_recomputed(self) -> None:
        node = {"id": "n1", "type": "work_area", "meta": {"feature_slug": "my-feature"}}
        env = FakeEnv(nodes={"n1": node})
        envelope = make_envelope(route="dossier", subject="my-feature")
        del envelope["link_identity"]
        result = pr.publish(envelope, Path("wb.json"), itt_bin="itt", uploader=env.uploader,
                            anchor_node_id="n1", runner=env.runner, url_checker=env.url_checker)
        self.assertEqual("report:dossier:my-feature", result["link_identity"])
        self.assertTrue(result["written"])


class CliTests(unittest.TestCase):
    def test_missing_anchor_node_id_is_usage_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            envelope_path = Path(tmp) / "wb.json"
            envelope_path.write_text(json.dumps(make_envelope()))
            code = pr.main(["--envelope", str(envelope_path)])
        self.assertEqual(2, code)

    def test_guardrail_rejection_exits_1(self) -> None:
        node = {"id": "n1", "type": "work_package", "meta": {"feature_slug": "wrong-slug"}}
        with mock.patch.object(pr, "link_verb_available", return_value=True), \
             mock.patch.object(pr, "atlas_ingest", return_value=PREVIEW_URL), \
             mock.patch.object(pr, "resolve_scope",
                               return_value=pr.ScopeResolution("n1", False, None)), \
             mock.patch.object(pr, "itt_get_node", return_value=node), \
             mock.patch.object(pr, "itt_link_report") as write_mock:
            with tempfile.TemporaryDirectory() as tmp:
                envelope_path = Path(tmp) / "wb.json"
                envelope_path.write_text(json.dumps(make_envelope(subject="my-feature")))
                code = pr.main(["--envelope", str(envelope_path), "--anchor-node-id", "n1",
                                "--json"])
            write_mock.assert_not_called()
        self.assertEqual(1, code)

    def test_successful_publish_exits_0(self) -> None:
        node = {"id": "n1", "type": "work_package", "meta": {"feature_slug": "my-feature"}}
        with mock.patch.object(pr, "link_verb_available", return_value=True), \
             mock.patch.object(pr, "atlas_ingest", return_value=PREVIEW_URL), \
             mock.patch.object(pr, "resolve_scope",
                               return_value=pr.ScopeResolution("n1", False, None)), \
             mock.patch.object(pr, "itt_get_node", return_value=node), \
             mock.patch.object(pr, "itt_link_report", return_value={"id": "extlink_1"}) as write_mock:
            with tempfile.TemporaryDirectory() as tmp:
                envelope_path = Path(tmp) / "wb.json"
                envelope_path.write_text(json.dumps(make_envelope(subject="my-feature")))
                code = pr.main(["--envelope", str(envelope_path), "--anchor-node-id", "n1"])
            write_mock.assert_called_once()
        self.assertEqual(0, code)


if __name__ == "__main__":
    unittest.main()
