/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { getActiveWindow } from '../../../../base/browser/dom.js';
import { isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatThreadService } from './chatThreadService.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { setVaderWindowLayer } from './vaderWindowLayers.js';
import { IVaderShellService } from './vaderShellService.js';
import { mountVaderShell } from './react/out/vader-shell-tsx/index.js';
import { VADER_OPEN_SHELL_ACTION_ID, VADER_SHELL_NEW_CHAT_ACTION_ID, VADER_SHELL_SEARCH_ACTION_ID } from './actionIDs.js';

// The Vader window is a page of its own over the editor (below the title bar), like Settings and Add-ons used to be: the sidebar of projects and
// conversations on the left and one page on the right. It is mounted once and shown or hidden when the person goes to the editor and back
// ("Open in editor" in the window, the "Vader window" button in the chat title of the editor). While it is shown, the chat of the editor is not
// mounted (sidebarPane.ts), so there is only ever one chat on screen and one text box to type in.

/** true while the window is shown, so keys such as Ctrl N and Ctrl K mean "new chat" and "search" there */
export const VADER_SHELL_ACTIVE = new RawContextKey<boolean>('vader.shellActive', false)

class VaderShellOverlay extends Disposable {
	private root: HTMLElement | undefined
	private shown = false

	constructor(private readonly instantiationService: IInstantiationService) { super() }

	get isShown(): boolean { return this.shown }

	show(): void {
		const win = getActiveWindow()
		const workbench = win.document.querySelector('.monaco-workbench') as HTMLElement | null
		if (!workbench) { return }
		// The window owns the screen before mounting starts, including a failed
		// mount. A failed modern page must never reveal the editor beneath it.
		setVaderWindowLayer(workbench, 'shell', true)
		if (!this.root) { this.create(workbench) }
		this.position()
		this.root!.style.display = 'flex'
		this.shown = true
	}

	hide(): void {
		if (this.root) this.root.style.display = 'none'
		const workbench = this.root?.closest<HTMLElement>('.monaco-workbench') ?? getActiveWindow().document.querySelector<HTMLElement>('.monaco-workbench')
		if (workbench) setVaderWindowLayer(workbench, 'shell', false)
		this.shown = false
	}

	position(): void {
		if (!this.root) { return }
		// on Windows and macOS the system draws the window controls over the page, so the page covers the editor's title bar and has its own strip (board R01);
		// elsewhere the title bar stays, because it holds the controls
		const titlebar = (isWindows || isMacintosh) ? null : getActiveWindow().document.querySelector('.part.titlebar')
		this.root.style.top = `${titlebar ? Math.max(0, titlebar.getBoundingClientRect().bottom) : 0}px`
	}

	private create(workbench: HTMLElement): void {
		const doc = workbench.ownerDocument
		const root = doc.createElement('div')
		root.className = 'vader-shell-overlay'
		root.setAttribute('role', 'main')
		root.setAttribute('aria-label', nls.localize('vaderShellLabel', "Vader"))
		root.setAttribute('data-testid', 'vader-shell-overlay')
		root.style.display = 'none'
		workbench.appendChild(root)
		const resources = new DisposableStore()
		const onResize = () => { if (this.shown) { this.position() } }
		doc.defaultView?.addEventListener('resize', onResize)
		resources.add(toDisposable(() => { doc.defaultView?.removeEventListener('resize', onResize); root.remove() }))
		try {
			this.instantiationService.invokeFunction(accessor => {
				const mounted = mountVaderShell(root, accessor) // lives as long as the window
				if (!mounted) throw new Error('Vader window could not be mounted')
				resources.add(toDisposable(mounted.dispose))
			})
			this.root = root
			this._register(resources)
		} catch (error) {
			resources.dispose()
			throw error
		}
	}

	override dispose(): void {
		this.hide()
		super.dispose()
		this.root = undefined
	}
}

export class VaderShellContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vaderShell'
	private readonly overlay: VaderShellOverlay
	private readonly active: IContextKey<boolean>

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IVaderShellService private readonly shell: IVaderShellService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
	) {
		super()
		this.overlay = this._register(new VaderShellOverlay(instantiationService))
		this.active = VADER_SHELL_ACTIVE.bindTo(contextKeyService)
		this._register(shell.onDidChange(() => this.sync()))
		// At BlockRestore the DOM is still being created. The first layout is
		// synchronous, before paint; do not wait for editor restoration to finish.
		this._register(layoutService.onDidLayoutMainContainer(() => this.sync()))
		this.sync()
	}

	private sync(): void {
		try {
			if (this.shell.state.mode === 'window') { this.overlay.show() } else { this.overlay.hide() }
		} catch (error) {
			// Preserve window ownership while a later layout retries mounting. The
			// real error still propagates to diagnostics; no classic fallback or
			// misleading success screen is shown.
			this.active.set(false)
			throw error
		}
		this.active.set(this.overlay.isShown)
		if (this.overlay.isShown || this.shell.state.mode === 'editor') getActiveWindow().document.body.classList.remove('vader-window-starting')
	}
}

registerWorkbenchContribution2(VaderShellContribution.ID, VaderShellContribution, WorkbenchPhase.BlockRestore)

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VADER_OPEN_SHELL_ACTION_ID,
			title: nls.localize2('vaderOpenShell', "Vader: Open the Vader window"),
			tooltip: nls.localize('vaderOpenShellTooltip', "Vader window: projects, conversations and all agents"),
			f1: true,
			icon: Codicon.layout,
		})
	}
	run(accessor: ServicesAccessor): void { accessor.get(IVaderShellService).show() }
})

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VADER_SHELL_NEW_CHAT_ACTION_ID,
			title: nls.localize2('vaderShellNewChat', "Vader: New chat in the Vader window"),
			f1: false,
			keybinding: { weight: KeybindingWeight.WorkbenchContrib + 50, when: VADER_SHELL_ACTIVE, primary: KeyMod.CtrlCmd | KeyCode.KeyN },
		})
	}
	run(accessor: ServicesAccessor): void {
		accessor.get(IChatThreadService).openNewThread()
		accessor.get(IVaderShellService).show('conversation', 'conversation')
	}
})

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VADER_SHELL_SEARCH_ACTION_ID,
			title: nls.localize2('vaderShellSearch', "Vader: Search chats, files and commands"),
			f1: true,
			keybinding: { weight: KeybindingWeight.WorkbenchContrib + 50, when: ContextKeyExpr.and(VADER_SHELL_ACTIVE), primary: KeyMod.CtrlCmd | KeyCode.KeyK },
		})
	}
	run(accessor: ServicesAccessor): void {
		const shell = accessor.get(IVaderShellService)
		if (shell.state.mode !== 'window') { shell.show() }
		shell.setSearchOpen(!shell.state.searchOpen)
	}
})
