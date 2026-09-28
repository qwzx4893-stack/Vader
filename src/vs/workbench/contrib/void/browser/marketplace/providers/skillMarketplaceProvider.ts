/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { ISkillService, SkillRecord } from '../../../common/skills/skillService.js';
import { IDiscoveryMainService, SkillNetSearchResult } from '../../../common/discovery/discoveryServiceTypes.js';
import { IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceItem, MarketplaceTrust } from '../../../common/marketplace/marketplaceTypes.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// Uses the EXISTING SkillProvider/SkillNet/skill-lifecycle architecture (ISkillService,
// IDiscoveryMainService.searchSkillNet) rather than inventing a second Skill concept, per the
// mission's explicit instruction. Installed skills come from ISkillService.list() directly;
// remote candidates come from SkillNet, converted to a not-yet-installed MarketplaceItem
// whose "install" action fetches the instructions text (IDiscoveryMainService.fetchSkillInstructions)
// and calls ISkillService.install - the exact two-step flow install_skill's tool implementation
// already uses, not a new one.
class SkillMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'skills';
	readonly displayName = 'Agent Skills';
	readonly itemType = 'SKILL' as const;
	readonly cacheTtlMs = 30_000;

	constructor(
		private readonly _skillService: ISkillService,
		private readonly _discoveryService: IDiscoveryMainService,
	) { }

	private _trustOf(state: SkillRecord['trustState']): MarketplaceTrust {
		return state === 'trusted' ? 'trusted' : state === 'blocked' ? 'blocked' : 'review_required';
	}

	private _installedToItem(skill: SkillRecord): MarketplaceItem {
		return {
			id: skill.id,
			providerId: this.id,
			type: 'SKILL',
			name: skill.name,
			description: skill.description,
			source: skill.category === 'cached-external' ? 'SkillNet' : `Skill (${skill.category})`,
			version: skill.source.version,
			trust: this._trustOf(skill.trustState),
			installed: true,
			enabled: skill.enabled,
			capabilities: Object.entries(skill.requestedCapabilities).filter(([, v]) => v).map(([k]) => k),
			// a skill that's already installed has nothing left to "install" - its only
			// meaningful marketplace actions are enable/disable, handled via setEnabled.
			installMethod: null,
			security: {
				source: skill.source.repositoryUrl ?? 'local',
				version: skill.source.version,
				repositoryUrl: skill.source.repositoryUrl,
				executesCode: false, // a skill is instructions text composed into the system prompt, not executable code
				networkAccess: skill.requestedCapabilities.network,
				filesystemAccess: skill.requestedCapabilities.fs,
				terminalAccess: skill.requestedCapabilities.terminal,
			},
			metadata: { skillId: skill.id, category: skill.category, pinned: skill.pinned, instructionsHash: skill.instructionsHash },
		};
	}

	private _remoteToItem(result: SkillNetSearchResult): MarketplaceItem {
		return {
			id: result.repositoryUrl,
			providerId: this.id,
			type: 'SKILL',
			name: result.name,
			description: result.description,
			source: 'SkillNet',
			trust: 'unknown', // never installed, never reviewed - unknown until fetched and reviewed, same as install_skill's tool default
			installed: false,
			installMethod: 'review_and_install', // matches the mission's own action vocabulary: a Skill's instructions must be reviewed, not blindly executed
			security: {
				source: result.repositoryUrl,
				repositoryUrl: result.repositoryUrl,
				executesCode: false,
			},
			metadata: { repositoryUrl: result.repositoryUrl, stars: result.stars, skillNetCategory: result.category },
		};
	}

	async search(query: string, token: CancellationToken): Promise<MarketplaceItem[]> {
		const [installed, remote] = await Promise.all([
			Promise.resolve(this._skillService.list().filter(s => `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()))),
			this._discoveryService.searchSkillNet(query),
		]);
		const installedIds = new Set(installed.map(s => s.source.repositoryUrl));
		return [
			...installed.map(s => this._installedToItem(s)),
			...remote.filter(r => !installedIds.has(r.repositoryUrl)).map(r => this._remoteToItem(r)),
		];
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		return this._skillService.list().map(s => this._installedToItem(s));
	}

	async install(item: MarketplaceItem): Promise<void> {
		const repositoryUrl = String(item.metadata.repositoryUrl ?? item.id);
		const instructions = await this._discoveryService.fetchSkillInstructions(repositoryUrl);
		if (!instructions) throw new Error(`Could not fetch instructions for "${item.name}" from ${repositoryUrl}.`);
		this._skillService.install({ name: item.name, description: item.description, category: 'cached-external', instructions, repositoryUrl });
	}

	async uninstall(item: MarketplaceItem): Promise<void> {
		this._skillService.remove(String(item.metadata.skillId ?? item.id));
	}

	async setEnabled(item: MarketplaceItem, enabled: boolean): Promise<void> {
		this._skillService.setEnabled(String(item.metadata.skillId ?? item.id), enabled);
	}
}

class SkillMarketplaceProviderContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.skillMarketplaceProvider';

	constructor(
		@ISkillService skillService: ISkillService,
		@IDiscoveryMainService discoveryService: IDiscoveryMainService,
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new SkillMarketplaceProvider(skillService, discoveryService));
	}
}

registerWorkbenchContribution2(SkillMarketplaceProviderContribution.ID, SkillMarketplaceProviderContribution, WorkbenchPhase.BlockRestore);
