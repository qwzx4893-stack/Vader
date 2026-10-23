/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The renderer's side of "bring your own coding agent": what is installed (or already on this computer), whether each agent is signed in, the
// Install / Connect / Sign out / Test / Remove actions behind the cards in Settings > Coding Agents, what each chat's agent offers (model, mode), and
// the small helpers the chat uses. The work itself (downloading, starting the agent, the protocol) is in the main process,
// electron-main/externalAgentMainService.ts; installs and logins that need a terminal run in a visible one so the person sees every line.

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IVaderSettingsService } from '../../common/vaderSettingsService.js';
import { ExternalAgentDef, externalAgentById } from '../../common/externalAgents/externalAgentCatalog.js';
import { AgentConfigOption, CustomAcpAgent, ExternalAgentInstallPlan, ExternalAgentStatus, IExternalAgentMainService, ProbeResult } from '../../common/externalAgents/externalAgentTypes.js';
import { ITerminalToolService } from '../terminalToolService.js';

/** whether an agent is signed in with the vendor: `checking` while it is being asked, `unknown` when it could not be asked */
export type SignInState = { readonly state: 'checking' | 'in' | 'out' | 'unknown', readonly canSignOut?: boolean, readonly error?: string }

export type ExternalAgentsState = {
	readonly registry?: { readonly checking: boolean, readonly checkedAt?: number, readonly error?: string };
	readonly statuses: { readonly [id: string]: ExternalAgentStatus | undefined }
	/** what is happening to an agent right now ("Downloading... 40%", "Connecting..."), by id */
	readonly busy: { readonly [id: string]: string | undefined }
	readonly errors: { readonly [id: string]: string | undefined }
	/** the result of "Test connection", by id */
	readonly probes: { readonly [id: string]: ProbeResult | undefined }
	readonly signIn: { readonly [id: string]: SignInState | undefined }
	/** what the agent of a chat offers (its model, its mode), by thread id */
	readonly configOfThread: { readonly [threadId: string]: readonly AgentConfigOption[] | undefined }
	/** terminal agents the person has already opened once from here (the button then says "Open" instead of "Connect") */
	readonly opened: { readonly [id: string]: boolean | undefined }
}

export interface IExternalAgentsService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	readonly state: ExternalAgentsState;

	/** reads what is installed without starting agents or checking their sign-in */
	refresh(): Promise<void>;
	/** shows what will be downloaded and from where, then downloads an ACP agent, or runs a terminal agent's installer in a terminal */
	install(agentId: string): Promise<void>;
	/** after asking: deletes a downloaded agent */
	uninstall(agentId: string): Promise<void>;
	/** signs in with the vendor: its own page opens (or its own login runs in a terminal) and the card turns to "Connected" when it is done */
	connect(agentId: string): Promise<void>;
	/** signs out through the agent's own `logout` */
	signOut(agentId: string): Promise<void>;
	/** starts the agent, does the handshake and stops it: shows that it works and what it offers, without signing in */
	testConnection(agentId: string): Promise<void>;
	/** a terminal agent: starts its official program in a Vader terminal, where it asks the person to sign in the first time */
	openInTerminal(agentId: string): Promise<void>;
	/** an ACP agent asked for its sign-in to run in a terminal */
	openSignInTerminal(name: string, command: string, args: readonly string[], env: { readonly [k: string]: string }): Promise<void>;
	checkRegistry(force?: boolean): Promise<string[]>;
	/** after asking (the program runs with the person's rights): adds an agent given by hand */
	addCustomAgent(agent: Omit<CustomAcpAgent, 'id'>): Promise<boolean>;
	removeCustomAgent(id: string): void;
	customAgents(): CustomAcpAgent[];
	/** the folder an agent works in, or null when no folder is open */
	workingFolder(): string | null;
	/** name of the agent currently chosen for the chat, if any */
	selectedAgentName(): string | null;
	setConfigOption(threadId: string, optionId: string, value: string | boolean): Promise<void>;
}
export const IExternalAgentsService = createDecorator<IExternalAgentsService>('vaderExternalAgentsService');

