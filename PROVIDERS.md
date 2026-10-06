# Model Providers

Vader inherits its provider layer unchanged (`src/vs/workbench/contrib/void/common/sendLLMMessageService.ts`, `electron-main/llmMessage/sendLLMMessage.impl.ts`). This document describes what's actually implemented, not an aspirational list.

## Supported providers

| Provider | Integration | Notes |
|---|---|---|
| Anthropic | Native SDK | Native tool-calling, thinking/reasoning support |
| Google Gemini | Native SDK | Native tool-calling |
| OpenAI | OpenAI-compatible path | |
| xAI | OpenAI-compatible path | |
| Mistral | OpenAI-compatible path | |
| DeepSeek | OpenAI-compatible path | |
| Groq | OpenAI-compatible path | |
| OpenRouter | OpenAI-compatible path | Identifies itself to OpenRouter as "Vader" (`HTTP-Referer`/`X-Title` headers) |
| LiteLLM | OpenAI-compatible path | For self-hosted multi-provider gateways |
| OpenAI-compatible (generic) | OpenAI-compatible path | Custom base URL, for any compatible endpoint |
| Microsoft Azure | OpenAI-compatible path | Proxied |
| AWS Bedrock | OpenAI-compatible path | Proxied |
| Google Vertex | OpenAI-compatible path | Proxied |
| **Ollama** | OpenAI-compatible path, local | No API key; auto-detects locally running models |
| **LM Studio** | OpenAI-compatible path, local | No API key |
| **vLLM** | OpenAI-compatible path, local | No API key |

Only Anthropic and Gemini have bespoke native-SDK integrations; every other provider (11 of 14) goes through one shared OpenAI-compatible code path pointed at a different base URL. This means a provider added to that list mostly "just works" without new per-provider code, as long as its API is OpenAI-compatible.

## Tool-calling without native function-calling

Models/providers without reliable native tool-calling (common with local models) fall back to a hand-rolled XML tool-call grammar embedded in the system prompt and parsed out of the model's plain-text output (`electron-main/llmMessage/extractGrammar.ts`). This is how Ollama/vLLM/LM Studio models without solid function-calling still get tool support.

## Per-feature model selection

Five independently-configurable model slots: Chat, Ctrl+K (quick edit), Autocomplete, Apply, SCM (commit messages). Apply and SCM can optionally auto-sync to whatever model Chat is set to. A permanent agent (see `ARCHITECTURE.md`) can additionally pin its own model, overriding the Chat slot for threads running as that agent.

## API key storage

Provider API keys are encrypted at rest via `IEncryptionService` (OS keychain/`safeStorage`-backed) before being written to storage - not plaintext. This is inherited unchanged. One caveat, also inherited: MCP server configuration (`mcp.json`, including any `env`/`headers` used for auth) is stored in plaintext, not through this encryption path - be mindful of putting long-lived secrets directly in `mcp.json` versus a server that reads them from its own environment.

## Known limitations (as of this build)

- Only one tool call per model turn is supported, across every provider path - a structural limit in how `sendLLMMessage.impl.ts` and `chatThreadService.ts` are written, not per-provider.
- MCP tool results that aren't plain text (image/audio/resource content types) aren't handled - `electron-main/mcpChannel.ts` throws for these; text-only MCP tools work.
