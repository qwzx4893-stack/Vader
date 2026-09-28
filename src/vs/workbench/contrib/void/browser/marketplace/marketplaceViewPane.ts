/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Registry } from '../../../../../platform/registry/common/platform.js';
import {
	Extensions as ViewContainerExtensions, IViewContainersRegistry,
	IViewsRegistry, Extensions as ViewExtensions, IViewDescriptorService,
} from '../../../../common/views.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IViewPaneOptions, ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { VIEWLET_ID } from '../../../extensions/common/extensions.js';
import { mountMarketplace } from '../react/out/void-marketplace-tsx/index.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
//
// Adds ONE additive view pane to the EXISTING Extensions view container - it does not touch
// extensionsViewlet.ts/extensionsViews.ts/extensionsList.ts/extensionEditor.ts at all, so the
// native Open VSX search/install/uninstall/enable-disable/update/details flow this pass must
// leave unregressed is untouched by construction, not by care alone. `show(query, refresh)`
// mirrors the signature `ExtensionsViewPaneContainer.doSearch()` calls on every pane in the
// container (`this.panes.map(view => (<ExtensionsListView>view).show(query, refresh))`,
// wrapped in `Promise.all`) - implementing it is required so this pane doesn't throw and
// break that Promise.all for every OTHER pane too. It is therefore written defensively:
// never throws, always resolves, and the actual async search work happens inside the
// mounted React component (Marketplace.tsx) via its own props-driven effect, not here.
class MarketplaceViewPane extends ViewPane {

	private _rerender: ((props?: any) => void) | undefined;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService)
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		parent.style.userSelect = 'text';
		this.instantiationService.invokeFunction(accessor => {
			const mounted = mountMarketplace(parent, accessor, { query: '' });
			this._rerender = mounted?.rerender;
			this._register(toDisposable(() => mounted?.dispose?.()));
		});
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.element.style.height = `${height}px`;
		this.element.style.width = `${width}px`;
	}

	/** Called by ExtensionsViewPaneContainer.doSearch() on every pane in the container - see this class's own doc comment above for why this must never throw. */
	async show(query: string): Promise<void> {
		try {
			// strips the native views' own filter tokens (@sort:, @category:, @installed, ...)
			// so they don't pollute this pane's plain-text federated search
			const plainQuery = (query ?? '').replace(/@\S+/g, '').trim();
			this._rerender?.({ query: plainQuery });
		} catch (e) {
			console.error('Vader marketplace pane: show() failed (non-fatal)', e);
		}
	}
}

class MarketplaceViewPaneContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.marketplaceViewPane';

	constructor() {
		// Deliberately deferred to a workbench-contribution constructor (run at
		// WorkbenchPhase.BlockRestore, after every contrib module's own top-level
		// registration code - including extensions.contribution.ts's - has already executed)
		// rather than done at this module's top level, since the Extensions container must
		// already be registered for `.get(VIEWLET_ID)` below to find it.
		const container = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).get(VIEWLET_ID);
		if (!container) {
			// Defensive, not expected: if the Extensions container isn't found (e.g. this
			// codebase's contribution load order changes in the future), skip adding this
			// pane rather than throwing and risking the rest of workbench startup.
			console.error('Vader marketplace pane: could not find the Extensions view container - skipping registration.');
			return;
		}
		Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
			id: 'workbench.view.extensions.vaderMarketplace',
			name: { value: 'Unified Capability Marketplace', original: 'Unified Capability Marketplace' },
			ctorDescriptor: new SyncDescriptor(MarketplaceViewPane),
			canToggleVisibility: true,
			canMoveView: false,
			weight: 20, // below the native Marketplace/Installed panes
			order: 100,
		}], container);
	}
}

registerWorkbenchContribution2(MarketplaceViewPaneContribution.ID, MarketplaceViewPaneContribution, WorkbenchPhase.BlockRestore);
