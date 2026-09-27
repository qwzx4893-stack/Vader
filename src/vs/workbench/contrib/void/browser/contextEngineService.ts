/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DocumentSymbol, SymbolKind } from '../../../../editor/common/languages.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { IVoidSCMService } from '../common/voidSCMTypes.js';
import { BuildContextOpts, BuildContextResult, ContextSection, ContextSectionName, IContextEngineService, TaskType } from '../common/context/contextEngineTypes.js';

export * from '../common/context/contextEngineTypes.js';

// chars-per-token heuristic (roughly right for English/code with most tokenizers) - used
// only for OUR OWN section-budgeting decisions, never reported to the user or a provider as
// a real token count. Real provider usage reporting (when a provider returns it) is a
// separate, more accurate signal handled by the memory/compaction layer, not this one.
const CHARS_PER_TOKEN_ESTIMATE = 4;
const estimateTokens = (s: string) => Math.ceil(s.length / CHARS_PER_TOKEN_ESTIMATE);

const MAX_FILES_FOR_SYMBOLS = 12;
const MAX_SYMBOLS_PER_FILE = 40;
const MIN_CHARS_WORTH_INCLUDING = 80; // below this, truncating a section isn't useful - drop it instead

const SYMBOL_KIND_LABELS: Record<SymbolKind, string> = {
	[SymbolKind.File]: 'File', [SymbolKind.Module]: 'Module', [SymbolKind.Namespace]: 'Namespace',
	[SymbolKind.Package]: 'Package', [SymbolKind.Class]: 'Class', [SymbolKind.Method]: 'Method',
	[SymbolKind.Property]: 'Property', [SymbolKind.Field]: 'Field', [SymbolKind.Constructor]: 'Constructor',
	[SymbolKind.Enum]: 'Enum', [SymbolKind.Interface]: 'Interface', [SymbolKind.Function]: 'Function',
	[SymbolKind.Variable]: 'Variable', [SymbolKind.Constant]: 'Constant', [SymbolKind.String]: 'String',
	[SymbolKind.Number]: 'Number', [SymbolKind.Boolean]: 'Boolean', [SymbolKind.Array]: 'Array',
	[SymbolKind.Object]: 'Object', [SymbolKind.Key]: 'Key', [SymbolKind.Null]: 'Null',
	[SymbolKind.EnumMember]: 'EnumMember', [SymbolKind.Struct]: 'Struct', [SymbolKind.Event]: 'Event',
	[SymbolKind.Operator]: 'Operator', [SymbolKind.TypeParameter]: 'TypeParameter',
};
const symbolKindLabel = (k: SymbolKind): string => SYMBOL_KIND_LABELS[k] ?? 'Symbol';

// Flatten a document symbol tree to (at most) two levels deep - top-level declarations plus
// their direct members (methods on a class, etc) - which is enough for "what's in this
// file" without dumping every nested block statement.
function flattenSymbols(symbols: DocumentSymbol[], depth = 0): DocumentSymbol[] {
	if (depth > 1) return [];
	const out: DocumentSymbol[] = [];
	for (const s of symbols) {
		out.push(s);
		if (s.children?.length) out.push(...flattenSymbols(s.children, depth + 1));
	}
	return out;
}

const BUG_FIXING_KEYWORDS = ['bug', 'fix', 'error', 'crash', 'fail', 'exception', 'broken', 'wrong', 'incorrect', 'regression', 'stack trace', 'traceback'];
const ARCHITECTURE_KEYWORDS = ['architecture', 'design', 'refactor', 'restructure', 'pattern', 'abstraction', 'module', 'decouple', 'interface', 'extract'];
const UI_KEYWORDS = ['ui', 'css', 'style', 'styling', 'component', 'button', 'layout', 'design', 'color', 'theme', 'responsive', 'animation', 'render'];

// Section priority order per task type - decides which sections survive truncation first
// when the token budget can't fit everything. This is the "Context Router" - it doesn't
// fetch different data per task type (all sections are always computed; they're cheap
// relative to an LLM call), it decides what to keep when space is short.
const SECTION_ORDER: Record<TaskType, ContextSectionName[]> = {
	bug_fixing: ['diagnostics', 'mentionedFileSymbols', 'gitDiff', 'openEditorSymbols', 'gitLog'],
	architecture: ['mentionedFileSymbols', 'openEditorSymbols', 'gitLog', 'gitDiff', 'diagnostics'],
	ui: ['mentionedFileSymbols', 'openEditorSymbols', 'diagnostics', 'gitDiff', 'gitLog'],
	general: ['mentionedFileSymbols', 'diagnostics', 'openEditorSymbols', 'gitDiff', 'gitLog'],
};

