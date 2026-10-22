/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import type { IndexState } from './codebaseIndexTypes.js';

// What Settings says about the project index: whether it is on, what it holds, how old it is. Pure.

const num = (n: number): string => n.toLocaleString('en-US');

export function agoWords(then: number, now: number): string {
	const s = Math.max(0, Math.round((now - then) / 1000));
	if (s < 45) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} h ago`;
	return `${Math.round(h / 24)} d ago`;
}

export function indexStatusWords(state: IndexState | undefined, opts: { on: boolean; hasFolder: boolean; now: number }): { title: string; detail: string; tone: 'ok' | 'busy' | 'off' | 'bad' } {
	if (!opts.on) return { title: 'The project index is off', detail: 'The agent finds code by exact text only. Nothing is stored.', tone: 'off' };
	if (!opts.hasFolder) return { title: 'No folder is open', detail: 'Open a folder and its index is made.', tone: 'off' };
	if (!state || state.status === 'idle') return { title: 'Starting', detail: 'The index is made a moment after a folder is opened.', tone: 'busy' };
	if (state.status === 'error') return { title: 'The index could not be made', detail: state.message ?? 'Something stopped it. Rebuild tries again.', tone: 'bad' };
	if (state.status === 'indexing' && state.files === 0 && !state.progress) return { title: 'Indexing', detail: 'Reading the project for the first time.', tone: 'busy' };
	if (state.status === 'indexing') {
		const p = state.progress;
		return { title: p ? `Indexing: ${num(p.done)} of ${num(p.total)} files changed since last time` : `Indexing: ${num(state.files)} files so far`, detail: 'Search works meanwhile with what is there.', tone: 'busy' };
	}
	const extra = state.truncated ? ' Only the first 20,000 files are indexed; list the rest in .vaderignore to choose which.' : '';
	const m = state.meaning;
	const quick = m?.quick !== undefined ? ` The quick tier covers ${num(m.quick)} pieces.` : '';
	const meaning = !m || (m.on === undefined && m.quick === undefined) ? ''
		: m.on === undefined ? ` Fast search by meaning is ready for ${num(m.quick ?? 0)} pieces.`
			: m.error ? (m.quick !== undefined ? ` Fast search by meaning is ready for ${num(m.quick)} pieces. The high-quality search model could not run; search still works with the available index.` : ' The search model could not run; search still matches words.')
				: m.on === false ? (m.quick !== undefined ? ` Fast search by meaning is ready for ${num(m.quick)} pieces; the high-quality model is not part of this install.` : ' Search by meaning is not available in this install, so search matches words only.')
				: m.waiting > 0 ? ` Search by meaning: ${num(m.ready)} of ${num(m.ready + m.waiting)} pieces are ready with the high-quality model, the rest are prepared in the background, a little at a time, and not while on battery.${quick}`
					: ` Search by meaning is ready for all ${num(m.ready)} pieces.${quick}`;
	return { title: `${num(state.files)} file${state.files === 1 ? '' : 's'} in ${num(state.chunks)} pieces`, detail: `Updated ${agoWords(state.updatedAt, opts.now)}. Kept on this computer, never sent anywhere.${meaning}${extra}`, tone: 'ok' };
}
