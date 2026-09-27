#!/usr/bin/env python3
"""Validate the public provider-facts boundary and registry coverage."""
import json
import re
import unittest
from pathlib import Path
import yaml
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / 'model-registry.yaml'
PROVIDERS = ROOT / 'registry/providers'
PRIVATE = ROOT / 'registry/private-only.yaml'
SCHEMA = json.loads((ROOT / 'registry/providers.schema.json').read_text())
FORBIDDEN_KEYS = {'lane','lanes','endpoint','base_url','baseurl','gateway','hostname','auth','account','entitlement','allowance','pricing_we_pay','score','scores','role','role_binding','frontier','workhorse','spine','policy'}
LEAK = re.compile(r'(?:[A-Za-z0-9.-]+\.ibm\.com\b|\bica\b|\b10\.42\.(?:\d{1,3}\.){1,2}\d{0,3}\b)', re.I)

def keys(value):
    if isinstance(value, dict):
        for k, v in value.items():
            yield str(k).lower().replace('-', '_'), v
            yield from keys(v)
    elif isinstance(value, list):
        for item in value: yield from keys(item)

def model_ids(path): return set((yaml.safe_load(path.read_text()) or {}).get('models', {}))

class ProviderFactsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.docs = [yaml.safe_load(p.read_text()) for p in sorted(PROVIDERS.glob('*.yaml'))]
        cls.private = yaml.safe_load(PRIVATE.read_text())['private_only']
        cls.private_ids = {x['id'] for x in cls.private}
        cls.provider_models = {m['id'] for d in cls.docs for m in d['models']}

    def test_each_provider_document_matches_schema(self):
        validator = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
        errors = [(d.get('provider'),e.message) for d in self.docs for e in validator.iter_errors(d)]
        self.assertEqual(errors, [])
        self.assertEqual(len(self.docs), 11)
        sample = self.docs[0]
        self.assertFalse(validator.is_valid({**sample, 'models': [{**sample['models'][0], 'lane': 'private'}]}))

    def test_public_data_has_no_private_keys_or_internal_hosts(self):
        forbidden = []
        leaked = []
        for path in sorted(PROVIDERS.glob('*.yaml')):
            doc = yaml.safe_load(path.read_text())
            forbidden += [(path.name,k) for k,_ in keys(doc) if k in FORBIDDEN_KEYS]
            leaked += [(path.name,m.group(0)) for m in LEAK.finditer(path.read_text())]
        self.assertEqual(forbidden, [])
        self.assertEqual(leaked, [])
        for example in ['proxy.ibm.com', 'ICA', '10.42.0.7']:
            self.assertIsNotNone(LEAK.search(example), example)

    def test_all_tracked_and_installed_registry_models_are_covered_or_explained(self):
        covered = self.provider_models | self.private_ids
        gaps = model_ids(REGISTRY) - covered
        self.assertEqual(gaps, set())
        installed = Path.home()/'.claude/config/model-registry.yaml'
        if installed.exists(): self.assertEqual(model_ids(installed)-covered, set())
        for item in self.private:
            self.assertTrue(item['reason'].strip(), item['id'])
        self.assertEqual(len(self.provider_models), 40)

if __name__ == '__main__': unittest.main(verbosity=2)
