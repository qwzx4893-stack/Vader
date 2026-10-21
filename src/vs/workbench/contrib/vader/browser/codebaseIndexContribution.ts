/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ICodebaseIndexMainService } from '../common/codebaseIndex/codebaseIndexService.js';
import { IVaderSettingsService } from '../common/vaderSettingsService.js';

// Starts the index of the open project a moment after the window is up, follows the person into another folder, and stops when they turn it off in Settings. The index is
// made and kept by the main process; this only says which project. Nothing leaves the computer.

class CodebaseIndexContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.codebaseIndex';
	private _openRoot: string | undefined;

	constructor(
		@ICodebaseIndexMainService private readonly _index: ICodebaseIndexMainService,
		@IWorkspaceContextService private readonly _workspace: IWorkspaceContextService,
		@IVaderSettingsService private readonly _settings: IVaderSettingsService,
	) {
		super();
		this._register(this._workspace.onDidChangeWorkspaceFolders(() => this._apply()));
		this._register(this._settings.onDidChangeState(() => this._apply()));
		void this._settings.waitForInitState.then(() => this._apply());
	}

	private _apply(): void {
		const root = this._workspace.getWorkspace().folders[0]?.uri.fsPath;
		const on = this._settings.state.globalSettings.codebaseIndex !== false;
		if (this._openRoot && (this._openRoot !== root || !on)) { void this._index.close(this._openRoot).catch(() => { }); this._openRoot = undefined; }
		if (root && on && this._openRoot !== root) { this._openRoot = root; void this._index.open(root).catch(() => { }); }
	}
}

registerWorkbenchContribution2(CodebaseIndexContribution.ID, CodebaseIndexContribution, WorkbenchPhase.Eventually);
