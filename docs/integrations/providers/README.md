# Provider expansion (production-hardening pass)

**Contract:** `ProviderName` (derived from `common/modelCapabilities.ts`'s `defaultProviderSettings`) + `VaderStaticProviderInfo`/`VaderStaticModelInfo`. **Implementation:** per-provider blocks in `modelCapabilities.ts` (model catalog/capabilities), `vaderSettingsTypes.ts` (display name/help text/default settings shape), `electron-main/llmMessage/sendLLMMessage.impl.ts` (the actual network call).

## Why this wasn't a bigger architectural rewrite

Before adding new providers, this pass audited whether Vader's provider architecture actually needed the "Provider Registry / Protocol Adapter" restructuring the mission described. It didn't, for a concrete reason: **every provider that speaks an OpenAI-compatible wire format already goes through exactly one shared code path** - `newOpenAICompatibleSDK()` (client construction) → `_sendOpenAICompatibleChat()`/`_sendOpenAICompatibleFIM()` (the actual request), both in `sendLLMMessage.impl.ts`. Only Anthropic and Gemini have genuinely separate branches, because their wire formats are genuinely different (not because of duplicated code that should have been merged). Adding MiniMax, Alibaba (Qwen/DashScope), Moonshot (Kimi), and OpenCode Zen - all four OpenAI-compatible - required exactly **one new `else if` branch** in `newOpenAICompatibleSDK` (matching provider name → base URL) and four one-line entries in the `sendLLMMessageToProviderImplementation` map, each just `sendChat: (params) => _sendOpenAICompatibleChat(params)`. There was no duplicated networking code to normalize, because it was already normalized.

What *does* repeat per provider - a model-capability table (`VaderStaticModelInfo` per model: context window, cost, reasoning support, etc.), a display name, a help-text link, and a settings-shape declaration - is not duplication to eliminate; it's real, provider-specific data that has to live somewhere, and every existing provider (Anthropic, OpenAI, Mistral, Groq, ...) already carries exactly this same shape. Introducing a generic "Provider Registry" indirection layer on top of it would add a layer of indirection without removing any actual duplicated logic - a "premature abstraction" this project's own conventions explicitly warn against (see `AGENTS.md`).

The Settings UI required **zero new per-provider UI code**: `VaderProviderSettings` (`Settings.tsx`) already renders one generically from `nonlocalProviderNames`/`localProviderNames`, both derived automatically from `ProviderName`'s keys. A new provider key placed anywhere in `defaultProviderSettings` shows up in Settings automatically, with capability/connection info sourced the same way every existing provider's is.

## Region-aware endpoints

MiniMax, Alibaba, and Moonshot each have two real API regions (an international endpoint and a mainland-China endpoint) with **non-portable, region-issued API keys** - a key from one region's console will not authenticate against the other region's endpoint. Rather than build a region dropdown + endpoint-derivation function per provider, each gets a single `endpoint` custom setting (the same mechanism `ollama`/`vLLM`/`lmStudio`/`openAICompatible` already use for a user-editable base URL), pre-filled with the international default and documented in `subTextMdOfProviderName`'s help text with the exact China URL to paste in instead. This is the least-surprising, most consistent-with-existing-conventions way to handle two possible base URLs, and it doesn't require Vader to guess which region a given API key belongs to.

## New providers and their sourcing

Alibaba/Qwen, MiniMax, and Moonshot/Kimi's specific documentation domains (`alibabacloud.com`, `platform.minimax.io`, `platform.moonshot.ai`) were not directly fetchable from this session's sandbox (egress-proxy-blocked); OpenCode's own domain (`opencode.ai`) was likewise blocked. Every fact below was independently researched via web search (which retrieves/quotes the blocked pages' own content) and, where possible, corroborated with a directly-fetched secondary source (GitHub repos/issues, raw.githubusercontent.com). Each provider's own doc file states exactly which claims are corroborated vs. search-summary-only, and flags the specific numbers (mostly newest-model context windows and exact error-body shapes) that should be spot-checked against a live account before being trusted as billing-critical.

