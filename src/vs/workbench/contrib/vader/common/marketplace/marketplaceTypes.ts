/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';

/**
 * The Unified Capability Marketplace: a single federated search/management layer over every
 * ecosystem Vader can pull a capability from. This is a *discovery and management* layer -
 * see `common/capabilities/capabilityBusTypes.ts` for the separate *runtime resolution*
 * layer an agent actually calls to use something once it's installed/configured. The two
 * are deliberately not merged: the marketplace is what a human (or an agent's discovery
 * flow, see `IUnifiedMarketplaceService.discoverForCapability`) searches and installs from;
 * the Capability Bus is what a running agent calls to find something already available.
 * See docs/integrations/marketplace.md for the full design and, honestly, which of the 9
 * ecosystems this got real depth for vs. a narrower, explicitly-scoped implementation.
 */
export type MarketplaceItemType =
	| 'EXTENSION'
	| 'SKILL'
	| 'MCP_SERVER'
	| 'ACP_AGENT'
	| 'LANGUAGE_SERVER'
	| 'DEBUG_ADAPTER'
	| 'TREE_SITTER_GRAMMAR'
	| 'FORMATTER'
	| 'JUPYTER_KERNEL';

/**
 * What clicking this item's primary action actually does - deliberately not always
 * "Install": a provider maps to whichever of these its real underlying lifecycle supports,
 * per docs/integrations/marketplace.md's per-ecosystem action table. `null` means this item
 * has no primary action at all (e.g. a local kernel that's already available).
 */
export type MarketplaceInstallMethod =
	| 'install' | 'update' | 'uninstall' | 'enable' | 'disable'
	| 'configure' | 'connect' | 'add' | 'download' | 'use_local' | 'review_and_install'
	| null;

/**
 * Trust/provenance signal shown to the user before they install/enable anything -
 * deliberately conservative: 'unknown' (not 'trusted') is the default for anything this
 * session can't actually verify, per the mission's "never imply safety merely from
 * appearing in search" requirement.
 */
export type MarketplaceTrust = 'trusted' | 'review_required' | 'unknown' | 'blocked';

export type MarketplaceSecurityInfo = {
	/** where this item's code/config actually comes from - a URL, package spec, or 'local' */
	readonly source: string;
	readonly publisher?: string;
	readonly version?: string;
	/** true only when this session actually saw a checksum/signature verification succeed - never assumed */
	readonly signatureVerified?: boolean;
	readonly repositoryUrl?: string;
	/** best-effort, ecosystem-specific: does installing/enabling this run arbitrary code, reach the network, touch the filesystem, or need a terminal - unknown fields are omitted, never guessed as false */
	readonly executesCode?: boolean;
	readonly networkAccess?: boolean;
	readonly filesystemAccess?: boolean;
	readonly terminalAccess?: boolean;
};

/**
 * The normalized shape every ecosystem's results are mapped into for federated search,
 * ranking, and display - `metadata` preserves whatever source-specific fields don't fit the
 * common shape (a per-ecosystem detail pane reads its own known keys back out of it; nothing
 * is erased to fit this model, per the mission's explicit requirement).
 */
export type MarketplaceItem = {
	/** stable within its provider - `${providerId}:${id}` is used as the federated-search dedup/list key */
	readonly id: string;
	readonly providerId: string;
	readonly type: MarketplaceItemType;
	readonly name: string;
	readonly description: string;
	/** human-readable ecosystem label for the UI badge, e.g. "Open VSX", "Agent Skill", "MCP Server" */
	readonly source: string;
	readonly publisher?: string;
	readonly version?: string;
	/** e.g. a version-range or platform note; free text since ecosystems express this differently */
	readonly compatibility?: string;
	readonly trust: MarketplaceTrust;
	readonly installed: boolean;
	readonly enabled?: boolean;
	/** short capability tags for search relevance/filtering, not a full manifest */
	readonly capabilities?: string[];
	readonly installMethod: MarketplaceInstallMethod;
	readonly security?: MarketplaceSecurityInfo;
	/**
	 * true when this item is already present/usable on this machine without any network
	 * action (a local Jupyter kernel, an already-installed extension) - the UI shows
	 * "Local/Available" for these rather than a misleading "Install" that would suggest a
	 * download is needed.
	 */
	readonly isLocal?: boolean;
	/** ecosystem-specific fields the common shape above doesn't capture - never erased */
	readonly metadata: Record<string, unknown>;
};

