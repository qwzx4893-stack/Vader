/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Runs the vendors' own coding agents for Vader: starts the official program, speaks the Agent Client Protocol (ACP) with it over stdin/stdout, and
// turns what it does into events for the chat. See common/externalAgents/externalAgentCatalog.ts for why these agents and why this way.
//
// What this service never does: read or store a login. Signing in is the agent's job (it opens its own browser page, or asks to run in a terminal);
// Vader only relays "the agent needs you to sign in". Nothing is downloaded or started without a click: `install` and `runTurn` are called from the
// Settings page and the chat, and the download hosts, file names and command arguments are checked against fixed rules (isAllowedArchiveUrl & co).

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
	CustomAcpAgent, ExternalAgentEvent, ExternalAgentStatus, IExternalAgentMainService, PermissionOption, RunTurnParams
} from '../common/externalAgents/externalAgentTypes.js';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json'
const IS_WINDOWS = process.platform === 'win32'
const STDERR_TAIL_BYTES = 4000
const INIT_TIMEOUT_MS = 60_000
const AUTH_REQUIRED_CODE = -32000

type LiveRegistry = { [registryId: string]: { version: string, distribution: RegistryDistribution } }

type LaunchSpec = { command: string, args: string[], useShell: boolean, isDownloadedBinary?: boolean, env?: { [k: string]: string } }

type Session = {
	readonly key: string
	readonly agentId: string
	readonly cwd: string
	readonly proc: ChildProcess
	readonly connection: acp.ClientConnection
	readonly active: acp.ActiveSession
	readonly stderr: { text: string }
	closed: boolean
}

/** When the protocol connection drops, the real reason is usually that the program stopped; its exit (with what it printed) arrives a moment later. */
const explainedByExit = async (error: unknown, exited: Promise<never>): Promise<unknown> => {
	let timer: ReturnType<typeof setTimeout> | undefined
	const exitError = await Promise.race([exited.then(() => undefined, (x: unknown) => x), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 700) })])
	clearTimeout(timer)
	return exitError ?? error
}

const homeDir = () => os.homedir()
const agentsDir = () => path.join(homeDir(), '.vader-editor', 'agents')

const isFile = async (p: string) => { try { return (await fs.promises.stat(p)).isFile() } catch { return false } }

/** `program` on the PATH (with the Windows executable extensions), or in one of `extraDirs` */
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

const run = (file: string, args: string[]) => new Promise<void>((resolve, reject) => {
	execFile(file, args, { windowsHide: true, timeout: 5 * 60_000 }, (err, _out, stderr) => err ? reject(new Error(`${path.basename(file)} failed: ${String(stderr || err.message).slice(0, 300)}`)) : resolve())
})

/** the LiveRegistry entries that pass every rule below; everything else in the document is ignored */
export const acceptRegistryDocument = (doc: unknown): LiveRegistry => {
	const out: LiveRegistry = {}
	const agents = (doc as { agents?: unknown })?.agents
	if (!Array.isArray(agents)) { return out }
	const wanted = new Set(externalAgentCatalog.map(a => a.acp?.registryId).filter((x): x is string => !!x))
	for (const a of agents as Array<{ id?: unknown, version?: unknown, distribution?: RegistryDistribution }>) {
		if (typeof a?.id !== 'string' || !wanted.has(a.id) || typeof a.version !== 'string' || !/^\d+(\.\d+){1,3}$/.test(a.version) || !a.distribution) { continue }
		const d = a.distribution
		let ok = true
		if (d.npx) { ok = ok && isPlainSpec(d.npx.package) && (d.npx.args ?? []).every(isPlainSpec) }
		if (d.binary) {
			for (const t of Object.values(d.binary)) {
				ok = ok && isAllowedArchiveUrl(t.archive) && isSafeRelativePath(t.cmd) && (t.sha256 === undefined || /^[a-fA-F0-9]{64}$/.test(t.sha256)) && (t.args ?? []).every(isPlainSpec)
			}
		}
		if (d.uvx) { ok = false } // not offered: it would need Python tooling this editor cannot install
		if (ok && (d.npx || d.binary)) { out[a.id] = { version: a.version, distribution: { npx: d.npx, binary: d.binary } } }
	}
	return out
}

