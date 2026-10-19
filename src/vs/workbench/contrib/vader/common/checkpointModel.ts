/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The list of checkpoints of a chat with what each step changed (board S13, "Checkpoints"). A checkpoint keeps the files as they were at that point; what a step
// changed is the difference between those files and the same files at the next checkpoint that kept them (or as they are now). Pure: the lines are compared here, and
// where a file is now is asked of the caller.

export type SnapshotLike = { readonly entireFileCode: string } | undefined;

export type MessageLike = {
	readonly role: string;
	readonly type?: string;
	readonly name?: string;
	readonly params?: unknown;
	readonly displayContent?: unknown;
	readonly vaderFileSnapshotOfURI?: { readonly [fsPath: string]: SnapshotLike };
};

export type FileChange = { readonly path: string, readonly added: number, readonly removed: number };

export type Step = {
	/** the number the chat shows for this checkpoint (the first is 1) */
	readonly n: number;
	readonly messageIdx: number;
	readonly label: string;
	readonly added: number;
	readonly removed: number;
	readonly files: readonly FileChange[];
};

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;

/** how many lines were added and removed to get from a to b (common start and end are skipped, the middle is compared line by line) */
export function lineDiffCounts(a: string, b: string): { added: number, removed: number } {
	if (a === b) return { added: 0, removed: 0 };
	const x = a === '' ? [] : a.split('\n'), y = b === '' ? [] : b.split('\n');
	let s = 0;
	while (s < x.length && s < y.length && x[s] === y[s]) s++;
	let ex = x.length, ey = y.length;
	while (ex > s && ey > s && x[ex - 1] === y[ey - 1]) { ex--; ey--; }
	const m = x.slice(s, ex), n = y.slice(s, ey);
	if (m.length === 0 || n.length === 0 || m.length * n.length > 4_000_000) return { added: n.length, removed: m.length };
	// the longest run of lines the two have in common, by rows of the table
	let prev = new Uint32Array(n.length + 1), cur = new Uint32Array(n.length + 1);
	for (let i = 1; i <= m.length; i++) {
		for (let j = 1; j <= n.length; j++) cur[j] = m[i - 1] === n[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
		[prev, cur] = [cur, prev];
	}
	const common = prev[n.length];
	return { added: n.length - common, removed: m.length - common };
}

const clip = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s;

function labelOf(messages: readonly MessageLike[], at: number): string {
	const cp = messages[at];
	for (let i = at + 1; i < messages.length; i++) {
		const m = messages[i];
		if (m.role === 'checkpoint' && (cp.type === 'tool_edit' || m.type === 'user_edit')) break;
		if (cp.type === 'tool_edit' && m.role === 'tool' && (m.name === 'edit_file' || m.name === 'rewrite_file')) {
			const u = (m.params as { uri?: { fsPath?: string } | string } | undefined)?.uri;
			const p = typeof u === 'string' ? u : u?.fsPath;
			return `${m.name === 'rewrite_file' ? 'Wrote' : 'Edited'} ${p ? baseName(p) : 'a file'}`;
		}
		// a checkpoint of the person's side is taken before the next message is sent: it is the way the files were before that message
		if (cp.type === 'user_edit' && m.role === 'user') {
			const t = typeof m.displayContent === 'string' ? m.displayContent.replace(/\s+/g, ' ').trim() : '';
			return t ? `Before “${clip(t, 44)}”` : 'Before your message';
		}
	}
	return cp.type === 'tool_edit' ? 'Edited a file' : 'The end of the last run';
}

/** every checkpoint as a step, newest last. `currentCode` says what a file holds now (undefined: it cannot be read, so the step is not compared for that file). */
export function stepsOfThread(messages: readonly MessageLike[], currentCode: (fsPath: string) => string | undefined): Step[] {
	const cps: number[] = [];
	messages.forEach((m, i) => { if (m.role === 'checkpoint') cps.push(i); });
	return cps.map((idx, k) => {
		const snap = messages[idx].vaderFileSnapshotOfURI ?? {};
		const files: FileChange[] = [];
		for (const path of Object.keys(snap)) {
			const before = snap[path]?.entireFileCode;
			if (before === undefined) continue;
			let after: string | undefined;
			for (let j = k + 1; j < cps.length; j++) {
				const next = messages[cps[j]].vaderFileSnapshotOfURI?.[path];
				if (next) { after = next.entireFileCode; break; }
			}
			if (after === undefined) after = currentCode(path);
			if (after === undefined) continue;
			const d = lineDiffCounts(before, after);
			if (d.added || d.removed) files.push({ path, added: d.added, removed: d.removed });
		}
		return { n: k + 1, messageIdx: idx, label: labelOf(messages, idx), added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0), files };
	});
}

/** what changed from checkpoint a to checkpoint b: the files of the steps from a up to (not including) b, added together by file */
export function compareSteps(steps: readonly Step[], a: number, b: number): { files: FileChange[], added: number, removed: number } {
	const lo = Math.min(a, b), hi = Math.max(a, b);
	const byPath = new Map<string, { added: number, removed: number }>();
	for (const s of steps) {
		if (s.n < lo || s.n >= hi) continue;
		for (const f of s.files) {
			const t = byPath.get(f.path) ?? { added: 0, removed: 0 };
			t.added += f.added; t.removed += f.removed;
			byPath.set(f.path, t);
		}
	}
	const files = [...byPath].map(([path, v]) => ({ path, ...v }));
	return { files, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) };
}

/** "+12 −1", "+48", "no changes" */
export function changeWords(added: number, removed: number): string {
	if (!added && !removed) return 'no changes';
	return [added ? `+${added}` : '', removed ? `−${removed}` : ''].filter(Boolean).join(' ');
}
