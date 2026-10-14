/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { GithubSkillEntry, GithubSkillListing, IDiscoveryMainService, McpRegistryPackage, McpRegistrySearchResult, SkillNetSearchResult } from '../common/discovery/discoveryServiceTypes.js';
import { parseRepoRef, parseSkillFrontmatter, skillFolderUrl, skillFoldersFromTree } from '../common/discovery/githubSkillSources.js';
import { rawSkillInstructionUrls } from '../common/discovery/githubSkillUrl.js';

// Real, live, unauthenticated public APIs - no source code or workspace content is ever
// sent to either of these, only the search string the user/agent typed.
const MCP_REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io';
const SKILLNET_BASE_URL = 'http://api-skillnet.openkg.cn';
const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_CACHE_TTL_MS = 10 * 60_000;
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

async function fetchJson(url: string): Promise<any> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return JSON.parse(await readCapped(res));
	} finally {
		clearTimeout(timeoutId);
	}
}

async function fetchText(url: string): Promise<string | null> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) return null;
		return await readCapped(res);
	} catch {
		return null;
	} finally {
		clearTimeout(timeoutId);
	}
}

export class DiscoveryMainService extends Disposable implements IDiscoveryMainService {
	_serviceBrand: undefined;

	async searchMcpRegistry(query: string): Promise<McpRegistrySearchResult[]> {
		try {
			const url = `${MCP_REGISTRY_BASE_URL}/v0/servers?search=${encodeURIComponent(query)}&limit=20`;
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
				};
			});
		} catch (e) {
			// Discovery failing (offline, registry down, blocked network) should degrade to
			// "no results found," not crash the caller - this is advisory, not load-bearing.
			return [];
		}
	}

	async searchSkillNet(query: string): Promise<SkillNetSearchResult[]> {
		try {
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
		} catch (e) {
			return [];
		}
	}

	// A repository's listing is cached for a few minutes: GitHub allows 60 unauthenticated API calls an hour, and a store that is
	// opened and closed would otherwise spend two of them every time.
	private readonly _githubCache = new Map<string, { atMs: number; listing: GithubSkillListing }>();

	async listGithubSkills(repoSpec: string): Promise<GithubSkillListing> {
		const ref = parseRepoRef(repoSpec);
		if (!ref) { return { repo: repoSpec, stars: 0, entries: [], error: 'Not a GitHub repository. Use owner/repo or a https://github.com address.' }; }
		const name = `${ref.owner}/${ref.repo}`;
		const cached = this._githubCache.get(name.toLowerCase());
		if (cached && Date.now() - cached.atMs < GITHUB_CACHE_TTL_MS) { return cached.listing; }
		try {
			const meta = await fetchJson(`${GITHUB_API_BASE_URL}/repos/${ref.owner}/${ref.repo}`);
			const branch = typeof meta?.default_branch === 'string' && /^[A-Za-z0-9_.-]+$/.test(meta.default_branch) ? meta.default_branch : 'main';
			const tree = await fetchJson(`${GITHUB_API_BASE_URL}/repos/${ref.owner}/${ref.repo}/git/trees/${branch}?recursive=1`);
			const folders = skillFoldersFromTree(Array.isArray(tree?.tree) ? tree.tree : []);
			const entries: GithubSkillEntry[] = new Array(folders.length);
			let next = 0;
			// six downloads at a time: raw.githubusercontent.com is not rate limited like the API, but there is no reason to open eighty connections
			await Promise.all(Array.from({ length: Math.min(6, folders.length) }, async () => {
				for (; ;) {
					const i = next++;
					if (i >= folders.length) { return; }
					const f = folders[i];
					const text = await fetchText(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${branch}/${f.skillMdPath}`) ?? '';
					const fm = parseSkillFrontmatter(text);
					const fallbackName = f.dir ? f.dir.split('/').pop()! : ref.repo;
					entries[i] = {
						name: fm.name ?? fallbackName, description: fm.description ?? '', repositoryUrl: skillFolderUrl(ref, branch, f.dir),
						owner: ref.owner, repo: ref.repo, sizeBytes: f.sizeBytes, instructions: text,
					};
				}
			}));
			const listing: GithubSkillListing = { repo: name, stars: Number(meta?.stargazers_count ?? 0), entries };
			this._githubCache.set(name.toLowerCase(), { atMs: Date.now(), listing });
			return listing;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return { repo: name, stars: 0, entries: [], error: /HTTP (403|429)/.test(message) ? 'GitHub is limiting requests from this computer for now. Try again in a few minutes.' : /HTTP 404/.test(message) ? 'That repository was not found.' : `Could not read the repository (${message}).` };
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