export class ExternalAgentMainService extends Disposable implements IExternalAgentMainService {
	readonly _serviceBrand: undefined

	private readonly _onEvent = this._register(new Emitter<ExternalAgentEvent>())
	readonly onEvent = this._onEvent.event

	private readonly _sessions = new Map<string, Session>()
	private readonly _pendingPermissions = new Map<string, { sessionKey: string, resolve: (optionId: string | null) => void }>()
	private _live: LiveRegistry | undefined

	constructor(
		@IRequestService private readonly _requestService: IRequestService,
		@ILogService private readonly _logService: ILogService,
	) {
		super()
		this._register({ dispose: () => { for (const key of [...this._sessions.keys()]) { void this.closeSession(key) } } })
	}

	// ------------------------------------------------------------------ status, install, registry

	async hasNode(): Promise<boolean> {
		return (await findProgram('node', [])) !== null && (await findProgram(IS_WINDOWS ? 'npx.cmd' : 'npx', [])) !== null
	}

	async resolveProgram(program: string, candidateDirs: readonly string[]): Promise<string | null> {
		return findProgram(program, candidateDirs.map(d => path.join(homeDir(), d)))
	}

	private _binaryPathOf(def: ExternalAgentDef): { path: string, version: string } | { error: 'unsupported' } | undefined {
		const dist = distributionOf(def, this._live)
		if (!dist?.distribution.binary) { return undefined }
		const key = platformKeyOf(process.platform, process.arch)
		const target = key ? dist.distribution.binary[key] : undefined
		if (!target || !isSafeRelativePath(target.cmd)) { return { error: 'unsupported' } }
		return { path: path.join(agentsDir(), def.id, dist.version, target.cmd), version: dist.version }
	}

