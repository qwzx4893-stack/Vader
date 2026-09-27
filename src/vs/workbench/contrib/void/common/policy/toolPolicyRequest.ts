/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { BuiltinToolCallParams, BuiltinToolName, ToolCallParams, ToolName } from '../toolsServiceTypes.js';
import { IPolicyRequest } from './policyServiceTypes.js';

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
			return { kind: 'file-read', toolName, filePaths: pathOf((p as any).uri), agentId };

		case 'rewrite_file':
		case 'edit_file':
			return { kind: 'file-write', toolName, filePaths: pathOf((p as any).uri), agentId };

		case 'create_file_or_folder':
			return { kind: 'file-write', toolName, filePaths: pathOf((p as any).uri), agentId };

		case 'delete_file_or_folder':
			return { kind: 'file-delete', toolName, filePaths: pathOf((p as any).uri), agentId };

		case 'run_command':
		case 'run_persistent_command':
			return { kind: 'terminal-command', toolName, command: (p as any).command, agentId };

		// directory/search listings and terminal lifecycle management (not execution) aren't gated
		case 'ls_dir':
		case 'get_dir_tree':
		case 'search_pathnames_only':
		case 'search_for_files':
		case 'open_persistent_terminal':
		case 'kill_persistent_terminal':
			return null;

		default:
			return null;
	}
}
