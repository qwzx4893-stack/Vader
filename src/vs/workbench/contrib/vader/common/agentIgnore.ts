/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createIgnore } from './codebaseIndex/ignoreRules.js';

// Files the agent must not see. A person who works on a project with a part that must not go to a model (a client's code, a licence, keys that are not named like keys) lists it in
// `.vaderignore` at the root of the project, in the syntax of `.gitignore`. The agent then does not read, list, search or change those files, and the project index does not hold them.
// It is stronger than the policy engine's rule for files that commonly hold credentials, which asks the person; this does not ask, it refuses, because the person has already said no.
// What the person attaches to a message themselves is theirs to decide and is not stopped. Pure: the text of the file and the paths are given to it.

export const AGENT_IGNORE_FILE = '.vaderignore'

/** what a new `.vaderignore` starts with: how it works, and two lines to copy */
export const AGENT_IGNORE_TEMPLATE = [
	'# Files the agent must not read, list, search or change. One pattern per line, the syntax of .gitignore.',
	'# The project index does not hold them either. Files you attach to a message yourself are not stopped.',
	'#',
	'# secrets/',
	'# client-code/',
	'',
].join('\n')

/** how many patterns a `.vaderignore` holds (comments and blank lines are not patterns) */
export const countIgnorePatterns = (fileText: string): number => fileText.split(/\r?\n/).filter(l => l.trim() !== '' && !l.trimStart().startsWith('#')).length

export type AgentIgnore = { blocks(absPath: string, isDir?: boolean): boolean }

export const NOTHING_IGNORED: AgentIgnore = { blocks: () => false }

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
const isWindowsPath = (p: string): boolean => /^[A-Za-z]:\//.test(p)

/** the path of a file below the project root, or undefined when it is not below it */
export function relativeTo(root: string, abs: string): string | undefined {
	const r = norm(root), a = norm(abs)
	const ci = isWindowsPath(r)
	const rc = ci ? r.toLowerCase() : r, ac = ci ? a.toLowerCase() : a
	if (ac === rc) return ''
	return ac.startsWith(rc + '/') ? a.slice(r.length + 1) : undefined
}

/** a matcher for the lines of `.vaderignore` (comments and blank lines are ignored, `!` un-ignores, a trailing `/` means a folder) */
export function makeAgentIgnore(root: string, fileText: string): AgentIgnore {
	const lines = fileText.split(/\r?\n/).filter(l => l.trim() !== '' && !l.trimStart().startsWith('#'))
	if (lines.length === 0) return NOTHING_IGNORED
	const m = createIgnore(lines)
	return {
		blocks(abs: string, isDir = false): boolean {
			const rel = relativeTo(root, abs)
			if (rel === undefined || rel === '') return false // outside the project, or the project itself
			return m.ignores(rel, isDir)
		},
	}
}

/** what the agent is told when it asks for a file that is listed */
export const blockedMessage = (displayPath: string): string =>
	`${displayPath} is listed in ${AGENT_IGNORE_FILE} in this project, so the agent does not read, search or change it. Do not try another way to reach its contents. If the task needs it, tell the user and ask them to take it out of ${AGENT_IGNORE_FILE}.`
