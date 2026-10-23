// Test-only resource observer. Supply { job } from launchJobDriver for kernel-backed ownership.
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
	constructor(rootPid, output, { job, sample = job ? () => job.sample() : async () => {
		const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', snapshotScript], { timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
		return JSON.parse(stdout.replace(/^\uFEFF/, ''));
	}, privateLimitMiB = 6000 } = {}) {
		this.rootPid = rootPid; this.output = output; this.sample = sample; this.limit = privateLimitMiB;
		this.job = job;
		if (job && job.pid !== rootPid) { throw new Error('Monitor root does not match the contained driver'); }
		this.known = new Set(); this.previous = new Map(); this.samples = 0; this.errors = []; this.breaches = [];
		this.peaks = { privateMiB: 0, workingMiB: 0, cpuPercent: 0, processes: 0, handles: 0 };
		this.overLimit = 0; this.totalReadBytes = 0; this.totalWriteBytes = 0;
	}
	async tick() {
		try {
			const snapshot = await this.sample();
			if (!Number.isFinite(snapshot.at) || !Array.isArray(snapshot.processes)) { throw new Error('Invalid CIM snapshot'); }
			if (this.job && (snapshot.scope !== 'windows-job' || snapshot.rootIdentity !== this.job.rootIdentity ||
				!Array.isArray(snapshot.membershipPids) || snapshot.processes.some(p => p.jobMember !== true || !snapshot.membershipPids.includes(p.pid)))) {
				throw new Error('Invalid kernel job membership evidence');
			}
			// Never infer job ownership from sampled ancestry: an exited launcher can leave living members.
			const rows = this.job ? snapshot.processes : selectTree(snapshot.processes, this.rootPid, this.rootIdentity, this.known);
			if (this.job) { this.rootIdentity = snapshot.rootIdentity; }
			const root = rows.find(p => p.pid === this.rootPid);
			if (!this.rootIdentity && root) { this.rootIdentity = identity(root); }
			const totals = aggregate(rows, this.previous, snapshot.at - (this.at ?? snapshot.at));
			if (this.job) {
				const accounting = snapshot.jobAccounting;
				for (const name of ['cpuMs', 'readBytes', 'writeBytes', 'otherBytes', 'totalProcesses', 'activeProcesses', 'terminatedProcesses']) {
					if (!Number.isFinite(accounting?.[name]) || accounting[name] < 0) { throw new Error(`Invalid kernel job accounting: ${name}`); }
				}
				for (const name of ['cpuMs', 'readBytes', 'writeBytes', 'totalProcesses']) {
					if (this.jobAccounting && accounting[name] < this.jobAccounting[name]) { throw new Error(`Kernel job accounting decreased: ${name}`); }
				}
				const elapsed = snapshot.at - (this.at ?? snapshot.at);
				totals.cpuPercent = this.jobAccounting && elapsed > 0 ? (accounting.cpuMs - this.jobAccounting.cpuMs) / elapsed * 100 : 0;
				totals.readBytes = accounting.readBytes - (this.jobAccounting?.readBytes ?? 0);
				totals.writeBytes = accounting.writeBytes - (this.jobAccounting?.writeBytes ?? 0);
				this.jobAccounting = accounting;
			}
			for (const p of rows) { this.known.add(identity(p)); }
			this.totalReadBytes += totals.readBytes; this.totalWriteBytes += totals.writeBytes;
			for (const k of Object.keys(this.peaks)) { this.peaks[k] = Math.max(this.peaks[k], totals[k]); }
			this.overLimit = totals.privateMiB > this.limit ? this.overLimit + 1 : 0;
			if (this.overLimit === 3) { this.breaches.push(`Process tree exceeded ${this.limit} MiB private memory for three consecutive samples`); }
			fs.appendFileSync(this.output, JSON.stringify({ at: snapshot.at, totals, processes: rows,
				...(this.job ? { scope: snapshot.scope, membershipPids: snapshot.membershipPids, rootIdentity: snapshot.rootIdentity, driverExited: snapshot.driverExited, jobAccounting: snapshot.jobAccounting } : {}) }) + '\n');
			this.previous = new Map(rows.map(p => [identity(p), p])); this.at = snapshot.at; this.samples++;
			return rows;
		} catch (error) { this.errors.push(String(error)); return []; }
	}
	report() {
		return { samples: this.samples, observedIdentities: this.known.size, peaks: this.peaks, readBytes: this.totalReadBytes, writeBytes: this.totalWriteBytes,
			privateLimitMiB: this.limit, breaches: this.breaches, errors: [...this.errors, ...(this.job?.report().errors ?? [])], rootObserved: Boolean(this.rootIdentity),
			...(this.job ? { containment: this.job.report() } : {}),
			...(this.jobAccounting ? { jobAccounting: this.jobAccounting } : {}),
			units: 'CPU 100% = one logical core; MiB = 1048576 bytes; I/O counters include disk/device/pipe traffic',
			limits: `${this.job ? 'Kernel job membership includes living descendants after launcher exit; cumulative kernel CPU/I/O include completed members. PrivateUsage is bytes. CreateProcess descendants only, not a security sandbox against WMI/service brokers.' : 'Ancestry-only compatibility observer: can miss descendants after launcher exit; use launchJobDriver and { job } for containment.'} Per-process resource snapshots can miss already-exited processes. Working sets double-count shared pages. Includes driver, fixtures and app. No network payload, kernel tracing or vendor account verification.` };
	}
}
