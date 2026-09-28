/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { AgentRuntimeHealth, IAgentRuntimeRegistryService } from '../../common/agentRuntime/agentRuntimeTypes.js';
import { CLINE_AGENTS_VERSION, probeClineRuntime } from './clineRuntimeAdapter.js';

export * from '../../common/agentRuntime/agentRuntimeTypes.js';

// Vader addition, part of the Cline Main Agent Runtime integration (see
// docs/integrations/agent-runtime.md for the full design). Cline is Vader's only Main Agent
// runtime - this service exists purely for honest diagnostics (the Agent Manager UI, and
// anything else that wants to know "is the runtime actually healthy right now"), never for a
// runtime-selection decision. It runs a real initialization probe (`probeClineRuntime()`, see
// clineRuntimeAdapter.ts) rather than reporting a hardcoded status. A failed probe does not
// change what runtime chatThreadService.ts uses (there is only one); it surfaces as
// `runtime-error` here so a genuine incompatibility is visible before - or instead of - a
// confusing per-task failure.
class AgentRuntimeRegistryService extends Disposable implements IAgentRuntimeRegistryService {
	readonly _serviceBrand: undefined;

	private _health: AgentRuntimeHealth;

	constructor() {
		super();
		this._health = this._computeHealth();
	}

	private _computeHealth(): AgentRuntimeHealth {
		const checkedAt = new Date().toISOString();
		const probe = probeClineRuntime();
		return probe.ok
			? {
				status: 'initialized',
				detail: 'Cline Agent Runtime (@cline/agents) initialized successfully and is driving every chat turn through ClineRuntimeAdapter/VaderAgentModel - see docs/integrations/agent-runtime.md.',
				version: `@cline/agents@${CLINE_AGENTS_VERSION}`,
				checkedAt,
			}
			: {
				status: 'runtime-error',
				detail: `Cline Agent Runtime failed to initialize (a genuine compatibility failure, not a missing dependency): ${probe.reason}. Vader has no other Main Agent runtime to run chat turns with until this is resolved - see docs/integrations/agent-runtime.md.`,
				version: `@cline/agents@${CLINE_AGENTS_VERSION}`,
				checkedAt,
			};
	}

	getHealth(): AgentRuntimeHealth {
		return this._health;
	}

	async refresh(): Promise<AgentRuntimeHealth> {
		this._health = this._computeHealth();
		return this._health;
	}
}

registerSingleton(IAgentRuntimeRegistryService, AgentRuntimeRegistryService, InstantiationType.Delayed);
