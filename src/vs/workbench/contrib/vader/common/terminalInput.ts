/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A command that is waiting for someone to type (board S14, "It is asking for input"): `git push` asking for a password, an installer asking [y/N]. Nothing is typed for it:
// the agent does not guess an answer, and never a password. The last line of what the command printed tells that it is asking, and what. Pure.

export type InputPrompt = { readonly prompt: string; readonly secret: boolean };

const SECRET = /(pass(word|phrase|code)|\bpin\b|token|secret|api[ _-]?key|otp|verification code|2fa|credentials?)/i;
const QUESTION = [
	/\[(y\/n|y\/N|Y\/n|yes\/no)\]\s*\??\s*:?$/i,
	/\((y\/n|yes\/no)\)\s*\??\s*:?$/i,
	/(proceed|continue|overwrite|replace|install|delete|remove)\b[^\n]{0,60}\?\s*$/i,
	/^(enter|type|input|provide|paste|supply|specify|choose|select|please enter)\b[^\n]{0,80}:\s*$/i,
	/(username|user name|login|email|e-mail|name|otp|code|passphrase|password)[^\n]{0,60}:\s*$/i,
	/press (any key|enter|return)\b[^\n]*$/i,
	/^>\s*$/,
	/^\?\s+[^\n]{3,}$/, // an interactive prompt of the kind "? Project name"
];

const stripControls = (s: string) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '');

/** the prompt a command stopped on, from what it printed: its last non-empty line, when that line is a question or a request to type */
export function inputPromptOf(output: string): InputPrompt | undefined {
	const lines = stripControls(output).split('\n').map(l => l.trimEnd()).filter(l => l.trim().length > 0);
	const last = lines[lines.length - 1]?.trim();
	if (!last || last.length > 200) return undefined;
	// a line that ends a sentence, or a shell prompt of the person's own, is not a question
	if (/^(\$|#|PS [^>]*>|[A-Za-z]:\\[^>]*>)\s*$/.test(last)) return undefined;
	if (!QUESTION.some(r => r.test(last))) return undefined;
	return { prompt: last.replace(/^[?>]\s*/, '').replace(/\s*:\s*$/, ''), secret: SECRET.test(last) };
}

/** the first word or two of a command, for the card: `git push origin main` -> `git push` */
export function commandName(command: string): string {
	const words = command.trim().split(/\s+/);
	if (words.length === 0 || !words[0]) return 'The command';
	const second = words[1] && !words[1].startsWith('-') && !/[\\/.]/.test(words[1]) ? ` ${words[1]}` : '';
	return `${words[0]}${second}`;
}

export const waitingWords = (command: string, p: InputPrompt) => ({
	title: 'A command is waiting for input',
	name: commandName(command),
	body: ` is asking: ${p.prompt}. ${p.secret ? 'The agent will not type it.' : 'The agent does not answer questions like this for you.'}`,
	open: 'Open the terminal',
	stopped: 'Vader stopped the command after it went quiet.',
});

/** what the model is told when a command stopped on a question */
export const waitingForModel = (p: InputPrompt): string =>
	`The command stopped because it was waiting for input: "${p.prompt}". ${p.secret ? 'Never type a password, token or key. ' : ''}Do not guess an answer. Tell the person what it asked, and either use a non-interactive form of the command or let them run it in their own terminal.`;

// ---- too many terminals (board S14)

/** the most background terminals the agent may have open at once: each is a shell the person has to look after */
export const MAX_AGENT_TERMINALS = 6;

export const tooManyTerminalsMessage = (open: number): string =>
	`The agent already has ${open} terminals open, the most it can have at once. Close one it no longer needs with kill_persistent_terminal (a finished dev server, a test run, a watcher), then open a new one.`;
