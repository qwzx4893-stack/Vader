/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { Event } from '../../../../base/common/event.js';
import { VaderCheckUpdateRespose } from './vaderUpdateServiceTypes.js';
import { UpdateState } from './updateModel.js';



export interface IVaderUpdateService {
	readonly _serviceBrand: undefined;
	check: (explicit: boolean) => Promise<VaderCheckUpdateRespose>;

	/** the newer release found, its download and what became of it (common/updateModel.ts) */
	readonly onDidChangeUpdateState: Event<UpdateState>;
	getUpdateState(): Promise<UpdateState>;
	/** downloads the installer of the release found, with progress in the state; cancelUpdateDownload stops it */
	downloadUpdate(): Promise<void>;
	cancelUpdateDownload(): Promise<void>;
	/** forgets an offer the person put off ("Later") or a failure they have read */
	dismissUpdate(): Promise<void>;
	/** starts the installer that was downloaded and closes Vader, which it opens again when it is done */
	installUpdate(): Promise<{ ok: true } | { ok: false; reason: string }>;
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
		this.onDidChangeUpdateState = this.vaderUpdateService.onDidChangeUpdateState;
	}


	readonly onDidChangeUpdateState: Event<UpdateState>;
	getUpdateState: IVaderUpdateService['getUpdateState'] = () => this.vaderUpdateService.getUpdateState();
	downloadUpdate: IVaderUpdateService['downloadUpdate'] = () => this.vaderUpdateService.downloadUpdate();
	cancelUpdateDownload: IVaderUpdateService['cancelUpdateDownload'] = () => this.vaderUpdateService.cancelUpdateDownload();
	dismissUpdate: IVaderUpdateService['dismissUpdate'] = () => this.vaderUpdateService.dismissUpdate();
	installUpdate: IVaderUpdateService['installUpdate'] = () => this.vaderUpdateService.installUpdate();

	// anything transmitted over a channel must be async even if it looks like it doesn't have to be
	check: IVaderUpdateService['check'] = async (explicit) => {
		const res = await this.vaderUpdateService.check(explicit)
		return res
	}
}

registerSingleton(IVaderUpdateService, VaderUpdateService, InstantiationType.Eager);