| Provider | `ProviderName` | Doc | Confidence |
|---|---|---|---|
| MiniMax | `minimax` | [minimax.md](./minimax.md) | High on auth/OpenAI-compat/tool-calling; medium on MiniMax-M3's exact context window (reported inconsistently across sources) |
| Alibaba Cloud (Qwen/DashScope) | `alibaba` | [alibaba.md](./alibaba.md) | High - DashScope's OpenAI-compat mode is well-documented and long-stable |
| Moonshot AI (Kimi) | `moonshot` | [moonshot.md](./moonshot.md) | Medium - the model catalog churns quickly (a legacy model line was reportedly retired mid-2026); core protocol facts are well-corroborated |
| OpenCode Zen | `openCodeZen` | [opencode-zen.md](./opencode-zen.md) | Medium - real, confirmed product, but explicitly beta with a stated-volatile model catalog; only its OpenAI-shaped subset is covered |

Existing providers (Anthropic, OpenAI, Gemini, OpenRouter, Mistral, Ollama, vLLM, LM Studio, generic OpenAI-compatible, DeepSeek, Groq, xAI, Google Vertex, Azure OpenAI, AWS Bedrock) were re-audited for correctness during this pass and found accurate against their existing implementation - no changes were needed beyond what's noted in `CHANGELOG.md`.

## What was deliberately not built

- **OpenCode Go**: confirmed real (a $10/mo subscription tier reusing the same OpenCode Zen gateway infrastructure under a different, subscription-gated base path, `opencode.ai/zen/go/v1/...`), but not implemented as a fifth, separate provider - it is the same protocol as OpenCode Zen through a different URL a subscribed user would type into the `endpoint` field of the `openCodeZen` provider. Building a dedicated "Go" provider entry would duplicate `openCodeZen`'s code for zero functional gain.
- **A universal Anthropic-shaped/Gemini-shaped path through OpenCode Zen**: per its own docs, Zen proxies Anthropic and Gemini models through those vendors' *native* wire formats (`/v1/messages`, `/v1/models/<id>`), not a flattened OpenAI shape. Vader's `openCodeZen` provider only reaches the OpenAI-shaped subset of Zen's catalog (the same subset most of Zen's own listed models - including Chinese-lab models - actually use). Reaching Zen's Anthropic/Gemini-native models would need per-family request shaping specific to this one gateway, a larger scope than this pass's budget covers; documented here as a stated, precise gap rather than silently mishandled.
- **A hand-built "Provider Registry" abstraction layer**: see above - the existing `newOpenAICompatibleSDK`/`sendLLMMessageToProviderImplementation` split already *is* the registry/adapter split the mission asked for; adding a second one on top would be pure indirection.

---

# Provider verification against independent sources (2026-10-05)

An earlier pass above said the pre-existing providers were "found accurate". A second, stricter pass compared **every hosted provider's endpoint, authentication, wiring and model facts** with two independent open-source projects, and found that statement was too generous: several things were stale or wrong. This section records what was checked, against what, what changed, and what could **not** be verified.

## Sources used (and why)

Provider documentation hosts (platform.openai.com, docs.anthropic.com, ai.google.dev, ...) are blocked from the build/test sandbox, so the references are the code and catalogs of widely used open-source projects that integrate every one of these APIs and are kept current by their communities:

