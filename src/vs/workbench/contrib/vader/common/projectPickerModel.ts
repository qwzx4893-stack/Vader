/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { projectDisplayNames, projectKeyOf, projectNameOf } from './threadProjects.js';

export type ProjectChoice = { readonly key: string; readonly name: string; readonly folders: readonly string[] };

/** Editor history and conversation projects, using public project folders rather than a task's isolated copy. */
export function projectChoices(
	current: readonly string[],
	projects: readonly (readonly string[])[],
	recent: readonly string[],
	copies: readonly { readonly repoPath: string; readonly worktreePath: string }[],
): ProjectChoice[] {
	const publicFolder = (path: string) => copies.find(c => projectKeyOf([c.worktreePath]) === projectKeyOf([path]))?.repoPath ?? path;
	const byKey = new Map<string, ProjectChoice>();
	for (const source of [current, ...projects, ...recent.map(p => [p])]) {
		const folders = source.map(publicFolder);
		const key = projectKeyOf(folders);
		if (key && !byKey.has(key)) byKey.set(key, { key, name: projectNameOf(key), folders });
	}
	const choices = [...byKey.values()];
	const names = projectDisplayNames(choices.map(c => ({ key: c.key, name: c.name, threadIds: [], lastModified: '' })));
	return choices.map(c => ({ ...c, name: names.get(c.key) ?? c.name }));
}

/** An empty draft with files is still the person's work; do not recycle it for another project. */
export function reusableProjectDraft(thread: { readonly messages: readonly unknown[]; readonly state: { readonly stagingSelections: readonly unknown[] }; readonly isSubagentThread?: boolean; readonly isVerificationThread?: boolean }): boolean {
	return !thread.isSubagentThread && !thread.isVerificationThread && thread.messages.length === 0 && thread.state.stagingSelections.length === 0;
}
