/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { VaderCheckUpdateRespose } from './vaderUpdateServiceTypes.js';



export interface IVaderUpdateService {
	readonly _serviceBrand: undefined;
	check: (explicit: boolean) => Promise<VaderCheckUpdateRespose>;
}


export const IVaderUpdateService = createDecorator<IVaderUpdateService>('VaderUpdateService');


// implemented by calling channel
export class VaderUpdateService implements IVaderUpdateService {

	readonly _serviceBrand: undefined;
	private readonly vaderUpdateService: IVaderUpdateService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService, // (only usable on client side)
	) {
		// creates an IPC proxy to use metricsMainService.ts
		this.vaderUpdateService = ProxyChannel.toService<IVaderUpdateService>(mainProcessService.getChannel('vader-channel-update'));
	}


	// anything transmitted over a channel must be async even if it looks like it doesn't have to be
	check: IVaderUpdateService['check'] = async (explicit) => {
		const res = await this.vaderUpdateService.check(explicit)
		return res
	}
}

registerSingleton(IVaderUpdateService, VaderUpdateService, InstantiationType.Eager);


