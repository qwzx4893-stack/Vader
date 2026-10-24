/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { DockerMcpResult, GithubSkillEntry, GithubSkillListing, IDiscoveryMainService, McpRegistryPackage, McpRegistrySearchResult, NpmMcpResult, OpenVsxResult, RepoSignals, SkillNetSearchResult, SkillsMpResult, SkillsShResult, SmitherySkillResult, SmitheryResult } from '../common/discovery/discoveryServiceTypes.js';
import { parseDockerMcp, parseGithubSearch, parseNpmSearch, parseOpenVsx, parseRepoSignals, parseSkillsMp, parseSkillsSh, parseSmithery, parseSmitherySkills, registryEntryStatus } from '../common/discovery/feedParsers.js';
import { parseRepoRef, parseSkillFrontmatter, skillFolderUrl, skillFoldersFromTree } from '../common/discovery/githubSkillSources.js';
import { rawSkillInstructionUrls } from '../common/discovery/githubSkillUrl.js';

// Real, live, unauthenticated public APIs - no source code or workspace content is ever
// sent to either of these, only the search string the user/agent typed.
const MCP_REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io';
const SKILLNET_BASE_URL = 'http://api-skillnet.openkg.cn';
const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_CACHE_TTL_MS = 10 * 60_000;
const SKILLS_SH_BASE_URL = 'https://skills.sh';
const SMITHERY_BASE_URL = 'https://registry.smithery.ai';
const NPM_REGISTRY_BASE_URL = 'https://registry.npmjs.org';
const FEED_CACHE_TTL_MS = 10 * 60_000;
const SKILLSMP_BASE_URL = 'https://skillsmp.com';
const DOCKER_HUB_BASE_URL = 'https://hub.docker.com';
const OPEN_VSX_BASE_URL = 'https://open-vsx.org';
const SIGNALS_CACHE_TTL_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
// Responses come from third-party servers; never read an unbounded body into memory.
const MAX_RESPONSE_BYTES = 1024 * 1024;

async function readCapped(res: Response): Promise<string> {
	if (Number(res.headers.get('content-length') ?? 0) > MAX_RESPONSE_BYTES) throw new Error('response too large');
	if (!res.body) return '';
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (; ;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('response too large'); }
		chunks.push(value);
	}
	const all = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
	return new TextDecoder().decode(all);
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<any> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (signal?.aborted) controller.abort();
	signal?.addEventListener('abort', abort, { once: true });
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
		if (!res.ok) {
			if ((res.status === 403 || res.status === 429) && new URL(url).hostname === 'api.github.com') throw new Error('GitHub is limiting requests from this computer for now (it allows 60 an hour without a key). Try again in a few minutes.');
			throw new Error(`HTTP ${res.status}`);
		}
		return JSON.parse(await readCapped(res));
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener('abort', abort);
	}
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string | null> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (signal?.aborted) controller.abort();
	signal?.addEventListener('abort', abort, { once: true });
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) return null;
		return await readCapped(res);
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
		signal?.removeEventListener('abort', abort);
	}
}

export class DiscoveryMainService extends Disposable implements IDiscoveryMainService {
	_serviceBrand: undefined;