	async getStatuses(custom: readonly CustomAcpAgent[]): Promise<ExternalAgentStatus[]> {
		const out: ExternalAgentStatus[] = []
		const node = await this.hasNode()
		for (const def of externalAgentCatalog) {
			if (def.kind === 'terminal' && def.terminal) {
				const found = await this.resolveProgram(def.terminal.command, def.terminal.candidateDirs)
				out.push(found ? { id: def.id, state: 'ready', detail: found }
					: def.terminal.needsNode && !node ? { id: def.id, state: 'needs-node' } : { id: def.id, state: 'not-installed' })
				continue
			}
			const dist = distributionOf(def, this._live)
			if (!dist) { out.push({ id: def.id, state: 'unsupported' }); continue }
			if (dist.distribution.npx) {
				out.push(node ? { id: def.id, state: 'ready', detail: `${dist.distribution.npx.package}` } : { id: def.id, state: 'needs-node' })
				continue
			}
			const bin = this._binaryPathOf(def)
			if (!bin || 'error' in bin) { out.push({ id: def.id, state: 'unsupported' }); continue }
			out.push((await isFile(bin.path)) ? { id: def.id, state: 'ready', detail: `version ${bin.version}` } : { id: def.id, state: 'not-installed', detail: `version ${bin.version}` })
		}
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

	async install(agentId: string): Promise<ExternalAgentStatus> {
		const def = externalAgentById(agentId)
		if (!def || def.kind !== 'acp') { throw new Error(`"${agentId}" is not an agent Vader downloads.`) }
		const bin = this._binaryPathOf(def)
		if (!bin) { return { id: agentId, state: 'ready', detail: 'started with npx, nothing to download' } }
		if ('error' in bin) { return { id: agentId, state: 'unsupported' } }
		if (await isFile(bin.path)) { return { id: agentId, state: 'ready', detail: `version ${bin.version}` } }

		const dist = distributionOf(def, this._live)!
		const target = dist.distribution.binary![platformKeyOf(process.platform, process.arch)!]
		if (!isAllowedArchiveUrl(target.archive)) { throw new Error('The download address is not on the list of hosts Vader accepts.') }

		const installDir = path.dirname(path.join(agentsDir(), def.id, dist.version, target.cmd))
		const root = path.join(agentsDir(), def.id, dist.version)
		const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vader-agent-'))
		const archive = path.join(tmp, /\.(zip|tgz|tar\.gz|tar\.bz2|tbz2)$/i.exec(target.archive)?.[0] ? 'archive' + /\.(zip|tgz|tar\.gz|tar\.bz2|tbz2)$/i.exec(target.archive)![0] : 'archive.bin')
		try {
			await this._download(target.archive, archive)
			if (target.sha256) {
				const actual = await sha256OfFile(archive)
				if (actual.toLowerCase() !== target.sha256.toLowerCase()) { throw new Error('The downloaded file does not match the checksum published in the agent registry, so it was discarded.') }
			}
			await fs.promises.rm(root, { recursive: true, force: true })
			await fs.promises.mkdir(root, { recursive: true })
			if (/\.zip$/i.test(archive)) {
				await extractZip(archive, root, {}, new CancellationTokenSource().token)
			} else if (/\.(tgz|tar\.gz)$/i.test(archive)) {
				await run('tar', ['-xzf', archive, '-C', root, '--no-same-owner'])
			} else if (/\.(tar\.bz2|tbz2)$/i.test(archive)) {
				await run('tar', ['-xjf', archive, '-C', root, '--no-same-owner'])
			} else {
				await fs.promises.mkdir(installDir, { recursive: true })
				await fs.promises.copyFile(archive, bin.path)
			}
			if (!(await isFile(bin.path))) { throw new Error(`The download did not contain the expected program (${target.cmd}).`) }
			if (!IS_WINDOWS) { await fs.promises.chmod(bin.path, 0o755) }
			return { id: agentId, state: 'ready', detail: `version ${bin.version}` }
		} catch (e) {
			await fs.promises.rm(root, { recursive: true, force: true }).catch(() => { })
			throw e
		} finally {
			await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => { })
		}
	}

	private async _download(url: string, dest: string): Promise<void> {
		const cts = new CancellationTokenSource()
		const timer = setTimeout(() => cts.cancel(), 10 * 60_000)
		try {
			const context = await this._requestService.request({ type: 'GET', url, callSite: 'vaderExternalAgents.download' }, cts.token)
			if (!isSuccess(context)) { throw new Error(`The download server answered ${context.res.statusCode}.`) }
			const out = fs.createWriteStream(dest)
			await new Promise<void>((resolve, reject) => {
				out.on('error', reject)
				listenStream(context.stream, {
					onData: chunk => { out.write(Buffer.from(chunk.buffer)) },
					onError: reject,
					onEnd: () => out.end(() => resolve()),
				})
			})
		} finally {
			clearTimeout(timer); cts.dispose()
		}
	}

	// ------------------------------------------------------------------ starting an agent

	private _launchSpec(agentId: string, custom: CustomAcpAgent | undefined): LaunchSpec {
		if (custom) { return { command: custom.command, args: [...custom.args], useShell: false } }
		const def = externalAgentById(agentId)
		if (!def?.acp) { throw new Error(`Vader does not know an agent called "${agentId}".`) }
		const dist = distributionOf(def, this._live)
		if (!dist) { throw new Error(`No download is known for ${def.name}.`) }
		if (dist.distribution.npx) {
			const { package: pkg, args } = dist.distribution.npx
			if (!isPlainSpec(pkg) || !(args ?? []).every(isPlainSpec)) { throw new Error('The agent\'s package name has characters Vader does not accept.') }
			// npx is a .cmd file on Windows, which can only be started through the shell; every argument is a plain token (checked above)
			return { command: IS_WINDOWS ? 'npx.cmd' : 'npx', args: ['-y', pkg, ...(args ?? [])], useShell: IS_WINDOWS }
		}
		const bin = this._binaryPathOf(def)
		if (!bin || 'error' in bin) { throw new Error(`${def.name} has no build for this computer.`) }
		const target = dist.distribution.binary![platformKeyOf(process.platform, process.arch)!]
		return { command: bin.path, args: [...(target.args ?? [])], useShell: false, isDownloadedBinary: true, env: target.env ? { ...target.env } : undefined }
	}

