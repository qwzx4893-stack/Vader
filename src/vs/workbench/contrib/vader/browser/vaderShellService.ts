/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import * as nls from '../../../../nls.js';

// The window a person lives in: the sidebar of projects and conversations on the left, and on the right the conversation, the review of what the agent
// changed, all agents, or Add-ons (boards R01 to R05 of the interface canvas). The editor is one click away ("Open in editor") and back.
// This service only holds which of the two the person is in and which page of the window is open; the window itself is vaderShellPane.ts.

export const VADER_SHELL_SETTING = 'vader.window.agentsFirst';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'vader.window',
	order: 1,
	title: nls.localize('vaderWindowTitle', "Vader window"),
	type: 'object',
	properties: {
		[VADER_SHELL_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			markdownDescription: nls.localize('vaderWindowAgentsFirst', "Open Vader in its own window (projects and conversations on the left, the conversation, the review of changes and all agents on the right) instead of the classic editor layout. The editor is always one click away."),
		},
	},
});

export type ShellMode = 'window' | 'editor';
/** the pages of the window; the conversation also has tabs (conversation, review, browser, terminal) */
export type ShellPage = 'conversation' | 'agents' | 'addons';
export type ConversationTab = 'conversation' | 'review' | 'browser' | 'terminal';

export type ShellState = {
	readonly mode: ShellMode;
	readonly page: ShellPage;
	readonly tab: ConversationTab;
	/** a search palette over chats, files and commands is open */
	readonly searchOpen: boolean;
};

export interface IVaderShellService {
	readonly _serviceBrand: undefined;
	readonly state: ShellState;
	readonly onDidChange: Event<void>;

	/** show the window on a page (and leave the editor) */
	show(page?: ShellPage, tab?: ConversationTab): void;
	/** leave the window for the classic editor layout */
	openEditor(): void;
	setTab(tab: ConversationTab): void;
	setSearchOpen(open: boolean): void;
	/** whether the person asked for the window to be the way Vader opens */
	isWindowFirst(): boolean;
}

export const IVaderShellService = createDecorator<IVaderShellService>('vaderShellService');

class VaderShellService extends Disposable implements IVaderShellService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private _state: ShellState;

	constructor(@IConfigurationService private readonly _configurationService: IConfigurationService) {
		super();
		this._state = { mode: this.isWindowFirst() ? 'window' : 'editor', page: 'conversation', tab: 'conversation', searchOpen: false };
	}

	get state(): ShellState { return this._state; }

	isWindowFirst(): boolean {
		return this._configurationService.getValue<boolean>(VADER_SHELL_SETTING) !== false;
	}

	private _set(next: Partial<ShellState>): void {
		const merged = { ...this._state, ...next };
		if (merged.mode === this._state.mode && merged.page === this._state.page && merged.tab === this._state.tab && merged.searchOpen === this._state.searchOpen) { return; }
		this._state = merged;
		this._onDidChange.fire();
	}

	show(page: ShellPage = this._state.page, tab: ConversationTab = page === 'conversation' ? this._state.tab : 'conversation'): void {
		this._set({ mode: 'window', page, tab, searchOpen: false });
	}

	openEditor(): void {
		this._set({ mode: 'editor', searchOpen: false });
	}

	setTab(tab: ConversationTab): void {
		this._set({ page: 'conversation', tab });
	}

	setSearchOpen(open: boolean): void {
		this._set({ searchOpen: open });
	}
}

registerSingleton(IVaderShellService, VaderShellService, InstantiationType.Delayed);
