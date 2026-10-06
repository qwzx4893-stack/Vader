# Model Providers

Vader's provider layer is the one inherited from Void (`src/vs/workbench/contrib/void/common/sendLLMMessageService.ts`, `electron-main/llmMessage/sendLLMMessage.impl.ts`). This document describes what's actually implemented, not an aspirational list.

## Supported providers: 49, all native in Settings

Every provider below appears in Settings and in the first-run setup as its own entry with its own key and endpoint field. Nothing needs OpenRouter
as a middleman (OpenRouter is simply one more entry). The list has a search box ("Search 49 providers"), so `qwen`, `kimi`, `together` or `nvidia` find
their entry at once.

### Original integrations (20)

| Provider | Integration | Notes |
|---|---|---|
| Anthropic | Native SDK | Native tool-calling, thinking/reasoning, prompt caching |
| Google Gemini | Native SDK | Native tool-calling |
| OpenAI | OpenAI SDK | |
| Grok (xAI) | OpenAI-compatible | |
| Mistral | OpenAI-compatible | |
| DeepSeek | OpenAI-compatible | |
| Groq | OpenAI-compatible | |
| OpenRouter | OpenAI-compatible | Identifies itself as "Vader" (`HTTP-Referer`/`X-Title` headers) |
| MiniMax, Alibaba Cloud (Qwen), Moonshot AI (Kimi) | OpenAI-compatible | International and mainland-China regions (region-issued keys), live model list |
| OpenCode Zen | OpenAI-compatible | OpenAI-shaped subset of the Zen gateway |
| LiteLLM, OpenAI-Compatible (generic) | OpenAI-compatible | Self-hosted gateways, any custom base URL |
| Microsoft Azure OpenAI, AWS Bedrock, Google Vertex AI | OpenAI-compatible | Through their OpenAI-compatible routes |
| **Ollama**, **LM Studio**, **vLLM** | OpenAI-compatible, local | No API key; running models are detected automatically |

### Vendor providers (29), table-driven

These are driven by one generated table (`common/vendorProviderData.ts`, produced by `build/lib/vader/genVendorProviders.py` from the models.dev catalog:
gateway URL, key page, newest tool-calling models with context window, price and capabilities). One code path serves all of them, so adding a vendor is a
table row, not new UI or backend code. The endpoint is editable (self-hosted or regional gateways), the key is stored encrypted like every other key, and a
bad endpoint (plain `http` to a remote host, an unfilled `ACCOUNT_ID` placeholder, garbage) is refused before any request leaves. Where the vendor offers
an OpenAI-style `GET /models`, a working key replaces the curated list with the models that key can really use; a model that is not listed still works
through "Add model". Models without native tool-calling fall back to the XML tool grammar.