	private _emit(e: ExternalAgentEvent) { this._onEvent.fire(e) }

	private async _openSession(key: string, agentId: string, custom: CustomAcpAgent | undefined, cwd: string): Promise<Session> {
		const spec = this._launchSpec(agentId, custom)
		if (spec.isDownloadedBinary && !(await isFile(spec.command))) {
			throw new Error('The agent has not been downloaded yet. Use "Download" on its card in Settings > Models.')
		}
		this._emit({ sessionKey: key, type: 'status', message: 'Starting the agent...' })
		const stderr = { text: '' }
		const proc = spawn(spec.command, spec.args, { cwd, env: { ...process.env, ...spec.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: spec.useShell })
		proc.stderr?.on('data', (d: Buffer) => { stderr.text = (stderr.text + d.toString()).slice(-STDERR_TAIL_BYTES) })
		const exited = new Promise<never>((_, reject) => {
			proc.once('error', e => reject(new Error(`Could not start "${spec.command}": ${e.message}`)))
			proc.once('exit', (code, signal) => reject(new Error(`The agent stopped by itself (${signal ?? `exit code ${code}`}).${stderr.text.trim() ? `\n${stderr.text.trim().slice(-600)}` : ''}`)))
		})
		exited.catch(() => { /* reported through the race below */ })

		const stream = acp.ndJsonStream(Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>)
		const app = acp.client({ name: 'vader' })
			.onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
				const options: PermissionOption[] = ctx.params.options.map(o => ({ id: o.optionId, name: o.name, kind: o.kind }))
				const optionId = await this._askPermission(key, ctx.params.toolCall.title ?? 'The agent asks for permission', options)
				return optionId === null ? { outcome: { outcome: 'cancelled' as const } } : { outcome: { outcome: 'selected' as const, optionId } }
			})
		const connection = app.connect(stream)

