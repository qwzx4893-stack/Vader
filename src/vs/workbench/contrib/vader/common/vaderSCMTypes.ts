/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IVaderSCMService {
	readonly _serviceBrand: undefined;
	/**
	 * Get git diff --stat
	 *
	 * @param path Path to the git repository
	 */
	gitStat(path: string): Promise<string>
	/**
	 * Get git diff --stat for the top 10 most significantly changed files according to lines added/removed
	 *
	 * @param path Path to the git repository
	 */
	gitSampledDiffs(path: string): Promise<string>
	/**
	 * Get the current git branch
	 *
	 * @param path Path to the git repository
	 */
	gitBranch(path: string): Promise<string>
	/**
	 * Get the last 5 commits excluding merges
	 *
	 * @param path Path to the git repository
	 */
	gitLog(path: string): Promise<string>
	/**
	 * Stage everything and commit it with the given message (what the review page's Commit button does). The message goes to git as one argument, never through a
	 * shell. Resolves with the short hash of the new commit; rejects with git's own words when it cannot commit (nothing to commit, no identity set, a hook said no).
	 */
	gitCommitAll(path: string, message: string): Promise<string>
	/** the address of the remote called origin, or '' when there is none */
	gitRemoteUrl(path: string): Promise<string>
}

export const IVaderSCMService = createDecorator<IVaderSCMService>('vaderSCMService')
