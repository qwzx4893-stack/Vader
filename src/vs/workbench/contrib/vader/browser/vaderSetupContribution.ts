/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { mountVaderOnboarding } from './react/out/vader-onboarding/index.js'
import { h, getActiveWindow } from '../../../../base/browser/dom.js';
import { IVaderSettingsService } from '../common/vaderSettingsService.js';
import { setVaderWindowLayer } from './vaderWindowLayers.js';

// Onboarding contribution that mounts the component at startup
export class OnboardingContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vaderOnboarding';
	private readonly view = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IVaderSettingsService private readonly settings: IVaderSettingsService,
	) {
		super();
		void settings.waitForInitState.then(() => {
			if (this._store.isDisposed) return;
			this._register(settings.onDidChangeState(() => this.initialize()));
			this.initialize();
		});
	}

	private initialize(): void {
		if (this.settings.state.globalSettings.isOnboardingComplete) { this.view.clear(); return; }
		if (this.view.value) return;
		// Get the active window reference for multi-window support
		const targetWindow = getActiveWindow();

		// Find the monaco-workbench element using the proper window reference
		const workbench = targetWindow.document.querySelector('.monaco-workbench');

		if (workbench) {
			const disposables = new DisposableStore();
			this.view.value = disposables;
			const onboardingContainer = h('div.vader-onboarding-container').root;
			workbench.appendChild(onboardingContainer);
			setVaderWindowLayer(workbench as HTMLElement, 'onboarding', true);
			disposables.add(toDisposable(() => {
				setVaderWindowLayer(workbench as HTMLElement, 'onboarding', false);
				onboardingContainer.remove();
			}));
			try {
				this.instantiationService.invokeFunction((accessor: ServicesAccessor) => {
					const result = mountVaderOnboarding(onboardingContainer, accessor);
					if (result && typeof result.dispose === 'function') {
						disposables.add(toDisposable(result.dispose));
					}
				});
			} catch (error) {
				this.view.clear();
				throw error;
			}
		}
	}
}

// Register the contribution to be initialized during the AfterRestored phase
registerWorkbenchContribution2(OnboardingContribution.ID, OnboardingContribution, WorkbenchPhase.AfterRestored);
