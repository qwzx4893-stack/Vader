/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IExternalAgentAdapterRegistry } from '../../../common/externalAgent/externalAgentAdapterRegistry.js';
import { IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceItem } from '../../../common/marketplace/marketplaceTypes.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
//
// IMPORTANT semantic note (per the mission's own explicit warning): ACP (Zed's Agent Client
// Protocol) is a PROTOCOL, not a registry. There is no official ACP agent registry to search
// against - inventing one here would be exactly the "fake ACP Registry" the mission
// explicitly says not to build. What genuinely exists in this codebase is the External Agent
// Adapter boundary (IExternalAgentAdapterRegistry, common/externalAgent/) - an in-process
// registry of adapters that have actually been implemented and registered (today: one
// reference adapter backed by Vader's own runtime - see vaderNativeExternalAgentAdapter.ts).
// This provider surfaces exactly that: `search`/`listInstalled` both just return whatever is
// currently registered there. There is deliberately no network search, no "browse available
// ACP agents" list, and no install action - an ACP agent is wired up by writing and
// registering an IExternalAgentAdapter implementation (a code change), not something a user
// clicks "Install" on from a marketplace. Manual-add (per the mission's "implement genuine
// ACP-agent discovery sources plus manual-add") is future, separately-scoped work if/when a
// real third-party ACP-speaking agent binary exists in this environment to shell out to - see
// docs/integrations/external-agent-adapter.md for why none does today.
class ACPAgentMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'acp-agents';
	readonly displayName = 'ACP Agents';
	readonly itemType = 'ACP_AGENT' as const;
	readonly cacheTtlMs = 0; // in-process registry - always current, nothing to cache

	constructor(
		private readonly _registry: IExternalAgentAdapterRegistry,
	) { }

	private _toItems(): MarketplaceItem[] {
		return this._registry.list().map((adapter): MarketplaceItem => {
			const caps = adapter.getCapabilities();
			return {
				id: adapter.id,
				providerId: this.id,
				type: 'ACP_AGENT',
				name: adapter.displayName,
				description: `ACP-inspired agent adapter (streaming: ${caps.supportsStreaming}, tool requests: ${caps.supportsToolRequests}, plans: ${caps.supportsPlans}).`,
				source: 'External Agent Adapter (in-process registry)',
				trust: 'trusted', // registered in-process by this build's own code, not fetched from any external source
				installed: true, // "installed" here means "registered" - there's no separate install step
				installMethod: null,
				isLocal: true,
				security: { source: 'in-process adapter registration', executesCode: true },
				metadata: { capabilities: caps },
			};
		});
	}

	async search(query: string, token: CancellationToken): Promise<MarketplaceItem[]> {
		const q = query.toLowerCase();
		return this._toItems().filter(i => !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		return this._toItems();
	}
}

class ACPAgentMarketplaceProviderContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.acpAgentMarketplaceProvider';

	constructor(
		@IExternalAgentAdapterRegistry registry: IExternalAgentAdapterRegistry,
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new ACPAgentMarketplaceProvider(registry));
	}
}

registerWorkbenchContribution2(ACPAgentMarketplaceProviderContribution.ID, ACPAgentMarketplaceProviderContribution, WorkbenchPhase.BlockRestore);
