// Test-only Windows lifecycle containment. See launchJobDriver's API below.
import { spawn, execFile } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const brokerScript = fileURLToPath(new URL('./windowsJob.py', import.meta.url));
const snapshotScript = fileURLToPath(new URL('./snapshot.ps1', import.meta.url));

// Metadata is optional for an exited process. A reused PID must never lend its role/parent
// to another identity. Native handle-derived identity and counters always remain authoritative.
export function mergeJobMetadata(snapshot, metadata) {
	if (!Array.isArray(metadata.processes)) { throw new Error('Invalid CIM role snapshot'); }
	const byIdentity = new Map(metadata.processes.map(p => [`${p.pid}:filetime:${p.creationFileTime}`, p]));
	for (const row of snapshot.processes) {
		const extra = byIdentity.get(`${row.pid}:${row.created}`);
		if (extra) { row.parent = extra.parent; row.role = extra.role; }
	}
	return snapshot;
}

/**
 * Creates the real driver SUSPENDED, assigns it to a Windows Job Object, then resumes it.
 * No shell or external Python packages. Configuration (including env) travels over stdin.
 *
 * const job = await launchJobDriver({ executable: process.execPath, args: [script], env, cwd });
 * job.pid, job.rootIdentity, job.stdout, job.stderr; await job.exit -> { code } (not pipe close).
 * new ProcessMonitor(job.pid, output, { job }); // kernel membership, native counters + CIM roles.
 * await job.terminate(); // timeouts: terminate the whole kernel job, never taskkill by PID.
 * const cleanup = await job.dispose(); // preserves beforeCleanup/leaks, verifies job emptied.
 * job.report(); // sticky errors/leaks; cleanup cannot erase a failure. Always dispose in finally.
 *
 * The unnamed job disallows breakaway and kills members if its helper dies or stdin closes.
 * This contains CreateProcess descendants, including nested jobs; it is not a security
 * sandbox against service/WMI/broker-created processes. Resource samples can miss a
 * process that already exited, but living job members do not depend on observed ancestry.
 */
