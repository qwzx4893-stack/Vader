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
import { IDiscoveryMainService, McpRegistryPackage, McpRegistrySearchResult, NpmMcpResult, RepoSignals, SmitheryResult } from '../../../common/discovery/discoveryServiceTypes.js';
import { githubRepoUrlOf, ownerOfGithubUrl } from '../../../common/discovery/feedParsers.js';
import { IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceItem } from '../../../common/marketplace/marketplaceTypes.js';
import { computeTrust, KNOWN_PUBLISHERS, TrustInputs } from '../../../common/marketplace/trustScore.js';
import { isSourceOn } from '../../../common/marketplace/addonSources.js';
import { IVaderSettingsService } from '../../../common/vaderSettingsService.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// MCP servers are found in four live sources at once and merged into one row each:
//   - the official MCP Registry (registry.modelcontextprotocol.io)
//   - Smithery (registry.smithery.ai): use counts and verified publishers
//   - npm: packages that call themselves MCP servers, with weekly downloads and whether they were published from a CI workflow
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

const FEATURED_MCP_QUERIES = ['github', 'playwright', 'filesystem', 'fetch', 'sentry', 'stripe', 'postgres', 'linear', 'notion', 'slack'];
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

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** what the sources said about one server, kept together */
type Found = {
	registry?: McpRegistrySearchResult;
	smithery?: SmitheryResult;
	npm?: NpmMcpResult;
	repo?: RepoSignals;
	sourceIds: Set<string>;
	labels: string[];
};

class MCPMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'mcp-registry';
	readonly displayName = 'MCP Servers';
	readonly itemType = 'MCP_SERVER' as const;
	readonly cacheTtlMs = 60_000;

	private _warnings: string[] = [];

	constructor(
		private readonly _mcpService: IMCPService,
		private readonly _discoveryService: IDiscoveryMainService,
		private readonly _quickInputService: IQuickInputService,
		private readonly _openerService: IOpenerService,
		private readonly _settings: IVaderSettingsService,
	) { }

	takeWarnings(): string[] { const w = this._warnings; this._warnings = []; return w; }

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
		const r = f.registry, s = f.smithery, n = f.npm, g = f.repo;
		const repoUrl = githubRepoUrlOf(r?.repositoryUrl) ?? s?.repositoryUrl ?? n?.repositoryUrl ?? g?.url;
		const publisher = (r && mcpPublisherOf(r)) ?? ownerOfGithubUrl(repoUrl) ?? n?.publisher;
		const hasRemote = !!r?.remoteUrl || !!s?.remote;
		const hasLocal = (r?.packages?.length ?? 0) > 0 || !!n;
		const secrets = (r?.packages ?? []).flatMap(p => p.environmentVariables ?? []).filter(v => v.isRequired && v.isSecret).length;
		return {
			kind: 'mcp', name: r?.name ?? s?.qualifiedName ?? n?.name ?? g?.repo, publisher,
			runsLocalCode: hasRemote && !hasLocal ? false : hasLocal ? true : undefined,
			publisherVerified: s?.verified || undefined,
			sourceInstalls: s?.useCount, weeklyDownloads: n?.weeklyDownloads, trustedPublisher: n?.trustedPublisher || undefined,
			deprecated: r?.deprecated, license: n?.license ?? (g ? g.license ?? null : undefined),
			stars: g?.stars, forks: g?.forks, pushedAt: g?.pushedAt ?? n?.updatedAt ?? r?.updatedAt, createdAt: g?.createdAt, archived: g?.archived, ownerType: g?.ownerType,
			listedBy: f.sourceIds.size, secretsRequested: secrets || undefined,
		};
	}

	private _toItem(f: Found, extra?: Partial<TrustInputs>): MarketplaceItem {
		const r = f.registry, s = f.smithery, n = f.npm, g = f.repo;
		const inputs = { ...this._inputsOf(f), ...extra };
		const repositoryUrl = githubRepoUrlOf(r?.repositoryUrl) ?? s?.repositoryUrl ?? n?.repositoryUrl ?? g?.url;
		const name = s?.displayName ?? (r ? r.name.split('/').pop()! : undefined) ?? n?.name ?? g?.repo.split('/')[1] ?? 'unknown';
		const serverKey = r?.name ?? (s ? `smithery-${slug(s.qualifiedName)}` : n ? slug(n.name) : slug(name));
		const runnable = !!r?.remoteUrl || (r?.packages?.length ?? 0) > 0 || !!s?.remote || !!n;
		return {
			id: r?.name ?? (s ? `smithery:${s.qualifiedName}` : n ? `npm:${n.name}` : `github:${g?.repo}`),
			providerId: this.id,
			type: 'MCP_SERVER',
			name,
			description: r?.description || s?.description || n?.description || g?.description || '',
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
				smithery: s ? { qualifiedName: s.qualifiedName, remote: s.remote } : undefined, npm: n ? { name: n.name } : undefined,
				repo: g?.repo ?? (repositoryUrl ? repositoryUrl.slice('https://github.com/'.length) : undefined),
				signals: extra, inputs, listedBy: f.sourceIds.size, sourcesListing: f.labels, openOnly: !runnable,
			},
		};
	}

	/** puts what different sources said about the same server together: the same GitHub repository, the same npm package, or the same registry name */
	private _group(parts: readonly { sourceId: string; label: string; registry?: McpRegistrySearchResult; smithery?: SmitheryResult; npm?: NpmMcpResult; repo?: RepoSignals }[]): Found[] {
		const found: Found[] = [];
		const index = new Map<string, Found>();
		const keysOf = (p: (typeof parts)[number]): string[] => {
			const keys: string[] = [];
			const repo = githubRepoUrlOf(p.registry?.repositoryUrl) ?? p.smithery?.repositoryUrl ?? p.npm?.repositoryUrl ?? p.repo?.url;
			if (repo) keys.push(`repo:${repo.toLowerCase()}`);
			if (p.npm) keys.push(`npm:${p.npm.name}`);
			for (const pkg of p.registry?.packages ?? []) if (pkg.registryType === 'npm') keys.push(`npm:${pkg.identifier}`);
			if (p.registry) keys.push(`reg:${p.registry.name}`);
			if (p.smithery) keys.push(`sm:${p.smithery.qualifiedName}`);
			return keys;
		};
		for (const p of parts) {
			const keys = keysOf(p);
			let f = keys.map(k => index.get(k)).find(Boolean);
			if (!f) { f = { sourceIds: new Set(), labels: [] }; found.push(f); }
			f.registry ??= p.registry; f.smithery ??= p.smithery; f.npm ??= p.npm; f.repo ??= p.repo;
			f.sourceIds.add(p.sourceId);
			if (!f.labels.includes(p.label)) f.labels.push(p.label);
			for (const k of keys) index.set(k, f);
		}
		return found;
	}

	private async _gather(query: string, browse: boolean): Promise<Found[]> {
		type Part = Parameters<MCPMarketplaceProvider['_group']>[0][number];
		const feeds: { id: string; label: string; run: () => Promise<Part[]> }[] = [
			{
				id: 'mcp-registry', label: 'Official MCP Registry', run: async () => {
					const lists = browse ? await Promise.all(FEATURED_MCP_QUERIES.map(q => this._discoveryService.queryMcpRegistry(q))) : [await this._discoveryService.queryMcpRegistry(query)];
					// the registry lets anyone publish a server named "github" or "stripe": when browsing, only a known organisation's entry is featured, one per query
					const picked = browse ? lists.map(l => l.find(r => KNOWN_PUBLISHERS.has((mcpPublisherOf(r) ?? '').toLowerCase()))).filter((r): r is McpRegistrySearchResult => !!r) : lists.flat();
					return picked.map(r => ({ sourceId: 'mcp-registry', label: 'MCP Registry', registry: r }));
				},
			},
			{ id: 'smithery', label: 'Smithery', run: async () => (await this._discoveryService.searchSmithery(query)).map(s => ({ sourceId: 'smithery', label: 'Smithery', smithery: s })) },
			{ id: 'npm-mcp', label: 'npm', run: async () => (await this._discoveryService.searchNpmMcp(query)).filter(n => !browse || n.weeklyDownloads >= 500).map(n => ({ sourceId: 'npm-mcp', label: 'npm', npm: n })) },
			{ id: 'github-topic-mcp', label: 'GitHub topic mcp-server', run: async () => (await this._discoveryService.searchGithubTopic('mcp-server', query)).map(g => ({ sourceId: 'github-topic-mcp', label: 'GitHub', repo: g })) },
		];
		const active = feeds.filter(f => this._on(f.id));
		const settled = await Promise.allSettled(active.map(f => f.run()));
		const parts: Part[] = [];
		let failed = 0;
		settled.forEach((r, i) => {
			if (r.status === 'fulfilled') { parts.push(...r.value); return; }
			failed++;
			this._warnings.push(`${active[i].label} did not answer (${r.reason instanceof Error ? r.reason.message : String(r.reason)})`);
		});
		if (active.length > 0 && failed === active.length) throw new Error(this.takeWarnings().join('; '));
		return this._group(parts);
	}

	async search(query: string, token: CancellationToken): Promise<MarketplaceItem[]> {
		const configured = this._configuredToItems();
		const configuredNames = new Set(configured.map(c => c.id));
		const found = await this._gather(query, false).catch(() => [] as Found[]);
		if (token.isCancellationRequested) return [];
		return [
			...configured.filter(c => `${c.name}`.toLowerCase().includes(query.toLowerCase())),
			...found.map(f => this._toItem(f)).filter(i => !configuredNames.has(String(i.metadata.serverKey))),
		];
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		return this._configuredToItems();
	}

	/** what people ask for most, from every source that is on; what is already set up comes first */
	async browse(token: CancellationToken): Promise<MarketplaceItem[]> {
		const configured = this._configuredToItems();
		const configuredNames = new Set(configured.map(c => c.id));
		const found = await this._gather('', true).catch(e => { if (configured.length === 0) throw e; return [] as Found[]; });
		if (token.isCancellationRequested) return configured;
		return [...configured, ...found.map(f => this._toItem(f)).filter(i => !configuredNames.has(String(i.metadata.serverKey)))];
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
		return { ...item, trustScore: computeTrust({ ...base, ...extra }), metadata: { ...item.metadata, signals: extra, refined: true } };
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
