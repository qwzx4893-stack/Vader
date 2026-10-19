/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the safety gate says when it asks, and when it refuses (boards S02 and R07): the same shape each time, what is asked or refused, where, why, and the choices.
// The gate itself is in chatThreadService (_hardRulesCheck, _evaluateToolCallGate); the words are made here from what the gate decided, so a card can only say what
// really happened: a rule id that exists, a path that was really named, a command exactly as it was written.

export type GateBy = 'policy' | 'agent-scope' | 'read-only';

/** what the gate decided, kept with the tool message so the chat can say it in words after a restart */
export type GateInfo = {
	readonly by: GateBy;
	readonly effect: 'ask' | 'deny';
	/** the rule that decided (policy only) */
	readonly ruleId?: string;
	readonly reason: string;
};

export type GateAction =
	| 'allow-once' | 'allow' | 'allow-project' | 'allow-host' | 'install-off' | 'read-first' | 'reject' | 'ok'
	| 'open-rule' | 'change-rule' | 'open-agent-settings' | 'switch-agent';

export type GateSpec = {
	/** ask: waits for the person; blocked: it did not run, and says why */
	readonly tone: 'ask' | 'blocked';
	readonly kind: 'command' | 'outside-read' | 'outside-change' | 'network' | 'skill' | 'mcp' | 'extension' | 'edit' | 'rule' | 'locked' | 'agent-scope' | 'read-only' | 'generic';
	readonly title: string;
	readonly text?: string;
	/** the exact thing, in a code block */
	readonly code?: string;
	/** a short line under the code block */
	readonly note?: string;
	/** the rule's id, shown small */
	readonly ruleId?: string;
	/** a skill that is asked to be installed: its name, where from, size and trust */
	readonly skill?: { readonly name: string, readonly source?: string, readonly sizeKb?: number };
	readonly actions: readonly GateAction[];
};

export type GateInput = {
	readonly toolName: string;
	/** the validated parameters as saved with the message (a uri may be a string or { fsPath }) */
	readonly params?: unknown;
	readonly mcpServerName?: string;
	readonly gate?: GateInfo;
	readonly mode: 'safe' | 'balanced' | 'autonomous';
	readonly projectName?: string;
	/** whether the person may stop being asked about this exact thing in this project */
	readonly canRemember: boolean;
};

