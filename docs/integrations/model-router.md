# The Model Router

**Contract:** `IModelRouterService` in `common/modelRouter/modelRouterTypes.ts`. **Implementation:** `common/modelRouter/modelRouterService.ts`. **Settings UI:** `ModelRouterSection` in `void-settings-tsx/Settings.tsx`.

## Why this exists alongside Void's original per-feature settings

Void already lets the user pick a model per feature (`voidSettingsTypes.ts`'s `featureNames`: Chat, Ctrl+K, Autocomplete, Apply, SCM) - each with its own Settings dropdown and its own persisted `ModelSelection`. That's untouched. The Model Router adds routing for work that doesn't have (and, for now, doesn't need) its own dedicated Settings dropdown: subagent delegation, read-only research subagents, browser-automation turns, and context-compaction's own summarization call - see `RouterCategory` in `modelRouterTypes.ts`. Expanding `featureNames` itself to cover these was considered and rejected for this pass: it's a persisted-settings-shape change with a much wider blast radius (every Settings dropdown, onboarding, `ModelSelectionOfFeature`'s storage shape) for categories that, unlike Chat/Autocomplete, most users will never want to configure individually - AUTO mode existing at all is precisely what makes that unnecessary.

## AUTO vs MANUAL

- **MANUAL** (the default, preserving pre-existing behavior exactly): a category resolves to its explicit override (`setCategoryOverride`) if the user set one, else falls back to whatever model is set for the Chat feature. A fresh install with no router configuration behaves identically to before this existed.
- **AUTO**: resolves only from `listConfiguredModels()` - every model with `_didFillInProviderSettings` true and not hidden, i.e. actually usable right now. **A provider with no credentials entered is never selected, however capable its static model info claims it is** - this is the mission's explicit AUTO-mode requirement, enforced by construction (`_autoSelect` only ever ranks `listConfiguredModels()`'s output, never `providerNames`' full static list). Within that set, `scoreForCategory` in `modelRouterService.ts` ranks by what the category needs (tool-calling categories favor native tool support and larger context; summarization favors lower cost and prompt-caching support), preferring the existing Chat model unless another configured model scores meaningfully higher - so switching to AUTO doesn't cause surprising model churn for categories where the Chat model is already fine.

## The capability descriptor - real fields only

`ModelCapabilityDescriptor` (`modelRouterTypes.ts`) is built entirely from data this codebase already tracks - nothing per-model is invented for this feature:

| Field | Real source |
|---|---|
| `isConfigured` | `SettingsOfProvider[provider]._didFillInProviderSettings` + the model not being hidden |
| `isLocal` | `voidSettingsTypes.ts`'s `localProviderNames` (ollama/vLLM/lmStudio) |
| `supportsNativeToolCalling` / `supportsMultipleToolCallsPerTurn` | `getModelCapabilities(...).specialToolFormat` - undefined means the XML fallback grammar, which is genuinely still single-tool-per-turn (see `docs/integrations/agent-gateway.md`) |
| `supportsReasoning` | `getModelCapabilities(...).reasoningCapabilities` |
| `supportsFIM` | `getModelCapabilities(...).supportsFIM` |
| `supportsPromptCaching` | `getModelCapabilities(...).cost.cache_read !== undefined` |
| `contextWindow`, `cost*` | `getModelCapabilities(...)` directly |
| `supportsVision` | `modelCapabilities.ts`'s `modelSupportsVision(providerName, modelName)` - see the Vision section below |

**`supportsVision` is pattern-based, not table-driven, and that's stated plainly rather than hidden.** Unlike every other field above, `VoidStaticModelInfo` has no per-model vision flag to read from, so `modelSupportsVision` matches well-known model-name families instead (Claude 3+, GPT-4o/4.1/4.5/5\*/o1+, Gemini 1.5+, Pixtral, common local VL models). It's deliberately conservative - an unrecognized name returns `false` - so a model is never assumed vision-capable by default. If a new model doesn't match, this function is the one place to update, not something threaded through every call site.

## What's wired to use it today

- **Subagent delegation** (`chatThreadService.ts`'s `_currentModelSelectionProps`): a subagent thread with no agent-pinned model (i.e. `delegate_subagent_task` without `agent_name`, or an agent with no `modelSelection` override) resolves through `resolveModel('subagent')` instead of unconditionally inheriting the Main Agent's Chat model.
- **Context compaction** (`_maybeCompactThread`'s `_sendCompactionRequest`): resolves through `resolveModel('summarization')`, falling back to the thread's own model if the router has nothing configured.
- **`verification` is wired**: `chatThreadService.ts`'s `_currentModelSelectionProps` routes a verification thread (`isVerificationThread`) through `resolveModel('verification')` (checked before the generic `subagent` case, since a verification thread is also flagged as a subagent thread).
- **research/browser categories are wired**: two new builtin tools, `delegate_research_task` and `delegate_browser_task` (`common/toolsServiceTypes.ts`, `common/prompt/prompts.ts`, `browser/toolsService.ts`), give the Main Agent a delegation path distinct from generic `delegate_subagent_task` for each. `chatThreadService.ts`'s `_currentModelSelectionProps` checks a hidden thread's `routerCategoryOverride` field before falling back to the generic `'subagent'` case, so these threads resolve through `resolveModel('research')`/`resolveModel('browser')` respectively. `delegate_research_task`'s thread is additionally hard-forced into the same read-only enforcement as a verification thread (`isResearchThread` alongside `isVerificationThread` in both the prompt-level tool filter and `_runToolCall`'s execution-level gate) - a research delegation must never double as a way to sneak in edits under a different tool name. `delegate_browser_task` is not read-only-forced, since browser automation needs to actually navigate/click; its approval type is `'terminal'`, same tier as the browser tools it uses. Note on scope: this wires *model selection* for browser-automation turns; the actual image-to-model pipeline is the separate Vision capability described below, not something this wiring pass improvised partway.

## Vision: a real, isolated image pipeline

**Deliberately not woven into the main chat loop.** Doing this "properly" would mean adding image content-part types to `AnthropicLLMChatMessage`/`OpenAILLMChatMessage`/`GeminiLLMChatMessage` (`common/sendLLMMessageTypes.ts`) and to the persisted `ChatMessage` format itself - the same format `chatThreadServiceTypes.ts` explicitly warns is "a big deal" to change, used by every provider's streaming path and every piece of code that reads chat history. Given that risk, this pass instead built a narrow, additive, one-off capability that never touches that pipeline:

- `IModelRouterService.resolveVisionModel()` (`modelRouterTypes.ts`/`modelRouterService.ts`) picks the best *configured* model whose `supportsVision` is true, scored the same way the `'browser'` category is. Returns `null` - never a non-vision or unconfigured model - if nothing configured supports vision.
- `IVisionMainService` (`common/vision/visionQueryTypes.ts`, proxied by `common/vision/visionQueryService.ts`, implemented for real by `electron-main/visionMainService.ts`) is a plain one-shot `query(params): Promise<string>` - image bytes + a text prompt in, a text answer out. It follows the exact same electron-main-only-network-access pattern as `IDiscoveryMainService`.
- `sendVisionQuery` (`electron-main/llmMessage/sendLLMMessage.impl.ts`) does the actual provider call, reusing the same per-provider client construction the real chat paths use (`new Anthropic`, `new GoogleGenAI`, `newOpenAICompatibleSDK`) - native image content blocks for Anthropic and Gemini, OpenAI's `image_url` content part (which every OpenAI-compatible backend that supports vision, including a llava/qwen-vl model served by Ollama/vLLM/LM Studio, accepts) for everything else. It re-checks `modelSupportsVision` itself, independent of whatever already filtered the caller's model choice, since this function is the actual network boundary.
- The builtin tool `browser_screenshot_analyze` (`toolsServiceTypes.ts`/`prompts.ts`/`toolsService.ts`) is the one thing that calls all of the above: screenshot a page, resolve a vision model, get back a real text description the Main Agent can reason over - distinct from `browser_screenshot`, which only ever saved a PNG to disk. It's read-only (no approval-gate entry) and fails with a clear error - never a silent fallback to a non-vision model or an unauthorized provider - when nothing vision-capable is configured.

What this does *not* do: it does not let a user-provided or tool-produced image become part of the persisted, multi-turn chat transcript, and it does not add image support to Ctrl+K/Autocomplete/Apply. Those would need the `ChatMessage`/`LLMChatMessage` format change described above and are a separate, larger follow-up.

## Settings UI

`ModelRouterSection` (`void-settings-tsx/Settings.tsx`) offers an Auto/Manual toggle, a live read-out of which configured model each category currently resolves to, and (added in the Agent Manager UI pass - see `docs/integrations/agent-manager-ui.md`) a per-category override picker calling `setCategoryOverride` directly.