| Source | Used for | Pinned at |
|---|---|---|
| [BerriAI/litellm](https://github.com/BerriAI/litellm) - `litellm/llms/*` (endpoints, auth, request shaping) and `model_prices_and_context_window_backup.json` (model ids, context windows, tool/vision/reasoning support, prices, deprecation dates) | Base URLs, auth headers, which models exist and what they support | commit `a99bccace`, 2026-10-05 |
| [sst/opencode](https://github.com/sst/opencode) - `packages/web/src/content/docs/zen.mdx` | OpenCode Zen endpoint and which of its models use which wire format; independent confirmation that the current model ids exist | HEAD of 2026-10-05 |
| Earlier research notes in this folder (`minimax.md`, `alibaba.md`, `moonshot.md`, `opencode-zen.md`) | China-region endpoints, per-vendor details | see each file |

Agreement between LiteLLM and OpenCode's independently maintained tables on the newest model ids (e.g. `gpt-6.1-sol`, `claude-fable-5-1`, `qwen3.8-max`) is the strongest evidence available here that those ids are real. It is **not** the same as calling each provider's API.

## Endpoint and wiring audit

| Provider | Vader talks to | Verdict |
|---|---|---|
| OpenAI | SDK default (`api.openai.com/v1`) | correct |
| Anthropic | SDK default (`api.anthropic.com`), `x-api-key` + `anthropic-version` | correct |
| Gemini | `@google/genai` SDK | correct |
| xAI | `https://api.x.ai/v1` | correct (LiteLLM: `api.x.ai` + `/v1`) |
| Groq | `https://api.groq.com/openai/v1` | correct |
| Mistral | `https://api.mistral.ai/v1` (+ Mistral SDK for FIM) | correct |
| DeepSeek | `https://api.deepseek.com/v1` | correct (LiteLLM uses `/beta` only for FIM/prefix completion) |
| OpenRouter | `https://openrouter.ai/api/v1` | correct |
| Moonshot | `https://api.moonshot.ai/v1` | correct |
| Alibaba (DashScope) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | correct (China endpoint listed in LiteLLM) |
| MiniMax | `https://api.minimax.io/v1` | correct; **China endpoint is disputed** - LiteLLM (today) says `api.minimaxi.com`, earlier research here found `api.minimax.cn` with `minimaxi.com` redirecting to it. Not changed; both are user-typed, and the discrepancy is recorded in `minimax.md` |
| OpenCode Zen | `https://opencode.ai/zen/v1` | correct host; only its `/chat/completions` models are reachable (unchanged, documented) |
| Google Vertex | `https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/endpoints/openapi` | correct URL. Default region was `us-west2`; changed to `us-central1` (LiteLLM's default; where Gemini models are served) |
| Azure OpenAI | `AzureOpenAI` SDK, `https://{resource}.openai.azure.com/` | URL correct. **Default `api-version` was `2024-05-01-preview`** (too old for the newest models); changed to `2025-04-01-preview`. Existing saved values are not touched |
| AWS Bedrock | was: a LiteLLM/gateway proxy only | **Wrong.** Bedrock serves OpenAI Chat Completions natively at `https://bedrock-runtime.{region}.amazonaws.com/openai/v1/chat/completions` with a Bedrock API key as a bearer token (LiteLLM's `bedrock/chat_completions/` route). Vader now defaults to that (gpt-oss, Grok and newer GPT models); the `Endpoint` field remains for proxy users, and the help text says which models need a gateway |

Hardening found on the way: a region / Azure resource name / GCP project from settings was pasted straight into a host name. They are now validated as plain labels first (`assertUrlLabel`), so a stray or tampered setting cannot send a request - and the API key with it - to another host.

## Model lists: three real problems fixed

1. **Stale defaults.** Anthropic offered `claude-opus-4-0`/`3.5` names, OpenAI no GPT-5/6, Gemini a retired `2.5-pro-exp-03-25`, xAI only Grok 2/3, Groq a retired Qwen QwQ, and `gpt-4.1-nano`/`o4-mini` are deprecated on 2026-10-23. Defaults are now generated from the catalog (`build/lib/vader/genProviderModelData.py` -> `common/providerModelData.ts`).
2. **Wrong numbers.** `o3` was recorded with a 1,047,576-token window (real: 200,000), so prompts were sized for a context it does not have.
3. **New models were treated as unknown.** Any model id the table did not list (every Claude 5, GPT-5.x/6.x, Gemini 3.x, Grok 4.x...) fell to the "unrecognised" default: 32k window and *XML-in-prompt tools instead of native tool calling*. Name-family fallbacks now map unlisted ids to the right family while the name sent to the API stays exactly what was chosen.
4. **Kimi, MiniMax and Qwen had no native tool calling configured** (every entry lacked `specialToolFormat`), so they silently used the slower, less reliable XML path although all three document OpenAI-style function calling. Fixed.
5. Claude models that only support adaptive thinking (Claude 5 family, Opus 4.8) are no longer offered the legacy `budget_tokens` slider, which they reject.

## Live model lists ("the models your key provides")

Once a key (or endpoint) is typed in, Vader asks that provider which models the key can use and shows exactly those, replacing the built-in defaults the key cannot use (models you added by hand stay). The settings page shows the result next to the key: *checking*, *key works - N models available*, *the provider rejected this key*, or *could not reach the provider - showing the built-in list meanwhile* (with Retry). Removing the key restores the defaults.

- Implementation: `electron-main/llmMessage/modelListing.ts` (the only place that makes these requests), IPC command `cloudModelList`, `RefreshModelService.refreshCloudModels`, `VaderSettingsService.setLiveModels / restoreDefaultModels`.
- Endpoints: OpenAI `GET /v1/models`; Anthropic `GET /v1/models` (`x-api-key`, `anthropic-version`); Gemini `GET /v1beta/models` (key in `x-goog-api-key`, never in the URL); Mistral, Groq, xAI, DeepSeek, OpenRouter, Moonshot, MiniMax, Alibaba, OpenCode Zen: OpenAI-shaped `GET .../models`. Azure, Vertex and Bedrock are deployment/account-scoped and keep manual model entry.
- Non-chat models (embeddings, speech, image, moderation, guard...) are filtered out; OpenRouter's several-hundred-model catalog is reduced to text-output + tool-calling models, newest first; at most 300 are kept.
- Safety: https only (plain http only to a loopback address), 15 s timeout, 8 MB cap, **redirects refused** (the key never follows a redirect), model ids restricted to a plain character set (they end up in menus and prompts), and the key is never included in a result or message - provider error bodies, which can echo it, are not passed on.
- Not done automatically at startup when the user turned automatic model refreshing off; typing a key always checks it.
- Tests: `test/cloudModelListE2E.mjs` (33 checks, each failure path; three mutations verified to fail it), `test/providerCatalogE2E.mjs` (41 checks: every default is recognised with the right tool format, family fallbacks, reviewed endpoint list), and the real-app scenarios in `test/e2e/scenarios/providers.mjs`.

## What could not be verified here

- No hosted provider could be called (egress blocked), so **no key was tested against a real provider**. The listing code is verified against each provider's documented response format by local servers, and the `/models` paths are the standard documented ones, but a quirk of a real provider's answer (an extra field, a different error code for a bad key) would only show with a real key. The failure modes are designed to degrade to the built-in list.
- Model facts come from the LiteLLM catalog; the catalog itself can lag a brand-new release by days. Unlisted models still work through the family fallbacks and the live list.
- Alibaba/Moonshot/MiniMax/OpenCode `/models` support is assumed from their OpenAI-compatible mode; if one of them has no such route the status line says so and the built-in list is kept.


---

# Vendor providers (29 added, table-driven)

The 29 vendors listed in [`PROVIDERS.md`](../../../PROVIDERS.md) are not individual adapters. `build/lib/vader/genVendorProviders.py` reads the models.dev catalog
(`providers/<id>/provider.toml` for the gateway `api` and key `env`, model TOMLs with `base_model` inheritance from `models/<lab>/<model>.toml`) and writes
`common/vendorProviderData.ts`; `ProviderName` is derived from `defaultSettingsOfProvider`, so settings, UI, capabilities, model listing and the SDK path all
pick a new vendor up from the table. To add one: add it to the generator's vendor list, regenerate, run `node src/vs/workbench/contrib/vader/test/vendorProvidersE2E.mjs`.

Seams (each one reads the same table): `modelCapabilities.ts` (`vendorDefaultSettings`/`vendorDefaultModels`, capabilities from catalog facts), `vaderSettingsTypes.ts`
(titles, key placeholders, endpoint field), `electron-main/llmMessage/sendLLMMessage.impl.ts` (vendor branch of `newOpenAICompatibleSDK`, `assertVendorEndpoint`),
`electron-main/llmMessage/modelListing.ts` (`${endpoint}/models`, bearer key), `common/providerSearch.ts` and `Settings.tsx` (search box).

Logos: `common/providerLogoData.ts` is generated by `build/lib/vader/genProviderLogos.py` (see the file for the sources and licences); `react/src/util/ProviderLogo.tsx` draws it.
Model lists: providers that can list the models of a key start with none (`defaultSettingsOfProvider`), the live list is the only source.

Confidence: the table is generated from a public catalog and each vendor's documentation; the hosts are not reachable from the build environment, so the gateway
URLs are **not** live-verified. The endpoint field in Settings is the escape hatch.
