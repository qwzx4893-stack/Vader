/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { ISkillService, SkillRecord } from '../../../common/skills/skillService.js';
import { GithubSkillEntry, IDiscoveryMainService, RepoSignals } from '../../../common/discovery/discoveryServiceTypes.js';
import { githubRepoUrlOf, ownerOfGithubUrl } from '../../../common/discovery/feedParsers.js';
import { IMarketplaceProvider, ItemFact, IUnifiedMarketplaceService, MarketplaceItem, MarketplaceTrust } from '../../../common/marketplace/marketplaceTypes.js';
import { categoryOf, classify } from '../../../common/marketplace/categories.js';
import { computeTrust, TrustInputs } from '../../../common/marketplace/trustScore.js';
import { isSourceOn } from '../../../common/marketplace/addonSources.js';
import { IVaderSettingsService } from '../../../common/vaderSettingsService.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// Skills are found in several live sources at once and merged:
//   - the GitHub repositories kept as sources (anthropics/skills and openai/skills by default, and the ones the person adds)
//   - skills.sh, a live index with install counts
//   - GitHub's own search for repositories that tag themselves "agent-skills"
//   - SkillsMP and Smithery's registry of skills (both index skills that live on GitHub)
//   - SkillNet
// The same skill found by two sources is one row that says it was found twice (two sources agreeing is a signal in the score).
// What each source knows goes into the score as it is read, every time; nothing is stored as a ready-made number. Installed skills come from
// ISkillService.list(); installing goes through ISkillService.install with the text, the same flow as before.

type LiveSignals = Pick<TrustInputs, 'stars' | 'forks' | 'pushedAt' | 'createdAt' | 'archived' | 'license' | 'ownerType' | 'sourceInstalls'>;

/** one skill as one source described it, before the sources are merged */
type Candidate = {
	readonly name: string;
	readonly description: string;
	readonly repositoryUrl?: string;
	/** owner/repo on GitHub, when known */
	readonly repo?: string;
	readonly publisher?: string;
	readonly sourceId: string;
	readonly sourceLabel: string;
	readonly instructions?: string;
	readonly sizeBytes?: number;
	/** set when the source names the skill by folder but gave no address for it (skills.sh) */
	readonly skillsSh?: { readonly repo: string; readonly skillId: string };
	/** a whole repository found by topic: it may hold one skill or many */
	readonly wholeRepo?: boolean;
	/** the section names the source itself gave ("Productivity") */
	readonly sourceCategories?: readonly string[];
	readonly signals: LiveSignals;
};

const fmtDate = (iso: string | undefined): string | undefined => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : undefined; };
const fmtCount = (n: number): string => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);
const fmtSize = (n: number): string => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** the facts on a skill's own page, from whatever the sources said */
function skillFacts(o: { publisher?: string; sources?: readonly string[]; sizeBytes?: number; repositoryUrl?: string; signals: LiveSignals }): ItemFact[] {
	const f: ItemFact[] = [];
	if (o.publisher) f.push({ label: 'Publisher', value: o.publisher, href: `https://github.com/${o.publisher}` });
	if (o.sources?.length) f.push({ label: 'Found in', value: o.sources.join(', ') });
	if (o.sizeBytes !== undefined) f.push({ label: 'Size', value: fmtSize(o.sizeBytes) });
	if (typeof o.signals.sourceInstalls === 'number') f.push({ label: 'Installed', value: `${fmtCount(o.signals.sourceInstalls)} times` });
	if (typeof o.signals.stars === 'number') f.push({ label: 'Stars', value: fmtCount(o.signals.stars) });
	const changed = fmtDate(o.signals.pushedAt); if (changed) f.push({ label: 'Last change', value: changed });
	if (o.signals.license !== undefined) f.push({ label: 'Licence', value: o.signals.license ?? 'none declared' });
	if (o.signals.archived) f.push({ label: 'Status', value: 'Archived' });
	if (o.repositoryUrl) f.push({ label: 'Repository', value: o.repositoryUrl.replace('https://github.com/', ''), href: o.repositoryUrl });
	return f;
}

const SKILLS_SH_BROWSE_QUERIES = ['best practices', 'testing', 'pdf', 'code review'];
const SKILLSMP_BROWSE_QUERIES = ['documents', 'testing'];

const signalsOf = (s: RepoSignals | undefined): LiveSignals => s ? {
	stars: s.stars, forks: s.forks, pushedAt: s.pushedAt, createdAt: s.createdAt, archived: s.archived, license: s.license ?? null, ownerType: s.ownerType,
} : {};

