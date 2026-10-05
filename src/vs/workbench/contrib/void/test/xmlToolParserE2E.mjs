#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Regression test for the XML tool-call parser that models without native tool calling depend on, using the REAL
// parser bundled from source. A live run found that when a model wrote a second call after the first, the second
// call's parameters overwrote the first's and the wrong call ran.
//
// Run: node src/vs/workbench/contrib/void/test/xmlToolParserE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-xml-'));
await esbuild.build({ entryPoints: [path.join(here, '../electron-main/llmMessage/extractGrammar.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'g.mjs'), logLevel: 'silent', tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }) });
const { extractXMLToolsWrapper } = await import(pathToFileURL(path.join(tmp, 'g.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

/** Streams `text` through the real wrapper in chunks of `step` characters and returns the final message. */
function run(text, step = 7) {
	let final;
	const { newOnText, newOnFinalMessage } = extractXMLToolsWrapper(() => { }, (m) => { final = m; }, 'agent', undefined);
	for (let i = step; i < text.length + step; i += step) { newOnText({ fullText: text.slice(0, Math.min(i, text.length)), fullReasoning: '' }); }
	newOnFinalMessage({ fullText: text, fullReasoning: '', anthropicReasoning: null });
	return final;
}

const call = (name, params) => `<${name}>\n${Object.entries(params).map(([k, v]) => `<${k}>${v}</${k}>`).join('\n')}\n</${name}>`;

for (const step of [1, 3, 7, 1000]) {
	const f = run(`I will read it.\n${call('read_file', { uri: '/a/notes.txt' })}`, step);
	check(`single call parses (chunks of ${step})`, f.toolCalls?.length === 1 && f.toolCalls[0].name === 'read_file' && f.toolCalls[0].rawParams.uri === '/a/notes.txt' && f.fullText.trim() === 'I will read it.', JSON.stringify(f));
}
{
	const f = run(`Reading both.\n${call('read_file', { uri: '/a/notes.txt' })}\n${call('read_file', { uri: '/a/README.md' })}`);
	check('two calls in a row: the FIRST one is executed, not the last', f.toolCalls?.[0]?.rawParams.uri === '/a/notes.txt', JSON.stringify(f.toolCalls));
	check('two calls in a row: only one call is returned', f.toolCalls?.length === 1);
}
{
	const f = run(`${call('read_file', { uri: '/a/notes.txt' })}\nThanks, and here is some trailing chatter.`);
	check('text after the call is not mixed into the parameters', f.toolCalls?.[0]?.rawParams.uri === '/a/notes.txt', JSON.stringify(f.toolCalls));
}
{
	// a parameter whose VALUE contains the tool's own closing tag must stay intact
	const body = 'doc: use </rewrite_file> to end a call\nsecond line';
	const f = run(call('rewrite_file', { uri: '/a/doc.md', new_content: body }));
	check('a parameter value containing the closing tag text is preserved', f.toolCalls?.[0]?.rawParams.new_content === body && f.toolCalls?.[0]?.rawParams.uri === '/a/doc.md', JSON.stringify(f.toolCalls?.[0]?.rawParams));
}
{
	const sr = '<<<<<<< ORIGINAL\n  return a - b;\n=======\n  return a + b;\n>>>>>>> UPDATED';
	const f = run(`Fix:\n${call('edit_file', { uri: '/a/app.js', search_replace_blocks: sr })}`);
	check('a multi-line edit_file parameter round-trips exactly', f.toolCalls?.[0]?.rawParams.search_replace_blocks === sr, JSON.stringify(f.toolCalls?.[0]?.rawParams));
}
{
	const f = run('Just an answer with no tool at all.');
	check('plain text has no tool call', !f.toolCalls?.length && f.fullText === 'Just an answer with no tool at all.');
}
{
	const f = run('Let me look.\n<ls_dir>\n</ls_dir>');
	check('a call with no parameters parses', f.toolCalls?.[0]?.name === 'ls_dir', JSON.stringify(f.toolCalls));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
