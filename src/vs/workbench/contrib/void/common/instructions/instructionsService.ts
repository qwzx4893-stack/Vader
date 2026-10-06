/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader's layered instruction system. Vader originally concatenated two sources (a global
// "AI Instructions" setting and a .voidrules workspace file) directly into the system
// prompt with no structure. This service formalizes that into named, ordered layers with
// a fixed precedence - system invariants and the policy summary are always first (most
// general, least overridable in spirit), task instructions are always last (most
// specific to what's happening right now) - and exposes the composed result so the UI can
// show a user exactly what's active, per layer, rather than one opaque blob of text.
//
// This does not replace the Policy Engine (src/vs/workbench/contrib/void/common/policy/):
// that's a hard, code-level gate that runs regardless of what's in the prompt. This
// service only affects what the model is *told*; a rule stated here can still be ignored
// by the model, which is exactly why the policy summary layer exists - so the model is at
// least told, up front, which of its actions will be hard-blocked anyway.

import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IPolicyService } from '../policy/policyService.js';

export type InstructionLayerName =
	| 'systemInvariants'
	| 'policy'
	| 'globalUser'
	| 'workspace'
	| 'projectMemory'
	| 'agent'
	| 'agentMemory'
	| 'skill'
	| 'task';

export interface InstructionLayer {
	readonly name: InstructionLayerName;
	readonly label: string;
	readonly content: string; // '' when this layer has nothing to contribute
}

export interface ComposeInstructionsInput {
	/** Settings > AI Instructions (applies to every workspace/agent) */
	globalUser?: string;
	/** .vaderrules / .voidrules file(s) for the open workspace folder(s) */
	workspace?: string;
	/** facts written via the `remember` tool (or the Memory UI) with scope='project' - see common/memory/ */
	projectMemory?: string;
	/** the running permanent agent's own instructions, if any (see agents/agentsService.ts) */
	agent?: string;
	/** facts written via the `remember` tool with scope='agent' for the currently running agent - see common/memory/ */
	agentMemory?: string;
	/** instructions contributed by an active Skill, if any */
	skill?: string;
	/** one-off instructions scoped to the current task/message only */
	task?: string;
}

export const SYSTEM_INVARIANTS = [
	'You are running inside Vader, an AI-native IDE. Tool calls you make (file edits, terminal commands, MCP tools) pass through a hard policy engine before they execute; it runs regardless of these instructions and cannot be argued past.',
	'A tool call the policy engine denies will come back as a rejected result explaining why - do not retry the same call expecting a different outcome; either ask the user or find another approach.',
].join(' ');

export interface IInstructionsService {
	readonly _serviceBrand: undefined;
	/** every layer, in fixed precedence order, whether or not it has content (for UI display) */
	getLayers(input: ComposeInstructionsInput): InstructionLayer[];
	/** the active layers joined into one string ready to embed in a system prompt */
	compose(input: ComposeInstructionsInput): string;
}

export const IInstructionsService = createDecorator<IInstructionsService>('vaderInstructionsService');

class InstructionsService implements IInstructionsService {
	_serviceBrand: undefined;

	constructor(
		@IPolicyService private readonly _policyService: IPolicyService,
	) { }

	private _policySummary(): string {
		const rules = this._policyService.getAllRules().filter(r => r.enabled);
		const denies = rules.filter(r => r.effect === 'deny');
		const asks = rules.filter(r => r.effect === 'ask');
		const lines: string[] = [];
		lines.push(`Permission mode: ${this._policyService.state.mode}.`);
		if (denies.length) {
			lines.push('Always blocked, no matter what:');
			for (const r of denies) lines.push(`- ${r.description}`);
		}
		if (asks.length) {
			lines.push('Requires explicit user approval before running:');
			for (const r of asks) lines.push(`- ${r.description}`);
		}
		return lines.join('\n');
	}

	getLayers(input: ComposeInstructionsInput): InstructionLayer[] {
		return [
			{ name: 'systemInvariants', label: 'System invariants', content: SYSTEM_INVARIANTS },
			{ name: 'policy', label: 'Policy engine (hard rules)', content: this._policySummary() },
			{ name: 'globalUser', label: 'Global AI Instructions (Settings)', content: (input.globalUser ?? '').trim() },
			{ name: 'workspace', label: 'Workspace rules (.vaderrules)', content: (input.workspace ?? '').trim() },
			{ name: 'projectMemory', label: 'Project memory', content: (input.projectMemory ?? '').trim() },
			{ name: 'agent', label: 'Agent instructions', content: (input.agent ?? '').trim() },
			{ name: 'agentMemory', label: 'Agent memory', content: (input.agentMemory ?? '').trim() },
			{ name: 'skill', label: 'Active skill instructions', content: (input.skill ?? '').trim() },
			{ name: 'task', label: 'Task-specific instructions', content: (input.task ?? '').trim() },
		];
	}

	compose(input: ComposeInstructionsInput): string {
		const layers = this.getLayers(input).filter(l => l.content);
		return layers.map(l => `### ${l.label}\n${l.content}`).join('\n\n');
	}
}

registerSingleton(IInstructionsService, InstructionsService, InstantiationType.Eager);
