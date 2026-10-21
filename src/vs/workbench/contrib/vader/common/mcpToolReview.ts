/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// "A tool changed" (board S07): the tools of an MCP server are what the person saw when they added it. If the server later offers a tool that was not there, the agent is not
// given it until the person has said yes: a server (or a package it downloads) that changes under them could otherwise hand the agent a new power - delete_repository - without
// anyone being asked. Pure.

export type ToolReviewState = { readonly approvedTools?: readonly string[]; readonly offTools?: readonly string[] };

/** the tools the agent may be given, the new ones waiting for an answer, and the ones the person keeps off */
export function reviewTools(state: ToolReviewState | undefined, current: readonly string[]): { allowed: string[]; pending: string[]; off: string[]; firstLook: boolean } {
	// a server that was never looked at: what it offers now is what the person is adding; it is recorded as approved (the caller does that) and nothing waits
	if (!state || state.approvedTools === undefined) return { allowed: [...current], pending: [], off: [], firstLook: true };
	const approved = new Set(state.approvedTools), off = new Set(state.offTools ?? []);
	const allowed: string[] = [], pending: string[] = [], keptOff: string[] = [];
	for (const t of current) {
		if (off.has(t)) keptOff.push(t);
		else if (approved.has(t)) allowed.push(t);
		else pending.push(t);
	}
	return { allowed, pending, off: keptOff, firstLook: false };
}

export const allowTools = (state: ToolReviewState | undefined, names: readonly string[]): Required<ToolReviewState> => ({
	approvedTools: [...new Set([...(state?.approvedTools ?? []), ...names])],
	offTools: (state?.offTools ?? []).filter(o => !names.includes(o)),
});

export const keepToolsOff = (state: ToolReviewState | undefined, names: readonly string[]): Required<ToolReviewState> => ({
	approvedTools: (state?.approvedTools ?? []).filter(a => !names.includes(a)),
	offTools: [...new Set([...(state?.offTools ?? []), ...names])],
});

export const toolChangedWords = (server: string, pending: readonly string[]) => ({
	title: pending.length === 1 ? `${server} added a tool` : `${server} added ${pending.length} tools`,
	/** the names are set in code by the card */
	body: pending.length === 1
		? `The server now offers ${pending[0]}. It was not there when you added the server.`
		: `The server now offers ${pending.slice(0, -1).join(', ')} and ${pending[pending.length - 1]}. They were not there when you added the server.`,
	keepOff: 'Keep it off',
	allow: pending.length === 1 ? 'Allow it' : 'Allow them',
	remove: 'Remove the server',
});

/** may the agent call this tool of this server: refuses one that is new and not answered, or kept off */
export function toolCallRefusal(state: ToolReviewState | undefined, server: string, tool: string): string | undefined {
	if (!state || state.approvedTools === undefined) return undefined;
	if ((state.offTools ?? []).includes(tool)) return `${tool} of ${server} is kept off. Turn it on in Settings, MCP servers.`;
	if (!state.approvedTools.includes(tool)) return `${tool} of ${server} was added after you set the server up and has not been allowed yet. Allow it in Settings, MCP servers.`;
	return undefined;
}
