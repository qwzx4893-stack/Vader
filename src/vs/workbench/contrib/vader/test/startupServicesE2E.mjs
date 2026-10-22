#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Controlled-service regressions: actual discovery/scheduling code, isolated files
// and clock, transport spies. No vendor program, account or network is used.
// --baseline bundles the pre-fix HEAD source to demonstrate regression sensitivity.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const FakeTimers = require('@sinonjs/fake-timers');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const root = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-startup-'));
const baseline = process.argv.includes('--baseline');
const read = p => baseline ? execFileSync('git', ['show', `HEAD:${path.relative(repo, p).replaceAll('\\', '/')}`], { cwd: repo, encoding: 'utf8' }) : fs.readFileSync(p, 'utf8');
const serviceFile = path.join(root, 'browser/externalAgents/externalAgentsService.ts');
const mainFile = path.join(root, 'electron-main/externalAgentMainService.ts');
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok ? ` ${detail}` : ''}`); };
let main, service, other, clock;
const oldPath = process.env.PATH, oldWinPath = process.env.Path;

try {
    await build({
        stdin: { contents: `export * from '${mainFile.replaceAll('\\', '/')}';\nexport { ExternalAgentsService } from '${serviceFile.replaceAll('\\', '/')}';\nexport { externalAgentCatalog } from '${path.join(root, 'common/externalAgents/externalAgentCatalog.ts').replaceAll('\\', '/')}';`, resolveDir: root, loader: 'ts' },
        bundle: true, platform: 'node', format: 'cjs', outfile: path.join(tmp, 'services.cjs'), logLevel: 'error',
        external: ['yauzl', 'yazl', 'electron', 'original-fs'],
        tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
        plugins: [{ name: 'controlled-services', setup(b) {
            b.onResolve({ filter: /(?:vaderSettingsService|terminalToolService)\.js$/ }, a => ({ path: a.path, namespace: 'test-service-id' }));
            b.onLoad({ filter: /.*/, namespace: 'test-service-id' }, a => ({ contents: `export const ${a.path.includes('terminalTool') ? 'ITerminalToolService' : 'IVaderSettingsService'} = () => {};`, loader: 'js' }));
            b.onLoad({ filter: /externalAgentsService\.ts$/ }, () => ({ contents: read(serviceFile) + '\nexport { ExternalAgentsService };', loader: 'ts', resolveDir: path.dirname(serviceFile) }));
            if (baseline) b.onLoad({ filter: /externalAgentMainService\.ts$/ }, () => ({ contents: read(mainFile), loader: 'ts', resolveDir: path.dirname(mainFile) }));
        } }],
    });
    const m = require(path.join(tmp, 'services.cjs'));
    main = new m.ExternalAgentMainService({ request() { throw new Error('No network permitted'); } }, { warn() {}, info() {}, error() {}, trace() {}, debug() {} });
    const programs = path.join(tmp, 'programs');
    fs.mkdirSync(programs);
    const def = m.externalAgentCatalog.find(d => d.id === 'opencode');
    fs.writeFileSync(path.join(programs, process.platform === 'win32' ? `${def.acp.local.command}.cmd` : def.acp.local.command), 'test fixture: never execute\n');
    process.env.PATH = programs;
    process.env.Path = programs;
    main._installed = async () => undefined;
    let probes = 0;
    main._probeSpec = async () => { probes++; return { ok: true, agentVersion: 'fixture' }; };
    const inventories = await Promise.all([main.getStatuses([]), main.getStatuses([]), main.getStatuses([])]);
    check('inventory finds the local program without starting it', inventories.every(s => s.find(a => a.id === def.id)?.state === 'ready'));
    check('simultaneous inventories perform zero protocol handshakes', probes === 0, `handshakes=${probes}`);
    await main._localProgram(def);
    check('an explicit protocol check still runs when requested', probes > 0);

    let releaseRoom;
    main._makeRoomForAnotherAgent = () => new Promise(resolve => { releaseRoom = resolve; });
    let opens = 0;
    const session = { key: 'one', closed: false };
    main._openSession = async () => { opens++; return session; };
    const a = main._getSession({ sessionKey: 'one', agentId: def.id, cwd: tmp });
    const b = main._getSession({ sessionKey: 'one', agentId: def.id, cwd: tmp });
	await Promise.resolve(); // admission starts in a microtask after the opening owner is registered
    // Baseline has two room reservations; release all rather than hang a failing test.
    // Re-run with a shared already-resolved room gate to expose duplicate opens.
    if (baseline) {
        releaseRoom();
        main._makeRoomForAnotherAgent = async () => {};
        void a;
        await b;
        opens = 0;
        await Promise.all([main._getSession({ sessionKey: 'two', agentId: def.id, cwd: tmp }), main._getSession({ sessionKey: 'two', agentId: def.id, cwd: tmp })]);
    } else { releaseRoom(); await Promise.all([a, b]); }
    check('concurrent requests reserve one session before awaiting capacity', opens === 1, `opens=${opens}`);

    const eventListeners = new Set();
    const mainStub = {
        onEvent(fn) { eventListeners.add(fn); return { dispose() { eventListeners.delete(fn); } }; },
        async getStatuses() { return [{ id: def.id, state: 'ready' }]; },
        async checkSignIn() { mainStub.signIns++; return { signedIn: true }; }, signIns: 0,
        async probe() { mainStub.tests++; return { ok: true }; }, tests: 0,
        async resolveProgram() { return 'fixture-program'; },
        async connect() {
            for (const fn of eventListeners) fn({ type: 'auth-terminal', sessionKey: `connect:${def.id}`, command: 'fixture-program', args: [], env: {} });
            return { signedIn: true };
        },
    };
    const settings = { state: { globalSettings: { customAcpAgents: [] } }, onDidChangeState() { return { dispose() {} }; } };
    let terminals = 0;
    const makeService = () => new m.ExternalAgentsService(mainStub, settings, { async openProgramTerminal() { terminals++; } }, { getWorkspace() { return { folders: [] }; } }, {}, { get() { return '{}'; } });
    service = makeService(); other = makeService();
    await Promise.all([service.refresh(), service.refresh(), other.refresh()]);
    await Promise.resolve();
    check('refreshing discovered agents never starts sign-in sessions', mainStub.signIns === 0, `sign-ins=${mainStub.signIns}`);
    await service.testConnection(def.id);
    check('the explicit Test connection action remains operational', mainStub.tests === 1 && service.state.probes[def.id]?.ok === true);
    await service.connect(def.id);
    await Promise.resolve();
    check('only the window requesting sign-in opens its terminal', terminals === 1, `terminals=${terminals}`);

    clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    let inFlight = 0, maxInFlight = 0, calls = 0;
    mainStub.getStatuses = async () => {
        calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 7000));
        inFlight--;
        return [{ id: def.id, state: 'not-installed' }];
    };
    service._waitUntilReady(def, 'Installing');
    await clock.tickAsync(12_000);
    check('a slow installation poll never overlaps another', maxInFlight === 1, `maximum=${maxInFlight}`);
    service.dispose();
    const atDispose = calls;
    await clock.tickAsync(20_000);
    check('disposing the service prevents any subsequent polling', calls === atDispose, `before=${atDispose}, after=${calls}`);
} finally {
    clock?.uninstall();
    service?.dispose(); other?.dispose(); main?.dispose();
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldWinPath === undefined) delete process.env.Path; else process.env.Path = oldWinPath;
    fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed${baseline ? ' (pre-fix HEAD)' : ''}`);
process.exit(failed ? 1 : 0);
