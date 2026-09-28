/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { AgentRuntimeHealth, AgentRuntimeSelection, IAgentRuntimeRegistryService } from '../../common/agentRuntime/agentRuntimeTypes.js';
import { CLINE_AGENTS_VERSION, probeClineRuntime } from './clineRuntimeAdapter.js';

export * from '../../common/agentRuntime/agentRuntimeTypes.js';

// Vader addition, part of the Cline Main Agent Runtime integration (see
// docs/integrations/agent-runtime.md for the full design). `@cline/agents`/`@cline/shared`
// are now real, installed dependencies (verified: registry.npmjs.org, an actual `npm
// install`, and this build's own node_modules resolving them) - this service now runs a
// real initialization probe (`probeClineRuntime()`, see clineRuntimeAdapter.ts) rather than
// reporting a hardcoded status. Cline is the DEFAULT: it becomes `active` whenever the probe
// succeeds, and Legacy is used only as the explicit fallback when it doesn't - never silently
// substituted after an ordinary per-task error (see chatThreadService.ts's `_runChatAgent`
// dispatcher, which surfaces a per-task error on the thread rather than flipping this
// selection).
class AgentRuntimeRegistryService extends Disposable implements IAgentRuntimeRegistryService {
	readonly _serviceBrand: undefined;

	private _selection: AgentRuntimeSelection;

	constructor() {
		super();
		this._selection = this._computeSelection();
	}

	private _computeSelection(): AgentRuntimeSelection {
		const checkedAt = new Date().toISOString();

		const legacyHealth: AgentRuntimeHealth = {
			kind: 'legacy',
			status: 'initialized',
			detail: 'Legacy runtime (the Void-derived, Vader-hardened chatThreadService tool-calling loop) is always available - it has no external dependency beyond what already ships. Currently the explicit fallback.',
			checkedAt,
		};

		const probe = probeClineRuntime();
		const clineHealth: AgentRuntimeHealth = probe.ok
			? {
				kind: 'cline',
				status: 'initialized',
				detail: 'Cline Agent Runtime (@cline/agents) initialized successfully and is the active Main Agent Runtime, driving every new chat turn through ClineRuntimeAdapter/VaderAgentModel - see docs/integrations/agent-runtime.md.',
				version: `@cline/agents@${CLINE_AGENTS_VERSION}`,
				checkedAt,
			}
			: {
				kind: 'cline',
				status: 'runtime-error',
				detail: `Cline Agent Runtime failed to initialize (a genuine compatibility failure, not a missing dependency): ${probe.reason}. Falling back to the legacy runtime for this session - see docs/integrations/agent-runtime.md.`,
				version: `@cline/agents@${CLINE_AGENTS_VERSION}`,
				checkedAt,
			};

		return {
			active: probe.ok ? 'cline' : 'legacy',
			reason: probe.ok ? 'default' : 'fallback',
			clineHealth,
			legacyHealth,
		};
	}

	getSelection(): AgentRuntimeSelection {
		return this._selection;
	}

	async refresh(): Promise<AgentRuntimeSelection> {
		this._selection = this._computeSelection();
		return this._selection;
	}
}

registerSingleton(IAgentRuntimeRegistryService, AgentRuntimeRegistryService, InstantiationType.Delayed);
