# FAQ

**Is Vader free?** Yes, it is open source under Apache-2.0. You pay your model provider directly, or nothing with a local model.

**Which providers are supported?** 49: every one is its own entry in Settings (search box included), not only through OpenRouter. See [`PROVIDERS.md`](../PROVIDERS.md).

**Do I need OpenRouter?** No. OpenRouter is one entry among the others. Use your vendor's key directly.

**A provider's URL changed or I use a regional or self-hosted gateway.** Every provider's endpoint is editable in Settings; the value you enter wins over the built-in one. Plain `http` is accepted only for loopback addresses.

**My provider is missing.** If it speaks the OpenAI chat-completions protocol, use **OpenAI-Compatible** with its base URL. If it is a vendor others will want, adding it is one row in the generator's table (`build/lib/vader/genVendorProviders.py`), see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

**Does Vader send my code anywhere?** Only to the model provider you configure, for the requests you make. There is no Vader server, no analytics and no update beacon ([`docs/integrations/privacy.md`](./integrations/privacy.md)).

**What stops the agent from doing something destructive?** A policy engine checks every tool call before it runs: locked rules deny the catastrophic cases and cannot be turned off, ask rules cover secrets, startup files and installs, and approvals are on by default. A hostile terminal command can still reach whatever your account can, which is why the approval prompt exists ([`docs/AGENT_SESSIONS.md`](./AGENT_SESSIONS.md)).

**Does it work with small local models?** Yes (Ollama, LM Studio, vLLM). Models without native tool calling use an XML tool grammar automatically. Small models are weaker agents ([`docs/QUALITY_COMPARISON.md`](./QUALITY_COMPARISON.md)).

**Can I use VS Code extensions?** Yes, from the Open VSX gallery.

**How do I build it?** See the build section of the [README](../README.md) and [`docs/integrations/`](./integrations/).

**Where are my keys stored?** Encrypted with your operating system's keychain (`safeStorage`), never in plain text.