| Provider | Gateway (editable in Settings) | Curated models | Live model list |
|---|---|---|---|
| [Together AI](https://api.together.ai/settings/api-keys) | `https://api.together.xyz/v1` | 8 | yes |
| [Fireworks AI](https://app.fireworks.ai/settings/users/api-keys) | `https://api.fireworks.ai/inference/v1` | 8 | yes |
| [Cerebras](https://cloud.cerebras.ai/platform) | `https://api.cerebras.ai/v1` | 2 | yes |
| [Cohere](https://dashboard.cohere.com/api-keys) | `https://api.cohere.ai/compatibility/v1` | 8 | yes |
| [Z.AI (GLM)](https://z.ai/manage-apikey/apikey-list) | `https://api.z.ai/api/paas/v4` | 8 | curated list + Add model |
| [Perplexity](https://www.perplexity.ai/settings/api) | `https://api.perplexity.ai` | 4 | curated list + Add model |
| [NVIDIA NIM](https://build.nvidia.com/settings/api-keys) | `https://integrate.api.nvidia.com/v1` | 8 | yes |
| [Hugging Face](https://huggingface.co/settings/tokens) | `https://router.huggingface.co/v1` | 8 | yes |
| [DeepInfra](https://deepinfra.com/dash/api_keys) | `https://api.deepinfra.com/v1/openai` | 8 | yes |
| [Nebius Token Factory](https://tokenfactory.nebius.com) | `https://api.tokenfactory.nebius.com/v1` | 8 | yes |
| [Cloudflare Workers AI](https://dash.cloudflare.com/profile/api-tokens) | `https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1` | 8 | curated list + Add model |
| [Novita AI](https://novita.ai/settings/key-management) | `https://api.novita.ai/openai` | 8 | curated list + Add model |
| [SiliconFlow](https://cloud.siliconflow.com/account/ak) | `https://api.siliconflow.com/v1` | 8 | yes |
| [Volcengine Ark (Doubao)](https://console.volcengine.com/ark) | `https://ark.cn-beijing.volces.com/api/v3` | 8 | curated list + Add model |
| [StepFun](https://platform.stepfun.com/interface-key) | `https://api.stepfun.com/v1` | 6 | yes |
| [Vercel AI Gateway](https://vercel.com/~/ai-gateway/api-keys) | `https://ai-gateway.vercel.sh/v1` | 12 | yes |
| [Requesty](https://app.requesty.ai/api-keys) | `https://router.requesty.ai/v1` | 12 | yes |
| [AI21 Labs (Jamba)](https://studio.ai21.com/account/api-key) | `https://api.ai21.com/studio/v1` | 2 | curated list + Add model |
| [Upstage (Solar)](https://console.upstage.ai/api-keys) | `https://api.upstage.ai/v1/solar` | 4 | curated list + Add model |
| [Inception (Mercury)](https://platform.inceptionlabs.ai/dashboard/api-keys) | `https://api.inceptionlabs.ai/v1` | 3 | yes |
| [Meta Llama API](https://llama.developer.meta.com) | `https://api.llama.com/compat/v1` | 7 | yes |
| [Baseten](https://app.baseten.co/settings/api_keys) | `https://inference.baseten.co/v1` | 8 | yes |
| [Scaleway](https://console.scaleway.com/iam/api-keys) | `https://api.scaleway.ai/v1` | 8 | yes |
| [OVHcloud AI Endpoints](https://endpoints.ai.cloud.ovh.net) | `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` | 8 | yes |
| [Venice](https://venice.ai/settings/api) | `https://api.venice.ai/api/v1` | 8 | yes |
| [Xiaomi MiMo](https://platform.xiaomimimo.com) | `https://api.xiaomimimo.com/v1` | 6 | curated list + Add model |
| [SambaNova](https://cloud.sambanova.ai/apis) | `https://api.sambanova.ai/v1` | none until a key works | yes |
| [Hyperbolic](https://app.hyperbolic.xyz/settings) | `https://api.hyperbolic.xyz/v1` | none until a key works | yes |
| [GitHub Models](https://github.com/settings/personal-access-tokens) | `https://models.github.ai/inference` | 4 | curated list + Add model |

**What is verified and what is not.** The code that serves these providers is tested for every one of them (`vendorProvidersE2E`: 172 checks across the table,
real OpenAI SDK requests to a local stand-in that arrive at each vendor's own endpoint setting with that vendor's key, endpoint refusals, live lists, search)
and in the real app (`providers` group: search, key entry, live list, unreachable provider). The gateway URLs themselves come from vendor documentation and
the models.dev catalog; the provider hosts cannot be reached from the build environment, so no request to a real vendor has been made by this project's tests.
If a vendor changes its URL, the endpoint field in Settings overrides it without a new release.

Only Anthropic and Gemini have bespoke native-SDK integrations; every other provider goes through one shared OpenAI-compatible code path pointed at a different base URL.

## Tool-calling without native function-calling

Models/providers without reliable native tool-calling (common with local models) fall back to a hand-rolled XML tool-call grammar embedded in the system prompt and parsed out of the model's plain-text output (`electron-main/llmMessage/extractGrammar.ts`). This is how Ollama/vLLM/LM Studio models without solid function-calling still get tool support.

## Per-feature model selection

Five independently-configurable model slots: Chat, Ctrl+K (quick edit), Autocomplete, Apply, SCM (commit messages). Apply and SCM can optionally auto-sync to whatever model Chat is set to. A permanent agent (see `ARCHITECTURE.md`) can additionally pin its own model, overriding the Chat slot for threads running as that agent.

## API key storage

Provider API keys are encrypted at rest via `IEncryptionService` (OS keychain/`safeStorage`-backed) before being written to storage - not plaintext. This is inherited unchanged. One caveat, also inherited: MCP server configuration (`mcp.json`, including any `env`/`headers` used for auth) is stored in plaintext, not through this encryption path - be mindful of putting long-lived secrets directly in `mcp.json` versus a server that reads them from its own environment.

## Known limitations (as of this build)

- Only one tool call per model turn is supported, across every provider path - a structural limit in how `sendLLMMessage.impl.ts` and `chatThreadService.ts` are written, not per-provider.
- MCP tool results that aren't plain text (image/audio/resource content types) aren't handled - `electron-main/mcpChannel.ts` throws for these; text-only MCP tools work.
