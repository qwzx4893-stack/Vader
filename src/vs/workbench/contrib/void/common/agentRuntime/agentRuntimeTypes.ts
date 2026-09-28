/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

/**
 * The Vader Main Agent Runtime seam: sits *behind* `IAgentGatewayService`
 * (see `agentGateway/agentGatewayTypes.ts`), not beside it. The Gateway is the stable
 * contract callers (the UI, subagent delegation, verification) use to start/cancel/approve
 * a task; `IAgentRuntime` is the swappable engine `agentGatewayService.ts`'s
 * `IChatThreadService`-backed implementation delegates the actual "drive one chat turn's
 * tool-calling loop" work to.
 *
 * Two implementations exist by design:
 * - `legacy` (`browser/agentRuntime/legacyRuntimeAdapter.ts`): the pre-existing,
 *   Void-derived, Vader-hardened loop (`chatThreadService.ts`'s `_runChatAgent`/
 *   `_runToolCall`), wrapped without behavior changes. Always available, since it has no
 *   external dependency beyond what already ships.
 * - `cline` (`browser/agentRuntime/clineRuntimeAdapter.ts`, **not yet implemented in this
 *   environment** - see `docs/integrations/agent-runtime.md` for why and for the exact,
 *   ready-to-implement design): wraps `@cline/agents`' `AgentRuntime` (the standalone,
 *   browser-safe agentic tool-calling loop from Cline's embeddable SDK), with Vader
 *   supplying its own `AgentModel` (so all of Vader's existing provider/model-router
 *   plumbing keeps working unchanged - Cline's own `@cline/llms` provider layer is not
 *   used) and its own `AgentTool[]` (wrapping the existing `toolsService.ts` registry,
 *   gated through the exact same Policy Engine + agent-scope + read-only-mode checks
 *   `_runToolCall` already enforces - see that file's numbered gate comments).
 *
 * Selection: `cline` is the intended default once available; `legacy` is the explicit,
 * always-available fallback - selected automatically only on a genuine Cline
 * initialization/compatibility failure (never silently after an ordinary task error), or
 * by explicit user/developer choice. `getRuntimeHealth()` reports which is actually active
 * and why, so a fallback is always diagnosable rather than looking like a generic failure.
 */
export type AgentRuntimeKind = 'legacy' | 'cline';

/**
 * Mirrors the mission's required health vocabulary exactly (see
 * docs/integrations/agent-runtime.md) - deliberately not just "ok"/"error", so a fallback
 * or an outage is always attributable to a specific cause rather than a generic message.
 */
export type AgentRuntimeHealthStatus =
	| 'initialized'         // this runtime is active and ready
	| 'unavailable'         // this runtime could not be initialized at all (e.g. dependency not installed)
	| 'provider-failure'    // the runtime initialized, but the configured model/provider rejected a request
	| 'tool-adapter-failure' // the runtime initialized, but Vader's tool-adapter layer failed to wire up
	| 'cancelled'           // the last run for this runtime was cancelled, not failed
	| 'runtime-error';      // an unexpected error inside the runtime itself, distinct from a provider/tool failure

export type AgentRuntimeHealth = {
	kind: AgentRuntimeKind;
	status: AgentRuntimeHealthStatus;
	/** human-readable detail - e.g. "dependency @cline/agents is not installed in this environment" */
	detail: string;
	/** version string of the underlying runtime, when known (e.g. "@cline/agents@0.0.86") */
	version?: string;
	checkedAt: string;
};

/**
 * Which runtime is currently selected to drive Main Agent turns, and why - surfaced to the
 * Settings Agent Manager (see docs/integrations/agent-manager-ui.md) so the legacy runtime
 * is always visibly identifiable when active, never silently substituted.
 */
export type AgentRuntimeSelection = {
	active: AgentRuntimeKind;
	/** 'default' = cline was available and selected normally; 'fallback' = cline failed init/compat and legacy was used instead; 'explicit' = a developer/user setting forced this runtime */
	reason: 'default' | 'fallback' | 'explicit';
	clineHealth: AgentRuntimeHealth;
	legacyHealth: AgentRuntimeHealth;
};

export interface IAgentRuntimeRegistryService {
	readonly _serviceBrand: undefined;

	/** Current runtime selection + both runtimes' health, for the Agent Manager UI and diagnostics. */
	getSelection(): AgentRuntimeSelection;

	/** Re-run runtime availability checks (e.g. after the user installs the Cline SDK dependency and reloads). */
	refresh(): Promise<AgentRuntimeSelection>;
}

export const IAgentRuntimeRegistryService = createDecorator<IAgentRuntimeRegistryService>('vaderAgentRuntimeRegistryService');
