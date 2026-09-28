/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';
import { ModelSelection, ProviderName } from '../voidSettingsTypes.js';

// Router categories beyond Void's original five Settings-configurable features
// (Chat/Ctrl+K/Autocomplete/Apply/SCM, which keep their own dedicated dropdowns and storage
// unchanged - see voidSettingsTypes.ts's featureNames). These five are the ones the
// mission's Model Router section names that don't already have a place to live:
// subagent delegation, read-only research subagents, browser-automation turns, the
// compaction summarizer, and the (future) independent Verification Agent.
export type RouterCategory = 'subagent' | 'research' | 'browser' | 'summarization' | 'verification';

export type ModelRouterMode = 'auto' | 'manual';

export type ModelRouterState = {
	mode: ModelRouterMode;
	categoryOverrides: Partial<Record<RouterCategory, ModelSelection>>;
};

// A machine-readable capability descriptor built entirely from data this codebase already
// tracks per model (common/modelCapabilities.ts's VoidStaticModelInfo) and per provider
// (voidSettingsTypes.ts's SettingsOfProvider/localProviderNames) - nothing here is invented
// or guessed per-model. See modelRouterService.ts's describeModel for exactly which real
// field backs each one, and its doc comment for the one dimension (vision/multimodal input)
// this codebase doesn't track today, honestly left out rather than faked.
export type ModelCapabilityDescriptor = {
	providerName: ProviderName;
	modelName: string;
	/** the provider has real settings filled in AND this specific model is enabled (not hidden) - i.e. actually usable right now, not just theoretically supported */
	isConfigured: boolean;
	isLocal: boolean;
	supportsNativeToolCalling: boolean;
	/** false for the XML tool-calling fallback grammar, which only ever detects one tool call per turn - see docs/integrations/agent-gateway.md */
	supportsMultipleToolCallsPerTurn: boolean;
	supportsReasoning: boolean;
	supportsFIM: boolean;
	supportsPromptCaching: boolean;
	/** whether this model accepts image input - see modelCapabilities.ts's modelSupportsVision for how this is determined (pattern-based, best-effort; there is no per-model field to read this from) */
	supportsVision: boolean;
	contextWindow: number;
	costPerMillionInputTokens: number;
	costPerMillionOutputTokens: number;
};

export interface IModelRouterService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeRouter: Event<void>;
	readonly state: ModelRouterState;

	getMode(): ModelRouterMode;
	setMode(mode: ModelRouterMode): void;

	/** MANUAL-mode override for a router category; null clears it (falls back to the Chat feature's model) */
	getCategoryOverride(category: RouterCategory): ModelSelection | null;
	setCategoryOverride(category: RouterCategory, selection: ModelSelection | null): void;

	describeModel(selection: ModelSelection): ModelCapabilityDescriptor;
	/** every model that's actually configured and enabled right now, across every provider */
	listConfiguredModels(): ModelCapabilityDescriptor[];

	/**
	 * Resolve the model to use for a router category under the current mode.
	 * - MANUAL: the category's override if set, else the Chat feature's own model selection.
	 * - AUTO: the best configured model for this category by capability (never a provider
	 *   with no real credentials, even if Void has static info about it) - see
	 *   modelRouterService.ts's _autoSelect for the exact preference order per category.
	 * Returns null only when nothing at all is configured (same "no model available" meaning
	 * ModelSelection | null already has everywhere else in this codebase).
	 */
	resolveModel(category: RouterCategory): ModelSelection | null;

	/**
	 * The best configured, vision-capable model, for the browser-screenshot-analysis flow
	 * (docs/integrations/model-router.md's Vision section) - scored the same way the 'browser'
	 * category is, but restricted to listConfiguredModels() entries whose supportsVision is
	 * true. Returns null if nothing configured actually supports vision (never silently widens
	 * to a non-vision model or an unconfigured provider).
	 */
	resolveVisionModel(): ModelSelection | null;
}

export const IModelRouterService = createDecorator<IModelRouterService>('vaderModelRouterService');
