#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of auditing the Cline typings shim (docs/integrations/agent-runtime.md).
// src/tsconfig.json redirects the `@cline/agents`/`@cline/shared` bare specifiers to two
// hand-transcribed local .d.ts files (src/typings/cline-{agents,shared}.d.ts) because the real
// packages' own shipped .d.ts files use extensionless relative imports invalid under this
// project's `nodenext` moduleResolution. That shim is only correct for the exact package
// version it was transcribed from (CLINE_AGENTS_VERSION/CLINE_SHARED_VERSION in
// clineRuntimeAdapter.ts). This script is the automated guard the audit asked for: it fails
// loudly, with a non-zero exit code, the moment `npm install` brings in a different version of
// either package than what the shim was written against - so drift is a visible CI/local
// failure, never a silent divergence between the real API and what TypeScript believes it is.
//
// Run: node src/vs/workbench/contrib/vader/test/checkClineTypingsVersion.mjs
// (also invoked at the top of clineRuntimeSmoke.mjs, so the ordinary smoke-test run catches it too)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../../../..');

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function readDeclaredVersion(constName) {
	const src = readFileSync(resolve(repoRoot, 'src/vs/workbench/contrib/vader/browser/agentRuntime/clineRuntimeAdapter.ts'), 'utf8');
	const match = src.match(new RegExp(`export const ${constName} = '([^']+)'`));
	if (!match) throw new Error(`Could not find ${constName} in clineRuntimeAdapter.ts - has it been renamed?`);
	return match[1];
}

function checkPackage(pkgName, constName) {
	const installedVersion = readJson(resolve(repoRoot, `node_modules/${pkgName}/package.json`)).version;
	const declaredVersion = readDeclaredVersion(constName);
	if (installedVersion !== declaredVersion) {
		console.error(
			`FAIL: ${pkgName} version mismatch.\n` +
			`  installed:  ${installedVersion}\n` +
			`  shim built for (clineRuntimeAdapter.ts's ${constName}): ${declaredVersion}\n\n` +
			`The hand-transcribed src/typings/${pkgName.replace('@cline/', 'cline-')}.d.ts shim was written against ${declaredVersion}'s real API.\n` +
			`Before trusting the build: re-read node_modules/${pkgName}/dist/*.d.ts, update the shim to match ` +
			`the new version's real exports, then update ${constName} in clineRuntimeAdapter.ts to ${installedVersion}.\n` +
			`See docs/integrations/agent-runtime.md's "The tsconfig.json typings shim" section.`
		);
		return false;
	}
	console.log(`PASS: ${pkgName}@${installedVersion} matches the version the typings shim was written for.`);
	return true;
}

const agentsOk = checkPackage('@cline/agents', 'CLINE_AGENTS_VERSION');
const sharedOk = checkPackage('@cline/shared', 'CLINE_SHARED_VERSION');

if (!agentsOk || !sharedOk) {
	process.exitCode = 1;
}
