/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The file in a project folder that tells the agent how to work there. Vader's own is `.vaderrules`; `AGENTS.md` is the shared convention that Codex, OpenCode, Cursor,
// Copilot, Cline and others read (https://agents.md), and `CLAUDE.md` is Claude Code's. A project that already has one of them works the same in Vader without a copy.
// The first one found in a folder is used, in this order. Like `.vaderrules`, the text is framed as possibly written by someone else (a cloned repository's author):
// it guides the work, it never grants permission (common/instructions/instructionsService.ts UNTRUSTED_LAYER_FRAMING).

export const WORKSPACE_RULES_FILES = ['.vaderrules', 'AGENTS.md', 'CLAUDE.md'] as const

/** a rules file larger than this is cut (a very long file would take the room of the work itself) */
export const MAX_WORKSPACE_RULES_CHARS = 24_000

export const limitWorkspaceRules = (text: string): string =>
	text.length <= MAX_WORKSPACE_RULES_CHARS ? text : text.slice(0, MAX_WORKSPACE_RULES_CHARS) + '\n\n[The rules file is longer than Vader reads (' + MAX_WORKSPACE_RULES_CHARS + ' characters); the rest was left out.]'
