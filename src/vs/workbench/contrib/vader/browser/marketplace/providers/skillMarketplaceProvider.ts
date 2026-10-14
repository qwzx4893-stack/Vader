/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { ISkillService, SkillRecord } from '../../../common/skills/skillService.js';
import { GithubSkillEntry, IDiscoveryMainService, SkillNetSearchResult } from '../../../common/discovery/discoveryServiceTypes.js';
import { IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceItem, MarketplaceTrust } from '../../../common/marketplace/marketplaceTypes.js';
import { computeTrust } from '../../../common/marketplace/trustScore.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// Uses the EXISTING SkillProvider/SkillNet/skill-lifecycle architecture (ISkillService,
// IDiscoveryMainService.searchSkillNet) rather than inventing a second Skill concept, per the
// mission's explicit instruction. Installed skills come from ISkillService.list() directly;
// remote candidates come from SkillNet (search) and from the GitHub repositories the user keeps as
// sources (browse and search), converted to a not-yet-installed MarketplaceItem whose "install"
// action calls ISkillService.install with the instructions text - the same flow install_skill's tool
// implementation already uses, not a new one.

/** "owner" of https://github.com/owner/repo/..., or undefined for anything else */
function ownerOf(repositoryUrl: string | undefined): string | undefined {
	if (!repositoryUrl) return undefined;
	try {
		const url = new URL(repositoryUrl);
		return url.hostname === 'github.com' ? url.pathname.split('/').filter(Boolean)[0] : undefined;
	} catch {
		return undefined;
	}
}

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
		const publisher = ownerOf(skill.source.repositoryUrl);
		return {
			id: skill.id,
			providerId: this.id,
			type: 'SKILL',
			name: skill.name,
			description: skill.description,
			source: skill.category === 'cached-external' ? (publisher ? `GitHub: ${publisher}` : 'SkillNet') : `Skill (${skill.category})`,
			publisher,
			version: skill.source.version,
			trust: this._trustOf(skill.trustState),
			installed: true,
			enabled: skill.enabled,
			sizeBytes: skill.instructions.length,
			trustScore: computeTrust({ kind: 'skill', publisher, instructions: skill.instructions, userTrustState: skill.trustState }),
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
			metadata: { skillId: skill.id, category: skill.category, pinned: skill.pinned, instructionsHash: skill.instructionsHash, instructions: skill.instructions },
		};
	}

	private _skillNetToItem(result: SkillNetSearchResult): MarketplaceItem {
		return {
			id: result.repositoryUrl,
			providerId: this.id,
			type: 'SKILL',
			name: result.name,
			description: result.description,
			source: 'SkillNet',
			publisher: ownerOf(result.repositoryUrl),
			trust: 'unknown', // never installed, never reviewed - unknown until fetched and reviewed, same as install_skill's tool default
			installed: false,
			installMethod: 'review_and_install', // matches the mission's own action vocabulary: a Skill's instructions must be reviewed, not blindly executed
			// no text yet, so this score only reflects who published it and how many stars it has; the review step fetches the text and scores it again
			trustScore: computeTrust({ kind: 'skill', publisher: ownerOf(result.repositoryUrl), stars: result.stars }),
			security: {
				source: result.repositoryUrl,
				repositoryUrl: result.repositoryUrl,
				executesCode: false,
			},
			metadata: { repositoryUrl: result.repositoryUrl, stars: result.stars, skillNetCategory: result.category },
		};
	}

	private _githubToItem(entry: GithubSkillEntry, stars: number, installedUrls: ReadonlySet<string>): MarketplaceItem {
		const installed = installedUrls.has(entry.repositoryUrl);
		return {
			id: entry.repositoryUrl,
			providerId: this.id,
			type: 'SKILL',
			name: entry.name,
			description: entry.description,
			source: `GitHub: ${entry.owner}/${entry.repo}`,
			publisher: entry.owner,
			trust: 'unknown',
			installed,
			sizeBytes: entry.sizeBytes,
			installMethod: installed ? null : 'review_and_install',
			trustScore: computeTrust({ kind: 'skill', publisher: entry.owner, stars, instructions: entry.instructions || undefined }),
			security: { source: entry.repositoryUrl, repositoryUrl: entry.repositoryUrl, executesCode: false },
			metadata: { repositoryUrl: entry.repositoryUrl, stars, instructions: entry.instructions, repo: `${entry.owner}/${entry.repo}` },
		};
	}

	/** every skill in every source repository; a source that cannot be read is left out, and if none can be read the reason is thrown so the store can say why it is empty */
	private async _githubItems(): Promise<MarketplaceItem[]> {
		const installedUrls = new Set(this._skillService.list().map(s => s.source.repositoryUrl).filter((u): u is string => !!u));
		const listings = await Promise.all(this._skillService.listSources().map(r => this._discoveryService.listGithubSkills(r)));
		const items = listings.flatMap(l => l.entries.map(e => this._githubToItem(e, l.stars, installedUrls)));
		const errors = listings.filter(l => l.error).map(l => `${l.repo}: ${l.error}`);
		if (items.length === 0 && errors.length > 0) throw new Error(errors.join(' '));
		return items;
	}

	async browse(_token: CancellationToken): Promise<MarketplaceItem[]> {
		const remote = await this._githubItems().catch(e => { if (this._skillService.list().length === 0) throw e; return []; });
		const remoteUrls = new Set(remote.map(r => r.id));
		// installed skills that came from somewhere the sources do not list (SkillNet, written by the agent) are still shown
		const installedElsewhere = this._skillService.list().filter(s => !s.source.repositoryUrl || !remoteUrls.has(s.source.repositoryUrl)).map(s => this._installedToItem(s));
		const installedFromListing = this._skillService.list().filter(s => s.source.repositoryUrl && remoteUrls.has(s.source.repositoryUrl)).map(s => this._installedToItem(s));
		const installedUrls = new Set(installedFromListing.map(i => i.security?.repositoryUrl));
		return [...installedFromListing, ...installedElsewhere, ...remote.filter(r => !installedUrls.has(r.security?.repositoryUrl))];
	}

	async search(query: string, token: CancellationToken): Promise<MarketplaceItem[]> {
		const q = query.toLowerCase();
		const [installed, remote, github] = await Promise.all([
			Promise.resolve(this._skillService.list().filter(s => `${s.name} ${s.description}`.toLowerCase().includes(q))),
			this._discoveryService.searchSkillNet(query),
			this._githubItems().catch(() => [] as MarketplaceItem[]),
		]);
		if (token.isCancellationRequested) return [];
		const installedIds = new Set(installed.map(s => s.source.repositoryUrl));
		const githubMatches = github.filter(g => !installedIds.has(g.id) && `${g.name} ${g.description}`.toLowerCase().includes(q));
		const githubIds = new Set(githubMatches.map(g => g.id));
		return [
			...installed.map(s => this._installedToItem(s)),
			...githubMatches,
			...remote.filter(r => !installedIds.has(r.repositoryUrl) && !githubIds.has(r.repositoryUrl)).map(r => this._skillNetToItem(r)),
		];
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		return this._skillService.list().map(s => this._installedToItem(s));
	}

	async install(item: MarketplaceItem): Promise<void> {
		const repositoryUrl = String(item.metadata.repositoryUrl ?? item.id);
		// a listing from a source already carries the text; SkillNet results do not, so they are downloaded now
		const given = typeof item.metadata.instructions === 'string' ? item.metadata.instructions : '';
		const instructions = given || await this._discoveryService.fetchSkillInstructions(repositoryUrl);
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
