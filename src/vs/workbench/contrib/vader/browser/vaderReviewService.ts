/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IVaderSCMService } from '../common/vaderSCMTypes.js';
import { filesInStat } from '../common/contextSources.js';
import { pullRequestPageUrl } from '../common/reviewModel.js';

// What the review page does with git once the person is happy with the changes: commit them, and open the page where a pull request is made.
// The git work itself runs in the main process (electron-main/vaderSCMMainService.ts), with the message passed as one argument and never through a shell.

export interface IVaderReviewService {
	readonly _serviceBrand: undefined;
	/** stage everything in the open project and commit it; resolves with the short hash */
	commit(message: string): Promise<string>;
	/** the branch the project is on and whether a GitHub page for a pull request can be made from it */
	repoInfo(): Promise<{ branch: string; pullRequestUrl: string | undefined }>;
	/** open the pull request page in the browser; false when there is no GitHub remote to make it on */
	openPullRequestPage(): Promise<boolean>;
	/** the changes in the open project as text for a message (the summary of what changed, then the changes themselves, kept to a size), and how many files they touch; none when there is no git repository or nothing changed */
	changesForContext(): Promise<{ files: number; text: string }>;
}

export const IVaderReviewService = createDecorator<IVaderReviewService>('vaderReviewService');

class VaderReviewService extends Disposable implements IVaderReviewService {
	declare readonly _serviceBrand: undefined;
	private readonly scm: IVaderSCMService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IOpenerService private readonly opener: IOpenerService,
	) {
		super();
		this.scm = ProxyChannel.toService<IVaderSCMService>(mainProcessService.getChannel('vader-channel-scm'));
	}

	private root(): string {
		const folder = this.workspace.getWorkspace().folders[0];
		if (!folder) { throw new Error('No folder is open, so there is nothing to commit.'); }
		return folder.uri.fsPath;
	}

	commit(message: string): Promise<string> {
		return this.scm.gitCommitAll(this.root(), message);
	}

	async repoInfo(): Promise<{ branch: string; pullRequestUrl: string | undefined }> {
		const root = this.root();
		const [branch, remote] = await Promise.all([this.scm.gitBranch(root).catch(() => ''), this.scm.gitRemoteUrl(root).catch(() => '')]);
		return { branch, pullRequestUrl: pullRequestPageUrl(remote, branch) };
	}

	async changesForContext(): Promise<{ files: number; text: string }> {
		let root: string;
		try { root = this.root(); } catch { return { files: 0, text: '' }; }
		const [stat, diffs] = await Promise.all([this.scm.gitStat(root).catch(() => ''), this.scm.gitSampledDiffs(root).catch(() => '')]);
		return { files: filesInStat(stat), text: `${stat.trim()}

${diffs}`.trim() };
	}

	async openPullRequestPage(): Promise<boolean> {
		const { pullRequestUrl } = await this.repoInfo();
		if (!pullRequestUrl) { return false; }
		await this.opener.open(URI.parse(pullRequestUrl));
		return true;
	}
}

registerSingleton(IVaderReviewService, VaderReviewService, InstantiationType.Delayed);
