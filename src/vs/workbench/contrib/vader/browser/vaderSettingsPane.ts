/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import * as nls from '../../../../nls.js';
import { getActiveWindow } from '../../../../base/browser/dom.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { mountVaderSettings } from './react/out/vader-settings-tsx/index.js'


// Vader's settings are a full-window page that opens over the editor (below the title bar), not a tab in the editor area:
// a header with the title and a close button, then the React settings page (a navigation column on the left, the section on the right).
// It stays mounted once opened, so reopening is instant and nothing typed is lost. Esc or the close button hides it.

class VaderSettingsOverlay {
	private root: HTMLElement | undefined
	private previouslyFocused: Element | null = null

	constructor(private readonly instantiationService: IInstantiationService) { }

	get isOpen(): boolean { return !!this.root && this.root.style.display !== 'none' }

	open(): void {
		const win = getActiveWindow()
		const workbench = win.document.querySelector('.monaco-workbench')
		if (!workbench) { return }
		if (!this.root) { this.create(workbench as HTMLElement) }
		const root = this.root!
		if (this.isOpen) { return }
		this.previouslyFocused = win.document.activeElement
		this.position()
		root.style.display = 'flex'
		root.focus()
	}

	close(): void {
		if (!this.root || !this.isOpen) { return }
		this.root.style.display = 'none'
		const prev = this.previouslyFocused as HTMLElement | null
		this.previouslyFocused = null
		prev?.focus?.()
	}

	toggle(): void { this.isOpen ? this.close() : this.open() }

	/** The page starts right below the title bar, so the window controls and menu stay usable. */
	private position(): void {
		const titlebar = getActiveWindow().document.querySelector('.part.titlebar')
		this.root!.style.top = `${titlebar ? Math.max(0, titlebar.getBoundingClientRect().bottom) : 0}px`
	}

	private create(workbench: HTMLElement): void {
		const doc = workbench.ownerDocument
		const root = doc.createElement('div')
		root.className = 'vader-settings-overlay'
		root.setAttribute('role', 'dialog')
		root.setAttribute('aria-label', nls.localize('vaderSettingsOverlayLabel', "Vader Settings"))
		root.setAttribute('data-testid', 'vader-settings-overlay')
		root.tabIndex = -1
		root.style.display = 'none'
		root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close() } })

		const header = doc.createElement('div')
		header.className = 'vader-settings-overlay-header'
		const title = doc.createElement('div')
		title.className = 'vader-settings-overlay-title'
		title.textContent = nls.localize('vaderSettingsOverlayTitle', "Vader Settings")
		const closeButton = doc.createElement('button')
		closeButton.className = 'vader-settings-overlay-close'
		closeButton.type = 'button'
		closeButton.setAttribute('aria-label', nls.localize('vaderSettingsClose', "Close settings (Esc)"))
		closeButton.setAttribute('title', nls.localize('vaderSettingsClose', "Close settings (Esc)"))
		closeButton.setAttribute('data-testid', 'vader-settings-close')
		const icon = doc.createElement('span')
		icon.className = ThemeIcon.asClassName(Codicon.close)
		closeButton.appendChild(icon)
		closeButton.addEventListener('click', () => this.close())
		header.append(title, closeButton)

		const body = doc.createElement('div')
		body.className = 'vader-settings-overlay-body'
		root.append(header, body)
		workbench.appendChild(root)
		this.root = root

		doc.defaultView?.addEventListener('resize', () => { if (this.isOpen) { this.position() } })

		this.instantiationService.invokeFunction(accessor => {
			mountVaderSettings(body, accessor) // lives as long as the window
		})
	}
}

let overlay: VaderSettingsOverlay | undefined
const overlayOf = (accessor: ServicesAccessor): VaderSettingsOverlay => overlay ??= new VaderSettingsOverlay(accessor.get(IInstantiationService))


// register the gear on the top right
export { VADER_TOGGLE_SETTINGS_ACTION_ID, VADER_OPEN_SETTINGS_ACTION_ID } from './actionIDs.js'
import { VADER_TOGGLE_SETTINGS_ACTION_ID, VADER_OPEN_SETTINGS_ACTION_ID } from './actionIDs.js'
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VADER_TOGGLE_SETTINGS_ACTION_ID,
			title: nls.localize2('vaderSettings', "Vader: Toggle Settings"),
			icon: Codicon.settingsGear,
			menu: [
				{
					id: MenuId.LayoutControlMenuSubmenu,
					group: 'z_end',
				},
				{
					id: MenuId.LayoutControlMenu,
					when: ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both'),
					group: 'z_end'
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		overlayOf(accessor).toggle()
	}
})


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VADER_OPEN_SETTINGS_ACTION_ID,
			title: nls.localize2('vaderSettingsAction2', "Vader: Open Settings"),
			f1: true,
			icon: Codicon.settingsGear,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		overlayOf(accessor).open()
	}
})


// add to settings gear on bottom left
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '0_command',
	command: {
		id: VADER_TOGGLE_SETTINGS_ACTION_ID,
		title: nls.localize('vaderSettingsActionGear', "Vader\'s Settings")
	},
	order: 1
});
