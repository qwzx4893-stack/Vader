/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IDiscoveryMainService } from './discoveryServiceTypes.js';

export * from './discoveryServiceTypes.js';

// Thin IPC proxy to electron-main/discoveryMainService.ts, following the same pattern as
// vaderUpdateService.ts: all real network calls happen in the main process.
class DiscoveryService implements IDiscoveryMainService {
	readonly _serviceBrand: undefined;
	private readonly _mainService: IDiscoveryMainService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this._mainService = ProxyChannel.toService<IDiscoveryMainService>(mainProcessService.getChannel('vader-channel-discovery'));
	}

	searchMcpRegistry: IDiscoveryMainService['searchMcpRegistry'] = (query) => this._mainService.searchMcpRegistry(query);
	searchSkillNet: IDiscoveryMainService['searchSkillNet'] = (query) => this._mainService.searchSkillNet(query);
	fetchSkillInstructions: IDiscoveryMainService['fetchSkillInstructions'] = (url) => this._mainService.fetchSkillInstructions(url);
}

registerSingleton(IDiscoveryMainService, DiscoveryService, InstantiationType.Delayed);
