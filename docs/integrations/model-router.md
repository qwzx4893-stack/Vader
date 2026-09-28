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

**Deliberately not included: vision/multimodal input.** This codebase's `VoidStaticModelInfo` (`common/modelCapabilities.ts`) does not track a per-model vision flag today, so a `supportsVision` field here would have to be guessed or hand-maintained separately from the data everything else in this descriptor is drawn from - worse than not having it. The mission's "vision" router category is deferred until that underlying capability data actually exists; adding a real field is a smaller, separate, well-scoped follow-up once it does, not something to fake now.

## What's wired to use it today

- **Subagent delegation** (`chatThreadService.ts`'s `_currentModelSelectionProps`): a subagent thread with no agent-pinned model (i.e. `delegate_subagent_task` without `agent_name`, or an agent with no `modelSelection` override) resolves through `resolveModel('subagent')` instead of unconditionally inheriting the Main Agent's Chat model.
- **Context compaction** (`_maybeCompactThread`'s `_sendCompactionRequest`): resolves through `resolveModel('summarization')`, falling back to the thread's own model if the router has nothing configured.
- **research/browser/verification categories** exist in the type and are resolvable today, but nothing calls `resolveModel('research'|'browser'|'verification')` yet - there's no dedicated research-subagent or verification-agent execution path in this codebase yet (the latter is `run_verification`, which doesn't call an LLM at all - it runs the project's own build/lint/test commands). Wiring these in is real, tracked follow-up for when those execution paths exist, not something this router pretends to already do.

## Settings UI

`ModelRouterSection` (`void-settings-tsx/Settings.tsx`) offers an Auto/Manual toggle, a live read-out of which configured model each category currently resolves to, and (added in the Agent Manager UI pass - see `docs/integrations/agent-manager-ui.md`) a per-category override picker calling `setCategoryOverride` directly.
