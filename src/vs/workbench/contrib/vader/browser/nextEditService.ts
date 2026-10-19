/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { InlineCompletion, InlineCompletionContext, InlineCompletionEndOfLifeReasonKind } from '../../../../editor/common/languages.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { Schemas } from '../../../../base/common/network.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IVaderSettingsService } from '../common/vaderSettingsService.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { EditTrail } from '../common/nextEdit/editTrail.js';
import { NextEditGate } from '../common/nextEdit/nextEditGate.js';
import { buildRequest, isWorthShowing, LineEdit, parseAnswer, toLineEdit } from '../common/nextEdit/nextEditRequest.js';

// The next edit, drawn in the editor (common/nextEdit/ says how it is chosen). The editor already knows how to show "an edit somewhere near the cursor" (old lines in red, the new ones
// beside them, Tab to accept, Esc to dismiss); this is the provider that gives it those edits. It is off unless the person turned it on in Settings, asks a model only after a pause, and never more
// than twenty times a minute. A file that is large, not on disk, or that has text selected is left alone.

const MAX_FILE_CHARS = 300_000
const REQUEST_TIMEOUT_MS = 12_000

type Pending = { line: number }

/** the file as the model is shown it: the last three parts of its path, which tells two files with the same name apart */
const shortName = (m: ITextModel): string => m.uri.path.split('/').filter(Boolean).slice(-3).join('/')

export class NextEditService extends Disposable {
	static readonly ID = 'vader.nextEditService'

	private readonly _trail = new EditTrail()
	private readonly _gate = new NextEditGate()
	private readonly _watched = new Set<string>()
	private _lastShown: Pending | undefined
	/** the answer for a document version and line, so that asking again for the same place does not ask a model again */
	private _cache: { key: string; items: InlineCompletion[] } | undefined

	constructor(
		@ILanguageFeaturesService private readonly _langFeatures: ILanguageFeaturesService,
		@ILLMMessageService private readonly _llm: ILLMMessageService,
		@IModelService private readonly _modelService: IModelService,
		@IEditorService private readonly _editorService: IEditorService,
		@IVaderSettingsService private readonly _settings: IVaderSettingsService,
		@IConvertToLLMMessageService private readonly _convert: IConvertToLLMMessageService,
	) {
		super()

		for (const m of this._modelService.getModels()) this._watch(m)
		this._register(this._modelService.onModelAdded(m => this._watch(m)))
		this._register(this._modelService.onModelRemoved(m => { this._trail.forget(shortName(m)); this._watched.delete(m.uri.toString()) }))

		this._register(this._langFeatures.inlineCompletionsProvider.register('*', {
			groupId: 'vader-next-edit',
			provideInlineCompletions: async (model, position, context, token) => ({ items: await this._provide(model, position, context, token) }),
			disposeInlineCompletions: () => { },
			handleEndOfLifetime: (_completions, item, reason) => {
				if (!this._isOurs(item)) return
				if (reason.kind === InlineCompletionEndOfLifeReasonKind.Rejected) {
					const line = this._lastShown?.line ?? item.range?.startLineNumber ?? 0
					this._gate.onReject(line, Date.now())
				}
				this._lastShown = undefined
			},
		}))
	}

	private _watch(model: ITextModel): void {
		if (model.uri.scheme !== Schemas.file) return
		const key = shortName(model)
		if (this._watched.has(model.uri.toString())) return
		this._watched.add(model.uri.toString())
		const text = () => model.getValueLength() <= MAX_FILE_CHARS ? model.getValue() : undefined
		const first = text()
		if (first !== undefined) this._trail.update(key, first, Date.now())
		this._register(model.onDidChangeContent(() => {
			if (!this._settings.state.globalSettings.nextEdit) return
			const now = Date.now()
			const t = text()
			if (t === undefined) { this._trail.forget(key); return }
			this._trail.update(key, t, now)
			this._trail.settle(now)
			const pos = this._activePosition(model)
			this._gate.onKeystroke(pos?.lineNumber ?? 0, now)
		}))
	}

	private _activePosition(model: ITextModel): { lineNumber: number; selectionEmpty: boolean } | undefined {
		const control = this._editorService.activeTextEditorControl
		if (!control || !isCodeEditor(control) || control.getModel() !== model) return undefined
		const p = control.getPosition()
		if (!p) return undefined
		return { lineNumber: p.lineNumber, selectionEmpty: control.getSelection()?.isEmpty() ?? true }
	}

