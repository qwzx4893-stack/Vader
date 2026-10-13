/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import type { AgentModel, AgentModelEvent, AgentModelRequest } from '@cline/shared';
import type { ProviderErrorClass } from '@cline/shared';
import { ILLMMessageService } from '../../common/sendLLMMessageService.js';
import { IConvertToLLMMessageService } from '../convertToLLMMessageService.js';
import { ChatMessage } from '../../common/chatThreadServiceTypes.js';
import { ChatMode, ModelSelection, ModelSelectionOptions, OverridesOfModel } from '../../common/vaderSettingsTypes.js';
import { classifyProviderError, userFacingProviderError } from '../../common/providerErrorTypes.js';

/**
 * Vader addition, part of the Cline Main Agent Runtime integration (see
 * docs/integrations/agent-runtime.md). Implements `@cline/shared`'s `AgentModel` interface by
 * wrapping `ILLMMessageService.sendLLMMessage` - Vader's one existing provider entry point.
 * This is the whole reason Cline never needs `@cline/llms`'s own provider layer: every existing
 * provider (Anthropic/OpenAI/Gemini/Mistral/OpenRouter/Ollama/vLLM/LM Studio/any
 * OpenAI-compatible endpoint), and the Model Router's category resolution, keep working
 * completely unchanged.
 *
 * Deliberately does NOT build its provider request from `AgentModelRequest.messages` (the
 * `AgentRuntime`'s own internal transcript). Instead it reads Vader's own live,
 * already-authoritative `ChatMessage[]` thread history via `getThreadMessages()` on every
 * call and converts it with `IConvertToLLMMessageService.prepareLLMChatMessages` - the one,
 * real, provider-correct (native Anthropic tool_use/tool_result pairing etc.) conversion path
 * in this codebase. This is possible because tool calls made during a Cline-driven turn are
 * recorded onto
 * that same live thread as a side effect of `_runToolCallInline` (see clineRuntimeAdapter.ts) -
 * by the time `.stream()` is called again after a tool result, Vader's thread already reflects
 * it. `AgentRuntime`'s own internal `AgentMessage[]` transcript still exists (it needs it for
 * its own turn-loop bookkeeping - matching tool-call ids to results, deciding when to stop),
 * but never becomes a second, competing source of what's actually sent to the provider - "no
 * duplicate context injection" by construction, not by convention.
 *
 * Native tool-call detection stays owned by Vader's existing per-provider parsing inside
 * `sendLLMMessage` (including the XML fallback grammar for non-tool-calling models) - this
 * class only translates the resulting `RawToolCallObj[]` into Cline's `tool-call-delta`
 * events so `AgentRuntime.executeToolCalls()` picks them up and dispatches to the registered
 * `AgentTool`s (see clineToolAdapter.ts), which is where Vader's Policy Engine actually gates
 * them (via `_runToolCallInline`) - this class has no tool-execution responsibility at all.
 */
type HeldError = { heldError?: { event: AgentModelEvent, message: string } };

export class VaderAgentModel implements AgentModel {
	constructor(
		private readonly _llmMessageService: ILLMMessageService,
		private readonly _convertToLLMMessagesService: IConvertToLLMMessageService,
		private readonly _opts: {
			getThreadMessages: () => ChatMessage[];
			maybeCompactThread: () => Promise<void>;
			chatMode: ChatMode;
			agentId: string | null | undefined;
			modelSelection: ModelSelection | null;
			modelSelectionOptions: ModelSelectionOptions | undefined;
			overridesOfModel: OverridesOfModel | undefined;
			/** the settings as they are now (an override written during the run must reach the next request) */
			getOverridesOfModel?: () => OverridesOfModel | undefined;
			/** the server refused the first request; true means the model's tool format was changed and the request should be sent again (common/toolSupport.ts) */
			onNativeToolsRejected?: (errorMessage: string) => Promise<boolean>;
			loggingName: string;
		},
	) { }

	async *stream(request: AgentModelRequest): AsyncIterable<AgentModelEvent> {
		await this._opts.maybeCompactThread();

		// A model name Vader does not know is first offered native tool calling; if the server refuses the `tools` field, the request is sent again once, with the tools
		// described in the prompt (XML) instead. The first error is held back until we know whether a second try is possible.
		const first: HeldError = {};
		yield* this._streamOnce(request, first);
		if (!first.heldError) { return; }
		if (await this._opts.onNativeToolsRejected?.(first.heldError.message)) {
			yield* this._streamOnce(request, null);
		} else {
			yield first.heldError.event;
		}
	}

