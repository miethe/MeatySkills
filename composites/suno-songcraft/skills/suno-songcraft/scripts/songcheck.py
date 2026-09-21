#!/usr/bin/env python3
"""Validate/count/render local song packets. Python 3.10+, standard library only.
No network or Suno actions. Exit 0: no errors; 1: invalid; 2: I/O/usage error.
"""
from __future__ import annotations
import argparse
from datetime import date
import json
from pathlib import Path
import re
import sys
from typing import Any
import unicodedata

SCHEMA_PATH = Path(__file__).resolve().parent.parent / 'assets/song.packet.schema.json'
CUE = re.compile(r'^\[[^\[\]\r\n]+\]$')
Json = dict[str, Any]


def read_utf8(path: Path) -> str:
    """Read exact text, without newline conversion or whitespace trimming."""
    return path.read_bytes().decode('utf-8')


def counts(text: str) -> dict[str, int]:
    return {'codepoints': len(text),
            'utf16': len(text.encode('utf-16-le', errors='surrogatepass')) // 2,
            'utf8_bytes': len(text.encode('utf-8', errors='surrogatepass')),
            'linebreaks': text.count('\n')}


def sung_lines(text: str) -> list[str]:
    """Only standalone bracket cues are nonsung in this local format."""
    return [s for raw in text.splitlines() if (s := raw.strip()) and not CUE.fullmatch(s)]


def is_type(v: Any, t: str) -> bool:
    return {'object': isinstance(v, dict), 'array': isinstance(v, list),
            'string': isinstance(v, str), 'null': v is None,
            'boolean': isinstance(v, bool),
            'number': isinstance(v, (int, float)) and not isinstance(v, bool),
            'integer': isinstance(v, int) and not isinstance(v, bool)}.get(t, False)


def schema_errors(value: Any, schema: Json, path: str = '$') -> list[Json]:
    """Implement only the keyword subset used by the bundled schema."""
    errors: list[Json] = []
    def add(msg: str) -> None:
        errors.append({'code': 'schema', 'path': path, 'message': msg})
    expected = schema.get('type')
    if expected:
        types = expected if isinstance(expected, list) else [expected]
        if not any(is_type(value, t) for t in types):
            add(f'Expected {types}; got {type(value).__name__}.')
            return errors
    if 'const' in schema and value != schema['const']:
        add(f"Expected constant {schema['const']!r}.")
    if 'enum' in schema and value not in schema['enum']:
        add(f"Expected one of {schema['enum']!r}.")
    if isinstance(value, str):
        if len(value) < schema.get('minLength', 0): add('String below minLength.')
        if 'pattern' in schema and re.search(schema['pattern'], value) is None:
            add('String does not match required pattern.')
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if 'minimum' in schema and value < schema['minimum']: add('Value below minimum.')
        if 'maximum' in schema and value > schema['maximum']: add('Value above maximum.')
    if isinstance(value, dict):
        props = schema.get('properties', {})
        for key in schema.get('required', []):
            if key not in value: add(f'Missing required field {key!r}.')
        if schema.get('additionalProperties') is False:
            for key in sorted(value.keys() - props.keys()): add(f'Unknown field {key!r}.')
        for key, child in props.items():
            if key in value: errors.extend(schema_errors(value[key], child, f'{path}.{key}'))
    if isinstance(value, list):
        if len(value) < schema.get('minItems', 0): add('Array below minItems.')
        if 'items' in schema:
            for i, item in enumerate(value):
                errors.extend(schema_errors(item, schema['items'], f'{path}[{i}]'))
    return errors


def alias_hits(text: str, references: list[Json]) -> list[str]:
    return sorted({alias for ref in references for alias in ref['aliases']
                   if re.search(r'(?<!\w)' + re.escape(alias) + r'(?!\w)', text, re.I)},
                  key=str.casefold)


