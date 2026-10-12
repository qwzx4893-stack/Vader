/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Git runs programs named in the repository's own configuration: `core.fsmonitor`, `diff.external`, a textconv filter, hooks. A folder that
// arrives with a prepared `.git/config` (a downloaded archive, a shared project) would therefore run a command of its author's choice the first
// time Vader runs a plain `git diff` in it - to write a commit message, to collect evidence for a verification, to set up a worktree.
// Every git call Vader makes by itself goes through these arguments: the repository's configuration cannot start a program, and its hooks do not run.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let emptyHooksDir: string | undefined
const hooksDir = () => {
	if (!emptyHooksDir) {
		emptyHooksDir = path.join(os.tmpdir(), 'vader-no-git-hooks')
		try { fs.mkdirSync(emptyHooksDir, { recursive: true }) } catch { /* git then finds no hook there either way */ }
	}
	return emptyHooksDir
}

/** put in front of the git sub-command: `git <safeGitConfigArgs()> diff ...` */
export const safeGitConfigArgs = (): string[] => [
	'-c', 'core.fsmonitor=false',
	'-c', `core.hooksPath=${hooksDir()}`,
	'-c', 'core.pager=cat',
	'-c', 'core.sshCommand=false', // a repository may name any program here; Vader never needs git to open an ssh connection itself
	'-c', 'protocol.ext.allow=never',
	'-c', 'diff.external=',
	'-c', 'commit.gpgsign=false', // signing runs `gpg.program`, which the repository can name; the commits Vader makes itself are scratch commits
	'-c', 'tag.gpgsign=false',
]

/** for sub-commands that produce diffs: no external diff program and no textconv filter from the repository's attributes */
export const SAFE_DIFF_FLAGS = ['--no-ext-diff', '--no-textconv'] as const
