#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the @ menu offers besides files (common/contextSources.ts).
// Run: node src/vs/workbench/contrib/vader/test/contextSourcesE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-ctxsrc-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/contextSources.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'c.mjs'), logLevel: 'silent' });
const C = await import(pathToFileURL(path.join(tmp, 'c.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

const all = C.offeredSources({ terminalLines: 40, browserUrl: 'http://localhost:5173/app', gitFiles: 3 });
check('with something in each, all three are offered with what is in them', all.map(s => `${s.name} (${s.detail})`).join(' | ') === 'Terminal output (last command) | Browser page (localhost:5173) | Git changes (3 files)', all.map(s => s.name).join());
check('a source with nothing to give is not offered', C.offeredSources({ terminalLines: 0, browserUrl: undefined, gitFiles: 0 }).length === 0 && C.offeredSources({ terminalLines: 0, browserUrl: undefined, gitFiles: 1 })[0].detail === '1 file');
check('the host of a page is what is shown, port included', C.hostAndPort('https://docs.example.com/a/b?x=1') === 'docs.example.com' && C.hostAndPort('not a url') === 'not a url');
check('files are counted from git’s own summary line', C.filesInStat(' a.ts | 2 +-\n b.ts | 4 ++--\n 2 files changed, 3 insertions(+), 3 deletions(-)') === 2 && C.filesInStat(' a.ts | 2 +-\n b.ts | 4 ++--\n c.ts | 1 +') === 3 && C.filesInStat('') === 0);
check('a text that fits is kept whole', JSON.stringify(C.clipContext('abc', 'git')) === JSON.stringify({ text: 'abc', cut: false }));
{
	const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
	const t = C.clipContext(lines, 'terminal', 1000);
	check('long terminal output keeps its newest lines and says the older ones were left out', t.cut && t.text.startsWith('(earlier lines left out)\n') && t.text.endsWith('line 4999') && t.text.length < 1100);
	const g = C.clipContext(lines, 'git', 1000);
	check('long changes or a long page keep their start and say the rest was left out', g.cut && g.text.startsWith('line 0') && g.text.endsWith('(the rest is left out)') && g.text.length < 1100);
	check('a cut never lands inside a line', !/line \d+\n\(the rest/.test(g.text) || g.text.split('\n').slice(0, -1).every(l => /^line \d+$/.test(l)));
}
check('the heading of each source', C.sourceTitle('terminal') === 'Terminal output' && C.sourceTitle('git') === 'Git changes' && C.sourceTitle('browser', 'localhost:5173') === 'Browser page (localhost:5173)');
check('an attachment goes into the message under its heading, in a block', C.attachmentBlock('Git changes', 'diff') === 'Git changes:\n```\ndiff\n```' && C.attachmentBlock(undefined, 'x') === '```\nx\n```');
check('a chip says its size', C.describeAttachment('a\nb\nc') === '3 lines, 5 characters' && C.describeAttachment('x'.repeat(9500)) === '1 line, 10K characters');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
