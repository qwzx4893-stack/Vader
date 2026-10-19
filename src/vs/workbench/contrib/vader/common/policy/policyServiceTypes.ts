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
	| 'capability-install'

export interface IPolicyRequest {
	readonly kind: PolicyRequestKind;
	readonly toolName: string;
	/** absolute fs paths involved, for file-read/file-write/file-delete */
	readonly filePaths?: string[];
	/** the literal command string, for terminal-command */
	readonly command?: string;
	/** for terminal-command: every path-like word in the command (common/policy/commandPaths.ts), so path rules can see what a command touches */
	readonly commandPaths?: string[];
	/** for terminal-command: the subset a command may WRITE to or delete (redirections, cp/mv/tee/sed -i/Set-Content...; read-only viewers excluded) */
	readonly commandWritePaths?: string[];
	/** which MCP server this call would go to, for mcp-tool */
	readonly mcpServerName?: string;
	/** the permanent agent (if any) making this request, for per-agent scoping */
	readonly agentId?: string;
	/** the folders open in the window, for rules about what is outside the project */
	readonly workspaceRoots?: string[];
	/** the address, for network */
	readonly url?: string;
	/** for network: false when the host is not on the project's list (and not this computer), so a new host is asked about once */
	readonly knownHost?: boolean;
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
	/** for a rule that lists 'terminal-command' among its kinds together with pathGlobs: match the globs against every path in the command ('any', the default) or only against the ones it may write ('write') */
	readonly terminalPathScope?: 'any' | 'write';
	/** regex source strings (case-insensitive) matched against the terminal command */
	readonly commandPatterns?: string[];
	/** regex source strings (case-insensitive) matched against mcpServerName, for kind 'mcp-tool'. Omitted = matches every MCP server (a deliberate, legitimate blanket rule for this kind only - see policyService.ts's ruleMatches). */
	readonly serverNamePatterns?: string[];
	/** true for Vader's built-in rules; false for user-defined rules */
	readonly builtIn: boolean;
	/** true = cannot be disabled or deleted from settings at all (the true hard invariants) */
	readonly locked: boolean;
	/** for 'ask' rules only: still ask even in autonomous mode with auto-approve on */
	readonly neverBypassAutonomous: boolean;
	readonly enabled: boolean;
	/** matches a file request only when a path it names is outside every open folder (nothing matches when no folder is open) */
	readonly outsideWorkspace?: boolean;
	/** matches a network request only when its host is new to the project */
	readonly unknownHostOnly?: boolean;
}

export type UserPolicyRuleInput = {
	description: string;
	effect: 'deny' | 'ask';
	kinds: PolicyRequestKind[];
	pathGlobs?: string[];
	commandPatterns?: string[];
	serverNamePatterns?: string[];
	neverBypassAutonomous?: boolean;
};

export interface PolicyServiceState {
	readonly mode: PolicyMode;
	readonly customRules: PolicyRule[];
	/** ids of built-in (non-locked) rules the user has disabled */
	readonly disabledBuiltInRuleIds: string[];
}
