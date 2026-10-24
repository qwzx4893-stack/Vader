// Supervises the existing real-Electron tests. No production services are substituted here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import { ProcessMonitor } from './monitor.mjs';
import { assess, scenarioCounts } from './verdict.mjs';
import { redact as redactText, sanitizeArtifacts } from './redact.mjs';
import { expectedScenarios } from './expectedScenarios.mjs';
import { launchJobDriver, mergeObservedOrphans } from './windowsJob.mjs';

const mode = process.argv[2];
if (!['smoke', 'scripted', 'live'].includes(mode) || process.platform !== 'win32') { throw new Error('Usage on Windows: node devValidation/run.mjs smoke|scripted|live'); }
const root = path.resolve(process.env.DEV_VALIDATION_OUT || 'dev-validation');
const out = path.join(root, mode);
fs.mkdirSync(out, { recursive: true });
const secret = process.env.REAL_LLM_API_KEY;
const redact = text => redactText(text, secret);
const environment = { ...process.env, E2E_ARGS: '.', EXTRA_ARGS: '.', NODE_ENV: 'development', VSCODE_DEV: '1', VSCODE_CLI: '1',
	E2E_OUT: path.join(out, 'scenarios'), SMOKE_OUT: out, RUN_LABEL: 'startup', E2E_PRISTINE: '1', E2E_SCENARIO_TIMEOUT: '180000' };
if (mode === 'live') {
	if (!secret || !environment.REAL_LLM_MODEL || !environment.REAL_LLM_BASEURL) { throw new Error('Live validation requires the configured API secret, model and base URL'); }
	environment.E2E_ONLY = '^real-llm '; environment.E2E_SCENARIO_TIMEOUT = '300000';
} else {
	delete environment.REAL_LLM_API_KEY; delete environment.REAL_LLM_MODEL; delete environment.E2E_ONLY;
}
const script = fileURLToPath(new URL(mode === 'smoke' ? '../windowsLiveSmoke.mjs' : '../e2e/suite.mjs', import.meta.url));
const job = await launchJobDriver({ executable: process.execPath, args: [script], env: environment, cwd: process.cwd() });
const log = fs.createWriteStream(path.join(out, 'driver.log'));
// Buffer by line so a secret split across pipe chunks is redacted before it reaches disk/stdout.
function capture(stream, destination) {
	stream.setEncoding('utf8');
	let pending = '';
	stream.on('data', bytes => {
		pending += bytes.toString();
		const lines = pending.split(/\r?\n/); pending = lines.pop();
		for (const line of lines) { const text = redact(line) + '\n'; log.write(text); destination.write(text); }
	});
	stream.on('end', () => { if (pending) { const text = redact(pending) + '\n'; log.write(text); destination.write(text); } });
}
capture(job.stdout, process.stdout); capture(job.stderr, process.stderr);
const monitor = new ProcessMonitor(job.pid, path.join(out, 'resources.jsonl'), { job });
let done = false, exitCode, spawnError, timedOut = false;
const exit = job.exit.then(({ code }) => { exitCode = code; done = true; }, error => { spawnError = redact(error); done = true; });
const deadline = Date.now() + (mode === 'scripted' ? 65 : mode === 'live' ? 30 : 8) * 60000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let orphans = [];
try {
	while (!done) {
		await monitor.tick();
		if (Date.now() > deadline) {
			timedOut = true;
			await job.terminate();
			await Promise.race([exit, sleep(10000)]); break;
		}
		await Promise.race([exit, sleep(5000)]);
	}
	await sleep(5000);
	const remaining = await monitor.tick();
	orphans = remaining.filter(p => p.pid !== job.pid);
} catch (error) {
	spawnError = [spawnError, redact(error)].filter(Boolean).join('; ');
} finally {
	try {
		const cleanup = await job.dispose();
		orphans = mergeObservedOrphans(orphans, cleanup.leaks);
	} catch (error) { spawnError = [spawnError, redact(error)].filter(Boolean).join('; '); }
}
const metrics = monitor.report();
await Promise.all([finished(job.stdout), finished(job.stderr)]);
const resultsFile = mode === 'smoke' ? path.join(out, 'startup/results.json') : path.join(out, 'scenarios/results.json');
let resultError, counts;
try {
	const result = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
	counts = scenarioCounts(result, mode === 'smoke', expectedScenarios(mode, result.initialSurface));
	if (!counts.total || counts.failed || counts.skipped) { resultError = 'Missing, failing or skipped scenarios require review'; }
} catch (e) { resultError = redact(e); }
await new Promise(resolve => log.end(resolve));
// Never upload temporary profile/home stores. The workflow repeats sanitization even on failure.
sanitizeArtifacts(out, secret);
const ok = assess({ exitCode, spawnError, timedOut, resultError, orphans, metrics });
const report = { mode, status: ok ? 'PASS' : 'FAIL', commit: process.env.GITHUB_SHA, exitCode, spawnError, timedOut, resultError, counts, orphans, metrics,
	boundary: mode === 'scripted' ? 'Real development Electron app + isolated scripted model protocol server; not a vendor model' : mode === 'live' ? 'Real development Electron app + configured external model' : 'Real development Electron startup and UI smoke' };
fs.writeFileSync(path.join(out, 'monitor-report.json'), JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
	fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### ${mode}: ${report.status}\n\nScenarios: ${JSON.stringify(counts)}. Peak private tree memory: ${metrics.peaks.privateMiB.toFixed(1)} MiB; CPU: ${metrics.peaks.cpuPercent.toFixed(1)}%; processes: ${metrics.peaks.processes}.\n\n${report.boundary}. ${metrics.limits}\n`);
}
console.log(`${mode}: ${report.status}; monitoring samples=${metrics.samples}, peak private=${metrics.peaks.privateMiB.toFixed(1)} MiB`);
process.exitCode = ok ? 0 : 1;
