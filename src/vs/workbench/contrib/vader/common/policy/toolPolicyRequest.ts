/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { BuiltinToolCallParams, BuiltinToolName, ToolCallParams, ToolName } from '../toolsServiceTypes.js';
import { IPolicyRequest } from './policyServiceTypes.js';
import { pathsInCommand } from './commandPaths.js';

/** A terminal command, with the paths its text names, so that the path rules (credential files, files that run code on their own) see it too. */
const terminalRequest = (toolName: string, command: unknown, agentId: string | undefined): IPolicyRequest => {
	const text = typeof command === 'string' ? command : '';
	const { all, writes } = pathsInCommand(text);
	return { kind: 'terminal-command', toolName, command: text || undefined, commandPaths: all, commandWritePaths: writes, agentId };
};

const isURI = (v: unknown): v is URI => !!v && typeof v === 'object' && URI.isUri(v as any);

/**
 * Maps a tool call (built-in or MCP) to the policy request the Policy Engine should
 * evaluate, or null if this tool call carries nothing the policy engine gates (e.g. pure
 * in-memory lookups). Built-in tools are mapped precisely by name; MCP tools are treated
 * as a single opaque 'mcp-tool' request scoped to their server.
 */
export function policyRequestOfToolCall(
	toolName: ToolName,
	toolParams: ToolCallParams<ToolName>,
	isBuiltInTool: boolean,
	mcpServerName: string | undefined,
	agentId: string | undefined,
	ctx?: { readonly workspaceRoots?: string[], /** whether a host is already allowed for this project (or is this computer) */ readonly isKnownHost?: (host: string) => boolean },
): IPolicyRequest | null {
	if (!isBuiltInTool) {
		return { kind: 'mcp-tool', toolName, mcpServerName, agentId };
	}

	const name = toolName as BuiltinToolName;
	const p = toolParams as BuiltinToolCallParams[BuiltinToolName];

	const pathOf = (u: unknown): string[] | undefined => isURI(u) ? [u.fsPath] : undefined;

	switch (name) {
		case 'read_file':
		case 'search_in_file':
		case 'read_lint_errors':
		case 'ls_dir':
		case 'get_dir_tree':
			return { kind: 'file-read', toolName, filePaths: pathOf((p as any).uri), agentId, workspaceRoots: ctx?.workspaceRoots };

		case 'search_for_files':
			return (p as any).searchInFolder ? { kind: 'file-read', toolName, filePaths: pathOf((p as any).searchInFolder), agentId, workspaceRoots: ctx?.workspaceRoots } : null;

		// a page the agent opens: the first time a host is seen in a project it is asked about, then it can be allowed for the project
		case 'browser_navigate': {
			const url = typeof (p as any).url === 'string' ? (p as any).url : '';
			let host = '';
			try { host = new URL(url).hostname; } catch { /* the tool refuses an address that is not valid */ }
			if (!host) return null;
			return { kind: 'network', toolName, url, knownHost: ctx?.isKnownHost ? ctx.isKnownHost(host) : true, agentId };
		}

		case 'rewrite_file':
		case 'edit_file':
			return { kind: 'file-write', toolName, filePaths: pathOf((p as any).uri), agentId };

		case 'create_file_or_folder':
			return { kind: 'file-write', toolName, filePaths: pathOf((p as any).uri), agentId };

		case 'delete_file_or_folder':
			return { kind: 'file-delete', toolName, filePaths: pathOf((p as any).uri), agentId };

		case 'run_command':
		case 'run_persistent_command':
			return terminalRequest(toolName, (p as any).command, agentId);

		// Installing a skill or a marketplace item (an extension or an MCP server) can run arbitrary code or change every future prompt. Their
		// approval bucket is 'edits', which users commonly auto-approve, so without this request nothing would ever stop an injected model installing one.
		case 'install_skill':
		case 'install_marketplace_capability':
			return { kind: 'capability-install', toolName, agentId };

		// directory/search listings and terminal lifecycle management (not execution) aren't gated
		case 'search_pathnames_only':
		case 'open_persistent_terminal':
		case 'kill_persistent_terminal':
			return null;

		default:
			return null;
	}
}
