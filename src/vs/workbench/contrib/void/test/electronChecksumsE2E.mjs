#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Bumping Electron in .npmrc without refreshing build/checksums/electron.txt makes every install fail with
// "Checksum mismatch for .../electron.d.ts" (it happened: CI and the Windows build were red for it). This keeps the two in step:
// the manifest must be the one of the version .npmrc asks for, and cgmanifest.json must name the same version.
//
// Run: node src/vs/workbench/contrib/void/test/electronChecksumsE2E.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const npmrc = fs.readFileSync(path.join(repo, '.npmrc'), 'utf8');
const target = /^target="?([\d.]+)"?/m.exec(npmrc)?.[1];
const manifest = fs.readFileSync(path.join(repo, 'build/checksums/electron.txt'), 'utf8').split('\n').filter(Boolean);
const cg = JSON.parse(fs.readFileSync(path.join(repo, 'cgmanifest.json'), 'utf8'));
const electronEntry = cg.registrations.find(r => r.component?.git?.name === 'electron');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

check('.npmrc names an Electron version', !!target, String(target));
const versioned = manifest.filter(l => /-v\d+\.\d+\.\d+-/.test(l));
const wrong = versioned.filter(l => !l.includes(`-v${target}-`));
check(`every versioned entry of build/checksums/electron.txt is for ${target}`, versioned.length > 20 && wrong.length === 0, wrong.slice(0, 2).join(' | '));
check('the manifest has electron.d.ts', manifest.some(l => /\*electron\.d\.ts$/.test(l)));
check('every entry is "<sha256> *<file>"', manifest.every(l => /^[0-9a-f]{64} \*\S+$/.test(l)));
check('cgmanifest.json names the same Electron version', electronEntry?.version === target && electronEntry?.component.git.tag === target, `${electronEntry?.version}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
