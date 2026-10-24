/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What each live source says, read into one shape. Pure functions over the JSON a source sends, so what they accept and what they refuse
// is tested against real responses (test/fixtures). A field a source does not send stays undefined: nothing is guessed to fill a gap,
// because the trust score treats "unknown" and "bad" differently.

/** what is known about a GitHub repository at one moment (GitHub's own repository object carries all of it) */
export type RepoSignals = {
	readonly repo: string; // owner/name
	readonly stars: number;
	readonly forks: number;
	readonly openIssues: number;
	readonly pushedAt?: string;
	readonly createdAt?: string;
	readonly archived: boolean;
	readonly license?: string; // SPDX id, undefined when none is declared
	readonly ownerType?: 'Organization' | 'User';
	readonly description?: string;
	readonly topics?: readonly string[];
	readonly url: string;
};

export type SkillsShResult = { readonly repo: string; readonly skillId: string; readonly name: string; readonly installs: number };

export type SmitheryResult = {
	readonly qualifiedName: string;
	readonly displayName: string;
	readonly description: string;
	readonly verified: boolean;
	readonly useCount: number;
	readonly remote: boolean;
	readonly homepage?: string;
	readonly createdAt?: string;
	/** a GitHub repository, when the homepage is one */
	readonly repositoryUrl?: string;
};