const POLL_MS = 3000
const POLL_LIMIT_MS = 10 * 60_000
const SIGN_IN_POLL_MS = 4000
const SIGN_IN_POLL_LIMIT_MS = 5 * 60_000
const OPENED_KEY = 'vader.externalAgents.openedTerminal'
const messageOf = (e: unknown) => e instanceof Error ? e.message : String(e)

class ExternalAgentsService extends Disposable implements IExternalAgentsService {
	readonly _serviceBrand: undefined;
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	state: ExternalAgentsState = { statuses: {}, busy: {}, errors: {}, probes: {}, signIn: {}, configOfThread: {}, opened: {} };
	private _refreshing: Promise<void> | undefined
	private _checkingRegistry: Promise<string[]> | undefined
	private readonly _installPolls = this._register(new DisposableMap<string, RunOnceScheduler>())
	private readonly _connecting = new Set<string>()

	constructor(
		@IExternalAgentMainService private readonly _main: IExternalAgentMainService,
		@IVaderSettingsService private readonly _settings: IVaderSettingsService,
		@ITerminalToolService private readonly _terminals: ITerminalToolService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
		@IDialogService private readonly _dialogs: IDialogService,
		@IStorageService private readonly _storage: IStorageService,
	) {
		super()
		this._register(this._settings.onDidChangeState(() => this._onDidChange.fire()))
		let opened: { [id: string]: boolean } = {}
		try { opened = JSON.parse(this._storage.get(OPENED_KEY, StorageScope.APPLICATION, '{}')) } catch { /* nothing remembered */ }
		this.state = { ...this.state, opened }
		this._register(this._main.onEvent(e => {
			if (e.type === 'status' && (e.sessionKey.startsWith('install:') || e.sessionKey.startsWith('connect:'))) { this._patch('busy', e.sessionKey.slice(e.sessionKey.indexOf(':') + 1), e.message) }
			else if (e.type === 'auth-terminal' && e.sessionKey.startsWith('connect:')) {
				const id = e.sessionKey.slice('connect:'.length)
				if (!this._connecting.has(id)) return // only the window that requested this sign-in opens its terminal
				const name = externalAgentById(id)?.name ?? this.customAgents().find(c => c.id === id)?.name ?? id
				void this.openSignInTerminal(name, e.command, e.args, e.env).catch(err => this._patch('errors', id, messageOf(err)))
			}
			else if (e.type === 'config') { this.state = { ...this.state, configOfThread: { ...this.state.configOfThread, [e.sessionKey]: e.options } }; this._onDidChange.fire() }
		}))
	}

	private _patch(key: 'busy' | 'errors' | 'probes' | 'signIn', id: string, value: string | ProbeResult | SignInState | undefined) {
		this.state = { ...this.state, [key]: { ...this.state[key], [id]: value } }
		this._onDidChange.fire()
	}

	customAgents(): CustomAcpAgent[] {
		return this._settings.state.globalSettings.customAcpAgents
	}

	workingFolder(): string | null {
		return this._workspace.getWorkspace().folders[0]?.uri.fsPath ?? null
	}

	selectedAgentName(): string | null {
		const id = this._settings.state.globalSettings.externalAgentId
		if (!id) { return null }
		return externalAgentById(id)?.name ?? this.customAgents().find(c => c.id === id)?.name ?? null
	}

	refresh(): Promise<void> {
		// opening the page twice quickly asks once
		this._refreshing ??= this._refresh().finally(() => { this._refreshing = undefined })
		return this._refreshing
	}

	private async _refresh(): Promise<void> {
		try {
			const list = await this._main.getStatuses(this.customAgents())
			const statuses: { [id: string]: ExternalAgentStatus } = {}
			for (const s of list) { statuses[s.id] = s }
			this.state = { ...this.state, statuses }
			this._onDidChange.fire()
		} catch (e) {
			this._patch('errors', '*', messageOf(e))
		}
	}

	private async _checkSignIn(id: string): Promise<boolean> {
		this._patch('signIn', id, { state: 'checking' })
		try {
			const r = await this._main.checkSignIn(id, this.customAgents().find(c => c.id === id))
			this._patch('signIn', id, r.error ? { state: 'unknown', error: r.error } : { state: r.signedIn ? 'in' : 'out', canSignOut: r.canSignOut })
			return !r.error && r.signedIn
		} catch (e) {
			this._patch('signIn', id, { state: 'unknown', error: messageOf(e) })
			return false
		}
	}

