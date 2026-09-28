// Vader addition, part of the Cline Main Agent Runtime integration (see
// docs/integrations/agent-runtime.md). @cline/shared@0.0.86's own shipped .d.ts files use
// extensionless relative import specifiers (e.g. `from "./agent"` instead of
// `from "./agent.js"`), which is invalid under this project's `moduleResolution: "nodenext"`
// (verified directly: `node_modules/@cline/shared/dist/index.d.ts`'s own
// `export * from "./agent"` line fails with TS2834 under nodenext resolution). This is a
// real defect in that specific, pre-1.0 package version, not a project misconfiguration -
// `moduleResolution` is this whole codebase's long-standing convention and changing it
// project-wide to work around one dependency would be a far riskier fix than this file.
//
// This is NOT a guess at the API: every type below is transcribed directly from the actual
// installed `node_modules/@cline/shared/dist/agent.d.ts` and `dist/llms/tools.d.ts` (re-read
// fresh in this same session, after the dependency was actually installed - not from an
// earlier, unverified probe). Runtime behavior is completely unaffected by this file - Node's
// real ESM loader resolves the package's actual (bundled, extension-clean) compiled
// `dist/index.js` just fine; this only replaces what TypeScript sees while type-checking (see
// `src/tsconfig.json`'s `paths` entry for `@cline/shared`, which redirects here). Keep this in
// sync with `node_modules/@cline/shared/dist/agent.d.ts` if the pinned version ever changes.

export interface AgentTextPart {
	type: "text";
	text: string;
}
export interface AgentReasoningPart {
	type: "reasoning";
	text: string;
	redacted?: boolean;
	metadata?: unknown;
}
export interface AgentToolCallPart {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	input: unknown;
	metadata?: unknown;
}
export interface AgentToolResultPart {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	output: unknown;
	isError?: boolean;
}
export type AgentMessagePart = AgentTextPart | AgentReasoningPart | AgentToolCallPart | AgentToolResultPart | { type: string;[k: string]: unknown };
export type AgentMessageRole = "user" | "assistant" | "tool";
export interface AgentTokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningTokenCount?: number;
}
export interface AgentUsage extends AgentTokenUsage {
	totalCost?: number;
}
export interface AgentMessage {
	id: string;
	role: AgentMessageRole;
	content: AgentMessagePart[];
	createdAt: number;
	metadata?: Record<string, unknown>;
	modelInfo?: { id: string; provider: string; family?: string };
	metrics?: AgentTokenUsage & { cost?: number };
}
export type AgentRole = string;
export type AgentRunStatus = "idle" | "running" | "completed" | "aborted" | "failed";
export interface AgentRuntimeStateSnapshot {
	agentId: string;
	agentRole?: AgentRole;
	parentAgentId?: string | null;
	conversationId?: string;
	runId?: string;
	status: AgentRunStatus;
	iteration: number;
	messages: readonly AgentMessage[];
	pendingToolCalls: readonly string[];
	usage: AgentUsage;
	lastError?: string;
	lastErrorClass?: ProviderErrorClass;
}
export interface AgentToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	lifecycle?: { completesRun?: boolean };
}
export interface AgentToolResult<TOutput = unknown> {
	output: TOutput;
	isError?: boolean;
	metadata?: Record<string, unknown>;
}
export interface AgentToolContext {
	sessionId?: string;
	agentId: string;
	conversationId?: string;
	runId?: string;
	iteration: number;
	toolCallId?: string;
	signal?: AbortSignal;
	metadata?: Record<string, unknown>;
	snapshot?: AgentRuntimeStateSnapshot;
	emitUpdate?: (update: unknown) => void;
}
export interface AgentTool<TInput = unknown, TOutput = unknown> extends AgentToolDefinition {
	executionMode?: "sequential" | "parallel";
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
	execute: (input: TInput, context: AgentToolContext) => Promise<TOutput> | TOutput;
}
export interface AgentModelRequest {
	systemPrompt?: string;
	messages: readonly AgentMessage[];
	tools: readonly AgentToolDefinition[];
	signal?: AbortSignal;
	options?: Record<string, unknown>;
}
export type AgentModelFinishReason = "stop" | "tool-calls" | "max-tokens" | "aborted" | "error";
export type ProviderErrorClass = "context_window_exceeded" | "auth" | "unknown";
export type AgentModelEvent =
	| { type: "text-delta"; text: string }
	| { type: "reasoning-delta"; text: string; redacted?: boolean; metadata?: unknown }
	| { type: "tool-call-delta"; index?: number; toolCallId?: string; toolName?: string; inputText?: string; input?: unknown; metadata?: unknown }
	| { type: "usage"; usage: Partial<AgentUsage> }
	| { type: "finish"; reason: AgentModelFinishReason; requestId?: string; error?: string; errorClass?: ProviderErrorClass; errorRetryable?: boolean; errorReported?: boolean };
