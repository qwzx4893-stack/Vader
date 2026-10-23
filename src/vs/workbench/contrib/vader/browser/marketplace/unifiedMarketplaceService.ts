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
const PROVIDER_SEARCH_TIMEOUT_MS = 15_000;
const PROVIDER_BROWSE_TIMEOUT_MS = 30_000;

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

type CacheEntry = { atMs: number; items: MarketplaceItem[]; /** what did not answer when this was read: said again whenever the answer is served from here */ warnings?: string[] };
/** an answer that was missing a source is kept only briefly, so the source is asked again soon */
const PARTIAL_ANSWER_TTL_MS = 15_000;
const isFresh = (c: CacheEntry | undefined, ttlMs: number): boolean => !!c && Date.now() - c.atMs < (c.warnings?.length ? Math.min(ttlMs, PARTIAL_ANSWER_TTL_MS) : ttlMs);

// Vader fix, part of the final production-readiness pass's cache-bounding work. This was a
// plain `Map` keyed by `${providerId}::${query}` for every distinct search string a user ever
// typed across the marketplace's lifetime - the per-entry TTL (`provider.cacheTtlMs`) only ever
// made an entry stale, it never removed it, so every unique query (including typo-by-typo
// incremental-search strings, which this UI issues one per keystroke) accumulated forever.
// `LRUCache` (base/common/map.js) is VS Code's own bounded LRU map, already used elsewhere in
// this codebase. 300 comfortably covers realistic incremental-search + provider-count churn in
// one session while still being an actual bound.
const MAX_CACHED_SEARCHES = 300;

export class UnifiedMarketplaceService extends Disposable implements IUnifiedMarketplaceService {
	readonly _serviceBrand: undefined;

	private readonly _providers = new Map<string, IMarketplaceProvider>();
	private readonly _cache = new LRUCache<string, CacheEntry>(MAX_CACHED_SEARCHES); // key: `${providerId}::${query}`

	/** Providers register themselves here at construction (see each providerXyz.ts's registerSingleton side effect + this file's own registration order in vader.contribution.ts) - same self-registration pattern this codebase already uses for tool/skill registries. */
	registerProvider(provider: IMarketplaceProvider): void {
		this._providers.set(provider.id, provider);
	}

	listProviders() {
		return [...this._providers.values()].map(p => ({ id: p.id, displayName: p.displayName, itemType: p.itemType }));
	}

	private _cacheKey(providerId: string, query: string): string { return `${providerId}::${query}`; }

	private _requestKey(provider: IMarketplaceProvider, query: string, browse: boolean, opts?: MarketplaceSearchOptions): string {
		return this._cacheKey(provider.id, JSON.stringify([browse, query.trim().toLowerCase(), opts?.category, opts?.cacheScope]));
	}

