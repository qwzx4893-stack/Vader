/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IVisionMainService, VisionQueryParams } from './visionQueryTypes.js';

export * from './visionQueryTypes.js';

// Thin IPC proxy to electron-main/visionMainService.ts, the same pattern
// discovery/discoveryService.ts uses: all real network calls (and the API key they need) stay
// in the main process.
class VisionQueryService implements IVisionMainService {
	readonly _serviceBrand: undefined;
	private readonly _mainService: IVisionMainService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this._mainService = ProxyChannel.toService<IVisionMainService>(mainProcessService.getChannel('void-channel-vision'));
	}

	query(params: VisionQueryParams): Promise<string> {
		return this._mainService.query(params);
	}
}

registerSingleton(IVisionMainService, VisionQueryService, InstantiationType.Delayed);
