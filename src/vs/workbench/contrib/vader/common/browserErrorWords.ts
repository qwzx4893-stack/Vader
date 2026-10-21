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
	if (/never types a password/.test(message)) {
		return { title: 'This page asks you to sign in', text: 'The agent will not enter a password. Sign in yourself, then let it go on.' };
	}
	const timeout = /Timeout (\d+)\s?ms exceeded/i.exec(message);
	if (timeout && /goto|reload|navigat/i.test(message)) {
		const s = Math.round(Number(timeout[1]) / 1000);
		return { title: 'The page did not load in time', text: `The agent waits for a page up to ${s} seconds. It can try the address again, or go on without that page.` };
	}
	return null;
}

// ---- a field the agent must not type into

export type FieldInfo = { readonly type?: string; readonly autocomplete?: string; readonly name?: string; readonly id?: string; readonly label?: string };

/** a field that takes something only the person should give: a password, a one-time code, a card number or its security code */
export function isSecretField(f: FieldInfo): boolean {
	if ((f.type ?? '').toLowerCase() === 'password') return true;
	if (/\b(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp)\b/i.test(f.autocomplete ?? '')) return true;
	return /(passw|passcode|\bpwd\b|\bcvv\b|\bcvc\b|security code|card number)/i.test(`${f.name ?? ''} ${f.id ?? ''} ${f.label ?? ''}`);
}

/** what the agent is told, and what the chat shows under the card, when it tried to type into such a field */
export const SECRET_FIELD_REFUSAL = 'This page asks you to sign in or to give a secret. Vader never types a password, a code or a card number for the agent. Tell the person to do it themselves in their own browser, then continue from where it left off.';