		try {
			const init = await Promise.race([
				connection.agent.request(acp.methods.agent.initialize, {
					protocolVersion: acp.PROTOCOL_VERSION,
					// the agent keeps its own tools and its own files: none of the client's file or terminal services are offered
					clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, auth: { terminal: true } },
				}),
				exited,
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The agent did not answer within a minute.')), INIT_TIMEOUT_MS)),
			])
			let active: acp.ActiveSession
			try {
				active = await Promise.race([connection.agent.buildSession(cwd).start(), exited])
			} catch (e) {
				if (!(e instanceof acp.RequestError) || e.code !== AUTH_REQUIRED_CODE) { throw e }
				await this._signIn(key, connection, init.authMethods ?? [], spec, exited)
				active = await Promise.race([connection.agent.buildSession(cwd).start(), exited])
			}
			const session: Session = { key, agentId, cwd, proc, connection, active, stderr, closed: false }
			proc.once('exit', () => { session.closed = true; this._sessions.delete(key) })
			this._sessions.set(key, session)
			return session
		} catch (e) {
			const reported = (e instanceof Error && e.message === 'SIGN_IN_IN_TERMINAL') ? e : await explainedByExit(e, exited)
			connection.close()
			proc.kill()
			throw reported
		}
	}

	private async _signIn(key: string, connection: acp.ClientConnection, methods: readonly acp.AuthMethod[], spec: LaunchSpec, exited: Promise<never>): Promise<void> {
		const agentMethod = methods.find(m => { const t = (m as { type?: string }).type; return t === undefined || t === 'agent' })
		if (agentMethod) {
			this._emit({ sessionKey: key, type: 'status', message: `Sign in with the browser page that opened (${agentMethod.name})...` })
			await Promise.race([connection.agent.request(acp.methods.agent.authenticate, { methodId: agentMethod.id }), exited])
			return
		}
		const terminalMethod = methods.find(m => (m as { type?: string }).type === 'terminal') as (acp.AuthMethod & { args?: string[], env?: { [k: string]: string } }) | undefined
		if (terminalMethod) {
			this._emit({ sessionKey: key, type: 'auth-terminal', methodName: terminalMethod.name, command: spec.command, args: [...spec.args, ...(terminalMethod.args ?? [])], env: { ...(spec.env ?? {}), ...(terminalMethod.env ?? {}) } })
			throw new Error('SIGN_IN_IN_TERMINAL')
		}
		throw new Error('The agent needs you to sign in, but offers no sign-in method Vader can start. Sign in once with the agent\'s own program, then try again.')
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

	async runTurn(params: RunTurnParams): Promise<{ stopReason: string }> {
		const { sessionKey: key, agentId, custom, cwd, text } = params
		let session = this._sessions.get(key)
		if (session && (session.closed || session.agentId !== agentId || session.cwd !== cwd)) { await this.closeSession(key); session = undefined }
		session ??= await this._openSession(key, agentId, custom, cwd)

		const s = session
		const exited = new Promise<never>((_, reject) => s.proc.once('exit', (code, signal) => reject(new Error(`The agent stopped (${signal ?? `exit code ${code}`}).${s.stderr.text.trim() ? `\n${s.stderr.text.trim().slice(-600)}` : ''}`))))
		exited.catch(() => { })
		const prompt = s.active.prompt(text)
		// only a failure matters here: a normal end of the turn arrives through nextUpdate() after every update before it
		const failed = prompt.then(() => new Promise<never>(() => { }))
		prompt.catch(() => { })

		try {
			for (;;) {
				const next = await Promise.race([s.active.nextUpdate(), failed, exited])
				if (next.kind === 'stop') { return { stopReason: String(next.stopReason) } }
				this._relay(key, next.update)
			}
		} catch (e) {
			if (s.closed) { this._sessions.delete(key) }
			throw await explainedByExit(e, exited)
		}
	}

	private _relay(key: string, update: acp.SessionUpdate) {
		switch (update.sessionUpdate) {
			case 'agent_message_chunk':
				if (update.content.type === 'text') { this._emit({ sessionKey: key, type: 'text', text: update.content.text }) }
				break
			case 'agent_thought_chunk':
				if (update.content.type === 'text') { this._emit({ sessionKey: key, type: 'thought', text: update.content.text }) }
				break
			case 'tool_call':
				this._emit({ sessionKey: key, type: 'tool', toolCallId: update.toolCallId, title: update.title, status: update.status ?? 'pending' })
				break
			case 'tool_call_update':
				this._emit({ sessionKey: key, type: 'tool', toolCallId: update.toolCallId, title: update.title ?? '', status: update.status ?? 'in_progress' })
				break
			case 'plan':
				this._emit({ sessionKey: key, type: 'plan', entries: update.entries.map(e => ({ content: e.content, status: e.status })) })
				break
			default:
				break // modes, commands, usage and the like are not shown
		}
	}

	async cancel(sessionKey: string): Promise<void> {
		for (const [id, p] of this._pendingPermissions) { if (p.sessionKey === sessionKey) { this._pendingPermissions.delete(id); p.resolve(null) } }
		const s = this._sessions.get(sessionKey)
		if (!s || s.closed) { return }
		try { await s.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: s.active.sessionId }) } catch (e) { this._logService.warn('[externalAgent] cancel failed', e) }
	}

	async closeSession(sessionKey: string): Promise<void> {
		for (const [id, p] of this._pendingPermissions) { if (p.sessionKey === sessionKey) { this._pendingPermissions.delete(id); p.resolve(null) } }
		const s = this._sessions.get(sessionKey)
		if (!s) { return }
		this._sessions.delete(sessionKey)
		s.closed = true
		try { s.active.dispose(); s.connection.close() } catch { /* already closed */ }
		try { s.proc.kill() } catch { /* already gone */ }
	}
}

