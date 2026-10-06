#!/usr/bin/env python3
# Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
#
# Objective, repeatable code-quality measurements, computed the SAME way for Vader and for comparable open-source agent projects, so the numbers
# can be put side by side. Nothing here judges taste: every figure is a count or a ratio from a tool, and each project's own source roots
# are listed in PROJECTS so the scope is visible.
#
#   size          source files, non-comment lines of code (lizard), functions
#   complexity    mean and 95th-percentile cyclomatic complexity per function, share of functions above 15 and above 25, longest function,
#                 files above 1000 lines
#   type safety   explicit `any` and suppression comments (ts-ignore, eslint-disable, biome-ignore) per 1000 lines
#   duplication   share of duplicated lines (jscpd)
#   tests         test lines per source line, number of test files
#   security      Semgrep findings of the community security rules per 1000 lines (same rule set for every project)
#   process       CI workflows, SECURITY.md, CODEOWNERS, dependency-update bot, CodeQL, lockfile
#
# Usage:  python3 quality_compare.py --out results.json [--only name,name] [--no-semgrep] [--no-jscpd]
# Needs:  pip install lizard   (and semgrep with the community rules for --semgrep-rules, and node/npx for jscpd)

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile

SRC_EXT = ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs')
SKIP_DIRS = {'node_modules', 'dist', 'build', 'out', '.git', '.next', 'coverage', 'vendor', '__snapshots__', 'storybook-static', 'src2', 'clineBundle'}
TEST_RE = re.compile(r'(\.test\.|\.spec\.|__tests__|(^|/)tests?(/|$)|(^|/)e2e(/|$)|(^|/)fixtures?(/|$)|(^|/)mocks?(/|$)|(^|/)evals?(/|$))')
GENERATED_RE = re.compile(r'(providerModelData\.ts|\.generated\.|\.min\.js|/generated/|-bundle\.js|bundle/index\.js)')

# name -> (root of the checkout, source roots relative to it, kind)
PROJECTS = {
    'Vader': ('/home/user/vader-upgrade', ['src/vs/workbench/contrib/void'], 'VS Code fork + agent platform'),
    'Void (Vader\'s origin)': ('/tmp/void-upstream', ['src/vs/workbench/contrib/void'], 'VS Code fork + agent'),
    'Cline': ('/tmp/peers/cline', ['sdk', 'apps'], 'agent SDK + VS Code/CLI apps'),
    'Roo Code': ('/tmp/peers/Roo-Code', ['src', 'webview-ui/src', 'packages', 'apps/cli'], 'VS Code extension agent'),
    'Continue': ('/tmp/peers/continue', ['core', 'gui/src', 'extensions/vscode/src', 'packages'], 'IDE extension + core'),
    'opencode': ('/tmp/peers/opencode', ['packages/opencode', 'packages/core', 'packages/llm', 'packages/server', 'packages/tui', 'packages/ui', 'packages/app'], 'terminal agent + desktop'),
}


def walk(root, rels):
    for rel in rels:
        base = os.path.join(root, rel)
        for d, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            for f in files:
                if f.endswith(SRC_EXT) and not f.endswith('.d.ts'):
                    p = os.path.join(d, f)
                    relp = os.path.relpath(p, root).replace(os.sep, '/')
                    if GENERATED_RE.search(relp):
                        continue
                    yield p, relp


def percentile(values, q):
    if not values:
        return 0
    values = sorted(values)
    return values[min(len(values) - 1, int(round(q * (len(values) - 1))))]


def lizard_stats(paths):
    import lizard
    funcs, nloc_files, nloc_total = [], [], 0
    for p in paths:
        try:
            r = lizard.analyze_file(p)
        except Exception:
            continue
        nloc_total += r.nloc
        nloc_files.append(r.nloc)
        for fn in r.function_list:
            funcs.append((fn.cyclomatic_complexity, fn.nloc))
    ccn = [c for c, _ in funcs]
    return {
        'nloc': nloc_total,
        'files_over_1000_nloc': sum(1 for n in nloc_files if n > 1000),
        'largest_file_nloc': max(nloc_files) if nloc_files else 0,
        'functions': len(funcs),
        'ccn_mean': round(statistics.mean(ccn), 2) if ccn else 0,
        'ccn_p95': percentile(ccn, 0.95),
        'pct_ccn_over_15': round(100 * sum(1 for c in ccn if c > 15) / len(ccn), 2) if ccn else 0,
        'pct_ccn_over_25': round(100 * sum(1 for c in ccn if c > 25) / len(ccn), 2) if ccn else 0,
        'longest_function_nloc': max((n for _, n in funcs), default=0),
        'pct_functions_over_100_nloc': round(100 * sum(1 for _, n in funcs if n > 100) / len(funcs), 2) if funcs else 0,
    }


