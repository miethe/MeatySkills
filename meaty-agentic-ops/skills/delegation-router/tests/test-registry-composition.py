#!/usr/bin/env python3
"""Exercise the composer using small, public fixture data."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

COMPOSER = Path(__file__).resolve().parents[1] / "scripts/compose-model-registry.py"


class CompositionTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.base = root / "base.yaml"
        self.overlay = root / "overlay.yaml"
        self.expected = root / "model-registry.yaml"
        self.base.write_text("models:\n  public: [a, b]\n")
        self.overlay.write_text("models:\n  configured: [d, c]\n")
        self.expected.write_text("models:\n  configured:\n  - d\n  - c\n  public:\n  - a\n  - b\n")

    def run_composer(self, output):
        return subprocess.run(
            [sys.executable, COMPOSER, "--public", self.base, "--overlay", self.overlay,
             output, self.expected], capture_output=True, text=True,
        )

    def test_checks_bytes_and_sequence_order(self):
        self.assertEqual(self.run_composer("--check").returncode, 0)
        self.expected.write_bytes(self.expected.read_bytes() + b"\n")
        self.assertIn("composition differs", self.run_composer("--check").stderr)
        self.assertEqual(self.run_composer("--out").returncode, 0)
        self.assertEqual(self.run_composer("--check").returncode, 0)

    def test_rejects_shared_leaves_and_duplicate_input_keys(self):
        self.overlay.write_text("models:\n  public: [b, a]\n")
        self.assertIn("duplicate ownership at models.public", self.run_composer("--check").stderr)
        self.overlay.write_text("models: {}\nmodels: {}\n")
        self.assertIn("duplicate key", self.run_composer("--check").stderr)


if __name__ == "__main__":
    unittest.main()