const keyOf = (c: Candidate): string => c.repo ? `${c.repo.toLowerCase()}#${c.name.toLowerCase()}` : (c.repositoryUrl ?? c.name).toLowerCase();

export class SkillMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'skills';
	readonly displayName = 'Agent Skills';
	readonly itemType = 'SKILL' as const;
	readonly cacheTtlMs = 30_000;

	private _warnings: string[] = [];

	constructor(
		private readonly _skillService: ISkillService,
		private readonly _discoveryService: IDiscoveryMainService,
		private readonly _settings: IVaderSettingsService,
	) { }

	takeWarnings(): string[] { const w = this._warnings; this._warnings = []; return w; }

	private _on(sourceId: string): boolean { return isSourceOn(this._settings.state.globalSettings.addonSourcesOff, sourceId); }

	private _trustOf(state: SkillRecord['trustState']): MarketplaceTrust {
		return state === 'trusted' ? 'trusted' : state === 'blocked' ? 'blocked' : 'review_required';
	}

	private _installedToItem(skill: SkillRecord, live?: LiveSignals): MarketplaceItem {
		const publisher = ownerOfGithubUrl(skill.source.repositoryUrl);
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
			trustScore: computeTrust({ kind: 'skill', name: skill.name, publisher, instructions: skill.instructions, userTrustState: skill.trustState, ...live }),
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
			metadata: {
				skillId: skill.id, category: skill.category, pinned: skill.pinned, instructionsHash: skill.instructionsHash, instructions: skill.instructions, repositoryUrl: skill.source.repositoryUrl, repo: githubRepoUrlOf(skill.source.repositoryUrl)?.slice('https://github.com/'.length),
				categories: classify('skill', { name: skill.name, description: skill.description }),
				facts: skillFacts({ publisher, sizeBytes: skill.instructions.length, repositoryUrl: skill.source.repositoryUrl, signals: live ?? {} }),
			},
		};
	}

	/** merges what several sources said about the same skill into one item */
	private _merge(candidates: readonly Candidate[], installedUrls: ReadonlySet<string>): MarketplaceItem[] {
		const groups = new Map<string, Candidate[]>();
		const byUrl = new Map<string, string>();
		for (const c of candidates) {
			const urlKey = c.repositoryUrl?.toLowerCase();
			const key = (urlKey && byUrl.get(urlKey)) || keyOf(c);
			const g = groups.get(key) ?? [];
			g.push(c);
			groups.set(key, g);
			if (urlKey) byUrl.set(urlKey, key);
		}
		const items: MarketplaceItem[] = [];
		for (const g of groups.values()) {
			const first = g.find(c => c.instructions) ?? g[0];
			const signals: LiveSignals = Object.assign({}, ...g.map(c => c.signals));
			const sourceInstalls = g.map(c => c.signals.sourceInstalls).find((n): n is number => typeof n === 'number');
			const labels = [...new Set(g.map(c => c.sourceLabel))];
			const sources = new Set(g.map(c => c.sourceId));
			const instructions = g.find(c => c.instructions)?.instructions;
			const repositoryUrl = g.find(c => c.repositoryUrl)?.repositoryUrl;
			const repo = g.find(c => c.repo)?.repo;
			const publisher = first.publisher ?? g.find(c => c.publisher)?.publisher;
			const installed = !!repositoryUrl && installedUrls.has(repositoryUrl);
			items.push({
				id: repositoryUrl ?? `skills.sh:${first.skillsSh?.repo}/${first.skillsSh?.skillId}`,
				providerId: this.id,
				type: 'SKILL',
				name: first.name,
				description: first.description || g.find(c => c.description)?.description || '',
				source: labels.join(' · '),
				publisher,
				trust: 'unknown',
				installed,
				sizeBytes: g.find(c => c.sizeBytes !== undefined)?.sizeBytes,
				installMethod: installed ? null : 'review_and_install',
				trustScore: computeTrust({ kind: 'skill', name: first.name, publisher, instructions: instructions || undefined, ...signals, sourceInstalls, listedBy: sources.size }),
				security: { source: repositoryUrl ?? repo ?? 'skills.sh', repositoryUrl, executesCode: false },
				metadata: {
					categories: classify('skill', { name: first.name, description: first.description || g.find(c => c.description)?.description, sourceCategories: g.flatMap(c => c.sourceCategories ?? []) }),
					facts: skillFacts({ publisher, sources: labels, sizeBytes: g.find(c => c.sizeBytes !== undefined)?.sizeBytes, repositoryUrl: repositoryUrl ? (githubRepoUrlOf(repositoryUrl) ?? repositoryUrl) : repo ? `https://github.com/${repo}` : undefined, signals: { ...signals, sourceInstalls } }),
					repositoryUrl, repo, instructions, signals, sourcesListing: labels, listedBy: sources.size,
					skillsSh: g.find(c => c.skillsSh)?.skillsSh, wholeRepo: g.every(c => c.wholeRepo) && g.some(c => c.wholeRepo),
				},
			});
		}
		return items;
	}

	// ---- the live feeds, each one a list of candidates; one that fails is said so and the others still answer

	private async _githubRepoCandidates(): Promise<Candidate[]> {
		const listings = await Promise.all(this._skillService.listSources().map(r => this._discoveryService.listGithubSkills(r)));
		const out: Candidate[] = [];
		const errors: string[] = [];
		for (const l of listings) {
			if (l.error) { errors.push(`${l.repo}: ${l.error}`); continue; }
			const signals = signalsOf(l.signals);
			for (const e of l.entries) out.push(this._entryCandidate(e, l.stars, signals, 'github-repos', `GitHub: ${e.owner}/${e.repo}`));
		}
		if (out.length === 0 && errors.length > 0) throw new Error(errors.join(' '));
		return out;
	}

	private _entryCandidate(e: GithubSkillEntry, stars: number, signals: LiveSignals, sourceId: string, label: string): Candidate {
		return { name: e.name, description: e.description, repositoryUrl: e.repositoryUrl, repo: `${e.owner}/${e.repo}`, publisher: e.owner, sourceId, sourceLabel: label, instructions: e.instructions || undefined, sizeBytes: e.sizeBytes, signals: { ...signals, stars } };
	}

	private async _skillsShCandidates(queries: readonly string[]): Promise<Candidate[]> {
		const lists = await Promise.all(queries.map(q => this._discoveryService.searchSkillsSh(q)));
		return lists.flat().map((r): Candidate => ({
			name: r.name, description: '', repo: r.repo, publisher: r.repo.split('/')[0], sourceId: 'skills-sh', sourceLabel: 'skills.sh',
			skillsSh: { repo: r.repo, skillId: r.skillId }, signals: { sourceInstalls: r.installs },
		}));
	}

	private async _skillsMpCandidates(queries: readonly string[]): Promise<Candidate[]> {
		const lists = await Promise.all(queries.map(q => this._discoveryService.searchSkillsMp(q)));
		return lists.flat().map((r): Candidate => ({
			name: r.name, description: r.description, repositoryUrl: r.githubUrl, repo: githubRepoUrlOf(r.githubUrl)?.slice('https://github.com/'.length), publisher: r.author ?? ownerOfGithubUrl(r.githubUrl),
			sourceId: 'skillsmp', sourceLabel: 'SkillsMP', signals: { stars: r.stars, pushedAt: r.updatedAt },
		}));
	}

	private async _smitherySkillCandidates(queries: readonly string[]): Promise<Candidate[]> {
		const lists = await Promise.all(queries.map(q => this._discoveryService.searchSmitherySkills(q)));
		return lists.flat().map((r): Candidate => ({
			name: r.displayName, description: r.description, repositoryUrl: r.gitUrl, repo: githubRepoUrlOf(r.gitUrl)?.slice('https://github.com/'.length), publisher: ownerOfGithubUrl(r.gitUrl) ?? r.qualifiedName.split('/')[0],
			sourceId: 'smithery-skills', sourceLabel: 'Smithery', sourceCategories: r.categories, signals: { stars: r.stars },
		}));
	}

	private async _skillNetCandidates(query: string): Promise<Candidate[]> {
		const results = await this._discoveryService.searchSkillNet(query);
		return results.map((r): Candidate => ({
			name: r.name, description: r.description, repositoryUrl: r.repositoryUrl, repo: githubRepoUrlOf(r.repositoryUrl)?.slice('https://github.com/'.length), publisher: ownerOfGithubUrl(r.repositoryUrl),
			sourceId: 'skillnet', sourceLabel: 'SkillNet', signals: { stars: r.stars },
		}));
	}

	private async _topicCandidates(query: string): Promise<Candidate[]> {
		const repos = await this._discoveryService.searchGithubTopic('agent-skills', query);
		return repos.map((r): Candidate => ({
			name: r.repo.split('/')[1], description: r.description ?? '', repositoryUrl: r.url, repo: r.repo, publisher: r.repo.split('/')[0], sourceId: 'github-topic-skills',
			sourceLabel: 'GitHub topic: agent-skills', wholeRepo: true, sourceCategories: r.topics, signals: signalsOf(r),
		}));
	}

	private async _gather(feeds: readonly { id: string; label: string; run: () => Promise<Candidate[]> }[]): Promise<Candidate[]> {
		const active = feeds.filter(f => this._on(f.id));
		const settled = await Promise.allSettled(active.map(f => f.run()));
		const out: Candidate[] = [];
		let failed = 0;
		settled.forEach((r, i) => {
			if (r.status === 'fulfilled') { out.push(...r.value); return; }
			failed++;
			this._warnings.push(`${active[i].label} did not answer (${r.reason instanceof Error ? r.reason.message : String(r.reason)})`);
		});
		if (active.length > 0 && failed === active.length) throw new Error(this.takeWarnings().join('; '));
		return out;
	}

	private _installedUrls(): Set<string> {
		return new Set(this._skillService.list().map(s => s.source.repositoryUrl).filter((u): u is string => !!u));
	}

	async browse(_token: CancellationToken, category?: string): Promise<MarketplaceItem[]> {
		const cat = category ? categoryOf('skill', category) : undefined;
		// a section is looked for by name in every source; the front page is each source's own best
		const seeds = cat?.seeds ?? SKILLS_SH_BROWSE_QUERIES;
		const candidates = await this._gather([
			{ id: 'github-repos', label: 'GitHub repositories', run: () => this._githubRepoCandidates() },
			{ id: 'skills-sh', label: 'skills.sh', run: () => this._skillsShCandidates(seeds) },
			{ id: 'skillsmp', label: 'SkillsMP', run: () => this._skillsMpCandidates(cat ? seeds : SKILLSMP_BROWSE_QUERIES) },
			{ id: 'smithery-skills', label: 'Smithery skills', run: () => this._smitherySkillCandidates(cat ? seeds : ['']) },
			{ id: 'github-topic-skills', label: 'GitHub topic agent-skills', run: () => this._topicCandidates(cat ? seeds[0] : '') },
		]).catch(e => { if (this._skillService.list().length === 0) throw e; return [] as Candidate[]; });
		const remote = this._merge(candidates, this._installedUrls()).filter(i => !cat || (i.metadata.categories as string[]).includes(cat.id));
		const remoteUrls = new Set(remote.map(r => r.id));
		const installed = this._skillService.list().map(s => this._installedToItem(s));
		const installedElsewhere = installed.filter(i => !i.security?.repositoryUrl || !remoteUrls.has(i.security.repositoryUrl));
		const installedFromListing = installed.filter(i => i.security?.repositoryUrl && remoteUrls.has(i.security.repositoryUrl));
		const installedUrls = new Set(installedFromListing.map(i => i.security?.repositoryUrl));
		return [...installedFromListing, ...installedElsewhere, ...remote.filter(r => !installedUrls.has(r.security?.repositoryUrl))];
	}

	async search(query: string, token: CancellationToken, category?: string): Promise<MarketplaceItem[]> {
		const q = query.toLowerCase();
		const installed = this._skillService.list().filter(s => `${s.name} ${s.description}`.toLowerCase().includes(q));
		const candidates = await this._gather([
			{ id: 'github-repos', label: 'GitHub repositories', run: async () => (await this._githubRepoCandidates()).filter(c => `${c.name} ${c.description}`.toLowerCase().includes(q)) },
			{ id: 'skills-sh', label: 'skills.sh', run: () => this._skillsShCandidates([query]) },
			{ id: 'skillsmp', label: 'SkillsMP', run: () => this._skillsMpCandidates([query]) },
			{ id: 'smithery-skills', label: 'Smithery skills', run: () => this._smitherySkillCandidates([query]) },
			{ id: 'skillnet', label: 'SkillNet', run: () => this._skillNetCandidates(query) },
			{ id: 'github-topic-skills', label: 'GitHub topic agent-skills', run: () => this._topicCandidates(query) },
		]).catch(() => [] as Candidate[]);
		if (token.isCancellationRequested) return [];
		const installedIds = new Set(installed.map(s => s.source.repositoryUrl));
		const cat = category ? categoryOf('skill', category) : undefined;
		const remote = this._merge(candidates, this._installedUrls()).filter(r => !installedIds.has(r.id) && (!cat || (r.metadata.categories as string[]).includes(cat.id)));
		return [...installed.map(s => this._installedToItem(s)), ...remote];
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		return this._skillService.list().map(s => this._installedToItem(s));
	}

	/** a live look at one skill: the repository's current signals, and the skill's own text when only its name was known */
	async refine(item: MarketplaceItem): Promise<MarketplaceItem> {
		const repo = typeof item.metadata.repo === 'string' ? item.metadata.repo : undefined;
		const signalsNow = repo ? signalsOf(await this._discoveryService.getRepoSignals(repo)) : {};
		const known = (item.metadata.signals ?? {}) as LiveSignals;
		const live: LiveSignals = { ...known, ...signalsNow };
		if (item.installed) {
			const skill = this._skillService.get(String(item.metadata.skillId ?? item.id));
			if (!skill) return item;
			const fresh = this._installedToItem(skill, live);
			return { ...fresh, metadata: { ...fresh.metadata, signals: live, refined: true } };
		}
		let instructions = typeof item.metadata.instructions === 'string' ? item.metadata.instructions : undefined;
		let repositoryUrl = typeof item.metadata.repositoryUrl === 'string' ? item.metadata.repositoryUrl : undefined;
		let description = item.description;
		let sizeBytes = item.sizeBytes;
		const sh = item.metadata.skillsSh as { repo: string; skillId: string } | undefined;
		if (!instructions && sh) {
			const entry = await this._discoveryService.resolveGithubSkill(sh.repo, sh.skillId);
			if (entry) { instructions = entry.instructions || undefined; repositoryUrl = entry.repositoryUrl; description = description || entry.description; sizeBytes = entry.sizeBytes; }
		}
		const listedBy = typeof item.metadata.listedBy === 'number' ? item.metadata.listedBy : undefined;
		return {
			...item, description, sizeBytes, id: repositoryUrl ?? item.id,
			security: { ...item.security, source: repositoryUrl ?? item.security?.source ?? '', repositoryUrl },
			trustScore: computeTrust({ kind: 'skill', name: item.name, publisher: item.publisher, instructions, ...live, listedBy }),
			metadata: {
				...item.metadata, instructions, repositoryUrl, signals: live, refined: true,
				facts: skillFacts({ publisher: item.publisher, sources: item.metadata.sourcesListing as string[] | undefined, sizeBytes, repositoryUrl: repo ? `https://github.com/${repo}` : repositoryUrl, signals: live }),
			},
		};
	}

	async install(item: MarketplaceItem): Promise<void> {
		let instructions = typeof item.metadata.instructions === 'string' ? item.metadata.instructions : '';
		let repositoryUrl = String(item.metadata.repositoryUrl ?? item.id);
		const sh = item.metadata.skillsSh as { repo: string; skillId: string } | undefined;
		if (!instructions && sh) {
			// skills.sh names the skill by folder: find it in its repository and read only that skill
			const entry = await this._discoveryService.resolveGithubSkill(sh.repo, sh.skillId);
			if (entry) { instructions = entry.instructions; repositoryUrl = entry.repositoryUrl; }
			else throw new Error(`Could not find the skill "${sh.skillId}" in ${sh.repo}. It may have been moved or renamed there.`);
		}
		if (!instructions && item.metadata.wholeRepo && typeof item.metadata.repo === 'string') {
			// a repository found by topic: one skill is installed, several need a choice the person makes by adding the repository as a source
			const listing = await this._discoveryService.listGithubSkills(item.metadata.repo);
			if (listing.entries.length > 1) throw new Error(`${item.metadata.repo} holds ${listing.entries.length} skills. Add it as a source in Settings, Skills, Sources, then pick the one you want here.`);
			if (listing.entries.length === 1) { instructions = listing.entries[0].instructions; repositoryUrl = listing.entries[0].repositoryUrl; }
		}
		// a listing from a source already carries the text; SkillNet results do not, so they are downloaded now
		if (!instructions) instructions = (await this._discoveryService.fetchSkillInstructions(repositoryUrl)) ?? '';
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
		@IVaderSettingsService settingsService: IVaderSettingsService,
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new SkillMarketplaceProvider(skillService, discoveryService, settingsService));
	}
}

registerWorkbenchContribution2(SkillMarketplaceProviderContribution.ID, SkillMarketplaceProviderContribution, WorkbenchPhase.BlockRestore);