def validate_packet(packet: Any, as_of: date | None = None) -> Json:
    as_of = as_of or date.today()
    errors = schema_errors(packet, json.loads(read_utf8(SCHEMA_PATH)))
    warnings: list[Json] = []
    measurements: Json = {}
    def issue(code: str, path: str, message: str, warning: bool = False) -> None:
        (warnings if warning else errors).append(dict(code=code, path=path, message=message))
    def result() -> Json:
        return dict(valid=not errors, as_of=as_of.isoformat(), errors=errors,
                    warnings=warnings, measurements=measurements,
                    scope='Text/contract checks only; no audio or platform acceptance test.')
    if errors: return result()

    def clean(text: str, path: str) -> None:
        if '```' in text: issue('code_fence', path, 'Keep fences outside the paste payload.')
        if any(0xD800 <= ord(c) <= 0xDFFF for c in text):
            issue('invalid_unicode', path, 'Unpaired Unicode surrogate in payload.')
        if any(unicodedata.category(c) == 'Cc' and c not in '\n\r\t' for c in text):
            issue('control_character', path, 'Unexpected control character.')
        if any(c in text for c in ('\u200b', '\ufeff', '\u2060', '\u202e', '\u202d')):
            issue('invisible_character', path, 'Review invisible characters; never disguise names.', True)

    platform, brief, lyric = packet['platform'], packet['brief'], packet['lyrics']
    try: age = (as_of - date.fromisoformat(platform['verified_on'])).days
    except ValueError: issue('invalid_date', '$.platform.verified_on', 'Use a real calendar date.')
    else:
        if age < 0: issue('future_verification', '$.platform.verified_on', 'Snapshot is future-dated relative to review.', True)
        if age > 30: issue('stale_snapshot', '$.platform.verified_on', 'Over 30 days old: refresh relevant current claims.', True)
    if sum(g['role'] == 'foundation' for g in brief['genres']) != 1:
        issue('genre_foundation', '$.brief.genres', 'Choose exactly one planning foundation.')
    ids = [v['id'] for v in brief['vocals']]
    if len(ids) != len(set(ids)): issue('duplicate_voice', '$.brief.vocals', 'Voice IDs must be unique.')
    if packet['mode'] == 'instrumental' and brief['vocals']:
        issue('instrumental_cast', '$.brief.vocals', 'Instrumental declares vocalists.')
    if packet['mode'] == 'restyle' and not brief['source_audio_available']:
        issue('unheard_source', '$.brief.source_audio_available', 'Audio unavailable: preservation targets are not verified matches.', True)
    if brief['lyric_edit_level'] == 'none' and lyric['original'] is None:
        issue('missing_original', '$.lyrics.original', 'Preserve-words checking requires source sung text.')
    if packet['evaluation']['status'] == 'not_audio_tested':
        issue('not_audio_tested', '$.evaluation.status', 'No audio test recorded; do not claim auditioned results.', True)

    def check_lyrics(text: str, path: str) -> None:
        clean(text, path)
        for i, raw in enumerate(text.splitlines(), 1):
            line = raw.strip()
            if '[' in line or ']' in line:
                if not CUE.fullmatch(line):
                    issue('cue_layout', f'{path}:line {i}', 'Put one balanced nonempty bracket cue on its own line.')
                elif len(line) > 180:
                    issue('long_cue', f'{path}:line {i}', 'Simplify long cue or move global detail to Style.', True)
            if re.match(r'^\((?:male|female|backing|all voices|instrument|guitar|drums)\b', line, re.I):
                issue('parenthetical_direction', f'{path}:line {i}', 'Review likely direction in parentheses; preserve actual ad-libs.', True)
        sung = sung_lines(text)
        for locked in lyric['locked_lines']:
            if locked not in sung:
                issue('locked_line_missing', path, f'Protected exact line not found: {locked!r}')
        if brief['lyric_edit_level'] == 'none' and lyric['original'] is not None:
            if sung != sung_lines(lyric['original']):
                issue('sung_text_changed', path, 'Ordered sung text differs under preserve-words scope.')
        if packet['mode'] == 'instrumental' and sung:
            issue('instrumental_lyrics', path, 'Instrumental contains sung lines.')
        cap = platform['lyrics_limit']
        if cap is not None and max(counts(text)[k] for k in ('codepoints', 'utf16')) > cap:
            issue('lyrics_over_limit', path, f'Lyrics exceed explicit ceiling {cap}.')

    check_lyrics(lyric['tagged'], '$.lyrics.tagged')
    if packet['variants'][0]['kind'] != 'baseline':
        issue('baseline_order', '$.variants[0].kind', 'Establish the baseline first.', True)
    variant_ids: set[str] = set()
    for i, v in enumerate(packet['variants']):
        path = f'$.variants[{i}]'
        if v['id'] in variant_ids: issue('duplicate_variant', path+'.id', 'Variant IDs must be unique.')
        variant_ids.add(v['id'])
        style, c = v['style'], counts(v['style'])
        measurements[v['id']] = c
        for field in ('style', 'exclude', 'edit_brief'): clean(v[field], path+'.'+field)
        if not style.strip(): issue('empty_style', path+'.style', 'Style cannot be whitespace-only.')
        if style != style.strip():
            issue('outer_whitespace', path+'.style', 'Outer whitespace counts; review instead of silently trimming.', True)
        cap = platform['style_limit']
        if max(c['codepoints'], c['utf16']) > cap:
            issue('style_over_limit', path+'.style', f"{c['codepoints']} code points / {c['utf16']} UTF-16 units exceeds {cap}.")
        for key in ('codepoints', 'utf16'):
            if v['style_counts'][key] != c[key]:
                issue('count_mismatch', path+'.style_counts.'+key, f'Measured {c[key]}, not declared count.')
        effective = lyric['tagged'] if v['lyrics_override'] is None else v['lyrics_override']
        if v['lyrics_override'] is not None: check_lyrics(effective, path+'.lyrics_override')
        combined = '\n'.join((style, effective, v['exclude'], v['edit_brief']))
        hits = alias_hits(combined, packet['artist_references'])
        if v['artist_mode'] == 'descriptive' and hits:
            issue('artist_alias_in_descriptive', path, 'Listed artist aliases in descriptive payload: '+', '.join(hits))
        if v['artist_mode'] == 'surname-shorthand':
            issue('unverified_artist_acceptance', path, 'Surname shorthand has no documented acceptance exception.', True)
            if not v['warnings']: issue('missing_artist_caveat', path+'.warnings', 'Include an explicit acceptance caveat.')
            if any(re.search(r'\s', hit) for hit in hits):
                issue('full_name_in_shorthand', path, 'Multiword artist alias in surname-only payload.')
        if i and v['kind'] != 'baseline' and v['changed_axis'].lower().strip() in ('none', 'same', 'n/a'):
            issue('missing_changed_axis', path+'.changed_axis', 'Specify a concrete changed axis.')
        if re.search(r'\b(?:guaranteed|identical voice|exact voice clone)\b', combined, re.I):
            issue('overclaim', path, 'Review guarantees or exact identity claims.', True)
        if 'two male leads' in style.lower():
            issue('cast_consistency', path+'.style', 'Check two-male-lead wording against the declared cast.', True)
        if packet['mode'] == 'instrumental' and re.search(r'\b(?:male lead|female lead|co-lead|duet|backing vocals)\b', style, re.I):
            issue('instrumental_vocal_direction', path+'.style', 'Review vocal direction in instrumental brief.', True)
        for inst in brief['instruments']:
            if re.search(r'(?<!\w)'+re.escape(inst['name'])+r'(?!\w)', v['exclude'], re.I):
                issue('instrument_exclusion_overlap', path+'.exclude', f"Exclude mentions requested instrument {inst['name']!r}; check scope.", True)
    return result()


