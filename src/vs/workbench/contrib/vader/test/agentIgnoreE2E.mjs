#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The list of files the agent must not see (common/agentIgnore.ts, the text of `.vaderignore`).
// Run: node src/vs/workbench/contrib/vader/test/agentIgnoreE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-agentignore-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/agentIgnore.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const A = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

check('the file is .vaderignore', A.AGENT_IGNORE_FILE === '.vaderignore');
check('a path below the root is made relative, one outside is not', A.relativeTo('/p', '/p/a/b.ts') === 'a/b.ts' && A.relativeTo('/p', '/q/a.ts') === undefined && A.relativeTo('/p', '/pp/a.ts') === undefined && A.relativeTo('/p', '/p') === '');
check('Windows paths: backslashes, a trailing slash and another letter case', A.relativeTo('C:\\Work\\App\\', 'c:\\work\\app\\src\\x.ts') === 'src/x.ts');

const root = '/p';
const ig = A.makeAgentIgnore(root, '# keep the client code away from the model\nclient/\n*.pem\nsecrets.txt\n\n!client/public/\ndocs/internal/**\n');
check('a folder on the list blocks everything in it', ig.blocks('/p/client/a.ts') && ig.blocks('/p/client/deep/er/b.ts') && ig.blocks('/p/client', true));
check('a pattern blocks a kind of file anywhere, and a name blocks that file', ig.blocks('/p/keys/server.pem') && ig.blocks('/p/secrets.txt') && ig.blocks('/p/a/b/secrets.txt'));
check('what is not listed is not blocked', !ig.blocks('/p/src/a.ts') && !ig.blocks('/p/clientele.ts') && !ig.blocks('/p/docs/readme.md'));
check('a path that matches a ** pattern is blocked', ig.blocks('/p/docs/internal/a/b.md'));
check('comments and blank lines are not patterns', !A.makeAgentIgnore(root, '# a comment\n\n   \n').blocks('/p/anything.ts') && A.makeAgentIgnore(root, '# only a comment') === A.NOTHING_IGNORED);
check('Windows line ends in the file work', A.makeAgentIgnore(root, 'a.txt\r\nb/\r\n').blocks('/p/a.txt') && A.makeAgentIgnore(root, 'a.txt\r\nb/\r\n').blocks('/p/b/c.ts'));
check('a file outside the project, or the project folder itself, is never blocked by it', !ig.blocks('/q/client/a.ts') && !ig.blocks('/p') && !ig.blocks('/p/'));
check('a folder rule with a slash does not block a file of that name', !A.makeAgentIgnore(root, 'build/\n').blocks('/p/build'));
check('an empty file blocks nothing', A.makeAgentIgnore(root, '') === A.NOTHING_IGNORED && !A.NOTHING_IGNORED.blocks('/p/x'));
{
	const m = A.blockedMessage('src/secret.ts');
	check('the agent is told that the file is listed, not to look for another way, and what to ask the user', m.includes('src/secret.ts is listed in .vaderignore') && m.includes('Do not try another way') && m.includes('ask them to take it out'));
}

// ---- what Settings says about the file
check('comments and blank lines are not patterns, a negation is', A.countIgnorePatterns('# a note\nsecrets/\n\n*.pem\n!keep.pem\n') === 3 && A.countIgnorePatterns('') === 0 && A.countIgnorePatterns('# only a note\n') === 0);
check('the template a new file starts with has no pattern of its own, so it blocks nothing until the person edits it', A.countIgnorePatterns(A.AGENT_IGNORE_TEMPLATE) === 0 && A.makeAgentIgnore(root, A.AGENT_IGNORE_TEMPLATE) === A.NOTHING_IGNORED);

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
