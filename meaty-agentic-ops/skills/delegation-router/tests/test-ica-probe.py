"""Scoped serving probes: real helper, deterministic transport negative controls."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HELPER = Path(__file__).resolve().parents[1] / "scripts/probe-ica-models.sh"

class ProbeTests(unittest.TestCase):
    def test_scoped_probe_checks_text_and_skips_global_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            curl = Path(tmp) / "curl"
            curl.write_text('''#!/usr/bin/env python3
import json,sys
if sys.argv[-1].endswith("/models"):
 print(json.dumps({"data":[{"id":"healthy"}]}));sys.exit()
body=json.loads(sys.argv[sys.argv.index("-d")+1]);model=body["model"]
nonce=body["messages"][0]["content"].split(": ",1)[1]
if model=="denied":print(json.dumps({"error":{"message":"E003: Model not available for Coding Agents"}}))
else:print(json.dumps({"model":model,"choices":[{"finish_reason":"stop","message":{"content":nonce if model=="healthy" else "stale-cache"}}]}))
''')
            curl.chmod(0o755)
            env = dict(os.environ, PATH=tmp + os.pathsep + os.environ["PATH"], ICA_PROBE_KEY="fake-test-key")
            result = subprocess.run(["bash", str(HELPER), "--json", "--model", "healthy", "--model", "stale", "--model", "denied"], env=env, capture_output=True, text=True, check=True)
            data=json.loads(result.stdout)
            self.assertEqual(data["probe"]["healthy"]["verdict"], "ok")
            self.assertEqual(data["probe"]["stale"]["verdict"], "broken")
            self.assertEqual(data["probe"]["denied"]["verdict"], "broken")
            self.assertTrue(all(not values for values in data["drift"].values()))
            self.assertNotIn("fake-test-key", result.stdout + result.stderr)

if __name__ == "__main__":
    unittest.main()
