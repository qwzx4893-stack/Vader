// Actual Windows kernel containment tests. No Electron/provider claims and no user processes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { launchJobDriver, mergeJobMetadata, mergeObservedOrphans, cleanupLeaks } from './devValidation/windowsJob.mjs';
import { ProcessMonitor, selectTree } from './devValidation/monitor.mjs';
import { assess } from './devValidation/verdict.mjs';

if (process.platform !== 'win32') { throw new Error('Actual Windows Job Object tests require Windows; not a passing skip'); }
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-job-e2e-'));
const fixture = fileURLToPath(new URL('./devValidation/jobDescendantFixture.mjs', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exec = promisify(execFile);
async function bounded(promise, ms = 15000) {
	let timer;
	try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture operation timed out')), ms); })]); }
	finally { clearTimeout(timer); }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') { return false; } throw error; } }
async function gone(pid) { const deadline = Date.now() + 10000; while (alive(pid) && Date.now() < deadline) { await sleep(25); } assert.equal(alive(pid), false, `owned process ${pid} survived cleanup`); }
let count = 0;
function check(name, fn) { fn(); count++; console.log('PASS: ' + name); }
const options = { executable: process.execPath, cwd: directory };
// WindowsApps aliases can activate Python through a service broker, outside the
// directly created process. Exercise native inheritance with the actual interpreter.
const pythonCommand = process.env.DEV_VALIDATION_PYTHON || 'python';
const pythonExecutable = (await exec(pythonCommand, ['-I', '-B', '-c', 'import sys; print(sys.executable)'], { timeout: 5000, windowsHide: true })).stdout.trim();
assert.ok(path.isAbsolute(pythonExecutable) && fs.existsSync(pythonExecutable), 'Actual Python executable is missing');
const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
await new Promise((resolve, reject) => { unrelated.once('spawn', resolve); unrelated.once('error', reject); });
let job, coordinator;
try {
	job = await launchJobDriver({ ...options, args: [fixture, 'driver', directory] });
	let output = '', diagnostic = '';
	job.stdout.setEncoding('utf8').on('data', text => { output += text; });
	job.stderr.setEncoding('utf8').on('data', text => { diagnostic += text; });
	const exit = await bounded(job.exit);
	const grandchild = JSON.parse(fs.readFileSync(path.join(directory, 'grandchild.json'), 'utf8'));
	check('driver was assigned before resume and exit is independent of inherited pipes', () => {
		assert.equal(job.report().assignedBeforeResume, true); assert.equal(exit.code, 0);
		assert.equal(alive(job.pid), false); assert.equal(alive(grandchild.launcher), false);
		assert.equal(alive(grandchild.pid), true); assert.equal(job.stdout.readableEnded, false);
	});
	const monitor = new ProcessMonitor(job.pid, path.join(directory, 'resources.jsonl'), { job });
	const first = await monitor.tick();
	await monitor.tick();
	check('first kernel sample finds persistent grandchild after both ancestors exited', () => {
		assert.deepEqual(monitor.report().errors, []);
		const row = first.find(p => p.pid === grandchild.pid);
		assert.ok(row); assert.equal(row.jobMember, true); assert.match(row.created, /^filetime:\d+$/);
		assert.ok(row.privateBytes > 0); assert.ok(row.handles > 0);
		assert.equal(row.role, 'main-or-cli', 'CIM metadata must match the exact native identity across its precision loss');
		assert.equal(selectTree(first, job.pid).length, 0, 'ancestry-only observer would miss it');
		assert.equal(first.some(p => p.pid === unrelated.pid), false);
		assert.equal(monitor.report().rootObserved, true, 'assignment evidence survives an immediate driver exit');
	});
	check('a live leaked member fails the existing verdict before cleanup', () => {
		assert.equal(assess({ exitCode: exit.code, orphans: first, metrics: monitor.report() }), false);
	});
	check('cumulative kernel CPU and I/O include the launcher that exited before sampling', () => {
		const accounting = monitor.report().jobAccounting;
		assert.ok(accounting.totalProcesses >= 3); assert.equal(accounting.activeProcesses, 1);
		assert.ok(accounting.cpuMs > first.reduce((sum, row) => sum + row.cpuMs, 0));
		assert.ok(accounting.readBytes >= 8 * 1024 * 1024); assert.ok(accounting.writeBytes >= 8 * 1024 * 1024);
		assert.equal(monitor.report().readBytes, accounting.readBytes);
		assert.equal(monitor.report().writeBytes, accounting.writeBytes);
	});
	const { stdout: processBytes } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
		`(Get-Process -Id ${grandchild.pid} -ErrorAction Stop).PrivateMemorySize64`], { timeout: 10000, windowsHide: true });
	check('native PrivateUsage is bytes and agrees with Windows PrivateMemorySize64', () => {
		const native = first.find(p => p.pid === grandchild.pid).privateBytes;
		assert.ok(native >= 32 * 1024 * 1024);
		assert.ok(Math.abs(native - Number(processBytes.trim())) < 8 * 1024 * 1024, `native=${native}, Windows=${processBytes.trim()}`);
	});
	const cleanup = await bounded(job.dispose());
	await gone(grandchild.pid);
	check('job teardown retains leak identities, empties the job and leaves unrelated processes alone', () => {
		assert.equal(cleanup.cleanupVerified, true); assert.deepEqual(cleanup.remaining, []);
		assert.ok(cleanup.leaks.some(p => p.pid === grandchild.pid && p.created.startsWith('filetime:')));
		assert.equal(alive(unrelated.pid), true);
		assert.ok(job.report().errors.includes('Job had surviving descendants before cleanup'));
		assert.equal(assess({ exitCode: 0, orphans: [], metrics: monitor.report() }), false, 'cleanup must not wash the failure away');
		assert.match(output, /grandchild inherited stdout/); assert.match(diagnostic, /grandchild inherited stderr/);
	});
	assert.strictEqual(await job.dispose(), cleanup, 'disposal is idempotent');
	job = undefined;

	check('CIM metadata cannot attach by PID alone when creation identity differs', () => {
		const snapshot = { processes: [{ pid: unrelated.pid, created: 'filetime:111', role: 'unknown', parent: null }] };
		mergeJobMetadata(snapshot, { processes: [{ pid: unrelated.pid, creationFileTime: '222', role: 'unrelated-secret', parent: 5 }] });
		assert.equal(snapshot.processes[0].role, 'unknown'); assert.equal(snapshot.processes[0].parent, null);
		mergeJobMetadata(snapshot, { processes: [{ pid: unrelated.pid, creationFileTime: '111', role: 'renderer', parent: 8 }] });
		assert.equal(snapshot.processes[0].role, 'renderer');
	});
	check('CIM microsecond precision requires an exact native identity after the query', () => {
		const original = { pid: 123, created: 'filetime:134373024311851893', role: 'unknown', parent: null };
		const snapshot = () => ({ scope: 'windows-job', rootIdentity: 'fixture-root', processes: [{ ...original }] });
		const metadata = { processes: [{ pid: 123, creationFileTime: '134373024311851890', parent: 9, role: 'renderer' }] };
		const noWitness = mergeJobMetadata(snapshot(), metadata);
		assert.equal(noWitness.processes[0].role, 'unknown');
		const verified = mergeJobMetadata(snapshot(), metadata, snapshot());
		assert.equal(verified.processes[0].role, 'renderer'); assert.equal(verified.processes[0].parent, 9);
		const reused = snapshot(); reused.processes[0].created = 'filetime:134373024311851899';
		assert.equal(mergeJobMetadata(snapshot(), metadata, reused).processes[0].role, 'unknown', 'Even PID reuse inside one microsecond cannot lend metadata');
		const anotherJob = snapshot(); anotherJob.rootIdentity = 'another-job';
		assert.equal(mergeJobMetadata(snapshot(), metadata, anotherJob).processes[0].role, 'unknown');
		const differentTime = { processes: [{ ...metadata.processes[0], creationFileTime: '134373024311851880' }] };
		assert.equal(mergeJobMetadata(snapshot(), differentTime, snapshot()).processes[0].role, 'unknown');
	});
	check('observed orphans survive empty cleanup and retain distinct reused-PID identities', () => {
		const observed = { pid: 123, created: 'filetime:111' };
		const orphans = mergeObservedOrphans([observed], []);
		assert.deepEqual(orphans, [observed]);
		assert.equal(mergeObservedOrphans(orphans, [{ ...observed, created: 'filetime:222' }]).length, 2);
		assert.equal(assess({ exitCode: 0, orphans, metrics: { rootObserved: true, samples: 2, errors: [], breaches: [] } }), false);
	});
	const replacementFixture = fileURLToPath(new URL('./devValidation/windowsJobReplacementFixture.py', import.meta.url));
	const replacement = JSON.parse((await exec(pythonExecutable, ['-I', '-B', replacementFixture], { timeout: 20000, windowsHide: true })).stdout);
	check('a native B-to-C replacement during the exit-probe wait remains a failing verdict', () => {
		const leaks = cleanupLeaks(replacement.cleanup.beforeCleanup, replacement.driverPid);
		assert.equal(replacement.cleanup.cleanupVerified, true);
		assert.equal(replacement.cleanup.beforeCleanup.driverExited, true);
		assert.ok(replacement.liveAtTerminate.every(live => leaks.some(p => p.pid === live.pid && p.created === live.created)));
		assert.equal(assess({ exitCode: 0, orphans: leaks, metrics: { rootObserved: true, samples: 2, errors: [], breaches: [] } }), false);
	});
	job = await launchJobDriver({ ...options, args: ['-e', 'setInterval(()=>{},1000)', '--', '--type=renderer'] });
	job.stdout.resume(); job.stderr.resume();
	const rendererSample = await job.sample();
	check('live CIM renderer metadata preserves the exact kernel creation identity', () => {
		const row = rendererSample.processes.find(p => p.pid === job.pid);
		assert.equal(row.role, 'renderer');
		assert.equal(`${row.pid}:${row.created}`, job.rootIdentity);
	});
	await job.terminate(); await bounded(job.exit); await job.dispose();
	job = undefined;

	job = await launchJobDriver({ ...options, args: ['-e', 'console.log("normal output"); process.exit(7)'] });
	job.stdout.resume(); job.stderr.resume();
	check('real nonzero driver exit is preserved', () => assert.ok(job.pid > 0));
	assert.equal((await bounded(job.exit)).code, 7);
	const normal = await job.dispose();
	check('normal teardown verifies no remaining members and invents no leaks', () => {
		assert.deepEqual(normal.leaks, []); assert.equal(normal.driverRunningAtDispose, false); assert.deepEqual(job.report().errors, []);
	});
	job = undefined;

	job = await launchJobDriver({ ...options, args: ['-e', 'setInterval(()=>{},1000)'] });
	job.stdout.resume(); job.stderr.resume();
	const killedPid = job.pid;
	await job.terminate();
	assert.equal((await bounded(job.exit)).code, 1);
	await job.dispose(); await gone(killedPid);
	check('timeout termination uses the entire job and preserves a failing exit', () => assert.equal(alive(unrelated.pid), true));
	job = undefined;

	job = await launchJobDriver({ ...options, args: ['-e', 'setInterval(()=>{},1000)'] });
	job.stdout.resume(); job.stderr.resume();
	const crashPid = job.pid;
	process.kill(job.observerPid); // Kill only this test-owned broker; kernel closes its sole job handle.
	await assert.rejects(bounded(job.exit), /helper closed/);
	await gone(crashPid);
	await assert.rejects(job.dispose(), /closed/);
	check('observer death fails closed and KILL_ON_JOB_CLOSE terminates its driver', () => {
		assert.ok(job.report().errors.length); assert.equal(alive(unrelated.pid), true);
	});
	job = undefined;

	const moduleUrl = new URL('./devValidation/windowsJob.mjs', import.meta.url).href;
	const coordinatorScript = `const {launchJobDriver}=await import(${JSON.stringify(moduleUrl)}); const job=await launchJobDriver({executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:${JSON.stringify(directory)}}); console.log(JSON.stringify({pid:job.pid})); process.exit(0);`;
	coordinator = spawn(process.execPath, ['--input-type=module', '-e', coordinatorScript], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
	const coordinatorExit = new Promise((resolve, reject) => { coordinator.once('exit', resolve); coordinator.once('error', reject); });
	let coordinatorOutput = '';
	coordinator.stdout.setEncoding('utf8').on('data', data => { coordinatorOutput += data; });
	coordinator.stderr.resume();
	assert.equal(await bounded(coordinatorExit), 0);
	const abandonedPid = JSON.parse(coordinatorOutput.trim()).pid;
	await gone(abandonedPid);
	check('control-pipe EOF after caller death closes the job and kills the abandoned driver', () => assert.equal(alive(unrelated.pid), true));
	coordinator = undefined;

	const breakawayMarker = path.join(directory, 'breakaway-marker.txt');
	const breakawayCode = [
		'import subprocess,sys',
		'try:',
		` child=subprocess.Popen([${JSON.stringify(process.execPath)}, '-e', ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(breakawayMarker)},'escaped')`)}], creationflags=0x01000000, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)`,
		' child.wait(timeout=5)',
		' sys.exit(2)',
		'except OSError as error:',
		' print("breakaway-blocked")',
		' sys.exit(0 if error.winerror == 5 else 3)',
	].join('\n');
	job = await launchJobDriver({ ...options, executable: pythonExecutable, args: ['-B', '-c', breakawayCode] });
	job.stdout.resume(); job.stderr.resume();
	assert.equal((await bounded(job.exit)).code, 0);
	await job.dispose();
	check('explicit CREATE_BREAKAWAY_FROM_JOB is denied and cannot run an escaped child', () => assert.equal(fs.existsSync(breakawayMarker), false));
	job = undefined;

	await assert.rejects(launchJobDriver({ ...options, executable: path.join(directory, 'missing-driver.exe') }), /CreateProcess/);
	check('launch failure rejects rather than returning an uncontained driver', () => assert.equal(alive(unrelated.pid), true));
} finally {
	coordinator?.kill();
	if (job) { await job.dispose().catch(error => console.error('Owned job cleanup error: ' + error.message)); }
	unrelated.kill();
	await gone(unrelated.pid);
	fs.rmSync(directory, { recursive: true, force: true });
}
console.log(`${count} passed, 0 failed (actual Windows Job Objects; isolated fixture processes only).`);
