# Replacing SkillNet or the MCP Registry

**Contract:** `IDiscoveryMainService` in `src/vs/workbench/contrib/void/common/discovery/discoveryServiceTypes.ts`.

**Current implementation:** `src/vs/workbench/contrib/void/electron-main/discoveryMainService.ts`, calling:
- `https://registry.modelcontextprotocol.io/v0/servers?search=...` (official MCP Registry, public, unauthenticated)
- `http://api-skillnet.openkg.cn/v1/search?q=...` (SkillNet's public search API, unauthenticated)
- `raw.githubusercontent.com` (best-effort fetch of a skill's `SKILL.md`/`README.md`, for GitHub-hosted skills only)

## The interface

```ts
searchMcpRegistry(query: string): Promise<McpRegistrySearchResult[]>
searchSkillNet(query: string): Promise<SkillNetSearchResult[]>
fetchSkillInstructions(repositoryUrl: string): Promise<string | null>
```

Every method degrades to an empty/`null` result on network failure rather than throwing - discovery is advisory, and a registry being unreachable shouldn't break the agent that called `find_capability`.

## To replace a source

Implement `IDiscoveryMainService` (or wrap the existing one and override just one method) and swap the `services.set(IDiscoveryMainService, ...)` line in `src/vs/code/electron-main/app.ts`. Everything above it - `common/discovery/discoveryService.ts` (the browser-side proxy), `common/capabilities/capabilityBusService.ts` (which calls this only when nothing local matches), and the `search_mcp_registry`/`search_skillnet`/`fetch_skill_instructions` tools - is unaffected.

## Security note for anyone extending this

Content returned by `fetchSkillInstructions` is untrusted external text. It is deliberately surfaced to the model as ordinary tool output (prefixed `[UNTRUSTED external content ...]`), not injected into the system/instructions layer - see `common/instructions/instructionsService.ts`'s doc comment for why elevating untrusted fetched content into an instructions layer would be a prompt-injection vector. Keep that separation if you extend this: a "skill" is reference material the model reads and judges, not a new system instruction it's expected to obey.

## What isn't built

Actually *installing* a discovered MCP server (writing to `mcp.json`) or a discovered skill (downloading its full folder into a local skill cache with trust/pin metadata) is not automated - `search_mcp_registry`'s result tells the user what to paste into `mcp.json` themselves. This was a deliberate scope decision (see the mission's own caution about "never automatically grant downloaded skills unrestricted access"), not an oversight; if you build the automated-install path, keep it behind an explicit user action, not something the agent can do unattended.
