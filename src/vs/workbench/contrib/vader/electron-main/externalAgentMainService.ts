/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Runs the vendors' own coding agents for Vader: installs the official program, starts it, speaks the Agent Client Protocol (ACP) with it over
// stdin/stdout, and turns what it does into events for the chat. See common/externalAgents/externalAgentCatalog.ts for why these agents and why this way.
//
// What this service never does: read or store a login. Signing in is the agent's job (it opens its own browser page, or asks to run in a terminal);
// Vader only relays "the agent needs you to sign in". Nothing is downloaded or started without a click: `install`, `probe` and `runTurn` are called from
// the Settings page and the chat, and the download addresses, file names and command arguments are checked against fixed rules (isAllowedArchiveUrl & co).
//
// How the agents run (measured against the real programs, see test/externalAgentE2E.mjs):
//   - npm agents (Codex, Gemini CLI) are installed once into ~/.vader-editor/agents/<id>/<version>/ and started with `node <their script>`. That starts in
//     under a second, works offline, runs exactly the pinned version, and needs no shell (so no quoting problems on Windows). `npx` would ask the registry on
//     every start and can take a minute on the first.
//   - binary agents (OpenCode, Cursor, Antigravity) are downloaded from the vendor's release location, checksum-verified when the registry has one.
//   - one process per chat; an idle chat's process is stopped after a while and the conversation is picked up again through the protocol's session resume.

import * as acp from '@agentclientprotocol/sdk';
import { spawn, execFile, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { listenStream } from '../../../../base/common/stream.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { extract as extractZip } from '../../../../base/node/zip.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { asJson, IRequestService, isSuccess } from '../../../../platform/request/common/request.js';
import {
	distributionOf, ExternalAgentDef, externalAgentById, externalAgentCatalog, isAllowedArchiveUrl, isPlainSpec, isSafeRelativePath, platformKeyOf
} from '../common/externalAgents/externalAgentCatalog.js';
import { acpRegistrySnapshot, RegistryDistribution } from '../common/externalAgents/acpRegistrySnapshot.js';
import {
	AgentConfigOption, CustomAcpAgent, ExternalAgentEvent, ExternalAgentStatus, IExternalAgentMainService, PermissionOption, ProbeResult, RunTurnParams, SignInResult
} from '../common/externalAgents/externalAgentTypes.js';
import { chooseAuthMethod, flattenConfigOptions, isAuthRequiredError, modesAsConfigOption, npmBinScript, pathsOfToolCall } from '../common/externalAgents/externalAgentProtocol.js';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
const IS_WINDOWS = process.platform === 'win32'
const STDERR_TAIL_BYTES = 4000
const INIT_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 30_000
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const NPM_TIMEOUT_MS = 10 * 60_000
const IDLE_STOP_MS = 30 * 60_000
const MAX_LIVE_AGENTS = 4

type LiveRegistry = { [registryId: string]: { version: string, distribution: RegistryDistribution } }

type LaunchSpec = { command: string, args: string[], env?: { [k: string]: string } }

/** written next to an installed agent: the exact way it is started, so an older install keeps working when Vader's own list moves on */
type InstallManifest = { id: string, version: string, kind: 'npm' | 'binary', command: string, args: string[], env?: { [k: string]: string } }

type Session = {
	readonly key: string
	readonly agentId: string
	readonly cwd: string
	readonly proc: ChildProcess
	readonly connection: acp.ClientConnection
	readonly exited: Promise<never>
	readonly stderr: { text: string }
	/** how the program was started: a terminal sign-in runs the same program with the method's arguments */
	readonly spec: LaunchSpec
	sessionId: string
	configOptions: acp.SessionConfigOption[]
	modes: acp.SessionModeState | null | undefined
	/** while an old conversation is being loaded the agent replays it as updates; those are not new activity */
	suppressUpdates: boolean
	busy: boolean
	lastUsed: number
	closed: boolean
}

const homeDir = () => os.homedir()
const agentsDir = () => path.join(homeDir(), '.vader-editor', 'agents')

const isFile = async (p: string) => { try { return (await fs.promises.stat(p)).isFile() } catch { return false } }

/** finds a program on the PATH, or in the extra folders; on Windows the PATHEXT extensions are tried */
export const findProgram = async (program: string, extraDirs: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<string | null> => {
	if (path.isAbsolute(program)) { return (await isFile(program)) ? program : null }
	const dirs = (env[IS_WINDOWS ? 'Path' : 'PATH'] ?? env['PATH'] ?? '').split(path.delimiter).filter(Boolean).concat(extraDirs)
	const exts = IS_WINDOWS ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : ['']
	for (const dir of dirs) {
		for (const ext of exts) {
			const candidate = path.join(dir, program + (IS_WINDOWS && !path.extname(program) ? ext : ''))
			if (await isFile(candidate)) { return candidate }
		}
	}
	return null
}

const sha256OfFile = (file: string) => new Promise<string>((resolve, reject) => {
	const h = crypto.createHash('sha256')
	fs.createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')))
})

const run = (file: string, args: string[], options: { cwd?: string, timeout?: number, env?: NodeJS.ProcessEnv } = {}) => new Promise<void>((resolve, reject) => {
	execFile(file, args, { windowsHide: true, timeout: options.timeout ?? 5 * 60_000, cwd: options.cwd, env: options.env ?? process.env, maxBuffer: 8 * 1024 * 1024 }, (err, _out, stderr) => err ? reject(new Error(`${path.basename(file)} failed: ${String(stderr || err.message).trim().slice(-400)}`)) : resolve())
})

/** the version numbers of a folder name, for choosing the newest install: 1.10.0 is newer than 1.9.0 */
const compareVersions = (a: string, b: string): number => {
	const pa = a.split(/[.-]/).map(x => parseInt(x, 10) || 0), pb = b.split(/[.-]/).map(x => parseInt(x, 10) || 0)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) { return d } }
	return 0
}

