/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the chat says when the agent's browser fails (board S14): a page that stopped, one that did not load in time, a page that changed under the agent. The words are
// made from the messages electron-main/browserToolMainService.ts really raises; the real error is always shown under them, and one that is not recognised gets no words
// (it is shown as it is). Pure.

export type BrowserWords = { readonly title: string, readonly text: string };

export function explainBrowserError(message: string): BrowserWords | null {
	if (/is closed \(it may have crashed or been closed by the site itself\)/.test(message)) {
		return { title: 'The page stopped responding', text: 'It may have crashed or been closed by the site itself. The agent opens a new page and goes on.' };
	}
	if (/This element reference is no longer valid/.test(message)) {
		return { title: 'The page changed under the agent', text: 'The page moved on, reloaded or changed since the agent looked at it. It looks at the page again before it tries once more.' };
	}
	const timeout = /Timeout (\d+)\s?ms exceeded/i.exec(message);
	if (timeout && /goto|reload|navigat/i.test(message)) {
		const s = Math.round(Number(timeout[1]) / 1000);
		return { title: 'The page did not load in time', text: `The agent waits for a page up to ${s} seconds. It can try the address again, or go on without that page.` };
	}
	return null;
}
