"""Offline positive, negative and mutation tests. No live account or external calls."""
from __future__ import annotations
import copy
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

SK = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SK / "scripts"))
import handoff as h
import bootstrap as b
import preflight_skill

TODAY = dt.date(2026, 9, 17)

class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.pack = self.root / 'pack'
        shutil.copytree(SK / 'examples/01-pro-decision', self.pack)
        self.m = h.load(self.pack / 'manifest.json')

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        (self.pack / 'manifest.json').write_text(h.dump(self.m))

    def report(self):
        self.save()
        return h.validate_pack(self.pack, today=TODAY)

    def switch(self, example):
        shutil.rmtree(self.pack)
        shutil.copytree(SK / 'examples' / example, self.pack)
        self.m = h.load(self.pack / 'manifest.json')

    def file(self, name='inputs/source.md', content=b'Public test fixture.', media='text/markdown'):
        p=self.pack/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(content)
        self.m['inputs']=[{'id':'I01','kind':'file','path':name,'sha256':h.sha(p),'media_type':media,
                           'role':'evidence','required':True,'note':'Synthetic test fixture'}]
        self.m['turns'][0]['input_ids']=['I01']
        return p

    def handback(self, status='complete'):
        self.save()
        returned=self.root/'return';returned.mkdir()
        p=returned/'outputs/result.md';p.parent.mkdir();p.write_text('Fixture result, not a live Chat response.')
        hand={'protocol':'CGH/1','protocol_version':'1.0.0','pack_id':self.m['pack_id'],
              'manifest_sha256':h.sha(self.pack/'manifest.json'),'status':status,'completed_turn_ids':['T01'],
              'files':[{'id':'O01','path':'outputs/result.md','sha256':h.sha(p),
                        'validation':[{'check':'Fixture bytes exist','status':'pass','note':'Local unit-test evidence only'}]}],
              'findings':['Synthetic result.'],'deviations':[], 'gaps':[] if status=='complete' else ['Semantic review remains.'],
              'observed_execution':{'model_label':None,'thinking_label':None,'basis':'unknown','tools_used':[]},'extensions':{}}
        (returned/'handback.json').write_text(h.dump(hand))
        return returned,hand

    def test_all_ten_examples_schema_and_semantics(self):
        examples=sorted((SK/'examples').iterdir())
        self.assertEqual(len(examples),10)
        for p in examples:
            with self.subTest(example=p.name):
                result=h.validate_pack(p,today=TODAY)
                self.assertTrue(result['valid'],result)
                self.assertFalse(result['warnings'],result)

    def test_non_image_turn_embeds_exact_receipt_and_pack_inventory(self):
        text=h.turn_text(self.m,self.m['turns'][0],h.sha(self.pack/'manifest.json'))
        self.assertIn('## Pack completion inventory',text)
        chunk=text.split('## handback.json starter',1)[1]
        receipt=json.loads(re.search(r'```json\n(.*?)\n```',chunk,re.S).group(1))
        self.assertFalse(h.schema_issues(receipt,'handback.schema.json'))
        self.assertEqual(receipt['status'],'partial')
        self.assertEqual(receipt['files'],[])

    def test_visual_qa_embeds_original_image_text_for_new_chat(self):
        self.switch('04-twelve-slide-image-sequence')
        turn=self.m['turns'][3]
        text=h.turn_text(self.m,turn,h.sha(self.pack/'manifest.json'))
        self.assertIn('## Upstream acceptance contracts',text)
        for producer in self.m['turns'][:3]:
            for image in producer['payload']['images']:
                for block in image['exact_text']:
                    self.assertIn(block['text'],text)

    def test_schema_definitions_are_valid(self):
        from jsonschema import Draft202012Validator
        for p in (SK/'schemas').glob('*.json'):
            Draft202012Validator.check_schema(h.load(p))

    def test_drafts_are_structurally_valid_but_not_ready(self):
        for cap in h.CAPABILITIES:
            with self.subTest(capability=cap):
                self.m=h.make_draft(cap,'Draft fixture')
                self.assertFalse(h.schema_issues(self.m,'handoff.schema.json'))
                result=self.report()
                self.assertFalse(result['valid'])
                self.assertTrue(any('placeholder' in e for e in result['errors']))
                self.assertTrue(any('approval' in e.lower() for e in result['errors']))

    def test_core_mutations_are_rejected(self):
        original=copy.deepcopy(self.m)
        mutations={
            'work_surface':lambda m:m.update(surface='chatgpt-work'),
            'unknown_core_field':lambda m:m.update(undeclared='x'),
            'version_mismatch':lambda m:m.update(protocol_version='2.0.0'),
            'no_approval':lambda m:m['authorization'].update(approved_for_chat=False),
            'connector_write':lambda m:m['authorization'].update(connector_writes=True),
            'unresolved_approval':lambda m:m['authorization'].update(approval_basis='unknown'),
            'bad_reference_digest':lambda m:m['reference'].update(sha256='0'*64),
            'bad_capability_digest':lambda m:m.update(capability_sha256='0'*64),
            'unknown_capability_snapshot':lambda m:m.update(capability_snapshot='unverified'),
            'unknown_route':lambda m:m['turns'][0].update(route='magic'),
            'wrong_route':lambda m:m['turns'][0].update(route='image-execution'),
            'unknown_input':lambda m:m['turns'][0].update(input_ids=['missing']),
            'unknown_output':lambda m:m['turns'][0].update(output_ids=['missing']),
            'cycle':lambda m:m['turns'][0].update(depends_on=['T01']),
            'forward_dependency':lambda m:m['turns'][0].update(depends_on=['T99']),
            'unbound_upstream':lambda m:m['turns'][0].update(upstream_output_ids=['O01']),
            'extension_not_namespaced':lambda m:m.update(extensions={'random':1}),
            'reserved_output':lambda m:m['outputs'][0].update(path='handback.json'),
            'duplicate_output':lambda m:m['outputs'].append(copy.deepcopy(m['outputs'][0])),
            'duplicate_turn':lambda m:m['turns'].append(copy.deepcopy(m['turns'][0])),
        }
        for name,mutate in mutations.items():
            with self.subTest(mutation=name):
                self.m=copy.deepcopy(original);mutate(self.m)
                self.assertFalse(self.report()['valid'])

    def test_all_dangerous_path_forms(self):
        for path in ('../escape.txt','/absolute.txt','C:\\secret.txt','inputs/../../escape','a\x00b','.', 'x\\y'):
            with self.subTest(path=repr(path)):
                with self.assertRaises(h.Refusal):h.safe_path(self.pack,path)

    def test_input_missing(self):
        p=self.file();p.unlink()
        self.assertFalse(self.report()['valid'])

    def test_input_hash_tamper(self):
        p=self.file();p.write_text('Changed bytes')
        self.assertTrue(any('hash mismatch' in e for e in self.report()['errors']))

    def test_input_symlink(self):
        p=self.file();p.unlink();outside=self.root/'outside';outside.write_text('Outside')
        p.symlink_to(outside)
        self.assertTrue(any('Symlink' in e for e in self.report()['errors']))

    def test_symlink_parent(self):
        outside=self.root/'outside';outside.mkdir();(outside/'secret.md').write_text('Outside')
        (self.pack/'alias').symlink_to(outside,target_is_directory=True)
        with self.assertRaises(h.Refusal):h.safe_path(self.pack,'alias/secret.md',must_exist=True)

    def test_credential_filename_rejected(self):
        self.file('inputs/.env',b'not even a secret')
        self.assertTrue(any('Credential-like' in e for e in self.report()['errors']))

    def test_credential_signature_rejected(self):
        self.file(content=b'-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----')
        self.assertTrue(any('credential signature' in e for e in self.report()['errors']))

    def test_image_input_must_not_be_text_mislabeled_png(self):
        self.file('inputs/fake.png',b'This is not an image',media='image/png')
        self.assertTrue(any('signature mismatch' in e for e in self.report()['errors']))

    def test_ambiguous_upload_basenames(self):
        first=self.file('inputs/a/same.md')
        second=self.pack/'inputs/b/same.md';second.parent.mkdir();second.write_text('Other')
        record=copy.deepcopy(self.m['inputs'][0]);record.update(id='I02',path='inputs/b/same.md',sha256=h.sha(second))
        self.m['inputs'].append(record);self.m['turns'][0]['input_ids'].append('I02')
        self.assertTrue(any('Ambiguous upload basename' in e for e in self.report()['errors']))

    def test_namespaced_extension_allowed(self):
        self.m['extensions']={'aos.packet':{'id':'unbound-test','status':'candidate'}}
        self.assertTrue(self.report()['valid'])

    def test_reference_verifier_and_stale_pin(self):
        rm=h.reference_check('cgh-reference-v1.0.0')
        self.assertEqual(rm['content_sha256'],self.m['reference']['sha256'])
        with self.assertRaises(h.Refusal):h.reference_check('cgh-reference-v0.0.0')

    def test_dependency_commands_resolve_from_arbitrary_cwd(self):
        text=(SK/'SKILL.md').read_text()
        commands=re.findall(r"^    (?:locator|verifier): '(.+)'$",text,re.M)
        self.assertEqual(len(commands),2)
        environment=dict(os.environ,CGH_SKILL_ROOT=str(SK))
        for command in commands:
            result=subprocess.run(command,shell=True,cwd=self.root,env=environment,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)

    def test_dependency_unknown_root_not_claimed_missing(self):
        env=dict(os.environ);env.pop('CGH_SKILL_ROOT',None)
        command=re.search(r"^    locator: '(.+)'$",(SK/'SKILL.md').read_text(),re.M).group(1)
        result=subprocess.run(command,shell=True,cwd=self.root,env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,2)
        self.assertIn('set to the loaded skill directory',result.stderr)

    def test_stale_capability_is_warning_not_made_up_freshness(self):
        result=h.validate_pack(self.pack,today=dt.date(2027,1,1))
        self.assertTrue(result['valid'])
        self.assertTrue(any('days old' in w for w in result['warnings']))

    def test_research_future_cutoff_rejected(self):
        self.switch('03-deep-research');self.m['turns'][0]['payload']['as_of']='2999-01-01'
        self.assertFalse(self.report()['valid'])

    def test_image_mutations_rejected(self):
        self.switch('05-transparent-icons');original=copy.deepcopy(self.m)
        mutations={
          'not_images_only':lambda m:m['turns'][0]['payload'].update(return_mode='images_plus_json'),
          'too_many_for_batch':lambda m:m['batch_policy'].update(working_images=3),
          'live_lower_limit':lambda m:m['batch_policy'].update(observed_platform_ceiling=2),
          'jpeg_alpha':lambda m:m['outputs'][0].update(media_type='image/jpeg'),
          'native_image_claim':lambda m:m['outputs'][0].update(editability='native'),
          'missing_edit_target':lambda m:m['turns'][0]['payload']['images'][0].update(operation='edit'),
          'missing_exact_template':lambda m:m['turns'][0]['payload']['images'][0].update(brand_mode='template_exact'),
          'bound_profile_without_template':lambda m:m['turns'][0]['payload']['images'][0].update(profile_id='work.ibm-template-exact.v1'),
          'unknown_profile':lambda m:m['turns'][0]['payload']['images'][0].update(profile_id='remembered-private-template'),
          'empty_custom_profile':lambda m:m['turns'][0]['payload']['images'][0].update(profile_id='custom.inline.v1',overrides={}),
          'no_exact_copy':lambda m:m['turns'][0]['payload']['images'][0].update(text_mode='exact'),
          'wrong_output_mapping':lambda m:m['turns'][0]['payload']['images'][0].update(output_id='ICON02'),
        }
        for name,mutate in mutations.items():
            with self.subTest(mutation=name):
                self.m=copy.deepcopy(original);mutate(self.m)
                self.assertFalse(self.report()['valid'])

    def test_generation_prompt_ends_with_images_only_boundary(self):
        self.switch('05-transparent-icons')
        text=(self.pack/'rendered/turns/T01.md').read_text()
        self.assertIn('Return images only.',text)
        self.assertNotIn('## Return contract',text)
        self.assertIn('## Resolved visual profiles',text)
        self.assertIn('not API/tool arguments',text)

    def test_twelve_images_have_three_generation_turns_and_separate_qa(self):
        self.switch('04-twelve-slide-image-sequence')
        turns=self.m['turns']
        self.assertEqual([t['capability'] for t in turns],['image_generation']*3+['visual_review','artifact_creation'])
        self.assertEqual([len(t['payload']['images']) for t in turns[:3]],[4,4,4])
        self.assertEqual(len(self.m['outputs']),15)
        self.assertEqual(self.m['outputs'][-2]['editability'],'raster')

    def test_renderer_refuses_to_overwrite_hand_edits(self):
        p=self.pack/'rendered/turns/T01.md';p.write_text(p.read_text()+'\nHuman amendment.\n')
        with self.assertRaises(h.Refusal):h.render(self.pack)
        with self.assertRaises(h.Refusal):h.verify_render(self.pack)
        self.assertIn('Human amendment.',p.read_text())

    def test_stale_generated_prompts_block_bundle(self):
        self.m['objective']='Changed objective';self.save()
        with self.assertRaises(h.Refusal):h.bundle(self.pack,self.root/'out.zip')

    def test_allowlist_bundle_excludes_stray_secret(self):
        (self.pack/'DO_NOT_EXPORT.env').write_text('private local mapping')
        destination=self.root/'out.zip';h.bundle(self.pack,destination)
        with zipfile.ZipFile(destination) as archive:
            self.assertNotIn('DO_NOT_EXPORT.env',archive.namelist())
            self.assertIn('manifest.json',archive.namelist())
            self.assertIn('rendered/turns/T01.md',archive.namelist())
        with self.assertRaises(h.Refusal):h.bundle(self.pack,destination)

    def test_complete_return_quarantined_not_promoted(self):
        returned,_=self.handback()
        (returned/'STRAY.txt').write_text('Uncontracted extra file')
        dest=self.root/'quarantine';h.ingest(self.pack,returned,dest)
        receipt=h.load(dest/'INGESTION_RECEIPT.json')
        self.assertFalse(receipt['executed_returned_code'])
        self.assertFalse(receipt['promoted_upstream'])
        self.assertEqual(receipt['acceptance'],'pending_local_review')
        self.assertFalse((dest/'STRAY.txt').exists())
        with self.assertRaises(h.Refusal):h.ingest(self.pack,returned,dest)

    def test_return_hash_mismatch_blocks_before_destination(self):
        returned,hand=self.handback();(returned/'outputs/result.md').write_text('tampered')
        dest=self.root/'quarantine'
        with self.assertRaises(h.Refusal):h.ingest(self.pack,returned,dest)
        self.assertFalse(dest.exists())

    def test_null_return_hash_is_measured_locally(self):
        returned,hand=self.handback();hand['files'][0]['sha256']=None
        (returned/'handback.json').write_text(h.dump(hand))
        _,records=h.inspect_return(self.pack,returned)
        self.assertIsNone(records[0]['reported_sha256'])
        self.assertEqual(len(records[0]['sha256']),64)

    def test_complete_cannot_omit_files(self):
        returned,hand=self.handback();hand['files']=[]
        (returned/'handback.json').write_text(h.dump(hand))
        with self.assertRaises(h.Refusal):h.inspect_return(self.pack,returned)

    def test_partial_cannot_claim_undelivered_turn_complete(self):
        returned,hand=self.handback('partial');hand['files']=[]
        (returned/'handback.json').write_text(h.dump(hand))
        with self.assertRaises(h.Refusal):h.inspect_return(self.pack,returned)

    def test_honest_empty_blocked_return_accepted_without_promotion(self):
        returned,hand=self.handback('partial');hand.update(status='blocked',completed_turn_ids=[],files=[],gaps=['Required capability unavailable.'])
        (returned/'handback.json').write_text(h.dump(hand))
        result,records=h.inspect_return(self.pack,returned)
        self.assertEqual(result['status'],'blocked');self.assertEqual(records,[])

    def test_return_identity_and_unknown_outputs(self):
        returned,hand=self.handback();original=copy.deepcopy(hand)
        for name,mutate in {
          'wrong_pack':lambda x:x.update(pack_id='other-pack'),
          'wrong_manifest':lambda x:x.update(manifest_sha256='0'*64),
          'uncontracted_output':lambda x:x['files'][0].update(id='UNKNOWN'),
          'uncontracted_turn':lambda x:x.update(completed_turn_ids=['T99']),
          'traversal':lambda x:x['files'][0].update(path='../outside'),
          'reserved_control':lambda x:x['files'][0].update(path='handback.json'),
        }.items():
            with self.subTest(mutation=name):
                hand=copy.deepcopy(original);mutate(hand)
                (returned/'handback.json').write_text(h.dump(hand))
                with self.assertRaises(h.Refusal):h.inspect_return(self.pack,returned)

    def test_return_symlink_rejected(self):
        returned,_=self.handback();p=returned/'outputs/result.md';p.unlink()
        outside=self.root/'outside';outside.write_text('outside');p.symlink_to(outside)
        with self.assertRaises(h.Refusal):h.inspect_return(self.pack,returned)

    def test_no_execution_of_returned_content(self):
        returned,hand=self.handback();p=returned/'outputs/result.md'
        marker=self.root/'EXECUTED'
        p.write_text(f'import pathlib\npathlib.Path({str(marker)!r}).write_text("bad")\n')
        hand['files'][0]['sha256']=h.sha(p);(returned/'handback.json').write_text(h.dump(hand))
        h.ingest(self.pack,returned,self.root/'quarantine')
        self.assertFalse(marker.exists())

    def test_duplicate_json_keys_and_nan_rejected(self):
        p=self.root/'invalid.json'
        for text in ('{"a":1,"a":2}','{"a":NaN}'):
            p.write_text(text)
            with self.assertRaises(h.Refusal):h.load(p)

    def test_supplemental_skill_preflight(self):
        report=preflight_skill.inspect()
        self.assertEqual(report['status'],'pass',report)
        self.assertEqual(report['official_skill_dev_validator'],'not_run_not_supplied')

