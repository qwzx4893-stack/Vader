/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IFileService, FileChangeType } from '../../../../platform/files/common/files.js';
import { IVaderModelService } from '../common/vaderModelService.js';

class ConvertContribWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.convertcontrib'
	_serviceBrand: undefined;

	constructor(
		@IVaderModelService private readonly vaderModelService: IVaderModelService,
		@IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
	) {
		super()

		const initializeURI = (uri: URI) => {
			this.workspaceContext.getWorkspace()
			// .vaderrules is the workspace instructions file
			for (const filename of ['.vaderrules']) {
				this.vaderModelService.initializeModel(URI.joinPath(uri, filename))
			}
		}

		// call
		this._register(this.workspaceContext.onDidChangeWorkspaceFolders((e) => {
			[...e.changed, ...e.added].forEach(w => { initializeURI(w.uri) })
		}))
		this.workspaceContext.getWorkspace().folders.forEach(w => { initializeURI(w.uri) })

		// a rules file the user creates AFTER the folder was opened has no model yet (the first attempt failed
		// because the file did not exist), so pick it up when it appears
		this._register(this.fileService.onDidFilesChange(e => {
			for (const folder of this.workspaceContext.getWorkspace().folders) {
				for (const filename of ['.vaderrules']) {
					const uri = URI.joinPath(folder.uri, filename)
					if (e.contains(uri, FileChangeType.ADDED)) { this.vaderModelService.initializeModel(uri) }
				}
			}
		}))
	}
}


registerWorkbenchContribution2(ConvertContribWorkbenchContribution.ID, ConvertContribWorkbenchContribution, WorkbenchPhase.BlockRestore);