	checkRegistry(force = true): Promise<string[]> {
		if (this._checkingRegistry) return this._checkingRegistry
		this.state = { ...this.state, registry: { ...this.state.registry, checking: true, error: undefined } }; this._onDidChange.fire()
		this._checkingRegistry = Promise.resolve().then(async () => {
			try {
				const { updated, checkedAt, warning } = await this._main.checkRegistry(force)
				await this.refresh()
				this.state = { ...this.state, registry: { checking: false, checkedAt: checkedAt ?? Date.now(), error: warning } }
				return [...updated]
			} catch (e) {
				this.state = { ...this.state, registry: { ...this.state.registry, checking: false, error: messageOf(e) } }
				throw e
			} finally { this._checkingRegistry = undefined; this._onDidChange.fire() }
		})
		return this._checkingRegistry
	}

	private _waitUntilReady(def: ExternalAgentDef, busyText: string) {
		this._patch('busy', def.id, busyText)
		const started = Date.now()
		const poll = new RunOnceScheduler(async () => {
			await this.refresh()
			if (this._store.isDisposed || this._installPolls.get(def.id) !== poll) return
			if (this.state.statuses[def.id]?.state === 'ready' || Date.now() - started > POLL_LIMIT_MS) {
				this._installPolls.deleteAndDispose(def.id)
				this._patch('busy', def.id, undefined)
			} else poll.schedule()
		}, POLL_MS)
		this._installPolls.set(def.id, poll)
		poll.schedule()
	}

	/** what installing an ACP agent does, in words, for the question asked before it happens */
	private _describeAcpInstall(def: ExternalAgentDef, plan: ExternalAgentInstallPlan): string {
		if (plan.package) {
			return `Vader will install the npm package ${plan.package} (from the npm registry, without running any install scripts) into its own folder ~/.vader-editor/agents/${def.id}/. Nothing outside that folder is changed.`
		}
		let host = 'the vendor'
		try { host = new URL(plan.archive ?? '').hostname } catch { /* keep the generic name */ }
		return `Vader will download ${def.name} version ${plan.version} from ${host} into its own folder ~/.vader-editor/agents/${def.id}/. ${plan.sha256 ? 'The file is checked against the checksum published in the ACP agent registry.' : `The registry publishes no checksum for it, so the download is protected only by the secure connection to ${host}.`}`
	}

