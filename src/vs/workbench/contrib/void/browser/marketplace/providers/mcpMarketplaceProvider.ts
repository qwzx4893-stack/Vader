/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IMCPService } from '../../../common/mcpService.js';
import { IDiscoveryMainService, McpRegistrySearchResult } from '../../../common/discovery/discoveryServiceTypes.js';
import { IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceItem } from '../../../common/marketplace/marketplaceTypes.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// Search results come from the real, currently-live official MCP Registry
// (https://registry.modelcontextprotocol.io - verified reachable and returning real server
// entries in this session, not assumed from stale docs) via the existing
// IDiscoveryMainService.searchMcpRegistry. Configured/installed servers come from IMCPService's
// own config-file-backed state. "Install" for a server found via the registry means revealing
// mcp.json so the user adds the entry themselves - IMCPService has no programmatic "add a new
// server" API today (servers are added by editing the config file), so this maps to the
// mission's "Configure" action rather than pretending a one-click network install exists where
// it doesn't.
class MCPMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'mcp-registry';
	readonly displayName = 'MCP Servers';
	readonly itemType = 'MCP_SERVER' as const;
	readonly cacheTtlMs = 60_000;

	constructor(
		private readonly _mcpService: IMCPService,
		private readonly _discoveryService: IDiscoveryMainService,
	) { }

	private _configuredToItems(): MarketplaceItem[] {
		return Object.entries(this._mcpService.state.mcpServerOfName ?? {}).map(([name, server]): MarketplaceItem => ({
			id: name,
			providerId: this.id,
			type: 'MCP_SERVER',
			name,
			description: server.status === 'error' ? `Configuration error: ${server.error}` : `MCP server (${server.status})`,
			source: 'Configured (mcp.json)',
			trust: 'unknown',
			installed: true,
			enabled: server.status !== 'offline',
			installMethod: server.status === 'error' ? 'configure' : null,
			security: { source: 'mcp.json', executesCode: true, networkAccess: true },
			metadata: { serverName: name, status: server.status },
		}));
	}

	private _remoteToItem(result: McpRegistrySearchResult): MarketplaceItem {
		return {
			id: result.name,
			providerId: this.id,
			type: 'MCP_SERVER',
			name: result.name,
			description: result.description,
			source: 'MCP Registry (registry.modelcontextprotocol.io)',
			version: result.version,
			trust: 'unknown',
			installed: false,
			installMethod: 'configure',
			security: {
				source: result.repositoryUrl ?? result.remoteUrl ?? 'MCP Registry',
				repositoryUrl: result.repositoryUrl,
				executesCode: true, // an MCP server is an executable process (local package) or a remote endpoint this codebase's model will call tools on
				networkAccess: true,
			},
			metadata: { remoteUrl: result.remoteUrl, localOnly: result.localOnly, repositoryUrl: result.repositoryUrl },
		};
	}

	async search(query: string, token: CancellationToken): Promise<MarketplaceItem[]> {
		const configured = this._configuredToItems();
		const configuredNames = new Set(configured.map(c => c.id));
		const remote = await this._discoveryService.searchMcpRegistry(query);
		return [
			...configured.filter(c => `${c.name}`.toLowerCase().includes(query.toLowerCase())),
			...remote.filter(r => !configuredNames.has(r.name)).map(r => this._remoteToItem(r)),
		];
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		return this._configuredToItems();
	}

	async setEnabled(item: MarketplaceItem, enabled: boolean): Promise<void> {
		await this._mcpService.toggleServerIsOn(String(item.metadata.serverName ?? item.id), enabled);
	}

	async configure(): Promise<void> {
		await this._mcpService.revealMCPConfigFile();
	}
}

class MCPMarketplaceProviderContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.mcpMarketplaceProvider';

	constructor(
		@IMCPService mcpService: IMCPService,
		@IDiscoveryMainService discoveryService: IDiscoveryMainService,
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new MCPMarketplaceProvider(mcpService, discoveryService));
	}
}

registerWorkbenchContribution2(MCPMarketplaceProviderContribution.ID, MCPMarketplaceProviderContribution, WorkbenchPhase.BlockRestore);