export type NpmMcpResult = {
	readonly name: string;
	readonly version: string;
	readonly description: string;
	readonly weeklyDownloads: number;
	readonly publisher?: string;
	/** published from a CI workflow with a trusted-publisher identity (npm provenance), not from somebody's laptop */
	readonly trustedPublisher: boolean;
	readonly license?: string;
	readonly updatedAt?: string;
	readonly repositoryUrl?: string;
	readonly keywords: readonly string[];
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** "git+https://github.com/o/r.git", "https://github.com/o/r/tree/main/x", "git@github.com:o/r.git" -> "https://github.com/o/r"; anything else undefined */
export function githubRepoUrlOf(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const m = /^(?:git\+)?(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/.exec(raw.trim());
	return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

export const ownerOfGithubUrl = (url: string | undefined): string | undefined => {
	const u = githubRepoUrlOf(url);
	return u ? u.split('/')[3] : undefined;
};

/** one repository object, from GET /repos/{o}/{r} or an item of GET /search/repositories */
export function parseRepoSignals(r: any): RepoSignals | undefined {
	const full = str(r?.full_name);
	if (!full || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(full)) return undefined;
	const license = str(r?.license?.spdx_id);
	return {
		repo: full, stars: num(r?.stargazers_count), forks: num(r?.forks_count), openIssues: num(r?.open_issues_count),
		pushedAt: str(r?.pushed_at), createdAt: str(r?.created_at), archived: r?.archived === true,
		license: license && license !== 'NOASSERTION' ? license : undefined,
		ownerType: r?.owner?.type === 'Organization' ? 'Organization' : r?.owner?.type === 'User' ? 'User' : undefined,
		description: str(r?.description), topics: Array.isArray(r?.topics) ? r.topics.filter((t: unknown) => typeof t === 'string') : undefined,
		url: `https://github.com/${full}`,
	};
}

export function parseGithubSearch(data: any): RepoSignals[] {
	const items: any[] = Array.isArray(data?.items) ? data.items : [];
	return items.map(parseRepoSignals).filter((x): x is RepoSignals => !!x);
}

/** skills.sh/api/search: the skill's repository, its folder name, and how many times people installed it */
export function parseSkillsSh(data: any): SkillsShResult[] {
	const items: any[] = Array.isArray(data?.skills) ? data.skills : [];
	const out: SkillsShResult[] = [];
	for (const s of items) {
		const repo = str(s?.source), skillId = str(s?.skillId);
		if (!repo || !skillId || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^[A-Za-z0-9_.-]+$/.test(skillId)) continue;
		out.push({ repo, skillId, name: str(s?.name) ?? skillId, installs: num(s?.installs) });
	}
	return out;
}

/** registry.smithery.ai/servers */
export function parseSmithery(data: any): SmitheryResult[] {
	const items: any[] = Array.isArray(data?.servers) ? data.servers : [];
	const out: SmitheryResult[] = [];
	for (const s of items) {
		const q = str(s?.qualifiedName);
		if (!q || s?.unlisted === true || s?.inactive === true) continue;
		out.push({
			qualifiedName: q, displayName: str(s?.displayName) ?? q, description: str(s?.description) ?? '', verified: s?.verified === true,
			useCount: num(s?.useCount), remote: s?.remote === true, homepage: str(s?.homepage), createdAt: str(s?.createdAt), repositoryUrl: githubRepoUrlOf(str(s?.homepage)),
		});
	}
	return out;
}

/** registry.npmjs.org/-/v1/search */
export function parseNpmSearch(data: any): NpmMcpResult[] {
	const objects: any[] = Array.isArray(data?.objects) ? data.objects : [];
	const out: NpmMcpResult[] = [];
	for (const o of objects) {
		const p = o?.package;
		const name = str(p?.name);
		if (!name || !/^(@[a-z0-9~._-]+\/)?[a-z0-9~._-]+$/.test(name)) continue;
		out.push({
			name, version: str(p?.version) ?? '', description: str(p?.description) ?? '', weeklyDownloads: num(o?.downloads?.weekly),
			publisher: str(p?.publisher?.username), trustedPublisher: !!p?.publisher?.trustedPublisher, license: str(p?.license),
			updatedAt: str(p?.date), repositoryUrl: githubRepoUrlOf(str(p?.links?.repository)), keywords: Array.isArray(p?.keywords) ? p.keywords.filter((k: unknown) => typeof k === 'string') : [],
		});
	}
	return out;
}

/** the official registry says whether an entry is still maintained */
export function registryEntryStatus(entry: any): { deprecated: boolean; publishedAt?: string; updatedAt?: string } {
	const meta = entry?._meta?.['io.modelcontextprotocol.registry/official'];
	return { deprecated: meta?.status === 'deprecated' || meta?.status === 'deleted', publishedAt: str(meta?.publishedAt), updatedAt: str(meta?.updatedAt) };
}

// ---- more live sources

export type SkillsMpResult = {
	readonly name: string;
	readonly author?: string;
	readonly description: string;
	/** the skill's folder on GitHub */
	readonly githubUrl: string;
	readonly stars: number;
	readonly updatedAt?: string;
};

/** skillsmp.com/api/v1/skills/search: skills indexed from GitHub, with the repository's stars and when the skill last changed (seconds since 1970) */
export function parseSkillsMp(data: any): SkillsMpResult[] {
	const items: any[] = Array.isArray(data?.data?.skills) ? data.data.skills : [];
	const out: SkillsMpResult[] = [];
	for (const s of items) {
		const name = str(s?.name);
		const githubUrl = githubFolderUrlOf(str(s?.githubUrl));
		if (!name || !githubUrl) continue;
		const secs = typeof s?.updatedAt === 'number' && s.updatedAt > 0 ? s.updatedAt : undefined;
		out.push({ name, author: str(s?.author), description: str(s?.description) ?? '', githubUrl, stars: num(s?.stars), updatedAt: secs ? new Date(secs * 1000).toISOString() : undefined });
	}
	return out;
}

/** a github.com address of a repository or of a folder inside one, as it stands; anything else is refused */
export function githubFolderUrlOf(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(\/tree\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.@%+-]+)*)?\/?$/.exec(raw.trim());
	return m ? `https://github.com/${m[1]}/${m[2]}${m[3] ?? ''}` : undefined;
}

export type SmitherySkillResult = {
	readonly qualifiedName: string;
	readonly displayName: string;
	readonly description: string;
	readonly categories: readonly string[];
	/** the stars of the repository the skill lives in */
	readonly stars: number;
	readonly gitUrl: string;
	readonly verified: boolean;
	readonly createdAt?: string;
};

/** registry.smithery.ai/skills: skills with the section Smithery put them in */
export function parseSmitherySkills(data: any): SmitherySkillResult[] {
	const items: any[] = Array.isArray(data?.skills) ? data.skills : [];
	const out: SmitherySkillResult[] = [];
	for (const s of items) {
		// Current listings expose namespace + slug; older responses used qualifiedName.
		const namespace = str(s?.namespace), slug = str(s?.slug);
		const q = str(s?.qualifiedName) ?? (namespace && slug ? `${namespace}/${slug}` : undefined);
		const gitUrl = githubFolderUrlOf(str(s?.gitUrl));
		if (!q || !gitUrl || s?.listed === false) continue;
		out.push({
			qualifiedName: q, displayName: str(s?.displayName) ?? q, description: str(s?.description) ?? '', categories: Array.isArray(s?.categories) ? s.categories.filter((c: unknown) => typeof c === 'string') : [],
			stars: num(s?.externalStars), gitUrl, verified: s?.verified === true, createdAt: str(s?.createdAt),
		});
	}
	return out;
}

export type DockerMcpResult = {
	/** the image name under the "mcp" namespace, without it ("github" for mcp/github) */
	readonly name: string;
	readonly description: string;
	readonly pulls: number;
	readonly stars: number;
	readonly updatedAt?: string;
};

/** hub.docker.com/v2/namespaces/mcp/repositories: the MCP server images Docker curates, with how many times each was pulled */
export function parseDockerMcp(data: any): DockerMcpResult[] {
	const items: any[] = Array.isArray(data?.results) ? data.results : [];
	const out: DockerMcpResult[] = [];
	for (const r of items) {
		const name = str(r?.name);
		if (!name || !/^[a-z0-9][a-z0-9._-]*$/.test(name) || r?.is_private === true || name === 'catalog') continue;
		out.push({ name, description: str(r?.description) ?? '', pulls: num(r?.pull_count), stars: num(r?.star_count), updatedAt: str(r?.last_updated) });
	}
	return out;
}

export type OpenVsxResult = {
	/** namespace.name, the id the editor installs by */
	readonly id: string;
	readonly displayName: string;
	readonly description: string;
	readonly version: string;
	readonly downloads: number;
	readonly rating?: number;
	readonly ratingCount: number;
	readonly verified: boolean;
	readonly deprecated: boolean;
	readonly updatedAt?: string;
	readonly iconUrl?: string;
	readonly publisher: string;
};

/** open-vsx.org/api/-/search */
export function parseOpenVsx(data: any): OpenVsxResult[] {
	const items: any[] = Array.isArray(data?.extensions) ? data.extensions : [];
	const out: OpenVsxResult[] = [];
	for (const e of items) {
		const ns = str(e?.namespace), name = str(e?.name);
		if (!ns || !name || !/^[A-Za-z0-9_.-]+$/.test(ns) || !/^[A-Za-z0-9_.-]+$/.test(name)) continue;
		const icon = str(e?.files?.icon);
		out.push({
			id: `${ns}.${name}`, displayName: str(e?.displayName) ?? name, description: str(e?.description) ?? '', version: str(e?.version) ?? '',
			downloads: num(e?.downloadCount), rating: typeof e?.averageRating === 'number' && e.averageRating > 0 ? e.averageRating : undefined, ratingCount: num(e?.reviewCount),
			verified: e?.verified === true, deprecated: e?.deprecated === true, updatedAt: str(e?.timestamp), iconUrl: icon && /^https:\/\/open-vsx\.org\//.test(icon) ? icon : undefined, publisher: ns,
		});
	}
	return out;
}
