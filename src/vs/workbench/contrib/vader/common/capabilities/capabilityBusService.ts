/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { builtinTools } from '../prompt/prompts.js';
import { IMCPService } from '../mcpService.js';
import { IAgentsService } from '../agents/agentsService.js';
import { IDiscoveryMainService } from '../discovery/discoveryService.js';
import { ISkillService } from '../skills/skillService.js';
import { IUnifiedMarketplaceService } from '../marketplace/marketplaceTypes.js';
import { CapabilityDescriptor, ICapabilityBusService } from './capabilityBusTypes.js';

export * from './capabilityBusTypes.js';

// crude but effective: word-overlap scoring needs no embeddings/network, and this is a
// convenience resolver, not a source of truth - a bad ranking just means slightly less
// helpful ordering, never a wrong answer, since results are always labeled by source/trust.
function scoreMatch(query: string, text: string): number {
	const queryWords = query.toLowerCase().split(/\W+/).filter(Boolean);
	const haystack = text.toLowerCase();
	return queryWords.filter(w => haystack.includes(w)).length;
}

class CapabilityBusService implements ICapabilityBusService {
	readonly _serviceBrand: undefined;

	constructor(
		@IMCPService private readonly _mcpService: IMCPService,
		@IAgentsService private readonly _agentsService: IAgentsService,
		@IDiscoveryMainService private readonly _discoveryService: IDiscoveryMainService,
		@ISkillService private readonly _skillService: ISkillService,
		@IUnifiedMarketplaceService private readonly _marketplaceService: IUnifiedMarketplaceService,
	) { }

	listLocalCapabilities(): CapabilityDescriptor[] {
		const native: CapabilityDescriptor[] = Object.values(builtinTools).map(t => ({
			id: `native-tool:${t.name}`,
			source: 'native-tool',
			name: t.name,
			description: t.description,
			trust: 'trusted',
			available: true,
		}));

		const mcp: CapabilityDescriptor[] = (this._mcpService.getMCPTools() ?? []).map(t => ({
			id: `mcp-tool:${t.mcpServerName ?? 'unknown'}:${t.name}`,
			source: 'mcp-tool',
			name: t.name,
			description: t.description,
			trust: 'trusted',
			available: true,
		}));

		const agents: CapabilityDescriptor[] = this._agentsService.state.agents.map(a => ({
			id: `permanent-agent:${a.id}`,
			source: 'permanent-agent',
			name: a.name,
			description: a.description,
			trust: 'trusted',
			available: true,
		}));

		// installed skills that aren't yet enabled/trusted still show up here (so the model
		// can see "you already have something for this, ask the user to enable it" instead
		// of re-discovering/re-installing a duplicate) - trust/available reflect their real
		// state, not blanket 'trusted' like the other local sources above
		const skills: CapabilityDescriptor[] = this._skillService.list().map(s => ({
			id: `installed-skill:${s.id}`,
			source: 'installed-skill',
			name: s.name,
			description: s.description,
			trust: s.trustState === 'trusted' ? 'trusted' : 'untrusted',
			available: s.enabled && s.trustState !== 'blocked',
		}));

		return [...native, ...mcp, ...agents, ...skills];
	}

	async resolve(query: string): Promise<CapabilityDescriptor[]> {
		// Vader addition: installed/local Unified Capability Marketplace items (extensions,
		// language servers, debug adapters, formatters, local Jupyter kernels - ecosystems
		// this bus otherwise has zero coverage of) count as local capabilities too, same as
		// native tools/MCP tools/agents/skills below.
		const marketplaceInstalled = await this._marketplaceService.listInstalled().catch(() => []);
		const marketplaceLocalDescriptors: CapabilityDescriptor[] = marketplaceInstalled.map(item => ({
			id: `marketplace-installed:${item.providerId}:${item.id}`,
			source: 'marketplace-installed',
			name: item.name,
			description: item.description,
			trust: item.trust === 'blocked' ? 'untrusted' : 'trusted',
			available: item.installed || !!item.isLocal,
		}));

		const local = [...this.listLocalCapabilities(), ...marketplaceLocalDescriptors]
			.map(c => ({ c, score: scoreMatch(query, `${c.name} ${c.description}`) }))
			.filter(({ score }) => score > 0)
			.sort((a, b) => b.score - a.score)
			.map(({ c }) => c);

		// Prefer what's already available locally; only reach out to the network when
		// nothing local looks relevant (mission: prefer local/trusted before downloading).
		if (local.length > 0) return local;

		const [mcpResults, skillResults, marketplaceCandidates] = await Promise.all([
			this._discoveryService.searchMcpRegistry(query),
			this._discoveryService.searchSkillNet(query),
			// covers the marketplace-only ecosystems (extensions/LSP/DAP/formatters) that have
			// no direct call above - MCP/Skills keep their existing direct calls (unchanged
			// labels/behavior) rather than being rerouted through the marketplace.
			this._marketplaceService.discoverForCapability(query).catch(() => []),
		]);

		const marketplaceCandidateDescriptors: CapabilityDescriptor[] = marketplaceCandidates
			.filter(item => !item.installed && (item.type === 'EXTENSION' || item.type === 'LANGUAGE_SERVER' || item.type === 'DEBUG_ADAPTER' || item.type === 'FORMATTER'))
			.map(item => ({
				id: `marketplace-candidate:${item.providerId}:${item.id}`,
				source: 'marketplace-candidate',
				name: item.name,
				description: item.description,
				trust: 'untrusted',
				available: false,
				marketplace: { providerId: item.providerId, itemName: item.name },
			}));

		const mcpDescriptors: CapabilityDescriptor[] = mcpResults.map(r => ({
			id: `mcp-registry:${r.name}`,
			source: 'mcp-registry',
			name: r.name,
			description: r.description,
			trust: 'untrusted',
			available: false,
		}));

		const skillDescriptors: CapabilityDescriptor[] = skillResults.map(r => ({
			id: `skillnet:${r.repositoryUrl}`,
			source: 'skillnet',
			name: r.name,
			description: r.description,
			trust: 'untrusted',
			available: false,
		}));

		return [...mcpDescriptors, ...skillDescriptors, ...marketplaceCandidateDescriptors];
	}
}

registerSingleton(ICapabilityBusService, CapabilityBusService, InstantiationType.Delayed);
