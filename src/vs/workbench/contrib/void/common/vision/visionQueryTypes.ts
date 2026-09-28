/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { OverridesOfModel, ProviderName, SettingsOfProvider } from '../voidSettingsTypes.js';

// Vader addition, part of the real vision/multimodal pipeline (docs/integrations/model-router.md,
// "Vision" section). A deliberately narrow, additive, one-off image-query capability - NOT a
// change to the main chat streaming loop or the persisted ChatMessage/LLMChatMessage format
// (see AGENTS.md's "WARNING: changing this format is a big deal" note on ChatMessage, which is
// exactly why this is its own isolated request/response call instead of new content-part types
// threaded through the whole provider-agnostic chat pipeline). Modeled on
// discovery/discoveryServiceTypes.ts's IDiscoveryMainService: a plain interface implemented for
// real in electron-main/visionMainService.ts (the only place the image + API key ever leave the
// app, per AGENTS.md's "anything that reaches the network goes through an
// electron-main/*MainService.ts" rule) and re-exposed to the renderer via a thin ProxyChannel
// wrapper (visionQueryService.ts), the same two-file split discovery/skills already use.
export type VisionQueryParams = {
	readonly providerName: ProviderName;
	readonly modelName: string;
	readonly settingsOfProvider: SettingsOfProvider;
	readonly overridesOfModel: OverridesOfModel | undefined;
	/** raw base64 image bytes, no "data:image/png;base64," prefix */
	readonly imageBase64: string;
	readonly mimeType: 'image/png' | 'image/jpeg';
	/** what to look for / answer about the image - the caller's question, not a fixed prompt */
	readonly prompt: string;
};

export interface IVisionMainService {
	readonly _serviceBrand: undefined;
	/**
	 * Sends a single image + text prompt to the given vision-capable model and returns its text
	 * response. Throws (never silently falls back to a different, unrequested provider) if
	 * `modelName` isn't recognized as vision-capable by modelCapabilities.ts's
	 * `modelSupportsVision` - this is the last, real gate before an image is ever sent over the
	 * network, re-checked here independently of whatever already filtered the caller's model
	 * choice, since this service is the actual network boundary.
	 */
	query(params: VisionQueryParams): Promise<string>;
}

export const IVisionMainService = createDecorator<IVisionMainService>('vaderVisionMainService');
