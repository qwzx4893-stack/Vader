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
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspacesService, isRecentFolder } from '../../../../platform/workspaces/common/workspaces.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IChatThreadService } from './chatThreadService.js';
import { ITaskCopyService } from './taskCopyService.js';
import { ProjectChoice, projectChoices } from '../common/projectPickerModel.js';
import { projectKeyOf } from '../common/threadProjects.js';

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
export type ShellPage = 'conversation' | 'agents' | 'addons' | 'files';
export type ConversationTab = 'conversation' | 'review' | 'browser' | 'terminal';

export type ShellState = {
	readonly mode: ShellMode;
	readonly page: ShellPage;
	readonly tab: ConversationTab;
	/** a search palette over chats, files and commands is open */
	readonly searchOpen: boolean;
	/** the file shown on the files page ("Open in editor"), by its path */
	readonly file: string | null;
};

export interface IVaderShellService {
	readonly _serviceBrand: undefined;
	readonly state: ShellState;
	readonly onDidChange: Event<void>;

	/** show the window on a page (and leave the editor) */
	show(page?: ShellPage, tab?: ConversationTab): void;
	/** leave the window for the classic editor layout */
	openEditor(): void;
	/** the files page of the window ("Open in editor"): the project's files, and this one chosen when a path is given */
	openFile(path?: string | null): void;
	setTab(tab: ConversationTab): void;
	setSearchOpen(open: boolean): void;
	/** whether the person asked for the window to be the way Vader opens */
	isWindowFirst(): boolean;
	/** Real editor folders and history. History failure is reported without hiding known conversation projects. */
	listProjects(): Promise<{ projects: ProjectChoice[]; historyUnavailable: boolean }>;
	selectProject(folders: readonly string[], newChat?: boolean): Promise<void>;
	newProject(): Promise<void>;
	openThread(threadId: string): Promise<void>;
	pickContextFiles(): Promise<URI[] | undefined>;
}

export const IVaderShellService = createDecorator<IVaderShellService>('vaderShellService');

class VaderShellService extends Disposable implements IVaderShellService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private _state: ShellState;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
		@IWorkspacesService private readonly _workspaces: IWorkspacesService,
		@IWorkspaceEditingService private readonly _workspaceEditing: IWorkspaceEditingService,
		@IFileDialogService private readonly _dialogs: IFileDialogService,
		@IFileService private readonly _files: IFileService,
		@IChatThreadService private readonly _chat: IChatThreadService,
		@ITaskCopyService private readonly _copies: ITaskCopyService,
	) {
		super();
		this._state = { mode: this.isWindowFirst() ? 'window' : 'editor', page: 'conversation', tab: 'conversation', searchOpen: false, file: null };
		this._register(this._workspace.onDidChangeWorkspaceFolders(() => { this._state = { ...this._state }; this._onDidChange.fire(); }));
	}

	async listProjects(): Promise<{ projects: ProjectChoice[]; historyUnavailable: boolean }> {
		let recent: string[] = [];
		let historyUnavailable = false;
		try {
			recent = (await this._workspaces.getRecentlyOpened()).workspaces.filter(isRecentFolder)
				.filter(f => f.folderUri.scheme === 'file' && !f.remoteAuthority).map(f => f.folderUri.fsPath);
		} catch { historyUnavailable = true; }
		const threads = Object.values(this._chat.state.allThreads).filter(t => !!t && !t.isSubagentThread && !t.isVerificationThread);
		const copies = threads.flatMap(t => { const c = this._copies.getState(t!.id); return c ? [c] : []; });
		return {
			projects: projectChoices(this._workspace.getWorkspace().folders.map(f => f.uri.fsPath),
				threads.sort((a, b) => b!.lastModified.localeCompare(a!.lastModified)).map(t => t!.projectFolders ?? []), recent, copies),
			historyUnavailable,
		};
	}

	private _selecting = false;
	private async _inProject(folders: readonly string[], then: () => void): Promise<void> {
		if (this._selecting) throw new Error('A project is opening. Wait for it to finish.');
		this._selecting = true;
		try {
			const current = this._workspace.getWorkspace().folders.map(f => f.uri.fsPath);
			const same = current.length === folders.length && current.every((p, i) => projectKeyOf([p]) === projectKeyOf([folders[i]]));
			if (!same) {
				if (Object.values(this._chat.streamState).some(s => !!s?.isRunning)) throw new Error('Stop the running task before switching projects.');
				for (const path of folders) {
					if (!(await this._files.stat(URI.file(path))).isDirectory) throw new Error('This project folder is unavailable. Choose another folder.');
				}
				await this._workspaceEditing.updateFolders(0, current.length, folders.map(p => ({ uri: URI.file(p) })), true);
				const actual = this._workspace.getWorkspace().folders.map(f => f.uri.fsPath);
				if (actual.length !== folders.length || actual.some((p, i) => projectKeyOf([p]) !== projectKeyOf([folders[i]]))) {
					throw new Error('The project did not open. Try again or choose another folder.');
				}
			}
			then();
			this.show('conversation', 'conversation');
		} finally { this._selecting = false; }
	}

	async selectProject(folders: readonly string[], newChat = false): Promise<void> {
		await this._inProject(folders, () => {
			const group = this._chat.listProjectGroups().find(g => g.key === projectKeyOf(folders));
			if (!newChat && group?.threadIds.length) this._chat.switchToThread(group.threadIds[0]);
			else this._chat.openNewThread();
		});
	}

	async newProject(): Promise<void> {
		const selected = await this._dialogs.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
			title: nls.localize('vaderChooseProject', "Choose a project folder"), openLabel: nls.localize('vaderOpenProject', "Open project") });
		if (selected?.[0]) {
			if (selected[0].scheme !== 'file') throw new Error('Choose a folder on this computer.');
			await this.selectProject([selected[0].fsPath], true);
		}
	}

	async openThread(threadId: string): Promise<void> {
		const thread = this._chat.state.allThreads[threadId];
		if (!thread) throw new Error('This conversation is no longer available.');
		await this._inProject(thread.projectFolders ?? [], () => this._chat.switchToThread(threadId));
	}

	pickContextFiles(): Promise<URI[] | undefined> {
		return this._dialogs.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: true,
			title: nls.localize('vaderAttachFiles', "Add files"), openLabel: nls.localize('vaderAttach', "Attach") });
	}

	get state(): ShellState { return this._state; }

	isWindowFirst(): boolean {
		return this._configurationService.getValue<boolean>(VADER_SHELL_SETTING) !== false;
	}

	private _set(next: Partial<ShellState>): void {
		const merged = { ...this._state, ...next };
		if (merged.mode === this._state.mode && merged.page === this._state.page && merged.tab === this._state.tab && merged.searchOpen === this._state.searchOpen && merged.file === this._state.file) { return; }
		this._state = merged;
		this._onDidChange.fire();
	}

	show(page: ShellPage = this._state.page, tab: ConversationTab = page === 'conversation' ? this._state.tab : 'conversation'): void {
		this._set({ mode: 'window', page, tab, searchOpen: false });
	}

	openEditor(): void {
		this._set({ mode: 'editor', searchOpen: false });
	}

	openFile(path?: string | null): void {
		this._set({ mode: 'window', page: 'files', tab: 'conversation', searchOpen: false, file: path === undefined ? this._state.file : path });
	}

	setTab(tab: ConversationTab): void {
		this._set({ page: 'conversation', tab });
	}

	setSearchOpen(open: boolean): void {
		this._set({ searchOpen: open });
	}
}

registerSingleton(IVaderShellService, VaderShellService, InstantiationType.Delayed);