export interface AgentModel {
	stream: (request: AgentModelRequest) => AsyncIterable<AgentModelEvent> | Promise<AsyncIterable<AgentModelEvent>>;
}
export interface AgentRunResult {
	agentId: string;
	agentRole?: AgentRole;
	runId: string;
	status: Exclude<AgentRunStatus, "idle" | "running">;
	iterations: number;
	outputText: string;
	messages: readonly AgentMessage[];
	usage: AgentUsage;
	error?: Error;
}
export type AgentRuntimeEvent =
	| { type: "run-started"; snapshot: AgentRuntimeStateSnapshot }
	| { type: "message-added"; snapshot: AgentRuntimeStateSnapshot; message: AgentMessage }
	| { type: "turn-started"; snapshot: AgentRuntimeStateSnapshot; iteration: number }
	| { type: "assistant-text-delta"; snapshot: AgentRuntimeStateSnapshot; iteration: number; text: string; accumulatedText: string }
	| { type: "assistant-reasoning-delta"; snapshot: AgentRuntimeStateSnapshot; iteration: number; text: string; accumulatedText: string; redacted?: boolean; metadata?: unknown }
	| { type: "assistant-message"; snapshot: AgentRuntimeStateSnapshot; iteration: number; message: AgentMessage; finishReason: AgentModelFinishReason }
	| { type: "tool-started"; snapshot: AgentRuntimeStateSnapshot; iteration: number; toolCall: AgentToolCallPart }
	| { type: "tool-updated"; snapshot: AgentRuntimeStateSnapshot; iteration: number; toolCall: AgentToolCallPart; update: unknown }
	| { type: "tool-finished"; snapshot: AgentRuntimeStateSnapshot; iteration: number; toolCall: AgentToolCallPart; message: AgentMessage }
	| { type: "usage-updated"; snapshot: AgentRuntimeStateSnapshot; usage: AgentUsage }
	| { type: "turn-finished"; snapshot: AgentRuntimeStateSnapshot; iteration: number; toolCallCount: number }
	| { type: "status-notice"; snapshot: AgentRuntimeStateSnapshot; message: string; metadata?: Record<string, unknown> }
	| { type: "run-finished"; snapshot: AgentRuntimeStateSnapshot; result: AgentRunResult }
	| { type: "run-failed"; snapshot: AgentRuntimeStateSnapshot; error: Error; errorClass?: ProviderErrorClass };
export interface AgentRuntimeHooks {
	beforeRun?: (context: { snapshot: AgentRuntimeStateSnapshot }) => unknown;
	afterRun?: (context: { snapshot: AgentRuntimeStateSnapshot; result: AgentRunResult }) => void | Promise<void>;
	beforeModel?: (context: { snapshot: AgentRuntimeStateSnapshot; request: AgentModelRequest }) => unknown;
	afterModel?: (context: { snapshot: AgentRuntimeStateSnapshot; assistantMessage: AgentMessage; finishReason: AgentModelFinishReason; requestId?: string }) => unknown;
	beforeTool?: (context: { snapshot: AgentRuntimeStateSnapshot; tool: AgentTool; toolCall: AgentToolCallPart; input: unknown }) => unknown;
	afterTool?: (context: { snapshot: AgentRuntimeStateSnapshot; tool: AgentTool; toolCall: AgentToolCallPart; input: unknown; result: AgentToolResult; startedAt: Date; endedAt: Date; durationMs: number }) => unknown;
	onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>;
}
export interface AgentRuntimeConfig {
	distinctId?: string;
	clientName?: string;
	clientVersion?: string;
	clineCoreVersion?: string;
	sessionId?: string;
	agentId?: string;
	conversationId?: string;
	parentAgentId?: string | null;
	agentRole?: AgentRole;
	systemPrompt?: string;
	messageModelInfo?: AgentMessage["modelInfo"];
	model: AgentModel;
	modelOptions?: Record<string, unknown>;
	tools?: readonly AgentTool<any, any>[];
	hooks?: Partial<AgentRuntimeHooks>;
	logger?: unknown;
	telemetry?: unknown;
	initialMessages?: readonly AgentMessage[];
	maxIterations?: number;
	completionPolicy?: { requireCompletionTool?: boolean; completionGuard?: () => string | undefined };
	toolExecution?: "sequential" | "parallel";
	toolPolicies?: Record<string, ToolPolicy>;
	toolContextMetadata?: Record<string, unknown>;
	requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult> | ToolApprovalResult;
	consumePendingUserMessage?: () => string | undefined | Promise<string | undefined>;
}

// from llms/tools.d.ts
export interface ToolPolicy {
	enabled?: boolean;
	autoApprove?: boolean;
}
export interface ToolApprovalRequest {
	sessionId: string;
	agentId: string;
	conversationId: string;
	iteration: number;
	toolCallId: string;
	toolName: string;
	input: unknown;
	policy: ToolPolicy;
}
export interface ToolApprovalResult {
	approved: boolean;
	reason?: string;
}

// from tools/create.d.ts - only the plain-JSON-schema overload is used in this codebase
export declare function createTool<TInput, TOutput>(config: {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute: (input: TInput, context: AgentToolContext) => Promise<TOutput>;
	lifecycle?: AgentTool<TInput, TOutput>["lifecycle"];
	executionMode?: AgentTool["executionMode"];
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
}): AgentTool<TInput, TOutput>;
