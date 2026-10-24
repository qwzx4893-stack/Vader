/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition, part of the final production-readiness pass's backend-hardening work
// (docs/integrations/providers/production-simulation.md). A normalized error taxonomy every
// provider's failure gets classified into, so the rest of Vader (VaderAgentModel, the chat UI,
// future retry/backoff decisions) can reason about "what kind of failure is this" without every
// call site re-deriving it from a raw SDK error shape. Deliberately provider-agnostic: works
// from the shape every SDK Vader uses (Anthropic/OpenAI/Gemini, all via the `openai`/
// `@anthropic-ai/sdk`/`@google/genai` packages) actually shares - an HTTP-status-bearing error
// object (`.status`), falling back to message-pattern matching for the cases (network failures,
// aborts, malformed bodies) that don't carry one.
//
// Retry note: Vader deliberately does NOT implement a second, Vader-level retry loop on top of
// this classification. Every SDK Vader uses (`openai`, `@anthropic-ai/sdk`, `@google/genai`)
// already retries 429/5xx/network failures internally with its own bounded backoff before ever
// calling Vader's onError - verified by reading each SDK's own retry logic
// (node_modules/openai/core.mjs's `shouldRetry` - 408/409/429/5xx retried, `maxRetries` default
// 2; `@anthropic-ai/sdk` shares the same generated-client retry logic; `@google/genai` has its
// own `MAX_RETRY_COUNT` loop). A second retry layer here would silently multiply retry attempts
// (SDK retries 3x, then a Vader-level retry retries the whole 3x again) rather than adding safety
// - so `errorRetryable` below is informational (surfaced to the user / to Cline's own
// `errorClass`/`errorRetryable` protocol fields), not something Vader acts on by retrying again.
export type ProviderErrorCategory =
	| 'AUTHENTICATION'
	| 'ACCESS_RESTRICTED'
	| 'PERMISSION_DENIED'
	| 'RATE_LIMIT'
	| 'MODEL_NOT_FOUND'
	| 'CONTEXT_LIMIT'
	| 'PROVIDER_UNAVAILABLE'
	| 'NETWORK'
	| 'INVALID_REQUEST'
	| 'TOOL_UNSUPPORTED'
	| 'VISION_UNSUPPORTED'
	| 'CANCELLED'
	| 'TIMEOUT'
	| 'MALFORMED_RESPONSE'
	| 'UNKNOWN';

export type ClassifiedProviderError = {
	category: ProviderErrorCategory;
	/** whether retrying the exact same request without changing anything about it could plausibly help - informational only, see the retry note above */
	retryable: boolean;
};

// A model can be forbidden despite valid credentials (e.g. OpenRouter's harness-only models).
const ACCESS_RESTRICTED_PATTERNS = /only available (?:on|to|through) (?:approved |supported )?agentic harnesses|model[^.\n]{0,100}restricted to[^.\n]{0,100}(?:harness|coding agent|application)/i;
// The agent runtime carries only the provider's message to the UI, losing the SDK status.
// Accept an HTTP/error prefix, never an arbitrary count such as "401 tokens".
const AUTH_STATUS_IN_MESSAGE = /(?:^|\b(?:error|http(?: status)?|status(?: code)?)\s*:?)\s*(401|403)\b/i;

/** Read known diagnostic fields without serializing headers, requests or credentials. */
function diagnosticFields(error: unknown, depth = 0): string[] {
	if (typeof error === 'string') return [error];
	if (typeof error !== 'object' || error === null || depth > 2) return [];
	const e = error as { message?: unknown; code?: unknown; error?: unknown; body?: unknown; cause?: unknown };
	return [e.message, e.code].filter((v): v is string => typeof v === 'string')
		.concat(...[e.error, e.body, e.cause].map(v => diagnosticFields(v, depth + 1)));
}

const NETWORK_PATTERNS = /fetch failed|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENOTFOUND|network|socket hang up/i;
const TIMEOUT_PATTERNS = /timed? ?out|ETIMEDOUT|deadline exceeded/i;
const ABORT_PATTERNS = /\babort(ed)?\b|cancell?ed/i;
const CONTEXT_LIMIT_PATTERNS = /context length|context window|maximum context|too many tokens|context_length_exceeded/i;
const MODEL_NOT_FOUND_PATTERNS = /model_not_found|model.*(not found|does not exist|unknown model)/i;
// V8's JSON.parse error wording has changed across Node versions ("Unexpected token X in JSON"
// vs. newer "Expected property name or '}' in JSON at position N") - matched broadly via "in
// JSON" plus the common exception name, rather than pinned to one exact historical phrasing.
const MALFORMED_PATTERNS = /unexpected token|invalid json|json parse|unexpected end of|in json at position|syntaxerror.*json|json.*syntaxerror/i;
const TOOL_UNSUPPORTED_PATTERNS = /does not support (function|tool) calling|tools? (is|are) not supported/i;
const VISION_UNSUPPORTED_PATTERNS = /does not support (image|vision)|vision.*not supported|image.*not supported/i;