const SECTION_LABELS: Record<ContextSectionName, string> = {
	mentionedFileSymbols: 'Symbol outline of files you mentioned',
	openEditorSymbols: 'Symbol outline of other open files',
	diagnostics: 'Current diagnostics (errors/warnings)',
	gitDiff: 'Uncommitted git changes',
	gitLog: 'Recent git history',
};

class ContextEngineService extends Disposable implements IContextEngineService {
	readonly _serviceBrand: undefined;

	// keyed by uri.toString(); invalidated by the text model's own versionId, which VS Code
	// already increments on every edit (including unsaved ones) - a correctness-preserving
	// incremental cache with no separate file-watcher plumbing needed.
	private readonly _symbolCacheByUri = new Map<string, { versionId: number; content: string }>();
	private readonly _diagnosticsCacheByUri = new Map<string, { markerVersion: number; content: string }>();
	private readonly _markerVersionByUri = new Map<string, number>();

	private readonly _scmService: IVoidSCMService;

	constructor(
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@IMarkerService private readonly _markerService: IMarkerService,
		@IVoidModelService private readonly _voidModelService: IVoidModelService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		// same proxy pattern voidSCMService.ts's GenerateCommitMessageService uses - real git
		// commands run in electron-main, this is just the IPC handle to them.
		this._scmService = ProxyChannel.toService<IVoidSCMService>(mainProcessService.getChannel('void-channel-scm'));

		this._register(this._markerService.onMarkerChanged((uris) => {
			for (const uri of uris) {
				this._markerVersionByUri.set(uri.toString(), (this._markerVersionByUri.get(uri.toString()) ?? 0) + 1);
			}
		}));
	}

	classifyTaskType(userMessage: string): TaskType {
		const msg = userMessage.toLowerCase();
		const score = (keywords: string[]) => keywords.reduce((n, k) => n + (msg.includes(k) ? 1 : 0), 0);
		const scores: [TaskType, number][] = [
			['bug_fixing', score(BUG_FIXING_KEYWORDS)],
			['architecture', score(ARCHITECTURE_KEYWORDS)],
			['ui', score(UI_KEYWORDS)],
		];
		scores.sort((a, b) => b[1] - a[1]);
		return scores[0][1] > 0 ? scores[0][0] : 'general';
	}

	private async _getModelFor(uri: URI): Promise<ITextModel | null> {
		try {
			const { model } = await this._voidModelService.getModelSafe(uri);
			return model;
		} catch {
			return null;
		}
	}

	private async _symbolsForFile(uri: URI): Promise<string> {
		const cacheKey = uri.toString();
		const model = await this._getModelFor(uri);
		if (!model) return '';

		const versionId = model.getVersionId();
		const cached = this._symbolCacheByUri.get(cacheKey);
		if (cached && cached.versionId === versionId) return cached.content;

		let content = '';
		try {
			const providers = this._languageFeaturesService.documentSymbolProvider.ordered(model);
			for (const provider of providers) {
				const symbols = await provider.provideDocumentSymbols(model, CancellationToken.None);
				if (!symbols || symbols.length === 0) continue;
				const flat = flattenSymbols(symbols).slice(0, MAX_SYMBOLS_PER_FILE);
				const lines = flat.map(s => `  ${symbolKindLabel(s.kind)} ${s.name} (L${s.range.startLineNumber}-${s.range.endLineNumber})`);
				content = `${uri.fsPath}:\n${lines.join('\n')}`;
				break; // first provider with results wins, same convention as the codespan-link lookup
			}
		} catch {
			content = '';
		}

		this._symbolCacheByUri.set(cacheKey, { versionId, content });
		return content;
	}

	private async _diagnosticsForFile(uri: URI): Promise<string> {
		const cacheKey = uri.toString();
		const markerVersion = this._markerVersionByUri.get(cacheKey) ?? 0;
		const cached = this._diagnosticsCacheByUri.get(cacheKey);
		if (cached && cached.markerVersion === markerVersion) return cached.content;

		const markers = this._markerService.read({ resource: uri, severities: MarkerSeverity.Warning | MarkerSeverity.Error });
		const content = markers.length === 0 ? '' : `${uri.fsPath}:\n` + markers
			.slice(0, 30)
			.map(m => `  L${m.startLineNumber}: [${MarkerSeverity.toString(m.severity)}] ${m.message}`)
			.join('\n');

		this._diagnosticsCacheByUri.set(cacheKey, { markerVersion, content });
		return content;
	}

