/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IExtension, IExtensionsWorkbenchService } from '../../../../extensions/common/extensions.js';
import { EnablementState, IWorkbenchExtensionEnablementService } from '../../../../../services/extensionManagement/common/extensionManagement.js';
import { IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceItem } from '../../../common/marketplace/marketplaceTypes.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// Wraps this codebase's EXISTING extension gallery/workbench services unmodified - every
// operation here (search/install/uninstall/enable/disable/update) delegates directly to
// IExtensionsWorkbenchService, the exact same service backing the untouched, stock VS Code
// Extensions view. This provider adds zero new gallery logic and cannot regress the existing
// Extensions view, since it doesn't change it.
class ExtensionGalleryMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'extension-gallery';
	readonly displayName = 'Extensions';
	readonly itemType = 'EXTENSION' as const;
	readonly cacheTtlMs = 30_000;

	constructor(
		private readonly _extensionsWorkbenchService: IExtensionsWorkbenchService,
		private readonly _enablementService: IWorkbenchExtensionEnablementService,
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

	async search(query: string, token: CancellationToken): Promise<MarketplaceItem[]> {
		const pager = await this._extensionsWorkbenchService.queryGallery({ text: query, pageSize: 25 }, token);
		return pager.firstPage.map(ext => this._toItem(ext));
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
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new ExtensionGalleryMarketplaceProvider(extensionsWorkbenchService, enablementService));
	}
}

registerWorkbenchContribution2(ExtensionGalleryMarketplaceProviderContribution.ID, ExtensionGalleryMarketplaceProviderContribution, WorkbenchPhase.BlockRestore);