/**
 * Classifies a provider failure from whatever Vader's existing OnError callback already carries
 * (`{message, fullError}` - see common/sendLLMMessageTypes.ts). Checked in a deliberate order:
 * an explicit cancellation always wins (never miscategorized as some other failure just because
 * the aborted request's error message happens to also mention e.g. a timeout), then a real HTTP
 * status code (the most reliable signal, when present), then message-pattern fallbacks for the
 * failure modes that don't carry one.
 */
export function classifyProviderError(message: string, fullError: unknown, opts?: { wasCancelled?: boolean }): ClassifiedProviderError {
	if (opts?.wasCancelled || ABORT_PATTERNS.test(message)) {
		return { category: 'CANCELLED', retryable: false };
	}

	const diagnosticText = [message, ...diagnosticFields(fullError)].join(' ');
	const status: number | undefined = typeof fullError === 'object' && fullError !== null && 'status' in fullError && typeof (fullError as { status: unknown }).status === 'number'
		? (fullError as { status: number }).status
		: Number(AUTH_STATUS_IN_MESSAGE.exec(diagnosticText)?.[1]) || undefined;

	if (status !== undefined) {
		if (status === 401) return { category: 'AUTHENTICATION', retryable: false };
		if (status === 403) return { category: ACCESS_RESTRICTED_PATTERNS.test(diagnosticText) ? 'ACCESS_RESTRICTED' : 'PERMISSION_DENIED', retryable: false };
		if (status === 404) return { category: 'MODEL_NOT_FOUND', retryable: false };
		if (status === 429) return { category: 'RATE_LIMIT', retryable: true };
		if (status === 400) {
			if (CONTEXT_LIMIT_PATTERNS.test(message)) return { category: 'CONTEXT_LIMIT', retryable: false };
			if (TOOL_UNSUPPORTED_PATTERNS.test(message)) return { category: 'TOOL_UNSUPPORTED', retryable: false };
			if (VISION_UNSUPPORTED_PATTERNS.test(message)) return { category: 'VISION_UNSUPPORTED', retryable: false };
			return { category: 'INVALID_REQUEST', retryable: false };
		}
		if (status === 408) return { category: 'TIMEOUT', retryable: true };
		if (status >= 500) return { category: 'PROVIDER_UNAVAILABLE', retryable: true };
	}

	// Preserve restrictions in message-only runtime failures too.
	if (status === undefined && ACCESS_RESTRICTED_PATTERNS.test(diagnosticText)) return { category: 'ACCESS_RESTRICTED', retryable: false };

	if (CONTEXT_LIMIT_PATTERNS.test(diagnosticText)) return { category: 'CONTEXT_LIMIT', retryable: false };
	if (MODEL_NOT_FOUND_PATTERNS.test(diagnosticText)) return { category: 'MODEL_NOT_FOUND', retryable: false };
	if (TOOL_UNSUPPORTED_PATTERNS.test(diagnosticText)) return { category: 'TOOL_UNSUPPORTED', retryable: false };
	if (VISION_UNSUPPORTED_PATTERNS.test(diagnosticText)) return { category: 'VISION_UNSUPPORTED', retryable: false };
	if (MALFORMED_PATTERNS.test(diagnosticText)) return { category: 'MALFORMED_RESPONSE', retryable: true };
	if (TIMEOUT_PATTERNS.test(diagnosticText)) return { category: 'TIMEOUT', retryable: true };
	if (NETWORK_PATTERNS.test(diagnosticText)) return { category: 'NETWORK', retryable: true };

	return { category: 'UNKNOWN', retryable: false };
}


/** What the user reads: one plain sentence that says what to do, then the provider's own words. (The bare category tag used to be shown, e.g. "[UNKNOWN] ...".) */
export function userFacingProviderError(category: ProviderErrorCategory, message: string): string {
	const lead: Partial<Record<ProviderErrorCategory, string>> = {
		AUTHENTICATION: 'The provider rejected your API key. Check the key in Settings > Main Providers (or Local Providers).',
		ACCESS_RESTRICTED: 'The provider restricts access to this model. Choose another model, or check the provider’s access requirements. Changing your API key may not help.',
		PERMISSION_DENIED: 'The provider denied access to this request. Check your account and model permissions, or choose another model.',
		RATE_LIMIT: 'The provider is limiting how many requests you can send. Wait a moment and send the message again.',
		CONTEXT_LIMIT: 'This conversation is longer than the model can take. Start a new chat, or pick a model with a larger context window.',
		MODEL_NOT_FOUND: 'The provider has no model with this name. Pick another model in Settings > Models.',
		NETWORK: 'Vader could not reach the provider. Check your internet connection and the base URL of the provider in Settings.',
		TIMEOUT: 'The provider did not answer in time. Send the message again.',
		PROVIDER_UNAVAILABLE: 'The provider is having problems right now (server error). Try again in a little while.',
		INVALID_REQUEST: 'The provider refused the request as invalid. Its explanation is below.',
		TOOL_UNSUPPORTED: 'This model does not support tool use, so Agent mode cannot work with it. Switch to Chat mode or pick another model.',
		VISION_UNSUPPORTED: 'This model cannot read images. Remove the image or pick a model with vision.',
		MALFORMED_RESPONSE: 'The provider sent an answer Vader could not read. Send the message again; if it keeps happening, try another model.',
	};
	const l = lead[category];
	return l ? `${l}\n\nDetails: ${message}` : message;
}