def render_packet(packet: Json, report: Json) -> str:
    if not report['valid']: raise ValueError('Cannot render invalid packet.')
    out = [f"# {packet['title']}", '',
           f"Platform snapshot: {packet['platform']['verified_on']}. Style ceiling: {packet['platform']['style_limit']} ({packet['platform']['limit_basis']}).", '',
           f"Audio review status: {packet['evaluation']['status']}.", '']
    def block(label: str, text: str) -> None:
        out.extend([f'### {label}', '', '```text', text, '```', ''])
    if packet['lyrics']['tagged']: block('Shared lyrics', packet['lyrics']['tagged'])
    for v in packet['variants']:
        c = report['measurements'][v['id']]
        out.extend([f"## {v['id']} — {v['label']}", '', f"Change: {v['changed_axis']}. {v['hypothesis']}", '',
                    f"Style: **{c['codepoints']} code points / {c['utf16']} UTF-16 units**.", ''])
        for warning in v['warnings']: out.extend(['Caveat: '+warning, ''])
        block('Style', v['style'])
        if v['lyrics_override'] is not None: block('Paired lyrics override', v['lyrics_override'])
        if v['exclude']: block('Exclude', v['exclude'])
        if v['edit_brief']: block('Edit brief', v['edit_brief'])
    if packet['evaluation']['notes']:
        out.extend(['## Listening checks and limits', ''])
        out.extend('- '+note for note in packet['evaluation']['notes'])
    return '\n'.join(out).rstrip()+'\n'