	// Every live feed is asked at most once every ten minutes for the same words; a store that is opened and closed must not spend the
	// quota that GitHub (60 calls an hour, 10 searches a minute without a key) gives this computer.
	private readonly _feedCache = new Map<string, { atMs: number; value: unknown }>();
	private readonly _inFlight = new Map<string, Promise<unknown>>();
	private async _cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
		const hit = this._feedCache.get(key);
		if (hit && Date.now() - hit.atMs < ttlMs) { return hit.value as T; }
		const pending = this._inFlight.get(key);
		if (pending) return pending as Promise<T>;
		const request = Promise.resolve().then(load).then(value => {
			this._feedCache.set(key, { atMs: Date.now(), value });
			if (this._feedCache.size > 200) this._feedCache.delete(this._feedCache.keys().next().value!);
			return value;
		}).finally(() => this._inFlight.delete(key));
		this._inFlight.set(key, request);
		return request;
	}

	searchSkillsSh(query: string): Promise<SkillsShResult[]> {
		const q = query.trim();
		if (q.length < 2) { return Promise.resolve([]); } // the service refuses anything shorter
		return this._cached(`skillssh:${q.toLowerCase()}`, FEED_CACHE_TTL_MS, async () => parseSkillsSh(await fetchJson(`${SKILLS_SH_BASE_URL}/api/search?q=${encodeURIComponent(q)}&limit=24`)));
	}

	searchGithubTopic(topic: string, query: string): Promise<RepoSignals[]> {
		if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(topic)) { return Promise.resolve([]); }
		const q = `${query.trim()} topic:${topic}`.trim();
		return this._cached(`ghtopic:${q.toLowerCase()}`, FEED_CACHE_TTL_MS, async () => parseGithubSearch(await fetchJson(`${GITHUB_API_BASE_URL}/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=24`)));
	}

	searchSmithery(query: string): Promise<SmitheryResult[]> {
		const q = query.trim();
		return this._cached(`smithery:${q.toLowerCase()}`, FEED_CACHE_TTL_MS, async () => parseSmithery(await fetchJson(`${SMITHERY_BASE_URL}/servers?${q ? `q=${encodeURIComponent(q)}&` : ''}pageSize=24`)));
	}

	searchSkillsMp(query: string): Promise<SkillsMpResult[]> {
		const q = query.trim();
		if (q.length < 2) { return Promise.resolve([]); }
		return this._cached(`skillsmp:${q.toLowerCase()}`, FEED_CACHE_TTL_MS, async () => parseSkillsMp(await fetchJson(`${SKILLSMP_BASE_URL}/api/v1/skills/search?q=${encodeURIComponent(q)}&limit=24`)));
	}

	searchSmitherySkills(query: string): Promise<SmitherySkillResult[]> {
		const q = query.trim();
		return this._cached(`smitheryskills:${q.toLowerCase()}`, FEED_CACHE_TTL_MS, async () => parseSmitherySkills(await fetchJson(`${SMITHERY_BASE_URL}/skills?${q ? `q=${encodeURIComponent(q)}&` : ''}pageSize=24`)));
	}

	async searchDockerMcp(query: string): Promise<DockerMcpResult[]> {
		// the namespace has a few hundred images and no search of its own: the hundred most pulled are read once and narrowed here
		const all = await this._cached('dockermcp', FEED_CACHE_TTL_MS, async () => parseDockerMcp(await fetchJson(`${DOCKER_HUB_BASE_URL}/v2/namespaces/mcp/repositories?page_size=100&ordering=-pull_count`)));
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return words.length === 0 ? all.slice(0, 24) : all.filter(r => words.every(w => `${r.name} ${r.description}`.toLowerCase().includes(w))).slice(0, 24);
	}

	searchOpenVsx(query: string, category: string | undefined, sortBy: 'downloadCount' | 'rating' | 'timestamp' | 'relevance'): Promise<OpenVsxResult[]> {
		const params = new URLSearchParams({ size: '30', sortOrder: 'desc', sortBy: query.trim() && sortBy === 'downloadCount' ? 'relevance' : sortBy });
		if (query.trim()) { params.set('query', query.trim()); }
		if (category && /^[A-Za-z ]{2,40}$/.test(category)) { params.set('category', category); }
		return this._cached(`openvsx:${params.toString()}`, FEED_CACHE_TTL_MS, async () => parseOpenVsx(await fetchJson(`${OPEN_VSX_BASE_URL}/api/-/search?${params.toString()}`)));
	}

	searchNpmMcp(query: string): Promise<NpmMcpResult[]> {
		const text = `keywords:mcp-server ${query.trim()}`.trim();
		return this._cached(`npm:${text.toLowerCase()}`, FEED_CACHE_TTL_MS, async () => parseNpmSearch(await fetchJson(`${NPM_REGISTRY_BASE_URL}/-/v1/search?text=${encodeURIComponent(text)}&size=24`)));
	}

	async getNpmInfo(name: string): Promise<{ installScripts: boolean; deprecated: boolean; license?: string } | undefined> {
		if (!/^(@[a-z0-9~._-]+\/)?[a-z0-9~._-]+$/.test(name)) { return undefined; }
		try {
			return await this._cached(`npminfo:${name}`, SIGNALS_CACHE_TTL_MS, async () => {
				const j = await fetchJson(`${NPM_REGISTRY_BASE_URL}/${name.replace('/', '%2F')}/latest`);
				const s = j?.scripts ?? {};
				return { installScripts: !!(s.preinstall || s.install || s.postinstall), deprecated: typeof j?.deprecated === 'string' && j.deprecated.length > 0, license: typeof j?.license === 'string' ? j.license : undefined };
			});
		} catch {
			return undefined;
		}
	}

	async getRepoSignals(repoSpec: string): Promise<RepoSignals | undefined> {
		const ref = parseRepoRef(repoSpec);
		if (!ref) { return undefined; }
		try {
			return await this._cached(`repo:${ref.owner}/${ref.repo}`.toLowerCase(), SIGNALS_CACHE_TTL_MS, async () => parseRepoSignals(await fetchJson(`${GITHUB_API_BASE_URL}/repos/${ref.owner}/${ref.repo}`)));
		} catch {
			return undefined; // a limited or offline GitHub leaves the signals unknown, which the score does not hold against anything
		}
	}

	async searchMcpRegistry(query: string): Promise<McpRegistrySearchResult[]> {
		try {
			return await this.queryMcpRegistry(query);
		} catch (e) {
			// Discovery failing (offline, registry down, blocked network) should degrade to "no results found," not crash the caller - this is advisory, not load-bearing.
			return [];
		}
	}

	queryMcpRegistry(query: string): Promise<McpRegistrySearchResult[]> {
		return this._cached(`mcpreg:${query.trim().toLowerCase()}`, FEED_CACHE_TTL_MS, () => this._queryMcpRegistry(query));
	}

	private async _queryMcpRegistry(query: string): Promise<McpRegistrySearchResult[]> {
		{
			// Ask for latest versions before the page limit, instead of discarding most of a page of historical versions.
			// https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md
			const url = `${MCP_REGISTRY_BASE_URL}/v0.1/servers?search=${encodeURIComponent(query)}&version=latest&limit=40`;
			const data = await fetchJson(url);
			const all: any[] = Array.isArray(data?.servers) ? data.servers : [];
			// the registry lists every published version of a server; only the latest one is offered, once
			const seenNames = new Set<string>();
			const servers = all.filter(entry => {
				const server = entry?.server ?? entry;
				const meta = entry?._meta?.['io.modelcontextprotocol.registry/official'];
				if (meta?.isLatest === false) return false;
				const name = String(server?.name ?? '');
				if (seenNames.has(name)) return false;
				seenNames.add(name);
				return true;
			});
			return servers.map((entry): McpRegistrySearchResult => {
				const server = entry?.server ?? entry;
				const remotes: any[] = Array.isArray(server?.remotes) ? server.remotes : [];
				const remoteUrl: string | undefined = remotes.find(r => typeof r?.url === 'string')?.url;
				const rawPackages: any[] = Array.isArray(server?.packages) ? server.packages : [];
				const hasPackages = rawPackages.length > 0;
				const packages: McpRegistryPackage[] = rawPackages.map((p): McpRegistryPackage => ({
					registryType: String(p?.registryType ?? p?.registry_type ?? 'unknown'),
					identifier: String(p?.identifier ?? p?.name ?? ''),
					version: String(p?.version ?? ''),
					runtimeHint: p?.runtimeHint ?? p?.runtime_hint,
					environmentVariables: Array.isArray(p?.environmentVariables) ? p.environmentVariables.map((e: any) => ({
						name: String(e?.name ?? ''),
						description: e?.description ? String(e.description) : undefined,
						isRequired: !!e?.isRequired,
						isSecret: !!e?.isSecret,
						default: e?.default !== undefined ? String(e.default) : undefined,
					})) : undefined,
				}));
				return {
					name: String(server?.name ?? 'unknown'),
					description: String(server?.description ?? ''),
					version: String(server?.version ?? ''),
					remoteUrl,
					localOnly: !remoteUrl && hasPackages,
					repositoryUrl: server?.repository?.url,
					packages: packages.length > 0 ? packages : undefined,
					...(() => { const s = registryEntryStatus(entry); return { deprecated: s.deprecated || undefined, publishedAt: s.publishedAt, updatedAt: s.updatedAt }; })(),
				};
			});
		}
	}

	async searchSkillNet(query: string): Promise<SkillNetSearchResult[]> {
		try {
			return await this.querySkillNet(query);
		} catch {
			return [];
		}
	}

	async querySkillNet(query: string): Promise<SkillNetSearchResult[]> {
			const url = `${SKILLNET_BASE_URL}/v1/search?q=${encodeURIComponent(query)}&mode=keyword&limit=20`;
			const data = await fetchJson(url);
			const rawResults: any[] = Array.isArray(data?.results) ? data.results
				: Array.isArray(data?.skills) ? data.skills
					: Array.isArray(data) ? data
						: [];
			return rawResults.map((s): SkillNetSearchResult => ({
				name: String(s?.skill_name ?? s?.name ?? 'unknown'),
				description: String(s?.description ?? s?.summary ?? ''),
				repositoryUrl: String(s?.skill_url ?? s?.repo_url ?? s?.repository_url ?? s?.url ?? ''),
				stars: Number(s?.stars ?? s?.star_count ?? 0),
				category: s?.category ? String(s.category) : undefined,
			})).filter(s => !!s.repositoryUrl);
	}

	// A repository's listing is cached for a few minutes: GitHub allows 60 unauthenticated API calls an hour, and a store that is
	// opened and closed would otherwise spend two of them every time.
	private readonly _githubCache = new Map<string, { atMs: number; listing: GithubSkillListing }>();
	private readonly _githubInFlight = new Map<string, Promise<GithubSkillListing>>();

	async listGithubSkills(repoSpec: string): Promise<GithubSkillListing> {
		const ref = parseRepoRef(repoSpec);
		const key = ref ? `${ref.owner}/${ref.repo}`.toLowerCase() : repoSpec;
		const pending = this._githubInFlight.get(key);
		if (pending) return pending;
		const request = this._listGithubSkills(repoSpec).finally(() => this._githubInFlight.delete(key));
		this._githubInFlight.set(key, request);
		return request;
	}

	private async _listGithubSkills(repoSpec: string): Promise<GithubSkillListing> {
		const ref = parseRepoRef(repoSpec);
		if (!ref) { return { repo: repoSpec, stars: 0, entries: [], error: 'Not a GitHub repository. Use owner/repo or a https://github.com address.' }; }
		const name = `${ref.owner}/${ref.repo}`;
		const cached = this._githubCache.get(name.toLowerCase());
		if (cached && Date.now() - cached.atMs < (cached.listing.error ? 15_000 : GITHUB_CACHE_TTL_MS)) { return cached.listing; }
		// A repository listing used to spend up to 80 x 10s downloading instructions before returning anything.
		// Share one budget across metadata, tree and the six download workers; unread files keep real folder names.
		const controller = new AbortController();
		const deadline = setTimeout(() => controller.abort(), 9_000);
		try {
			const meta = await fetchJson(`${GITHUB_API_BASE_URL}/repos/${ref.owner}/${ref.repo}`, controller.signal);
			const branch = typeof meta?.default_branch === 'string' && /^[A-Za-z0-9_.-]+$/.test(meta.default_branch) ? meta.default_branch : 'main';
			const tree = await fetchJson(`${GITHUB_API_BASE_URL}/repos/${ref.owner}/${ref.repo}/git/trees/${branch}?recursive=1`, controller.signal);
			const folders = skillFoldersFromTree(Array.isArray(tree?.tree) ? tree.tree : []);
			const entries: GithubSkillEntry[] = new Array(folders.length);
			let next = 0;
			let unread = 0;
			// six downloads at a time: raw.githubusercontent.com is not rate limited like the API, but there is no reason to open eighty connections
			await Promise.all(Array.from({ length: Math.min(6, folders.length) }, async () => {
				for (; ;) {
					const i = next++;
					if (i >= folders.length) { return; }
					const f = folders[i];
					const text = controller.signal.aborted ? '' : await fetchText(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branch}/${f.skillMdPath}`, controller.signal) ?? '';
					if (!text) unread++;
					const fm = parseSkillFrontmatter(text);
					const fallbackName = f.dir ? f.dir.split('/').pop()! : ref.repo;
					entries[i] = {
						name: fm.name ?? fallbackName, description: fm.description ?? '', repositoryUrl: skillFolderUrl(ref, branch, f.dir),
						owner: ref.owner, repo: ref.repo, sizeBytes: f.sizeBytes, instructions: text,
					};
				}
			}));
			const listing: GithubSkillListing = { repo: name, stars: Number(meta?.stargazers_count ?? 0), signals: parseRepoSignals(meta), entries,
				error: unread ? `${unread} skill instruction files could not be read; folder names are shown. Open or install a skill to retry its text.` : undefined };
			this._githubCache.set(name.toLowerCase(), { atMs: Date.now(), listing });
			if (this._githubCache.size > 200) this._githubCache.delete(this._githubCache.keys().next().value!);
			return listing;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return { repo: name, stars: 0, entries: [], error: /HTTP (403|429)/.test(message) ? 'GitHub is limiting requests from this computer for now. Try again in a few minutes.' : /HTTP 404/.test(message) ? 'That repository was not found.' : `Could not read the repository (${message}).` };
		} finally {
			clearTimeout(deadline);
		}
	}

	async resolveGithubSkill(repoSpec: string, skillId: string): Promise<GithubSkillEntry | undefined> {
		const ref = parseRepoRef(repoSpec);
		if (!ref || !/^[A-Za-z0-9_.-]+$/.test(skillId)) { return undefined; }
		try {
			const found = await this._cached(`skilltree:${ref.owner}/${ref.repo}`.toLowerCase(), GITHUB_CACHE_TTL_MS, async () => {
				const meta = await fetchJson(`${GITHUB_API_BASE_URL}/repos/${ref.owner}/${ref.repo}`);
				const branch = typeof meta?.default_branch === 'string' && /^[A-Za-z0-9_.-]+$/.test(meta.default_branch) ? meta.default_branch : 'main';
				const tree = await fetchJson(`${GITHUB_API_BASE_URL}/repos/${ref.owner}/${ref.repo}/git/trees/${branch}?recursive=1`);
				return { branch, folders: skillFoldersFromTree(Array.isArray(tree?.tree) ? tree.tree : []) };
			});
			const folder = found.folders.find(f => (f.dir ? f.dir.split('/').pop() : ref.repo) === skillId);
			if (!folder) { return undefined; }
			const text = await fetchText(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${found.branch}/${folder.skillMdPath}`) ?? '';
			const fm = parseSkillFrontmatter(text);
			return { name: fm.name ?? skillId, description: fm.description ?? '', repositoryUrl: skillFolderUrl(ref, found.branch, folder.dir), owner: ref.owner, repo: ref.repo, sizeBytes: folder.sizeBytes, instructions: text };
		} catch {
			return undefined;
		}
	}

	async fetchSkillInstructions(repositoryUrl: string): Promise<string | null> {
		// Best-effort: only plain github.com repository/tree URLs (what SkillNet indexes) are accepted,
		// see githubSkillUrl.ts, and converted to raw.githubusercontent.com.
		const urls = rawSkillInstructionUrls(repositoryUrl);
		if (!urls) return null;
		for (const rawUrl of urls) {
			const text = await fetchText(rawUrl);
			if (text) return text;
		}
		return null;
	}
}