	private async _queryProvider(provider: IMarketplaceProvider, query: string, browse: boolean, opts?: MarketplaceSearchOptions): Promise<MarketplaceProviderSearchOutcome> {
		const cacheKey = this._requestKey(provider, query, browse, opts);
		const cached = this._cache.get(cacheKey);
		if (!opts?.refresh && cached && isFresh(cached, provider.cacheTtlMs)) {
			return { providerId: provider.id, items: cached.items, warnings: cached.warnings, cachedAtMs: cached.atMs };
		}

		const cts = new CancellationTokenSource();
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		let abort: (() => void) | undefined;
		try {
			// Race the call as well as cancelling its token: providers/IPC calls may ignore cancellation.
			const deadline = new Promise<never>((_, reject) => {
				abort = () => { cts.cancel(); reject(new Error('Search cancelled')); };
				if (opts?.signal?.aborted) { abort(); return; }
				opts?.signal?.addEventListener('abort', abort, { once: true });
				timeoutHandle = setTimeout(() => { cts.cancel(); reject(new Error('took too long to answer')); }, browse ? PROVIDER_BROWSE_TIMEOUT_MS : PROVIDER_SEARCH_TIMEOUT_MS);
			});
			const request = Promise.resolve().then(() => {
				if (cts.token.isCancellationRequested) throw new Error('Search cancelled');
				return browse ? (provider.browse ? provider.browse(cts.token, opts?.category) : provider.listInstalled())
					: query.trim() ? provider.search(query, cts.token, opts?.category) : provider.listInstalled();
			});
			let items = await Promise.race([request, deadline]);
			if (opts?.signal?.aborted) throw new Error('Search cancelled');
			const warnings = provider.takeWarnings?.(cts.token);
			// Keep previously read remote rows when a source is down, together with current local state.
			if (warnings?.length && cached) {
				const merged = new Map<string, MarketplaceItem>(cached.items.map(i => [i.id, i]));
				for (const item of items) merged.set(item.id, item);
				items = [...merged.values()];
				return { providerId: provider.id, items, warnings, cachedAtMs: cached.atMs, stale: true };
			}
			this._cache.set(cacheKey, { atMs: Date.now(), items, warnings });
			return { providerId: provider.id, items, warnings };
		} catch (e) {
			// per-provider failure isolation: one dead/offline source degrades to "0 results,
			// error noted," never breaks the whole federated search - offline degradation and
			// per-provider error surfacing are the same mechanism here, by design.
			return { providerId: provider.id, items: cached?.items ?? [], error: e instanceof Error ? e.message : String(e), cachedAtMs: cached?.atMs, stale: !!cached };
		} finally {
			clearTimeout(timeoutHandle);
			if (abort) opts?.signal?.removeEventListener('abort', abort);
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
		return this._query(query, false, opts);
	}

	private _result(outcomes: MarketplaceProviderSearchOutcome[], query: string, browse: boolean): MarketplaceSearchResult {
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
		items.sort(browse ? (a, b) => (Number(b.installed) - Number(a.installed)) || ((b.trustScore?.score ?? -1) - (a.trustScore?.score ?? -1))
			: (a, b) => this._score(b, query.trim().toLowerCase()) - this._score(a, query.trim().toLowerCase()));

		return { items, providerOutcomes: outcomes };
	}

	async browse(opts?: MarketplaceSearchOptions): Promise<MarketplaceSearchResult> {
		return this._query('', true, opts);
	}

	private async _query(query: string, browse: boolean, opts?: MarketplaceSearchOptions): Promise<MarketplaceSearchResult> {
		const providers = [...this._providers.values()].filter(p => !opts?.types?.length || opts.types.includes(p.itemType));
		const outcomes = new Map<string, MarketplaceProviderSearchOutcome>();
		const result = () => this._result(providers.flatMap(p => outcomes.has(p.id) ? [outcomes.get(p.id)!] : []), query, browse);
		// Saved results can be displayed immediately while expired entries are refreshed.
		for (const p of providers) {
			const cached = this._cache.get(this._requestKey(p, query, browse, opts));
			if (cached) outcomes.set(p.id, { providerId: p.id, items: cached.items, warnings: cached.warnings, cachedAtMs: cached.atMs, stale: !isFresh(cached, p.cacheTtlMs) });
		}
		if (!opts?.signal?.aborted && outcomes.size) opts?.onProgress?.(result());
		await Promise.all(providers.map(async p => {
			const outcome = await this._queryProvider(p, query, browse, opts);
			outcomes.set(p.id, outcome);
			if (!opts?.signal?.aborted) opts?.onProgress?.(result());
		}));
		return result();
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		const perProvider = await Promise.all([...this._providers.values()].map(async p => {
			try { return await p.listInstalled(); } catch { return []; }
		}));
		return perProvider.flat();
	}

	async refine(item: MarketplaceItem): Promise<MarketplaceItem> {
		const provider = this._providers.get(item.providerId);
		if (!provider?.refine) return item;
		try { return await provider.refine(item); } catch { return item; }
	}

	async performAction(action: Exclude<MarketplaceInstallMethod, null>, item: MarketplaceItem): Promise<void> {
		const provider = this._providers.get(item.providerId);
		if (!provider) throw new Error(`Unknown marketplace provider "${item.providerId}" for item "${item.name}".`);
		// bound to the provider: these are methods of a class that read its own fields (this._skillService, this._mcpService), and a method taken off
		// its object and called on its own has no this
		const own = (f: ((i: MarketplaceItem) => Promise<void>) | undefined) => f?.bind(provider);
		const fn = ({
			install: own(provider.install), uninstall: own(provider.uninstall), update: own(provider.update),
			configure: own(provider.configure), connect: own(provider.connect),
			enable: provider.setEnabled ? (i: MarketplaceItem) => provider.setEnabled!(i, true) : undefined,
			disable: provider.setEnabled ? (i: MarketplaceItem) => provider.setEnabled!(i, false) : undefined,
			// 'add'/'download'/'use_local'/'review_and_install' are per-provider-specific labels
			// for what is, mechanically, an install - providers that use these labels implement
			// `install` and this maps them onto it, rather than forcing five near-duplicate methods.
			add: own(provider.install), download: own(provider.install), use_local: own(provider.install), review_and_install: own(provider.install),
		} satisfies Record<Exclude<MarketplaceInstallMethod, null>, ((i: MarketplaceItem) => Promise<void>) | undefined>)[action];
		if (!fn) throw new Error(`Marketplace provider "${provider.displayName}" does not support the "${action}" action for "${item.name}".`);
		try {
			await fn(item);
		} finally {
			// what an action changes (installed, switched on) is read live, so the answers kept for this provider are dropped: a list shown right after must not be the old one
			for (const key of [...this._cache.keys()]) { if (key.startsWith(`${provider.id}::`)) { this._cache.delete(key); } }
		}
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
