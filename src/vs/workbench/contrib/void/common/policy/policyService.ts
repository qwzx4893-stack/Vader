/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { compileModelRegex } from '../helpers/safeRegex.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { match as matchGlob } from '../../../../../base/common/glob.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { VADER_POLICY_STORAGE_KEY } from '../storageKeys.js';
import { builtInPolicyRules } from './builtInPolicyRules.js';
import { normalizeCommandForPolicy } from './commandNormalizer.js';
import { IPolicyRequest, PolicyMode, PolicyRule, PolicyServiceState, PolicyVerdict, UserPolicyRuleInput } from './policyServiceTypes.js';

export * from './policyServiceTypes.js';
export { builtInPolicyRules } from './builtInPolicyRules.js';

const defaultState: PolicyServiceState = {
	mode: 'balanced',
	customRules: [],
	disabledBuiltInRuleIds: [],
};

export interface IPolicyService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<void>;
	readonly state: PolicyServiceState;

	/** every rule currently in effect (built-in + custom), for display in settings UI */
	getAllRules(): PolicyRule[];

	/**
	 * The hard, pre-execution check every tool/terminal/MCP call must pass through.
	 * `extraRules` lets a caller (e.g. the running permanent agent's own restrictions)
	 * contribute additional rules for just this one call, without persisting them.
	 */
	evaluate(req: IPolicyRequest, extraRules?: PolicyRule[]): PolicyVerdict;

	setMode(mode: PolicyMode): void;
	addCustomRule(rule: UserPolicyRuleInput): PolicyRule;
	removeCustomRule(id: string): void;
	setRuleEnabled(id: string, enabled: boolean): void; // works for custom rules, and for non-locked built-in rules
}

export const IPolicyService = createDecorator<IPolicyService>('vaderPolicyService');

// User-written rules are text from a settings box and run on the renderer thread against every command a model proposes: a pattern such as
// (a+)+$ would freeze the window on the next tool call. Built-in patterns are ours and are used as written. A user pattern that cannot be
// evaluated safely (nested repetition, absurd length) is treated as MATCHING: for a deny/ask rule the failure mode must be "still protects", never
// "silently stops protecting". A pattern that is not valid regex syntax keeps its old meaning (does not match); the settings UI refuses to save both.
const MAX_POLICY_INPUT_CHARS = 20_000;

const patternMatches = (builtIn: boolean, src: string, texts: string[]): boolean => {
	if (builtIn) {
		try { const re = new RegExp(src, 'i'); return texts.some(t => re.test(t)); }
		catch { return false; }
	}
	const compiled = compileModelRegex(src, 'i');
	if (!compiled.ok) {
		try { new RegExp(src, 'i'); } catch { return false; } // invalid syntax: ignored, as before
		return true; // valid but unsafe to run: fail closed
	}
	return texts.some(t => compiled.regex.test(t.slice(0, MAX_POLICY_INPUT_CHARS)));
};

export const ruleMatches = (rule: PolicyRule, req: IPolicyRequest): boolean => {
	if (!rule.kinds.includes(req.kind)) return false;

	if (rule.pathGlobs && rule.pathGlobs.length) {
		const paths = req.filePaths ?? [];
		if (paths.length === 0) return false;
		// Case-insensitive on every platform: on Windows the file system is, and URI.fsPath lowercases the
		// drive letter (`c:`), so a case-sensitive `C:/Windows/**` rule never matched any real path.
		const hit = paths.some(p => rule.pathGlobs!.some(g => matchGlob(g.toLowerCase(), p.replace(/\\/g, '/').toLowerCase())));
		if (!hit) return false;
	}

	if (rule.commandPatterns && rule.commandPatterns.length) {
		const command = req.command ?? '';
		if (!command) return false;
		const normalized = normalizeCommandForPolicy(command);
		const hit = rule.commandPatterns.some(src => patternMatches(rule.builtIn, src, [command, normalized]));
		if (!hit) return false;
	}

	if (rule.serverNamePatterns && rule.serverNamePatterns.length) {
		const serverName = req.mcpServerName ?? '';
		if (!serverName) return false;
		const hit = rule.serverNamePatterns.some(src => patternMatches(rule.builtIn, src, [serverName]));
		if (!hit) return false;
	}

	// A rule with none of pathGlobs/commandPatterns/serverNamePatterns matches every request
	// of its kind. For file-read/file-write/file-delete/terminal-command that's almost
	// certainly a mistake (an unqualified rule would silently gate every single file
	// operation or command), so it's required there. For mcp-tool and network, "ask/deny for
	// every call of this kind" is a real, legitimate blanket stance a user might deliberately
	// want (e.g. "ask before any MCP tool call, I don't trust third-party servers by
	// default") - previously this was actually impossible: every 'mcp-tool'/'network' rule
	// was unreachable dead code, since the old version of this check unconditionally
	// required pathGlobs or commandPatterns, which those two kinds can never have.
	const hasDiscriminator = !!(rule.pathGlobs?.length || rule.commandPatterns?.length || rule.serverNamePatterns?.length);
	if (!hasDiscriminator && req.kind !== 'mcp-tool' && req.kind !== 'network' && req.kind !== 'capability-install') {
		return false;
	}

	return true;
};

