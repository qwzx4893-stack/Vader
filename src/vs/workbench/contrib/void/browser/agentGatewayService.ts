/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IAgentGatewayService, IsolatedTaskResult } from '../common/agentGateway/agentGatewayTypes.js';
import { IChatThreadService } from './chatThreadService.js';

export * from '../common/agentGateway/agentGatewayTypes.js';

// Current implementation: delegates to chatThreadService's (Void-derived, Vader-hardened)
// agent loop. See agentGatewayTypes.ts's doc comment for the reasoning and for what
// replacing this implementation would involve.
class AgentGatewayService implements IAgentGatewayService {
	readonly _serviceBrand: undefined;

	constructor(
		@IChatThreadService private readonly _chatThreadService: IChatThreadService,
	) { }

	async runIsolatedTask(opts: { task: string, agentId?: string }): Promise<IsolatedTaskResult> {
		return this._chatThreadService.runSubagentTask(opts);
	}
}

registerSingleton(IAgentGatewayService, AgentGatewayService, InstantiationType.Delayed);
