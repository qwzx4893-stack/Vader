/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the MCP page says when a server did not start or is starting (board S07): the real error, put in words that say what to do. The error text itself is always
// kept (it is shown under the words), so a message that is not recognised is still the real one, never a guess. Pure.

const RUNNERS: { [exe: string]: string } = { npx: 'Node.js', node: 'Node.js', npm: 'Node.js', uvx: 'uv', uv: 'uv', python: 'Python', python3: 'Python', docker: 'Docker', deno: 'Deno', bunx: 'Bun', bun: 'Bun' };

/** the program a server's command starts ("npx -y @github/mcp" -> "npx") */
export const executableOf = (command: string | undefined): string | undefined => {
	const first = (command ?? '').trim().split(/\s+/)[0];
	if (!first) return undefined;
	return first.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
};

export type StartWords = { readonly title: string, readonly text: string };

/** why a server did not start, said so the person can act on it */
export function explainStart(name: string, command: string | undefined, error: string): StartWords {
	const title = `${name} did not start`;
	const exe = executableOf(command);
	if (/ENOENT|not recognized as an internal|command not found|not found in PATH/i.test(error)) {
		const tool = exe ? RUNNERS[exe] : undefined;
		return { title, text: exe ? `\`${exe}\` was not found.${tool ? ` Install ${tool}, or give the full path to it.` : ' Install it, or give the full path to it.'}` : 'The program that starts this server was not found. Install it, or give the full path to it.' };
	}
	if (/timed? ?out|did not respond|ETIMEDOUT/i.test(error)) return { title, text: 'It did not answer in time. The first start can take a moment while the package downloads, so trying again often works.' };
	if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid.*(key|token)|api[ _-]?key|bad credentials/i.test(error)) return { title, text: 'The service refused the key or token. Check it in the config file.' };
	if (/EACCES|permission denied/i.test(error)) return { title, text: 'This computer did not allow the program to run. Check that you may run it.' };
	if (/ECONNREFUSED|ENOTFOUND|getaddrinfo|network/i.test(error)) return { title, text: 'The server could not be reached. Check the address and the connection.' };
	return { title, text: 'It stopped when it was started. The error it gave is below.' };
}

/** under a server that is starting: why it can take a while, only when that is true */
export function startingHint(command: string | undefined): string | undefined {
	const exe = executableOf(command);
	return exe && ['npx', 'uvx', 'bunx', 'docker'].includes(exe) ? 'The first start can take a moment while the package downloads.' : undefined;
}

/** "4 tools. Each use goes through the safety gate." */
export const toolsLine = (n: number): string => `${n} tool${n === 1 ? '' : 's'}. Each use goes through the safety gate.`;
