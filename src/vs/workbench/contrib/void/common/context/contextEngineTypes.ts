/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../../base/common/uri.js';

// A rough classification of what kind of work a message is asking for, used only to decide
// which context sections are worth spending token budget on first - never to change tool
// availability or policy, which stay governed by chatMode/the Policy Engine.
export type TaskType = 'bug_fixing' | 'architecture' | 'ui' | 'general';

export type ContextSectionName =
	| 'mentionedFileSymbols'
	| 'openEditorSymbols'
	| 'diagnostics'
	| 'gitDiff'
	| 'gitLog';

export type ContextSection = {
	name: ContextSectionName;
	label: string;
	/** '' when this section had nothing to contribute (e.g. no git repo, no open files) */
	content: string;
	/** chars/4 heuristic - see contextEngineService.ts's estimateTokens for why not a real tokenizer */
	estimatedTokens: number;
	/** false when the section was computed but dropped (or truncated) to fit the token budget - kept in the result for UI/diagnostic explainability of what was and wasn't sent */
	includedInBudget: boolean;
	truncated: boolean;
};

export type BuildContextOpts = {
	userMessage: string;
	/** files/folders the user explicitly referenced in this message (StagingSelectionItem uris) */
	mentionedURIs: URI[];
	/** currently open editors, lower priority than explicit mentions */
	openedURIs: URI[];
	/** approximate token budget available for this whole block - see the caller for how it's derived from the model's context window */
	tokenBudget: number;
};

export type BuildContextResult = {
	/** ready to embed as one prompt section; '' if every section came up empty */
	text: string;
	taskType: TaskType;
	/** every section that was computed, whether or not it made it into `text` - for explainability, not for re-embedding */
	sections: ContextSection[];
};

/**
 * The Context Engine assembles the *dynamic* per-turn context a model turn gets beyond the
 * static repo file tree (`IDirectoryStrService`, unchanged) and the layered instructions
 * (`IInstructionsService`, unchanged): symbol outlines for files the user mentioned or has
 * open, live diagnostics for those files, and git diff/log - each real data from services
 * already in this codebase (`ILanguageFeaturesService`'s document symbol/definition
 * providers, `IMarkerService`, `IVoidSCMService`), not invented. See
 * `docs/integrations/context-engine.md` for the section priority/truncation rules and the
 * task-type classification heuristic.
 */
export interface IContextEngineService {
	readonly _serviceBrand: undefined;
	classifyTaskType(userMessage: string): TaskType;
	buildContext(opts: BuildContextOpts): Promise<BuildContextResult>;
}

export const IContextEngineService = createDecorator<IContextEngineService>('vaderContextEngineService');
