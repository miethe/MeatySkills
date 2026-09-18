#!/usr/bin/env python3
"""Supplemental static preflight. NOT the canonical skill-dev validator."""
from __future__ import annotations
import json
import re
from pathlib import Path

SK = Path(__file__).resolve().parents[1]

def inspect() -> dict:
    text = (SK / 'SKILL.md').read_text()
    match = re.match(r'\s*---\s*\n(.*?)\n---\s*\n', text, re.S)
    front = match.group(1) if match else ''
    rows = []
    def check(name, passed, evidence):
        rows.append({'check':name,'status':'pass' if passed else 'fail','evidence':evidence})
    check('frontmatter',bool(match),'Opening and closing frontmatter delimiters')
    for field in ('name','description','version','app_version','updated'):
        check('has_'+field,bool(re.search(r'^'+field+r':\s*\S',front,re.M)),'Present nonempty field')
    check('no_harness_keys',not re.search(r'^\s*(tools|model|allowed-tools):',front,re.M),'No forbidden keys at any indentation')
    check('has_changelog',(SK/'CHANGELOG.md').is_file(),'Sibling file exists')
    check('scope_heading',bool(re.search(r'^#+\s.*When NOT To Use',text,re.M|re.I)),'Required scope heading')
    check('deferred_heading',bool(re.search(r'^#+\s.*(?:Deferred|Do Not Say)',text,re.M|re.I)),'Required deferred heading')
    check('routing_budget',len(text.splitlines())<=120,f'{len(text.splitlines())} lines; adopted router budget <=120')
    refs=text.split('## Key References',1)[1].strip().splitlines()
    tree=next((p for p in SK.parents if (p/'.claude/skills'/SK.name)==SK),None)
    for row in refs:
        if row.startswith('- '):
            path=row[2:].strip().strip('`').split()[0]
            absolute=Path(path).is_absolute()
            resolved=Path(path) if absolute else tree/path
            contained=absolute or (path.startswith('.claude/') and tree in resolved.resolve().parents)
            check('reference:'+path,contained and resolved.exists(),'Co-shipped/absolute shape and actual disk resolution')
    dep=re.search(r'^depends_on:\s*\n(.*)',front,re.M|re.S)
    if dep:
        body=dep.group(1)
        check('dependency_id',bool(re.search(r'^\s+- id: [a-z][a-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9._-]*\s*$',body,re.M)),'Block mapping with typed ID')
        check('dependency_carrier_xor',len(re.findall(r'^\s+(?:snapshot|provenance_sha):',body,re.M))==1,'Exactly one pinned currency carrier')
        check('dependency_commands',bool(re.search(r'^\s+locator:',body,re.M)) and bool(re.search(r'^\s+verifier:',body,re.M)),'Commands declared; execution checked separately')
    mirror=tree/'.agents/skills'/SK.name
    if not (tree/'.agents/skills').exists():
        rows.append({'check':'mirror','status':'not_applicable','evidence':'No mirror tree in this staged package; no generated mirror was authored'})
    elif (tree/'.agents/skills/DEPRECATED.md').exists() or (mirror/'DEPRECATED.md').exists():
        rows.append({'check':'mirror','status':'not_applicable','evidence':'Deprecated mirror sentinel'})
    else:
        names=lambda p:{str(f.relative_to(p)) for f in p.rglob('*') if f.is_file() and '__pycache__' not in f.parts}
        check('mirror_names',names(SK)==names(mirror),'Read-only file name-set comparison')
    for route in (SK/'routes').glob('*.md'):
        check('route_budget:'+route.name,len(route.read_text().splitlines())<=250,'Route <=250 lines')
    return {'status':'pass' if all(r['status']!='fail' for r in rows) else 'fail',
            'kind':'supplemental_static_preflight_not_canonical_validator',
            'official_skill_dev_validator':'not_run_not_supplied','checks':rows}

if __name__=='__main__':
    report=inspect();print(json.dumps(report,indent=2));raise SystemExit(0 if report['status']=='pass' else 1)
