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

export type FileChange = { readonly path: string, readonly added: number, readonly removed: number, /** the file before the step and after it, for the side-by-side view */ readonly before?: string, readonly after?: string };

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
			if (d.added || d.removed) files.push({ path, added: d.added, removed: d.removed, before, after });
		}
		return { n: k + 1, messageIdx: idx, label: labelOf(messages, idx), added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0), files };
	});
}

/** what changed from checkpoint a to checkpoint b: the files of the steps from a up to (not including) b, added together by file */
export function compareSteps(steps: readonly Step[], a: number, b: number): { files: FileChange[], added: number, removed: number } {
	const lo = Math.min(a, b), hi = Math.max(a, b);
	const byPath = new Map<string, { added: number, removed: number, before?: string, after?: string }>();
	for (const s of steps) {
		if (s.n < lo || s.n >= hi) continue;
		for (const f of s.files) {
			const t = byPath.get(f.path) ?? { added: 0, removed: 0, before: f.before };
			t.added += f.added; t.removed += f.removed;
			t.after = f.after; // the file as the last of these steps left it; "before" stays as the first of them found it
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

// ---- side by side (board S13, "Compare 1 and 3": what changed between two checkpoints, opened as a diff)

export type DiffCell = { readonly no: number; readonly text: string; readonly changed: boolean };
export type DiffRow = { readonly left?: DiffCell; readonly right?: DiffCell; /** a run of unchanged lines left out */ readonly gap?: number };

/**
 * The two versions of a file side by side: unchanged lines on both sides, removed lines on the left and added lines on the right (a removed and an added run are set
 * against each other line by line), and only `context` unchanged lines around each change, with the rest folded into a gap row that says how many were left out.
 */
export function sideBySide(a: string, b: string, context = 2, maxCells = 4_000_000): DiffRow[] {
	if (a === b) return [];
	const x = a === '' ? [] : a.split('\n'), y = b === '' ? [] : b.split('\n');
	let s = 0;
	while (s < x.length && s < y.length && x[s] === y[s]) s++;
	let ex = x.length, ey = y.length;
	while (ex > s && ey > s && x[ex - 1] === y[ey - 1]) { ex--; ey--; }
	type Op = { t: '=' | '-' | '+', xi: number, yi: number };
	const ops: Op[] = [];
	for (let i = 0; i < s; i++) ops.push({ t: '=', xi: i, yi: i });
	const m = ex - s, n = ey - s;
	if (m === 0 || n === 0 || m * n > maxCells) {
		for (let i = 0; i < m; i++) ops.push({ t: '-', xi: s + i, yi: -1 });
		for (let j = 0; j < n; j++) ops.push({ t: '+', xi: -1, yi: s + j });
	} else {
		const w = n + 1;
		const t = new Uint32Array((m + 1) * w);
		for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) t[i * w + j] = x[s + i] === y[s + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
		let i = 0, j = 0;
		while (i < m && j < n) {
			if (x[s + i] === y[s + j]) { ops.push({ t: '=', xi: s + i, yi: s + j }); i++; j++; }
			else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) { ops.push({ t: '-', xi: s + i, yi: -1 }); i++; }
			else { ops.push({ t: '+', xi: -1, yi: s + j }); j++; }
		}
		while (i < m) { ops.push({ t: '-', xi: s + i, yi: -1 }); i++; }
		while (j < n) { ops.push({ t: '+', xi: -1, yi: s + j }); j++; }
	}
	for (let k = 0; k < x.length - ex; k++) ops.push({ t: '=', xi: ex + k, yi: ey + k });

	// rows: a run of removed and a run of added lines side by side, unchanged lines on both sides
	const rows: (DiffRow & { changed: boolean })[] = [];
	for (let k = 0; k < ops.length;) {
		if (ops[k].t === '=') { rows.push({ left: { no: ops[k].xi + 1, text: x[ops[k].xi], changed: false }, right: { no: ops[k].yi + 1, text: y[ops[k].yi], changed: false }, changed: false }); k++; continue; }
		const dels: Op[] = [], adds: Op[] = [];
		while (k < ops.length && ops[k].t !== '=') { (ops[k].t === '-' ? dels : adds).push(ops[k]); k++; }
		for (let r = 0; r < Math.max(dels.length, adds.length); r++) {
			const d = dels[r], ad = adds[r];
			rows.push({ left: d ? { no: d.xi + 1, text: x[d.xi], changed: true } : undefined, right: ad ? { no: ad.yi + 1, text: y[ad.yi], changed: true } : undefined, changed: true });
		}
	}
	// keep the changed rows and `context` rows around them; fold the rest
	const keep = new Array<boolean>(rows.length).fill(false);
	rows.forEach((r, i) => { if (r.changed) for (let d = -context; d <= context; d++) if (rows[i + d]) keep[i + d] = true; });
	const out: DiffRow[] = [];
	for (let i = 0; i < rows.length;) {
		if (keep[i]) { out.push({ left: rows[i].left, right: rows[i].right }); i++; continue; }
		let j = i;
		while (j < rows.length && !keep[j]) j++;
		out.push({ gap: j - i });
		i = j;
	}
	return out;
}
