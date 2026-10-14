/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// When a parallel task's branch cannot be merged because both sides changed the same lines, the person can ask an agent to merge them.
// The branch the main project is on is merged into the task's own worktree, which leaves git's conflict markers in the files; this is what the
// agent is told. It works inside the worktree only, so the project the person is looking at does not change until the merge is complete.

export function conflictResolutionPrompt(opts: { worktreePath: string; targetBranch: string; files: readonly string[]; task: string }): string {
	const files = opts.files.map(f => `- ${f}`).join('\n');
	return `Two pieces of work changed the same lines and now have to be combined.

The work you were asked to do was: ${opts.task.slice(0, 400)}

The branch "${opts.targetBranch}" has been merged into your working folder, and git stopped on these files:
${files}

Your working folder is exactly: ${opts.worktreePath}
Open each file above. Where you find git's markers (a line starting with <<<<<<<, then =======, then >>>>>>>), the part above ======= is your own work and the part below is what "${opts.targetBranch}" has. Rewrite that part so that BOTH changes are kept and still work together, and delete the three marker lines. If the two really contradict each other, keep the one that matches the work you were asked to do and say which you dropped and why.

Do not commit. Do not run git. Do not touch any file that is not listed. When no marker is left, answer with one short paragraph saying what you kept from each side.`;
}
