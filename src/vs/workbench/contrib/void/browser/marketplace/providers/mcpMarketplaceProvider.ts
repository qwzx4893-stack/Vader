/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IQuickInputService } from '../../../../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IMCPService } from '../../../common/mcpService.js';
import { MCPConfigFileEntryJSON } from '../../../common/mcpServiceTypes.js';
import { IDiscoveryMainService, McpRegistryPackage, McpRegistrySearchResult } from '../../../common/discovery/discoveryServiceTypes.js';
import { IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceItem } from '../../../common/marketplace/marketplaceTypes.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// Search results come from the real, currently-live official MCP Registry
// (https://registry.modelcontextprotocol.io - verified reachable and returning real server
// entries in this session) via the existing IDiscoveryMainService.searchMcpRegistry.
// Configured/installed servers come from IMCPService's own config-file-backed state.
//
// "Configure" is now a real, one-click (or few-click, when secrets are needed) flow: it
// writes an actual runnable entry into mcp.json via IMCPService.addOrUpdateServer - not just
// revealing the file for the user to hand-edit. A remote server (publishes a streamable-http/
// sse endpoint) needs no input at all. A local (npm/pypi/oci) server's command/args are built
// from the registry's own real package metadata (registryType/identifier/runtimeHint -
// verified directly against a live registry response, not guessed); required or secret
// environment variables are prompted for interactively via IQuickInputService - never
// fabricated - and the user can cancel to fall back to revealing the file for manual editing
// instead. The existing mcp.json file watcher then runs the real add-server/health-check flow
// exactly as it would for a hand-edited file, so there is exactly one server-lifecycle path,
// not two.
class MCPMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'mcp-registry';
	readonly displayName = 'MCP Servers';
	readonly itemType = 'MCP_SERVER' as const;
	readonly cacheTtlMs = 60_000;

	constructor(
		private readonly _mcpService: IMCPService,
		private readonly _discoveryService: IDiscoveryMainService,
		private readonly _quickInputService: IQuickInputService,
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
			metadata: { remoteUrl: result.remoteUrl, localOnly: result.localOnly, repositoryUrl: result.repositoryUrl, packages: result.packages },
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

	private _runtimeCommand(pkg: McpRegistryPackage): string {
		if (pkg.runtimeHint) return pkg.runtimeHint;
		// real, well-established per-registry conventions (npm -> npx, pypi -> uvx) - used only
		// when the registry entry itself doesn't already say which runtime to use.
		if (pkg.registryType === 'npm') return 'npx';
		if (pkg.registryType === 'pypi') return 'uvx';
		if (pkg.registryType === 'oci') return 'docker';
		return pkg.registryType;
	}

	async configure(item: MarketplaceItem): Promise<void> {
		const remoteUrl = item.metadata.remoteUrl as string | undefined;
		if (remoteUrl) {
			// remote server - a directly usable endpoint, no local process/secrets to configure
			const entry: MCPConfigFileEntryJSON = { url: new URL(remoteUrl) };
			await this._mcpService.addOrUpdateServer(item.name, entry);
			return;
		}

		const packages = item.metadata.packages as McpRegistryPackage[] | undefined;
		const pkg = packages?.[0];
		if (!item.installed && pkg) {
			const requiredVars = (pkg.environmentVariables ?? []).filter(v => v.isRequired);
			const env: Record<string, string> = {};
			for (const v of requiredVars) {
				const value = await this._quickInputService.input({
					title: `Configure "${item.name}"`,
					prompt: v.description ? `${v.name}: ${v.description}` : v.name,
					password: !!v.isSecret,
					placeHolder: v.default,
				});
				if (value === undefined) {
					// user cancelled - fall back to manual editing rather than installing a
					// half-configured server or fabricating a value for a required secret
					await this._mcpService.revealMCPConfigFile();
					return;
				}
				env[v.name] = value || v.default || '';
			}
			for (const v of pkg.environmentVariables ?? []) {
				if (!v.isRequired && v.default !== undefined) env[v.name] = v.default;
			}

			const command = this._runtimeCommand(pkg);
			const args = command === 'npx' ? ['-y', pkg.identifier]
				: command === 'uvx' ? [pkg.identifier]
					: command === 'docker' ? ['run', '-i', '--rm', pkg.identifier]
						: [pkg.identifier];
			const entry: MCPConfigFileEntryJSON = { command, args, ...(Object.keys(env).length ? { env } : {}) };
			await this._mcpService.addOrUpdateServer(item.name, entry);
			return;
		}

		// no real package/remote metadata to build a command from (or already installed and
		// just needs manual fixing, e.g. status 'error') - reveal the file rather than
		// fabricating a command that might not actually run.
		await this._mcpService.revealMCPConfigFile();
	}
}

class MCPMarketplaceProviderContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.mcpMarketplaceProvider';

	constructor(
		@IMCPService mcpService: IMCPService,
		@IDiscoveryMainService discoveryService: IDiscoveryMainService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new MCPMarketplaceProvider(mcpService, discoveryService, quickInputService));
	}
}

registerWorkbenchContribution2(MCPMarketplaceProviderContribution.ID, MCPMarketplaceProviderContribution, WorkbenchPhase.BlockRestore);