/** Stops the program and everything it started (an agent runs shell commands and language servers as children). */
const killTree = (proc: ChildProcess) => {
	const pid = proc.pid
	if (!pid) { return }
	if (IS_WINDOWS) { execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => { }); return }
	try { process.kill(-pid, 'SIGTERM') } catch { try { proc.kill('SIGTERM') } catch { /* already gone */ } }
	const later = setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ } }, 3000)
	;(later as unknown as { unref?: () => void }).unref?.()
}

/** When the protocol connection drops, the real reason is usually that the program stopped; its exit (with what it printed) arrives a moment later. */
const explainedByExit = async (error: unknown, exited: Promise<never>): Promise<unknown> => {
	let timer: ReturnType<typeof setTimeout> | undefined
	const exitError = await Promise.race([exited.then(() => undefined, (x: unknown) => x), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 700) })])
	clearTimeout(timer)
	return exitError ?? error
}

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
	let timer: ReturnType<typeof setTimeout>
	return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })]).finally(() => clearTimeout(timer))
}

/** the LiveRegistry entries that pass every rule below; everything else in the document is ignored */
export const acceptRegistryDocument = (doc: unknown): LiveRegistry => {
	const out: LiveRegistry = {}
	const agents = (doc as { agents?: unknown })?.agents
	if (!Array.isArray(agents)) { return out }
	const defOfRegistryId = new Map(externalAgentCatalog.filter(a => a.acp).map(a => [a.acp!.registryId, a]))
	for (const a of agents as Array<{ id?: unknown, version?: unknown, distribution?: RegistryDistribution }>) {
		const def = typeof a?.id === 'string' ? defOfRegistryId.get(a.id) : undefined
		if (!def || typeof a.version !== 'string' || !/^\d+(\.\d+){1,3}$/.test(a.version) || !a.distribution) { continue }
		const d = a.distribution
		let ok = true
		if (d.npx) { ok = ok && isPlainSpec(d.npx.package) && (d.npx.args ?? []).every(isPlainSpec) }
		if (d.binary) {
			for (const [key, t] of Object.entries(d.binary)) {
				const valid = /^(darwin|linux|windows)-(aarch64|x86_64)$/.test(key) && typeof t?.archive === 'string' && isAllowedArchiveUrl(t.archive, def.acp!.archivePrefixes)
					&& typeof t.cmd === 'string' && isSafeRelativePath(t.cmd) && (t.sha256 === undefined || /^[0-9a-fA-F]{64}$/.test(t.sha256))
					&& (t.args ?? []).every(x => typeof x === 'string' && x.length < 200 && !x.includes('\0'))
				ok = ok && valid
			}
		}
		if (d.uvx) { ok = false } // not offered: it would need Python tooling this editor cannot install
		if (ok && (d.npx || d.binary)) { out[def.acp!.registryId] = { version: a.version, distribution: { npx: d.npx, binary: d.binary } } }
	}
	return out
}

/** `@scope/name@1.2.3` -> its name and its version */
const splitPackageSpec = (spec: string): { name: string, version: string } => {
	const at = spec.lastIndexOf('@')
	return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : { name: spec, version: '' }
}

export class ExternalAgentMainService extends Disposable implements IExternalAgentMainService {
	readonly _serviceBrand: undefined

	private readonly _onEvent = this._register(new Emitter<ExternalAgentEvent>())
	readonly onEvent = this._onEvent.event

	private readonly _sessions = new Map<string, Session>()
	private readonly _opening = new Map<string, Promise<Session>>()
	private readonly _pendingPermissions = new Map<string, { sessionKey: string, resolve: (optionId: string | null) => void }>()
	private _live: LiveRegistry | undefined
	/** programs found on this computer and whether they answered the protocol, by path (and the file's modification time), so a settings page opening does not start them every time */
	private readonly _localVerified = new Map<string, { ok: boolean, version?: string, at: number, mtime: number }>()

	constructor(
		@IRequestService private readonly _requestService: IRequestService,
		@ILogService private readonly _logService: ILogService,
	) {
		super()
		const sweep = setInterval(() => this._stopIdleAgents(), 60_000)
		;(sweep as unknown as { unref?: () => void }).unref?.() // the sweep alone must not keep the process alive
		this._register({ dispose: () => { clearInterval(sweep); for (const key of [...this._sessions.keys()]) { void this.closeSession(key) } } })
	}

	private _emit(e: ExternalAgentEvent) { this._onEvent.fire(e) }

	// ------------------------------------------------------------------ status, install, registry

	async hasNode(): Promise<boolean> {
		return (await findProgram('node', [])) !== null && (await this._npmCommand()) !== null
	}

	async resolveProgram(program: string, candidateDirs: readonly string[]): Promise<string | null> {
		return findProgram(program, candidateDirs.map(d => path.join(homeDir(), d)))
	}