export type MarketplaceSearchOptions = {
	/** restrict federated search to these item types; omit/empty = all */
	types?: MarketplaceItemType[];
	signal?: AbortSignal;
};

export type MarketplaceProviderSearchOutcome = {
	providerId: string;
	items: MarketplaceItem[];
	/** set when this provider's search failed/timed out - federated search still returns every other provider's results (failure isolation) */
	error?: string;
};

export type MarketplaceSearchResult = {
	items: MarketplaceItem[];
	/** per-provider outcome, so the UI can show "N sources failed" without hiding it */
	providerOutcomes: MarketplaceProviderSearchOutcome[];
};

/**
 * One provider per ecosystem. A provider exposes only the operations its real underlying
 * lifecycle actually supports - `search`/`listInstalled` are the only required methods;
 * every action method is optional, and `IUnifiedMarketplaceService.performAction` checks
 * for the method's existence before calling it rather than forcing every provider to
 * implement a meaningless no-op (per the mission's explicit "don't force meaningless
 * install/update semantics on every provider" requirement).
 */
export interface IMarketplaceProvider {
	readonly id: string;
	readonly displayName: string;
	readonly itemType: MarketplaceItemType;
	/** per-provider cache TTL in ms for search results - caching never applies to install/enable state, which is always read live */
	readonly cacheTtlMs: number;

	search(query: string, token: CancellationToken): Promise<MarketplaceItem[]>;
	/** items already installed/configured/local, shown even with an empty query and used for offline degradation */
	listInstalled(): Promise<MarketplaceItem[]>;

	install?(item: MarketplaceItem): Promise<void>;
	uninstall?(item: MarketplaceItem): Promise<void>;
	update?(item: MarketplaceItem): Promise<void>;
	setEnabled?(item: MarketplaceItem, enabled: boolean): Promise<void>;
	/** for items whose "install" is really "open the thing a human configures" (e.g. reveal mcp.json) */
	configure?(item: MarketplaceItem): Promise<void>;
	connect?(item: MarketplaceItem): Promise<void>;
}

export interface IUnifiedMarketplaceService {
	readonly _serviceBrand: undefined;

	/** each ecosystem's provider registers itself here at construction (same self-registration pattern as IExternalAgentAdapterRegistry.register) */
	registerProvider(provider: IMarketplaceProvider): void;

	/** every registered provider, for the UI's filter chips and diagnostics */
	listProviders(): { id: string; displayName: string; itemType: MarketplaceItemType }[];

	/**
	 * Federated search: queries every registered provider concurrently (each with its own
	 * timeout), isolates per-provider failures, dedupes by `${providerId}:${id}`, and ranks
	 * results - exact-name matches and installed/local items first, then relevance, with
	 * source weighting so a weak Skill keyword match never outranks an exact Open VSX name
	 * match. An empty query returns every provider's `listInstalled()` results instead (so
	 * opening the marketplace isn't a blank page).
	 */
	search(query: string, opts?: MarketplaceSearchOptions): Promise<MarketplaceSearchResult>;

	/** every installed/local/configured item across all providers - used for offline degradation and Capability Bus wiring */
	listInstalled(): Promise<MarketplaceItem[]>;

	performAction(action: Exclude<MarketplaceInstallMethod, null>, item: MarketplaceItem): Promise<void>;

	/**
	 * The agent-facing discovery flow (mission's explicit "task needs capability -> resolver
	 * checks installed/local -> falls to marketplace providers -> ... -> agent continues").
	 * Returns candidates only - never installs anything itself. The Main Agent still goes
	 * through the ordinary tool-approval/Policy Engine gate before `performAction` actually
	 * installs/configures a candidate, so nothing here can silently install arbitrary
	 * executable software - see docs/integrations/marketplace.md.
	 */
	discoverForCapability(query: string): Promise<MarketplaceItem[]>;
}

export const IUnifiedMarketplaceService = createDecorator<IUnifiedMarketplaceService>('vaderUnifiedMarketplaceService');
