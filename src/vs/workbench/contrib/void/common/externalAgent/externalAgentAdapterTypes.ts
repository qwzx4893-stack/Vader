/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';

// An ACP-inspired (Zed's Agent Client Protocol) boundary: capabilities, session creation,
// streamed events, permission requests, cancellation, completion, errors. Kept as its OWN
// contract - not a re-export of IAgentGatewayService/AgentExecutionState - because the two
// have genuinely different semantics where it matters: the Gateway is Vader's own internal
// seam (thread ids, Void-loop-shaped execution state) meant for callers inside this
// codebase; this is an external-protocol-shaped boundary meant to be implementable by
// something that has never heard of chatThreadService.ts at all - a real third-party
// ACP-speaking agent process, if one were wired up. See
// docs/integrations/external-agent-adapter.md for why nothing external is actually wired up
// in this pass (there's no concrete third-party ACP agent binary in this environment to
// shell out to), and why the reference adapter that does exist is not a stub.
export type ExternalAgentCapabilities = {
	readonly agentId: string;
	readonly displayName: string;
	readonly supportsStreaming: boolean;
	readonly supportsToolRequests: boolean;
	readonly supportsCancellation: boolean;
	readonly supportsPlans: boolean;
};

export type ExternalAgentEvent =
	| { type: 'message_chunk'; text: string }
	| { type: 'reasoning_chunk'; text: string }
	| { type: 'tool_call'; id: string; title: string; status: 'pending' | 'running' | 'completed' | 'failed' }
	| { type: 'plan_update'; steps: string[] }
	/** the adapter's own permission-request surface - distinct from, and never a substitute for, Vader's Policy Engine, which gates the underlying execution regardless of how (or whether) this is answered */
	| { type: 'permission_request'; id: string; description: string }
	| { type: 'error'; message: string }
	| { type: 'complete'; conclusion: string };

export interface IExternalAgentSession extends IDisposable {
	readonly sessionId: string;
	readonly onEvent: Event<ExternalAgentEvent>;
	sendPrompt(text: string): Promise<void>;
	respondToPermissionRequest(id: string, granted: boolean): void;
	cancel(): Promise<void>;
}

export interface IExternalAgentAdapter {
	readonly id: string;
	readonly displayName: string;
	getCapabilities(): ExternalAgentCapabilities;
	createSession(opts: { initialPrompt?: string }): Promise<IExternalAgentSession>;
}

export interface IExternalAgentAdapterRegistry {
	readonly _serviceBrand: undefined;
	register(adapter: IExternalAgentAdapter): IDisposable;
	list(): IExternalAgentAdapter[];
	get(id: string): IExternalAgentAdapter | undefined;
}

export const IExternalAgentAdapterRegistry = createDecorator<IExternalAgentAdapterRegistry>('vaderExternalAgentAdapterRegistry');
