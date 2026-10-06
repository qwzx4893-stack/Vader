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
		this._mainService = ProxyChannel.toService<IBrowserToolMainService>(mainProcessService.getChannel('vader-channel-browser'));
	}

	newPage: IBrowserToolMainService['newPage'] = () => this._mainService.newPage();
	listPages: IBrowserToolMainService['listPages'] = () => this._mainService.listPages();
	switchToPage: IBrowserToolMainService['switchToPage'] = (pageId) => this._mainService.switchToPage(pageId);
	closePage: IBrowserToolMainService['closePage'] = (pageId) => this._mainService.closePage(pageId);

	navigate: IBrowserToolMainService['navigate'] = (url, pageId) => this._mainService.navigate(url, pageId);
	reload: IBrowserToolMainService['reload'] = (pageId) => this._mainService.reload(pageId);
	snapshot: IBrowserToolMainService['snapshot'] = (pageId) => this._mainService.snapshot(pageId);
	click: IBrowserToolMainService['click'] = (ref, pageId) => this._mainService.click(ref, pageId);
	type: IBrowserToolMainService['type'] = (ref, text, submit, pageId) => this._mainService.type(ref, text, submit, pageId);
	screenshot: IBrowserToolMainService['screenshot'] = (pageId) => this._mainService.screenshot(pageId);
	consoleLogs: IBrowserToolMainService['consoleLogs'] = (pageId) => this._mainService.consoleLogs(pageId);
	pageErrors: IBrowserToolMainService['pageErrors'] = (pageId) => this._mainService.pageErrors(pageId);
	networkLog: IBrowserToolMainService['networkLog'] = (pageId) => this._mainService.networkLog(pageId);
	closeAll: IBrowserToolMainService['closeAll'] = () => this._mainService.closeAll();
}

registerSingleton(IBrowserToolMainService, BrowserToolService, InstantiationType.Delayed);
