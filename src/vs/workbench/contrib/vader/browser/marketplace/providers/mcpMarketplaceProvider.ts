/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IOpenerService } from '../../../../../../platform/opener/common/opener.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IQuickInputService } from '../../../../../../platform/quickinput/common/quickInput.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IMCPService } from '../../../common/mcpService.js';
import { MCPConfigFileEntryJSON } from '../../../common/mcpServiceTypes.js';
import { DockerMcpResult, IDiscoveryMainService, McpRegistryPackage, McpRegistrySearchResult, NpmMcpResult, RepoSignals, SmitheryResult } from '../../../common/discovery/discoveryServiceTypes.js';
import { githubRepoUrlOf, ownerOfGithubUrl } from '../../../common/discovery/feedParsers.js';
import { IMarketplaceProvider, ItemFact, IUnifiedMarketplaceService, MarketplaceItem } from '../../../common/marketplace/marketplaceTypes.js';
import { categoryOf, classify } from '../../../common/marketplace/categories.js';
import { computeTrust, TrustInputs } from '../../../common/marketplace/trustScore.js';
import { querySource } from '../../../common/marketplace/sourceQuery.js';
import { isSourceOn } from '../../../common/marketplace/addonSources.js';
import { IVaderSettingsService } from '../../../common/vaderSettingsService.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// MCP servers are found in four live sources at once and merged into one row each:
//   - the official MCP Registry (registry.modelcontextprotocol.io)
//   - Smithery (registry.smithery.ai): use counts and verified publishers
//   - npm: packages that call themselves MCP servers, with weekly downloads and whether they were published from a CI workflow
//   - Docker: the MCP server images Docker curates (hub.docker.com, namespace mcp), with how many times each was pulled
//   - GitHub: repositories tagged "mcp-server", with their own live signals
// A server two sources both list is one row that says so (two sources agreeing is a signal in the score). Every signal a source gave goes
// into the score as it is read; nothing is a ready-made number. Configured servers come from IMCPService's own config-file state.
//
// "Configure" writes a real, runnable entry into mcp.json via IMCPService.addOrUpdateServer, built from what a source really says:
//   - the registry's remote address, or its package (npx, uvx, docker with the registry's own runtime hint), asking for required secrets
//   - a Smithery server: its hosted address, asking for the person's Smithery key (sent as the bearer token Smithery documents)
//   - an npm package: npx -y <package>
//   - a repository with nothing runnable described: its page is opened in the browser, because a command would be a guess
// The existing mcp.json watcher then runs the real add-server/health-check flow, so there is one server lifecycle, not two.

const SMITHERY_HOSTED = 'https://server.smithery.ai';

/** who published a registry entry: the owner of its GitHub repository, else the name of its reverse-domain namespace ("com.stripe/mcp" is stripe) */
function mcpPublisherOf(result: McpRegistrySearchResult): string | undefined {
	const owner = ownerOfGithubUrl(result.repositoryUrl);
	if (owner) return owner;
	const ns = result.name.split('/')[0];
	if (ns.startsWith('io.github.')) return ns.slice('io.github.'.length);
	const parts = ns.split('.');
	return parts.length >= 2 ? parts[parts.length - 1] : undefined;
}

