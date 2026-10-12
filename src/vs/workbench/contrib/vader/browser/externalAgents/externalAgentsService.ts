/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The renderer's side of "bring your own coding agent": what is installed, the install and open actions behind the cards in Settings > Models,
// and the small helpers the chat uses. The work itself (downloading, starting the agent, the protocol) is in the main process,
// electron-main/externalAgentMainService.ts; installs of terminal programs run in a visible terminal so the person sees every line.

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IVaderSettingsService } from '../../common/vaderSettingsService.js';
import { ExternalAgentDef, externalAgentById } from '../../common/externalAgents/externalAgentCatalog.js';
import { CustomAcpAgent, ExternalAgentStatus, IExternalAgentMainService } from '../../common/externalAgents/externalAgentTypes.js';
import { ITerminalToolService } from '../terminalToolService.js';

export type ExternalAgentsState = {
	readonly statuses: { readonly [id: string]: ExternalAgentStatus | undefined }
	/** what is happening to an agent right now ("Downloading..."), by id */
	readonly busy: { readonly [id: string]: string | undefined }
	readonly errors: { readonly [id: string]: string | undefined }
}

export interface IExternalAgentsService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	readonly state: ExternalAgentsState;

	refresh(): Promise<void>;
	/** downloads an ACP agent, or (after showing the vendor's install command and asking) runs a terminal agent's installer in a terminal */
	install(agentId: string): Promise<void>;
	/** a terminal agent: starts its official program in a Vader terminal, where it asks the person to sign in the first time */
	openInTerminal(agentId: string): Promise<void>;
	/** an ACP agent asked for its sign-in to run in a terminal */
	openSignInTerminal(name: string, command: string, args: readonly string[], env: { readonly [k: string]: string }): Promise<void>;
	checkRegistry(): Promise<string[]>;
	customAgents(): CustomAcpAgent[];
	/** the folder an agent works in, or null when no folder is open */
	workingFolder(): string | null;
	/** name of the agent currently chosen for the chat, if any */
	selectedAgentName(): string | null;
}
export const IExternalAgentsService = createDecorator<IExternalAgentsService>('vaderExternalAgentsService');

const POLL_MS = 3000
const POLL_LIMIT_MS = 10 * 60_000

class ExternalAgentsService extends Disposable implements IExternalAgentsService {
	readonly _serviceBrand: undefined;
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	state: ExternalAgentsState = { statuses: {}, busy: {}, errors: {} };

	constructor(
		@IExternalAgentMainService private readonly _main: IExternalAgentMainService,
		@IVaderSettingsService private readonly _settings: IVaderSettingsService,
		@ITerminalToolService private readonly _terminals: ITerminalToolService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
		@IDialogService private readonly _dialogs: IDialogService,
	) {
		super()
		this._register(this._settings.onDidChangeState(() => this._onDidChange.fire()))
	}

	private _patch(key: 'busy' | 'errors', id: string, value: string | undefined) {
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
			this._patch('errors', '*', e instanceof Error ? e.message : String(e))
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

	async install(agentId: string): Promise<void> {
		const def = externalAgentById(agentId)
		if (!def) { return }
		this._patch('errors', agentId, undefined)
		try {
			if (def.kind === 'acp') {
				this._patch('busy', agentId, 'Downloading...')
				await this._main.install(agentId)
				await this.refresh()
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
			this._patch('errors', agentId, e instanceof Error ? e.message : String(e))
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
			this._patch('errors', agentId, e instanceof Error ? e.message : String(e))
		}
	}

	async openSignInTerminal(name: string, command: string, args: readonly string[], env: { readonly [k: string]: string }): Promise<void> {
		const found = await this._main.resolveProgram(command, [])
		if (!found) { throw new Error(`Could not find "${command}" to start the sign-in.`) }
		await this._terminals.openProgramTerminal({ name: `Sign in to ${name}`, cwd: this.workingFolder(), executable: found, args, env })
	}
}

registerSingleton(IExternalAgentsService, ExternalAgentsService, InstantiationType.Delayed);
