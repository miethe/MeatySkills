"""Deterministic contract tests; not Suno performance or audio evaluations."""
from __future__ import annotations
import copy
from datetime import date
import io
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
import songcheck as sc

AS_OF = date(2026, 9, 14)
ASSETS = Path(__file__).resolve().parent.parent/'assets'


class SongcheckTests(unittest.TestCase):
    def setUp(self):
        self.p = sc.load_packet(ASSETS/'carolina-rain.packet.json')
        self.p['variants'] = self.p['variants'][:1]

    def report(self): return sc.validate_packet(self.p, AS_OF)
    def errors(self): return {e['code'] for e in self.report()['errors']}
    def warnings(self): return {e['code'] for e in self.report()['warnings']}
    def style(self, text):
        v = self.p['variants'][0]; v['style'] = text
        c = sc.counts(text); v['style_counts'] = {k:c[k] for k in ('codepoints','utf16')}

    def test_example_valid(self): self.assertTrue(self.report()['valid'])
    def test_all_carolina_variants_valid(self):
        p = sc.load_packet(ASSETS/'carolina-rain.packet.json')
        self.assertTrue(sc.validate_packet(p, AS_OF)['valid'])
    def test_instrumental_example_valid(self):
        p = sc.load_packet(ASSETS/'after-hours.packet.json')
        self.assertTrue(sc.validate_packet(p, AS_OF)['valid'])
    def test_ascii_limit_inclusive(self):
        self.style('a'*1000); self.assertTrue(self.report()['valid'])
    def test_ascii_over_limit(self):
        self.style('a'*1001); self.assertIn('style_over_limit', self.errors())
    def test_utf16_limit_inclusive(self):
        self.style('\U0001f3b5'*500); self.assertTrue(self.report()['valid'])
    def test_utf16_over_limit(self):
        self.style('\U0001f3b5'*501); self.assertIn('style_over_limit', self.errors())
    def test_combining_characters_counted_not_normalized(self):
        self.assertEqual(sc.counts('e\u0301')['codepoints'], 2)
    def test_count_crlf_and_final_newline_exact(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'s.txt';path.write_bytes(b'A\r\nB\n')
            self.assertEqual(sc.counts(sc.read_utf8(path))['codepoints'], 5)
    def test_count_mismatch(self):
        self.p['variants'][0]['style_counts']['codepoints'] += 1
        self.assertIn('count_mismatch',self.errors())
    def test_whitespace_style_rejected(self):
        self.style('   ');self.assertIn('empty_style',self.errors())
    def test_outer_whitespace_warns(self):
        self.style('piano ');self.assertIn('outer_whitespace',self.warnings())
    def test_code_fence_rejected(self):
        self.style('```text\npiano\n```');self.assertIn('code_fence',self.errors())
    def test_control_character_rejected(self):
        self.style('piano\x00');self.assertIn('control_character',self.errors())
    def test_unpaired_surrogate_rejected(self):
        self.style('piano\ud800');self.assertIn('invalid_unicode',self.errors())
    def test_invisible_character_warns(self):
        self.style('pi\u200bano');self.assertIn('invisible_character',self.warnings())
    def test_inline_cue_rejected(self):
        self.p['lyrics']['tagged'] += '\n[Male lead] sing me'
        self.assertIn('cue_layout',self.errors())
    def test_nested_cue_rejected(self):
        self.p['lyrics']['tagged'] += '\n[Male [lead]]'
        self.assertIn('cue_layout',self.errors())
    def test_empty_cue_rejected(self):
        self.p['lyrics']['tagged'] += '\n[]';self.assertIn('cue_layout',self.errors())
    def test_unclosed_cue_rejected(self):
        self.p['lyrics']['tagged'] += '\n[Male';self.assertIn('cue_layout',self.errors())
    def test_parenthetical_adlib_is_sung(self):
        self.assertEqual(sc.sung_lines('[Outro]\n(oh, oh)\n'),['(oh, oh)'])
    def test_parenthetical_stage_direction_warns(self):
        self.p['lyrics']['tagged'] += '\n(Male lead, low)'
        self.assertIn('parenthetical_direction',self.warnings())
    def test_locked_line_removed(self):
        self.p['lyrics']['tagged']=self.p['lyrics']['tagged'].replace('Wash me in the Carolina rain,','Wash me in another rain,')
        self.assertIn('locked_line_missing',self.errors())
    def test_override_preserves_locks(self):
        self.p['variants'][0]['lyrics_override']='[Verse]\nDifferent words.'
        self.assertIn('locked_line_missing',self.errors())
    def test_none_edit_level_detects_changes(self):
        self.p['brief']['lyric_edit_level']='none'
        self.assertIn('sung_text_changed',self.errors())
    def test_none_edit_allows_new_cues(self):
        self.p['brief']['lyric_edit_level']='none'
        self.p['lyrics']['original']=self.p['lyrics']['tagged']
        self.p['lyrics']['tagged']='[Quiet opening]\n'+self.p['lyrics']['tagged']
        self.assertTrue(self.report()['valid'])
    def test_none_edit_requires_original(self):
        self.p['brief']['lyric_edit_level']='none';self.p['lyrics']['original']=None
        self.assertIn('missing_original',self.errors())
    def test_optional_lyric_ceiling(self):
        self.p['platform']['lyrics_limit']=10;self.assertIn('lyrics_over_limit',self.errors())
    def test_unknown_field(self):
        self.p['platform']['seed']=42;self.assertIn('schema',self.errors())
    def test_missing_required(self):
        del self.p['title'];self.assertIn('schema',self.errors())
    def test_bad_enum(self):
        self.p['mode']='guess';self.assertIn('schema',self.errors())
    def test_bool_is_not_integer(self):
        self.p['platform']['style_limit']=True;self.assertIn('schema',self.errors())
    def test_invalid_calendar_date(self):
        self.p['platform']['verified_on']='2026-02-31';self.assertIn('invalid_date',self.errors())
    def test_future_snapshot_warns(self):
        self.p['platform']['verified_on']='2027-01-01';self.assertIn('future_verification',self.warnings())
    def test_stale_snapshot_warns(self):
        self.p['platform']['verified_on']='2026-01-01';self.assertIn('stale_snapshot',self.warnings())
    def test_alias_in_style(self):
        self.style('Mayer-like guitar');self.assertIn('artist_alias_in_descriptive',self.errors())
    def test_alias_in_lyric_cue(self):
        self.p['lyrics']['tagged'] += '\n[Mayer-like guitar]'
        self.assertIn('artist_alias_in_descriptive',self.errors())
    def test_alias_in_exclude(self):
        self.p['variants'][0]['exclude']='Mayer';self.assertIn('artist_alias_in_descriptive',self.errors())
    def test_alias_word_boundaries(self):
        self.assertEqual(sc.alias_hits('Mayerish texture',self.p['artist_references']),[])
    def test_surname_caveat_required(self):
        self.p['variants'][0]['artist_mode']='surname-shorthand'
        self.assertIn('missing_artist_caveat',self.errors())
    def test_surname_with_caveat_valid(self):
        self.style('Mayer-like clean guitar')
        self.p['variants'][0]['artist_mode']='surname-shorthand'
        self.p['variants'][0]['warnings']=['Acceptance unverified; no surname exception.']
        self.assertTrue(self.report()['valid'])
        self.assertIn('unverified_artist_acceptance',self.warnings())
    def test_full_name_in_shorthand_rejected(self):
        self.style('John Mayer-like clean guitar')
        self.p['variants'][0]['artist_mode']='surname-shorthand'
        self.p['variants'][0]['warnings']=['Acceptance unverified.']
        self.assertIn('full_name_in_shorthand',self.errors())
    def test_duplicate_variants(self):
        self.p['variants'].append(copy.deepcopy(self.p['variants'][0]))
        self.assertIn('duplicate_variant',self.errors())
    def test_duplicate_voices(self):
        self.p['brief']['vocals'].append(copy.deepcopy(self.p['brief']['vocals'][0]))
        self.assertIn('duplicate_voice',self.errors())
    def test_foundation_required(self):
        self.p['brief']['genres'][0]['role']='support';self.assertIn('genre_foundation',self.errors())
    def test_exclusion_overlap_warns(self):
        self.p['variants'][0]['exclude']='banjo';self.assertIn('instrument_exclusion_overlap',self.warnings())
    def test_alternative_needs_axis(self):
        v=copy.deepcopy(self.p['variants'][0]);v.update(id='B',kind='sonic',changed_axis='none')
        self.p['variants'].append(v);self.assertIn('missing_changed_axis',self.errors())
    def test_instrumental_cast_rejected(self):
        self.p['mode']='instrumental';self.assertIn('instrumental_cast',self.errors())
    def test_instrumental_sung_text_rejected(self):
        self.p=sc.load_packet(ASSETS/'after-hours.packet.json')
        self.p['lyrics']['tagged']+='\nLet me sing.'
        self.assertIn('instrumental_lyrics',self.errors())
    def test_unheard_source_warning(self): self.assertIn('unheard_source',self.warnings())
    def test_no_audio_test_warning(self): self.assertIn('not_audio_tested',self.warnings())
    def test_render_has_separate_fields_and_counts(self):
        text=sc.render_packet(self.p,self.report())
        self.assertIn('### Shared lyrics\n\n```text',text)
        self.assertIn('### Style\n\n```text',text)
        self.assertIn('**961 code points / 961 UTF-16 units**',text)
    def test_render_invalid_refused(self):
        self.style('a'*1001)
        with self.assertRaises(ValueError):sc.render_packet(self.p,self.report())
    def test_cli_count_exit_code(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'style.txt';p.write_text('a'*1001)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(sc.main(['count',str(p)]),1)
    def test_cli_bad_json(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bad.json';p.write_text('{')
            with redirect_stderr(io.StringIO()):
                self.assertEqual(sc.main(['check',str(p)]),2)
    def test_json_nan_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bad.json';p.write_text('{"a":NaN}')
            with self.assertRaises(ValueError):sc.load_packet(p)
    def test_render_no_overwrite_default(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)/'keep.md';out.write_text('keep')
            with redirect_stderr(io.StringIO()):
                rc=sc.main(['render',str(ASSETS/'carolina-rain.packet.json'),'--as-of','2026-09-14','--output',str(out)])
            self.assertEqual(rc,2);self.assertEqual(out.read_text(),'keep')
    def test_render_explicit_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)/'keep.md';out.write_text('keep')
            with redirect_stdout(io.StringIO()):
                rc=sc.main(['render',str(ASSETS/'carolina-rain.packet.json'),'--as-of','2026-09-14','--output',str(out),'--overwrite'])
            self.assertEqual(rc,0);self.assertTrue(out.read_text().startswith('# Carolina Rain'))


if __name__=='__main__': unittest.main()
