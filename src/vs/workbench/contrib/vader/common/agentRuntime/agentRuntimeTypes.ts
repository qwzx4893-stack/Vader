/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

/**
 * The Vader Main Agent Runtime seam: sits *behind* `IAgentGatewayService`
 * (see `agentGateway/agentGatewayTypes.ts`), not beside it. The Gateway is the stable
 * contract callers (the UI, subagent delegation, verification) use to start/cancel/approve
 * a task; Cline's `@cline/agents` `AgentRuntime` (wrapped by `browser/agentRuntime/
 * clineRuntimeAdapter.ts`, driven by `chatThreadService.ts`'s `_runChatAgent`) is the one and
 * only engine that actually drives a turn's tool-calling loop - Vader supplies its own
 * `AgentModel` (`vaderAgentModel.ts`, so all of Vader's existing provider/Model-Router
 * plumbing keeps working unchanged - Cline's own `@cline/llms` provider layer is never used)
 * and its own `AgentTool[]` (`clineToolAdapter.ts`, wrapping the existing `toolsService.ts`
 * registry, gated through the exact same Policy Engine + agent-scope + read-only-mode checks
 * every tool call goes through - see `chatThreadService.ts`'s `_evaluateToolCallGate`).
 *
 * There is deliberately no second runtime to select between or fall back to. A failure here
 * (a genuine initialization/compatibility failure, a provider error, a tool throwing) always
 * surfaces as a clear, diagnosable error on the affected thread - see
 * `docs/integrations/agent-runtime.md` for the full design and the migration history of the
 * pre-Cline loop this replaced.
 */

/**
 * Mirrors the mission's required health vocabulary exactly (see
 * docs/integrations/agent-runtime.md) - deliberately not just "ok"/"error", so a failure is
 * always attributable to a specific cause rather than a generic message.
 */
export type AgentRuntimeHealthStatus =
	| 'initialized'         // Cline is active and ready
	| 'unavailable'         // Cline could not be initialized at all (e.g. dependency not installed)
	| 'provider-failure'    // Cline initialized, but the configured model/provider rejected a request
	| 'tool-adapter-failure' // Cline initialized, but Vader's tool-adapter layer failed to wire up
	| 'cancelled'           // the last run was cancelled, not failed
	| 'runtime-error';      // an unexpected error inside the runtime itself, distinct from a provider/tool failure

export type AgentRuntimeHealth = {
	status: AgentRuntimeHealthStatus;
	/** human-readable detail - e.g. "dependency @cline/agents is not installed in this environment" */
	detail: string;
	/** version string of the underlying runtime, when known (e.g. "@cline/agents@0.0.90") */
	version?: string;
	checkedAt: string;
};

export interface IAgentRuntimeRegistryService {
	readonly _serviceBrand: undefined;

	/** Cline's current real health, for the Agent Manager UI and diagnostics - never a hardcoded "healthy". */
	getHealth(): AgentRuntimeHealth;

	/** Re-run the runtime availability check (e.g. after reinstalling/upgrading @cline/agents and reloading). */
	refresh(): Promise<AgentRuntimeHealth>;
}

export const IAgentRuntimeRegistryService = createDecorator<IAgentRuntimeRegistryService>('vaderAgentRuntimeRegistryService');
