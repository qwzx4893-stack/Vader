/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { VADER_AGENTS_STORAGE_KEY } from '../storageKeys.js';
import { agentScopeCheck } from './agentScope.js';
import { toolApprovalTypes } from '../toolsServiceTypes.js';
import { AgentsServiceState, CreatePermanentAgentInput, PermanentAgentDefinition } from './agentsServiceTypes.js';

export * from './agentsServiceTypes.js';

const defaultState: AgentsServiceState = { agents: [] };

export interface IAgentsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<void>;
	readonly state: AgentsServiceState;

	getAgent(id: string): PermanentAgentDefinition | undefined;
	createAgent(input: CreatePermanentAgentInput, createdBy: 'user' | 'main-agent'): PermanentAgentDefinition;
	updateAgent(id: string, patch: Partial<CreatePermanentAgentInput>): PermanentAgentDefinition | undefined;
	deleteAgent(id: string): void;
}

export const IAgentsService = createDecorator<IAgentsService>('vaderAgentsService');

class AgentsService extends Disposable implements IAgentsService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private _state: AgentsServiceState;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
		this._state = this._readState();
	}

	get state(): AgentsServiceState { return this._state; }

	private _readState(): AgentsServiceState {
		try {
			const raw = this._storageService.get(VADER_AGENTS_STORAGE_KEY, StorageScope.APPLICATION);
			if (!raw) return defaultState;
			const parsed = JSON.parse(raw);
			return { agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
		} catch {
			return defaultState;
		}
	}

	private _writeState() {
		this._storageService.store(VADER_AGENTS_STORAGE_KEY, JSON.stringify(this._state), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeState.fire();
	}

	getAgent(id: string): PermanentAgentDefinition | undefined {
		return this._state.agents.find(a => a.id === id);
	}

	createAgent(input: CreatePermanentAgentInput, createdBy: 'user' | 'main-agent'): PermanentAgentDefinition {
		const agent: PermanentAgentDefinition = {
			id: generateUuid(),
			name: input.name,
			description: input.description,
			instructions: input.instructions,
			modelSelection: input.modelSelection ?? null,
			allowedApprovalTypes: input.allowedApprovalTypes ?? [...toolApprovalTypes],
			deniedToolNames: input.deniedToolNames ?? [],
			mcpServerNames: input.mcpServerNames,
			filesystemScopeGlobs: input.filesystemScopeGlobs,
			createdBy,
			createdAt: Date.now(),
		};
		this._state = { agents: [...this._state.agents, agent] };
		this._writeState();
		return agent;
	}

	updateAgent(id: string, patch: Partial<CreatePermanentAgentInput>): PermanentAgentDefinition | undefined {
		let updated: PermanentAgentDefinition | undefined;
		const agents = this._state.agents.map(a => {
			if (a.id !== id) return a;
			updated = {
				...a,
				...patch,
				modelSelection: patch.modelSelection !== undefined ? patch.modelSelection : a.modelSelection,
			};
			return updated;
		});
		if (!updated) return undefined;
		this._state = { agents };
		this._writeState();
		return updated;
	}

	deleteAgent(id: string): void {
		this._state = { agents: this._state.agents.filter(a => a.id !== id) };
		this._writeState();
	}
}

registerSingleton(IAgentsService, AgentsService, InstantiationType.Eager);

/**
 * Filesystem-scope check for a permanent agent (see agentScope.ts). Called from chatThreadService alongside the generic
 * IPolicyService.evaluate() call, with the paths a tool call names plus the real paths behind any symbolic links.
 */
export function agentScopeVerdict(agent: PermanentAgentDefinition, filePaths: string[] | undefined, workspaceRoots: readonly string[]): { kind: 'allow' } | { kind: 'deny', reason: string } {
	const r = agentScopeCheck(agent.filesystemScopeGlobs, filePaths, workspaceRoots);
	if (r.ok) { return { kind: 'allow' }; }
	return { kind: 'deny', reason: `Agent "${agent.name}" is scoped to ${agent.filesystemScopeGlobs!.join(', ')} and cannot touch ${r.path}.` };
}
