/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The Policy Engine is Vader's hard, pre-execution permission gate. It sits in front of
// every tool/terminal/MCP call an agent makes and is evaluated regardless of what the
// model was told to do: a model that ignores its system prompt still cannot get past a
// 'deny' rule here, and an 'ask' rule still forces a human approval prompt even when the
// user has globally auto-approved that tool category. See ARCHITECTURE.md for how this
// fits with the rest of the agent platform.

export type PolicyRequestKind =
	| 'file-read'
	| 'file-write'
	| 'file-delete'
	| 'terminal-command'
	| 'mcp-tool'
	| 'network'

export interface IPolicyRequest {
	readonly kind: PolicyRequestKind;
	readonly toolName: string;
	/** absolute fs paths involved, for file-read/file-write/file-delete */
	readonly filePaths?: string[];
	/** the literal command string, for terminal-command */
	readonly command?: string;
	/** which MCP server this call would go to, for mcp-tool */
	readonly mcpServerName?: string;
	/** the permanent agent (if any) making this request, for per-agent scoping */
	readonly agentId?: string;
}

export type PolicyVerdict =
	| { readonly kind: 'allow' }
	| { readonly kind: 'deny'; readonly reason: string; readonly ruleId: string }
	| { readonly kind: 'ask'; readonly reason: string; readonly ruleId: string };

export type PolicyMode = 'safe' | 'balanced' | 'autonomous';

export interface PolicyRule {
	readonly id: string;
	readonly description: string;
	readonly effect: 'deny' | 'ask';
	readonly kinds: PolicyRequestKind[];
	/** glob patterns (vs/base/common/glob syntax) matched against absolute fs paths */
	readonly pathGlobs?: string[];
	/** regex source strings (case-insensitive) matched against the terminal command */
	readonly commandPatterns?: string[];
	/** true for Vader's built-in rules; false for user-defined rules */
	readonly builtIn: boolean;
	/** true = cannot be disabled or deleted from settings at all (the true hard invariants) */
	readonly locked: boolean;
	/** for 'ask' rules only: still ask even in autonomous mode with auto-approve on */
	readonly neverBypassAutonomous: boolean;
	readonly enabled: boolean;
}

export type UserPolicyRuleInput = {
	description: string;
	effect: 'deny' | 'ask';
	kinds: PolicyRequestKind[];
	pathGlobs?: string[];
	commandPatterns?: string[];
	neverBypassAutonomous?: boolean;
};

export interface PolicyServiceState {
	readonly mode: PolicyMode;
	readonly customRules: PolicyRule[];
	/** ids of built-in (non-locked) rules the user has disabled */
	readonly disabledBuiltInRuleIds: string[];
}