def reject_constant(value: str) -> None:
    raise ValueError(f'Nonstandard JSON constant {value}.')


def load_packet(path: Path) -> Any:
    return json.loads(read_utf8(path), parse_constant=reject_constant)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('count', help='Count exact UTF-8 file contents, including final newline.')
    p.add_argument('file', type=Path)
    p.add_argument('--limit', type=int, default=1000)
    p.add_argument('--json', action='store_true')
    for name in ('check', 'render'):
        p = sub.add_parser(name)
        p.add_argument('packet', type=Path)
        p.add_argument('--as-of', type=date.fromisoformat, default=None)
        if name == 'check': p.add_argument('--json', action='store_true')
        else:
            p.add_argument('--output', type=Path, required=True)
            p.add_argument('--overwrite', action='store_true')
    args = parser.parse_args(argv)
    try:
        if args.command == 'count':
            if args.limit < 1: raise ValueError('--limit must be positive.')
            c = counts(read_utf8(args.file))
            valid = max(c['codepoints'], c['utf16']) <= args.limit
            if args.json: print(json.dumps(dict(valid=valid, limit=args.limit, **c), indent=2))
            else: print(f"{c['codepoints']} code points; {c['utf16']} UTF-16 units; ceiling {args.limit}: {'PASS' if valid else 'FAIL'}. Exact file contents counted.")
            return 0 if valid else 1
        packet = load_packet(args.packet)
        report = validate_packet(packet, args.as_of)
        if args.command == 'check':
            if args.json: print(json.dumps(report, ensure_ascii=True, indent=2))
            else:
                print(f"{'PASS' if report['valid'] else 'FAIL'}: {len(report['errors'])} errors; {len(report['warnings'])} warnings.")
                for severity in ('errors', 'warnings'):
                    for item in report[severity]: print(f"{severity.upper()}: {item['code']} {item['path']}: {item['message']}")
                for vid, c in report['measurements'].items(): print(f"{vid}: {c['codepoints']} code points / {c['utf16']} UTF-16 units")
                print(report['scope'])
            return 0 if report['valid'] else 1
        if not report['valid']:
            print(json.dumps(report, indent=2), file=sys.stderr)
            return 1
        text = render_packet(packet, report)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('w' if args.overwrite else 'x', encoding='utf-8', newline='\n') as handle:
            handle.write(text)
        print(f"Wrote {args.output}; text checks passed with {len(report['warnings'])} warnings. No audio test performed.")
        return 0
    except (OSError, UnicodeError, ValueError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
