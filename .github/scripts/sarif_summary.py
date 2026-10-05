#!/usr/bin/env python3
"""Prints a readable summary of one or more SARIF files into the job log (artifacts are not always reachable).

usage: sarif_summary.py <label> <file-or-dir> [--only PREFIX ...] [--limit N]
"""
import collections, glob, json, os, sys

label, target, *rest = sys.argv[1:]
only, limit = [], 60
i = 0
while i < len(rest):
    if rest[i] == '--only':
        i += 1
        while i < len(rest) and not rest[i].startswith('--'):
            only.append(rest[i]); i += 1
    elif rest[i] == '--limit':
        limit = int(rest[i + 1]); i += 2
    else:
        i += 1

files = sorted(glob.glob(os.path.join(target, '**', '*.sarif'), recursive=True)) if os.path.isdir(target) else [target]
results = []
for f in files:
    try:
        data = json.load(open(f))
    except Exception as e:
        print(f'[{label}] cannot read {f}: {e}'); continue
    for run in data.get('runs', []):
        rules = {r['id']: r for r in run.get('tool', {}).get('driver', {}).get('rules', [])}
        for r in run.get('results', []):
            loc = (r.get('locations') or [{}])[0].get('physicalLocation', {})
            path = loc.get('artifactLocation', {}).get('uri', '?')
            if only and not any(path.startswith(p) for p in only):
                continue
            rule = rules.get(r.get('ruleId'), {})
            sev = r.get('level') or rule.get('defaultConfiguration', {}).get('level') or 'warning'
            props = rule.get('properties', {})
            results.append({
                'rule': r.get('ruleId', '?'), 'level': sev, 'path': path,
                'line': loc.get('region', {}).get('startLine', 0),
                'msg': (r.get('message', {}).get('text', '') or '').replace('\n', ' ')[:170],
                'security': props.get('security-severity', ''),
            })

print(f'===== {label}: {len(results)} findings' + (f' (paths: {", ".join(only)})' if only else ''))
by = collections.Counter((x['level'], x['rule']) for x in results)
for (lvl, rule), n in sorted(by.items(), key=lambda kv: (-kv[1])):
    print(f'{n:5}  {lvl:8} {rule}')
order = {'error': 0, 'warning': 1, 'note': 2, 'none': 3}
print('--- most severe first')
for x in sorted(results, key=lambda x: (order.get(x['level'], 9), -(float(x['security']) if x['security'] else 0)))[:limit]:
    print(f"{x['level']:8} {x['rule']}  {x['path']}:{x['line']}  {x['msg']}")