	/** how to run npm: its own script with node (no shell, no quoting), or the `npm` program */
	private async _npmCommand(): Promise<{ command: string, args: string[], shell: boolean } | null> {
		const node = await findProgram('node', [])
		if (!node) { return null }
		for (const cli of [path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(path.dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]) {
			if (await isFile(cli)) { return { command: node, args: [cli], shell: false } }
		}
		const npm = await findProgram(IS_WINDOWS ? 'npm.cmd' : 'npm', [])
		return npm ? { command: npm, args: [], shell: IS_WINDOWS } : null
	}

	private _distributionOfDef(def: ExternalAgentDef) { return distributionOf(def, this._live) }

	/** the newest install of an agent that is complete on disk */
	private async _installed(def: ExternalAgentDef): Promise<(InstallManifest & { dir: string }) | undefined> {
		const root = path.join(agentsDir(), def.id)
		let versions: string[] = []
		try { versions = (await fs.promises.readdir(root)).filter(v => /^[0-9A-Za-z._-]+$/.test(v)) } catch { return undefined }
		for (const version of versions.sort((a, b) => compareVersions(b, a))) {
			const dir = path.join(root, version)
			try {
				const m = JSON.parse(await fs.promises.readFile(path.join(dir, 'manifest.json'), 'utf8')) as InstallManifest
				if (m?.id !== def.id || typeof m.command !== 'string' || !Array.isArray(m.args) || !isSafeRelativePath(m.command)) { continue }
				if (await isFile(path.join(dir, m.command))) { return { ...m, dir } }
			} catch { /* not a finished install */ }
		}
		return undefined
	}

	/**
	 * The program a person already has on this computer for an agent (found on the PATH or in the vendor's usual folder), when it answers the protocol.
	 * Nothing is trusted from its name alone: it is started once for a handshake, and the answer is remembered for ten minutes.
	 */
	private async _localProgram(def: ExternalAgentDef): Promise<{ command: string, args: string[], version?: string } | undefined> {
		const l = def.acp?.local
		if (!l) { return undefined }
		const found = await findProgram(l.command, (l.candidateDirs ?? []).map(d => path.join(homeDir(), d)))
		if (!found) { return undefined }
		let mtime = 0
		try { mtime = (await fs.promises.stat(found)).mtimeMs } catch { return undefined }
		const cached = this._localVerified.get(found)
		if (cached && cached.mtime === mtime && Date.now() - cached.at < 10 * 60_000) { return cached.ok ? { command: found, args: [...l.args], version: cached.version } : undefined }
		const probe = await this._probeSpec(`local:${def.id}`, { command: found, args: [...l.args] }, 20_000)
		this._localVerified.set(found, { ok: probe.ok, version: probe.agentVersion, at: Date.now(), mtime })
		return probe.ok ? { command: found, args: [...l.args], version: probe.agentVersion } : undefined
	}

	async getStatuses(custom: readonly CustomAcpAgent[]): Promise<ExternalAgentStatus[]> {
		const node = await this.hasNode()
		const ofDef = async (def: ExternalAgentDef): Promise<ExternalAgentStatus> => {
			if (def.kind === 'terminal' && def.terminal) {
				const found = await this.resolveProgram(def.terminal.command, def.terminal.candidateDirs)
				return found ? { id: def.id, state: 'ready', detail: found }
					: def.terminal.needsNode && !node ? { id: def.id, state: 'needs-node' } : { id: def.id, state: 'not-installed' }
			}
			const dist = this._distributionOfDef(def)
			if (!dist) { return { id: def.id, state: 'unsupported' } }
			const installed = await this._installed(def)
			if (installed) { return { id: def.id, state: 'ready', source: 'vader', installedVersion: installed.version, latestVersion: compareVersions(dist.version, installed.version) > 0 ? dist.version : undefined } }
			// not downloaded by Vader: a program the person already has is used as it is, so there is nothing to download
			const local = await this._localProgram(def)
			if (local) { return { id: def.id, state: 'ready', source: 'local', installedVersion: local.version, detail: local.command } }
			if (dist.distribution.npx) { return { id: def.id, state: node ? 'not-installed' : 'needs-node', detail: `version ${dist.version}` } }
			const key = platformKeyOf(process.platform, process.arch)
			return key && dist.distribution.binary?.[key] ? { id: def.id, state: 'not-installed', detail: `version ${dist.version}` } : { id: def.id, state: 'unsupported' }
		}
		const out = await Promise.all(externalAgentCatalog.map(ofDef))
		for (const c of custom) {
			const found = await findProgram(c.command, [])
			out.push(found ? { id: c.id, state: 'ready', detail: found } : { id: c.id, state: 'missing-command', detail: c.command })
		}
		return out
	}

	async checkRegistry(): Promise<{ updated: string[] }> {
		const cts = new CancellationTokenSource()
		const timer = setTimeout(() => cts.cancel(), 15_000)
		try {
			const context = await this._requestService.request({ type: 'GET', url: REGISTRY_URL, headers: { 'Accept': 'application/json' }, callSite: 'vaderExternalAgents.registry' }, cts.token)
			if (!isSuccess(context)) { throw new Error(`The agent registry answered ${context.res.statusCode}.`) }
			const live = acceptRegistryDocument(await asJson(context))
			this._live = live
			return { updated: Object.entries(live).filter(([id, v]) => acpRegistrySnapshot[id]?.version !== v.version).map(([id]) => id) }
		} finally {
			clearTimeout(timer); cts.dispose()
		}
	}

	private _progress(agentId: string, message: string) { this._emit({ sessionKey: `install:${agentId}`, type: 'status', message }) }

	async install(agentId: string): Promise<ExternalAgentStatus> {
		const def = externalAgentById(agentId)
		if (!def || def.kind !== 'acp' || !def.acp) { throw new Error(`"${agentId}" is not an agent Vader downloads.`) }
		const dist = this._distributionOfDef(def)
		if (!dist) { throw new Error(`No download is known for ${def.name}.`) }
		const existing = await this._installed(def)
		if (existing && compareVersions(existing.version, dist.version) >= 0) { return { id: agentId, state: 'ready', source: 'vader', installedVersion: existing.version } }

		const root = path.join(agentsDir(), def.id)
		const dir = path.join(root, dist.version)
		await fs.promises.rm(dir, { recursive: true, force: true })
		await fs.promises.mkdir(dir, { recursive: true })
		try {
			const manifest = dist.distribution.npx ? await this._installNpm(def, dist.version, dist.distribution.npx, dir) : await this._installBinary(def, dist, dir)
			await fs.promises.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
			// only now are older versions removed: a failed update leaves the working one in place
			for (const other of await fs.promises.readdir(root)) { if (other !== dist.version) { await fs.promises.rm(path.join(root, other), { recursive: true, force: true }).catch(() => { }) } }
			this._progress(agentId, 'Installed.')
			return { id: agentId, state: 'ready', source: 'vader', installedVersion: dist.version }
		} catch (e) {
			await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => { })
			throw e
		}
	}