	async install(agentId: string): Promise<void> {
		const def = externalAgentById(agentId)
		if (!def) { return }
		this._patch('errors', agentId, undefined)
		try {
			if (def.kind === 'acp') {
				this._patch('busy', agentId, 'Checking the latest release...')
				const plan = await this._main.getInstallPlan(agentId)
				const isUpdate = !!this.state.statuses[agentId]?.latestVersion
				const { confirmed } = await this._dialogs.confirm({
					custom: true,
					title: `${isUpdate ? 'Update' : 'Install'} ${def.name}`,
					message: `${isUpdate ? 'Update' : 'Install'} ${def.name} in Vader?`,
					detail: `${plan.registryWarning ? plan.registryWarning + '\n\n' : ''}${this._describeAcpInstall(def, plan)}\n\nYou sign in through the agent using your own account. The program runs when you connect, test its connection, or send it a message.\n\nSource: ${def.website}`,
					primaryButton: isUpdate ? 'Update' : 'Install',
				})
				if (!confirmed) { this._patch('busy', agentId, undefined); return }
				this._patch('busy', agentId, 'Starting...')
				await this._main.install(agentId, plan.fingerprint)
				await this.refresh()
				this._patch('busy', agentId, undefined)
				return
			}
			const spec = def.terminal!
			if (spec.needsNode && !(await this._main.hasNode())) {
				throw new Error(`${def.name} is installed with npm, so Node.js has to be installed first (https://nodejs.org).`)
			}
			const command = isWindows ? spec.install.windows : spec.install.posix
			const isUpdate = this.state.statuses[agentId]?.state === 'ready'
			const { confirmed } = await this._dialogs.confirm({
				custom: true,
				title: `${isUpdate ? 'Update' : 'Install'} ${def.name}`,
				message: `Vader will run the vendor's own installer in a terminal, so you can watch every line:`,
				detail: `${command}\n\nSource: ${def.website}`,
				primaryButton: isUpdate ? 'Update' : 'Install',
			})
			if (!confirmed) { return }
			const name = `${isUpdate ? 'Update' : 'Install'} ${def.name}`
			await this._terminals.openProgramTerminal(isWindows
				? { name, cwd: null, executable: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command] }
				: { name, cwd: null, executable: '/bin/sh', args: ['-c', command] })
			// An already installed program is not evidence that this terminal's update
			// completed. Its own terminal reports completion; never infer it from PATH.
			if (isUpdate) return
			this._waitUntilReady(def, 'Installing in the terminal...')
			return
		} catch (e) {
			this._patch('errors', agentId, messageOf(e))
		}
		this._patch('busy', agentId, undefined)
	}

	async uninstall(agentId: string): Promise<void> {
		const def = externalAgentById(agentId)
		if (!def || def.kind !== 'acp') { return }
		const { confirmed } = await this._dialogs.confirm({ title: `Remove ${def.name}`, message: `Delete the copy of ${def.name} that Vader downloaded?`, detail: 'Your account with the vendor is not touched, and a copy you installed yourself is not touched either. You can install it again at any time.', primaryButton: 'Remove' })
		if (!confirmed) { return }
		try {
			if (this._settings.state.globalSettings.externalAgentId === agentId) { await this._settings.setGlobalSetting('externalAgentId', null) }
			await this._main.uninstall(agentId)
			this._patch('probes', agentId, undefined)
			this._patch('signIn', agentId, undefined)
		} catch (e) {
			this._patch('errors', agentId, messageOf(e))
		}
		await this.refresh()
	}

	private _isReady(agentId: string): boolean { return this.state.statuses[agentId]?.state === 'ready' }

	async connect(agentId: string): Promise<void> {
		if (this.state.busy[agentId] || this._connecting.has(agentId) || this._store.isDisposed) return
		this._connecting.add(agentId)
		this._patch('errors', agentId, undefined)
		this._patch('busy', agentId, 'Connecting...')
		try {
			const def = externalAgentById(agentId)
			if (def?.acp && !this._isReady(agentId)) {
				// The vendor's authentication protocol is implemented by its program.
				// Obtain it only after the existing installation consent, then continue
				// into its own sign-in flow. Cancellation is not a successful connection.
				await this.install(agentId)
				if (this._store.isDisposed || !this._isReady(agentId)) return
				this._patch('busy', agentId, 'Connecting...')
			}
			const result = await this._main.connect(agentId, this.customAgents().find(c => c.id === agentId))
			if (result.error) { this._patch('errors', agentId, result.error); this._patch('signIn', agentId, { state: 'unknown', error: result.error }) }
			else if (result.signedIn) { this._patch('signIn', agentId, { state: 'in', canSignOut: result.canSignOut }) }
			else if (result.inTerminal) {
				// the login runs in the terminal that just opened: the card turns to "Connected" by itself when it is done
				this._patch('busy', agentId, 'Finish signing in in the terminal...')
				const started = Date.now()
				while (!this._store.isDisposed && Date.now() - started < SIGN_IN_POLL_LIMIT_MS) {
					await new Promise(r => setTimeout(r, SIGN_IN_POLL_MS))
					if (this._store.isDisposed) break
					if (await this._checkSignIn(agentId)) { break }
				}
			} else { this._patch('signIn', agentId, { state: 'out', canSignOut: result.canSignOut }) }
		} catch (e) {
			this._patch('errors', agentId, messageOf(e))
			this._patch('signIn', agentId, { state: 'unknown', error: messageOf(e) })
		} finally {
			this._patch('busy', agentId, undefined)
			this._connecting.delete(agentId)
		}
	}

	async signOut(agentId: string): Promise<void> {
		if (this.state.busy[agentId] || this._store.isDisposed) return
		this._patch('errors', agentId, undefined)
		this._patch('busy', agentId, 'Signing out...')
		try {
			const r = await this._main.signOut(agentId, this.customAgents().find(c => c.id === agentId))
			if (r.error) { this._patch('errors', agentId, r.error) } else { await this._checkSignIn(agentId) }
		} catch (e) {
			this._patch('errors', agentId, messageOf(e))
		}
		this._patch('busy', agentId, undefined)
	}

	async testConnection(agentId: string): Promise<void> {
		if (this.state.busy[agentId] || this._store.isDisposed) return
		this._patch('errors', agentId, undefined)
		this._patch('busy', agentId, 'Testing...')
		try {
			const custom = this.customAgents().find(c => c.id === agentId)
			const probe = await this._main.probe(agentId, custom)
			this._patch('probes', agentId, probe)
			// Explicitly requested, unlike inventory refresh: ask whether a session can start.
			if (probe.ok) { await this._checkSignIn(agentId) }
			else { this._patch('signIn', agentId, { state: 'unknown', error: probe.error }) }
		} catch (e) {
			this._patch('probes', agentId, { ok: false, error: messageOf(e) })
			this._patch('signIn', agentId, { state: 'unknown', error: messageOf(e) })
		} finally { this._patch('busy', agentId, undefined) }
	}

	async openInTerminal(agentId: string): Promise<void> {
		const def = externalAgentById(agentId)
		const spec = def?.terminal
		if (!def || !spec) { return }
		this._patch('errors', agentId, undefined)
		try {
			const found = await this._main.resolveProgram(spec.command, spec.candidateDirs)
			if (!found) { throw new Error(`${def.name} is not installed yet. Use Install first.`) }
			await this._terminals.openProgramTerminal({ name: def.name, cwd: this.workingFolder(), executable: found, args: [] })
			const opened = { ...this.state.opened, [agentId]: true }
			this.state = { ...this.state, opened }
			this._storage.store(OPENED_KEY, JSON.stringify(opened), StorageScope.APPLICATION, StorageTarget.MACHINE)
			this._onDidChange.fire()
		} catch (e) {
			this._patch('errors', agentId, messageOf(e))
		}
	}

	async openSignInTerminal(name: string, command: string, args: readonly string[], env: { readonly [k: string]: string }): Promise<void> {
		const found = await this._main.resolveProgram(command, [])
		if (!found) { throw new Error(`Could not find "${command}" to start the sign-in.`) }
		await this._terminals.openProgramTerminal({ name: `Sign in to ${name}`, cwd: this.workingFolder(), executable: found, args, env })
	}

	async addCustomAgent(agent: Omit<CustomAcpAgent, 'id'>): Promise<boolean> {
		const { confirmed } = await this._dialogs.confirm({
			type: 'warning',
			title: `Add ${agent.name}`,
			message: 'This program will run on your computer with your user\'s rights whenever you chat with it.',
			detail: `${[agent.command, ...agent.args].join(' ')}\n\nAdd only programs you trust. Vader does not check what it does.`,
			primaryButton: 'Add',
		})
		if (!confirmed) { return false }
		const id = `custom-${agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'}`
		const kept = this._settings.state.globalSettings.customAcpAgents.filter(a => a.id !== id)
		await this._settings.setGlobalSetting('customAcpAgents', [...kept, { id, name: agent.name, command: agent.command, args: [...agent.args] }])
		return true
	}

	removeCustomAgent(id: string): void {
		void this._settings.setGlobalSetting('customAcpAgents', this._settings.state.globalSettings.customAcpAgents.filter(a => a.id !== id))
		if (this._settings.state.globalSettings.externalAgentId === id) { void this._settings.setGlobalSetting('externalAgentId', null) }
	}

	async setConfigOption(threadId: string, optionId: string, value: string | boolean): Promise<void> {
		try {
			await this._main.setConfigOption(threadId, optionId, value)
		} catch (e) {
			this._patch('errors', '*', messageOf(e))
		}
	}
}

registerSingleton(IExternalAgentsService, ExternalAgentsService, InstantiationType.Delayed);