ANY_RE = re.compile(r'(:\s*any\b|\bas any\b|<any>|\bany\[\]|\bany\s*=>|Array<any>|Record<[^,>]+,\s*any>)')
SUPPRESS_RE = re.compile(r'(@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|biome-ignore|tslint:disable)')


def regex_counts(paths):
    any_n = sup_n = lines = 0
    for p in paths:
        try:
            text = open(p, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        lines += text.count('\n') + 1
        any_n += len(ANY_RE.findall(text))
        sup_n += len(SUPPRESS_RE.findall(text))
    return any_n, sup_n, lines


def strictness(root):
    """compiler strictness flags found in the tsconfig files of the project (text search, so comments and `extends` do not matter)"""
    found = {}
    for dp, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and x not in ('docs', 'docs-site', 'test', 'tests', 'e2e', 'evals', 'eval', 'extensions', 'scripts', 'build')]
        depth = os.path.relpath(dp, root).count(os.sep)
        if depth > 3:
            dirs[:] = []
            continue
        for f in files:
            if f.startswith('tsconfig') and f.endswith('.json'):
                try:
                    text = open(os.path.join(dp, f), encoding='utf-8', errors='ignore').read()
                except OSError:
                    continue
                for flag in ('strict', 'noImplicitAny', 'strictNullChecks', 'noUncheckedIndexedAccess'):
                    m = re.search(r'"%s"\s*:\s*(true|false)' % flag, text)
                    if m:
                        found.setdefault(flag, set()).add(m.group(1))
    return {k: sorted(v) for k, v in found.items()}


def process_signals(root):
    def exists(*ps):
        return any(os.path.exists(os.path.join(root, p)) for p in ps)
    wf_dir = os.path.join(root, '.github', 'workflows')
    wfs = [f for f in os.listdir(wf_dir) if f.endswith(('.yml', '.yaml'))] if os.path.isdir(wf_dir) else []
    codeql = any('codeql' in f.lower() for f in wfs) or exists('.github/codeql')
    if not codeql:
        for f in wfs:
            try:
                if 'codeql' in open(os.path.join(wf_dir, f), encoding='utf-8', errors='ignore').read().lower():
                    codeql = True
            except OSError:
                pass
    return {
        'ci_workflows': len(wfs),
        'security_policy': exists('SECURITY.md', '.github/SECURITY.md'),
        'codeowners': exists('CODEOWNERS', '.github/CODEOWNERS'),
        'dependency_bot': exists('.github/dependabot.yml', 'renovate.json', '.github/renovate.json'),
        'codeql': codeql,
        'lockfile': exists('package-lock.json', 'pnpm-lock.yaml', 'bun.lock', 'yarn.lock'),
        'agents_md_or_architecture': exists('AGENTS.md', 'ARCHITECTURE.md', 'CLAUDE.md'),
    }


def jscpd_percent(root, rels):
    out = tempfile.mkdtemp(prefix='jscpd-')
    cmd = ['npx', '--yes', 'jscpd@4', '--silent', '--reporters', 'json', '--output', out, '--no-gitignore', '--min-tokens', '70', '--min-lines', '8', '--max-size', '300kb', '--mode', 'mild',
           '--format', 'typescript,tsx,javascript,jsx', '--ignore', '**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/*.d.ts,**/src2/**,**/test/**,**/tests/**,**/__tests__/**,**/*.test.*,**/*.spec.*,**/e2e/**,**/fixtures/**,**/evals/**,**/eval/**,**/providerModelData.ts,**/clineBundle/**,**/generated/**']
    cmd += [os.path.join(root, r) for r in rels]
    try:
        subprocess.run(cmd, check=False, capture_output=True, timeout=2400, env=dict(os.environ, NODE_OPTIONS='--max-old-space-size=8192'))
        data = json.load(open(os.path.join(out, 'jscpd-report.json')))
        t = data['statistics']['total']
        return {'duplicated_lines_pct': t['percentage'], 'clones': t['clones'], 'duplicated_lines': t['duplicatedLines'], 'lines_scanned': t['lines']}
    except Exception as e:  # noqa: BLE001
        return {'error': str(e)[:120]}