	private async _installNpm(def: ExternalAgentDef, version: string, npx: { package: string, args?: readonly string[] }, dir: string): Promise<InstallManifest> {
		if (!isPlainSpec(npx.package) || !(npx.args ?? []).every(isPlainSpec)) { throw new Error('The agent\'s package name has characters Vader does not accept.') }
		const npm = await this._npmCommand()
		if (!npm) { throw new Error(`${def.name} is installed with npm, so Node.js has to be installed first (https://nodejs.org).`) }
		this._progress(def.id, `Installing ${npx.package} with npm...`)
		// --ignore-scripts: nothing the packages say is run at install time; the agent itself is the only program started
		const options = ['install', '--prefix', dir, '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error', '--no-package-lock', npx.package]
		const env = { ...process.env, npm_config_update_notifier: 'false' }
		if (npm.shell) {
			// npm.cmd can only be started through the shell: every token is plain except the folders, which are quoted
			const quote = (a: string) => /[\s&()^]/.test(a) ? `"${a}"` : a
			await run(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', `"${[quote(npm.command), ...options.map(quote)].join(' ')}"`], { timeout: NPM_TIMEOUT_MS, env })
		} else {
			await run(npm.command, [...npm.args, ...options], { timeout: NPM_TIMEOUT_MS, env })
		}
		const { name } = splitPackageSpec(npx.package)
		const pkgDir = path.join(dir, 'node_modules', ...name.split('/'))
		const pkg = JSON.parse(await fs.promises.readFile(path.join(pkgDir, 'package.json'), 'utf8')) as { name?: string, bin?: unknown }
		const script = npmBinScript(pkg)
		if (!script) { throw new Error('The installed package has no program Vader can start.') }
		const relative = path.relative(dir, path.join(pkgDir, script)).split(path.sep).join('/')
		if (!isSafeRelativePath(relative) || !(await isFile(path.join(dir, relative)))) { throw new Error('The installed package does not contain its program.') }
		return { id: def.id, version, kind: 'npm', command: relative, args: [...(npx.args ?? [])] }
	}

	private async _installBinary(def: ExternalAgentDef, dist: { version: string, distribution: RegistryDistribution }, dir: string): Promise<InstallManifest> {
		const key = platformKeyOf(process.platform, process.arch)
		const target = key ? dist.distribution.binary?.[key] : undefined
		if (!target || !isSafeRelativePath(target.cmd)) { throw new Error(`${def.name} has no build for this computer.`) }
		if (!isAllowedArchiveUrl(target.archive, def.acp?.archivePrefixes)) { throw new Error('The download address is not on the list of addresses Vader accepts for this agent.') }

		const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vader-agent-'))
		const ext = /\.(zip|tgz|tar\.gz|tar\.bz2|tbz2)$/i.exec(target.archive)?.[0]
		const archive = path.join(tmp, ext ? 'archive' + ext : 'archive.bin')
		try {
			this._progress(def.id, 'Downloading...')
			await this._download(target.archive, archive, def.id)
			if (target.sha256) {
				this._progress(def.id, 'Checking the download...')
				const actual = await sha256OfFile(archive)
				if (actual.toLowerCase() !== target.sha256.toLowerCase()) { throw new Error('The downloaded file does not match the checksum published in the agent registry, so it was discarded.') }
			}
			this._progress(def.id, 'Unpacking...')
			const cmdPath = path.join(dir, target.cmd)
			if (/\.zip$/i.test(archive)) {
				await extractZip(archive, dir, {}, new CancellationTokenSource().token)
			} else if (/\.(tgz|tar\.gz)$/i.test(archive)) {
				await run('tar', ['-xzf', archive, '-C', dir, '--no-same-owner'])
			} else if (/\.(tar\.bz2|tbz2)$/i.test(archive)) {
				await run('tar', ['-xjf', archive, '-C', dir, '--no-same-owner'])
			} else {
				await fs.promises.mkdir(path.dirname(cmdPath), { recursive: true })
				await fs.promises.copyFile(archive, cmdPath)
			}
			if (!(await isFile(cmdPath))) { throw new Error(`The download did not contain the expected program (${target.cmd}).`) }
			if (!IS_WINDOWS) { await fs.promises.chmod(cmdPath, 0o755) }
			return { id: def.id, version: dist.version, kind: 'binary', command: target.cmd.replace(/^\.[\\/]/, ''), args: [...(target.args ?? [])], env: target.env ? { ...target.env } : undefined }
		} finally {
			await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => { })
		}
	}

	async uninstall(agentId: string): Promise<ExternalAgentStatus> {
		const def = externalAgentById(agentId)
		if (!def || def.kind !== 'acp') { throw new Error(`"${agentId}" is not an agent Vader downloads.`) }
		for (const [key, s] of this._sessions) { if (s.agentId === agentId) { await this.closeSession(key) } }
		await fs.promises.rm(path.join(agentsDir(), def.id), { recursive: true, force: true })
		return { id: agentId, state: 'not-installed' }
	}

