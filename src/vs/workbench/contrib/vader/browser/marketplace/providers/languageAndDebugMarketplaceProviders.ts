/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IExtension, IExtensionsWorkbenchService } from '../../../../extensions/common/extensions.js';
import { IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceItem, MarketplaceItemType } from '../../../common/marketplace/marketplaceTypes.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
//
// LSP/DAP semantic note (per the mission's explicit warning): there is no universal, real
// registry of standalone language servers or debug adapters to search - inventing one would
// be exactly what the mission says not to do. What genuinely exists and is queryable is the
// same extension gallery ExtensionGalleryMarketplaceProvider already wraps: VS Code
// extensions self-declare a "Programming Languages"/"Debuggers" category, and installed
// extensions' manifests declare `contributes.languages`/`contributes.debuggers` (both real,
// already-present fields in this codebase's IExtension/IExtensionManifest types - nothing
// invented here). These two providers filter the SAME gallery to those two real, existing
// signals and tag results with the LANGUAGE_SERVER/DEBUG_ADAPTER item type instead of
// EXTENSION, so a marketplace search clearly distinguishes "this is a language server" from
// "this is a generic extension" - install/uninstall/enable still delegate to the identical
// IExtensionsWorkbenchService calls ExtensionGalleryMarketplaceProvider uses, so there is
// exactly one install path, not a duplicate one. No standalone (non-extension) language
// server or debug adapter source was found or verified in this session, so only the
// Open-VSX-delivered path is implemented - stated here rather than glossed over.
abstract class ExtensionCategoryMarketplaceProvider implements IMarketplaceProvider {
	abstract readonly id: string;
	abstract readonly displayName: string;
	abstract readonly itemType: MarketplaceItemType;
	readonly cacheTtlMs = 30_000;

	protected abstract matchesCategory(ext: IExtension): boolean;
	protected abstract matchesManifest(ext: IExtension): boolean;

	constructor(protected readonly _extensionsWorkbenchService: IExtensionsWorkbenchService) { }

	private _toItem(ext: IExtension): MarketplaceItem {
		const installed = ext.local !== undefined;
		return {
			id: ext.identifier.id,
			providerId: this.id,
			type: this.itemType,
			name: ext.displayName || ext.name,
			description: ext.description,
			source: 'Open VSX / Extension Gallery',
			publisher: ext.publisherDisplayName || ext.publisher,
			version: ext.version,
			trust: ext.isMalicious ? 'blocked' : 'unknown',
			installed,
			capabilities: [...ext.categories],
			installMethod: ext.isMalicious ? null : installed ? null : 'install',
			security: { source: ext.repository || ext.url || 'extension gallery', publisher: ext.publisher, version: ext.version, repositoryUrl: ext.repository, executesCode: true },
			metadata: { identifier: ext.identifier.id, deliveredVia: 'open-vsx-extension' },
		};
	}

	async search(query: string, token: CancellationToken): Promise<MarketplaceItem[]> {
		const pager = await this._extensionsWorkbenchService.queryGallery({ text: query, pageSize: 25 }, token);
		return pager.firstPage.filter(ext => this.matchesCategory(ext)).map(ext => this._toItem(ext));
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		const local = await this._extensionsWorkbenchService.queryLocal();
		return local.filter(ext => !ext.isBuiltin && (this.matchesCategory(ext) || this.matchesManifest(ext))).map(ext => this._toItem(ext));
	}

	async install(item: MarketplaceItem): Promise<void> {
		await this._extensionsWorkbenchService.install(String(item.metadata.identifier ?? item.id));
	}

	async uninstall(item: MarketplaceItem): Promise<void> {
		const ext = this._extensionsWorkbenchService.local.find(l => l.identifier.id === item.id);
		if (ext) await this._extensionsWorkbenchService.uninstall(ext);
	}
}

class LanguageServerMarketplaceProvider extends ExtensionCategoryMarketplaceProvider {
	readonly id = 'language-servers';
	readonly displayName = 'Language Servers';
	readonly itemType = 'LANGUAGE_SERVER' as const;
	protected matchesCategory(ext: IExtension): boolean { return ext.categories.includes('Programming Languages'); }
	protected matchesManifest(ext: IExtension): boolean { return !!ext.local?.manifest?.contributes?.languages?.length; }
}

class DebugAdapterMarketplaceProvider extends ExtensionCategoryMarketplaceProvider {
	readonly id = 'debug-adapters';
	readonly displayName = 'Debug Adapters';
	readonly itemType = 'DEBUG_ADAPTER' as const;
	protected matchesCategory(ext: IExtension): boolean { return ext.categories.includes('Debuggers'); }
	protected matchesManifest(ext: IExtension): boolean { return !!ext.local?.manifest?.contributes?.debuggers?.length; }
}

class LanguageAndDebugMarketplaceProvidersContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.languageAndDebugMarketplaceProviders';

	constructor(
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new LanguageServerMarketplaceProvider(extensionsWorkbenchService));
		marketplaceService.registerProvider(new DebugAdapterMarketplaceProvider(extensionsWorkbenchService));
	}
}

registerWorkbenchContribution2(LanguageAndDebugMarketplaceProvidersContribution.ID, LanguageAndDebugMarketplaceProvidersContribution, WorkbenchPhase.BlockRestore);
