// Vader addition, part of the Cline Main Agent Runtime integration (see
// docs/integrations/agent-runtime.md and src/typings/cline-shared.d.ts's doc comment for why
// this shim exists - @cline/agents@0.0.90's own dist/index.d.ts also uses an extensionless
// relative import (`from "./agent-runtime"`), on top of re-exporting types from the broken
// @cline/shared surface). Transcribed directly from the actual installed
// `node_modules/@cline/agents/dist/agent-runtime.d.ts` in this same session. Runtime behavior
// is unaffected - see `src/tsconfig.json`'s `paths` entry for `@cline/agents`.

import type {
	AgentMessage, AgentModel, AgentRunResult, AgentRuntimeConfig as BaseAgentRuntimeConfig,
	AgentRuntimeEvent, AgentRuntimeStateSnapshot, AgentTool,
} from '@cline/shared';

export type AgentRunInput = string | AgentMessage | readonly AgentMessage[];
export type AgentEventListener = (event: AgentRuntimeEvent) => void;

export interface AgentRuntimeConfigWithModel extends BaseAgentRuntimeConfig {
	model: AgentModel;
}
export interface AgentRuntimeConfigWithProvider extends Omit<BaseAgentRuntimeConfig, "model"> {
	providerId: string;
	modelId: string;
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	options?: Record<string, unknown>;
}
export type AgentRuntimeConfig = AgentRuntimeConfigWithModel | AgentRuntimeConfigWithProvider;

export declare class AgentRuntimeAbortError extends Error {
	readonly reason?: unknown;
	constructor(reason?: unknown);
}

export declare class AgentRuntime {
	constructor(config: AgentRuntimeConfig);
	run(input: AgentRunInput): Promise<AgentRunResult>;
	continue(input?: AgentRunInput): Promise<AgentRunResult>;
	notifyPendingUserMessage(): void;
	abort(reason?: unknown): void;
	subscribe(listener: AgentEventListener): () => void;
	restore(messages: readonly AgentMessage[]): void;
	snapshot(): AgentRuntimeStateSnapshot;
}

export declare function createAgentRuntime(config: AgentRuntimeConfig): AgentRuntime;
export declare const Agent: typeof AgentRuntime;
export type Agent = AgentRuntime;
export declare function createAgent(config: AgentRuntimeConfig): AgentRuntime;

// re-exported pass-throughs from @cline/shared, for code that imports these from '@cline/agents'
export { createTool } from '@cline/shared';
export type {
	AgentMessage, AgentMessagePart, AgentModel, AgentModelFinishReason, AgentModelRequest,
	AgentRunResult, AgentRuntimeEvent, AgentRuntimeHooks, AgentRuntimeStateSnapshot, AgentTool,
	AgentToolCallPart, AgentToolDefinition, AgentToolResult, AgentUsage, ToolApprovalResult, ToolPolicy,
} from '@cline/shared';
