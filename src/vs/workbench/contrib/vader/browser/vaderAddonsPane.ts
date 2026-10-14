/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import * as nls from '../../../../nls.js';
import { getActiveWindow } from '../../../../base/browser/dom.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { mountVaderAddons } from './react/out/vader-addons-tsx/index.js'
import { VADER_TOGGLE_ADDONS_ACTION_ID, VADER_OPEN_ADDONS_ACTION_ID } from './actionIDs.js'


// Add-ons is where a person finds skills, MCP servers, editor extensions and agents. It opens as a full-window page over the editor, like Settings
// (below the title bar, Esc or the close button hides it), and is reached from the title of the chat, not from inside Settings.
// It stays mounted once opened, so reopening is instant and a search is not lost.

class VaderAddonsOverlay {
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

	private position(): void {
		const titlebar = getActiveWindow().document.querySelector('.part.titlebar')
		this.root!.style.top = `${titlebar ? Math.max(0, titlebar.getBoundingClientRect().bottom) : 0}px`
	}

	private create(workbench: HTMLElement): void {
		const doc = workbench.ownerDocument
		const root = doc.createElement('div')
		root.className = 'vader-settings-overlay' // the same full-window frame as Settings
		root.setAttribute('role', 'dialog')
		root.setAttribute('aria-label', nls.localize('vaderAddonsOverlayLabel', "Vader Add-ons"))
		root.setAttribute('data-testid', 'vader-addons-overlay')
		root.tabIndex = -1
		root.style.display = 'none'
		root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close() } })

		const header = doc.createElement('div')
		header.className = 'vader-settings-overlay-header'
		const title = doc.createElement('div')
		title.className = 'vader-settings-overlay-title'
		title.textContent = nls.localize('vaderAddonsOverlayTitle', "Add-ons")
		const closeButton = doc.createElement('button')
		closeButton.className = 'vader-settings-overlay-close'
		closeButton.type = 'button'
		closeButton.setAttribute('aria-label', nls.localize('vaderAddonsClose', "Close Add-ons (Esc)"))
		closeButton.setAttribute('title', nls.localize('vaderAddonsClose', "Close Add-ons (Esc)"))
		closeButton.setAttribute('data-testid', 'vader-addons-close')
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
			mountVaderAddons(body, accessor) // lives as long as the window
		})
	}
}

let overlay: VaderAddonsOverlay | undefined
const overlayOf = (accessor: ServicesAccessor): VaderAddonsOverlay => overlay ??= new VaderAddonsOverlay(accessor.get(IInstantiationService))

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VADER_TOGGLE_ADDONS_ACTION_ID,
			title: nls.localize2('vaderAddonsToggle', "Vader: Toggle Add-ons"),
			icon: Codicon.package,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		overlayOf(accessor).toggle()
	}
})

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VADER_OPEN_ADDONS_ACTION_ID,
			title: nls.localize2('vaderAddonsOpen', "Vader: Open Add-ons"),
			f1: true,
			icon: Codicon.package,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		overlayOf(accessor).open()
	}
})

// next to the settings gear at the bottom left
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '0_command',
	command: {
		id: VADER_TOGGLE_ADDONS_ACTION_ID,
		title: nls.localize('vaderAddonsActionGear', "Vader\'s Add-ons")
	},
	order: 0
});
