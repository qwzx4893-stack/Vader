/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the chat says when a connected agent (Codex, Claude Code and the others) cannot go on (board S07): it needs its own sign-in, or its program stopped. The
// words are made from the messages the app really raises for these two cases (browser/chatThreadService.ts, electron-main/externalAgentMainService.ts); anything else
// is left to the general error card. Pure.

export type AgentCard = { readonly title: string, readonly text: string, /** what the "again" button says */ readonly againLabel: string };

/** the card for an error raised while a connected agent was answering, or null when it is not one of the two */
export function cardForAgentError(message: string, chosenAgentName: string | undefined): AgentCard | null {
	const signIn = /^(.+?) needs you to sign in\./.exec(message.trim());
	if (signIn) {
		return { title: `${signIn[1]} is not signed in`, text: 'Finish the sign-in in the terminal that opened, then come back. Vader does not ask for that password.', againLabel: 'I signed in' };
	}
	const stopped = /The agent stopped by itself \((?:exit code (\S+?)|([A-Z]{3,}\d*))\)/.exec(message);
	if (stopped) {
		const name = chosenAgentName ?? 'The agent';
		const how = stopped[1] !== undefined ? `exited with code ${stopped[1]}` : `was ended by ${stopped[2]}`;
		return { title: `${name} closed unexpectedly`, text: `Its process ${how}. The chat so far is kept.`, againLabel: 'Start it again' };
	}
	return null;
}
