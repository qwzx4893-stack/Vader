# Deterministic production-simulation testing

**File:** `src/vs/workbench/contrib/void/test/simulatedProviderServer.mjs`. **Status: built and verified against Vader's real, unmodified provider transport.**

## Why this exists

`docs/integrations/providers/e2e-testing.md` documents the OpenRouter E2E harness and the network-policy block that prevents it from running live in this sandbox. That block is a fact about this environment's network policy, not about Vader - and it must not stop validation of Vader itself. This file documents the alternative: a **deterministic local HTTP server** that speaks the exact wire protocol Vader's real OpenAI-compatible provider transport (`electron-main/llmMessage/sendLLMMessage.impl.js`'s `newOpenAICompatibleSDK`/`_sendOpenAICompatibleChat`, via the official `openai` npm SDK) already speaks, so that transport - streaming parsing, tool-call extraction, error handling - is exercised for real, with zero external network access.

**This is a simulation, not a model.** It never generates text; it replays an exact, scripted queue of responses and faults. It proves Vader's *architecture* is correct (the thing genuinely at risk and novel this session); it proves nothing about any real model's actual output quality or a real provider's production uptime. Every result derived from it is labeled **PRODUCTION-SIMULATION**, never **REAL-MODEL**, in this project's test reporting.

## What's real vs. simulated

**Real, exercised as-is, never mocked:**
- Vader's own provider transport - the exact `newOpenAICompatibleSDK`/`_sendOpenAICompatibleChat` code, imported from the compiled `out/` output, the same file real users' real OpenRouter/OpenAI/etc. traffic goes through.
- The underlying `openai` npm SDK's own request/response/streaming/retry logic (confirmed by reading its source: `shouldRetry()` retries 408/409/429/5xx up to `maxRetries` (default 2) with its own backoff; `@anthropic-ai/sdk` and `@google/genai` have equivalent built-in retry logic - all three SDKs already provide real, bounded retry-with-backoff for transient failures with zero code from Vader beyond configuring the client, a fact this session verified rather than assumed).
- `@cline/agents`' real `AgentRuntime`.
- A harness-local bridge mirroring `vaderAgentModel.ts`'s actual event-translation logic, and a harness-local Policy gate mirroring `_evaluateToolCallGate`/`_runToolCallInline`'s actual shape (same limitation as the OpenRouter harness: the full `IChatThreadService`/Electron DI graph can't be constructed outside a running workbench - see `e2e-testing.md`).
- Real tool execution against a disposable fixture project on disk (real fs/process operations).

**Simulated:** only the external model service itself - what text/tool-calls/errors it returns, and when.

## Retry policy finding (a real, previously-unverified fact)

Testing against the simulator's `rate_limit`/`http_error` scenarios surfaced that **Vader's OpenAI-compatible provider path already has working, bounded retry-with-backoff** via the `openai` SDK's own defaults - not something Vader implements itself. This matters: it means the "no retry logic" gap this codebase's own history once worried about (the legacy loop's `CHAT_RETRIES`/`RETRY_DELAY`, removed along with the rest of the legacy runtime) was **already superseded** for the OpenAI-compatible path by the SDK's own retry behavior, and adding a second, Vader-level retry loop on top would risk multiplying attempts (SDK retries 3x, a naive Vader-level wrapper retries the whole 3x again) rather than adding safety. Vader deliberately does not add one - see `common/providerErrorTypes.ts`'s header comment for the full reasoning.

## Error taxonomy

`common/providerErrorTypes.ts`'s `classifyProviderError(message, fullError)` normalizes any provider failure into one of 13 categories (`AUTHENTICATION`, `RATE_LIMIT`, `MODEL_NOT_FOUND`, `CONTEXT_LIMIT`, `PROVIDER_UNAVAILABLE`, `NETWORK`, `INVALID_REQUEST`, `TOOL_UNSUPPORTED`, `VISION_UNSUPPORTED`, `CANCELLED`, `TIMEOUT`, `MALFORMED_RESPONSE`, `UNKNOWN`), checking a real HTTP status code first (the most reliable signal, present on every SDK error Vader's providers throw) and falling back to message-pattern matching only for failure modes that don't carry one (network resets, aborts, malformed bodies). Wired into `vaderAgentModel.ts`'s `onError` handler: the category now prefixes the error message surfaced to the thread (so a rate limit and an auth failure are visibly distinguishable, not just "an error occurred"), and maps onto `@cline/shared`'s own narrower `errorClass`/`errorRetryable` protocol fields, which `AgentRuntime`'s internal bookkeeping reads.

## Verified scenarios (this session, against the real transport)

- Plain text response (streaming, word-by-word chunks) - full text correctly reassembled.
- Multiple native tool calls in one response - both extracted correctly with distinct ids/names/params (requires `overridesOfModel` to set `specialToolFormat: 'openai-style'` for the simulator's unrecognized model name, the same override any real user of a custom/local OpenAI-compatible endpoint already needs in Settings for a model Vader doesn't recognize by name).
- 429 rate-limit and 401 auth failures - correctly distinguished, with the SDK's own automatic retry behavior on 429 observed directly (an initial test's confusing results, traced back to the SDK consuming a second queued scenario as its own retry attempt, was the first concrete evidence of the retry-policy finding above).

See `productionSimE2E.mjs` for the full scenario suite (Policy ALLOW/ASK/DENY, multi-tool ordering, cancellation, fault injection, multi-turn state).
