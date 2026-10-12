/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IExternalAgentAdapterRegistry } from '../../../common/externalAgent/externalAgentAdapterRegistry.js';
import { IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceItem } from '../../../common/marketplace/marketplaceTypes.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
//
// This provider lists only what is registered in the in-process External Agent Adapter boundary
// (IExternalAgentAdapterRegistry, common/externalAgent/) - today the reference adapter backed by Vader's
// own runtime. No network search and no install action here.
//
// The coding agents a person can bring from outside (Codex, OpenCode, Cursor, Gemini, ...) are a separate
// feature with their own page: Settings > Coding Agents, backed by the public ACP Agent Registry and the
// ACP client in electron-main/externalAgentMainService.ts - see docs/integrations/external-agents.md.
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
