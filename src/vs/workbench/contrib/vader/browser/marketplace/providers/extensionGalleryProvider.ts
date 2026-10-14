/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IExtension, IExtensionsWorkbenchService } from '../../../../extensions/common/extensions.js';
import { EnablementState, IWorkbenchExtensionEnablementService } from '../../../../../services/extensionManagement/common/extensionManagement.js';
import { SortBy } from '../../../../../../platform/extensionManagement/common/extensionManagement.js';
import { IMarketplaceProvider, ItemFact, IUnifiedMarketplaceService, MarketplaceItem } from '../../../common/marketplace/marketplaceTypes.js';
import { IDiscoveryMainService, OpenVsxResult } from '../../../common/discovery/discoveryServiceTypes.js';
import { categoryOf, classify } from '../../../common/marketplace/categories.js';
import { computeTrust } from '../../../common/marketplace/trustScore.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// Wraps this codebase's EXISTING extension gallery/workbench services unmodified - every
// operation here (search/install/uninstall/enable/disable/update) delegates directly to
// IExtensionsWorkbenchService, the exact same service backing the untouched, stock VS Code
// Extensions view. This provider adds zero new gallery logic and cannot regress the existing
// Extensions view, since it doesn't change it.
export class ExtensionGalleryMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'extension-gallery';
	readonly displayName = 'Extensions';
	readonly itemType = 'EXTENSION' as const;
	readonly cacheTtlMs = 30_000;

	constructor(
		private readonly _extensionsWorkbenchService: IExtensionsWorkbenchService,
		private readonly _enablementService: IWorkbenchExtensionEnablementService,
		private readonly _discoveryService: IDiscoveryMainService,
	) { }

	private _toItem(ext: IExtension): MarketplaceItem {
		const installed = ext.local !== undefined;
		return {
			id: ext.identifier.id,
			providerId: this.id,
			type: 'EXTENSION',
			name: ext.displayName || ext.name,
			description: ext.description,
			source: 'Open VSX / Extension Gallery',
			publisher: ext.publisherDisplayName || ext.publisher,
			version: ext.version,
			// this build's actual gallery endpoint (product.json's extensionsGallery.serviceUrl)
			// may be the Microsoft Marketplace or Open VSX depending on configuration - this
			// provider is gallery-endpoint-agnostic, same as the service it wraps.
			trust: ext.isMalicious ? 'blocked' : 'unknown',
			installed,
			trustScore: computeTrust({ kind: 'extension', publisher: ext.publisher, publisherVerified: !!ext.publisherDomain?.verified, installs: ext.installCount, rating: ext.rating, ratingCount: ext.ratingCount, flaggedMalicious: ext.isMalicious }),
			enabled: installed ? this._enablementService.isEnabled(ext.local!) : undefined,
			capabilities: [...ext.categories, ...ext.tags].slice(0, 10),
			installMethod: ext.isMalicious ? null : installed ? (ext.outdated ? 'update' : null) : 'install',
			security: {
				source: ext.repository || ext.url || 'extension gallery',
				publisher: ext.publisher,
				version: ext.version,
				repositoryUrl: ext.repository,
				executesCode: true, // every VS Code extension can run arbitrary extension-host code
			},
			metadata: {
				categories: classify('extension', { name: ext.displayName || ext.name, description: ext.description, tags: ext.tags, sourceCategories: ext.categories }),
				facts: [
					{ label: 'Publisher', value: `${ext.publisherDisplayName || ext.publisher}${ext.publisherDomain?.verified ? ' (verified)' : ''}` },
					{ label: 'Version', value: ext.version },
					...(ext.installCount ? [{ label: 'Installs', value: ext.installCount.toLocaleString('en-US') }] : []),
					...(ext.rating ? [{ label: 'Rating', value: `${ext.rating.toFixed(1)} of 5 (${ext.ratingCount ?? 0})` }] : []),
					{ label: 'Identifier', value: ext.identifier.id },
					...(ext.repository ? [{ label: 'Repository', value: ext.repository.replace('https://github.com/', ''), href: ext.repository }] : []),
				] as ItemFact[],
				identifier: ext.identifier.id,
				isBuiltin: ext.isBuiltin,
				installCount: ext.installCount,
				rating: ext.rating,
				contributesLanguages: !!ext.local?.manifest?.contributes?.languages?.length,
				contributesDebuggers: !!ext.local?.manifest?.contributes?.debuggers?.length,
				contributesGrammars: !!ext.local?.manifest?.contributes?.grammars?.length,
			},
		};
	}

	async search(query: string, token: CancellationToken, category?: string): Promise<MarketplaceItem[]> {
		try {
			const items = await this._openVsxItems(query, category, 'relevance');
			if (items.length > 0 || category) return items;
		} catch { /* fall back to the gallery */ }
		const pager = await this._extensionsWorkbenchService.queryGallery({ text: query, pageSize: 25 }, token);
		return pager.firstPage.map(ext => this._toItem(ext));
	}

	private _openVsxToItem(r: OpenVsxResult, installedIds: ReadonlySet<string>, sectionId?: string): MarketplaceItem {
		const installed = installedIds.has(r.id.toLowerCase());
		const sections = classify('extension', { name: r.displayName, description: r.description });
		return {
			id: r.id,
			providerId: this.id,
			type: 'EXTENSION',
			name: r.displayName,
			description: r.description,
			source: 'Open VSX',
			publisher: r.publisher,
			version: r.version,
			trust: r.deprecated ? 'blocked' : 'unknown',
			installed,
			trustScore: computeTrust({ kind: 'extension', name: r.displayName, publisher: r.publisher, publisherVerified: r.verified, installs: r.downloads, rating: r.rating, ratingCount: r.ratingCount, deprecated: r.deprecated || undefined, pushedAt: r.updatedAt }),
			installMethod: r.deprecated || installed ? null : 'install',
			security: { source: `https://open-vsx.org/extension/${r.id.replace('.', '/')}`, publisher: r.publisher, version: r.version, executesCode: true },
			metadata: {
				identifier: r.id, iconUrl: r.iconUrl, categories: sectionId ? [sectionId, ...sections.filter(s => s !== sectionId)].slice(0, 2) : sections,
				rating: r.rating, ratingCount: r.ratingCount, installCount: r.downloads, updatedAt: r.updatedAt,
				facts: [
					{ label: 'Publisher', value: `${r.publisher}${r.verified ? ' (verified)' : ''}`, href: `https://open-vsx.org/namespace/${r.publisher}` },
					{ label: 'Version', value: r.version },
					{ label: 'Installs', value: r.downloads.toLocaleString('en-US') },
					...(r.rating ? [{ label: 'Rating', value: `${r.rating.toFixed(1)} of 5 (${r.ratingCount})` }] : []),
					...(r.updatedAt ? [{ label: 'Last updated', value: r.updatedAt.slice(0, 10) }] : []),
					{ label: 'Identifier', value: r.id },
					{ label: 'Open VSX page', value: r.id.replace('.', '/'), href: `https://open-vsx.org/extension/${r.id.replace('.', '/')}` },
				] as ItemFact[],
			},
		};
	}

	private async _openVsxItems(query: string, category: string | undefined, sortBy: 'downloadCount' | 'rating' | 'timestamp' | 'relevance'): Promise<MarketplaceItem[]> {
		const cat = category ? categoryOf('extension', category) : undefined;
		const [found, local] = await Promise.all([this._discoveryService.searchOpenVsx(query, cat?.openVsx, sortBy), this._extensionsWorkbenchService.queryLocal().catch(() => [])]);
		const installedIds = new Set(local.map(l => l.identifier.id.toLowerCase()));
		return found.filter(r => !r.deprecated).map(r => this._openVsxToItem(r, installedIds, cat?.id));
	}

	/** the most installed extensions of the gallery, with the installed ones first, for the page a person sees before they search */
	async browse(token: CancellationToken, category?: string): Promise<MarketplaceItem[]> {
		const local = category ? [] : await this.listInstalled();
		// Open VSX asked directly gives its own sections and the numbers behind the score; the editor's gallery is the fallback if it does not answer
		try {
			const items = await this._openVsxItems('', category, 'downloadCount');
			if (items.length > 0 || category) {
				const seen = new Set(local.map(i => i.id.toLowerCase()));
				return [...local, ...items.filter(i => !seen.has(i.id.toLowerCase()))];
			}
		} catch { /* fall back to the gallery */ }
		const pager = await this._extensionsWorkbenchService.queryGallery({ text: '', sortBy: SortBy.InstallCount, pageSize: 30 }, token);
		const seen = new Set(local.map(i => i.id));
		return [...local, ...pager.firstPage.map(ext => this._toItem(ext)).filter(i => !seen.has(i.id))];
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		const local = await this._extensionsWorkbenchService.queryLocal();
		return local.filter(ext => !ext.isBuiltin).map(ext => this._toItem(ext));
	}

	async install(item: MarketplaceItem): Promise<void> {
		await this._extensionsWorkbenchService.install(String(item.metadata.identifier ?? item.id));
	}

	async uninstall(item: MarketplaceItem): Promise<void> {
		const ext = this._extensionsWorkbenchService.local.find(l => l.identifier.id === item.id);
		if (ext) await this._extensionsWorkbenchService.uninstall(ext);
	}

	async update(item: MarketplaceItem): Promise<void> {
		await this.install(item); // installing the same id again fetches the latest version - same as the existing UpdateAction
	}

	async setEnabled(item: MarketplaceItem, enabled: boolean): Promise<void> {
		const ext = this._extensionsWorkbenchService.local.find(l => l.identifier.id === item.id);
		if (ext) await this._extensionsWorkbenchService.setEnablement(ext, enabled ? EnablementState.EnabledGlobally : EnablementState.DisabledGlobally);
	}
}

// Same pattern as vaderNativeExternalAgentAdapter.ts's registration contribution: a plain
// workbench contribution whose only job is registering something into a registry, run once
// the workbench is ready.
class ExtensionGalleryMarketplaceProviderContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.extensionGalleryMarketplaceProvider';

	constructor(
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IWorkbenchExtensionEnablementService enablementService: IWorkbenchExtensionEnablementService,
		@IDiscoveryMainService discoveryService: IDiscoveryMainService,
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new ExtensionGalleryMarketplaceProvider(extensionsWorkbenchService, enablementService, discoveryService));
	}
}

registerWorkbenchContribution2(ExtensionGalleryMarketplaceProviderContribution.ID, ExtensionGalleryMarketplaceProviderContribution, WorkbenchPhase.BlockRestore);
