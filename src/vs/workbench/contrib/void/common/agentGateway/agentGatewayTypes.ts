/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';

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

// Normalized run phase for a task, independent of whichever runtime is behind the Gateway.
// This is deliberately a smaller vocabulary than chatThreadService's own IsRunningType /
// ThreadStreamState (which also carries Void-loop-specific fields like raw tool-call
// parsing state) - callers that only need "what's happening right now" for a task use this
// instead of learning the underlying runtime's state shape.
export type AgentRunPhase =
	| 'idle'              // nothing running, no pending approval, no unacknowledged error
	| 'streaming'         // the model is currently producing a response
	| 'running_tool'      // a tool call is currently executing
	| 'awaiting_approval' // execution is paused pending an approve/reject decision
	| 'error';            // the last run stopped on an error the caller hasn't dismissed yet

export type AgentExecutionState = {
	phase: AgentRunPhase;
	/** partial assistant text produced so far this turn, when phase is 'streaming' */
	streamingTextSoFar?: string;
	/** the tool currently running or awaiting approval, when phase is 'running_tool' or 'awaiting_approval' */
	pendingToolName?: string;
	/** set when phase is 'error' */
	errorMessage?: string;
};

/** identity/model-selection metadata for the agent driving a given task */
export type AgentExecutionMetadata = {
	/** the permanent agent this thread is running as, or null for the default Main Agent behavior */
	agentId: string | null;
	isSubagentThread: boolean;
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
 * This is the real primary path for starting/continuing/cancelling/approving a Main Agent
 * chat turn - the workbench's chat UI (`SidebarChat.tsx`) calls these methods rather than
 * `IChatThreadService`'s own start/continue/abort/approve/reject methods directly. It still
 * reads `IChatThreadService`'s persisted thread data (messages, checkpoints, thread list)
 * directly for rendering history, since that's inherent to the render, not to executing a
 * task - see docs/integrations/agent-gateway.md for the exact boundary and why it's drawn
 * there.
 */
export interface IAgentGatewayService {
	readonly _serviceBrand: undefined;

	/** Fires whenever a task's normalized execution state (see AgentExecutionState) changes. */
	onDidChangeExecutionState: Event<{ threadId: string }>;

	/** Current normalized execution state for a task. */
	getExecutionState(threadId: string): AgentExecutionState;

	/** Identity/model-selection metadata for the agent driving a task. */
	getExecutionMetadata(threadId: string): AgentExecutionMetadata;

	/** Start a new turn on a task: send a user message and stream the response. */
	startTask(opts: { threadId: string, userMessage: string }): Promise<void>;

	/** Revise an earlier turn (editing a past user message) and re-run execution from there. */
	reviseTask(opts: { threadId: string, userMessage: string, fromMessageIdx: number }): Promise<void>;

	/** Cancel whatever is currently running for a task. */
	cancelTask(threadId: string): Promise<void>;

	/** Resolve a pending tool-approval request for a task. */
	approveToolRequest(threadId: string): void;
	rejectToolRequest(threadId: string): void;

	/** Clear a surfaced run error so callers stop reporting it as active. */
	dismissError(threadId: string): void;

	/** run a self-contained task to completion in an isolated context and get back a structured result - see chatThreadService.ts's runSubagentTask for the exact semantics */
	runIsolatedTask(opts: { task: string, agentId?: string }): Promise<IsolatedTaskResult>;
}

export const IAgentGatewayService = createDecorator<IAgentGatewayService>('vaderAgentGatewayService');
