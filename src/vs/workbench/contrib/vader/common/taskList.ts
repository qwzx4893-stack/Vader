/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The agent's task list for a long job (tool `update_task_list`). The model writes the whole list on every call, one task per line, with a mark in front:
//   [ ] not started    [~] in progress    [x] done
// The idea (a todo tool whose result is shown back to the model and to the person) is the one used by opencode (MIT), Roo Code (Apache-2.0) and Codex' `update_plan`
// (Apache-2.0); the format and the wording here are Vader's own. Small models cope better with plain lines than with a JSON array, so lines are what is asked for, and many
// ways of writing a mark are accepted.

export type TaskStatus = 'pending' | 'in_progress' | 'done'
export type Task = { status: TaskStatus, text: string }

export const MAX_TASKS = 30
export const MAX_TASK_CHARS = 300

const MARKS: [RegExp, TaskStatus][] = [
	[/^\[\s*\]\s*/, 'pending'],
	[/^\[\s*(?:~|-|\/|>|\.\.\.|\*)\s*\]\s*/, 'in_progress'],
	[/^\[\s*(?:x|X|✓|✔|done)\s*\]\s*/, 'done'],
	[/^\(\s*\)\s*/, 'pending'],
	[/^\(\s*(?:~|-|>)\s*\)\s*/, 'in_progress'],
	[/^\(\s*(?:x|X)\s*\)\s*/, 'done'],
	[/^(?:☐)\s*/, 'pending'],
	[/^(?:☑|✅|✓|✔)\s*/, 'done'],
]

/** Reads the list as the model wrote it. A line without a mark is a pending task; bullets and numbers in front of a line are dropped; blank lines are skipped. */
export const parseTaskList = (text: string): Task[] => {
	const tasks: Task[] = []
	for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
		let line = raw.trim().replace(/^(?:[-*+•]|\d{1,2}[.)])\s+/, '')
		if (!line) { continue }
		let status: TaskStatus = 'pending'
		for (const [re, st] of MARKS) {
			const m = re.exec(line)
			if (m) { status = st; line = line.slice(m[0].length); break }
		}
		line = line.trim()
		if (!line) { continue }
		tasks.push({ status, text: line.length > MAX_TASK_CHARS ? line.slice(0, MAX_TASK_CHARS - 1) + '…' : line })
	}
	return tasks
}

const MARK_OF: Record<TaskStatus, string> = { pending: '[ ]', in_progress: '[~]', done: '[x]' }

export const formatTaskList = (tasks: readonly Task[]): string => tasks.map(t => `${MARK_OF[t.status]} ${t.text}`).join('\n')

export const summariseTaskList = (tasks: readonly Task[]): { total: number, done: number, inProgress: number, pending: number } => ({
	total: tasks.length,
	done: tasks.filter(t => t.status === 'done').length,
	inProgress: tasks.filter(t => t.status === 'in_progress').length,
	pending: tasks.filter(t => t.status === 'pending').length,
})

/** What the model is told after it updated its list: the list as stored, the count, and a nudge about the next step (or about a list that is not in good shape). */
export const taskListResultText = (tasks: readonly Task[]): string => {
	const s = summariseTaskList(tasks)
	const lines = [`Task list updated (${s.done} of ${s.total} done):`, formatTaskList(tasks)]
	if (s.inProgress > 1) { lines.push('Note: more than one task is marked in progress. Keep exactly one in progress, the one you are working on.') }
	if (s.done === s.total) { lines.push('All tasks are done. Check the result once more (run the tests or the build), then give the user your report.') }
	else if (s.inProgress === 0) { lines.push('No task is marked in progress. Mark the one you are starting now.') }
	return lines.join('\n')
}
