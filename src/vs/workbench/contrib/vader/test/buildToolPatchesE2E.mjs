#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// VS Code's build tooling depends on three packages whose advisories have NO upstream fix (every released version is affected), so Vader carries
// small patched copies in build/stubs and points the dependency tree at them (package.json overrides): extract-zip (symlink path traversal),
// sprintf-js (unbounded width/precision) and decode-uri-component (the fixed 0.5.0 is ESM-only, the consumers need CommonJS). braces has its own
// test, bracesPatchE2E. Each patch is checked here for both halves: the hostile input is stopped, and ordinary use is unchanged.
//
// Run: node src/vs/workbench/contrib/vader/test/buildToolPatchesE2E.mjs   (needs python3 to craft a zip with a symlink entry; build/ dependencies installed)

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const require = createRequire(import.meta.url);
const stubs = path.join(repo, 'build/stubs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-bt-'));
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const versionOf = (d) => JSON.parse(fs.readFileSync(path.join(stubs, d, 'package.json'), 'utf8')).version;

// ---------------------------------------------------------------- sprintf-js
const { sprintf } = require(path.join(stubs, 'sprintf-js'));
check('sprintf-js: ordinary formatting is unchanged', sprintf('%5.2f|%s|%05d|%x', 3.14159, 'x', 42, 255) === ' 3.14|x|00042|ff');
let t = Date.now(), threw = null; try { sprintf('%.99999999999f', 1); } catch (e) { threw = e; }
check('sprintf-js: an absurd precision is rejected at once instead of allocating gigabytes', threw instanceof SyntaxError && Date.now() - t < 200, String(threw));
threw = null; try { sprintf('%999999999s', 'a'); } catch (e) { threw = e; }
check('sprintf-js: an absurd width is rejected too', threw instanceof SyntaxError);
check('sprintf-js: width and precision up to 10000 still work', sprintf('%.5000s', 'a'.repeat(6000)).length === 5000);
check('sprintf-js: versioned above the vulnerable range', versionOf('sprintf-js') === '1.1.4');

// ---------------------------------------------------------------- decode-uri-component
const decode = require(path.join(stubs, 'decode-uri-component'));
check('decode-uri-component: loads with require() and decodes', typeof decode === 'function' && decode('%E4%BD%A0%E5%A5%BD') === '你好' && decode('a%20b') === 'a b');
check('decode-uri-component: malformed input is decoded as far as possible, not thrown on', decode('%E0%A4%A') === '%E0%A4%A' && decode('%') === '%');
t = Date.now(); decode('%E0%A4'.repeat(200_000) + '%');
check('decode-uri-component: a long run of broken escapes is linear time (the advisory is exponential)', Date.now() - t < 1500, `${Date.now() - t} ms`);
check('decode-uri-component: versioned at the fixed release', versionOf('decode-uri-component') === '0.5.0');

// ---------------------------------------------------------------- extract-zip
const mkZip = (file, entries) => execFileSync('python3', ['-c', `
import zipfile, sys, json
entries = json.loads(sys.argv[2])
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    for name, data, link in entries:
        i = zipfile.ZipInfo(name)
        if link:
            i.create_system = 3; i.external_attr = (0o120777 << 16)
        else:
            i.create_system = 3; i.external_attr = (0o100644 << 16)
        z.writestr(i, data)
`, file, JSON.stringify(entries)]);
const extract = require(path.join(stubs, 'extract-zip'));
const outDir = (n) => { const d = path.join(tmp, n); fs.mkdirSync(d, { recursive: true }); return d; };
mkZip(path.join(tmp, 'ok.zip'), [['dir/a.txt', 'hello', false], ['dir/link', 'a.txt', true]]);
const okDir = outDir('ok'); await extract(path.join(tmp, 'ok.zip'), { dir: okDir });
check('extract-zip: an ordinary archive with a symlink inside the directory extracts', fs.readFileSync(path.join(okDir, 'dir/a.txt'), 'utf8') === 'hello' && fs.readlinkSync(path.join(okDir, 'dir/link')) === 'a.txt');
mkZip(path.join(tmp, 'evil.zip'), [['escape', '../../outside', true]]);
let err = null; try { await extract(path.join(tmp, 'evil.zip'), { dir: outDir('evil') }); } catch (e) { err = e; }
check('extract-zip: a symlink pointing outside the extraction directory is refused', !!err && /Out of bound symlink/.test(err.message), String(err));
check('extract-zip: ...and was not created', !fs.existsSync(path.join(tmp, 'evil', 'escape')));
mkZip(path.join(tmp, 'abs.zip'), [['etc', '/etc', true]]);
err = null; try { await extract(path.join(tmp, 'abs.zip'), { dir: outDir('abs') }); } catch (e) { err = e; }
check('extract-zip: an absolute symlink target is refused', !!err && /Out of bound symlink/.test(err.message), String(err));
check('extract-zip: versioned above the vulnerable range', versionOf('extract-zip') === '2.0.2');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
