# MiniMax (`minimax`)

**Sourcing note:** `platform.minimax.io`/`www.minimax.io` were not directly fetchable from this session's sandbox (egress-blocked). Facts below come from web search (which retrieves/quotes those pages) corroborated where possible against directly-fetched GitHub sources (`github.com/MiniMax-AI`, the MiniMax-M2 README, `docs/tool_calling_guide.md` via raw.githubusercontent.com - all fetched directly, highest confidence).

- **Endpoints**: international `https://api.minimax.io/v1` (Vader's default); mainland China `https://api.minimax.cn/v1` (recently migrated from the older `api.minimaxi.com`, which now redirects - if this has moved again, that's a real risk with a fast-moving platform). Keys are region-issued and not portable across the two.
- **Auth**: `Authorization: Bearer <key>`. A separate "GroupId" credential was required historically but current documented key formats (`sk-cp-...`) appear to authenticate with the Bearer key alone - not independently confirmed with a live call.
- **OpenAI compatibility**: yes, a first-party OpenAI-compatible route (`/v1/chat/completions`) alongside a native, non-OpenAI-shaped legacy endpoint. Vader only implements the OpenAI-compatible route.
- **Tool calling**: standard OpenAI `tools`/`tool_calls` schema on the hosted API; multiple tool calls per turn are supported. (The raw, self-hosted open-weight model uses a bespoke XML tool-call format - irrelevant to Vader's hosted-API integration.)
- **Reasoning**: `reasoning_content` field on the assistant message (same convention as DeepSeek's OpenAI-compatible reasoning output) - Vader's `minimaxSettings` uses the identical `nameOfFieldInDelta: 'reasoning_content'` pattern already proven for DeepSeek/LiteLLM.
- **Vision**: MiniMax-M3/M3.1 are documented multimodal (image/video); the M2 family is text-only. `modelSupportsVision` matches `/minimax-m3/i`.
- **Models implemented**: `MiniMax-M2`, `MiniMax-M2.1` (204,800-token context, well-corroborated). M3/M3.1's exact context window is reported inconsistently across sources (256K-1M depending on source) and was deliberately left out of the default catalog rather than guessed - add it manually with the correct context window once confirmed against a live account.
- **Not independently verified**: the exact error-body JSON shape on the OpenAI-compatible route, and whether `reasoning_split` is required to get a separate `reasoning_details` field.

Costs listed in `modelCapabilities.ts`'s `minimaxModelOptions` are approximate; check `platform.minimax.io`'s current pricing page before relying on them for cost estimates.