class PolicyService extends Disposable implements IPolicyService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private _state: PolicyServiceState;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();
		this._state = this._readState();
	}

	get state(): PolicyServiceState { return this._state; }

	private _readState(): PolicyServiceState {
		try {
			const raw = this._storageService.get(VADER_POLICY_STORAGE_KEY, StorageScope.APPLICATION);
			if (!raw) return defaultState;
			const parsed = JSON.parse(raw);
			return {
				mode: parsed.mode ?? defaultState.mode,
				customRules: Array.isArray(parsed.customRules) ? parsed.customRules : [],
				disabledBuiltInRuleIds: Array.isArray(parsed.disabledBuiltInRuleIds) ? parsed.disabledBuiltInRuleIds : [],
			};
		} catch {
			return defaultState;
		}
	}

	private _writeState() {
		this._storageService.store(VADER_POLICY_STORAGE_KEY, JSON.stringify(this._state), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeState.fire();
	}

	getAllRules(): PolicyRule[] {
		const builtIns = builtInPolicyRules.map(r => (
			r.locked ? r : { ...r, enabled: !this._state.disabledBuiltInRuleIds.includes(r.id) }
		));
		return [...builtIns, ...this._state.customRules];
	}

	evaluate(req: IPolicyRequest, extraRules?: PolicyRule[]): PolicyVerdict {
		const rules = [...this.getAllRules(), ...(extraRules ?? [])].filter(r => r.enabled);

		// deny takes priority, and is never bypassed by mode
		for (const rule of rules) {
			if (rule.effect !== 'deny') continue;
			if (ruleMatches(rule, req)) {
				return { kind: 'deny', reason: rule.description, ruleId: rule.id };
			}
		}

		for (const rule of rules) {
			if (rule.effect !== 'ask') continue;
			if (!ruleMatches(rule, req)) continue;
			if (this._state.mode === 'autonomous' && !rule.neverBypassAutonomous) continue; // downgrade to allow
			return { kind: 'ask', reason: rule.description, ruleId: rule.id };
		}

		return { kind: 'allow' };
	}

	setMode(mode: PolicyMode): void {
		this._state = { ...this._state, mode };
		this._writeState();
	}

	addCustomRule(input: UserPolicyRuleInput): PolicyRule {
		const rule: PolicyRule = {
			id: `vader.custom.${generateUuid()}`,
			description: input.description,
			effect: input.effect,
			kinds: input.kinds,
			pathGlobs: input.pathGlobs,
			commandPatterns: input.commandPatterns,
			serverNamePatterns: input.serverNamePatterns,
			builtIn: false,
			locked: false,
			neverBypassAutonomous: input.neverBypassAutonomous ?? (input.effect === 'deny'),
			enabled: true,
		};
		this._state = { ...this._state, customRules: [...this._state.customRules, rule] };
		this._writeState();
		return rule;
	}

	removeCustomRule(id: string): void {
		this._state = { ...this._state, customRules: this._state.customRules.filter(r => r.id !== id) };
		this._writeState();
	}

	setRuleEnabled(id: string, enabled: boolean): void {
		const builtIn = builtInPolicyRules.find(r => r.id === id);
		if (builtIn) {
			if (builtIn.locked) return; // cannot be toggled, ever
			const disabled = new Set(this._state.disabledBuiltInRuleIds);
			if (enabled) disabled.delete(id); else disabled.add(id);
			this._state = { ...this._state, disabledBuiltInRuleIds: [...disabled] };
			this._writeState();
			return;
		}
		this._state = {
			...this._state,
			customRules: this._state.customRules.map(r => r.id === id ? { ...r, enabled } : r),
		};
		this._writeState();
	}
}

registerSingleton(IPolicyService, PolicyService, InstantiationType.Eager);
