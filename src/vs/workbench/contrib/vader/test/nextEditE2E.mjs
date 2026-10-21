#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Next edit: the trail of what was just changed, the request to the model and reading its answer, and when to ask (common/nextEdit/*), with a pretend clock.
// Run: node src/vs/workbench/contrib/vader/test/nextEditE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-nextedit-'));
const load = async (name) => {
	await esbuild.build({ entryPoints: [path.join(here, `../common/nextEdit/${name}.ts`)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, `${name}.mjs`), logLevel: 'silent' });
	return import(pathToFileURL(path.join(tmp, `${name}.mjs`)).href);
};
const { EditTrail } = await load('editTrail');
const R = await load('nextEditRequest');
const { NextEditGate } = await load('nextEditGate');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// ---- the trail
{
	const t = new EditTrail();
	const v0 = 'function area(w, h) {\n  return w * h\n}\n\nconst a = area(2, 3)\n';
	t.update('shape.ts', v0, 0);
	// typing "depth" one letter at a time is one burst
	let cur = v0;
	for (const [i, s] of ['function area(w, h, d', 'function area(w, h, de', 'function area(w, h, dep'].entries()) {
		cur = cur.replace(/^function area\(.*\) \{/m, s + ') {');
		t.update('shape.ts', cur, 100 + i * 50);
	}
	t.settle(300);
	check('a change that has not been still for a moment is not kept yet', t.entries().length === 0);
	t.settle(2000);
	check('after the file has been still the burst is one entry', t.entries().length === 1, JSON.stringify(t.entries()));
	const e = t.entries()[0];
	check('it names the file and the line and shows the old and new line', e.file === 'shape.ts' && e.line === 1 && e.lines[0] === '- function area(w, h) {' && e.lines[1].startsWith('+ function area(w, h, dep'), JSON.stringify(e));
	check('lines nobody touched are not in it', !e.lines.some(l => l.includes('const a')));
}
{
	const t = new EditTrail();
	t.update('a.ts', 'x\ny\nz\n', 0);
	t.update('a.ts', 'x\ny\nz\n', 10);
	t.settle(5000);
	check('a file that did not change leaves nothing', t.entries().length === 0);
	t.update('a.ts', 'x\nY\nz\n', 6000);
	t.update('a.ts', 'x\ny\nz\n', 6100); // typed and undone
	t.settle(9000);
	check('a change that was undone before it settled leaves nothing', t.entries().length === 0);
}
{
	const t = new EditTrail();
	const a = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
	t.update('f.ts', a, 0);
	const b = a.split('\n').map((l, i) => i === 3 || i === 30 ? l + ' changed' : l).join('\n');
	t.update('f.ts', b, 10);
	t.settle(5000);
	check('two changes far apart in one burst are two entries', t.entries().length === 2 && t.entries()[0].line === 4 && t.entries()[1].line === 31, JSON.stringify(t.entries().map(e => e.line)));
}
{
	const t = new EditTrail({ max: 3 });
	let text = 'a\n';
	t.update('g.ts', text, 0);
	for (let i = 1; i <= 6; i++) { text = `a${i}\n`; t.update('g.ts', text, i * 10_000); t.settle(i * 10_000 + 5000); }
	check('only the last few entries are kept', t.entries().length === 3 && t.entries()[2].lines[1] === '+ a6');
	const out = t.text(100_000);
	check('the text puts the oldest first', out.indexOf('+ a4') < out.indexOf('+ a6') && out.startsWith('g.ts:1'), out);
	check('and stays within the size', t.text(100_000, 30).length <= 30);
	t.clear();
	check('clearing empties it', t.entries().length === 0 && t.text(0) === '');
}
{
	const t = new EditTrail();
	t.update('h.ts', 'one\n', 0);
	t.update('h.ts', 'two\n', 10);
	check('asking for the text closes a burst that is still open', t.text(20).includes('+ two'));
	t.forget('h.ts');
	t.update('h.ts', 'three\n', 30);
	t.settle(10_000);
	check('a file that was forgotten starts over', t.entries().length === 1);
}

// ---- the request
const file = Array.from({ length: 100 }, (_, i) => `row ${i + 1}`);
{
	const q = R.buildRequest({ file: 'src/a.ts', languageId: 'typescript', lines: file, caretLine: 50, caretColumn: 4, trail: 'src/a.ts:12\n- foo\n+ bar' });
	check('the region is a few lines above the caret and more below', q.regionStart === 46 && q.regionEnd === 60 && q.regionText.split('\n').length === 15, `${q.regionStart}-${q.regionEnd}`);
	check('the caret is marked at its column', q.user.includes('row<|cursor|> 50'));
	const idx = q.user.indexOf('<|cursor|>');
	check('exactly one cursor marker, inside the region', q.user.split('<|cursor|>').length === 2 && idx > q.user.indexOf('<editable_region_start>') && idx < q.user.indexOf('<editable_region_end>'));
	check('the region is not marked with the cursor in what is compared', !q.regionText.includes('<|cursor|>'));
	check('the window around it has 60 lines above and 40 below', q.user.includes('lines 1-90 of 100'), /lines \d+-\d+ of 100/.exec(q.user)?.[0]);
	check('the recent edits come first', q.user.startsWith('Recent edits (oldest first):\nsrc/a.ts:12'));
	check('the system prompt says how to say there is nothing to change', q.system.includes('NO_EDIT') && q.system.includes('editable region'));
	const top = R.buildRequest({ file: 'a', languageId: 'ts', lines: ['only', 'two'], caretLine: 1, caretColumn: 1, trail: '' });
	check('near the start of a short file nothing goes out of range', top.regionStart === 1 && top.regionEnd === 2 && !top.user.startsWith('Recent edits'));
	const beyond = R.buildRequest({ file: 'a', languageId: 'ts', lines: file, caretLine: 500, caretColumn: 1, trail: '' });
	check('a caret past the end is taken as the last line', beyond.regionEnd === 100);
}
{
	const win = R.buildRequest({ file: 'a', languageId: 'ts', lines: file, caretLine: 50, caretColumn: 1, trail: '' }).user;
	check('the window is cut where the file starts', /lines 1-90 of 100/.test(win));
}

// ---- reading the answer
const region = 'const a = 1\nconst b = 2\nconst c = 3';
check('a new text for the region is taken', R.parseAnswer('const a = 1\nconst b = 20\nconst c = 3', region).text === 'const a = 1\nconst b = 20\nconst c = 3');
check('a fenced answer is taken without the fence', R.parseAnswer('```ts\nconst a = 1\nconst b = 20\nconst c = 3\n```', region).text === 'const a = 1\nconst b = 20\nconst c = 3');
check('markers the model repeated are removed', R.parseAnswer('<editable_region_start>\nconst a = 1\nconst b<|cursor|> = 20\nconst c = 3\n<editable_region_end>', region).text === 'const a = 1\nconst b = 20\nconst c = 3');
check('NO_EDIT means there is no suggestion', R.parseAnswer('NO_EDIT', region).none !== undefined && R.parseAnswer('  NO_EDIT\n', region).none !== undefined && R.parseAnswer('', region).none !== undefined);
check('the same text is no suggestion', R.parseAnswer(region, region).none === 'the answer changes nothing' && R.parseAnswer(region + '\n\n', region).none === 'the answer changes nothing');
check('a placeholder in place of code is thrown away', R.parseAnswer('const a = 1\n// ... existing code ...\nconst c = 3', region).none?.includes('placeholder') && R.parseAnswer('const a = 1\n# ...rest unchanged\n', region).none?.includes('placeholder'));
check('"..." that is real code is not a placeholder', R.parseAnswer('const a = [...items]\nconst b = 2\nconst c = 3', region).text !== undefined);
{
	const long = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
	check('an answer that deletes most of the region is thrown away', R.parseAnswer('line 0\nline 1', long).none?.includes('deletes most'));
	check('a short region may lose lines', R.parseAnswer('const a = 1', region).text === 'const a = 1');
	check('an answer far longer than the region is thrown away', R.parseAnswer(Array.from({ length: 100 }, (_, i) => `x${i}`).join('\n'), region).none?.includes('longer'));
}

// ---- from the new region to the lines that change
{
	const e = R.toLineEdit(46, 'a\nb\nc\nd', 'a\nB\nc\nd');
	check('a changed line is a replace of that line', e.kind === 'replace' && e.startLine === 47 && e.endLine === 47 && e.text === 'B', JSON.stringify(e));
	const i = R.toLineEdit(10, 'a\nb', 'a\nnew\nb');
	check('a line added is an insert before the line it goes ahead of', i.kind === 'insert' && i.beforeLine === 11 && i.text === 'new', JSON.stringify(i));
	const d = R.toLineEdit(10, 'a\nx\ny\nb', 'a\nb');
	check('lines removed are a delete of those lines', d.kind === 'delete' && d.startLine === 11 && d.endLine === 12, JSON.stringify(d));
	check('no difference is no edit', R.toLineEdit(1, 'a\nb', 'a\nb') === undefined);
	const m = R.toLineEdit(1, 'a\nb\nc\nd\ne', 'a\nB\nc\nD\ne');
	check('changes with an untouched line between them are one replace over the span', m.kind === 'replace' && m.startLine === 2 && m.endLine === 4 && m.text === 'B\nc\nD', JSON.stringify(m));
	// applying the edit to the file gives the model's text
	const whole = ['h1', 'a', 'b', 'c', 'd', 't1'];
	for (const next of ['a\nB\nc\nd', 'a\nb\nc\nd\ne', 'b\nc', 'a\nb\nc\nd\n', 'x\ny\nz']) {
		const nextClean = next.replace(/\n+$/, '');
		const edit = R.toLineEdit(2, 'a\nb\nc\nd', nextClean);
		const out = edit ? R.applyLineEdit(whole, edit) : whole;
		check(`applying the edit for "${nextClean.replace(/\n/g, '|')}" gives the model's text in the file`, out.join('\n') === ['h1', ...nextClean.split('\n'), 't1'].join('\n'), out.join('|'));
	}
}
check('a change of only blanks is not worth showing', !R.isWorthShowing('a  b', 'a b') && !R.isWorthShowing('  a\n', 'a') && R.isWorthShowing('a b', 'a c'));

// ---- when to ask
{
	const g = new NextEditGate();
	const ask = (o) => g.shouldAsk({ line: 5, selectionEmpty: true, reason: 'pause', ...o });
	g.onKeystroke(5, 1000);
	check('not while the person is still typing', !ask({ now: 1100 }).ok && ask({ now: 1100 }).why === 'still typing');
	check('after a pause it asks', ask({ now: 1400 }).ok);
	check('a line change needs a shorter wait than a pause', ask({ now: 1130, reason: 'line-change' }).ok && !ask({ now: 1130, reason: 'pause' }).ok);
	check('never with text selected', !ask({ now: 5000, selectionEmpty: false }).ok);
	check('never while a list of suggestions is open', !ask({ now: 5000, suggestWidgetOpen: true }).ok);
	check('a manual ask goes through whenever', ask({ now: 1001, reason: 'manual', selectionEmpty: false }).ok);
	g.asked(5000);
	check('not again within a second and a half', !ask({ now: 6000 }).ok && ask({ now: 6000 }).why === 'asked a moment ago' && ask({ now: 6600 }).ok);
}
{
	const g = new NextEditGate();
	g.onKeystroke(5, 0);
	g.onReject(5, 10_000);
	const ask = (o) => g.shouldAsk({ line: 5, selectionEmpty: true, reason: 'pause', now: 11_000, ...o });
	check('after Escape nothing is asked on that line for a while', !ask({}).ok && ask({}).why.includes('dismissed'));
	check('on another line it asks', ask({ line: 6 }).ok);
	check('after the lockout it asks again', ask({ now: 13_000 }).ok);
	g.onReject(5, 20_000);
	g.onKeystroke(9, 20_500);
	check('moving to another line ends the lockout', g.shouldAsk({ line: 5, selectionEmpty: true, reason: 'pause', now: 21_000 }).ok);
}
{
	const g = new NextEditGate({ perMinute: 3, minIntervalMs: 100 });
	g.onKeystroke(1, 0);
	let now = 1000;
	for (let i = 0; i < 3; i++) { g.asked(now); now += 1000; }
	const r = g.shouldAsk({ line: 1, selectionEmpty: true, reason: 'pause', now });
	check('at most the set number of asks a minute', !r.ok && r.why.includes('per minute'));
	check('and the count is told', g.askedInLastMinute(now) === 3);
	check('a minute later it asks again', g.shouldAsk({ line: 1, selectionEmpty: true, reason: 'pause', now: now + 60_000 }).ok && g.askedInLastMinute(now + 60_000) === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
