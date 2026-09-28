/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

// The Capability Bus is the unification point the mission asks for: agents shouldn't need
// to know whether something they want to use is a built-in tool, an MCP tool, a permanent
// agent, or a skill/MCP server they haven't installed yet. It does NOT replace how any of
// those are actually invoked (native tools still go through toolsService, MCP through
// mcpService, etc.) - it's a read-only inventory + resolver layered on top of the services
// that already own each of those, so there's exactly one place to ask "what do I have (or
// could get) for X," matching the resolution order in the mission: installed native
// capability -> pinned/cached skill -> SkillNet -> configured MCP -> MCP Registry.

// Vader addition: 'marketplace-installed'/'marketplace-candidate' surface the Unified
// Capability Marketplace's own ecosystems (extensions, language servers, debug adapters,
// formatters, Jupyter kernels - see common/marketplace/marketplaceTypes.ts) through this
// same resolver, alongside the sources that already had direct integrations here
// (mcp-tool/mcp-registry, installed-skill/skillnet). Those existing sources are left calling
// their original services directly rather than being rerouted through the marketplace, to
// avoid changing their established behavior/labels - the marketplace adds ecosystems this
// bus had no coverage of at all, rather than replacing what it already did.
export type CapabilitySource = 'native-tool' | 'mcp-tool' | 'permanent-agent' | 'installed-skill' | 'skillnet' | 'mcp-registry' | 'marketplace-installed' | 'marketplace-candidate';

export type CapabilityDescriptor = {
	readonly id: string;
	readonly source: CapabilitySource;
	readonly name: string;
	readonly description: string;
	/** 'trusted': already configured/connected locally. 'untrusted': a discovery result not yet installed - see mission section 31. */
	readonly trust: 'trusted' | 'untrusted';
	/** can be used right now without any extra setup step */
	readonly available: boolean;
	/** set only for source === 'marketplace-candidate' - lets install_marketplace_capability re-resolve the live item rather than trusting a stale snapshot */
	readonly marketplace?: { providerId: string; itemName: string };
};

export interface ICapabilityBusService {
	readonly _serviceBrand: undefined;
	/** everything already usable locally: native tools, connected MCP tools, permanent agents */
	listLocalCapabilities(): CapabilityDescriptor[];
	/**
	 * Resolves a need to capabilities, local-first. Only calls out to SkillNet/the MCP
	 * Registry (network) when nothing local looks like a good match, per the mission's
	 * "prefer existing trusted/local capabilities before downloading something new."
	 */
	resolve(query: string): Promise<CapabilityDescriptor[]>;
}

export const ICapabilityBusService = createDecorator<ICapabilityBusService>('vaderCapabilityBusService');
