/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import findUp from 'find-up';
import * as path from 'path';
import * as fs from 'fs';
import minimatch from 'minimatch';
import { Uri, workspace } from 'vscode';

interface PreferredProperties {
	isPreferred: boolean;
	hasLockfile: boolean;
}

async function pathExists(filePath: string) {
	try {
		await workspace.fs.stat(Uri.file(filePath));
	} catch {
		return false;
	}
	return true;
}

// Replaces the `find-yarn-workspace-root` and `which-pm` packages (Vader). Both pulled in a YAML parser and micromatch/braces, which have open
// denial-of-service advisories (merge-key CPU use, deeply nested braces) reachable from files in the opened workspace. What is needed here is
// small: walk up looking for a package.json with `workspaces`, and read one `packageManager:` line from node_modules/.modules.yaml.
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_PATTERN_CHARS = 200;

function readJsonFile(file: string): any | undefined {
	try {
		if (fs.statSync(file).size > MAX_MANIFEST_BYTES) {
			return undefined;
		}
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return undefined;
	}
}

function findWorkspaceRoot(initial: string): string | null {
	let previous: string | null = null;
	let current = path.normalize(initial);
	do {
		const manifest = readJsonFile(path.join(current, 'package.json'));
		const ws = manifest?.workspaces;
		const patterns: unknown = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : undefined;
		if (Array.isArray(patterns)) {
			const relativePath = path.relative(current, initial).split(path.sep).join('/');
			const matches = relativePath === '' || patterns.some(p => typeof p === 'string' && p.length <= MAX_PATTERN_CHARS && minimatch(relativePath, p));
			return matches ? current : null;
		}
		previous = current;
		current = path.dirname(current);
	} while (current !== previous);
	return null;
}

async function whichPM(pkgPath: string): Promise<{ name: string } | null> {
	const modulesPath = path.join(pkgPath, 'node_modules');
	if (await pathExists(path.join(modulesPath, '.yarn-integrity'))) {
		return { name: 'yarn' };
	}
	if (await pathExists(path.join(pkgPath, 'bun.lockb'))) {
		return { name: 'bun' };
	}
	try {
		const text = fs.readFileSync(path.join(modulesPath, '.modules.yaml'), 'utf8').slice(0, MAX_MANIFEST_BYTES);
		const m = /^packageManager:\s*['"]?(@?[^@\s'"]+)/m.exec(text);
		if (m) {
			return { name: m[1] };
		}
	} catch {
		// no .modules.yaml: fall through
	}
	return (await pathExists(modulesPath)) ? { name: 'npm' } : null;
}

async function isBunPreferred(pkgPath: string): Promise<PreferredProperties> {
	if (await pathExists(path.join(pkgPath, 'bun.lockb'))) {
		return { isPreferred: true, hasLockfile: true };
	}

	if (await pathExists(path.join(pkgPath, 'bun.lock'))) {
		return { isPreferred: true, hasLockfile: true };
	}

	return { isPreferred: false, hasLockfile: false };
}

async function isPNPMPreferred(pkgPath: string): Promise<PreferredProperties> {
	if (await pathExists(path.join(pkgPath, 'pnpm-lock.yaml'))) {
		return { isPreferred: true, hasLockfile: true };
	}
	if (await pathExists(path.join(pkgPath, 'shrinkwrap.yaml'))) {
		return { isPreferred: true, hasLockfile: true };
	}
	if (await findUp('pnpm-lock.yaml', { cwd: pkgPath })) {
		return { isPreferred: true, hasLockfile: true };
	}

	return { isPreferred: false, hasLockfile: false };
}

async function isYarnPreferred(pkgPath: string): Promise<PreferredProperties> {
	if (await pathExists(path.join(pkgPath, 'yarn.lock'))) {
		return { isPreferred: true, hasLockfile: true };
	}

	try {
		if (typeof findWorkspaceRoot(pkgPath) === 'string') {
			return { isPreferred: true, hasLockfile: false };
		}
	} catch (err) { }

	return { isPreferred: false, hasLockfile: false };
}

async function isNPMPreferred(pkgPath: string): Promise<PreferredProperties> {
	const lockfileExists = await pathExists(path.join(pkgPath, 'package-lock.json'));
	return { isPreferred: lockfileExists, hasLockfile: lockfileExists };
}

export async function findPreferredPM(pkgPath: string): Promise<{ name: string; multipleLockFilesDetected: boolean }> {
	const detectedPackageManagerNames: string[] = [];
	const detectedPackageManagerProperties: PreferredProperties[] = [];

	const npmPreferred = await isNPMPreferred(pkgPath);
	if (npmPreferred.isPreferred) {
		detectedPackageManagerNames.push('npm');
		detectedPackageManagerProperties.push(npmPreferred);
	}

	const pnpmPreferred = await isPNPMPreferred(pkgPath);
	if (pnpmPreferred.isPreferred) {
		detectedPackageManagerNames.push('pnpm');
		detectedPackageManagerProperties.push(pnpmPreferred);
	}

	const yarnPreferred = await isYarnPreferred(pkgPath);
	if (yarnPreferred.isPreferred) {
		detectedPackageManagerNames.push('yarn');
		detectedPackageManagerProperties.push(yarnPreferred);
	}

	const bunPreferred = await isBunPreferred(pkgPath);
	if (bunPreferred.isPreferred) {
		detectedPackageManagerNames.push('bun');
		detectedPackageManagerProperties.push(bunPreferred);
	}

	const pmUsedForInstallation: { name: string } | null = await whichPM(pkgPath);

	if (pmUsedForInstallation && !detectedPackageManagerNames.includes(pmUsedForInstallation.name)) {
		detectedPackageManagerNames.push(pmUsedForInstallation.name);
		detectedPackageManagerProperties.push({ isPreferred: true, hasLockfile: false });
	}

	let lockfilesCount = 0;
	detectedPackageManagerProperties.forEach(detected => lockfilesCount += detected.hasLockfile ? 1 : 0);

	return {
		name: detectedPackageManagerNames[0] || 'npm',
		multipleLockFilesDetected: lockfilesCount > 1
	};
}