	private async _download(url: string, dest: string, agentId: string): Promise<void> {
		const cts = new CancellationTokenSource()
		const timer = setTimeout(() => cts.cancel(), 10 * 60_000)
		try {
			const context = await this._requestService.request({ type: 'GET', url, callSite: 'vaderExternalAgents.download' }, cts.token)
			if (!isSuccess(context)) { throw new Error(`The download server answered ${context.res.statusCode}.`) }
			const total = Number(context.res.headers['content-length'] ?? 0)
			let received = 0, lastReport = 0
			const out = fs.createWriteStream(dest)
			await new Promise<void>((resolve, reject) => {
				out.on('error', reject)
				listenStream(context.stream, {
					onData: chunk => {
						out.write(Buffer.from(chunk.buffer))
						received += chunk.byteLength
						const now = Date.now()
						if (now - lastReport > 400) { lastReport = now; this._progress(agentId, total ? `Downloading... ${Math.floor(received * 100 / total)}%` : `Downloading... ${(received / 1048576).toFixed(0)} MB`) }
					},
					onError: reject,
					onEnd: () => out.end(() => resolve()),
				})
			})
		} finally {
			clearTimeout(timer); cts.dispose()
		}
	}

	// ------------------------------------------------------------------ starting an agent

	private async _launchSpec(agentId: string, custom: CustomAcpAgent | undefined): Promise<LaunchSpec> {
		if (custom) {
			const found = await findProgram(custom.command, [])
			if (!found) { throw new Error(`Could not find "${custom.command}". Check the program name in Settings > Coding Agents.`) }
			return { command: found, args: [...custom.args] }
		}
		const def = externalAgentById(agentId)
		if (!def?.acp) { throw new Error(`Vader does not know an agent called "${agentId}".`) }
		const installed = await this._installed(def)
		if (!installed) {
			const local = await this._localProgram(def)
			if (local) { return { command: local.command, args: local.args } }
			throw new Error(`${def.name} is not installed yet. Use "Install" on its card in Settings > Coding Agents.`)
		}
		const script = path.join(installed.dir, installed.command)
		if (installed.kind === 'npm') {
			const node = await findProgram('node', [])
			if (!node) { throw new Error(`${def.name} needs Node.js. Install it from https://nodejs.org and try again.`) }
			return { command: node, args: [script, ...installed.args], env: installed.env }
		}
		return { command: script, args: [...installed.args], env: installed.env }
	}

	/** starts the program and the protocol connection to it */
	private _launch(key: string, spec: LaunchSpec, cwd: string, handlers: { onUpdate: (n: acp.SessionNotification) => void, onPermission: (title: string, options: PermissionOption[]) => Promise<string | null> }) {
		this._emit({ sessionKey: key, type: 'status', message: 'Starting the agent...' })
		const stderr = { text: '' }
		// POSIX: its own process group, so that stopping it also stops what it started
		// a program the person installed with npm is a .cmd launcher on Windows, which only the command interpreter can start; every argument is a plain token from the catalog
		const viaShell = IS_WINDOWS && /\.(cmd|bat)$/i.test(spec.command)
		const quote = (a: string) => /[\s&()^]/.test(a) ? `"${a}"` : a
		const proc = viaShell
			? spawn(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', `"${[spec.command, ...spec.args].map(quote).join(' ')}"`], { cwd, env: { ...process.env, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: true })
			: spawn(spec.command, spec.args, { cwd, env: { ...process.env, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: !IS_WINDOWS })
		proc.stderr?.on('data', (d: Buffer) => { stderr.text = (stderr.text + d.toString()).slice(-STDERR_TAIL_BYTES) })
		const exited = new Promise<never>((_, reject) => {
			proc.once('error', e => reject(new Error(`Could not start "${path.basename(spec.command)}": ${e.message}`)))
			proc.once('exit', (code, signal) => reject(new Error(`The agent stopped by itself (${signal ?? `exit code ${code}`}).${stderr.text.trim() ? `\n${stderr.text.trim().slice(-600)}` : ''}`)))
		})
		exited.catch(() => { /* reported through the races below */ })

		const stream = acp.ndJsonStream(Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>)
		const connection = acp.client({ name: 'vader' })
			.onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
				const options: PermissionOption[] = ctx.params.options.map(o => ({ id: o.optionId, name: o.name, kind: o.kind }))
				const optionId = await handlers.onPermission(ctx.params.toolCall.title ?? 'The agent asks for permission', options)
				return optionId === null ? { outcome: { outcome: 'cancelled' as const } } : { outcome: { outcome: 'selected' as const, optionId } }
			})
			.onNotification(acp.methods.client.session.update, ctx => { handlers.onUpdate(ctx.params) })
			.connect(stream)
		return { proc, stderr, exited, connection }
	}