def semgrep_counts(root, rels, rules, nloc):
    out = tempfile.mktemp(suffix='.sarif')
    excl = []
    for pat in ('node_modules', 'dist', 'build', 'out', 'src2', 'test', 'tests', '__tests__', 'e2e', 'fixtures', 'evals', 'eval', 'clineBundle', '*.test.*', '*.spec.*', '*.d.ts', 'providerModelData.ts', 'generated'):
        excl += ['--exclude', pat]
    cmd = [os.environ.get('SEMGREP') or os.path.join(os.path.dirname(sys.executable), 'semgrep'), 'scan', '--metrics=off', '--disable-version-check', '--quiet', '--sarif', '-o', out] + excl
    for r in rules:
        cmd += ['--config', r]
    cmd += [os.path.join(root, r) for r in rels]
    try:
        subprocess.run(cmd, check=False, capture_output=True, timeout=3000)
        res = json.load(open(out))['runs'][0]['results']
    except Exception as e:  # noqa: BLE001
        return {'error': str(e)[:120]}
    by_level = {}
    for r in res:
        by_level[r.get('level', 'warning')] = by_level.get(r.get('level', 'warning'), 0) + 1
    return {'findings': len(res), 'by_level': by_level, 'per_kloc': round(len(res) / (nloc / 1000), 2) if nloc else 0}


def measure(name, root, rels, kind, args):
    files = list(walk(root, rels))
    src = [(p, r) for p, r in files if not TEST_RE.search(r)]
    tst = [(p, r) for p, r in files if TEST_RE.search(r)]
    res = {'name': name, 'kind': kind, 'roots': rels}
    res['source_files'] = len(src)
    res.update(lizard_stats([p for p, _ in src]))
    any_n, sup_n, lines = regex_counts([p for p, _ in src])
    res['any_per_kloc'] = round(any_n / (res['nloc'] / 1000), 2) if res['nloc'] else 0
    res['suppressions_per_kloc'] = round(sup_n / (res['nloc'] / 1000), 2) if res['nloc'] else 0
    t = lizard_stats([p for p, _ in tst]) if tst else {'nloc': 0}
    res['test_files'] = len(tst)
    res['test_nloc'] = t['nloc']
    res['test_to_source_ratio'] = round(t['nloc'] / res['nloc'], 3) if res['nloc'] else 0
    res['tsconfig'] = strictness(root)
    res['process'] = process_signals(root)
    res['commit'] = subprocess.run(['git', '-C', root, 'log', '-1', '--format=%h %cs'], capture_output=True, text=True).stdout.strip()
    if not args.no_jscpd:
        res['duplication'] = jscpd_percent(root, rels)
    if not args.no_semgrep:
        res['semgrep'] = semgrep_counts(root, rels, args.semgrep_rules, res['nloc'])
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='quality_results.json')
    ap.add_argument('--only', default='')
    ap.add_argument('--no-semgrep', action='store_true')
    ap.add_argument('--no-jscpd', action='store_true')
    ap.add_argument('--refresh-duplication', action='store_true', help='only recompute the duplication figure of rows already in --out')
    ap.add_argument('--semgrep-rules', nargs='*', default=[
        '/home/user/semgrep/rules/javascript/lang/security', '/home/user/semgrep/rules/typescript/lang/security',
        '/home/user/semgrep/rules/javascript/express', '/home/user/semgrep/rules/javascript/browser/security',
        '/home/user/semgrep/rules/generic/secrets'])
    args = ap.parse_args()
    only = {x.strip() for x in args.only.split(',') if x.strip()}
    results = []
    if os.path.exists(args.out):
        results = json.load(open(args.out))
    if args.refresh_duplication:
        for r in results:
            root, rels, _ = PROJECTS[r['name']]
            print('duplication of', r['name'], file=sys.stderr, flush=True)
            r['duplication'] = jscpd_percent(root, rels)
            json.dump(results, open(args.out, 'w'), indent=1)
        return
    done = {r['name'] for r in results}
    for name, (root, rels, kind) in PROJECTS.items():
        if (only and name not in only) or (name in done and not only):
            continue
        if not os.path.isdir(root):
            print('skip (missing checkout):', name, file=sys.stderr)
            continue
        print('measuring', name, file=sys.stderr, flush=True)
        r = measure(name, root, rels, kind, args)
        results = [x for x in results if x['name'] != name] + [r]
        json.dump(results, open(args.out, 'w'), indent=1)
    print(json.dumps(results, indent=1))


if __name__ == '__main__':
    main()
