# The Unified Capability Marketplace

**Contract:** `IUnifiedMarketplaceService`/`IMarketplaceProvider`/`MarketplaceItem` in `common/marketplace/marketplaceTypes.ts`. **Implementation:** `browser/marketplace/unifiedMarketplaceService.ts` + `browser/marketplace/providers/*.ts`. **UI:** `MarketplaceViewPane` (`browser/marketplace/marketplaceViewPane.ts`), an additive pane in the existing Extensions view container, rendering the React `Marketplace` component (`browser/react/src/void-marketplace-tsx/`).

## Two layers, on purpose

The **marketplace** (this doc) is a *discovery and management* layer: search, install, configure, enable/disable across every ecosystem. The **Capability Bus** (`common/capabilities/`, `docs` not yet split out - see `capabilityBusService.ts`'s own header comment) is a separate *runtime resolution* layer an agent calls to find something already usable. They're wired together (installed marketplace items appear in `ICapabilityBusService.resolve()`; a marketplace-candidate result routes into `install_marketplace_capability`) but kept as two contracts, matching the mission's explicit instruction not to couple the agent directly to marketplace UI state.

## The 9 ecosystems: what's real, what's honestly scoped down, and why

| Ecosystem | Provider | Depth | Why |
|---|---|---|---|
| Open VSX / Extension Gallery | `ExtensionGalleryProvider` | **Full** | Wraps `IExtensionsWorkbenchService` unmodified - the exact same service backing the untouched, stock Extensions view. Zero new gallery logic, zero regression risk by construction. |
| Agent Skills | `SkillMarketplaceProvider` | **Full** | Uses the existing `ISkillService` + `IDiscoveryMainService.searchSkillNet`/`fetchSkillInstructions` - the same two-step install flow `install_skill` already used. |
| MCP Registry | `MCPMarketplaceProvider` | **Full for discovery, partial for install** | The official MCP Registry (`registry.modelcontextprotocol.io`) was verified live and returning real server entries in this session (direct fetch, not assumption). Configured servers come from `IMCPService`'s real state. "Install" maps to `configure` (reveal `mcp.json`) because `IMCPService` has no programmatic add-server API today - stated honestly rather than implying a one-click install that doesn't exist. |
| ACP Agents | `ACPAgentMarketplaceProvider` | **Honestly minimal, by design** | ACP is a protocol, not a registry - there is no official ACP agent registry to search, and inventing one would be exactly what the mission warns against. This provider only lists what's actually registered in `IExternalAgentAdapterRegistry` (today: one reference adapter). No network search, no install action. |
| Language Servers | `LanguageServerMarketplaceProvider` | **Open-VSX-delivered only** | No universal standalone LSP registry was found or verified. Classifies the *same* extension gallery by its real `categories`/`contributes.languages` fields (both pre-existing, non-invented) rather than fabricating a second registry. Install/uninstall delegate to the identical `IExtensionsWorkbenchService` calls - one install path, not two. |
| Debug Adapters | `DebugAdapterMarketplaceProvider` | **Open-VSX-delivered only** | Same reasoning and same mechanism as Language Servers, via `categories`/`contributes.debuggers`. |
| Tree-sitter Grammars | *(none)* | **Deliberately not implemented** | No verified real, current tree-sitter grammar registry was found in this session, and this codebase has no tree-sitter runtime to consume a grammar even if one were found (Vader's syntax highlighting is TextMate-grammar-based, unchanged by this pass). Per the mission's own instruction not to invent a fake registry, and not to blindly replace the existing TextMate path, this ecosystem is a stated, genuine gap - not a provider that pretends to search and always finds nothing. |
| Prettier | `PrettierMarketplaceProvider` | **Local-only, real** | Reads the workspace's own `package.json` for the `prettier` dependency and `prettier-plugin-*`/`@prettier/plugin-*` packages - real, local, zero network, zero fabricated plugin list. Reports what's declared, not what could theoretically be installed. |
| Jupyter Kernels | `JupyterKernelMarketplaceProvider` | **Local-only, real** | Scans the real, documented, OS-standard per-user Jupyter kernelspec directories (`~/.local/share/jupyter/kernels`, `~/Library/Jupyter/kernels`, `%APPDATA%\jupyter\kernels`) and parses `kernel.json`. Distinguishes local kernels from Open-VSX Jupyter *extensions* (already covered by `ExtensionGalleryMarketplaceProvider`, not duplicated) and never claims a kernel is usable *from inside Vader* - this codebase has no notebook/Jupyter protocol client. |

## Federated search: ranking, failure isolation, caching

`IUnifiedMarketplaceService.search()` (`unifiedMarketplaceService.ts`):
- Queries every registered provider **concurrently**, each with its own timeout (8s) via a fresh `CancellationTokenSource`.
- **Per-provider failure isolation**: a `try`/`catch` around each provider's call means one dead/offline source degrades to "0 results, error noted" in `providerOutcomes` - it never breaks the rest of the federated search. This is also the offline-degradation mechanism: cached results are served if a live call fails, with the outage still surfaced.
- **Dedup** by `${providerId}:${id}`.
- **Ranking** (`_score`): exact name match scores far above everything else (1000), then prefix match (300), then substring match in name (100) or description (20); installed/local items get a flat bonus (150); a small per-type weight (`TYPE_RELEVANCE_WEIGHT`) breaks remaining ties so, e.g., a weak Skill description match doesn't outrank a weak Extension one - but never so much that it overrides an exact-name match, matching the mission's explicit "python" example.
- **Cancel-stale-searches**: a generation counter means a slower, superseded search's results are dropped rather than overwriting a newer search's output.
- **Caching**: per-`(providerId, query)` with each provider's own `cacheTtlMs` (30s-120s depending on ecosystem; the in-process ACP registry has a 0ms TTL since there's nothing to go stale).

## Agent-facing discovery flow (never a silent install)

`find_capability` (existing tool) → `ICapabilityBusService.resolve()` → (nothing local) → `IUnifiedMarketplaceService.discoverForCapability()` → candidates returned with `source: 'marketplace-candidate'` → the Main Agent may then call the new `install_marketplace_capability` tool, which:
1. Re-resolves the *live* item by name/provider (never trusts a stale snapshot from the earlier search).
2. Calls `performAction(item.installMethod, item)` - using the item's own real action, never one the model picks arbitrarily.
3. Goes through the **exact same** Policy Engine/approval gate every other mutating tool call does (`approvalTypeOfBuiltinToolName['install_marketplace_capability'] = 'edits'`, same tier as `install_skill`).

There is no code path from "agent found a candidate" to "something is installed" that skips human approval - satisfying "the agent must never silently install arbitrary executable software" by the same mechanism that already protects every other mutating tool, not a new one.

## UI: additive, not a redesign

`MarketplaceViewPane` registers as a **second, independent view** inside the existing Extensions view container (`Registry.as<IViewContainersRegistry>(...).get(VIEWLET_ID)`), deferred to a `WorkbenchPhase.BlockRestore` contribution so the container is guaranteed to already exist. This was verified against the container's own `rejectAddedViews: true` flag first - that flag only gates drag-and-drop UI affordances (`viewPaneContainer.ts`), not static `registerViews()` calls, so this approach doesn't fight that flag.

It does **not** modify `extensionsViewlet.ts`/`extensionsViews.ts`/`extensionsList.ts`/`extensionEditor.ts` - the native Open VSX search/install/uninstall/enable-disable/update/details flow is untouched by construction. Its `show(query)` method mirrors the signature `ExtensionsViewPaneContainer.doSearch()` calls on every pane (wrapped in `Promise.all`) and is written defensively (try/catch, never throws, always resolves) specifically because a throwing pane would otherwise break search for every other pane in the container, including the native ones - this was the single highest-risk integration point in this whole pass and is called out here for exactly that reason.

Content renders via a React component (`Marketplace.tsx`), the same `mountFnGenerator`/`useAccessor` infrastructure already used for the Sidebar and Settings panes - not new plumbing. EXTENSION-type results are filtered out of this pane's list (the native Marketplace/Installed panes already show those); every other type shows a subtle uppercase type badge, source, publisher, trust flag (unverified/blocked), and one action button mapped to its real `installMethod`.

## Security/supply-chain metadata

Every `MarketplaceItem` carries a `security` object (`source`, `publisher`, `version`, `repositoryUrl`, and best-effort `executesCode`/`networkAccess`/`filesystemAccess`/`terminalAccess` flags) and a `trust` field defaulting to `'unknown'` - never `'trusted'` - for anything this session can't actually verify (a gallery extension, an MCP Registry result, a SkillNet result). Only genuinely locally-verified things (an already-registered ACP adapter, a package.json-declared Prettier dependency, a kernel found on disk) are marked `'trusted'`. Nothing in this pass implies safety merely from appearing in search.

## Live verification status

Federated search, ranking, and provider correctness were **compiled and reviewed**, not live-verified end-to-end in a running Electron workbench - the same pre-existing sandbox limitation documented elsewhere in this repo (an unpackaged Electron launch doesn't reach a working workbench in this Linux sandbox, verified true for unmodified Void too) applies here without this pass re-proving it. What *was* independently verified outside the workbench: the MCP Registry endpoint is real and live (direct HTTP fetch, three separate ways - see `docs/integrations/agent-runtime.md`'s verification methodology, reused here), and the `rejectAddedViews` semantics were confirmed by reading `viewPaneContainer.ts`'s actual usage rather than assumed.
