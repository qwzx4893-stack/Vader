/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IVisionMainService, VisionQueryParams } from '../common/vision/visionQueryTypes.js';
import { sendVisionQuery } from './llmMessage/sendLLMMessage.impl.js';

// Real implementation - the only place an image and its provider's API key are used together
// for a vision query (see AGENTS.md's network-call convention). Registered as a channel in
// app.ts the same way discoveryMainService.ts is, and consumed from the renderer via the thin
// proxy in common/vision/visionQueryService.ts.
export class VisionMainService extends Disposable implements IVisionMainService {
	_serviceBrand: undefined;

	async query(params: VisionQueryParams): Promise<string> {
		return sendVisionQuery(params)
	}
}
