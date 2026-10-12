/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The renderer's side of "bring your own coding agent": what is installed, the install / test / remove / open actions behind the cards in
// Settings > Coding Agents, what each chat's agent offers (model, mode), and the small helpers the chat uses. The work itself (downloading, starting
// the agent, the protocol) is in the main process, electron-main/externalAgentMainService.ts; installs of terminal programs run in a visible terminal so
// the person sees every line.

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IVaderSettingsService } from '../../common/vaderSettingsService.js';
import { distributionOf, ExternalAgentDef, externalAgentById } from '../../common/externalAgents/externalAgentCatalog.js';
import { AgentConfigOption, CustomAcpAgent, ExternalAgentStatus, IExternalAgentMainService, ProbeResult } from '../../common/externalAgents/externalAgentTypes.js';
import { ITerminalToolService } from '../terminalToolService.js';

export type ExternalAgentsState = {
	readonly statuses: { readonly [id: string]: ExternalAgentStatus | undefined }
	/** what is happening to an agent right now ("Downloading... 40%"), by id */
	readonly busy: { readonly [id: string]: string | undefined }
	readonly errors: { readonly [id: string]: string | undefined }
	/** the result of "Test connection", by id */
	readonly probes: { readonly [id: string]: ProbeResult | undefined }
	/** what the agent of a chat offers (its model, its mode), by thread id */
	readonly configOfThread: { readonly [threadId: string]: readonly AgentConfigOption[] | undefined }
}

export interface IExternalAgentsService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	readonly state: ExternalAgentsState;

	refresh(): Promise<void>;
	/** shows what will be downloaded and from where, then downloads an ACP agent, or runs a terminal agent's installer in a terminal */
	install(agentId: string): Promise<void>;
	/** after asking: deletes a downloaded agent */
	uninstall(agentId: string): Promise<void>;
	/** starts the agent, does the handshake and stops it: shows that it works and what it offers, without signing in */
	testConnection(agentId: string): Promise<void>;
	/** a terminal agent: starts its official program in a Vader terminal, where it asks the person to sign in the first time */
	openInTerminal(agentId: string): Promise<void>;
	/** an ACP agent asked for its sign-in to run in a terminal */
	openSignInTerminal(name: string, command: string, args: readonly string[], env: { readonly [k: string]: string }): Promise<void>;
	checkRegistry(): Promise<string[]>;
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
const messageOf = (e: unknown) => e instanceof Error ? e.message : String(e)

class ExternalAgentsService extends Disposable implements IExternalAgentsService {
	readonly _serviceBrand: undefined;
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	state: ExternalAgentsState = { statuses: {}, busy: {}, errors: {}, probes: {}, configOfThread: {} };

	constructor(
		@IExternalAgentMainService private readonly _main: IExternalAgentMainService,
		@IVaderSettingsService private readonly _settings: IVaderSettingsService,
		@ITerminalToolService private readonly _terminals: ITerminalToolService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
		@IDialogService private readonly _dialogs: IDialogService,
	) {
		super()
		this._register(this._settings.onDidChangeState(() => this._onDidChange.fire()))
		this._register(this._main.onEvent(e => {
			if (e.type === 'status' && e.sessionKey.startsWith('install:')) { this._patch('busy', e.sessionKey.slice('install:'.length), e.message) }
			else if (e.type === 'config') { this.state = { ...this.state, configOfThread: { ...this.state.configOfThread, [e.sessionKey]: e.options } }; this._onDidChange.fire() }
		}))
	}