	private _initialize(connection: acp.ClientConnection, exited: Promise<never>, timeoutMs: number) {
		let timer: ReturnType<typeof setTimeout>
		return Promise.race([
			connection.agent.request(acp.methods.agent.initialize, {
				protocolVersion: acp.PROTOCOL_VERSION,
				// the agent keeps its own tools and its own files: none of the client's file or terminal services are offered
				clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, auth: { terminal: true } },
			}),
			exited,
			new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`The agent did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs) }),
		]).finally(() => clearTimeout(timer))
	}

	private async _probeSpec(key: string, spec: LaunchSpec, timeoutMs: number): Promise<ProbeResult> {
		const started = Date.now()
		let launched: ReturnType<ExternalAgentMainService['_launch']> | undefined
		try {
			launched = this._launch(key, spec, os.tmpdir(), { onUpdate: () => { }, onPermission: async () => null })
			const init = await this._initialize(launched.connection, launched.exited, timeoutMs)
			const caps = init.agentCapabilities as { loadSession?: boolean, sessionCapabilities?: { resume?: unknown } } | undefined
			return {
				ok: true, ms: Date.now() - started, protocolVersion: init.protocolVersion,
				agentName: init.agentInfo?.title ?? init.agentInfo?.name, agentVersion: init.agentInfo?.version,
				authMethods: (init.authMethods ?? []).map(m => ({ id: m.id, name: m.name })),
				canResume: !!(caps?.loadSession || caps?.sessionCapabilities?.resume),
			}
		} catch (e) {
			const reported = launched ? await explainedByExit(e, launched.exited) : e
			return { ok: false, ms: Date.now() - started, error: reported instanceof Error ? reported.message : String(reported) }
		} finally {
			if (launched) { launched.connection.close(); killTree(launched.proc) }
		}
	}

	async probe(agentId: string, custom?: CustomAcpAgent): Promise<ProbeResult> {
		try {
			return await this._probeSpec(`probe:${agentId}`, await this._launchSpec(agentId, custom), PROBE_TIMEOUT_MS)
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) }
		}
	}

	/** runs `fn` against a short-lived copy of the agent (started, handshaken, stopped), in an empty folder of its own */
	private async _temporary<T>(key: string, agentId: string, custom: CustomAcpAgent | undefined, fn: (a: { connection: acp.ClientConnection, init: Awaited<ReturnType<ExternalAgentMainService['_initialize']>>, exited: Promise<never>, spec: LaunchSpec, cwd: string }) => Promise<T>): Promise<T> {
		const spec = await this._launchSpec(agentId, custom)
		const cwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vader-agent-session-'))
		const launched = this._launch(key, spec, cwd, { onUpdate: () => { }, onPermission: async () => null })
		try {
			const init = await this._initialize(launched.connection, launched.exited, INIT_TIMEOUT_MS)
			return await fn({ connection: launched.connection, init, exited: launched.exited, spec, cwd })
		} catch (e) {
			throw (e instanceof Error && e.message === 'SIGN_IN_IN_TERMINAL') ? e : await explainedByExit(e, launched.exited)
		} finally {
			launched.connection.close(); killTree(launched.proc)
			void fs.promises.rm(cwd, { recursive: true, force: true }).catch(() => { })
		}
	}

	async checkSignIn(agentId: string, custom?: CustomAcpAgent): Promise<SignInResult> {
		try {
			return await this._temporary(`check:${agentId}`, agentId, custom, async ({ connection, init, exited, cwd }) => {
				const canSignOut = !!(init.agentCapabilities as { auth?: { logout?: unknown } } | undefined)?.auth?.logout
				try {
					await withTimeout(Promise.race([connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] }), exited]), 30_000, 'The agent did not answer.')
					return { signedIn: true, canSignOut }
				} catch (e) {
					if (isAuthRequiredError(e)) { return { signedIn: false, canSignOut } }
					throw e
				}
			})
		} catch (e) {
			return { signedIn: false, error: e instanceof Error ? e.message : String(e) }
		}
	}

	async connect(agentId: string, custom?: CustomAcpAgent): Promise<SignInResult> {
		const def = externalAgentById(agentId)
		const key = `connect:${agentId}`
		const name = def?.name ?? custom?.name ?? 'The agent'
		try {
			return await this._temporary(key, agentId, custom, async ({ connection, init, exited, spec, cwd }) => {
				const canSignOut = !!(init.agentCapabilities as { auth?: { logout?: unknown } } | undefined)?.auth?.logout
				const startConversation = () => withTimeout(Promise.race([connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] }), exited]), 30_000, `${name} did not answer.`)
				try { await startConversation(); return { signedIn: true, canSignOut } } catch (e) { if (!isAuthRequiredError(e)) { throw e } }
				try {
					await this._signIn(key, connection, init.authMethods ?? [], def?.acp?.authPreference, name, spec, exited)
				} catch (e) {
					if (e instanceof Error && e.message === 'SIGN_IN_IN_TERMINAL') { return { signedIn: false, inTerminal: true, canSignOut } }
					throw e
				}
				await startConversation() // the sign-in is done: the agent must be able to start a conversation now
				return { signedIn: true, canSignOut }
			})
		} catch (e) {
			return { signedIn: false, error: e instanceof Error ? e.message : String(e) }
		}
	}

	async signOut(agentId: string, custom?: CustomAcpAgent): Promise<{ done: boolean, error?: string }> {
		try {
			return await this._temporary(`signout:${agentId}`, agentId, custom, async ({ connection, init, exited }) => {
				if (!(init.agentCapabilities as { auth?: { logout?: unknown } } | undefined)?.auth?.logout) { return { done: false, error: 'This agent has no sign-out of its own. Sign out with its own program.' } }
				await Promise.race([connection.agent.request(acp.methods.agent.logout, {}), exited])
				return { done: true }
			})
		} catch (e) {
			return { done: false, error: e instanceof Error ? e.message : String(e) }
		}
	}

	private async _openSession(key: string, agentId: string, custom: CustomAcpAgent | undefined, cwd: string, resumeSessionId: string | undefined): Promise<Session> {
		const def = externalAgentById(agentId)
		const spec = await this._launchSpec(agentId, custom)
		const holder: { session?: Session } = {}
		const launched = this._launch(key, spec, cwd, {
			onUpdate: n => { if (holder.session && n.sessionId === holder.session.sessionId && !holder.session.suppressUpdates) { this._relay(holder.session, n.update) } },
			onPermission: (title, options) => this._askPermission(key, title, options),
		})
		const { proc, stderr, exited, connection } = launched
		try {
			const init = await this._initialize(connection, exited, INIT_TIMEOUT_MS)
			const caps = init.agentCapabilities as { loadSession?: boolean, sessionCapabilities?: { resume?: unknown } } | undefined
			const session: Session = {
				key, agentId, cwd, proc, connection, exited, stderr, spec, sessionId: '', configOptions: [], modes: undefined,
				suppressUpdates: false, busy: false, lastUsed: Date.now(), closed: false,
			}
			holder.session = session

			const begin = async (): Promise<boolean> => {
				if (resumeSessionId) {
					// resume continues the conversation without replaying it; load replays it as updates, which are dropped
					for (const mode of [caps?.sessionCapabilities?.resume ? 'resume' : '', caps?.loadSession ? 'load' : ''] as const) {
						if (!mode) { continue }
						try {
							session.sessionId = resumeSessionId
							session.suppressUpdates = mode === 'load'
							const r = mode === 'resume'
								? await connection.agent.request(acp.methods.agent.session.resume, { sessionId: resumeSessionId, cwd, mcpServers: [] })
								: await connection.agent.request(acp.methods.agent.session.load, { sessionId: resumeSessionId, cwd, mcpServers: [] })
							session.configOptions = (r?.configOptions ?? []) as acp.SessionConfigOption[]
							session.modes = r?.modes
							return true
						} catch (e) {
							if (isAuthRequiredError(e)) { throw e }
							this._logService.info(`[externalAgent] ${agentId}: could not ${mode} session ${resumeSessionId}: ${e instanceof Error ? e.message : String(e)}`)
						} finally { session.suppressUpdates = false }
					}
				}
				const r = await connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] })
				session.sessionId = r.sessionId
				session.configOptions = (r.configOptions ?? []) as acp.SessionConfigOption[]
				session.modes = r.modes
				return false
			}

			let resumed: boolean
			try {
				resumed = await Promise.race([begin(), exited])
			} catch (e) {
				if (!isAuthRequiredError(e)) { throw e }
				await this._signIn(key, connection, init.authMethods ?? [], def?.acp?.authPreference, def?.name ?? 'The agent', spec, exited)
				resumed = await Promise.race([begin(), exited])
			}

			proc.once('exit', () => { session.closed = true; if (this._sessions.get(key) === session) { this._sessions.delete(key) } })
			this._sessions.set(key, session)
			this._emit({ sessionKey: key, type: 'session', sessionId: session.sessionId, resumed })
			this._emitConfig(session)
			return session
		} catch (e) {
			const reported = (e instanceof Error && e.message === 'SIGN_IN_IN_TERMINAL') ? e : await explainedByExit(e, exited)
			connection.close()
			killTree(proc)
			if (!(reported instanceof Error && reported.message === 'SIGN_IN_IN_TERMINAL') && stderr.text.trim()) { this._logService.warn(`[externalAgent] ${agentId} failed: ${stderr.text.trim().slice(-300)}`) }
			throw reported
		}
	}

	private async _signIn(key: string, connection: acp.ClientConnection, methods: readonly acp.AuthMethod[], preferred: readonly string[] | undefined, name: string, spec: LaunchSpec, exited: Promise<never>): Promise<void> {
		const choice = chooseAuthMethod(methods as unknown as Parameters<typeof chooseAuthMethod>[0], preferred)
		if (choice.kind === 'agent') {
			this._emit({ sessionKey: key, type: 'status', message: `Sign in with the page that opened (${choice.method.name})...` })
			await withTimeout(Promise.race([connection.agent.request(acp.methods.agent.authenticate, { methodId: choice.method.id }), exited]), SIGN_IN_TIMEOUT_MS, `${name} did not finish signing in within ${SIGN_IN_TIMEOUT_MS / 60_000} minutes. Send your message again to retry.`)
			return
		}
		if (choice.kind === 'terminal') {
			// the agent either names the program to run (an absolute path inside its own install) or means "me, with these arguments"
			const t = choice.terminal
			const command = t.command ?? spec.command
			const args = t.command ? [...t.args] : [...spec.args, ...t.args]
			this._emit({ sessionKey: key, type: 'auth-terminal', methodName: choice.method.name, command, args, env: { ...(spec.env ?? {}), ...t.env } })
			throw new Error('SIGN_IN_IN_TERMINAL')
		}
		throw new Error(`${name} needs you to sign in, but the only ways it offers need a key or a cloud setting (${choice.offered.join(', ')}). Sign in once with the vendor's own program, then try again.`)
	}

	private _askPermission(sessionKey: string, title: string, options: PermissionOption[]): Promise<string | null> {
		return new Promise(resolve => {
			const requestId = generateUuid()
			this._pendingPermissions.set(requestId, { sessionKey, resolve })
			this._emit({ sessionKey, type: 'permission', requestId, title, options })
		})
	}

	async answerPermission(requestId: string, optionId: string | null): Promise<void> {
		const p = this._pendingPermissions.get(requestId)
		if (!p) { return }
		this._pendingPermissions.delete(requestId)
		p.resolve(optionId)
	}

	// ------------------------------------------------------------------ one conversation turn

	private async _getSession(params: RunTurnParams): Promise<Session> {
		const { sessionKey: key, agentId, custom, cwd, resumeSessionId } = params
		const existing = this._sessions.get(key)
		if (existing && !existing.closed && existing.agentId === agentId && existing.cwd === cwd) { return existing }
		if (existing) { await this.closeSession(key) }
		let pending = this._opening.get(key)
		if (!pending) {
			await this._makeRoomForAnotherAgent()
			pending = this._openSession(key, agentId, custom, cwd, resumeSessionId).finally(() => this._opening.delete(key))
			this._opening.set(key, pending)
		}
		return pending
	}

	async runTurn(params: RunTurnParams): Promise<{ stopReason: string }> {
		const s = await this._getSession(params)
		if (s.busy) { throw new Error('This chat is still working on the previous message.') }
		s.busy = true
		s.lastUsed = Date.now()
		const def = externalAgentById(params.agentId)
		try {
			const send = () => Promise.race([s.connection.agent.request(acp.methods.agent.session.prompt, { sessionId: s.sessionId, prompt: [{ type: 'text', text: params.text }] }), s.exited])
			let result: acp.PromptResponse
			try {
				result = await send()
			} catch (e) {
				if (!isAuthRequiredError(e) || s.closed) { throw e }
				// the sign-in ran out while the agent was idle: sign in again and repeat this one message
				const init = await s.connection.agent.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, auth: { terminal: true } } })
				await this._signIn(s.key, s.connection, init.authMethods ?? [], def?.acp?.authPreference, def?.name ?? 'The agent', s.spec, s.exited)
				result = await send()
			}
			return { stopReason: String(result.stopReason) }
		} catch (e) {
			if (s.closed) { this._sessions.delete(s.key) }
			throw await explainedByExit(e, s.exited)
		} finally {
			s.busy = false
			s.lastUsed = Date.now()
		}
	}

	private _relay(s: Session, update: acp.SessionUpdate) {
		const key = s.key
		switch (update.sessionUpdate) {
			case 'agent_message_chunk':
				if (update.content.type === 'text') { this._emit({ sessionKey: key, type: 'text', text: update.content.text }) }
				break
			case 'agent_thought_chunk':
				if (update.content.type === 'text') { this._emit({ sessionKey: key, type: 'thought', text: update.content.text }) }
				break
			case 'tool_call':
				this._emit({ sessionKey: key, type: 'tool', toolCallId: update.toolCallId, title: update.title, status: update.status ?? 'pending', kind: update.kind ?? undefined, paths: pathsOfToolCall(update) })
				break
			case 'tool_call_update':
				this._emit({ sessionKey: key, type: 'tool', toolCallId: update.toolCallId, title: update.title ?? '', status: update.status ?? 'in_progress', kind: update.kind ?? undefined, paths: pathsOfToolCall(update) })
				break
			case 'plan':
				this._emit({ sessionKey: key, type: 'plan', entries: update.entries.map(e => ({ content: e.content, status: e.status })) })
				break
			case 'config_option_update':
				s.configOptions = update.configOptions as acp.SessionConfigOption[]
				this._emitConfig(s)
				break
			case 'current_mode_update':
				if (s.modes) { s.modes = { ...s.modes, currentModeId: update.currentModeId } }
				this._emitConfig(s)
				break
			default:
				break // commands, usage, titles and the like are not shown
		}
	}

	private _configOf(s: Session): AgentConfigOption[] {
		const options = flattenConfigOptions(s.configOptions as unknown as Parameters<typeof flattenConfigOptions>[0])
		const mode = options.some(o => o.category === 'mode') ? undefined : modesAsConfigOption(s.modes)
		return mode ? [mode, ...options] : options
	}

	/** always sent, also when empty: a chat that moved to another agent must not keep showing the old agent's settings */
	private _emitConfig(s: Session) {
		this._emit({ sessionKey: s.key, type: 'config', options: this._configOf(s) })
	}

	async setConfigOption(sessionKey: string, optionId: string, value: string | boolean): Promise<void> {
		const s = this._sessions.get(sessionKey)
		if (!s || s.closed) { throw new Error('The agent is not running for this chat yet: send a message first.') }
		if (optionId === '__mode') {
			await s.connection.agent.request(acp.methods.agent.session.setMode, { sessionId: s.sessionId, modeId: String(value) })
			if (s.modes) { s.modes = { ...s.modes, currentModeId: String(value) } }
		} else {
			const r = typeof value === 'boolean'
				? await s.connection.agent.request(acp.methods.agent.session.setConfigOption, { sessionId: s.sessionId, configId: optionId, type: 'boolean', value })
				: await s.connection.agent.request(acp.methods.agent.session.setConfigOption, { sessionId: s.sessionId, configId: optionId, value })
			s.configOptions = (r.configOptions ?? s.configOptions) as acp.SessionConfigOption[]
		}
		this._emitConfig(s)
	}

	async cancel(sessionKey: string): Promise<void> {
		for (const [id, p] of this._pendingPermissions) { if (p.sessionKey === sessionKey) { this._pendingPermissions.delete(id); p.resolve(null) } }
		const s = this._sessions.get(sessionKey)
		if (!s || s.closed) { return }
		try { await s.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: s.sessionId }) } catch (e) { this._logService.warn('[externalAgent] cancel failed', e) }
	}

	async closeSession(sessionKey: string): Promise<void> {
		for (const [id, p] of this._pendingPermissions) { if (p.sessionKey === sessionKey) { this._pendingPermissions.delete(id); p.resolve(null) } }
		const s = this._sessions.get(sessionKey)
		if (!s) { return }
		this._sessions.delete(sessionKey)
		s.closed = true
		try { s.connection.close() } catch { /* already closed */ }
		killTree(s.proc)
	}

	/** a chat that has been quiet for a while gives its process back; its next message resumes the conversation */
	private _stopIdleAgents() {
		const now = Date.now()
		for (const [key, s] of this._sessions) { if (!s.busy && now - s.lastUsed > IDLE_STOP_MS) { void this.closeSession(key) } }
	}

	private async _makeRoomForAnotherAgent() {
		while (this._sessions.size >= MAX_LIVE_AGENTS) {
			const idle = [...this._sessions.values()].filter(s => !s.busy).sort((a, b) => a.lastUsed - b.lastUsed)[0]
			if (!idle) { throw new Error(`${MAX_LIVE_AGENTS} agents are working at the same time. Wait for one to finish, then send your message again.`) }
			await this.closeSession(idle.key)
		}
	}
}
