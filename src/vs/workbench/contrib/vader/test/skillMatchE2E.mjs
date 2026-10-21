#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Which skills a task uses (common/skillMatch.ts).
// Run: node src/vs/workbench/contrib/vader/test/skillMatchE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-skillmatch-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/skillMatch.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

const pdf = { id: 'pdf', name: 'pdf', description: 'Use when you need to read, fill in or create PDF forms and documents.' };
const xlsx = { id: 'xlsx', name: 'xlsx', description: 'Use this skill for spreadsheets: reading, editing and creating Excel workbooks.' };
const brand = { id: 'brand', name: 'brand-guidelines', description: 'Applies the company brand colours and typography to documents and slides.' };
const skills = [pdf, xlsx, brand];

check('a skill whose name is said in the message is used', M.selectSkills(skills, 'Fill in this PDF form for me').used.map(s => s.id).join() === 'pdf');
check('@name asks for it by name', M.selectSkills(skills, 'use @xlsx here').used.map(s => s.id).join() === 'xlsx');
check('a plural of the name is the same word', M.selectSkills(skills, 'merge these pdfs').used.map(s => s.id).join() === 'pdf');
check('a word that only begins like the name is not the name', M.selectSkills(skills, 'open the pdfium source').used.length === 0);
check('a task that fits what a skill says it is for uses it, without the name being said', M.selectSkills(skills, 'Edit the Excel workbook and fix the spreadsheet formulas').used.map(s => s.id).join() === 'xlsx', JSON.stringify(M.selectSkills(skills, 'Edit the Excel workbook and fix the spreadsheet formulas').used.map(s => s.id)));
check('a name made of two words is used when both are said', M.selectSkills(skills, 'check the brand guidelines on this slide').used.map(s => s.id).join() === 'brand');
check('a task that has nothing to do with any skill uses none', M.selectSkills(skills, 'Add a rate limiter to the API server').used.length === 0);
check('one word in common is not enough', M.selectSkills(skills, 'create a new document about colours').used.length === 0);
check('the skills not used are the others', M.selectSkills(skills, 'Fill in this PDF').others.map(s => s.id).join() === 'xlsx,brand');
check('a pinned skill is always used', M.selectSkills([{ ...pdf, pinned: true }, xlsx], 'Add a rate limiter').used.map(s => s.id).join() === 'pdf');
check('at most three matched skills are used, the best first', (() => { const many = ['a1', 'a2', 'a3', 'a4'].map(n => ({ id: n, name: n, description: 'x' })); return M.selectSkills(many, 'a1 a2 a3 a4').used.length === 3; })());
check('the reason is the purpose of the skill as a short phrase', M.reasonOf(pdf.description) === 'to read, fill in or create PDF forms and documents' && M.reasonOf(xlsx.description) === 'for spreadsheets' && M.reasonOf(brand.description) === 'to apply the company brand colours and typography to documents and slides'.slice(0, 55) + '\u2026' || M.reasonOf(brand.description).startsWith('to apply the company brand'), [M.reasonOf(pdf.description), M.reasonOf(xlsx.description), M.reasonOf(brand.description)].join(' | '));
check('a verb in the third person is put in its plain form', M.reasonOf('Fills in forms.') === 'to fill in forms' && M.reasonOf('Creates slides.') === 'to create slides' && M.reasonOf('Applies a theme.') === 'to apply a theme' && M.reasonOf('Reads files.') === 'to read files');
check('a long purpose is cut', M.reasonOf('Use when ' + 'word '.repeat(40)).length <= 56);
check('the line says which skill, in the singular and the plural', M.usedSkillsLine([{ name: 'pdf' }]) === 'Used the skill pdf' && M.usedSkillsLine([{ name: 'pdf' }, { name: 'xlsx' }, { name: 'docx' }]) === 'Used the skills pdf, xlsx and docx' && M.usedSkillsLine([]) === '');
{
	const text = M.skillPrompt([{ name: 'pdf', instructions: 'Do the PDF thing.' }], [{ name: 'xlsx', description: 'Spreadsheets.' }]);
	check('the model gets the used skill in full and the others by name and purpose, with how to ask for one', text.includes('### Skill: pdf\nDo the PDF thing.') && text.includes('- xlsx: Spreadsheets.') && text.includes('@xlsx') && !text.includes('Do the XLSX'));
	check('an unreviewed skill is marked so', M.skillPrompt([{ name: 'p', instructions: 'x', unverified: true }], []).includes('UNVERIFIED'));
	check('with no other skills there is no list', !M.skillPrompt([{ name: 'p', instructions: 'x' }], []).includes('Other installed skills'));
}

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
