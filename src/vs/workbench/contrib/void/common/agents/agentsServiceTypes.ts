/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { ModelSelection } from '../voidSettingsTypes.js';
import { ToolApprovalType } from '../toolsServiceTypes.js';

/**
 * A permanent, persistent agent: a named identity with its own instructions, optional
 * model override, and optional tool/filesystem restrictions, that a user (or the main
 * agent itself, per Vader's mission) can create once and reuse across sessions. Contrast
 * with a temporary subagent (agents/subagentService.ts), which exists only for the
 * duration of one delegated task and leaves no persistent identity behind.
 */
export interface PermanentAgentDefinition {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	/** becomes the 'agent' layer in the layered instruction system for threads running as this agent */
	readonly instructions: string;
	/** null = inherit whatever model the thread/feature would otherwise use */
	readonly modelSelection: ModelSelection | null;
	/** approval categories this agent is even allowed to request; omit a category to block those tools entirely for this agent */
	readonly allowedApprovalTypes: ToolApprovalType[];
	/** specific tool names (built-in or MCP) this agent may never call, even if its approval type is allowed */
	readonly deniedToolNames: string[];
	/** if set, restricts MCP tool access to these server names only; undefined = whatever's globally enabled */
	readonly mcpServerNames?: string[];
	/** if set, file read/write/delete is restricted to paths matching at least one of these globs */
	readonly filesystemScopeGlobs?: string[];
	readonly createdBy: 'user' | 'main-agent';
	readonly createdAt: number;
}

export type CreatePermanentAgentInput = {
	name: string;
	description: string;
	instructions: string;
	modelSelection?: ModelSelection | null;
	allowedApprovalTypes?: ToolApprovalType[];
	deniedToolNames?: string[];
	mcpServerNames?: string[];
	filesystemScopeGlobs?: string[];
};

export interface AgentsServiceState {
	readonly agents: PermanentAgentDefinition[];
}
