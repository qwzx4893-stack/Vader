/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

// Mirrors chatThreadService.ts's SubagentTaskResult. Not imported directly: common/ code
// must not depend on browser/ code (the reverse is the normal direction in this codebase),
// so the Gateway's implementation (browser/agentGatewayService.ts) is responsible for the
// two shapes staying compatible - both are small and change rarely.
export type IsolatedTaskResult = {
	threadId: string;
	conclusion: string;
	changedFilePaths: string[];
	stalledAwaitingApproval: boolean;
	hadError: boolean;
};

/**
 * The Vader Agent Gateway: a stable seam between callers (the UI, tools, future
 * integrations) and whichever agent execution loop actually runs a task. Today that loop
 * is Void's own chatThreadService, extended with the Policy Engine, agent scoping, and
 * multi-tool-call-per-turn support (see ARCHITECTURE.md's "Agent runtime" section for why
 * a wholesale swap for an external runtime like Cline/Kilo/OpenHands/Zed was evaluated and
 * rejected as an architectural mismatch, in favor of fixing the loop in place and putting
 * this seam behind it).
 *
 * The workbench UI (React chat panel) does NOT go through this interface yet - it's woven
 * into IChatThreadService's stream/thread state for live rendering, and cutting it over is
 * a larger, separately-riskable UI change (see docs/integrations/agent-gateway.md). New
 * integrations that don't need that live-rendering coupling - like the delegate_subagent_task
 * tool - go through this interface today, which is what makes it a real, used abstraction
 * rather than a decorative one: replacing the runtime behind IAgentGatewayService requires
 * touching only this file's implementation and its one current call site, not the UI.
 */
export interface IAgentGatewayService {
	readonly _serviceBrand: undefined;
	/** run a self-contained task to completion in an isolated context and get back a structured result - see chatThreadService.ts's runSubagentTask for the exact semantics */
	runIsolatedTask(opts: { task: string, agentId?: string }): Promise<IsolatedTaskResult>;
}

export const IAgentGatewayService = createDecorator<IAgentGatewayService>('vaderAgentGatewayService');
