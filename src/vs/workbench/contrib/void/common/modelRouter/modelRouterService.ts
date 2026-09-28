/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { getModelCapabilities, modelSupportsVision } from '../modelCapabilities.js';
import { localProviderNames, ModelSelection, ProviderName, providerNames } from '../voidSettingsTypes.js';
import { IVoidSettingsService } from '../voidSettingsService.js';
import { IModelRouterService, ModelCapabilityDescriptor, ModelRouterMode, RouterCategory } from './modelRouterTypes.js';

export * from './modelRouterTypes.js';

const VADER_MODEL_ROUTER_STORAGE_KEY = 'vader.modelRouterServiceStorageI';

type PersistedState = {
	mode: ModelRouterMode;
	categoryOverrides: Partial<Record<RouterCategory, ModelSelection>>;
};

const defaultState: PersistedState = { mode: 'manual', categoryOverrides: {} };

// AUTO-mode preference order per category - which ModelCapabilityDescriptor fields matter
// most for that kind of turn. All scoring is over listConfiguredModels() only, so an
// unconfigured provider (no API key entered, or a model the user hasn't enabled) can never
// be silently selected, however capable its static info says it is.
const scoreForCategory = (d: ModelCapabilityDescriptor, category: RouterCategory): number => {
	let score = 0;
	if (category === 'subagent' || category === 'research' || category === 'browser' || category === 'verification') {
		// these categories run the same tool-calling agent loop the Main Agent does
		if (d.supportsNativeToolCalling) score += 100;
		if (d.supportsMultipleToolCallsPerTurn) score += 50;
		score += Math.min(d.contextWindow / 1000, 100); // more context headroom is better, capped so it doesn't dominate
	} else if (category === 'summarization') {
		// a compaction pass is a single non-agentic call - favor cheap and fast over tool support
		score += 100 - Math.min(d.costPerMillionInputTokens, 100);
		if (d.supportsPromptCaching) score += 10;
	}
	return score;
};

class ModelRouterService extends Disposable implements IModelRouterService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeRouter = this._register(new Emitter<void>());
	readonly onDidChangeRouter: Event<void> = this._onDidChangeRouter.event;

	private _state: PersistedState;
	get state(): PersistedState { return this._state; }

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
	) {
		super();
		this._state = this._readState();
	}

	private _readState(): PersistedState {
		try {
			const raw = this._storageService.get(VADER_MODEL_ROUTER_STORAGE_KEY, StorageScope.APPLICATION);
			if (!raw) return defaultState;
			const parsed = JSON.parse(raw);
			return { mode: parsed.mode === 'auto' ? 'auto' : 'manual', categoryOverrides: parsed.categoryOverrides ?? {} };
		} catch {
			return defaultState;
		}
	}

	private _writeState() {
		this._storageService.store(VADER_MODEL_ROUTER_STORAGE_KEY, JSON.stringify(this._state), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeRouter.fire();
	}

	getMode(): ModelRouterMode { return this._state.mode; }
	setMode(mode: ModelRouterMode): void {
		this._state = { ...this._state, mode };
		this._writeState();
	}

	getCategoryOverride(category: RouterCategory): ModelSelection | null {
		return this._state.categoryOverrides[category] ?? null;
	}
	setCategoryOverride(category: RouterCategory, selection: ModelSelection | null): void {
		const categoryOverrides = { ...this._state.categoryOverrides };
		if (selection) categoryOverrides[category] = selection;
		else delete categoryOverrides[category];
		this._state = { ...this._state, categoryOverrides };
		this._writeState();
	}

	describeModel(selection: ModelSelection): ModelCapabilityDescriptor {
		const { providerName, modelName } = selection;
		const overridesOfModel = this._settingsService.state.overridesOfModel;
		const caps = getModelCapabilities(providerName, modelName, overridesOfModel);
		const settingsAtProvider = this._settingsService.state.settingsOfProvider[providerName];
		const modelEntry = settingsAtProvider.models.find(m => m.modelName === modelName);
		const isConfigured = !!settingsAtProvider._didFillInProviderSettings && !!modelEntry && !modelEntry.isHidden;
		return {
			providerName,
			modelName,
			isConfigured,
			isLocal: (localProviderNames as readonly string[]).includes(providerName),
			supportsNativeToolCalling: !!caps.specialToolFormat,
			supportsMultipleToolCallsPerTurn: !!caps.specialToolFormat, // native paths all collect every tool call now - see CHANGELOG's multi-tool-call entry; only the XML fallback (specialToolFormat undefined) is still single-tool
			supportsReasoning: !!caps.reasoningCapabilities,
			supportsFIM: caps.supportsFIM,
			supportsPromptCaching: caps.cost.cache_read !== undefined,
			supportsVision: modelSupportsVision(providerName, modelName),
			contextWindow: caps.contextWindow,
			costPerMillionInputTokens: caps.cost.input,
			costPerMillionOutputTokens: caps.cost.output,
		};
	}

	listConfiguredModels(): ModelCapabilityDescriptor[] {
		const out: ModelCapabilityDescriptor[] = [];
		for (const providerName of providerNames as ProviderName[]) {
			const settingsAtProvider = this._settingsService.state.settingsOfProvider[providerName];
			if (!settingsAtProvider._didFillInProviderSettings) continue;
			for (const m of settingsAtProvider.models) {
				if (m.isHidden) continue;
				out.push(this.describeModel({ providerName, modelName: m.modelName }));
			}
		}
		return out;
	}

	private _autoSelect(category: RouterCategory): ModelSelection | null {
		const configured = this.listConfiguredModels();
		if (configured.length === 0) return null;

		// prefer whatever's already configured for Chat, if it's actually usable - keeps
		// AUTO mode predictable (same model as the visible chat) unless another configured
		// model is meaningfully better-suited for this category
		const chatSelection = this._settingsService.state.modelSelectionOfFeature['Chat'];
		const chatDescriptor = chatSelection ? configured.find(d => d.providerName === chatSelection.providerName && d.modelName === chatSelection.modelName) : undefined;

		const ranked = [...configured].sort((a, b) => scoreForCategory(b, category) - scoreForCategory(a, category));
		const best = ranked[0];

		// only override the Chat model if something scores meaningfully higher for this
		// category - avoids e.g. switching providers for a 2-point context-window edge
		if (chatDescriptor && scoreForCategory(chatDescriptor, category) >= scoreForCategory(best, category) - 5) {
			return { providerName: chatDescriptor.providerName, modelName: chatDescriptor.modelName };
		}
		return { providerName: best.providerName, modelName: best.modelName };
	}

	resolveModel(category: RouterCategory): ModelSelection | null {
		if (this._state.mode === 'auto') {
			return this._autoSelect(category);
		}
		const override = this.getCategoryOverride(category);
		if (override) return override;
		return this._settingsService.state.modelSelectionOfFeature['Chat'];
	}

	resolveVisionModel(): ModelSelection | null {
		const visionCapable = this.listConfiguredModels().filter(d => d.supportsVision);
		if (visionCapable.length === 0) return null;
		const ranked = [...visionCapable].sort((a, b) => scoreForCategory(b, 'browser') - scoreForCategory(a, 'browser'));
		const best = ranked[0];
		return { providerName: best.providerName, modelName: best.modelName };
	}
}

registerSingleton(IModelRouterService, ModelRouterService, InstantiationType.Delayed);