export async function launchJobDriver({ executable, args = [], env = process.env, cwd = process.cwd(),
	python = process.env.DEV_VALIDATION_PYTHON || 'python', startupTimeoutMs = 15000, requestTimeoutMs = 25000,
	enrichCim = true } = {}) {
	if (process.platform !== 'win32') { throw new Error('Windows Job Object containment requires Windows'); }
	if (!executable || !path.isAbsolute(executable) || !Array.isArray(args) || args.some(a => typeof a !== 'string')) {
		throw new Error('Job driver requires an absolute executable and string args');
	}
	const helper = spawn(python, ['-I', '-B', '-u', brokerScript], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
	const stdout = new PassThrough(), stderr = new PassThrough();
	const pending = new Map(), errors = [], leaks = [];
	let sequence = 0, ready, resolveReady, rejectReady, resolveExit, rejectExit;
	let dead = false, disposing = false, disposed = false, cleanup, disposal;
	let pid, rootIdentity, driverExit;
	const readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
	const exit = new Promise((resolve, reject) => { resolveExit = resolve; rejectExit = reject; });
	exit.catch(() => {}); // A startup failure can occur before the caller receives the promise.
	const helperClosed = new Promise(resolve => helper.once('close', resolve));
	async function closedWithDeadline() {
		let timer;
		try {
			await Promise.race([helperClosed, new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('Job helper did not exit after disposal')), 5000);
			})]);
		} finally { clearTimeout(timer); }
	}
	function fail(error) {
		const problem = error instanceof Error ? error : new Error(String(error));
		errors.push(problem.message);
		rejectReady(problem); rejectExit(problem);
		for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(problem); }
		pending.clear();
		// Killing only this helper closes its non-inherited job handle in the kernel.
		if (!dead) { helper.kill(); }
	}
	helper.once('error', error => fail(new Error(`Job helper failed to start (${error.code || 'unknown'})`)));
	helper.stdin.on('error', error => { if (!disposing && !dead) { fail(new Error(`Job control pipe failed (${error.code || 'unknown'})`)); } });
	// Never echo Python stderr/configuration: protocol failures are explicit, secrets stay in the pipe.
	helper.stderr.on('data', () => {});
	helper.once('close', code => {
		dead = true;
		if (!disposed) { fail(new Error(`Job helper closed before verified disposal (exit ${code})`)); }
		stdout.end(); stderr.end();
	});
	const lines = createInterface({ input: helper.stdout, crlfDelay: Infinity });
	lines.on('line', line => {
		try {
			const event = JSON.parse(line);
			if (event.id !== undefined) {
				const request = pending.get(event.id);
				if (!request) { throw new Error('Unexpected job response'); }
				pending.delete(event.id); clearTimeout(request.timer);
				if (event.error) { request.reject(new Error(event.error)); fail(new Error(event.error)); }
				else {
					// The broker exits right after this acknowledgement; mark before its close event.
					if (request.op === 'dispose') { disposed = true; }
					request.resolve(event.result);
				}
			} else if (event.event === 'ready') {
				if (ready || !Number.isInteger(event.pid) || event.pid <= 0 || event.containment !== 'windows-job' || event.assignedBeforeResume !== true || !event.rootIdentity?.startsWith(`${event.pid}:filetime:`)) {
					throw new Error('Invalid job launch acknowledgement');
				}
				ready = true; pid = event.pid; rootIdentity = event.rootIdentity; resolveReady();
			} else if (event.event === 'stdout' || event.event === 'stderr') {
				(event.event === 'stdout' ? stdout : stderr).write(Buffer.from(event.data, 'base64'));
			} else if (event.event === 'stdoutEnd' || event.event === 'stderrEnd') {
				(event.event === 'stdoutEnd' ? stdout : stderr).end();
			} else if (event.event === 'exit') {
				if (!ready || !Number.isInteger(event.code)) { throw new Error('Invalid driver exit acknowledgement'); }
				driverExit = { code: event.code }; resolveExit(driverExit);
			} else if (event.event === 'fatal') { fail(new Error(event.error)); }
			else { throw new Error('Invalid job protocol event'); }
		} catch (error) { fail(error); }
	});
	function request(op) {
		if (dead || disposed || (disposing && op !== 'dispose')) { return Promise.reject(new Error('Job helper is closed')); }
		return new Promise((resolve, reject) => {
			const id = ++sequence;
			const timer = setTimeout(() => fail(new Error(`Job ${op} request timed out`)), requestTimeoutMs);
			pending.set(id, { resolve, reject, timer, op });
			helper.stdin.write(JSON.stringify({ id, op }) + '\n');
		});
	}
	const startupTimer = setTimeout(() => fail(new Error('Job driver startup timed out')), startupTimeoutMs);
	try {
		helper.stdin.write(JSON.stringify({ executable, args, env: Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)), cwd }) + '\n');
		await readyPromise;
	} catch (error) { fail(error); await helperClosed; throw error;
	} finally { clearTimeout(startupTimer); }
	const job = {
		pid, rootIdentity, observerPid: helper.pid, stdout, stderr, exit,
		async sample() {
			try {
				const snapshot = await request('sample');
				if (snapshot.scope !== 'windows-job' || snapshot.rootIdentity !== rootIdentity || !Array.isArray(snapshot.membershipPids) || !Array.isArray(snapshot.processes)) {
					throw new Error('Invalid kernel job snapshot');
				}
				if (enrichCim && snapshot.processes.length) {
					const { stdout: cim } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', snapshotScript,
						'-ProcessIds', snapshot.processes.map(p => p.pid).join(',')], { timeout: 20000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
					const metadata = JSON.parse(cim.replace(/^\uFEFF/, ''));
					mergeJobMetadata(snapshot, metadata);
				}
				return snapshot;
			} catch (error) { fail(error); throw error; }
		},
		terminate: () => request('terminate'),
		dispose() {
			if (disposal) { return disposal; }
			disposal = (async () => {
				disposing = true;
				try {
					cleanup = await request('dispose');
					if (!cleanup.cleanupVerified || cleanup.remaining?.length !== 0 || cleanup.beforeCleanup?.rootIdentity !== rootIdentity) {
						throw new Error('Job cleanup was not verified');
					}
					const before = cleanup.beforeCleanup;
					for (const memberPid of before.membershipPids) {
						if (memberPid !== pid) { leaks.push(before.processes.find(p => p.pid === memberPid) ?? { pid: memberPid, exitedDuringSnapshot: true }); }
					}
					cleanup.leaks = leaks;
					cleanup.driverRunningAtDispose = !before.driverExited;
					helper.stdin.end();
					await closedWithDeadline();
					return cleanup;
				} catch (error) { fail(error); await helperClosed; throw error; }
			})();
			return disposal;
		},
		report: () => ({ kind: 'windows-job', assignedBeforeResume: ready === true, rootIdentity, driverExit,
			errors: [...errors, ...(leaks.length ? ['Job had surviving descendants before cleanup'] : []),
				...(cleanup?.driverRunningAtDispose ? ['Driver was still running at disposal'] : [])],
			leaks: [...leaks], disposed, cleanupVerified: cleanup?.cleanupVerified === true,
			driverRunningAtDispose: cleanup?.driverRunningAtDispose }),
	};
	return job;
}
