/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The commands of the message box (board R06, "Commands, after typing /"): what is offered while the person types, and what a typed line means. Pure, so it is tested
// without the editor; what each command does is in the chat (browser/react/src/sidebar-tsx/SidebarChat.tsx), which calls the real services.

export type SlashId = 'plan' | 'review' | 'compact' | 'remember' | 'init';

export type SlashCommand = {
	readonly id: SlashId;
	readonly detail: string;
	/** the command takes text after it (what to remember) */
	readonly takesText?: boolean;
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
	{ id: 'plan', detail: 'Switch to plan mode' },
	{ id: 'review', detail: 'Check the changes with a second agent' },
	{ id: 'compact', detail: 'Summarise the earlier steps now' },
	{ id: 'remember', detail: 'Save a note for this project', takesText: true },
	{ id: 'init', detail: 'Write an AGENTS.md for this project' },
];

/** the commands to offer for what is typed, or undefined when the text is not a command being typed (it does not begin with "/", or a space follows a command that takes no text) */
export function slashMatches(text: string): readonly SlashCommand[] | undefined {
	if (!text.startsWith('/')) return undefined;
	const m = /^\/([a-z]*)(\s.*)?$/is.exec(text);
	if (!m) return undefined;
	const name = m[1].toLowerCase();
	if (m[2] !== undefined) { // something follows the name: still a command only when it is a whole command that takes text
		const exact = SLASH_COMMANDS.find(c => c.id === name);
		return exact?.takesText ? [exact] : undefined;
	}
	const list = SLASH_COMMANDS.filter(c => c.id.startsWith(name));
	return list.length > 0 ? list : undefined;
}

/** a line that is a whole command (with its text, when it takes some) */
export function parseSlash(text: string): { command: SlashCommand, arg: string } | undefined {
	const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
	if (!m) return undefined;
	const command = SLASH_COMMANDS.find(c => c.id === m[1].toLowerCase());
	if (!command) return undefined;
	const arg = (m[2] ?? '').trim();
	if (!command.takesText && arg) return undefined; // "/plan something" is a sentence, not a command
	return { command, arg };
}

/** what the agent is asked to do for /init */
export const INIT_PROMPT = 'Look at this project and write an AGENTS.md at its root for other coding agents: what the project is, how to build, run and test it (the real commands, checked against the scripts and config you find), where the main parts are, and the conventions the code follows. Say only what you verified in the files. If an AGENTS.md already exists, improve it and keep what is right.';

/** the label of a note saved with /remember: its first line, cut short */
export const noteLabel = (text: string): string => {
	const first = text.trim().split(/\r?\n/)[0] ?? '';
	return first.length > 60 ? first.slice(0, 59) + '…' : first;
};
