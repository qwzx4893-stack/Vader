#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The agent's browser (Playwright Chromium) must not phone home. Chromium honours only the LAST `--disable-features` switch, and
// Vader's replaces Playwright's, so Vader's list has to contain every feature Playwright turns off - otherwise upgrading Playwright
// silently re-enables something it disabled. This test reads both lists from source and fails on any drift. (The runtime side -
// no connection to a Google host while the agent browses - is the privacy group of the real-app suite, e2e/scenarios/privacy.mjs.)
//
// Run: node src/vs/workbench/contrib/void/test/browserPrivacyArgsE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../electron-main/browserToolMainService.ts'), 'utf8');
const pwDir = path.dirname(require.resolve('playwright-core/package.json'));
const bundle = fs.readFileSync(path.join(pwDir, 'lib/coreBundle.js'), 'utf8');

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

const listOf = (text, startMarker) => {
	const i = text.indexOf(startMarker); if (i < 0) { return null; }
	const j = text.indexOf(']', i);
	return [...text.slice(i, j).replace(/\/\/[^\n]*/g, '').matchAll(/["']([A-Za-z0-9_]+)["']/g)].map(m => m[1]);
};

const playwrightDisabled = listOf(bundle, 'disabledFeatures = [');
const ours = listOf(src, 'const PLAYWRIGHT_DISABLED_FEATURES = [');
const extra = listOf(src, 'const PRIVACY_DISABLED_FEATURES = [');

check('could read Playwright\'s disabled-feature list', !!playwrightDisabled && playwrightDisabled.length > 5, `found ${playwrightDisabled?.length}`);
check('could read Vader\'s lists', !!ours && !!extra && extra.length >= 5);
const missing = (playwrightDisabled ?? []).filter(f => !(ours ?? []).includes(f));
check('every feature Playwright disables is also disabled by Vader', missing.length === 0, `missing: ${missing.join(', ')}`);
const stale = (ours ?? []).filter(f => !(playwrightDisabled ?? []).includes(f));
check('Vader\'s copy has no feature Playwright no longer lists', stale.length === 0, `stale: ${stale.join(', ')}`);
check('autofill crowdsourcing and network-time queries are disabled', ['AutofillServerCommunication', 'NetworkTimeServiceQuerying'].every(f => (extra ?? []).includes(f)));
check('exactly one --disable-features switch is built', (src.match(/--disable-features=/g) ?? []).length === 1);
check('the autofill server is pointed at a dead port', /--autofill-server-url=http:\/\/127\.0\.0\.1:9/.test(src));
check('both browser launches use the privacy args', (src.match(/args: BROWSER_PRIVACY_ARGS/g) ?? []).length === 2);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
