/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { match as matchGlob } from '../../../../../base/common/glob.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { VADER_POLICY_STORAGE_KEY } from '../storageKeys.js';
import { builtInPolicyRules } from './builtInPolicyRules.js';
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

	/** the hard, pre-execution check every tool/terminal/MCP call must pass through */
	evaluate(req: IPolicyRequest): PolicyVerdict;

	setMode(mode: PolicyMode): void;
	addCustomRule(rule: UserPolicyRuleInput): PolicyRule;
	removeCustomRule(id: string): void;
	setRuleEnabled(id: string, enabled: boolean): void; // works for custom rules, and for non-locked built-in rules
}

export const IPolicyService = createDecorator<IPolicyService>('vaderPolicyService');

const ruleMatches = (rule: PolicyRule, req: IPolicyRequest): boolean => {
	if (!rule.kinds.includes(req.kind)) return false;

	if (rule.pathGlobs && rule.pathGlobs.length) {
		const paths = req.filePaths ?? [];
		if (paths.length === 0) return false;
		const hit = paths.some(p => rule.pathGlobs!.some(g => matchGlob(g, p.replace(/\\/g, '/'))));
		if (!hit) return false;
	}

	if (rule.commandPatterns && rule.commandPatterns.length) {
		const command = req.command ?? '';
		if (!command) return false;
		const hit = rule.commandPatterns.some(src => {
			try { return new RegExp(src, 'i').test(command); }
			catch { return false; }
		});
		if (!hit) return false;
	}

	// a rule with neither pathGlobs nor commandPatterns matches nothing (avoid accidental blanket rules)
	if ((!rule.pathGlobs || rule.pathGlobs.length === 0) && (!rule.commandPatterns || rule.commandPatterns.length === 0)) {
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

	evaluate(req: IPolicyRequest): PolicyVerdict {
		const rules = this.getAllRules().filter(r => r.enabled);

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
