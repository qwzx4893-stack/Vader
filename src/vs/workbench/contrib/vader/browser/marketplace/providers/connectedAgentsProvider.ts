/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IExternalAgentMainService, ExternalAgentStatus } from '../../../common/externalAgents/externalAgentTypes.js';
import { distributionOf, ExternalAgentDef, externalAgentCatalog } from '../../../common/externalAgents/externalAgentCatalog.js';
import { IMarketplaceProvider, ItemFact, IUnifiedMarketplaceService, MarketplaceItem } from '../../../common/marketplace/marketplaceTypes.js';
import { VADER_OPEN_SETTINGS_ACTION_ID } from '../../actionIDs.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// The coding agents a person can bring with the account they already have (Codex, Cursor, GitHub Copilot, OpenCode, Mistral Vibe, Grok Build, Kimi,
// Antigravity, and Claude Code and Freebuff in a terminal): the catalog in common/externalAgents/externalAgentCatalog.ts, with what is installed
// asked of the main-process service. Installing an agent downloads the vendor's own program; signing in is the vendor's own flow, started from
// Settings > Connected agents. The agent's usage and cost are counted by the vendor on the person's plan, not by Vader.

export class ConnectedAgentsProvider implements IMarketplaceProvider {
	readonly id = 'connected-agents';
	readonly displayName = 'Connected agents';
	readonly itemType = 'ACP_AGENT' as const;
	readonly cacheTtlMs = 15_000;

	constructor(
		private readonly _agents: IExternalAgentMainService,
		private readonly _commands: ICommandService,
	) { }

	private _howItRuns(def: ExternalAgentDef, status: ExternalAgentStatus | undefined): string {
		if (def.kind === 'terminal') return 'Runs unchanged in a terminal, exactly as the vendor ships it. It is not wired into Vader’s chat.';
		if (status?.source === 'local') return `Uses the program already on this computer (${status.detail ?? def.name}${status.installedVersion ? `, version ${status.installedVersion}` : ''}).`;
		const dist = distributionOf(def)?.distribution;
		if (dist?.npx) return `An npm package, started with npx (needs Node.js): ${dist.npx.package}.`;
		const archive = dist?.binary ? Object.values(dist.binary)[0]?.archive : undefined;
		if (archive) { try { return `A program Vader downloads from ${new URL(archive).hostname}, the vendor’s own release location.`; } catch { /* fall through */ } }
		return 'Started by Vader through the Agent Client Protocol.';
	}

	private _toItem(def: ExternalAgentDef, status: ExternalAgentStatus | undefined): MarketplaceItem {
		const ready = status?.state === 'ready';
		const dist = distributionOf(def);
		const facts: ItemFact[] = [
			{ label: 'Vendor', value: def.name },
			{ label: 'Works', value: def.kind === 'acp' ? 'Inside Vader’s chat (Agent Client Protocol)' : 'In a terminal, unchanged' },
			{ label: 'How it runs', value: this._howItRuns(def, status) },
			...(dist ? [{ label: 'Version', value: dist.version }] : []),
			{ label: 'Status', value: ready ? `Ready${status?.installedVersion ? `, version ${status.installedVersion}` : ''}` : status?.state === 'needs-node' ? 'Needs Node.js first' : status?.state === 'unsupported' ? 'No build for this computer' : 'Not installed' },
			{ label: 'Cost', value: 'Counted by the vendor on your plan, not by Vader' },
			{ label: 'Website', value: def.website.replace('https://', ''), href: def.website },
		];
		const needsSetup = def.kind === 'terminal';
		return {
			id: def.id,
			providerId: this.id,
			type: 'ACP_AGENT',
			name: def.name,
			description: def.tagline,
			source: 'Agent Client Protocol registry',
			publisher: def.name,
			version: dist?.version,
			trust: 'unknown',
			installed: ready,
			installMethod: ready ? null : status?.state === 'needs-node' || status?.state === 'unsupported' ? null : needsSetup ? 'configure' : 'install',
			isLocal: status?.source === 'local',
			security: { source: def.website, executesCode: true, networkAccess: true },
			metadata: {
				agentId: def.id, logo: def.logo, website: def.website, note: def.note, loginNote: def.acp?.loginNote, kind: def.kind, facts,
				state: status?.state, openOnly: needsSetup && !ready, actionLabel: needsSetup && !ready ? 'Set up' : undefined, categories: [],
				steps: def.kind === 'acp'
					? ['Install it here: Vader downloads the vendor’s own program.', `Sign in: ${def.acp?.loginNote ?? 'the vendor’s own sign-in opens.'} Vader never sees your password or token.`, 'Open Settings, Connected agents, and choose it for the chat.']
					: ['Install it from Settings, Connected agents: the exact command is shown first and runs in a terminal.', 'Sign in inside the program itself; Vader never handles that.', 'Open it in a terminal from the same page.'],
			},
		};
	}

	private async _items(): Promise<MarketplaceItem[]> {
		let statuses: ExternalAgentStatus[] = [];
		try { statuses = await this._agents.getStatuses([]); } catch { /* the list is still shown, without states */ }
		return externalAgentCatalog.map(def => this._toItem(def, statuses.find(s => s.id === def.id)));
	}

	async search(query: string, _token: CancellationToken): Promise<MarketplaceItem[]> {
		const q = query.toLowerCase();
		return (await this._items()).filter(i => !q || `${i.name} ${i.description}`.toLowerCase().includes(q));
	}

	async browse(_token: CancellationToken): Promise<MarketplaceItem[]> {
		return this._items();
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		return (await this._items()).filter(i => i.installed);
	}

	async install(item: MarketplaceItem): Promise<void> {
		const status = await this._agents.install(String(item.metadata.agentId ?? item.id));
		if (status.state !== 'ready') throw new Error(status.detail ? `${item.name} was not installed: ${status.detail}` : `${item.name} was not installed (${status.state}).`);
	}

	async uninstall(item: MarketplaceItem): Promise<void> {
		await this._agents.uninstall(String(item.metadata.agentId ?? item.id));
	}

	/** the agents that run in a terminal are set up on the Connected agents page, where the command is shown first */
	async configure(_item: MarketplaceItem): Promise<void> {
		await this._commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID);
	}
}

class ConnectedAgentsProviderContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.connectedAgentsProvider';

	constructor(
		@IExternalAgentMainService agents: IExternalAgentMainService,
		@ICommandService commands: ICommandService,
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new ConnectedAgentsProvider(agents, commands));
	}
}

registerWorkbenchContribution2(ConnectedAgentsProviderContribution.ID, ConnectedAgentsProviderContribution, WorkbenchPhase.BlockRestore);