	private _patch(key: 'busy' | 'errors' | 'probes', id: string, value: string | ProbeResult | undefined) {
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

	async refresh(): Promise<void> {
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

	async checkRegistry(): Promise<string[]> {
		const { updated } = await this._main.checkRegistry()
		await this.refresh()
		return [...updated]
	}

	private _waitUntilReady(def: ExternalAgentDef, busyText: string) {
		this._patch('busy', def.id, busyText)
		const started = Date.now()
		const timer = setInterval(async () => {
			await this.refresh()
			if (this.state.statuses[def.id]?.state === 'ready' || Date.now() - started > POLL_LIMIT_MS) {
				clearInterval(timer)
				this._patch('busy', def.id, undefined)
			}
		}, POLL_MS)
	}

	/** what installing an ACP agent does, in words, for the question asked before it happens */
	private _describeAcpInstall(def: ExternalAgentDef): string {
		const dist = distributionOf(def)
		if (dist?.distribution.npx) {
			return `Vader will install the npm package ${dist.distribution.npx.package} (from the npm registry, without running any install scripts) into its own folder ~/.vader-editor/agents/${def.id}/. Nothing outside that folder is changed.`
		}
		const first = Object.values(dist?.distribution.binary ?? {})[0]
		let host = 'the vendor'
		try { host = new URL(first?.archive ?? '').hostname } catch { /* keep the generic name */ }
		return `Vader will download ${def.name} version ${dist?.version ?? ''} from ${host} into its own folder ~/.vader-editor/agents/${def.id}/. ${first?.sha256 ? 'The file is checked against the checksum published in the ACP agent registry.' : `The registry publishes no checksum for it, so the download is protected only by the secure connection to ${host}.`}`
	}

	async install(agentId: string): Promise<void> {
		const def = externalAgentById(agentId)
		if (!def) { return }
		this._patch('errors', agentId, undefined)
		try {
			if (def.kind === 'acp') {
				const isUpdate = !!this.state.statuses[agentId]?.latestVersion
				const { confirmed } = await this._dialogs.confirm({
					title: `${isUpdate ? 'Update' : 'Download'} ${def.name}`,
					message: this._describeAcpInstall(def),
					detail: `Source: ${def.website}\nThe program only runs when you send it a message in the chat.`,
					primaryButton: isUpdate ? 'Update' : 'Download',
				})
				if (!confirmed) { return }
				this._patch('busy', agentId, 'Starting...')
				await this._main.install(agentId)
				await this.refresh()
				this._patch('busy', agentId, undefined)
				return
			}
			const spec = def.terminal!
			if (spec.needsNode && !(await this._main.hasNode())) {
				throw new Error(`${def.name} is installed with npm, so Node.js has to be installed first (https://nodejs.org).`)
			}
			const command = isWindows ? spec.install.windows : spec.install.posix
			const { confirmed } = await this._dialogs.confirm({
				title: `Install ${def.name}`,
				message: `Vader will run the vendor's own installer in a terminal, so you can watch every line:`,
				detail: `${command}\n\nSource: ${def.website}`,
				primaryButton: 'Install',
			})
			if (!confirmed) { return }
			await this._terminals.openProgramTerminal(isWindows
				? { name: `Install ${def.name}`, cwd: null, executable: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command] }
				: { name: `Install ${def.name}`, cwd: null, executable: '/bin/sh', args: ['-c', command] })
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
		const { confirmed } = await this._dialogs.confirm({ title: `Remove ${def.name}`, message: `Delete the downloaded ${def.name} from this computer?`, detail: 'Your account with the vendor is not touched. You can download it again at any time.', primaryButton: 'Remove' })
		if (!confirmed) { return }
		try {
			if (this._settings.state.globalSettings.externalAgentId === agentId) { await this._settings.setGlobalSetting('externalAgentId', null) }
			await this._main.uninstall(agentId)
			this._patch('probes', agentId, undefined)
		} catch (e) {
			this._patch('errors', agentId, messageOf(e))
		}
		await this.refresh()
	}

	async testConnection(agentId: string): Promise<void> {
		this._patch('errors', agentId, undefined)
		this._patch('busy', agentId, 'Testing...')
		try {
			const custom = this.customAgents().find(c => c.id === agentId)
			this._patch('probes', agentId, await this._main.probe(agentId, custom))
		} catch (e) {
			this._patch('probes', agentId, { ok: false, error: messageOf(e) })
		}
		this._patch('busy', agentId, undefined)
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
