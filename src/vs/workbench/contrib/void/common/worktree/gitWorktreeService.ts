/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IGitWorktreeMainService } from './gitWorktreeTypes.js';

export * from './gitWorktreeTypes.js';

// Thin IPC proxy to electron-main/gitWorktreeMainService.ts - same pattern as
// common/discovery/discoveryService.ts. Real git commands run in the main process only.
class GitWorktreeService implements IGitWorktreeMainService {
	readonly _serviceBrand: undefined;
	private readonly _mainService: IGitWorktreeMainService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this._mainService = ProxyChannel.toService<IGitWorktreeMainService>(mainProcessService.getChannel('void-channel-worktree'));
	}

	createWorktree: IGitWorktreeMainService['createWorktree'] = (opts) => this._mainService.createWorktree(opts);
	getWorktreeDiffStat: IGitWorktreeMainService['getWorktreeDiffStat'] = (path) => this._mainService.getWorktreeDiffStat(path);
	commitAndMergeWorktreeBranch: IGitWorktreeMainService['commitAndMergeWorktreeBranch'] = (opts) => this._mainService.commitAndMergeWorktreeBranch(opts);
	removeWorktree: IGitWorktreeMainService['removeWorktree'] = (opts) => this._mainService.removeWorktree(opts);
	getCurrentBranch: IGitWorktreeMainService['getCurrentBranch'] = (path) => this._mainService.getCurrentBranch(path);
}

registerSingleton(IGitWorktreeMainService, GitWorktreeService, InstantiationType.Delayed);