class BootstrapTests(unittest.TestCase):
    def test_preserves_existing_text_and_is_idempotent(self):
        original='# Existing instructions\n\nKeep every manually written line.\n'
        result=b.patched(original)
        self.assertTrue(result.startswith(original))
        self.assertEqual(b.patched(result),result)

    def test_crlf_preserved(self):
        original='# Existing\r\nHuman text.\r\n'
        result=b.patched(original)
        self.assertTrue(result.startswith(original))
        self.assertNotIn('\n',result.replace('\r\n',''))
        self.assertEqual(b.patched(result),result)

    def test_hand_edited_managed_block_refused(self):
        text=b.BLOCK.replace('quarantine only','a manually customized quarantine')
        with self.assertRaises(b.BootstrapError):b.patched(text)

    def test_malformed_markers_refused(self):
        for text in (b.START,b.END,b.BLOCK+b.BLOCK):
            with self.subTest(text=text):
                with self.assertRaises(b.BootstrapError):b.patched(text)

    def test_generated_instructions_refused(self):
        for text in ('<!-- AUTO-GENERATED -->\n','# Heading\nDO NOT EDIT this file\n'):
            with self.assertRaises(b.BootstrapError):b.patched(text)

    def test_apply_backups_and_repeat_noop(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);skill=root/'.claude/skills/chatgpt-chat-handoff/SKILL.md';skill.parent.mkdir(parents=True);skill.write_text('staged test')
            (root/'AGENTS.md').write_text('Human instructions.\n')
            changes=b.plan(root);self.assertEqual(len(changes),2)
            b.apply(changes)
            self.assertEqual(b.plan(root),[])
            backups=list(root.glob('AGENTS.md.cgh-backup-*'));self.assertEqual(len(backups),1)
            self.assertEqual(backups[0].read_text(),'Human instructions.\n')

    def test_missing_skill_blocks_bootstrap(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(b.BootstrapError):b.plan(Path(directory))

    def test_instruction_symlink_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);skill=root/'.claude/skills/chatgpt-chat-handoff/SKILL.md';skill.parent.mkdir(parents=True);skill.write_text('staged test')
            other=root/'other';other.write_text('Human file');(root/'AGENTS.md').symlink_to(other)
            with self.assertRaises(b.BootstrapError):b.plan(root)

if __name__=='__main__':
    unittest.main(verbosity=2)
