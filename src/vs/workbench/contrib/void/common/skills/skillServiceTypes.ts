/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';

export type SkillCategory = 'builtin' | 'local' | 'project' | 'cached-external' | 'agent-created';

// Defense-in-depth, not a claim of perfect static analysis (this codebase has no code
// execution sandbox or static analyzer to run over a skill's instructions - see
// docs/integrations/skills.md for what this trust model does and doesn't protect against):
//   trusted:          explicitly promoted by the user; composed into the system prompt as-is
//   review_required:  default for every newly installed or content-changed skill; still
//                      composed, but wrapped with an explicit "unverified" label so the
//                      model and user both see it hasn't been vetted
//   blocked:          never composed into any system prompt, and cannot be enabled
export type SkillTrustState = 'trusted' | 'review_required' | 'blocked';

export type RequestedCapabilities = {
	/** true if the skill's own instructions reference reading/writing files as part of using it */
	fs: boolean;
	terminal: boolean;
	network: boolean;
	mcp: boolean;
};

export type SkillRecord = {
	id: string;
	name: string;
	description: string;
	category: SkillCategory;
	source: {
		repositoryUrl?: string;
		version?: string;
	};
	instructions: string;
	instructionsHash: string; // detects external content changes across updates
	requestedCapabilities: RequestedCapabilities;
	trustState: SkillTrustState;
	pinned: boolean; // pinned skills are never auto-removed by any future cache-eviction policy
	enabled: boolean;
	installedAt: number;
	updatedAt: number;
};

export interface ISkillService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSkills: Event<void>;

	list(): SkillRecord[];
	get(id: string): SkillRecord | undefined;
	/** every skill whose instructions should currently be composed into a system prompt: enabled, not blocked */
	listActive(): SkillRecord[];

	/** install (or, if a skill with the same repositoryUrl already exists, re-fetch/update in place) a skill from its instructions text - see docs/integrations/skills.md for why installation never touches the network from here (that stays in IDiscoveryMainService) */
	install(opts: { name: string; description: string; category: SkillCategory; instructions: string; repositoryUrl?: string; version?: string }): SkillRecord;
	/** re-fetches nothing itself (callers pass the freshly-fetched instructions) - if the content actually changed and the skill was 'trusted', downgrades it to 'review_required' automatically, per the mission's "never let a silent external update change trusted behavior without review" requirement */
	update(id: string, newInstructions: string): SkillRecord | undefined;

	setEnabled(id: string, enabled: boolean): void; // no-op if the skill is 'blocked'
	setPinned(id: string, pinned: boolean): void;
	/** the only way a skill becomes 'trusted' or 'blocked' - always an explicit, user-driven decision, never automatic */
	setTrustState(id: string, trustState: SkillTrustState): void;
	remove(id: string): void;
}

export const ISkillService = createDecorator<ISkillService>('vaderSkillService');
