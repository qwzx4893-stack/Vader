/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import { FileAccess } from '../../../../base/common/network.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { CodebaseIndexer } from './codebaseIndexer.js';
import { createLocalEmbedder, embeddingDirOf } from './localEmbedder.js';
import { createStaticEmbedder } from './staticEmbedder.js';
import { ICodebaseIndexMainService, IndexState, SearchOutcome } from '../common/codebaseIndex/codebaseIndexTypes.js';

// One index per open project, in the app's data folder. The index of a project is made when the project is opened (or the first time the agent searches it), kept current while it
// is open, and saved to disk so that the next start is a look at what changed and not a read of everything.

// whether the computer is on battery power, read from Electron by name so that this file does not depend on its types; until it is loaded the answer is "no"
let onBattery: () => boolean = () => false;
void (async () => { try { const name = 'electron'; const e = await import(name) as { powerMonitor?: { isOnBatteryPower(): boolean } }; if (e.powerMonitor) onBattery = () => { try { return e.powerMonitor!.isOnBatteryPower() } catch { return false } } } catch { /* not running in Electron */ } })();

const MAX_OPEN_INDEXES = 6; // projects held in memory at once; the least recently used is closed

export class CodebaseIndexMainService extends Disposable implements ICodebaseIndexMainService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<{ root: string; state: IndexState }>());
	readonly onDidChangeState: Event<{ root: string; state: IndexState }> = this._onDidChangeState.event;
	private readonly _indexers = new Map<string, CodebaseIndexer>();

	constructor(@IEnvironmentMainService private readonly _environment: IEnvironmentMainService) { super(); }

	private _key(root: string): string { return path.resolve(root); }

	private _indexerFor(root: string): CodebaseIndexer {
		const key = this._key(root);
		let ix = this._indexers.get(key);
		if (ix) { this._indexers.delete(key); this._indexers.set(key, ix); return ix; } // most recently used last
		ix = new CodebaseIndexer(key, path.join(this._environment.userDataPath, 'vader-index'),
			// search by meaning: the small model that ships with the app, in a worker thread; none if it is not there (localEmbedder.ts), and not run while on battery power
			() => createLocalEmbedder({ embeddingDir: embeddingDirOf((process as unknown as { resourcesPath?: string }).resourcesPath ?? ''), workerPath: FileAccess.asFileUri('vs/workbench/contrib/vader/electron-main/embedWorker.js').fsPath, cores: os.cpus().length }),
			{ hold: () => onBattery(), quickFactory: () => createStaticEmbedder(embeddingDirOf((process as unknown as { resourcesPath?: string }).resourcesPath ?? '')) });
		ix.onDidChange = state => this._onDidChangeState.fire({ root: key, state });
		this._indexers.set(key, ix);
		while (this._indexers.size > MAX_OPEN_INDEXES) {
			const [oldKey, old] = this._indexers.entries().next().value as [string, CodebaseIndexer];
			this._indexers.delete(oldKey);
			void old.dispose();
		}
		return ix;
	}

	async open(root: string): Promise<IndexState> {
		const ix = this._indexerFor(root);
		ix.watch();
		void ix.sync(); // not awaited: the first build of a big project takes seconds, and the window does not wait for it
		return ix.state;
	}

	async getState(root: string): Promise<IndexState | undefined> { return this._indexers.get(this._key(root))?.state; }

	async search(root: string, query: string, opts?: { directories?: string[]; limit?: number }): Promise<SearchOutcome> {
		const ix = this._indexerFor(root);
		ix.watch();
		return ix.search(query, opts);
	}

	async rebuild(root: string): Promise<IndexState> {
		const ix = this._indexerFor(root);
		void ix.rebuild();
		return ix.state;
	}

	async close(root: string): Promise<void> {
		const key = this._key(root);
		const ix = this._indexers.get(key);
		if (!ix) return;
		this._indexers.delete(key);
		await ix.dispose();
	}

	override dispose(): void {
		for (const ix of this._indexers.values()) void ix.dispose();
		this._indexers.clear();
		super.dispose();
	}
}
