/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { AgentExecutionMetadata, AgentExecutionState, IAgentGatewayService, IsolatedTaskResult } from '../common/agentGateway/agentGatewayTypes.js';
import { IChatThreadService } from './chatThreadService.js';

export * from '../common/agentGateway/agentGatewayTypes.js';

// Current implementation: delegates to chatThreadService's (Void-derived, Vader-hardened)
// agent loop. See agentGatewayTypes.ts's doc comment for the reasoning and for what
// replacing this implementation would involve.
//
// This is the real primary path SidebarChat.tsx uses to start/continue/cancel/approve a
// Main Agent turn (see the migration in that file) - not a second, parallel entry point
// that happens to also exist. getExecutionState/getExecutionMetadata translate
// chatThreadService's own state shape (ThreadStreamState, ThreadType) into this Gateway's
// smaller, runtime-independent vocabulary (AgentExecutionState, AgentExecutionMetadata) so
// a future runtime swap wouldn't need callers to learn a new state shape.
class AgentGatewayService extends Disposable implements IAgentGatewayService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeExecutionState: Event<{ threadId: string }>;

	constructor(
		@IChatThreadService private readonly _chatThreadService: IChatThreadService,
	) {
		super();
		// the underlying loop's stream-state change event already fires exactly when a
		// task's execution state changes, so we forward it rather than re-deriving our own
		this.onDidChangeExecutionState = this._chatThreadService.onDidChangeStreamState;
	}

	getExecutionState(threadId: string): AgentExecutionState {
		const s = this._chatThreadService.streamState[threadId];
		if (!s) return { phase: 'idle' };
		if (s.isRunning === 'LLM') return { phase: 'streaming', streamingTextSoFar: s.llmInfo.displayContentSoFar };
		if (s.isRunning === 'tool') return { phase: 'running_tool', pendingToolName: s.toolInfo.toolName };
		if (s.isRunning === 'awaiting_user') return { phase: 'awaiting_approval' };
		if (s.isRunning === 'idle') return { phase: 'idle' };
		// isRunning undefined: either genuinely idle, or idle-with-an-unacknowledged-error
		if (s.error) return { phase: 'error', errorMessage: s.error.message };
		return { phase: 'idle' };
	}

	getExecutionMetadata(threadId: string): AgentExecutionMetadata {
		const thread = this._chatThreadService.state.allThreads[threadId];
		return {
			agentId: thread?.agentId ?? null,
			isSubagentThread: !!thread?.isSubagentThread,
		};
	}

	async startTask(opts: { threadId: string, userMessage: string }): Promise<void> {
		await this._chatThreadService.addUserMessageAndStreamResponse(opts);
	}

	async reviseTask(opts: { threadId: string, userMessage: string, fromMessageIdx: number }): Promise<void> {
		await this._chatThreadService.editUserMessageAndStreamResponse({
			threadId: opts.threadId,
			userMessage: opts.userMessage,
			messageIdx: opts.fromMessageIdx,
		});
	}

	async cancelTask(threadId: string): Promise<void> {
		await this._chatThreadService.abortRunning(threadId);
	}

	approveToolRequest(threadId: string): void {
		this._chatThreadService.approveLatestToolRequest(threadId);
	}

	rejectToolRequest(threadId: string): void {
		this._chatThreadService.rejectLatestToolRequest(threadId);
	}

	dismissError(threadId: string): void {
		this._chatThreadService.dismissStreamError(threadId);
	}

	async runIsolatedTask(opts: { task: string, agentId?: string, onThreadCreated?: (threadId: string) => void, routerCategoryOverride?: 'research' | 'browser' }): Promise<IsolatedTaskResult> {
		return this._chatThreadService.runSubagentTask(opts);
	}

	async runVerificationTask(opts: { objective: string, evidenceText: string, onThreadCreated?: (threadId: string) => void }) {
		return this._chatThreadService.runVerificationTask(opts);
	}
}

registerSingleton(IAgentGatewayService, AgentGatewayService, InstantiationType.Delayed);
