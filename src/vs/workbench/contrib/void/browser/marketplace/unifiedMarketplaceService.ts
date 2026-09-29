/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { LRUCache } from '../../../../../base/common/map.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import {
	IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceInstallMethod, MarketplaceItem,
	MarketplaceItemType, MarketplaceProviderSearchOutcome, MarketplaceSearchOptions, MarketplaceSearchResult,
} from '../../common/marketplace/marketplaceTypes.js';

export * from '../../common/marketplace/marketplaceTypes.js';

// Vader addition, part of the Unified Capability Marketplace (see docs/integrations/marketplace.md).
// Per-provider search timeout - a slow/hung network source must never hold up the other
// providers' results (failure isolation, not just error isolation).
const PROVIDER_SEARCH_TIMEOUT_MS = 8_000;

// Soft per-type weighting used only to break ties among non-exact matches (see search()'s
// scoring) - never overrides an exact name match or installed/local status from a
// lower-weighted type, per the mission's explicit "a weak Skill match must never outrank an
// exact Open VSX name match" example: that example is about *exactness*, not raw type
// preference, so this weighting is a small tiebreaker, not a ranking override.
const TYPE_RELEVANCE_WEIGHT: Record<MarketplaceItemType, number> = {
	EXTENSION: 5,
	MCP_SERVER: 4,
	LANGUAGE_SERVER: 4,
	DEBUG_ADAPTER: 4,
	ACP_AGENT: 3,
	FORMATTER: 3,
	SKILL: 2,
	JUPYTER_KERNEL: 2,
	TREE_SITTER_GRAMMAR: 1,
};

type CacheEntry = { atMs: number; items: MarketplaceItem[] };

// Vader fix, part of the final production-readiness pass's cache-bounding work. This was a
// plain `Map` keyed by `${providerId}::${query}` for every distinct search string a user ever
// typed across the marketplace's lifetime - the per-entry TTL (`provider.cacheTtlMs`) only ever
// made an entry stale, it never removed it, so every unique query (including typo-by-typo
// incremental-search strings, which this UI issues one per keystroke) accumulated forever.
// `LRUCache` (base/common/map.js) is VS Code's own bounded LRU map, already used elsewhere in
// this codebase. 300 comfortably covers realistic incremental-search + provider-count churn in
// one session while still being an actual bound.
const MAX_CACHED_SEARCHES = 300;

class UnifiedMarketplaceService extends Disposable implements IUnifiedMarketplaceService {
	readonly _serviceBrand: undefined;

	private readonly _providers = new Map<string, IMarketplaceProvider>();
	private readonly _cache = new LRUCache<string, CacheEntry>(MAX_CACHED_SEARCHES); // key: `${providerId}::${query}`
	private _searchGeneration = 0;

	/** Providers register themselves here at construction (see each providerXyz.ts's registerSingleton side effect + this file's own registration order in void.contribution.ts) - same self-registration pattern this codebase already uses for tool/skill registries. */
	registerProvider(provider: IMarketplaceProvider): void {
		this._providers.set(provider.id, provider);
	}

	listProviders() {
		return [...this._providers.values()].map(p => ({ id: p.id, displayName: p.displayName, itemType: p.itemType }));
	}

	private _cacheKey(providerId: string, query: string): string { return `${providerId}::${query}`; }

	private async _searchOneProvider(provider: IMarketplaceProvider, query: string, generation: number): Promise<MarketplaceProviderSearchOutcome> {
		const cacheKey = this._cacheKey(provider.id, query);
		const cached = this._cache.get(cacheKey);
		if (cached && Date.now() - cached.atMs < provider.cacheTtlMs) {
			return { providerId: provider.id, items: cached.items };
		}

		const cts = new CancellationTokenSource();
		const timeoutHandle = setTimeout(() => cts.cancel(), PROVIDER_SEARCH_TIMEOUT_MS);
		try {
			const items = query.trim()
				? await provider.search(query, cts.token)
				: await provider.listInstalled();
			// a slower provider that finishes after a newer search has already started still
			// gets its result cached (so the next search benefits), but is not returned here -
			// _searchGeneration is checked by the caller, not here, to keep this function pure
			this._cache.set(cacheKey, { atMs: Date.now(), items });
			return { providerId: provider.id, items };
		} catch (e) {
			// per-provider failure isolation: one dead/offline source degrades to "0 results,
			// error noted," never breaks the whole federated search - offline degradation and
			// per-provider error surfacing are the same mechanism here, by design.
			return { providerId: provider.id, items: cached?.items ?? [], error: e instanceof Error ? e.message : String(e) };
		} finally {
			clearTimeout(timeoutHandle);
			cts.dispose();
		}
	}

