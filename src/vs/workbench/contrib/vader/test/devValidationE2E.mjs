import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { selectTree, aggregate, identity, ProcessMonitor } from './devValidation/monitor.mjs';
import { assess, scenarioCounts } from './devValidation/verdict.mjs';
import { redact, sanitizeArtifacts } from './devValidation/redact.mjs';
import { expectedScenarios } from './devValidation/expectedScenarios.mjs';
import { realLlmScenarios } from './e2e/scenarios/realLlm.mjs';
import { protectScreenshots } from './e2e/screenshotPrivacy.mjs';

let count = 0;
function check(name, test) { test(); count++; console.log(`PASS: ${name}`); }
const processRow = (pid, parent, created = '2026-01-01T00:00:00Z', overrides = {}) => ({ pid, parent, created, name: 'fixture', role: 'main-or-cli', privateBytes: 1048576, workingBytes: 2097152, cpuMs: 100, readBytes: 100, writeBytes: 200, handles: 5, ...overrides });
const root = processRow(10, 1), child = processRow(11, 10), unrelated = processRow(12, 1);
check('tree excludes unrelated processes and includes grandchildren regardless of snapshot order', () => {
	assert.deepEqual(selectTree([processRow(13, 11), child, unrelated, root], 10).map(p => p.pid).sort(), [10, 11, 13]);
});
check('reparented known child stays observed', () => {
	assert.equal(selectTree([{ ...child, parent: 1 }], 10, identity(root), new Set([identity(child)])).length, 1);
});
check('PID reuse is not mistaken for the previous owned process', () => {
	assert.equal(selectTree([processRow(10, 1, '2026-02-01T00:00:00Z'), child], 10, identity(root)).length, 0);
});
check('CPU and I/O derive from deltas for the same process identity', () => {
	const value = aggregate([{ ...root, cpuMs: 600, readBytes: 400, writeBytes: 600 }], new Map([[identity(root), root]]), 1000);
	assert.equal(value.cpuPercent, 50); assert.equal(value.readBytes, 300); assert.equal(value.writeBytes, 400); assert.equal(value.privateMiB, 1);
});
check('invalid measurements fail instead of being presented as zero consumption', () => assert.throws(() => aggregate([{ ...root, cpuMs: NaN }], new Map(), 1000)));
check('lying summary cannot hide a failing assertion', () => {
	assert.equal(scenarioCounts({ totals: { fail: 0 }, results: [{ status: 'pass', checks: [{ ok: false }] }] }).failed, 1);
});
check('empty and malformed evidence is rejected', () => {
	assert.throws(() => scenarioCounts({ results: [] })); assert.throws(() => scenarioCounts({ results: [{ ok: 'true' }] }, true));
});
check('a partial suite cannot pass after a required scenario disappears', () => {
	assert.throws(() => scenarioCounts({ results: [{ group: 'test', name: 'first', status: 'pass', checks: [{ ok: true }] }] }, false, ['test\nfirst', 'test\nsecond']));
});
check('a green scenario without assertions cannot pass', () => {
	assert.throws(() => scenarioCounts({ results: [{ group: 'test', name: 'empty', status: 'pass', checks: [] }] }));
});
check('the inventory includes every runtime group and unique scenario identity', () => {
	const required = expectedScenarios('scripted');
	assert.equal(new Set(required).size, required.length); assert.ok(required.length > 90);
	assert.ok(required.some(k => k.startsWith('privacy\n'))); assert.ok(required.some(k => k.startsWith('external-agents\n')));
	assert.equal(expectedScenarios('live').length, 4); assert.ok(expectedScenarios('smoke', 'onboarding').length >= 8);
});
for (const surface of ['onboarding', 'shell']) {
	check(`${surface} smoke requires its actual branch checks, without requiring classic-only controls`, () => {
		const required = expectedScenarios('smoke', surface);
		const results = required.map(name => ({ name, ok: true }));
		assert.equal(scenarioCounts({ results }, true, required).failed, 0);
		assert.throws(() => scenarioCounts({ results: results.slice(0, 5).concat(results.slice(6)) }, true, required));
	});
}
check('a missing startup surface cannot suppress required checks', () => assert.throws(() => expectedScenarios('smoke')));
const liveChecks = [];
await realLlmScenarios[2].fn({
	write() {}, abs: name => name, send: async () => {}, runUntilIdle: async () => ({ idle: true }),
	ui: { toolHeaders: async () => [], assistantTexts: async () => [], errorTexts: async () => ['intentional provider failure'] }, page: {},
	check: (name, ok) => liveChecks.push({ name, ok }),
});
check('the actual live-file scenario rejects provider failure even when it returns to idle', () => {
	assert.ok(liveChecks.filter(c => !c.ok).length >= 3);
});
check('screenshots preserve caller options while masking key inputs and visible secret text', () => {
	const page = { screenshot: options => options, locator: selector => ({ selector }), getByText: text => ({ text }) };
	protectScreenshots(page, 'isolated-fixture-not-a-key');
	const options = page.screenshot({ path: 'fixture.png', mask: ['existing-mask'] });
	assert.equal(options.path, 'fixture.png'); assert.equal(options.mask[0], 'existing-mask');
	assert.ok(options.mask[1].selector.includes('password')); assert.equal(options.mask[2].text, 'isolated-fixture-not-a-key');
});
const good = { exitCode: 0, orphans: [], metrics: { rootObserved: true, samples: 3, errors: [], breaches: [] } };
check('clean evidence passes', () => assert.equal(assess(good), true));
for (const [name, change] of Object.entries({ 'failing exit': { exitCode: 1 }, timeout: { timedOut: true }, 'missing results': { resultError: 'missing' }, orphan: { orphans: [child] }, 'sampler failure': { metrics: { ...good.metrics, errors: ['CIM failed'] } }, 'no app observed': { metrics: { ...good.metrics, rootObserved: false } }, 'memory breach': { metrics: { ...good.metrics, breaches: ['limit'] } } })) {
	check(`${name} cannot produce a pass`, () => assert.equal(assess({ ...good, ...change }), false));
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-monitor-fixture-'));
try {
	check('artifact sanitization removes literal test secrets and bearer headers', () => {
		const value = 'isolated-not-a-real-key';
		fs.writeFileSync(path.join(directory, 'redaction.log'), `key=${value}\nAuthorization: Bearer another-fixture-token`);
		sanitizeArtifacts(directory, value);
		assert.ok(!fs.readFileSync(path.join(directory, 'redaction.log'), 'utf8').includes(value));
		assert.equal(redact('Bearer test', ''), 'Bearer [REDACTED]');
	});
	let at = 0;
	const monitor = new ProcessMonitor(10, path.join(directory, 'samples.jsonl'), { sample: async () => ({ at: ++at * 5000, processes: [root] }), privateLimitMiB: 0.5 });
	await monitor.tick(); await monitor.tick(); await monitor.tick();
	check('sustained actual fixture samples breach the resource gate and are retained', () => {
		assert.equal(monitor.report().breaches.length, 1); assert.equal(fs.readFileSync(monitor.output, 'utf8').trim().split('\n').length, 3);
	});
	const broken = new ProcessMonitor(10, path.join(directory, 'broken.jsonl'), { sample: async () => { throw new Error('intentional observer failure'); } });
	await broken.tick();
	check('observer exception is recorded and fails the verdict', () => assert.equal(assess({ ...good, metrics: broken.report() }), false));
	if (process.platform === 'win32') {
		const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true });
		try {
			const real = new ProcessMonitor(child.pid, path.join(directory, 'windows-cim.jsonl'));
			await real.tick(); await real.tick();
			check('real Windows CIM observes an isolated child and produces valid counters', () => {
				assert.deepEqual(real.report().errors, []); assert.equal(real.report().rootObserved, true);
				assert.equal(real.report().samples, 2); assert.ok(real.report().peaks.privateMiB > 0);
			});
		} finally { child.kill(); }
	}
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log(`${count} passed, 0 failed (isolated observer and gate fixtures; not an Electron or vendor connectivity test).`);
