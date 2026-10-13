/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A model that calls a tool Vader does not have (benchmark run: `shell`, eleven times) was told only "Unknown tool: shell", and the chat showed it as an MCP call.
// A model that is told which tools exist, and which one does what it meant, corrects itself on the next turn.

/** Names other coding tools use for "run a command in a terminal"; a call to one of them means `run_command` was meant. */
const TERMINAL_NAMES = new Set(['shell', 'bash', 'sh', 'terminal', 'execute_command', 'run_terminal_command', 'run_shell_command', 'run_bash', 'exec', 'cmd', 'powershell'])
const READ_NAMES = new Set(['cat', 'view', 'view_file', 'open_file', 'read'])
const WRITE_NAMES = new Set(['write', 'write_to_file', 'create_file', 'save_file'])
const EDIT_NAMES = new Set(['edit', 'replace_in_file', 'str_replace_editor', 'apply_patch', 'patch'])
const SEARCH_NAMES = new Set(['grep', 'search', 'find', 'ripgrep', 'rg'])
const LIST_NAMES = new Set(['ls', 'list_files', 'list_directory', 'dir'])

const intended = (name: string, available: readonly string[]): string | undefined => {
	const n = name.toLowerCase().replace(/[^a-z0-9_]/g, '')
	const pick = (group: Set<string>, ...candidates: string[]) => group.has(n) ? candidates.find(c => available.includes(c)) : undefined
	return pick(TERMINAL_NAMES, 'run_command')
		?? pick(READ_NAMES, 'read_file')
		?? pick(WRITE_NAMES, 'rewrite_file', 'create_file_or_folder')
		?? pick(EDIT_NAMES, 'edit_file')
		?? pick(SEARCH_NAMES, 'search_for_files', 'search_in_file')
		?? pick(LIST_NAMES, 'ls_dir', 'get_dir_tree')
}

/** The text the model gets back when it calls a tool that does not exist. `available` is the list of tool names it was offered. */
export const unknownToolMessage = (calledName: string, available: readonly string[]): string => {
	const maybe = intended(calledName, available)
	const list = available.length ? ` The tools you can call are: ${available.join(', ')}.` : ''
	const hint = maybe ? ` For what "${calledName}" does, use "${maybe}".` : ''
	return `There is no tool named "${calledName}".${hint}${list} Call one of these tools by its exact name.`
}
