/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDiscoveryMainService, McpRegistrySearchResult, SkillNetSearchResult } from '../common/discovery/discoveryServiceTypes.js';

// Real, live, unauthenticated public APIs - no source code or workspace content is ever
// sent to either of these, only the search string the user/agent typed.
const MCP_REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io';
const SKILLNET_BASE_URL = 'http://api-skillnet.openkg.cn';
const FETCH_TIMEOUT_MS = 10_000;

async function fetchJson(url: string): Promise<any> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
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
		return await res.text();
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
			const servers: any[] = Array.isArray(data?.servers) ? data.servers : [];
			return servers.map((entry): McpRegistrySearchResult => {
				const server = entry?.server ?? entry;
				const remotes: any[] = Array.isArray(server?.remotes) ? server.remotes : [];
				const remoteUrl: string | undefined = remotes.find(r => typeof r?.url === 'string')?.url;
				const hasPackages = Array.isArray(server?.packages) && server.packages.length > 0;
				return {
					name: String(server?.name ?? 'unknown'),
					description: String(server?.description ?? ''),
					version: String(server?.version ?? ''),
					remoteUrl,
					localOnly: !remoteUrl && hasPackages,
					repositoryUrl: server?.repository?.url,
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

	async fetchSkillInstructions(repositoryUrl: string): Promise<string | null> {
		// Best-effort: only handles github.com repository/tree URLs (what SkillNet indexes),
		// converting to raw.githubusercontent.com and trying common instruction filenames.
		const match = repositoryUrl.match(/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)\/(.*))?/);
		if (!match) return null;
		const [, owner, repo, branch, subpath] = match;
		const ref = branch || 'main';
		const base = subpath ? `${subpath.replace(/\/$/, '')}/` : '';
		for (const filename of ['SKILL.md', 'skill.md', 'README.md', 'readme.md']) {
			const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${base}${filename}`;
			const text = await fetchText(rawUrl);
			if (text) return text;
		}
		return null;
	}
}