	private async *_streamOnce(request: AgentModelRequest, held: HeldError | null): AsyncIterable<AgentModelEvent> {

		const chatMessages = this._opts.getThreadMessages();
		const { messages, separateSystemMessage } = await this._convertToLLMMessagesService.prepareLLMChatMessages({
			chatMessages,
			chatMode: this._opts.chatMode,
			modelSelection: this._opts.modelSelection,
			agentId: this._opts.agentId,
		});

		const events: AgentModelEvent[] = [];
		let notifyNext: (() => void) | null = null;
		let done = false;
		const push = (e: AgentModelEvent) => { events.push(e); const n = notifyNext; notifyNext = null; n?.(); };
		const finish = () => { done = true; const n = notifyNext; notifyNext = null; n?.(); };

		let prevTextLen = 0;
		let prevReasoningLen = 0;
		let sawOutput = false; // a refusal of the tools comes before any output; an error after some output is not retried

		const cancelToken = this._llmMessageService.sendLLMMessage({
			messagesType: 'chatMessages',
			chatMode: this._opts.chatMode,
			messages,
			modelSelection: this._opts.modelSelection,
			modelSelectionOptions: this._opts.modelSelectionOptions,
			overridesOfModel: this._opts.getOverridesOfModel?.() ?? this._opts.overridesOfModel,
			logging: { loggingName: this._opts.loggingName },
			separateSystemMessage,
			onText: ({ fullText, fullReasoning }) => {
				if (fullText.length > prevTextLen) {
					push({ type: 'text-delta', text: fullText.slice(prevTextLen) });
					prevTextLen = fullText.length;
					sawOutput = true;
				}
				if (fullReasoning.length > prevReasoningLen) {
					push({ type: 'reasoning-delta', text: fullReasoning.slice(prevReasoningLen) });
					prevReasoningLen = fullReasoning.length;
					sawOutput = true;
				}
			},
			onFinalMessage: ({ toolCalls }) => {
				for (const toolCall of toolCalls ?? []) {
					// invalid argument text goes to the runtime as text, which is what makes it answer that call with an "invalid JSON arguments" error result
					push(toolCall.rawInputText !== undefined
						? { type: 'tool-call-delta', toolCallId: toolCall.id, toolName: toolCall.name, inputText: toolCall.rawInputText }
						: { type: 'tool-call-delta', toolCallId: toolCall.id, toolName: toolCall.name, input: toolCall.rawParams });
				}
				push({ type: 'finish', reason: (toolCalls && toolCalls.length > 0) ? 'tool-calls' : 'stop' });
				finish();
			},
			onError: ({ message, fullError }) => {
				// Vader addition, part of the production-readiness backend-hardening pass: a
				// normalized error category (see common/providerErrorTypes.ts) both prefixes the
				// message surfaced to the thread (so RATE_LIMIT/AUTHENTICATION/CONTEXT_LIMIT/etc.
				// are visibly distinguishable, not just one generic failure string) and maps onto
				// Cline's own narrower errorClass/errorRetryable protocol fields, which
				// AgentRuntime's own internal bookkeeping reads. This is informational, not a
				// second retry loop - every SDK Vader uses already retries 429/5xx/network
				// failures internally with its own bounded backoff (see providerErrorTypes.ts's
				// header comment for the verification), so Vader deliberately does not retry again
				// on top of that.
				const { category, retryable } = classifyProviderError(message, fullError)
				const errorClass: ProviderErrorClass = category === 'AUTHENTICATION' ? 'auth' : category === 'CONTEXT_LIMIT' ? 'context_window_exceeded' : 'unknown'
				const errorEvent: AgentModelEvent = { type: 'finish', reason: 'error', error: userFacingProviderError(category, message), errorClass, errorRetryable: retryable }
				if (held && this._opts.onNativeToolsRejected && !sawOutput) { held.heldError = { event: errorEvent, message }; finish(); return }
				push(errorEvent)
				finish();
			},
			onAbort: () => {
				push({ type: 'finish', reason: 'aborted' });
				finish();
			},
		});

		if (!cancelToken) {
			yield { type: 'finish', reason: 'error', error: 'Failed to start LLM request (no request id returned - check provider configuration).' };
			return;
		}

		// AgentRuntime's own cancellation (session.abort()/AgentRuntime.abort()) sets this
		// signal - wire it to Vader's own abort mechanism so cancelling a Cline-driven turn
		// actually stops the in-flight provider request, not just the runtime's bookkeeping.
		request.signal?.addEventListener('abort', () => {
			this._llmMessageService.abort(cancelToken);
		});

		while (true) {
			while (events.length > 0) {
				yield events.shift()!;
			}
			if (done) return;
			await new Promise<void>(resolve => { notifyNext = resolve; });
		}
	}
}
