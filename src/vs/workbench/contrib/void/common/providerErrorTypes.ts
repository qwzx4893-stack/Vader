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

	const status: number | undefined = typeof fullError === 'object' && fullError !== null && 'status' in fullError && typeof (fullError as { status: unknown }).status === 'number'
		? (fullError as { status: number }).status
		: undefined;

	if (status !== undefined) {
		if (status === 401 || status === 403) return { category: 'AUTHENTICATION', retryable: false };
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

	// A network-level failure (e.g. a torn-down TCP connection, DNS failure) often doesn't carry
	// its real signal in the top-level `message` string at all - the SDKs Vader uses (`openai`'s
	// APIConnectionError being the concrete case found in this session's fault-injection testing)
	// nest the actual OS-level error (`ECONNRESET`, "socket hang up", etc.) under `fullError.cause`.
	// Build one combined diagnostic string from every place useful text could be, rather than
	// only the top-level message, so classification doesn't silently miss it.
	const causeText = typeof fullError === 'object' && fullError !== null
		? [(fullError as { cause?: { message?: string; code?: string } }).cause?.message, (fullError as { cause?: { code?: string } }).cause?.code, (fullError as { code?: string }).code]
			.filter((x): x is string => typeof x === 'string').join(' ')
		: '';
	const diagnosticText = `${message} ${causeText}`;

	if (CONTEXT_LIMIT_PATTERNS.test(diagnosticText)) return { category: 'CONTEXT_LIMIT', retryable: false };
	if (MODEL_NOT_FOUND_PATTERNS.test(diagnosticText)) return { category: 'MODEL_NOT_FOUND', retryable: false };
	if (TOOL_UNSUPPORTED_PATTERNS.test(diagnosticText)) return { category: 'TOOL_UNSUPPORTED', retryable: false };
	if (VISION_UNSUPPORTED_PATTERNS.test(diagnosticText)) return { category: 'VISION_UNSUPPORTED', retryable: false };
	if (MALFORMED_PATTERNS.test(diagnosticText)) return { category: 'MALFORMED_RESPONSE', retryable: true };
	if (TIMEOUT_PATTERNS.test(diagnosticText)) return { category: 'TIMEOUT', retryable: true };
	if (NETWORK_PATTERNS.test(diagnosticText)) return { category: 'NETWORK', retryable: true };

	return { category: 'UNKNOWN', retryable: false };
}
