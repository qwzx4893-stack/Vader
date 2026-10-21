/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Going back to a checkpoint puts the files the agent EDITED back as they were. A file it CREATED had no earlier text to put back, and a file it DELETED is not in any snapshot, so
// going back left the first still there and the second gone. Each creation and each deletion is now kept with the checkpoint taken just before it (a deleted file with its
// text), and going back, or forward again, undoes or redoes them. The plan is made here; the files are changed by the chat service. Pure.

export type FileOps = {
	/** files that did not exist and were made */
	created: string[];
	/** folders that did not exist and were made */
	createdFolders: string[];
	/** files that existed and were deleted, with their text (a folder that was deleted is every file in it) */
	deleted: { fsPath: string; content: string }[];
}

export type FileAction =
	| { kind: 'delete'; fsPath: string }
	| { kind: 'write'; fsPath: string; content: string }
	| { kind: 'remove-folder-if-empty'; fsPath: string }
	| { kind: 'make-folder'; fsPath: string }

/** the most a deleted file may weigh to be kept for going back (a bigger one is deleted without that safety net, and the person is told) */
export const MAX_KEPT_FILE_BYTES = 1_000_000
/** the most files of a deleted folder that are kept */
export const MAX_KEPT_FOLDER_FILES = 60

const same = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** what to do to go back past these operations, which happened in this order: the last one is undone first, and a file ends up as it was before the first one that touched it */
export function undoActions(opsInOrder: readonly FileOps[]): FileAction[] {
	const actions: FileAction[] = []
	for (let i = opsInOrder.length - 1; i >= 0; i--) {
		const o = opsInOrder[i]
		for (const d of o.deleted) actions.push({ kind: 'write', fsPath: d.fsPath, content: d.content })
		for (const f of o.created) actions.push({ kind: 'delete', fsPath: f })
		for (const f of o.createdFolders) actions.push({ kind: 'remove-folder-if-empty', fsPath: f })
	}
	return collapse(actions)
}

/** what to do to go forward again past these operations (in the order they happened): a file made is made again, empty, and what it held comes back with the edit checkpoints; a file deleted is deleted again */
export function redoActions(opsInOrder: readonly FileOps[]): FileAction[] {
	const actions: FileAction[] = []
	for (const o of opsInOrder) {
		for (const f of o.createdFolders) actions.push({ kind: 'make-folder', fsPath: f })
		for (const f of o.created) actions.push({ kind: 'write', fsPath: f, content: '' })
		for (const d of o.deleted) actions.push({ kind: 'delete', fsPath: d.fsPath })
	}
	return collapse(actions)
}

/** for each file only the last thing to do to it counts (made and deleted again in the range is simply not there); folders are removed after the files in them */
function collapse(actions: readonly FileAction[]): FileAction[] {
	const last = new Map<string, FileAction>()
	for (const a of actions) {
		const key = a.fsPath.replace(/\\/g, '/').toLowerCase()
		last.set(key, a)
	}
	const files = [...last.values()].filter(a => a.kind === 'delete' || a.kind === 'write')
	const makeFolders = [...last.values()].filter(a => a.kind === 'make-folder')
	const removeFolders = [...last.values()].filter(a => a.kind === 'remove-folder-if-empty').sort((a, b) => b.fsPath.length - a.fsPath.length) // the deepest first
	return [...makeFolders, ...files, ...removeFolders]
}

/** is it the same file */
export const samePath = same

/** the words of the step in the list of checkpoints */
export function opsLabel(name: 'create_file_or_folder' | 'delete_file_or_folder', fsPath: string | undefined): string {
	const base = fsPath ? (fsPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? fsPath) : 'a file'
	return `${name === 'create_file_or_folder' ? 'Created' : 'Deleted'} ${base}`
}
