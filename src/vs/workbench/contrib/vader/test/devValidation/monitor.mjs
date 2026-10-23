// Test-only sampled process-tree observer. Windows CIM values, not inferred app counters.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const exec = promisify(execFile);
const snapshotScript = fileURLToPath(new URL('./snapshot.ps1', import.meta.url));
export const identity = p => `${p.pid}:${p.created}`;

export function selectTree(rows, rootPid, rootIdentity, known = new Set()) {
	const selected = new Map();
	for (const p of rows) {
		if ((p.pid === rootPid && (!rootIdentity || identity(p) === rootIdentity)) || known.has(identity(p))) {
			selected.set(p.pid, p);
		}
	}
	let added;
	do {
		added = false;
		for (const p of rows) {
			const parent = selected.get(p.parent);
			// A reused parent PID cannot establish ancestry for an older process.
			if (!selected.has(p.pid) && parent && p.created >= parent.created) {
				selected.set(p.pid, p); added = true;
			}
		}
	} while (added);
	return [...selected.values()];
}

export function aggregate(rows, previous, elapsedMs) {
	const result = { processes: rows.length, privateMiB: 0, workingMiB: 0, handles: 0, cpuPercent: 0, readBytes: 0, writeBytes: 0 };
	for (const p of rows) {
		for (const name of ['privateBytes', 'workingBytes', 'cpuMs', 'readBytes', 'writeBytes', 'handles']) {
			if (!Number.isFinite(p[name]) || p[name] < 0) { throw new Error(`Invalid process measurement: ${name}`); }
		}
		result.privateMiB += p.privateBytes / 1048576;
		result.workingMiB += p.workingBytes / 1048576;
		result.handles += p.handles;
		const prev = previous.get(identity(p));
		if (prev && elapsedMs > 0) {
			result.cpuPercent += Math.max(0, p.cpuMs - prev.cpuMs) / elapsedMs * 100;
			result.readBytes += Math.max(0, p.readBytes - prev.readBytes);
			result.writeBytes += Math.max(0, p.writeBytes - prev.writeBytes);
		}
	}
	return result;
}

export class ProcessMonitor {
	constructor(rootPid, output, { sample = async () => {
		const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', snapshotScript], { timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
		return JSON.parse(stdout.replace(/^\uFEFF/, ''));
	}, privateLimitMiB = 6000 } = {}) {
		this.rootPid = rootPid; this.output = output; this.sample = sample; this.limit = privateLimitMiB;
		this.known = new Set(); this.previous = new Map(); this.samples = 0; this.errors = []; this.breaches = [];
		this.peaks = { privateMiB: 0, workingMiB: 0, cpuPercent: 0, processes: 0, handles: 0 };
		this.overLimit = 0; this.totalReadBytes = 0; this.totalWriteBytes = 0;
	}
	async tick() {
		try {
			const snapshot = await this.sample();
			if (!Number.isFinite(snapshot.at) || !Array.isArray(snapshot.processes)) { throw new Error('Invalid CIM snapshot'); }
			const rows = selectTree(snapshot.processes, this.rootPid, this.rootIdentity, this.known);
			const root = rows.find(p => p.pid === this.rootPid);
			if (!this.rootIdentity && root) { this.rootIdentity = identity(root); }
			const totals = aggregate(rows, this.previous, snapshot.at - (this.at ?? snapshot.at));
			for (const p of rows) { this.known.add(identity(p)); }
			this.totalReadBytes += totals.readBytes; this.totalWriteBytes += totals.writeBytes;
			for (const k of Object.keys(this.peaks)) { this.peaks[k] = Math.max(this.peaks[k], totals[k]); }
			this.overLimit = totals.privateMiB > this.limit ? this.overLimit + 1 : 0;
			if (this.overLimit === 3) { this.breaches.push(`Process tree exceeded ${this.limit} MiB private memory for three consecutive samples`); }
			fs.appendFileSync(this.output, JSON.stringify({ at: snapshot.at, totals, processes: rows }) + '\n');
			this.previous = new Map(rows.map(p => [identity(p), p])); this.at = snapshot.at; this.samples++;
			return rows;
		} catch (error) { this.errors.push(String(error)); return []; }
	}
	report() {
		return { samples: this.samples, observedIdentities: this.known.size, peaks: this.peaks, readBytes: this.totalReadBytes, writeBytes: this.totalWriteBytes,
			privateLimitMiB: this.limit, breaches: this.breaches, errors: this.errors, rootObserved: Boolean(this.rootIdentity),
			units: 'CPU 100% = one logical core; MiB = 1048576 bytes; I/O counters include disk/device/pipe traffic',
			limits: 'Five-second snapshots can miss short-lived processes and their I/O. Working sets double-count shared pages. Tree includes the test driver, model fixture and app. No network payload, kernel tracing or vendor account verification.' };
	}
}