	private _gitWorkspacePath(): string | null {
		const folders = this._workspaceContextService.getWorkspace().folders;
		return folders[0]?.uri.fsPath ?? null;
	}

	private async _gitDiffSection(): Promise<string> {
		const path = this._gitWorkspacePath();
		if (!path) return '';
		try {
			const [stat, sampled] = await Promise.all([this._scmService.gitStat(path), this._scmService.gitSampledDiffs(path)]);
			if (!stat && !sampled) return '';
			return [stat, sampled].filter(Boolean).join('\n\n');
		} catch {
			// no git repo here, git not installed, or the command failed - degrade to nothing,
			// same as discoveryMainService.ts does for a failed external search
			return '';
		}
	}

	private async _gitLogSection(): Promise<string> {
		const path = this._gitWorkspacePath();
		if (!path) return '';
		try {
			const [branch, log] = await Promise.all([this._scmService.gitBranch(path), this._scmService.gitLog(path)]);
			if (!branch && !log) return '';
			return [branch ? `Current branch: ${branch}` : '', log].filter(Boolean).join('\n');
		} catch {
			return '';
		}
	}

	async buildContext(opts: BuildContextOpts): Promise<BuildContextResult> {
		const taskType = this.classifyTaskType(opts.userMessage);

		const mentioned = dedupeURIs(opts.mentionedURIs);
		const opened = dedupeURIs(opts.openedURIs).filter(u => !mentioned.some(m => m.toString() === u.toString()));
		const allFiles = [...mentioned, ...opened].slice(0, MAX_FILES_FOR_SYMBOLS);

		const [mentionedSymbolParts, openedSymbolParts, diagnosticParts, gitDiff, gitLog] = await Promise.all([
			Promise.all(mentioned.slice(0, MAX_FILES_FOR_SYMBOLS).map(u => this._symbolsForFile(u))),
			Promise.all(opened.slice(0, MAX_FILES_FOR_SYMBOLS).map(u => this._symbolsForFile(u))),
			Promise.all(allFiles.map(u => this._diagnosticsForFile(u))),
			this._gitDiffSection(),
			this._gitLogSection(),
		]);

		const rawSections: Record<ContextSectionName, string> = {
			mentionedFileSymbols: mentionedSymbolParts.filter(Boolean).join('\n\n'),
			openEditorSymbols: openedSymbolParts.filter(Boolean).join('\n\n'),
			diagnostics: diagnosticParts.filter(Boolean).join('\n\n'),
			gitDiff,
			gitLog,
		};

		// greedily include sections in this task type's priority order, truncating the
		// section that first exceeds the remaining budget instead of dropping it outright,
		// unless what would remain is too small to be useful
		const budgetChars = opts.tokenBudget * CHARS_PER_TOKEN_ESTIMATE;
		let remainingChars = budgetChars;
		const sections: ContextSection[] = [];

		for (const name of SECTION_ORDER[taskType]) {
			const raw = rawSections[name];
			if (!raw) {
				sections.push({ name, label: SECTION_LABELS[name], content: '', estimatedTokens: 0, includedInBudget: false, truncated: false });
				continue;
			}
			if (remainingChars < MIN_CHARS_WORTH_INCLUDING) {
				sections.push({ name, label: SECTION_LABELS[name], content: raw, estimatedTokens: estimateTokens(raw), includedInBudget: false, truncated: false });
				continue;
			}
			if (raw.length <= remainingChars) {
				remainingChars -= raw.length;
				sections.push({ name, label: SECTION_LABELS[name], content: raw, estimatedTokens: estimateTokens(raw), includedInBudget: true, truncated: false });
			} else {
				const truncatedContent = raw.slice(0, remainingChars) + '\n...(truncated to fit context budget)...';
				remainingChars = 0;
				sections.push({ name, label: SECTION_LABELS[name], content: truncatedContent, estimatedTokens: estimateTokens(truncatedContent), includedInBudget: true, truncated: true });
			}
		}

		const includedText = sections
			.filter(s => s.includedInBudget && s.content)
			.map(s => `### ${s.label}\n${s.content}`)
			.join('\n\n');

		return { text: includedText, taskType, sections };
	}
}

function dedupeURIs(uris: URI[]): URI[] {
	const seen = new Set<string>();
	const out: URI[] = [];
	for (const u of uris) {
		const key = u.toString();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(u);
	}
	return out;
}

registerSingleton(IContextEngineService, ContextEngineService, InstantiationType.Delayed);