const fsPathOf = (u: unknown): string | undefined => {
	if (typeof u === 'string') return u;
	const p = (u as { fsPath?: unknown } | undefined)?.fsPath;
	return typeof p === 'string' ? p : undefined;
};
const WIN = (p: string) => p.replace(/\//g, '\\');
/** a path as the person reads it: backslashes on Windows paths, as written otherwise */
export const showPath = (p: string): string => /^[a-zA-Z]:[\\/]/.test(p) ? WIN(p) : p;
const clip = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s;
export const MODE_WORD = { safe: 'Safe', balanced: 'Balanced', autonomous: 'Autonomous' } as const;

export function hostOf(url: string): string | undefined {
	try { return new URL(url).host || undefined; } catch { return undefined; }
}

const COMMAND_TOOLS = new Set(['run_command', 'run_persistent_command']);
const FILE_CHANGE_TOOLS = new Set(['edit_file', 'rewrite_file', 'create_file_or_folder', 'delete_file_or_folder']);

/** the question when the gate waits for the person */
export function gateSpecOfRequest(i: GateInput): GateSpec {
	const params = i.params as { command?: unknown, url?: unknown, name?: unknown, repositoryUrl?: unknown, instructions?: unknown, itemName?: unknown, providerId?: unknown } | undefined;
	const rule = i.gate?.by === 'policy' ? i.gate.ruleId : undefined;
	const where = i.projectName ? `In ${i.projectName}. ` : '';
	const remember: GateAction[] = i.canRemember ? ['allow-project'] : [];

	// the rules that always ask, even in Autonomous mode: said as such, with the rule's own words
	if (i.gate?.by === 'policy' && i.gate.effect === 'ask' && rule && rule !== 'vader.ask.outside-project-read' && rule !== 'vader.ask.network-new-host') {
		const command = typeof params?.command === 'string' ? params.command : undefined;
		const path = fsPathOf((i.params as { uri?: unknown } | undefined)?.uri);
		const isInstall = rule === 'vader.ask.install-capability';
		const custom = rule.startsWith('vader.custom.');
		if (isInstall && (i.toolName === 'install_skill')) return skillSpec(i, params);
		return {
			tone: 'ask', kind: 'rule',
			title: command && /\b(install|add)\b/i.test(command) && /\b(npm|pnpm|yarn|pip|cargo|gem|go)\b/i.test(command) ? 'Install a package?' : COMMAND_TOOLS.has(i.toolName) ? 'Run a command?' : FILE_CHANGE_TOOLS.has(i.toolName) ? 'Change a file?' : isInstall ? 'Install something?' : 'Allow this action?',
			text: custom ? `Your rule “${clip(i.gate.reason, 80)}” always asks, even in this project.` : `${i.gate.reason.replace(/\.$/, '')}. It always asks, even in Autonomous mode.`,
			code: command ?? (path ? showPath(path) : undefined),
			ruleId: rule,
			actions: ['allow-once', 'reject', 'change-rule'],
		};
	}
	if (i.gate?.by === 'policy' && rule === 'vader.ask.outside-project-read') {
		const p = fsPathOf((i.params as { uri?: unknown } | undefined)?.uri);
		return { tone: 'ask', kind: 'outside-read', title: 'Read a file outside this project?', text: p ? `${showPath(p)} is not inside ${i.projectName ?? 'this project'}. Only this once.` : 'That file is not inside this project. Only this once.', ruleId: rule, actions: ['allow-once', 'reject'] };
	}
	if (i.gate?.by === 'policy' && rule === 'vader.ask.network-new-host') {
		const url = typeof params?.url === 'string' ? params.url : '';
		const host = hostOf(url);
		return { tone: 'ask', kind: 'network', title: 'Call a web address?', text: 'The agent wants to open', code: url ? clip(url, 160) : host, note: host ? `${host} is not on this project’s list of sites.` : undefined, ruleId: rule, actions: ['allow-once', ...(i.canRemember && host ? ['allow-host' as const] : []), 'reject'] };
	}

	if (i.toolName === 'install_skill') return skillSpec(i, params);
	if (i.toolName === 'install_marketplace_capability') {
		const what = typeof params?.itemName === 'string' ? params.itemName : 'this';
		return { tone: 'ask', kind: 'extension', title: `Install “${clip(what, 60)}”?`, text: 'An extension or an MCP server can run code on this computer, so installing one always asks.', actions: ['allow-once', 'reject'] };
	}
	if (COMMAND_TOOLS.has(i.toolName)) {
		const command = typeof params?.command === 'string' ? params.command : '';
		return { tone: 'ask', kind: 'command', title: 'Run a command?', text: `${where}It can write files.`, code: command, note: command.length > 80 ? `The whole command is shown.` : undefined, actions: ['allow-once', ...remember, 'reject'] };
	}
	if (i.toolName === 'open_persistent_terminal') return { tone: 'ask', kind: 'command', title: 'Open a terminal?', text: `${where}It stays open until it is closed.`, actions: ['allow-once', ...remember, 'reject'] };
	if (!isBuiltIn(i.toolName)) {
		const server = i.mcpServerName ?? 'a server';
		const tool = i.toolName.replace(/^[^_]*_/, '');
		return { tone: 'ask', kind: 'mcp', title: `Use a tool from ${server}?`, text: `${tool} on ${i.projectName ?? 'this project'}.`, code: tool, actions: ['allow-once', ...remember, 'reject'] };
	}
	if (FILE_CHANGE_TOOLS.has(i.toolName) || i.toolName === 'rewrite_file') {
		const p = fsPathOf((i.params as { uri?: unknown } | undefined)?.uri);
		const verb = i.toolName === 'delete_file_or_folder' ? 'Delete' : i.toolName === 'create_file_or_folder' ? 'Create' : i.toolName === 'rewrite_file' ? 'Rewrite' : 'Apply an edit to';
		return { tone: 'ask', kind: 'edit', title: verb === 'Apply an edit to' ? 'Apply an edit?' : `${verb} a file?`, code: p ? showPath(p) : undefined, actions: ['allow-once', ...remember, 'reject'] };
	}
	return { tone: 'ask', kind: 'generic', title: 'Allow this action?', actions: ['allow-once', 'reject'] };
}

function isBuiltIn(toolName: string): boolean {
	return /^(read_file|ls_dir|get_dir_tree|search_|edit_file|rewrite_file|create_file|delete_file|run_|open_persistent|kill_persistent|browser_|read_lint|install_|delegate_|update_task|remember|use_skill|discover)/.test(toolName);
}

function skillSpec(i: GateInput, params: { name?: unknown, repositoryUrl?: unknown, instructions?: unknown } | undefined): GateSpec {
	const name = typeof params?.name === 'string' ? params.name : 'this skill';
	const repo = typeof params?.repositoryUrl === 'string' ? params.repositoryUrl.replace(/^https?:\/\/(www\.)?github\.com\//, 'github.com/').replace(/\.git$/, '') : undefined;
	const size = typeof params?.instructions === 'string' ? Math.max(1, Math.round(params.instructions.length / 1000)) : undefined;
	return {
		tone: 'ask', kind: 'skill', title: 'Install a skill', skill: { name, source: repo, sizeKb: size },
		text: 'A skill changes every later prompt, so it always asks. It is stored switched off until you read it.', ruleId: i.gate?.ruleId,
		actions: ['install-off', 'read-first', 'reject'],
	};
}

/** the words when the gate refused: nothing ran, and why */
export function gateSpecOfBlock(i: GateInput): GateSpec {
	const g = i.gate;
	const params = i.params as { command?: unknown, uri?: unknown } | undefined;
	const command = typeof params?.command === 'string' ? params.command : undefined;
	const path = fsPathOf(params?.uri);
	if (g?.by === 'read-only') {
		const what = command ?? path ?? i.toolName.replace(/_/g, ' ');
		return { tone: 'blocked', kind: 'read-only', title: `${g.reason.replace(/^Blocked:\s*/, '').split(' is read-only')[0] || 'This mode'} is read-only`, text: `${clip(what, 80)} was not run. Switch to Agent to allow changes.`, code: command ? clip(command, 120) : undefined, actions: ['switch-agent'] };
	}
	if (g?.by === 'agent-scope') {
		const m = /Agent "([^"]+)" is not permitted to (.+)\.$/.exec(g.reason);
		const only = /may only touch ([^.]+?)(?:\.|$)/.exec(g.reason);
		return { tone: 'blocked', kind: 'agent-scope', title: only ? 'Blocked: outside this agent’s folders' : 'Blocked: not allowed for this agent', text: m ? `${m[1]} is not permitted to ${m[2]}.` : g.reason, code: path ? showPath(path) : command, actions: ['open-agent-settings'] };
	}
	const rule = g?.ruleId ?? '';
	const target = command ?? (path ? showPath(path) : undefined);
	if (rule === 'vader.deny.credential-files') {
		return { tone: 'blocked', kind: 'locked', title: 'Blocked: credential file', text: `${target ? `Reading ${target}` : 'Reading a credential file'} is never allowed. This rule cannot be switched off in any mode.`, ruleId: rule, note: 'The agent was told why and is looking for another way.', actions: ['open-rule'] };
	}
	const short = (g?.reason ?? 'refused').replace(/^Blocked:\s*/, '').replace(/\.$/, '');
	const lower = short.charAt(0).toLowerCase() + short.slice(1);
	return { tone: 'blocked', kind: 'locked', title: `Blocked: ${clip(rule === 'vader.deny.destructive-fs' ? 'a command that would delete a system or home folder' : rule === 'vader.deny.fork-bomb' ? 'a fork bomb' : rule === 'vader.deny.system-critical-paths' ? 'a system file' : lower, 70)}`, text: `${target ? '' : ''}This is never allowed, even in Autonomous mode. Ask for something narrower, or do it yourself.`, code: target ? clip(target, 160) : undefined, ruleId: rule || undefined, actions: ['ok', 'open-rule'] };
}