/** a live look finds newer numbers: the facts on the item's page take them in, keeping the order they were in */
function mergeFacts(facts: readonly ItemFact[] | undefined, p: Partial<TrustInputs>): ItemFact[] {
	const out = [...(facts ?? [])];
	const set = (label: string, value: string, before?: string) => {
		const i = out.findIndex(f => f.label === label);
		if (i >= 0) out[i] = { ...out[i], value }; else { const b = before ? out.findIndex(f => f.label === before) : -1; if (b >= 0) out.splice(b, 0, { label, value }); else out.push({ label, value }); }
	};
	if (typeof p.stars === 'number') set('Stars', p.stars.toLocaleString('en-US'), 'Repository');
	const changed = p.pushedAt ? Date.parse(p.pushedAt) : NaN;
	if (Number.isFinite(changed)) set('Last change', new Date(changed).toISOString().slice(0, 10), 'Repository');
	if (p.license !== undefined) set('Licence', p.license ?? 'none declared', 'Repository');
	if (p.archived) set('Status', 'Archived', 'Repository');
	if (p.installScripts) set('Install', 'runs a script when installed', 'Repository');
	return out;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** what the sources said about one server, kept together */
type Found = {
	registry?: McpRegistrySearchResult;
	smithery?: SmitheryResult;
	npm?: NpmMcpResult;
	docker?: DockerMcpResult;
	repo?: RepoSignals;
	sourceIds: Set<string>;
	labels: string[];
};

export class MCPMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'mcp-registry';
	readonly displayName = 'MCP Servers';
	readonly itemType = 'MCP_SERVER' as const;
	readonly cacheTtlMs = 60_000;

	private _warnings: string[] = [];
	private readonly _warningsByToken = new WeakMap<CancellationToken, string[]>();

	constructor(
		private readonly _mcpService: IMCPService,
		private readonly _discoveryService: IDiscoveryMainService,
		private readonly _quickInputService: IQuickInputService,
		private readonly _openerService: IOpenerService,
		private readonly _settings: IVaderSettingsService,
	) { }

	takeWarnings(token?: CancellationToken): string[] { const w = token ? this._warningsByToken.get(token) ?? [] : this._warnings; if (token) this._warningsByToken.delete(token); if (w === this._warnings) this._warnings = []; return w; }

	private _on(sourceId: string): boolean { return isSourceOn(this._settings.state.globalSettings.addonSourcesOff, sourceId); }

	private _configuredToItems(): MarketplaceItem[] {
		return Object.entries(this._mcpService.state.mcpServerOfName ?? {}).map(([name, server]): MarketplaceItem => ({
			id: name,
			providerId: this.id,
			type: 'MCP_SERVER',
			name,
			description: server.status === 'error' ? `Configuration error: ${server.error}` : `MCP server (${server.status})`,
			source: 'Configured (mcp.json)',
			trust: 'unknown',
			installed: true,
			enabled: server.status !== 'offline',
			installMethod: server.status === 'error' ? 'configure' : null,
			security: { source: 'mcp.json', executesCode: true, networkAccess: true },
			metadata: { serverName: name, status: server.status },
		}));
	}

	// ---- one row from everything the sources said

	private _inputsOf(f: Found): TrustInputs {
		const r = f.registry, s = f.smithery, n = f.npm, g = f.repo, d = f.docker;
		const repoUrl = githubRepoUrlOf(r?.repositoryUrl) ?? s?.repositoryUrl ?? n?.repositoryUrl ?? g?.url;
		const publisher = (r && mcpPublisherOf(r)) ?? ownerOfGithubUrl(repoUrl) ?? n?.publisher;
		const hasRemote = !!r?.remoteUrl || !!s?.remote;
		const hasLocal = (r?.packages?.length ?? 0) > 0 || !!n || !!d;
		const secrets = (r?.packages ?? []).flatMap(p => p.environmentVariables ?? []).filter(v => v.isRequired && v.isSecret).length;
		return {
			kind: 'mcp', name: r?.name ?? s?.qualifiedName ?? n?.name ?? (d ? `mcp/${d.name}` : undefined) ?? g?.repo, publisher: publisher ?? (d ? 'docker' : undefined),
			runsLocalCode: hasRemote && !hasLocal ? false : hasLocal ? true : undefined,
			publisherVerified: s?.verified || undefined,
			sourceInstalls: s?.useCount ?? d?.pulls, weeklyDownloads: n?.weeklyDownloads, trustedPublisher: n?.trustedPublisher || undefined,
			deprecated: r?.deprecated, license: n?.license ?? (g ? g.license ?? null : undefined),
			stars: g?.stars, forks: g?.forks, pushedAt: g?.pushedAt ?? n?.updatedAt ?? r?.updatedAt ?? d?.updatedAt, createdAt: g?.createdAt, archived: g?.archived, ownerType: g?.ownerType,
			listedBy: f.sourceIds.size, secretsRequested: secrets || undefined,
		};
	}

	/** what Vader would write into mcp.json for this server, said in words and as the entry itself, so the person reads it before adding it */
	private _setupOf(f: Found): { summary: string; transport: 'remote' | 'local' | 'hosted' | 'docker' | 'none'; entry?: string; env: { name: string; required: boolean; secret: boolean; description?: string }[]; needs?: string } {
		const r = f.registry, s = f.smithery, n = f.npm, d = f.docker;
		const pkg = r?.packages?.[0];
		const env = (pkg?.environmentVariables ?? []).map(v => ({ name: v.name, required: !!v.isRequired, secret: !!v.isSecret, description: v.description }));
		if (r?.remoteUrl) return { summary: 'A hosted server: nothing is installed on this computer, the agent calls it over the network.', transport: 'remote', entry: JSON.stringify({ url: r.remoteUrl }, null, 2), env };
		if (pkg) {
			const runtime = pkg.runtimeHint ?? (pkg.registryType === 'npm' ? 'npx' : pkg.registryType === 'pypi' ? 'uvx' : pkg.registryType === 'oci' ? 'docker' : pkg.registryType);
			const args = runtime === 'npx' ? ['-y', pkg.identifier] : runtime === 'docker' ? ['run', '-i', '--rm', pkg.identifier] : [pkg.identifier];
			return { summary: `A program that runs on this computer (${pkg.registryType} package ${pkg.identifier}).`, transport: runtime === 'docker' ? 'docker' : 'local', entry: JSON.stringify({ command: runtime, args }, null, 2), env, needs: runtime === 'docker' ? 'Docker' : runtime === 'npx' ? 'Node.js' : runtime === 'uvx' ? 'uv (Python)' : undefined };
		}
		if (s?.remote) return { summary: 'Hosted by Smithery: nothing is installed here. It asks for your own Smithery key, which is sent only to server.smithery.ai.', transport: 'hosted', entry: JSON.stringify({ url: `https://server.smithery.ai/${s.qualifiedName}/mcp`, headers: { Authorization: 'Bearer <your Smithery key>' } }, null, 2), env };
		if (n) return { summary: `A program that runs on this computer (npm package ${n.name}).`, transport: 'local', entry: JSON.stringify({ command: 'npx', args: ['-y', n.name] }, null, 2), env, needs: 'Node.js' };
		if (d) return { summary: `A Docker image curated by Docker (mcp/${d.name}); it runs in a container on this computer. It may need settings of its own that its page describes.`, transport: 'docker', entry: JSON.stringify({ command: 'docker', args: ['run', '-i', '--rm', `mcp/${d.name}`] }, null, 2), env, needs: 'Docker' };
		return { summary: 'This listing does not say how to run the server, and Vader will not guess a command. Its page opens in your browser.', transport: 'none', env };
	}

	private _factsOf(f: Found, inputs: TrustInputs, repositoryUrl: string | undefined): ItemFact[] {
		const r = f.registry, s = f.smithery, n = f.npm, d = f.docker, g = f.repo;
		const out: ItemFact[] = [];
		if (inputs.publisher) out.push({ label: 'Publisher', value: inputs.publisher, href: ownerOfGithubUrl(repositoryUrl) ? `https://github.com/${inputs.publisher}` : undefined });
		out.push({ label: 'Found in', value: f.labels.join(', ') });
		if (r?.version || n?.version) out.push({ label: 'Version', value: (r?.version || n?.version)! });
		if (s) out.push({ label: 'Smithery', value: `${s.verified ? 'verified, ' : ''}${s.useCount.toLocaleString('en-US')} uses` });
		if (n) out.push({ label: 'npm downloads', value: `${n.weeklyDownloads.toLocaleString('en-US')} a week` });
		if (d) out.push({ label: 'Docker pulls', value: d.pulls.toLocaleString('en-US') });
		if (typeof inputs.stars === 'number') out.push({ label: 'Stars', value: inputs.stars.toLocaleString('en-US') });
		const changed = inputs.pushedAt ? Date.parse(inputs.pushedAt) : NaN;
		if (Number.isFinite(changed)) out.push({ label: 'Last change', value: new Date(changed).toISOString().slice(0, 10) });
		if (inputs.license !== undefined) out.push({ label: 'Licence', value: inputs.license ?? 'none declared' });
		if (n?.trustedPublisher) out.push({ label: 'Published', value: 'from a CI workflow, with provenance' });
		if (r?.deprecated) out.push({ label: 'Status', value: 'Deprecated in the MCP Registry' });
		if (repositoryUrl) out.push({ label: 'Repository', value: repositoryUrl.replace('https://github.com/', ''), href: repositoryUrl });
		void g;
		return out;
	}

	private _toItem(f: Found, extra?: Partial<TrustInputs>): MarketplaceItem {
		const r = f.registry, s = f.smithery, n = f.npm, g = f.repo, d = f.docker;
		const inputs = { ...this._inputsOf(f), ...extra };
		const repositoryUrl = githubRepoUrlOf(r?.repositoryUrl) ?? s?.repositoryUrl ?? n?.repositoryUrl ?? g?.url;
		const name = s?.displayName ?? (r ? r.name.split('/').pop()! : undefined) ?? n?.name ?? d?.name ?? g?.repo.split('/')[1] ?? 'unknown';
		const serverKey = r?.name ?? (s ? `smithery-${slug(s.qualifiedName)}` : n ? slug(n.name) : d ? `docker-${slug(d.name)}` : slug(name));
		const runnable = !!r?.remoteUrl || (r?.packages?.length ?? 0) > 0 || !!s?.remote || !!n || !!d;
		const description = r?.description || s?.description || n?.description || d?.description || g?.description || '';
		const setup = this._setupOf(f);
		const facts = this._factsOf(f, inputs, repositoryUrl);
		return {
			id: r?.name ?? (s ? `smithery:${s.qualifiedName}` : n ? `npm:${n.name}` : d ? `docker:${d.name}` : `github:${g?.repo}`),
			providerId: this.id,
			type: 'MCP_SERVER',
			name,
			description,
			source: f.labels.join(' · '),
			publisher: inputs.publisher,
			version: r?.version || n?.version || undefined,
			trust: 'unknown',
			installed: false,
			trustScore: computeTrust(inputs),
			installMethod: 'configure',
			security: {
				source: repositoryUrl ?? r?.remoteUrl ?? s?.homepage ?? n?.name ?? 'MCP',
				repositoryUrl,
				executesCode: true, // an MCP server is an executable process (local package) or a remote endpoint this codebase's model will call tools on
				networkAccess: true,
			},
			metadata: {
				serverKey, remoteUrl: r?.remoteUrl, localOnly: r ? r.localOnly : undefined, repositoryUrl, packages: r?.packages,
				smithery: s ? { qualifiedName: s.qualifiedName, remote: s.remote } : undefined, npm: n ? { name: n.name } : undefined, docker: d ? { name: d.name } : undefined,
				categories: classify('mcp', { name, description, tags: [...(n?.keywords ?? []), ...(g?.topics ?? [])] }), setup, facts,
				repo: g?.repo ?? (repositoryUrl ? repositoryUrl.slice('https://github.com/'.length) : undefined),
				signals: extra, inputs, listedBy: f.sourceIds.size, sourcesListing: f.labels, openOnly: !runnable,
			},
		};
	}

	/** puts what different sources said about the same server together: the same GitHub repository, the same npm package, or the same registry name */
	private _group(parts: readonly { sourceId: string; label: string; registry?: McpRegistrySearchResult; smithery?: SmitheryResult; npm?: NpmMcpResult; docker?: DockerMcpResult; repo?: RepoSignals }[]): Found[] {
		const found: Found[] = [];
		const index = new Map<string, Found>();
		const keysOf = (p: (typeof parts)[number]): string[] => {
			const keys: string[] = [];
			const repo = githubRepoUrlOf(p.registry?.repositoryUrl) ?? p.smithery?.repositoryUrl ?? p.npm?.repositoryUrl ?? p.repo?.url;
			if (repo) keys.push(`repo:${repo.toLowerCase()}`);
			if (p.npm) keys.push(`npm:${p.npm.name}`);
			if (p.docker) keys.push(`docker:${p.docker.name}`);
			for (const pkg of p.registry?.packages ?? []) {
				if (pkg.registryType === 'npm') keys.push(`npm:${pkg.identifier}`);
				if (pkg.registryType === 'oci' && /(^|\/)mcp\/[a-z0-9._-]+(:|$)/.test(pkg.identifier)) keys.push(`docker:${/mcp\/([a-z0-9._-]+)/.exec(pkg.identifier)![1]}`);
			}
			if (p.registry) keys.push(`reg:${p.registry.name}`);
			if (p.smithery) keys.push(`sm:${p.smithery.qualifiedName}`);
			return keys;
		};
		for (const p of parts) {
			const keys = keysOf(p);
			let f = keys.map(k => index.get(k)).find(Boolean);
			if (!f) { f = { sourceIds: new Set(), labels: [] }; found.push(f); }
			f.registry ??= p.registry; f.smithery ??= p.smithery; f.npm ??= p.npm; f.docker ??= p.docker; f.repo ??= p.repo;
			f.sourceIds.add(p.sourceId);
			if (!f.labels.includes(p.label)) f.labels.push(p.label);
			for (const k of keys) index.set(k, f);
		}
		return found;
	}

	private async _gather(query: string, token: CancellationToken, category?: string): Promise<Found[]> {
		type Part = Parameters<MCPMarketplaceProvider['_group']>[0][number];
		// a section is looked for by name in every source; the front page is each source's own best
		const cat = category ? categoryOf('mcp', category) : undefined;
		const q = query.trim() || cat?.seeds[0] || '';
		const feeds: { id: string; label: string; run: () => Promise<Part[]> }[] = [
			{
				id: 'mcp-registry', label: 'Official MCP Registry', run: async () => {
					const rows = await this._discoveryService.queryMcpRegistry(q);
					return rows.map(r => ({ sourceId: 'mcp-registry', label: 'MCP Registry', registry: r }));
				},
			},
			{ id: 'smithery', label: 'Smithery', run: async () => (await this._discoveryService.searchSmithery(q)).map(s => ({ sourceId: 'smithery', label: 'Smithery', smithery: s })) },
			{ id: 'npm-mcp', label: 'npm', run: async () => (await this._discoveryService.searchNpmMcp(q)).map(n => ({ sourceId: 'npm-mcp', label: 'npm', npm: n })) },
			{ id: 'docker-mcp', label: 'Docker', run: async () => (await this._discoveryService.searchDockerMcp(q)).map(d => ({ sourceId: 'docker-mcp', label: 'Docker', docker: d })) },
			{ id: 'github-topic-mcp', label: 'GitHub topic mcp-server', run: async () => (await this._discoveryService.searchGithubTopic('mcp-server', q)).map(g => ({ sourceId: 'github-topic-mcp', label: 'GitHub', repo: g })) },
		];
		const active = feeds.filter(f => this._on(f.id));
		const warnings: string[] = [];
		this._warningsByToken.set(token, warnings);
		const settled = await Promise.allSettled(active.map(f => querySource(f.run, token)));
		const parts: Part[] = [];
		let failed = 0;
		settled.forEach((r, i) => {
			if (r.status === 'fulfilled') { parts.push(...r.value); return; }
			failed++;
			warnings.push(`${active[i].label} did not answer (${r.reason instanceof Error ? r.reason.message : String(r.reason)})`);
		});
		this._warnings = warnings;
		if (active.length > 0 && failed === active.length) throw new Error(warnings.join('; '));
		return this._group(parts);
	}

	async search(query: string, token: CancellationToken, category?: string): Promise<MarketplaceItem[]> {
		const configured = this._configuredToItems();
		const configuredNames = new Set(configured.map(c => c.id));
		const found = await this._gather(query, token, category).catch(e => { if (configured.length === 0) throw e; return [] as Found[]; });
		if (token.isCancellationRequested) return [];
		return [
			...configured.filter(c => `${c.name}`.toLowerCase().includes(query.toLowerCase())),
			...found.map(f => this._toItem(f)).filter(i => !configuredNames.has(String(i.metadata.serverKey)) && (!category || (i.metadata.categories as string[]).includes(category))),
		];
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		return this._configuredToItems();
	}

	/** what people ask for most, from every source that is on; what is already set up comes first */
	async browse(token: CancellationToken, category?: string): Promise<MarketplaceItem[]> {
		const configured = this._configuredToItems();
		const configuredNames = new Set(configured.map(c => c.id));
		const found = await this._gather('', token, category).catch(e => { if (configured.length === 0) throw e; return [] as Found[]; });
		if (token.isCancellationRequested) return configured;
		return [...(category ? [] : configured), ...found.map(f => this._toItem(f)).filter(i => !configuredNames.has(String(i.metadata.serverKey)) && (!category || (i.metadata.categories as string[]).includes(category)))];
	}

	/** a live look at one server: its repository's current signals and, for an npm package, whether it runs a script on install or is deprecated */
	async refine(item: MarketplaceItem): Promise<MarketplaceItem> {
		if (item.installed) return item;
		const repo = typeof item.metadata.repo === 'string' ? item.metadata.repo : undefined;
		const npmName = (item.metadata.npm as { name: string } | undefined)?.name ?? (item.metadata.packages as McpRegistryPackage[] | undefined)?.find(p => p.registryType === 'npm')?.identifier;
		const [repoNow, npmInfo] = await Promise.all([repo ? this._discoveryService.getRepoSignals(repo) : undefined, npmName ? this._discoveryService.getNpmInfo(npmName) : undefined]);
		const prev = (item.metadata.signals ?? {}) as Partial<TrustInputs>;
		const extra: Partial<TrustInputs> = {
			...prev,
			...(repoNow ? { stars: repoNow.stars, forks: repoNow.forks, pushedAt: repoNow.pushedAt, createdAt: repoNow.createdAt, archived: repoNow.archived, license: repoNow.license ?? null, ownerType: repoNow.ownerType } : {}),
			...(npmInfo ? { installScripts: npmInfo.installScripts || undefined, deprecated: npmInfo.deprecated || undefined, ...(npmInfo.license && !repoNow ? { license: npmInfo.license } : {}) } : {}),
		};
		// the score is computed again from what the item's own fields say plus what was just read
		const base = this._inputsFromItem(item);
		return { ...item, trustScore: computeTrust({ ...base, ...extra }), metadata: { ...item.metadata, signals: extra, refined: true, facts: mergeFacts(item.metadata.facts as ItemFact[] | undefined, extra) } };
	}

	/** what the score was computed from when the item was listed (kept in the item so a live look can add to it without losing what the first sources said) */
	private _inputsFromItem(item: MarketplaceItem): TrustInputs {
		return (item.metadata.inputs as TrustInputs | undefined) ?? { kind: 'mcp', name: item.name, publisher: item.publisher };
	}

	async setEnabled(item: MarketplaceItem, enabled: boolean): Promise<void> {
		await this._mcpService.toggleServerIsOn(String(item.metadata.serverName ?? item.id), enabled);
	}

	private _runtimeCommand(pkg: McpRegistryPackage): string {
		if (pkg.runtimeHint) return pkg.runtimeHint;
		// real, well-established per-registry conventions (npm -> npx, pypi -> uvx) - used only
		// when the registry entry itself doesn't already say which runtime to use.
		if (pkg.registryType === 'npm') return 'npx';
		if (pkg.registryType === 'pypi') return 'uvx';
		if (pkg.registryType === 'oci') return 'docker';
		return pkg.registryType;
	}

	async configure(item: MarketplaceItem): Promise<void> {
		const key = String(item.metadata.serverKey ?? item.name);
		const remoteUrl = item.metadata.remoteUrl as string | undefined;
		if (remoteUrl) {
			// remote server - a directly usable endpoint, no local process/secrets to configure
			await this._mcpService.addOrUpdateServer(key, { url: new URL(remoteUrl) });
			return;
		}

		const packages = item.metadata.packages as McpRegistryPackage[] | undefined;
		const pkg = packages?.[0];
		if (!item.installed && pkg) {
			const requiredVars = (pkg.environmentVariables ?? []).filter(v => v.isRequired);
			const env: Record<string, string> = {};
			for (const v of requiredVars) {
				const value = await this._quickInputService.input({
					title: `Configure "${item.name}"`,
					prompt: v.description ? `${v.name}: ${v.description}` : v.name,
					password: !!v.isSecret,
					placeHolder: v.default,
				});
				if (value === undefined) {
					// user cancelled - fall back to manual editing rather than installing a
					// half-configured server or fabricating a value for a required secret
					await this._mcpService.revealMCPConfigFile();
					return;
				}
				env[v.name] = value || v.default || '';
			}
			for (const v of pkg.environmentVariables ?? []) {
				if (!v.isRequired && v.default !== undefined) env[v.name] = v.default;
			}

			const command = this._runtimeCommand(pkg);
			const args = command === 'npx' ? ['-y', pkg.identifier]
				: command === 'uvx' ? [pkg.identifier]
					: command === 'docker' ? ['run', '-i', '--rm', pkg.identifier]
						: [pkg.identifier];
			const entry: MCPConfigFileEntryJSON = { command, args, ...(Object.keys(env).length ? { env } : {}) };
			await this._mcpService.addOrUpdateServer(key, entry);
			return;
		}

		const smithery = item.metadata.smithery as { qualifiedName: string; remote: boolean } | undefined;
		if (!item.installed && smithery?.remote) {
			// Smithery hosts the server; it asks for the person's own Smithery key as a bearer token
			const apiKey = await this._quickInputService.input({ title: `Configure "${item.name}"`, prompt: 'Your Smithery API key (smithery.ai/account/api-keys). It is saved in your MCP config file on this computer.', password: true });
			if (apiKey === undefined || !apiKey.trim()) { return; }
			await this._mcpService.addOrUpdateServer(key, { url: new URL(`${SMITHERY_HOSTED}/${smithery.qualifiedName}/mcp`), headers: { Authorization: `Bearer ${apiKey.trim()}` } });
			return;
		}

		const docker = item.metadata.docker as { name: string } | undefined;
		if (!item.installed && docker) {
			await this._mcpService.addOrUpdateServer(key, { command: 'docker', args: ['run', '-i', '--rm', `mcp/${docker.name}`] });
			return;
		}

		const npm = item.metadata.npm as { name: string } | undefined;
		if (!item.installed && npm) {
			await this._mcpService.addOrUpdateServer(key, { command: 'npx', args: ['-y', npm.name] });
			return;
		}

		// nothing runnable is described (a repository only): open its page so the person reads how to run it, instead of inventing a command
		const page = item.security?.repositoryUrl;
		if (!item.installed && page) { await this._openerService.open(URI.parse(page)); return; }
		await this._mcpService.revealMCPConfigFile();
	}
}

class MCPMarketplaceProviderContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.mcpMarketplaceProvider';

	constructor(
		@IMCPService mcpService: IMCPService,
		@IDiscoveryMainService discoveryService: IDiscoveryMainService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IOpenerService openerService: IOpenerService,
		@IVaderSettingsService settingsService: IVaderSettingsService,
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new MCPMarketplaceProvider(mcpService, discoveryService, quickInputService, openerService, settingsService));
	}
}

registerWorkbenchContribution2(MCPMarketplaceProviderContribution.ID, MCPMarketplaceProviderContribution, WorkbenchPhase.BlockRestore);