	private readonly _ours = new WeakSet<object>()
	private _isOurs(item: object): boolean { return this._ours.has(item) }

	private async _provide(model: ITextModel, position: Position, context: InlineCompletionContext, token: CancellationToken): Promise<InlineCompletion[]> {
		if (!this._settings.state.globalSettings.nextEdit) return []
		if (model.uri.scheme !== Schemas.file || model.getValueLength() > MAX_FILE_CHARS) return []

		const key = `${model.uri.toString()}|${model.getVersionId()}|${position.lineNumber}`
		if (this._cache?.key === key) return this._cache.items

		// wait for a pause: VS Code cancels this call when the person types again
		const waited = await new Promise<boolean>(resolve => {
			const h = setTimeout(() => resolve(true), 380)
			token.onCancellationRequested(() => { clearTimeout(h); resolve(false) })
		})
		if (!waited || token.isCancellationRequested) return []

		const now = Date.now()
		const sel = this._activePosition(model)
		const verdict = this._gate.shouldAsk({ line: position.lineNumber, now, reason: 'pause', selectionEmpty: sel?.selectionEmpty ?? true, suggestWidgetOpen: !!context.selectedSuggestionInfo })
		if (!verdict.ok) return []

		const modelSelection = this._settings.state.modelSelectionOfFeature['Apply'] ?? this._settings.state.modelSelectionOfFeature['Chat']
		if (!modelSelection) return []

		const lines = model.getLinesContent()
		const req = buildRequest({
			file: shortName(model), languageId: model.getLanguageId(), lines,
			caretLine: position.lineNumber, caretColumn: position.column, trail: this._trail.text(now),
		})
		const { messages, separateSystemMessage } = this._convert.prepareLLMSimpleMessages({
			simpleMessages: [{ role: 'user', content: req.user }], systemMessage: req.system, modelSelection, featureName: 'Apply',
		})
		this._gate.asked(now)

		const answer = await new Promise<string | undefined>(resolve => {
			let done = false
			const finish = (v: string | undefined) => { if (!done) { done = true; clearTimeout(timer); resolve(v) } }
			const id = this._llm.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				separateSystemMessage,
				chatMode: null,
				modelSelection,
				modelSelectionOptions: this._settings.state.optionsOfModelSelection['Apply'][modelSelection.providerName]?.[modelSelection.modelName],
				overridesOfModel: this._settings.state.overridesOfModel,
				onText: () => { },
				onFinalMessage: ({ fullText }) => finish(fullText),
				onError: () => finish(undefined),
				onAbort: () => finish(undefined),
				logging: { loggingName: 'Next edit' },
			})
			const timer = setTimeout(() => { if (id) this._llm.abort(id); finish(undefined) }, REQUEST_TIMEOUT_MS)
			token.onCancellationRequested(() => { if (id) this._llm.abort(id); finish(undefined) })
		})
		if (answer === undefined || token.isCancellationRequested) return []
		// the file moved on while the model was thinking: what it answered is about text that is gone
		if (model.getVersionId() !== Number(key.split('|')[1])) return []

		const parsed = parseAnswer(answer, req.regionText)
		if ('none' in parsed) return []
		if (!isWorthShowing(req.regionText, parsed.text)) return []
		const edit = toLineEdit(req.regionStart, req.regionText, parsed.text)
		if (!edit) return []

		const item = this._toCompletion(model, edit)
		this._ours.add(item)
		this._lastShown = { line: position.lineNumber }
		const items = [item]
		this._cache = { key, items }
		return items
	}

	private _toCompletion(model: ITextModel, e: LineEdit): InlineCompletion {
		const max = (n: number) => model.getLineMaxColumn(n)
		const count = model.getLineCount()
		let range: Range, insertText: string
		if (e.kind === 'insert') {
			range = new Range(e.beforeLine, 1, e.beforeLine, 1)
			insertText = e.text + '\n'
		} else if (e.kind === 'delete') {
			insertText = ''
			if (e.endLine < count) range = new Range(e.startLine, 1, e.endLine + 1, 1)
			else if (e.startLine > 1) range = new Range(e.startLine - 1, max(e.startLine - 1), e.endLine, max(e.endLine))
			else range = new Range(1, 1, e.endLine, max(e.endLine))
		} else {
			range = new Range(e.startLine, 1, e.endLine, max(e.endLine))
			insertText = e.text
		}
		return { insertText, range, isInlineEdit: true, showInlineEditMenu: true }
	}
}

registerWorkbenchContribution2(NextEditService.ID, NextEditService, WorkbenchPhase.BlockRestore)
