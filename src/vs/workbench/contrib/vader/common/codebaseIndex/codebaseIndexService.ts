/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { ICodebaseIndexMainService, IndexState } from './codebaseIndexTypes.js';

export * from './codebaseIndexTypes.js';

// A thin proxy to electron-main/codebaseIndexMainService.ts, the same way gitWorktreeService.ts is: the files are read and the index is kept in the main process.
class CodebaseIndexService implements ICodebaseIndexMainService {
	readonly _serviceBrand: undefined;
	private readonly _main: ICodebaseIndexMainService;
	readonly onDidChangeState: Event<{ root: string; state: IndexState }>;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		this._main = ProxyChannel.toService<ICodebaseIndexMainService>(mainProcessService.getChannel('vader-channel-codebaseIndex'));
		this.onDidChangeState = this._main.onDidChangeState;
	}

	open: ICodebaseIndexMainService['open'] = (root) => this._main.open(root);
	getState: ICodebaseIndexMainService['getState'] = (root) => this._main.getState(root);
	search: ICodebaseIndexMainService['search'] = (root, query, opts) => this._main.search(root, query, opts);
	rebuild: ICodebaseIndexMainService['rebuild'] = (root) => this._main.rebuild(root);
	close: ICodebaseIndexMainService['close'] = (root) => this._main.close(root);
}

registerSingleton(ICodebaseIndexMainService, CodebaseIndexService, InstantiationType.Delayed);
