/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { builtinTools } from '../prompt/prompts.js';
import { IMCPService } from '../mcpService.js';
import { IAgentsService } from '../agents/agentsService.js';
import { IDiscoveryMainService } from '../discovery/discoveryService.js';
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

		return [...native, ...mcp, ...agents];
	}

	async resolve(query: string): Promise<CapabilityDescriptor[]> {
		const local = this.listLocalCapabilities()
			.map(c => ({ c, score: scoreMatch(query, `${c.name} ${c.description}`) }))
			.filter(({ score }) => score > 0)
			.sort((a, b) => b.score - a.score)
			.map(({ c }) => c);

		// Prefer what's already available locally; only reach out to the network when
		// nothing local looks relevant (mission: prefer local/trusted before downloading).
		if (local.length > 0) return local;

		const [mcpResults, skillResults] = await Promise.all([
			this._discoveryService.searchMcpRegistry(query),
			this._discoveryService.searchSkillNet(query),
		]);

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

		return [...mcpDescriptors, ...skillDescriptors];
	}
}

registerSingleton(ICapabilityBusService, CapabilityBusService, InstantiationType.Delayed);
