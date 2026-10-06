/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IPathService } from '../../../../../services/path/common/pathService.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../common/contributions.js';
import { IMarketplaceProvider, IUnifiedMarketplaceService, MarketplaceItem } from '../../../common/marketplace/marketplaceTypes.js';

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
//
// Prettier ecosystem: distinguishes core Prettier from its plugins by reading the workspace's
// own package.json (real, local, no network, no fake registry) - "core" is the `prettier`
// dependency itself; "plugins" are matched against the real, documented naming convention
// (`prettier-plugin-*`/`@prettier/plugin-*`) rather than an invented plugin list. This
// reports what's LOCALLY DECLARED, not what could theoretically be installed from npm - there
// is no npm-search integration here, consistent with "don't just download packages" and
// "integrate with Vader's actual formatting configuration" (a package.json dependency is
// exactly that configuration in a Node project).
class PrettierMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'prettier';
	readonly displayName = 'Prettier';
	readonly itemType = 'FORMATTER' as const;
	readonly cacheTtlMs = 60_000;

	constructor(
		private readonly _fileService: IFileService,
		private readonly _workspaceContextService: IWorkspaceContextService,
	) { }

	private async _readDeps(): Promise<Record<string, string>> {
		const root = this._workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!root) return {};
		try {
			const content = (await this._fileService.readFile(URI.joinPath(root, 'package.json'))).value.toString();
			const pkg = JSON.parse(content);
			return { ...pkg.dependencies, ...pkg.devDependencies };
		} catch {
			return {};
		}
	}

	private async _toItems(): Promise<MarketplaceItem[]> {
		const deps = await this._readDeps();
		const names = Object.keys(deps);
		const items: MarketplaceItem[] = [];
		if (deps['prettier']) {
			items.push({
				id: 'prettier-core', providerId: this.id, type: 'FORMATTER', name: 'Prettier',
				description: 'Core Prettier formatter, declared in this workspace\'s package.json.',
				source: 'package.json (local)', version: deps['prettier'], trust: 'trusted', installed: true, isLocal: true,
				installMethod: null, security: { source: 'npm: prettier', version: deps['prettier'], executesCode: true },
				metadata: { kind: 'core' },
			});
		}
		for (const name of names) {
			if (name === 'prettier') continue;
			if (!/^(prettier-plugin-|@prettier\/plugin-)/.test(name)) continue;
			items.push({
				id: `prettier-plugin:${name}`, providerId: this.id, type: 'FORMATTER', name,
				description: `Prettier plugin declared in this workspace's package.json.`,
				source: 'package.json (local)', version: deps[name], trust: 'unknown', installed: true, isLocal: true,
				installMethod: null, security: { source: `npm: ${name}`, version: deps[name], executesCode: true },
				metadata: { kind: 'plugin' },
			});
		}
		return items;
	}

	async search(query: string, token: CancellationToken): Promise<MarketplaceItem[]> {
		const items = await this._toItems();
		const q = query.toLowerCase();
		return items.filter(i => !q || i.name.toLowerCase().includes(q));
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		return this._toItems();
	}
}

// Jupyter: distinguishes local kernelspecs (detected by scanning the real, documented,
// OS-standard Jupyter kernelspec directories - https://jupyter-client.readthedocs.io's own
// "kernel specs" discovery paths, not an invented location) from Open-VSX Jupyter extensions
// (already covered by ExtensionGalleryMarketplaceProvider - not duplicated here) and from
// "kernel protocol/runtime integrations," which this codebase has none of (Vader has no
// notebook/Jupyter protocol client - this provider only ever reports LOCAL/AVAILABLE kernels
// it can see on disk, never claims they're usable from inside Vader itself).
class JupyterKernelMarketplaceProvider implements IMarketplaceProvider {
	readonly id = 'jupyter-kernels';
	readonly displayName = 'Jupyter Kernels (local)';
	readonly itemType = 'JUPYTER_KERNEL' as const;
	readonly cacheTtlMs = 120_000;

	constructor(
		private readonly _fileService: IFileService,
		private readonly _pathService: IPathService,
	) { }

	private async _kernelDirs(): Promise<URI[]> {
		const home = await this._pathService.userHome({ preferLocal: true });
		// real, documented per-OS jupyter kernelspec search paths (user-level only - this is a
		// local-machine capability check, not a workspace-scoped one, so system-level paths
		// like /usr/share/jupyter/kernels are intentionally not probed from the renderer).
		return [
			URI.joinPath(home, '.local', 'share', 'jupyter', 'kernels'),   // Linux
			URI.joinPath(home, 'Library', 'Jupyter', 'kernels'),           // macOS
			URI.joinPath(home, 'AppData', 'Roaming', 'jupyter', 'kernels'), // Windows
		];
	}

	private async _toItems(): Promise<MarketplaceItem[]> {
		const items: MarketplaceItem[] = [];
		for (const dir of await this._kernelDirs()) {
			let children;
			try { children = (await this._fileService.resolve(dir)).children; } catch { continue; } // directory doesn't exist on this OS/machine - not an error, just not this path
			for (const child of children ?? []) {
				if (!child.isDirectory) continue;
				try {
					const kernelJsonUri = URI.joinPath(child.resource, 'kernel.json');
					const content = (await this._fileService.readFile(kernelJsonUri)).value.toString();
					const spec = JSON.parse(content);
					items.push({
						id: child.name,
						providerId: this.id,
						type: 'JUPYTER_KERNEL',
						name: String(spec?.display_name ?? child.name),
						description: `Local Jupyter kernel (${spec?.language ?? 'unknown language'}), detected on disk.`,
						source: 'Local kernelspec',
						trust: 'trusted', // a kernel the user themselves already installed on this machine
						installed: true,
						isLocal: true,
						installMethod: 'use_local',
						security: { source: kernelJsonUri.fsPath, executesCode: true },
						metadata: { kernelspecName: child.name, argv: spec?.argv, language: spec?.language },
					});
				} catch { /* malformed or unreadable kernel.json - skip this one kernel, not the whole scan */ }
			}
		}
		return items;
	}

	async search(query: string, token: CancellationToken): Promise<MarketplaceItem[]> {
		const items = await this._toItems();
		const q = query.toLowerCase();
		return items.filter(i => !q || i.name.toLowerCase().includes(q));
	}

	async listInstalled(): Promise<MarketplaceItem[]> {
		return this._toItems();
	}
}

class LocalToolingMarketplaceProvidersContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.vader.localToolingMarketplaceProviders';

	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IPathService pathService: IPathService,
		@IUnifiedMarketplaceService marketplaceService: IUnifiedMarketplaceService,
	) {
		marketplaceService.registerProvider(new PrettierMarketplaceProvider(fileService, workspaceContextService));
		marketplaceService.registerProvider(new JupyterKernelMarketplaceProvider(fileService, pathService));
	}
}

registerWorkbenchContribution2(LocalToolingMarketplaceProvidersContribution.ID, LocalToolingMarketplaceProvidersContribution, WorkbenchPhase.BlockRestore);