	private _score(item: MarketplaceItem, queryLower: string): number {
		const nameLower = item.name.toLowerCase();
		let score = 0;
		if (queryLower && nameLower === queryLower) score += 1000; // exact name match - see TYPE_RELEVANCE_WEIGHT's doc comment
		else if (queryLower && nameLower.startsWith(queryLower)) score += 300;
		else if (queryLower && nameLower.includes(queryLower)) score += 100;
		else if (queryLower && item.description.toLowerCase().includes(queryLower)) score += 20;
		if (item.installed || item.isLocal) score += 150;
		score += TYPE_RELEVANCE_WEIGHT[item.type] ?? 0;
		return score;
	}

	async search(query: string, opts?: MarketplaceSearchOptions): Promise<MarketplaceSearchResult> {
		const generation = ++this._searchGeneration;
		const queryLower = query.trim().toLowerCase();

		const providers = [...this._providers.values()].filter(p => !opts?.types?.length || opts.types.includes(p.itemType));
		const outcomes = await Promise.all(providers.map(p => this._searchOneProvider(p, query, generation)));

		// cancel-stale-searches: if a newer search started while this one was in flight, don't
		// let its (possibly out-of-order) results overwrite what the UI is now showing.
		if (generation !== this._searchGeneration) {
			return { items: [], providerOutcomes: [] };
		}

		const seen = new Set<string>();
		const items: MarketplaceItem[] = [];
		for (const outcome of outcomes) {
			for (const item of outcome.items) {
				const key = `${item.providerId}:${item.id}`;
				if (seen.has(key)) continue; // dedup across providers that might surface the same underlying thing
				seen.add(key);
				items.push(item);
			}
		}
		items.sort((a, b) => this._score(b, queryLower) - this._score(a, queryLower));

		return { items, providerOutcomes: outcomes };
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		const perProvider = await Promise.all([...this._providers.values()].map(async p => {
			try { return await p.listInstalled(); } catch { return []; }
		}));
		return perProvider.flat();
	}

	async performAction(action: Exclude<MarketplaceInstallMethod, null>, item: MarketplaceItem): Promise<void> {
		const provider = this._providers.get(item.providerId);
		if (!provider) throw new Error(`Unknown marketplace provider "${item.providerId}" for item "${item.name}".`);
		const fn = ({
			install: provider.install, uninstall: provider.uninstall, update: provider.update,
			configure: provider.configure, connect: provider.connect,
			enable: provider.setEnabled ? (i: MarketplaceItem) => provider.setEnabled!(i, true) : undefined,
			disable: provider.setEnabled ? (i: MarketplaceItem) => provider.setEnabled!(i, false) : undefined,
			// 'add'/'download'/'use_local'/'review_and_install' are per-provider-specific labels
			// for what is, mechanically, an install - providers that use these labels implement
			// `install` and this maps them onto it, rather than forcing five near-duplicate methods.
			add: provider.install, download: provider.install, use_local: provider.install, review_and_install: provider.install,
		} satisfies Record<Exclude<MarketplaceInstallMethod, null>, ((i: MarketplaceItem) => Promise<void>) | undefined>)[action];
		if (!fn) throw new Error(`Marketplace provider "${provider.displayName}" does not support the "${action}" action for "${item.name}".`);
		await fn(item);
	}

	async discoverForCapability(query: string): Promise<MarketplaceItem[]> {
		// Deliberately reuses ordinary federated search rather than a separate index - "checks
		// installed/local first" falls out of the ranking (installed/local items score higher),
		// and "falls to marketplace providers" is simply the rest of the ranked list. This
		// method exists as its own named entry point (rather than agents calling search()
		// directly) so the one real gate - Policy/approval before performAction actually
		// installs anything - has a single, clearly-named call site to audit.
		const result = await this.search(query);
		return result.items;
	}
}

registerSingleton(IUnifiedMarketplaceService, UnifiedMarketplaceService, InstantiationType.Delayed);
