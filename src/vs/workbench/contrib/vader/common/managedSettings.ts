/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { defaultGlobalSettings, GlobalSettings } from './vaderSettingsTypes.js';

// Settings set by an organisation (board S10, "Set by your organisation"): a file the person who manages Vader's computers puts in a place only an administrator can write,
// naming settings and the value each must have. Those settings are locked in Settings, with the lock mark and who locked them, and the app refuses to change them. A file
// that names a setting Vader does not have, or a value of the wrong kind, is ignored for that setting and the rest still applies. Pure.

export const MANAGED_SETTINGS_FILE = 'managed-settings.json';

/** where the file is looked for: a folder an administrator owns, never the user's own profile */
export function managedSettingsPath(platform: 'win32' | 'darwin' | 'linux', env: { programData?: string } = {}): string {
	if (platform === 'win32') return `${(env.programData ?? 'C:\\ProgramData').replace(/[\\/]+$/, '')}\\Vader\\${MANAGED_SETTINGS_FILE}`;
	if (platform === 'darwin') return `/Library/Application Support/Vader/${MANAGED_SETTINGS_FILE}`;
	return `/etc/vader/${MANAGED_SETTINGS_FILE}`;
}

/** the settings whose value is one plain thing (a switch, a number or none, a word): the ones an organisation can lock */
const LOCKABLE = (Object.keys(defaultGlobalSettings) as (keyof GlobalSettings)[]).filter(k => {
	const d = defaultGlobalSettings[k];
	return d === null || typeof d === 'boolean' || typeof d === 'number' || typeof d === 'string';
});

export type ManagedParse = { locked: Partial<GlobalSettings>; ignored: string[] };

export function parseManagedSettings(text: string): ManagedParse {
	const out: { [k: string]: unknown } = {};
	const ignored: string[] = [];
	let doc: unknown;
	try { doc = JSON.parse(text); } catch { return { locked: {}, ignored: ['the file is not valid JSON'] }; }
	const section = doc && typeof doc === 'object' ? (doc as { locked?: unknown }).locked : undefined;
	if (!section || typeof section !== 'object' || Array.isArray(section)) return { locked: {}, ignored: ['the file has no "locked" section'] };
	for (const [k, v] of Object.entries(section as { [k: string]: unknown })) {
		if (!(LOCKABLE as string[]).includes(k)) { ignored.push(`${k}: not a setting that can be locked`); continue; }
		const d = (defaultGlobalSettings as unknown as { [k: string]: unknown })[k];
		// a setting that is "none" by default is a number or none (the daily limit) or a word or none (the connected agent)
		const kindWhenSet = k === 'dailySpendLimitUsd' ? 'number' : 'string';
		const ok = d === null ? (v === null || typeof v === kindWhenSet) && (typeof v !== 'number' || Number.isFinite(v)) : typeof v === typeof d && (typeof v !== 'number' || Number.isFinite(v));
		if (!ok) { ignored.push(`${k}: the value is not the kind this setting takes`); continue; }
		out[k] = v;
	}
	return { locked: out as Partial<GlobalSettings>, ignored };
}

/** the words under a locked setting (board S10) */
export const lockedDetail = (value: unknown): string =>
	`Set to ${typeof value === 'boolean' ? (value ? 'on' : 'off') : value === null ? 'none' : String(value)} by your organisation`;
export const LOCKED_NOTE = 'Ask the person who manages Vader for your team to change it.';

/** the settings to store: the person's, with every locked one at the value the organisation set */
export function withManaged(user: GlobalSettings, locked: Partial<GlobalSettings>): GlobalSettings {
	return { ...user, ...locked };
}
