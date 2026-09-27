/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IBrowserToolMainService } from './browserToolServiceTypes.js';

export * from './browserToolServiceTypes.js';

class BrowserToolService implements IBrowserToolMainService {
	readonly _serviceBrand: undefined;
	private readonly _mainService: IBrowserToolMainService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this._mainService = ProxyChannel.toService<IBrowserToolMainService>(mainProcessService.getChannel('void-channel-browser'));
	}

	navigate: IBrowserToolMainService['navigate'] = (url) => this._mainService.navigate(url);
	snapshot: IBrowserToolMainService['snapshot'] = () => this._mainService.snapshot();
	click: IBrowserToolMainService['click'] = (ref) => this._mainService.click(ref);
	type: IBrowserToolMainService['type'] = (ref, text, submit) => this._mainService.type(ref, text, submit);
	screenshot: IBrowserToolMainService['screenshot'] = () => this._mainService.screenshot();
	consoleLogs: IBrowserToolMainService['consoleLogs'] = () => this._mainService.consoleLogs();
	close: IBrowserToolMainService['close'] = () => this._mainService.close();
}

registerSingleton(IBrowserToolMainService, BrowserToolService, InstantiationType.Delayed);
