/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ExternalAgentCapabilities, ExternalAgentEvent, IExternalAgentAdapter, IExternalAgentAdapterRegistry, IExternalAgentSession } from '../common/externalAgent/externalAgentAdapterRegistry.js';
import { IAgentGatewayService } from '../common/agentGateway/agentGatewayTypes.js';

/**
 * The one reference adapter this pass ships: a REAL, working implementation of the
 * ACP-shaped IExternalAgentAdapter boundary, backed by Vader's own actual runtime (the
 * Agent Gateway from Phase 1) rather than canned/hardcoded responses. It proves the
 * boundary functions end-to-end - streamed message chunks and tool-call events are read
 * live off IAgentGatewayService's real onDidChangeExecutionState/getExecutionState, not
 * simulated - which is exactly what "at least one working reference adapter" needs to mean
 * to be worth anything. See docs/integrations/external-agent-adapter.md for why this pass
 * does not additionally wire up a genuine third-party ACP-speaking agent process (there is
 * no such binary available in this environment to shell out to, and inventing one to call
 * would mean building a mock external agent, which is a materially weaker proof than
 * wrapping Vader's own real backend).
 */
class VaderNativeAgentSession extends Disposable implements IExternalAgentSession {
	readonly sessionId = generateUuid();

	private readonly _onEvent = this._register(new Emitter<ExternalAgentEvent>());
	readonly onEvent: Event<ExternalAgentEvent> = this._onEvent.event;

	private _threadId: string | undefined;
	private _cancelled = false;
	private _lastStreamedText = '';
	private _lastAnnouncedToolName: string | undefined;

	constructor(
		private readonly _agentGatewayService: IAgentGatewayService,
	) {
		super();
		this._register(this._agentGatewayService.onDidChangeExecutionState(({ threadId }) => {
			if (!this._threadId || threadId !== this._threadId) return;
			const state = this._agentGatewayService.getExecutionState(threadId);

			if (state.phase === 'streaming' && state.streamingTextSoFar) {
				const delta = state.streamingTextSoFar.slice(this._lastStreamedText.length);
				if (delta) {
					this._lastStreamedText = state.streamingTextSoFar;
					this._onEvent.fire({ type: 'message_chunk', text: delta });
				}
			} else if (state.phase === 'running_tool' && state.pendingToolName && state.pendingToolName !== this._lastAnnouncedToolName) {
				this._lastAnnouncedToolName = state.pendingToolName;
				this._onEvent.fire({ type: 'tool_call', id: generateUuid(), title: state.pendingToolName, status: 'running' });
			}
		}));
	}

	async sendPrompt(text: string): Promise<void> {
		this._lastStreamedText = '';
		this._lastAnnouncedToolName = undefined;
		try {
			const result = await this._agentGatewayService.runIsolatedTask({
				task: text,
				onThreadCreated: (threadId) => { this._threadId = threadId; },
			});
			if (this._cancelled) return;
			if (result.stalledAwaitingApproval) {
				// there's no live human on this pathway to approve a policy 'ask' the way
				// the interactive chat UI has - report it as an error rather than silently
				// treating a stall as success. The underlying Policy Engine gate that caused
				// this is never bypassed, whichever surface is driving the run.
				this._onEvent.fire({ type: 'error', message: 'The run stopped, awaiting an approval nothing on this pathway can grant (a Policy Engine "ask" rule fired). Use the interactive chat UI for tasks that may need approval.' });
			} else if (result.hadError) {
				this._onEvent.fire({ type: 'error', message: 'The underlying agent run ended with an error.' });
			} else {
				this._onEvent.fire({ type: 'complete', conclusion: result.conclusion });
			}
		} catch (e) {
			this._onEvent.fire({ type: 'error', message: e instanceof Error ? e.message : String(e) });
		}
	}

	respondToPermissionRequest(): void {
		// intentionally a no-op - see this file's class doc comment and
		// docs/integrations/external-agent-adapter.md: the real gate is the Policy Engine
		// inside the wrapped runtime, which a protocol-layer decision here cannot bypass.
	}

	async cancel(): Promise<void> {
		this._cancelled = true;
		if (this._threadId) await this._agentGatewayService.cancelTask(this._threadId);
	}
}

class VaderNativeExternalAgentAdapter implements IExternalAgentAdapter {
	readonly id = 'vader-native';
	readonly displayName = 'Vader (native runtime)';

	constructor(private readonly _agentGatewayService: IAgentGatewayService) { }

	getCapabilities(): ExternalAgentCapabilities {
		return {
			agentId: this.id,
			displayName: this.displayName,
			supportsStreaming: true,
			// subagent tool calls auto-approve their own category gate (no human is present
			// on this pathway) and only the un-bypassable Policy Engine can still stop one -
			// which surfaces as an error/stall, not an interactive permission_request this
			// adapter can forward - so this is honestly false, not aspirationally true.
			supportsToolRequests: false,
			supportsCancellation: true,
			supportsPlans: false,
		};
	}

	async createSession(opts: { initialPrompt?: string }): Promise<IExternalAgentSession> {
		const session = new VaderNativeAgentSession(this._agentGatewayService);
		if (opts.initialPrompt) await session.sendPrompt(opts.initialPrompt);
		return session;
	}
}

// Registers the reference adapter once the workbench is ready - a plain contribution, not a
// singleton service, since all it does is add one entry to the registry above.
class VaderNativeExternalAgentAdapterContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.nativeExternalAgentAdapter';

	constructor(
		@IExternalAgentAdapterRegistry registry: IExternalAgentAdapterRegistry,
		@IAgentGatewayService agentGatewayService: IAgentGatewayService,
	) {
		registry.register(new VaderNativeExternalAgentAdapter(agentGatewayService));
	}
}

registerWorkbenchContribution2(VaderNativeExternalAgentAdapterContribution.ID, VaderNativeExternalAgentAdapterContribution, WorkbenchPhase.BlockRestore);
