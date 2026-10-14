/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { RepeatedCallDetector, TextRepetitionDetector, explainRunFailure } from '../common/loopDetection.js';
import { unknownToolMessage } from '../common/toolNameHints.js';
import { chat_userMessageContent, contextCompaction_systemMessage, contextCompaction_userMessage, isABuiltinToolName, verificationAgent_userMessage } from '../common/prompt/prompts.js';
import { VerificationFinding, VerificationFindingSeverity, VerificationVerdict } from '../common/verification/verificationTypes.js';
import { getModelCapabilities } from '../common/modelCapabilities.js';
import { looksLikeToolsRejected } from '../common/toolSupport.js';
import { planContextReduction, prunedOutputNote, SizedMessage } from '../common/contextBudget.js';
import { IMemoryService } from '../common/memory/memoryService.js';
import { IModelRouterService } from '../common/modelRouter/modelRouterService.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IExternalAgentMainService, ExternalAgentEvent } from '../common/externalAgents/externalAgentTypes.js';
import { externalAgentById } from '../common/externalAgents/externalAgentCatalog.js';
import { baseName } from '../common/externalAgents/externalAgentProtocol.js';
import { IExternalAgentsService } from './externalAgents/externalAgentsService.js';
import { IAgentRuntimeRegistryService } from './agentRuntime/agentRuntimeRegistryService.js';
import { VaderAgentModel } from './agentRuntime/vaderAgentModel.js';
import { buildClineTools } from './agentRuntime/clineToolAdapter.js';
import { createClineAgentRuntime } from './agentRuntime/clineRuntimeAdapter.js';
import { getErrorMessage, RawToolCallObj, RawToolParamsObj } from '../common/sendLLMMessageTypes.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { FeatureName, ModelSelection, ModelSelectionOptions } from '../common/vaderSettingsTypes.js';
import { IVaderSettingsService } from '../common/vaderSettingsService.js';
import { approvalTypeOfBuiltinToolName, BuiltinToolCallParams, BuiltinToolName, ToolCallParams, ToolName, ToolResult } from '../common/toolsServiceTypes.js';
import { IToolsService } from './toolsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ChatMessage, CheckpointEntry, CodespanLocationLink, CompactedSummaryEntry, StagingSelectionItem, ToolMessage } from '../common/chatThreadServiceTypes.js';
import { Position } from '../../../../editor/common/core/position.js';
import { IMetricsService } from '../common/metricsService.js';
import { shorten } from '../../../../base/common/labels.js';
import { IVaderModelService } from '../common/vaderModelService.js';
import { findLast, findLastIdx } from '../../../../base/common/arraysFind.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { VaderFileSnapshot } from '../common/editCodeServiceTypes.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { truncate } from '../../../../base/common/strings.js';
import { THREAD_STORAGE_KEY } from '../common/storageKeys.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMCPService } from '../common/mcpService.js';
import { RawMCPToolCall } from '../common/mcpServiceTypes.js';
import { IPolicyService } from '../common/policy/policyService.js';
import { policyRequestOfToolCall } from '../common/policy/toolPolicyRequest.js';
import { withResolvedPaths } from '../common/policy/realPaths.js';
import { IAgentsService, agentScopeVerdict } from '../common/agents/agentsService.js';
import { addToLedger, addTurnToThreadUsage, budgetState, priceTurn, dayKey, DayTotals, parseLedger, spentOn, ThreadUsage, TokenUsage, UsageLedger } from '../common/usageAccounting.js';
import { groupThreadsByProject, ProjectGroup, projectKeyOf } from '../common/threadProjects.js';
import { changedFilesSinceLastUserMessage, deriveThreadStatus, endsWithToolRequest, ThreadStatus } from '../common/threadStatus.js';
import { ApprovalSubject, EMPTY_APPROVAL_STATE, isApproved, listApprovals, parseApprovalState, ProjectApprovalState, withApproval, withoutApproval } from '../common/policy/projectApprovals.js';
import { composeReviewComment, ReviewComment } from '../common/reviewComment.js';
import { localProviderNames } from '../common/vaderSettingsTypes.js';

const USAGE_LEDGER_STORAGE_KEY = 'vader.usageLedger'
const PROJECT_APPROVALS_STORAGE_KEY = 'vader.projectApprovals'


// Vader addition: tools blocked outright in 'gather' and 'plan' chat modes - hard
// enforcement, not the prompt-only "you're in gather mode, please don't edit" Vader shipped
// with (the UI already claimed "Reads files, but can't edit" for Gather; nothing actually
// enforced that before this - see docs/integrations/plan-mode.md's audit note). Every
// built-in tool that can write a file, run a shell command, delegate to another agent (which
// could itself edit files), write persistent memory, or touch a real webpage is listed
// explicitly, rather than derived from the 'edits'/'terminal' approval buckets, since those
// buckets exist for a different purpose (how visible/interruptive an approval prompt is) and
// conflating the two would silently change behavior if a tool's approval bucket changes for
// unrelated reasons. Any non-built-in (MCP) tool call is also blocked, since an MCP tool's
// side effects can't be verified as read-only from here.
const READONLY_MODE_BLOCKED_BUILTIN_TOOLS = new Set<BuiltinToolName>([
	'edit_file', 'rewrite_file', 'create_file_or_folder', 'delete_file_or_folder',
	'run_command', 'run_persistent_command', 'open_persistent_terminal', 'kill_persistent_terminal',
	'delegate_subagent_task', 'delegate_parallel_tasks',
	'browser_navigate', 'browser_click', 'browser_type',
	'create_persistent_agent', 'remember',
])


// Vader addition: parses the Verification Agent's <vader_verdict> block (see prompts.ts's
// verificationAgent_systemMessage) - same tag-extraction convention as compaction/plan
// parsing elsewhere in this file. Fails safe: if nothing parseable comes back (the model
// didn't follow the format, errored, or the thread stalled), the verdict is `passed: false`
// with a blocker finding saying so - an unparseable verdict is never treated as a pass.
const parseVerificationVerdict = (text: string): VerificationVerdict => {
	const blockMatch = text.match(/<vader_verdict>([\s\S]*?)<\/vader_verdict>/i)
	if (!blockMatch) {
		return { passed: false, findings: [{ severity: 'blocker', description: 'The verification agent did not return a parseable verdict - treat this as unverified, not as passing.' }], summary: 'Verification could not be completed.' }
	}
	const block = blockMatch[1]
	const extract = (tag: string): string => {
		const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
		return m ? m[1].trim() : ''
	}
	const passedText = extract('passed').toLowerCase()
	const findingsText = extract('findings')
	const findings: VerificationFinding[] = findingsText.split('\n').map((line): VerificationFinding | null => {
		const m = line.match(/^\s*[-*]?\s*\[(blocker|warning|info)\]\s*(.+)$/i)
		if (!m) return null
		const severity = m[1].toLowerCase() as VerificationFindingSeverity
		const rest = m[2].trim()
		const locMatch = rest.match(/\(([^()]+)\)\s*$/)
		const location = locMatch?.[1]
		return location ? { severity, description: rest.slice(0, locMatch!.index).trim(), location } : { severity, description: rest }
	}).filter((f): f is VerificationFinding => !!f)

	const hasBlocker = findings.some(f => f.severity === 'blocker')
	return {
		passed: passedText === 'true' && !hasBlocker,
		findings,
		summary: extract('summary') || '(no summary provided)',
	}
}

const findStagingSelectionIndex = (currentSelections: StagingSelectionItem[] | undefined, newSelection: StagingSelectionItem): number | null => {
	if (!currentSelections) return null

	for (let i = 0; i < currentSelections.length; i += 1) {
		const s = currentSelections[i]

		if (s.uri.fsPath !== newSelection.uri.fsPath) continue

		if (s.type === 'File' && newSelection.type === 'File') {
			return i
		}
		if (s.type === 'CodeSelection' && newSelection.type === 'CodeSelection') {
			if (s.uri.fsPath !== newSelection.uri.fsPath) continue
			// if there's any collision return true
			const [oldStart, oldEnd] = s.range
			const [newStart, newEnd] = newSelection.range
			if (oldStart !== newStart || oldEnd !== newEnd) continue
			return i
		}
		if (s.type === 'Folder' && newSelection.type === 'Folder') {
			return i
		}
	}
	return null
}


/*

Store a checkpoint of all "before" files on each x.
x's show up before user messages and LLM edit tool calls.

x     A          (edited A -> A')
(... user modified changes ...)
User message

x     A' B C     (edited A'->A'', B->B', C->C')
LLM Edit
x
LLM Edit
x
LLM Edit


INVARIANT:
A checkpoint appears before every LLM message, and before every user message (before user really means directly after LLM is done).
*/


type UserMessageType = ChatMessage & { role: 'user' }
type UserMessageState = UserMessageType['state']
const defaultMessageState: UserMessageState = {
	stagingSelections: [],
	isBeingEdited: false,
}

// a 'thread' means a chat message history

type WhenMounted = {
	textAreaRef: { current: HTMLTextAreaElement | null }; // the textarea that this thread has, gets set in SidebarChat
	scrollToBottom: () => void;
}



// Vader addition: the structured Plan→Execute handoff object Plan Mode produces. Preserves
// exactly the fields the mission's Plan Mode requirement names, each as its own field
// (not pasted-together free text) so an "Approve & Execute" action can hand them to the
// agent as structured context rather than the agent having to re-parse prose.
export type PlanObject = {
	objective: string;
	phases: string[]; // ordered
	filesOrSubsystems: string[];
	constraints: string;
	validationRequirements: string;
	unresolvedAssumptions: string;
}

export type ThreadType = {
	id: string; // store the id here too
	createdAt: string; // ISO string
	lastModified: string; // ISO string

	messages: ChatMessage[];
	filesWithUserChanges: Set<string>;

	// Vader addition: which permanent agent (agents/agentsService.ts) this thread runs as,
	// if any. undefined/null on old, pre-Vader threads and on threads never assigned one -
	// both mean "no agent, use default Chat behavior".
	agentId?: string | null;

	// Vader addition: the conversation this thread has with an external coding agent (Settings > Coding Agents): the agent's own id of it, so that a
	// restart of the app or of the agent's process can pick the conversation up again. Absent on every thread that never used one.
	externalSession?: { agentId: string, sessionId: string };

	// Vader addition: true for a hidden thread spun up by the delegate_subagent_task tool.
	// Filtered out of the visible thread selector, but not deleted, so its history can
	// still be inspected by threadId if something needs debugging.
	isSubagentThread?: boolean;

	// Vader addition: true for a hidden thread spun up for independent verification (see
	// runVerificationTask). Hard-forces the same read-only enforcement as Gather/Plan mode
	// (READONLY_MODE_BLOCKED_BUILTIN_TOOLS) regardless of the user's current global chat
	// mode - a verifier that could edit files to make its own checks pass would defeat the
	// entire point of it being independent.
	isVerificationThread?: boolean;

	// Vader addition: set for a hidden thread spun up by delegate_research_task/
	// delegate_browser_task - see docs/integrations/model-router.md. 'research' hard-forces
	// the same read-only enforcement as isVerificationThread (a research delegation must
	// never double as a way to sneak in edits); 'browser' does not, since browser automation
	// needs to actually click/navigate. Both route model selection through the Model
	// Router's matching category instead of generic 'subagent' - see
	// _currentModelSelectionProps.
	routerCategoryOverride?: 'research' | 'browser';

	// Vader addition: the latest structured plan Plan Mode produced for this thread, parsed
	// from a <vader_plan> block in an assistant message - see _maybeCaptureThreadPlan and
	// docs/integrations/plan-mode.md. null/undefined means no plan yet (or it was cleared
	// after being approved into execution). Additive/optional, so old persisted threads -
	// which can never have one - need no migration.
	activePlan?: PlanObject | null;

	// Vader addition: the folders that were open when this thread began. Conversations are listed under their project by this
	// (common/threadProjects.ts); an older thread has none and is listed under "Chats".
	projectFolders?: string[];

	// Vader addition: what this thread has cost so far, read from the providers' own token counts (common/usageAccounting.ts).
	usage?: ThreadUsage;

	// this doesn't need to go in a state object, but feels right
	state: {
		currCheckpointIdx: number | null; // the latest checkpoint we're at (null if not at a particular checkpoint, like if the chat is streaming, or chat just finished and we haven't clicked on a checkpt)

		stagingSelections: StagingSelectionItem[];
		focusedMessageIdx: number | undefined; // index of the user message that is being edited (undefined if none)

		linksOfMessageIdx: { // eg. link = linksOfMessageIdx[4]['RangeFunction']
			[messageIdx: number]: {
				[codespanName: string]: CodespanLocationLink
			}
		}


		mountedInfo?: {
			whenMounted: Promise<WhenMounted>
			_whenMountedResolver: (res: WhenMounted) => void
			mountedIsResolvedRef: { current: boolean };
		}


	};
}

type ChatThreads = {
	[id: string]: undefined | ThreadType;
}

// Vader addition: structured result handed back from a delegated subagent task, per the
// mission's requirement that subagents return "conclusion, evidence, changed files,
// warnings" rather than their full transcript.
export type SubagentTaskResult = {
	threadId: string;
	conclusion: string;
	changedFilePaths: string[];
	stalledAwaitingApproval: boolean;
	hadError: boolean;
}


export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string; // intended for internal use only
}

export type IsRunningType =
	| 'LLM' // the LLM is currently streaming
	| 'tool' // whether a tool is currently running
	| 'awaiting_user' // awaiting user call
	| 'idle' // nothing is running now, but the chat should still appear like it's going (used in-between calls)
	| undefined

export type ThreadStreamState = {
	[threadId: string]: undefined | {
		isRunning: undefined;
		error?: { message: string, fullError: Error | null, };
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt?: undefined;
	} | { // an assistant message is being written
		isRunning: 'LLM';
		error?: undefined;
		llmInfo: {
			displayContentSoFar: string;
			reasoningSoFar: string;
			toolCallSoFar: RawToolCallObj | null;
		};
		toolInfo?: undefined;
		interrupt: Promise<() => void>; // calling this should have no effect on state - would be too confusing. it just cancels the tool
	} | { // a tool is being run
		isRunning: 'tool';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo: {
			toolName: ToolName;
			toolParams: ToolCallParams<ToolName>;
			id: string;
			content: string;
			rawParams: RawToolParamsObj;
			mcpServerName: string | undefined;
		};
		interrupt: Promise<() => void>;
	} | {
		isRunning: 'awaiting_user';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt?: undefined;
	} | {
		isRunning: 'idle';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt: 'not_needed' | Promise<() => void>; // calling this should have no effect on state - would be too confusing. it just cancels the tool
	}
}

const newThreadObject = (projectFolders?: string[]) => {
	const now = new Date().toISOString()
	return {
		id: generateUuid(),
		createdAt: now,
		lastModified: now,
		messages: [],
		agentId: null,
		...(projectFolders && projectFolders.length ? { projectFolders } : {}),
		state: {
			currCheckpointIdx: null,
			stagingSelections: [],
			focusedMessageIdx: undefined,
			linksOfMessageIdx: {},
		},
		filesWithUserChanges: new Set()
	} satisfies ThreadType
}






// Vader fix. A thread's mount info (see _setState) is replaced by a fresh pending promise on every state change, and that
// promise only resolves when the chat view re-renders afterwards. If no render follows it stays pending forever; the
// "New Chat" action awaited it before doing anything, so after some replies (found by a live run: any reply containing
// inline code) clicking "+" silently did nothing. Waits on it are therefore bounded.
export const MOUNT_WAIT_TIMEOUT_MS = 1500
export const awaitMounted = <T>(whenMounted: Promise<T> | undefined, timeoutMs: number = MOUNT_WAIT_TIMEOUT_MS): Promise<T | undefined> =>
	whenMounted ? Promise.race([whenMounted, new Promise<undefined>(res => setTimeout(() => res(undefined), timeoutMs))]) : Promise.resolve(undefined)

export interface IChatThreadService {
	readonly _serviceBrand: undefined;

	readonly state: ThreadsState;
	readonly streamState: ThreadStreamState; // not persistent

	onDidChangeCurrentThread: Event<void>;
	onDidChangeStreamState: Event<{ threadId: string }>

	getCurrentThread(): ThreadType;
	openNewThread(): void;
	switchToThread(threadId: string): void;

	// Vader addition: run a thread as a given permanent agent (or null to go back to
	// default Chat behavior). See common/agents/agentsService.ts.
	setThreadAgentId(threadId: string, agentId: string | null): void;

	// Vader addition: temporary subagent delegation. Spins up a hidden thread, runs it to
	// completion (or until it stalls on a real approval requirement), and returns a
	// structured summary rather than merging its full message history into the caller.
	runSubagentTask(opts: { task: string, agentId?: string, onThreadCreated?: (threadId: string) => void, routerCategoryOverride?: 'research' | 'browser' }): Promise<SubagentTaskResult>;

	// Vader addition: independent verification - see PlanObject/isVerificationThread and
	// common/verification/verificationTypes.ts's IVerificationService (the actual caller).
	runVerificationTask(opts: { objective: string, evidenceText: string, onThreadCreated?: (threadId: string) => void }): Promise<VerificationVerdict>;

	// Vader addition: Plan Mode. See PlanObject and _maybeCaptureThreadPlan above - a plan
	// is captured automatically from a <vader_plan> block in an assistant message; this only
	// clears it (e.g. once "Approve & Execute" has handed it off).
	clearThreadPlan(threadId: string): void;

	// thread selector
	deleteThread(threadId: string): void;
	duplicateThread(threadId: string): void;

	// exposed getters/setters
	// these all apply to current thread
	getCurrentMessageState: (messageIdx: number) => UserMessageState
	setCurrentMessageState: (messageIdx: number, newState: Partial<UserMessageState>) => void
	getCurrentThreadState: () => ThreadType['state']
	setCurrentThreadState: (newState: Partial<ThreadType['state']>) => void

	// you can edit multiple messages - the one you're currently editing is "focused", and we add items to that one when you press cmd+L.
	getCurrentFocusedMessageIdx(): number | undefined;
	isCurrentlyFocusingMessage(): boolean;
	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined): void;

	popStagingSelections(numPops?: number): void;
	addNewStagingSelection(newSelection: StagingSelectionItem): void;

	dangerousSetState: (newState: ThreadsState) => void;
	resetState: () => void;

	// // current thread's staging selections
	// closeCurrentStagingSelectionsInMessage(opts: { messageIdx: number }): void;
	// closeCurrentStagingSelectionsInThread(): void;

	// codespan links (link to symbols in the markdown)
	getCodespanLink(opts: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined;
	addCodespanLink(opts: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }): void;
	generateCodespanLink(opts: { codespanStr: string, threadId: string }): Promise<CodespanLocationLink>;
	getRelativeStr(uri: URI): string | undefined

	// entry pts
	abortRunning(threadId: string): Promise<void>;
	dismissStreamError(threadId: string): void;

	// call to edit a message
	editUserMessageAndStreamResponse({ userMessage, messageIdx, threadId }: { userMessage: string, messageIdx: number, threadId: string }): Promise<void>;

	// call to add a message
	addUserMessageAndStreamResponse({ userMessage, threadId }: { userMessage: string, threadId: string }): Promise<void>;

	// approve/reject
	/** rememberForProject: also stop asking about this exact command (or MCP tool) in this project; never offered when the Policy Engine itself asked */
	approveLatestToolRequest(threadId: string, opts?: { rememberForProject?: boolean }): void;
	rejectLatestToolRequest(threadId: string): void;

	// projects, status and spending (Vader addition)
	/** the conversations under their project, the open project first */
	listProjectGroups(): ProjectGroup[];
	getCurrentProjectKey(): string | null;
	getThreadStatus(threadId: string): ThreadStatus;
	getThreadUsage(threadId: string): ThreadUsage | undefined;
	getUsageToday(): DayTotals;
	readonly onDidChangeUsage: Event<void>;

	// pause: the run holds at its next step (the next request or the next tool call) until resumed
	pauseRun(threadId: string): void;
	resumeRun(threadId: string): void;
	getPause(threadId: string): { reason: 'user' | 'budget' } | undefined;

	// "Allow in this project"
	canRememberForProject(threadId: string): boolean;
	listProjectApprovals(projectKey: string | null): { key: string; kind: 'command' | 'mcp'; label: string; addedAt: number }[];
	revokeProjectApproval(projectKey: string, key: string): void;
	readonly onDidChangeProjectApprovals: Event<void>;

	/** a comment on a line of the agent's change, sent to the agent as a message; false when there was nothing to send */
	addReviewComment(threadId: string, comment: ReviewComment): Promise<boolean>;

	// jump to history
	jumpToCheckpointBeforeMessageIdx(opts: { threadId: string, messageIdx: number, jumpToUserModified: boolean }): void;

	focusCurrentChat: () => Promise<void>
	blurCurrentChat: () => Promise<void>
}

export const IChatThreadService = createDecorator<IChatThreadService>('vaderChatThreadService');
const MAX_IDENTICAL_TOOL_CALLS_IN_A_ROW = 8

class ChatThreadService extends Disposable implements IChatThreadService {
	_serviceBrand: undefined;

	// this fires when the current thread changes at all (a switch of currentThread, or a message added to it, etc)
	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

	private readonly _onDidChangeStreamState = new Emitter<{ threadId: string }>();
	readonly onDidChangeStreamState: Event<{ threadId: string }> = this._onDidChangeStreamState.event;

	readonly streamState: ThreadStreamState = {}
	state: ThreadsState // allThreads is persisted, currentThread is not

	// used in checkpointing
	// private readonly _userModifiedFilesToCheckInCheckpoints = new LRUCache<string, null>(50)



	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IVaderModelService private readonly _vaderModelService: IVaderModelService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IVaderSettingsService private readonly _settingsService: IVaderSettingsService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@IEditCodeService private readonly _editCodeService: IEditCodeService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessagesService: IConvertToLLMMessageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IDirectoryStrService private readonly _directoryStringService: IDirectoryStrService,
		@IFileService private readonly _fileService: IFileService,
		@IMCPService private readonly _mcpService: IMCPService,
		@IPolicyService private readonly _policyService: IPolicyService,
		@IAgentsService private readonly _agentsService: IAgentsService,
		@IMemoryService private readonly _memoryService: IMemoryService,
		@IModelRouterService private readonly _modelRouterService: IModelRouterService,
		@IAgentRuntimeRegistryService private readonly _agentRuntimeRegistryService: IAgentRuntimeRegistryService,
		@IExternalAgentMainService private readonly _externalAgentMain: IExternalAgentMainService,
		@IExternalAgentsService private readonly _externalAgents: IExternalAgentsService,
		@IDialogService private readonly _dialogService: IDialogService,
	) {
		super()
		this.state = { allThreads: {}, currentThreadId: null as unknown as string } // default state

		const readThreads = this._readAllThreads() || {}

		const allThreads = readThreads
		this.state = {
			allThreads: allThreads,
			currentThreadId: null as unknown as string, // gets set in startNewThread()
		}

		this._ledger = this._readLedger()
		this._projectApprovals = this._readProjectApprovals()

		// always be in a thread
		this.openNewThread()


		// keep track of user-modified files
		// const disposablesOfModelId: { [modelId: string]: IDisposable[] } = {}
		// this._register(
		// 	this._modelService.onModelAdded(e => {
		// 		if (!(e.id in disposablesOfModelId)) disposablesOfModelId[e.id] = []
		// 		disposablesOfModelId[e.id].push(
		// 			e.onDidChangeContent(() => { this._userModifiedFilesToCheckInCheckpoints.set(e.uri.fsPath, null) })
		// 		)
		// 	})
		// )
		// this._register(this._modelService.onModelRemoved(e => {
		// 	if (!(e.id in disposablesOfModelId)) return
		// 	disposablesOfModelId[e.id].forEach(d => d.dispose())
		// }))

	}

	async focusCurrentChat() {
		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const s = await awaitMounted(thread.state.mountedInfo?.whenMounted)
		if (!this.isCurrentlyFocusingMessage()) {
			s?.textAreaRef.current?.focus()
		}
	}
	async blurCurrentChat() {
		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const s = await awaitMounted(thread.state.mountedInfo?.whenMounted)
		if (!this.isCurrentlyFocusingMessage()) {
			s?.textAreaRef.current?.blur()
		}
	}



	dangerousSetState = (newState: ThreadsState) => {
		this.state = newState
		this._onDidChangeCurrentThread.fire()
	}
	resetState = () => {
		this.state = { allThreads: {}, currentThreadId: null as unknown as string } // see constructor
		this.openNewThread()
		this._onDidChangeCurrentThread.fire()
	}

	// !!! this is important for properly restoring URIs from storage
	// should probably re-use code from src/vs/base/common/marshalling.ts instead. but this is simple enough
	private _convertThreadDataFromStorage(threadsStr: string): ChatThreads {
		return JSON.parse(threadsStr, (key, value) => {
			if (value && typeof value === 'object' && value.$mid === 1) { // $mid is the MarshalledId. $mid === 1 means it is a URI
				return URI.from(value); // TODO URI.revive instead of this?
			}
			return value;
		});
	}

	private _readAllThreads(): ChatThreads | null {
		const threadsStr = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION);
		if (!threadsStr) {
			return null
		}
		const threads = this._convertThreadDataFromStorage(threadsStr);

		return threads
	}

	private _storeAllThreads(threads: ChatThreads) {
		const serializedThreads = JSON.stringify(threads);
		this._storageService.store(
			THREAD_STORAGE_KEY,
			serializedThreads,
			StorageScope.APPLICATION,
			StorageTarget.USER
		);
	}


	// this should be the only place this.state = ... appears besides constructor
	private _setState(state: Partial<ThreadsState>, doNotRefreshMountInfo?: boolean) {
		const newState = {
			...this.state,
			...state
		}

		this.state = newState

		this._onDidChangeCurrentThread.fire()


		// if we just switched to a thread, update its current stream state if it's not streaming to possibly streaming
		const threadId = newState.currentThreadId
		const streamState = this.streamState[threadId]
		if (streamState?.isRunning === undefined && !streamState?.error) {

			// set streamState
			const messages = newState.allThreads[threadId]?.messages
			const lastMessage = messages && messages[messages.length - 1]
			// A request still waiting for approval when Vader was closed belongs to a run that no longer exists: approving it would not resume anything,
			// and until it was answered the thread could not take a new message. Close it as rejected so the thread opens ready to use.
			if (lastMessage && lastMessage.role === 'tool' && lastMessage.type === 'tool_request')
				this._updateLatestTool(threadId, { role: 'tool', type: 'rejected', content: lastMessage.content, id: lastMessage.id, rawParams: lastMessage.rawParams, result: null, name: lastMessage.name, params: lastMessage.params, mcpServerName: lastMessage.mcpServerName })

			// if running now but stream state doesn't indicate it (happens if restart Vader), cancel that last tool
			if (lastMessage && lastMessage.role === 'tool' && lastMessage.type === 'running_now') {

				this._updateLatestTool(threadId, { role: 'tool', type: 'rejected', content: lastMessage.content, id: lastMessage.id, rawParams: lastMessage.rawParams, result: null, name: lastMessage.name, params: lastMessage.params, mcpServerName: lastMessage.mcpServerName })
			}

		}


		// if we did not just set the state to true, set mount info
		if (doNotRefreshMountInfo) return

		let whenMountedResolver: (w: WhenMounted) => void
		const whenMountedPromise = new Promise<WhenMounted>((res) => whenMountedResolver = res)

		this._setThreadState(threadId, {
			mountedInfo: {
				whenMounted: whenMountedPromise,
				mountedIsResolvedRef: { current: false },
				_whenMountedResolver: (w: WhenMounted) => {
					whenMountedResolver(w)
					const mountInfo = this.state.allThreads[threadId]?.state.mountedInfo
					if (mountInfo) mountInfo.mountedIsResolvedRef.current = true
				},
			}
		}, true) // do not trigger an update



	}


	private _setStreamState(threadId: string, state: ThreadStreamState[string]) {
		this.streamState[threadId] = state
		this._onDidChangeStreamState.fire({ threadId })
	}

	// Vader addition: a plain method call (as opposed to a repeated inline property access)
	// so TS's control-flow narrowing from an earlier `isRunning === 'LLM'` check elsewhere in
	// the enclosing function doesn't incorrectly stick to this read after _setStreamState has
	// since changed it.
	private _currentIsRunning(threadId: string): IsRunningType {
		return this.streamState[threadId]?.isRunning
	}


	// ---------- streaming ----------



	private _currentModelSelectionProps = (threadId: string) => {
		// these settings should not change throughout the loop (eg anthropic breaks if you change its thinking mode and it's using tools)
		const featureName: FeatureName = 'Chat'
		let modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName]

		// Vader addition: a permanent agent running this thread can pin its own model
		const thread = this.state.allThreads[threadId]
		const agentId = thread?.agentId
		let agentPinnedModel = false
		if (agentId) {
			const agent = this._agentsService.getAgent(agentId)
			if (agent?.modelSelection) { modelSelection = agent.modelSelection; agentPinnedModel = true }
		}

		// Vader addition: a subagent thread with no agent-pinned model defers to the Model
		// Router - 'verification' category for a verification thread specifically (checked
		// first, since isVerificationThread implies isSubagentThread too), 'subagent'
		// otherwise - instead of always silently inheriting the Main Agent's Chat model. See
		// docs/integrations/model-router.md.
		if (!agentPinnedModel && thread?.isVerificationThread) {
			const routed = this._modelRouterService.resolveModel('verification')
			if (routed) modelSelection = routed
		}
		// Vader addition: a delegate_research_task/delegate_browser_task thread routes
		// through its matching category - checked before the generic isSubagentThread case,
		// since both of these are also subagent threads.
		else if (!agentPinnedModel && thread?.routerCategoryOverride) {
			const routed = this._modelRouterService.resolveModel(thread.routerCategoryOverride)
			if (routed) modelSelection = routed
		}
		else if (!agentPinnedModel && thread?.isSubagentThread) {
			const routed = this._modelRouterService.resolveModel('subagent')
			if (routed) modelSelection = routed
		}

		const modelSelectionOptions = modelSelection ? this._settingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName] : undefined
		return { modelSelection, modelSelectionOptions }
	}



	private _swapOutLatestStreamingToolWithResult = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
		const messages = this.state.allThreads[threadId]?.messages
		if (!messages) return false
		const lastMsg = messages[messages.length - 1]
		if (!lastMsg) return false

		// Vader fix. A model turn can contain several tool calls, each with its own thread message. Replacing "the
		// latest tool message" made each result overwrite its neighbour's, so only one of N calls survived in the thread
		// (found by a live run: the first call vanished and the history sent back to the provider had one call). Match
		// the message by tool-call id within the trailing run of tool messages; if this call has no message yet, it is
		// appended by the caller. Calls with no id keep the old "latest tool message" behaviour.
		if (tool.id) {
			for (let i = messages.length - 1; i >= 0; i--) {
				const m = messages[i]
				if (m.role !== 'tool') break
				if (m.type !== 'invalid_params' && m.id === tool.id) {
					this._editMessageInThread(threadId, i, tool)
					return true
				}
			}
			return false
		}
		if (lastMsg.role === 'tool' && lastMsg.type !== 'invalid_params') {
			this._editMessageInThread(threadId, messages.length - 1, tool)
			return true
		}
		return false
	}
	private _updateLatestTool = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
		const swapped = this._swapOutLatestStreamingToolWithResult(threadId, tool)
		if (swapped) return
		this._addMessageToThread(threadId, tool)
	}

	approveLatestToolRequest(threadId: string, opts?: { rememberForProject?: boolean }) {
		if (opts?.rememberForProject) this._rememberLatestRequestForProject(threadId)
		// A thread whose current tool_request came from _runToolCallInline (the normal case)
		// is waiting on this exact promise - resolving it lets @cline/agents' own AgentRuntime
		// resume the rest of its tool-call batch itself. See _runToolCallInline's doc comment.
		const pendingInline = this._pendingInlineApprovals.get(threadId)
		if (pendingInline) {
			this._pendingInlineApprovals.delete(threadId)
			pendingInline('approved')
			return
		}

		// No pending promise to resolve - Vader itself restarted while this approval was
		// outstanding (the in-memory Map above doesn't survive a process restart, but the
		// persisted tool_request message does). The AgentRuntime run that was waiting on it is
		// gone either way after a restart, so there is no batch left to "resume" - instead, run
		// the one pending tool call for real (already fully gated before the request was shown,
		// so this is preapproved, not re-evaluated) and then start a brand-new Cline turn - see
		// _resumeToolRequestAfterRestart.
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		const lastMsg = thread.messages[thread.messages.length - 1]
		if (!(lastMsg.role === 'tool' && lastMsg.type === 'tool_request')) return // should never happen

		const toolRequest: ToolMessage<ToolName> & { type: 'tool_request' } = lastMsg

		this._wrapRunAgentToNotify(
			this._resumeToolRequestAfterRestart(threadId, toolRequest)
			, threadId
		)
	}

	// Vader addition, part of removing the legacy runtime: the only remaining reason a pending
	// tool_request could ever be waiting with no live _pendingInlineApprovals entry is a Vader
	// restart (a real "crash recovery" case, not a normal approval). VaderAgentModel always
	// rebuilds its request from live thread messages on every run, so once this tool call is
	// recorded, a fresh Cline turn naturally continues the conversation from exactly this point
	// - there is no legacy loop to fall back into for this anymore.
	private async _resumeToolRequestAfterRestart(threadId: string, toolRequest: ToolMessage<ToolName> & { type: 'tool_request' }): Promise<void> {
		const { name: toolName, id: toolId, mcpServerName, rawParams: unvalidatedToolParams } = toolRequest
		// The user approved this request, but it was read back from disk (or from an imported chat), so what it says about itself is not trusted: the
		// parameters are validated again from their raw text and the hard rules that no approval overrides (policy deny, read-only mode, agent scope) run again.
		const hard = await this._hardRulesCheck(threadId, toolName, mcpServerName, unvalidatedToolParams)
		if (hard.kind !== 'ok') {
			this._updateLatestTool(threadId, hard.kind === 'invalid_params'
				? { role: 'tool', type: 'invalid_params', rawParams: unvalidatedToolParams, result: null, name: toolName, content: hard.content, id: toolId, mcpServerName }
				: { role: 'tool', type: 'rejected', result: null, name: toolName, params: hard.toolParams, id: toolId, rawParams: unvalidatedToolParams, mcpServerName, content: hard.content })
			this._setStreamState(threadId, undefined)
			this._addUserCheckpoint({ threadId })
			return
		}
		const execResult = await this._executeAndRecordToolCall(threadId, toolName, toolId, mcpServerName, unvalidatedToolParams, hard.toolParams)
		if ('interrupted' in execResult) {
			this._setStreamState(threadId, undefined)
			this._addUserCheckpoint({ threadId })
			return
		}
		await this._runChatAgent({ threadId, ...this._currentModelSelectionProps(threadId) })
	}
	rejectLatestToolRequest(threadId: string) {
		const pendingInline = this._pendingInlineApprovals.get(threadId)
		if (pendingInline) {
			this._pendingInlineApprovals.delete(threadId)
			pendingInline('rejected')
			return
		}

		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		const lastMsg = thread.messages[thread.messages.length - 1]

		let params: ToolCallParams<ToolName>
		if (lastMsg.role === 'tool' && lastMsg.type !== 'invalid_params') {
			params = lastMsg.params
		}
		else return

		const { name, id, rawParams, mcpServerName } = lastMsg

		const errorMessage = this.toolErrMsgs.rejected
		this._updateLatestTool(threadId, { role: 'tool', type: 'rejected', params: params, name: name, content: errorMessage, result: null, id, rawParams, mcpServerName })
		this._setStreamState(threadId, undefined)
	}

	private _computeMCPServerOfToolName = (toolName: string) => {
		return this._mcpService.getMCPTools()?.find(t => t.name === toolName)?.mcpServerName
	}

	// ---------- projects, status ----------

	private _currentWorkspaceFolders(): string[] {
		return this._workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath)
	}

	getCurrentProjectKey(): string | null {
		return projectKeyOf(this._currentWorkspaceFolders())
	}

	/** an empty thread that is reused belongs to the project that is open now */
	private _adoptCurrentProject(threadId: string) {
		const thread = this.state.allThreads[threadId]
		const folders = this._currentWorkspaceFolders()
		if (!thread || JSON.stringify(thread.projectFolders ?? []) === JSON.stringify(folders)) return
		const { projectFolders: _old, ...rest } = thread
		const updated: ThreadType = folders.length ? { ...rest, projectFolders: folders } : rest
		this._setState({ allThreads: { ...this.state.allThreads, [threadId]: updated } }, true)
	}

	listProjectGroups(): ProjectGroup[] {
		const threads = Object.values(this.state.allThreads).filter((t): t is ThreadType => !!t)
		return groupThreadsByProject(
			threads.map(t => ({ id: t.id, lastModified: t.lastModified, messageCount: t.messages.length, projectFolders: t.projectFolders, hidden: !!(t.isSubagentThread || t.isVerificationThread) })),
			this.getCurrentProjectKey(),
		)
	}

	getThreadStatus(threadId: string): ThreadStatus {
		const thread = this.state.allThreads[threadId]
		const stream = this.streamState[threadId]
		const messages = thread?.messages ?? []
		return deriveThreadStatus({
			isRunning: stream?.isRunning,
			isPaused: this._paused.has(threadId),
			hasError: !!stream?.error,
			endsWithToolRequest: endsWithToolRequest(messages),
			changedFilesSinceLastUserMessage: changedFilesSinceLastUserMessage(messages),
		})
	}

	// ---------- spending ----------

	private _ledger: UsageLedger = {}
	private _budgetWaivedDay: string | null = null
	private readonly _onDidChangeUsage = new Emitter<void>()
	readonly onDidChangeUsage: Event<void> = this._onDidChangeUsage.event

	private _readLedger(): UsageLedger {
		try { return parseLedger(JSON.parse(this._storageService.get(USAGE_LEDGER_STORAGE_KEY, StorageScope.APPLICATION) ?? 'null')) } catch { return {} }
	}

	getThreadUsage(threadId: string): ThreadUsage | undefined { return this.state.allThreads[threadId]?.usage }

	getUsageToday(): DayTotals {
		return this._ledger[dayKey(new Date())] ?? { costUsd: 0, billedCostUsd: 0, inputTokens: 0, outputTokens: 0, unpricedTurns: 0 }
	}

	/** called once per answer of the model: adds the turn to the thread and to today, priced with the model's list price (a local model is free; a cloud model with no known price is counted as unpriced, not as free) */
	private _recordTurnUsage(threadId: string, modelSelection: ModelSelection | null, usage: TokenUsage | undefined) {
		if (!modelSelection) return
		const caps = getModelCapabilities(modelSelection.providerName, modelSelection.modelName, this._settingsService.state.overridesOfModel)
		const isLocal = (localProviderNames as readonly string[]).includes(modelSelection.providerName)
		const g = this._settingsService.state.globalSettings
		const priced = usage ? priceTurn(usage, caps.cost, isLocal, modelSelection.modelName, { discountPercent: g.priceDiscountPercent, overrides: g.modelPriceOverrides }) : undefined
		const cost = priced?.costUsd
		const source = priced?.source
		const thread = this.state.allThreads[threadId]
		if (thread) {
			const newThreads = { ...this.state.allThreads, [threadId]: { ...thread, usage: addTurnToThreadUsage(thread.usage, usage, cost, source) } }
			this._storeAllThreads(newThreads)
			this._setState({ allThreads: newThreads }, true)
		}
		this._ledger = addToLedger(this._ledger, dayKey(new Date()), usage, cost, source)
		this._storageService.store(USAGE_LEDGER_STORAGE_KEY, JSON.stringify(this._ledger), StorageScope.APPLICATION, StorageTarget.USER)
		this._onDidChangeUsage.fire()
	}

	// ---------- pause ----------

	private readonly _paused = new Map<string, { reason: 'user' | 'budget', promise: Promise<'ok' | 'aborted'>, settle: (r: 'ok' | 'aborted') => void }>()

	private _pause(threadId: string, reason: 'user' | 'budget') {
		if (this._paused.has(threadId)) return
		let settle: (r: 'ok' | 'aborted') => void = () => { }
		const promise = new Promise<'ok' | 'aborted'>(res => { settle = res })
		this._paused.set(threadId, { reason, promise, settle })
		this._onDidChangeStreamState.fire({ threadId })
	}

	/** holds the run at its next step; a run that is not running has nothing to hold */
	pauseRun(threadId: string): void {
		if (this.streamState[threadId]?.isRunning === undefined) return
		this._pause(threadId, 'user')
	}

	resumeRun(threadId: string): void {
		const p = this._paused.get(threadId)
		if (!p) return
		// going on after the daily limit is the person's decision: it holds for the rest of that day
		if (p.reason === 'budget') this._budgetWaivedDay = dayKey(new Date())
		this._releasePause(threadId, 'ok')
	}

	private _releasePause(threadId: string, result: 'ok' | 'aborted') {
		const p = this._paused.get(threadId)
		if (!p) return
		this._paused.delete(threadId)
		p.settle(result)
		this._onDidChangeStreamState.fire({ threadId })
	}

	getPause(threadId: string): { reason: 'user' | 'budget' } | undefined {
		const p = this._paused.get(threadId)
		return p ? { reason: p.reason } : undefined
	}

	private async _waitIfPaused(threadId: string): Promise<'ok' | 'aborted'> {
		const p = this._paused.get(threadId)
		return p ? p.promise : 'ok'
	}

	/** before each request to the provider: over the daily limit the run pauses by itself and says why; otherwise it waits only if it was paused */
	private async _beforeLLMRequest(threadId: string): Promise<'ok' | 'aborted'> {
		const today = dayKey(new Date())
		const limit = this._settingsService.state.globalSettings.dailySpendLimitUsd
		if (budgetState(spentOn(this._ledger, today), limit) === 'over' && this._budgetWaivedDay !== today) this._pause(threadId, 'budget')
		return this._waitIfPaused(threadId)
	}

	// ---------- Allow in this project ----------

	private _projectApprovals: ProjectApprovalState = EMPTY_APPROVAL_STATE
	private readonly _onDidChangeProjectApprovals = new Emitter<void>()
	readonly onDidChangeProjectApprovals: Event<void> = this._onDidChangeProjectApprovals.event

	private _readProjectApprovals(): ProjectApprovalState {
		try { return parseApprovalState(JSON.parse(this._storageService.get(PROJECT_APPROVALS_STORAGE_KEY, StorageScope.APPLICATION) ?? 'null')) } catch { return EMPTY_APPROVAL_STATE }
	}

	private _writeProjectApprovals(next: ProjectApprovalState) {
		this._projectApprovals = next
		this._storageService.store(PROJECT_APPROVALS_STORAGE_KEY, JSON.stringify(next), StorageScope.APPLICATION, StorageTarget.USER)
		this._onDidChangeProjectApprovals.fire()
	}

	/** the project a thread works in: the folders it began with, else the folder that is open now (an older thread has none) */
	private _projectKeyOfThread(threadId: string): string | null {
		return projectKeyOf(this.state.allThreads[threadId]?.projectFolders) ?? this.getCurrentProjectKey()
	}

	/** only a command that is run, or an MCP tool, can be remembered; an edit never is */
	private _subjectOfToolCall(toolName: ToolName, params: unknown, mcpServerName: string | undefined): ApprovalSubject | null {
		if (toolName === 'run_command' || toolName === 'run_persistent_command') {
			const command = (params as { command?: unknown } | null)?.command
			return typeof command === 'string' ? { kind: 'command', command } : null
		}
		if (!isABuiltinToolName(toolName)) return mcpServerName ? { kind: 'mcp', server: mcpServerName, tool: toolName } : null
		return null
	}

	private _isApprovedForProject(threadId: string, toolName: ToolName, params: unknown, mcpServerName: string | undefined): boolean {
		const subject = this._subjectOfToolCall(toolName, params, mcpServerName)
		return !!subject && isApproved(this._projectApprovals, this._projectKeyOfThread(threadId), subject)
	}

	canRememberForProject(threadId: string): boolean {
		const last = findLast(this.state.allThreads[threadId]?.messages ?? [], m => m.role === 'tool' && m.type === 'tool_request')
		if (!last || last.role !== 'tool' || last.type !== 'tool_request') return false
		if (last.content.startsWith('(Vader policy requires approval')) return false // the Policy Engine asked: nothing may turn that off
		return !!this._projectKeyOfThread(threadId) && !!this._subjectOfToolCall(last.name, last.params, last.mcpServerName)
	}

	private _rememberLatestRequestForProject(threadId: string) {
		if (!this.canRememberForProject(threadId)) return
		const messages = this.state.allThreads[threadId]?.messages ?? []
		const last = messages[messages.length - 1]
		if (!last || last.role !== 'tool' || last.type !== 'tool_request') return
		const subject = this._subjectOfToolCall(last.name, last.params, last.mcpServerName)
		const next = subject ? withApproval(this._projectApprovals, this._projectKeyOfThread(threadId), subject, Date.now()) : null
		if (next && next !== this._projectApprovals) this._writeProjectApprovals(next)
	}

	listProjectApprovals(projectKey: string | null) { return listApprovals(this._projectApprovals, projectKey) }

	revokeProjectApproval(projectKey: string, key: string) {
		const next = withoutApproval(this._projectApprovals, projectKey, key)
		if (next !== this._projectApprovals) this._writeProjectApprovals(next)
	}

	// ---------- a comment on a line of the agent's change ----------

	async addReviewComment(threadId: string, comment: ReviewComment): Promise<boolean> {
		const userMessage = composeReviewComment(comment)
		if (!userMessage) return false
		await this.addUserMessageAndStreamResponse({ userMessage, threadId })
		return true
	}

	async abortRunning(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen
		this._bumpToolQueueEpoch(threadId) // tool calls of this turn that are still waiting for their turn must not start
		this._releasePause(threadId, 'aborted')

		// add assistant message
		if (this.streamState[threadId]?.isRunning === 'LLM') {
			const { displayContentSoFar, reasoningSoFar, toolCallSoFar } = this.streamState[threadId].llmInfo
			this._addMessageToThread(threadId, { role: 'assistant', displayContent: displayContentSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })
			if (toolCallSoFar) this._addMessageToThread(threadId, { role: 'interrupted_streaming_tool', name: toolCallSoFar.name, mcpServerName: this._computeMCPServerOfToolName(toolCallSoFar.name) })
		}
		// add tool that's running
		else if (this.streamState[threadId]?.isRunning === 'tool') {
			const { toolName, toolParams, id, content: content_, rawParams, mcpServerName } = this.streamState[threadId].toolInfo
			const content = content_ || this.toolErrMsgs.interrupted
			this._updateLatestTool(threadId, { role: 'tool', name: toolName, params: toolParams, id, content, rawParams, type: 'rejected', result: null, mcpServerName })
		}
		// reject the tool for the user if relevant
		else if (this.streamState[threadId]?.isRunning === 'awaiting_user') {
			this.rejectLatestToolRequest(threadId)
		}
		else if (this.streamState[threadId]?.isRunning === 'idle') {
			// do nothing
		}

		this._addUserCheckpoint({ threadId })

		// interrupt any effects
		const interrupt = await this.streamState[threadId]?.interrupt
		if (typeof interrupt === 'function')
			interrupt()


		this._setStreamState(threadId, undefined)
	}



	private readonly toolErrMsgs = {
		rejected: 'Tool call was rejected by the user.',
		interrupted: 'Tool call was interrupted by the user.',
		errWhenStringifying: (error: any) => `Tool call succeeded, but there was an error stringifying the output.\n${getErrorMessage(error)}`
	}


	// private readonly _currentlyRunningToolInterruptor: { [threadId: string]: (() => void) | undefined } = {}


	// Vader addition, part of the Cline Main Agent Runtime integration (see
	// docs/integrations/agent-runtime.md). The one non-bypassable gate sequence (validate ->
	// checkpoint -> agent-scope -> read-only-mode -> Policy Engine -> approval-type resolution)
	// every tool call goes through, used by _runToolCallInline below (used by
	// _resumeToolRequestAfterRestart's one-off preapproved re-execution too, via
	// _executeAndRecordToolCall directly). There is exactly one implementation of this gate.
	// The rules that no approval can override, as a pure check (it adds nothing to the thread): parameters valid, chat mode read-only rules, the running
	// agent's scope, the Policy Engine's hard "deny". Used by _evaluateToolCallGate before a call is shown to the user, and again by
	// _resumeToolRequestAfterRestart: a tool request that was saved to disk (or imported from a chat export) is not trusted just because it says it was
	// already checked.
	private _hardRulesCheck = async (
		threadId: string,
		toolName: ToolName,
		mcpServerName: string | undefined,
		unvalidatedToolParams: RawToolParamsObj,
		onValidated?: (toolParams: ToolCallParams<ToolName>) => void,
	): Promise<
		| { kind: 'invalid_params', content: string }
		| { kind: 'rejected', toolParams: ToolCallParams<ToolName>, content: string }
		| { kind: 'ok', toolParams: ToolCallParams<ToolName>, policyVerdict: ReturnType<IPolicyService['evaluate']> | { kind: 'allow' } }> => {

		const isBuiltInTool = isABuiltinToolName(toolName)
		let toolParams: ToolCallParams<ToolName>

		// 1. validate tool params
		try {
			if (isBuiltInTool) {
				toolParams = this._toolsService.validateParams[toolName](unvalidatedToolParams)
			}
			else {
				toolParams = unvalidatedToolParams
			}
		}
		catch (error) {
			return { kind: 'invalid_params', content: getErrorMessage(error) }
		}
		onValidated?.(toolParams)

		// 1.4. Permanent agent scope: if this thread is running as a permanent agent
		// (agents/agentsService.ts), its own restrictions apply on top of the global
		// policy, and are checked the same hard way (before approval, not advisory).
		const runningAgentId = this.state.allThreads[threadId]?.agentId
		const runningAgent = runningAgentId ? this._agentsService.getAgent(runningAgentId) : undefined
		if (runningAgent) {
			const approvalTypeForAgentCheck = isBuiltInTool ? approvalTypeOfBuiltinToolName[toolName] : 'MCP tools'
			const blockedReason =
				runningAgent.deniedToolNames.includes(toolName) ? `Agent "${runningAgent.name}" is not permitted to use ${toolName}.`
					: approvalTypeForAgentCheck && !runningAgent.allowedApprovalTypes.includes(approvalTypeForAgentCheck) ? `Agent "${runningAgent.name}" is not permitted to perform ${approvalTypeForAgentCheck} actions.`
						: !isBuiltInTool && runningAgent.mcpServerNames && mcpServerName && !runningAgent.mcpServerNames.includes(mcpServerName) ? `Agent "${runningAgent.name}" is not permitted to use MCP server "${mcpServerName}".`
							: null
			if (blockedReason) {
				return { kind: 'rejected', toolParams, content: `Blocked by agent scope: ${blockedReason}` }
			}
		}

		// 1.45. Read-only chat mode enforcement (Gather/Plan): hard, unconditional -
		// see READONLY_MODE_BLOCKED_BUILTIN_TOOLS above for why each tool is listed and
		// docs/integrations/plan-mode.md for the audit finding this fixes.
		const currentChatMode = this._settingsService.state.globalSettings.chatMode
		const isVerificationThread = !!this.state.allThreads[threadId]?.isVerificationThread
		const isResearchThread = this.state.allThreads[threadId]?.routerCategoryOverride === 'research'
		if (currentChatMode === 'gather' || currentChatMode === 'plan' || isVerificationThread || isResearchThread) {
			const blockedInReadonlyMode = !isBuiltInTool || READONLY_MODE_BLOCKED_BUILTIN_TOOLS.has(toolName as BuiltinToolName)
			if (blockedInReadonlyMode) {
				const modeLabel = isVerificationThread ? 'Verification' : isResearchThread ? 'Research' : currentChatMode === 'plan' ? 'Plan' : 'Gather'
				return { kind: 'rejected', toolParams, content: `Blocked: ${modeLabel} is read-only - this tool could modify the project or run something with side effects.${isVerificationThread ? ' An independent verifier must never be able to change what it is checking.' : isResearchThread ? ' A research delegation must never be able to make changes.' : ' Switch to Agent mode to actually make this change.'}` }
			}
		}

		// 1.5. Policy Engine: a hard, pre-execution gate that runs regardless of what the
		// model was told, and regardless of the user's auto-approve settings. A 'deny'
		// verdict blocks the call outright (no approval prompt to bypass); an 'ask'
		// verdict forces an approval prompt even if this tool category is auto-approved.
		let policyReq = policyRequestOfToolCall(toolName, toolParams, isBuiltInTool, mcpServerName, runningAgentId ?? undefined)
		// A path can reach a protected file through a symbolic link (`docs/credentials` where `docs` links to ~/.aws), so the rules and the
		// agent scope see the path as written AND where it really points (realPaths.ts).
		const realpathOf = (u: URI) => this._fileService.realpath(u)
		if (policyReq?.filePaths) { policyReq = { ...policyReq, filePaths: await withResolvedPaths(realpathOf, policyReq.filePaths) } }
		if (runningAgent && policyReq?.filePaths) {
			const roots = this._workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath)
			const scopeVerdict = agentScopeVerdict(runningAgent, policyReq.filePaths, await withResolvedPaths(realpathOf, roots))
			if (scopeVerdict.kind === 'deny') {
				return { kind: 'rejected', toolParams, content: `Blocked by agent scope: ${scopeVerdict.reason}` }
			}
		}
		const policyVerdict = policyReq ? this._policyService.evaluate(policyReq) : { kind: 'allow' as const }
		if (policyVerdict.kind === 'deny') {
			return { kind: 'rejected', toolParams, content: `Blocked by Vader policy (${policyVerdict.ruleId}): ${policyVerdict.reason}` }
		}
		return { kind: 'ok', toolParams, policyVerdict }
	}

	private _evaluateToolCallGate = async (
		threadId: string,
		toolName: ToolName,
		toolId: string,
		mcpServerName: string | undefined,
		unvalidatedToolParams: RawToolParamsObj,
	): Promise<
		| { kind: 'invalid_params' }
		| { kind: 'rejected', validatedParams: ToolCallParams<ToolName> }
		| { kind: 'needs_approval', validatedParams: ToolCallParams<ToolName> }
		| { kind: 'approved', validatedParams: ToolCallParams<ToolName> }> => {

		const isBuiltInTool = isABuiltinToolName(toolName)

		const hard = await this._hardRulesCheck(threadId, toolName, mcpServerName, unvalidatedToolParams, (validated) => {
			// once validated, add checkpoint for edit
			if (toolName === 'edit_file') { this._addToolEditCheckpoint({ threadId, uri: (validated as BuiltinToolCallParams['edit_file']).uri }) }
			if (toolName === 'rewrite_file') { this._addToolEditCheckpoint({ threadId, uri: (validated as BuiltinToolCallParams['rewrite_file']).uri }) }
		})
		if (hard.kind === 'invalid_params') {
			this._addMessageToThread(threadId, { role: 'tool', type: 'invalid_params', rawParams: unvalidatedToolParams, result: null, name: toolName, content: hard.content, id: toolId, mcpServerName })
			return { kind: 'invalid_params' }
		}
		const toolParams = hard.toolParams
		if (hard.kind === 'rejected') {
			this._addMessageToThread(threadId, { role: 'tool', type: 'rejected', result: null, name: toolName, params: toolParams, id: toolId, rawParams: unvalidatedToolParams, mcpServerName, content: hard.content })
			return { kind: 'rejected', validatedParams: toolParams }
		}
		const policyVerdict = hard.policyVerdict

		// 2. if tool requires approval, the caller decides how to wait (return early vs await inline)

		const approvalType = isBuiltInTool ? approvalTypeOfBuiltinToolName[toolName] : 'MCP tools'
		const policyForcesAsk = policyVerdict.kind === 'ask'
		if (approvalType || policyForcesAsk) {
			// A subagent thread (delegate_subagent_task) has no human present to click
			// approve, so it auto-approves the ordinary tool-category gate on its own
			// thread only - never the user's global setting, and never a policy 'ask'
			// verdict, which still stalls it exactly like it would a human-driven thread.
			const isSubagentThread = !!this.state.allThreads[threadId]?.isSubagentThread
			const autoApprove = !policyForcesAsk && approvalType ? (isSubagentThread || this._settingsService.state.globalSettings.autoApprove[approvalType] || this._isApprovedForProject(threadId, toolName, toolParams, mcpServerName)) : false
			// add a tool_request because we use it for UI if a tool is loading (this should be improved in the future)
			const requestContent = policyForcesAsk ? `(Vader policy requires approval: ${policyVerdict.reason})` : '(Awaiting user permission...)'
			this._addMessageToThread(threadId, { role: 'tool', type: 'tool_request', content: requestContent, result: null, name: toolName, params: toolParams, id: toolId, rawParams: unvalidatedToolParams, mcpServerName })
			if (!autoApprove) {
				return { kind: 'needs_approval', validatedParams: toolParams }
			}
		}

		return { kind: 'approved', validatedParams: toolParams }
	}

	// Vader addition: calls the tool, stringifies the result, and records it to thread history,
	// once the gate above has approved a call. Returns the actual result string, since Cline's
	// tool.execute() must return one - used by _runToolCallInline for an ordinary approved call
	// and by _resumeToolRequestAfterRestart for a preapproved one-off re-execution after a
	// restart.
	private _executeAndRecordToolCall = async (
		threadId: string,
		toolName: ToolName,
		toolId: string,
		mcpServerName: string | undefined,
		unvalidatedToolParams: RawToolParamsObj,
		toolParams: ToolCallParams<ToolName>,
	): Promise<{ resultStr: string, isError: boolean } | { interrupted: true }> => {

		const isBuiltInTool = isABuiltinToolName(toolName)
		let toolResult: ToolResult<ToolName>
		let toolResultStr: string

		// 3. call the tool
		const runningTool = { role: 'tool', type: 'running_now', name: toolName, params: toolParams, content: '(value not received yet...)', result: null, id: toolId, rawParams: unvalidatedToolParams, mcpServerName } as const
		this._updateLatestTool(threadId, runningTool)

		let interrupted = false
		let resolveInterruptor: (r: () => void) => void = () => { }
		const interruptorPromise = new Promise<() => void>(res => { resolveInterruptor = res })
		try {

			// set stream state
			this._setStreamState(threadId, { isRunning: 'tool', interrupt: interruptorPromise, toolInfo: { toolName, toolParams, id: toolId, content: 'interrupted...', rawParams: unvalidatedToolParams, mcpServerName } })

			if (isBuiltInTool) {
				const { result, interruptTool } = await this._toolsService.callTool[toolName](toolParams as any)
				const interruptor = () => { interrupted = true; interruptTool?.() }
				resolveInterruptor(interruptor)

				toolResult = await result
			}
			else {
				const mcpTools = this._mcpService.getMCPTools()
				const mcpTool = mcpTools?.find(t => t.name === toolName)
				if (!mcpTool) { throw new Error(`MCP tool ${toolName} not found`) }

				resolveInterruptor(() => { })

				toolResult = (await this._mcpService.callMCPTool({
					serverName: mcpTool.mcpServerName ?? 'unknown_mcp_server',
					toolName: toolName,
					params: toolParams
				})).result
			}

			if (interrupted) { return { interrupted: true } } // the tool result is added where we interrupt, not here
		}
		catch (error) {
			resolveInterruptor(() => { }) // resolve for the sake of it
			if (interrupted) { return { interrupted: true } } // the tool result is added where we interrupt, not here

			const errorMessage = getErrorMessage(error)
			this._updateLatestTool(threadId, { role: 'tool', type: 'tool_error', params: toolParams, result: errorMessage, name: toolName, content: errorMessage, id: toolId, rawParams: unvalidatedToolParams, mcpServerName })
			return { resultStr: errorMessage, isError: true }
		}

		// 4. stringify the result to give to the LLM
		try {
			if (isBuiltInTool) {
				toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any)
			}
			// For MCP tools, handle the result based on its type
			else {
				toolResultStr = this._mcpService.stringifyResult(toolResult as RawMCPToolCall)
			}
		} catch (error) {
			const errorMessage = this.toolErrMsgs.errWhenStringifying(error)
			this._updateLatestTool(threadId, { role: 'tool', type: 'tool_error', params: toolParams, result: errorMessage, name: toolName, content: errorMessage, id: toolId, rawParams: unvalidatedToolParams, mcpServerName })
			return { resultStr: errorMessage, isError: true }
		}

		// 5. add to history and keep going
		this._updateLatestTool(threadId, { role: 'tool', type: 'success', params: toolParams, result: toolResult, name: toolName, content: toolResultStr, id: toolId, rawParams: unvalidatedToolParams, mcpServerName })
		return { resultStr: toolResultStr, isError: false }
	}

	// Vader addition: the tool-execute callback @cline/agents' AgentRuntime calls for every
	// tool call it decides to make (see clineToolAdapter.ts's buildClineTools). Runs the gate
	// above and, instead of returning early on 'needs_approval', awaits a promise that resolves
	// when the user approves/rejects via the ordinary approve/reject UI (see
	// approveLatestToolRequest/rejectLatestToolRequest's _pendingInlineApprovals check) -
	// because this await happens inside one call that AgentRuntime is itself awaiting as part
	// of a tool-call batch, the remaining calls in that same batch are never lost: AgentRuntime
	// resumes them itself once this promise settles. This is the concrete fix for the
	// previously-documented limitation ("a multi-tool-call turn interrupted mid-batch for
	// approval does not resume the rest of that batch after approval").
	private _pendingInlineApprovals = new Map<string, (decision: 'approved' | 'rejected') => void>();

	// Vader fix. @cline/agents may call execute() for every tool call of a model turn at the same moment. Everything below
	// assumes one tool call at a time per thread: a single approval resolver (a second concurrent approval overwrote the
	// first, whose promise then never settled - the thread hung forever), a single stream state, and thread messages
	// that are updated in place. Calls of one thread therefore run strictly one after another, in the order the model
	// emitted them (which is also the only order that is safe for edits to the same file or for terminal commands).
	// Stopping the agent or deleting the thread bumps the epoch so calls still waiting their turn are dropped.
	private readonly _toolQueueTail = new Map<string, Promise<void>>()
	private readonly _toolQueueEpoch = new Map<string, number>()
	private _bumpToolQueueEpoch(threadId: string) { this._toolQueueEpoch.set(threadId, (this._toolQueueEpoch.get(threadId) ?? 0) + 1) }

	private _runToolCallInline = (
		threadId: string,
		toolName: ToolName,
		toolId: string,
		mcpServerName: string | undefined,
		unvalidatedToolParams: RawToolParamsObj,
	): Promise<{ resultStr: string, isError: boolean }> => {
		const epoch = this._toolQueueEpoch.get(threadId) ?? 0
		const previous = this._toolQueueTail.get(threadId) ?? Promise.resolve()
		const run = previous.then(async () => {
			if ((this._toolQueueEpoch.get(threadId) ?? 0) !== epoch) {
				return { resultStr: this.toolErrMsgs.interrupted, isError: true }
			}
			return this._runToolCallInlineNow(threadId, toolName, toolId, mcpServerName, unvalidatedToolParams)
		})
		this._toolQueueTail.set(threadId, run.then(() => undefined, () => undefined))
		return run
	}

	private _runToolCallInlineNow = async (
		threadId: string,
		toolName: ToolName,
		toolId: string,
		mcpServerName: string | undefined,
		unvalidatedToolParams: RawToolParamsObj,
	): Promise<{ resultStr: string, isError: boolean }> => {

		if (await this._waitIfPaused(threadId) === 'aborted') return { resultStr: this.toolErrMsgs.interrupted, isError: true }

		const gateResult = await this._evaluateToolCallGate(threadId, toolName, toolId, mcpServerName, unvalidatedToolParams)

		if (gateResult.kind === 'invalid_params') {
			return { resultStr: 'Tool call had invalid parameters and was not executed.', isError: true }
		}
		if (gateResult.kind === 'rejected') {
			return { resultStr: 'Tool call was blocked by Vader policy/scope and was not executed.', isError: true }
		}

		const toolParams = gateResult.validatedParams
		if (gateResult.kind === 'needs_approval') {
			this._setStreamState(threadId, { isRunning: 'awaiting_user' })
			const decision = await new Promise<'approved' | 'rejected'>(resolve => {
				this._pendingInlineApprovals.set(threadId, resolve)
			})
			if (decision === 'rejected') {
				this._updateLatestTool(threadId, { role: 'tool', type: 'rejected', params: toolParams, result: null, name: toolName, content: this.toolErrMsgs.rejected, id: toolId, rawParams: unvalidatedToolParams, mcpServerName })
				this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' })
				return { resultStr: this.toolErrMsgs.rejected, isError: true }
			}
			this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' })
		}

		const execResult = await this._executeAndRecordToolCall(threadId, toolName, toolId, mcpServerName, unvalidatedToolParams, toolParams)
		if ('interrupted' in execResult) return { resultStr: this.toolErrMsgs.interrupted, isError: true }
		return execResult
	}




	// Vader addition: structured context compaction. Vader's original safety net for context
	// overflow is convertToLLMMessageService.ts's prepareMessages, which blindly truncates
	// the largest individual message's raw content when the final assembled request would
	// still be too big - a real, still-present last resort, but one that discards whatever
	// it cuts with no structure and no way back. This runs earlier, with a safety margin,
	// and replaces older messages with a structured summary instead - see
	// contextCompaction_systemMessage in prompts.ts for exactly what it preserves.
	// When to prune old tool output and when to summarise is decided in common/contextBudget.ts (one yardstick shared with that blind cut, measured on what is really sent).
	private static readonly COMPACTION_TAIL_MESSAGES_TO_KEEP = 6 // always keep the most recent messages in full, uncompacted
	private static readonly COMPACTION_MIN_MESSAGES_TO_COMPACT = 6 // not worth an LLM call to compact a handful of short messages

	/** Characters a message adds to the request the model receives (what contextBudget measures), not what is shown in the chat. */
	private _sizeOfMessageForRequest(m: ChatMessage): SizedMessage {
		if (m.role === 'user') return { role: 'user', size: m.content.length }
		if (m.role === 'assistant') return { role: 'assistant', size: m.displayContent.length }
		if (m.role === 'tool') {
			if (m.outputPruned) return { role: 'tool', size: prunedOutputNote(m.name, m.content.length).length }
			return { role: 'tool', size: m.content.length, prunable: m.type === 'success' && m.name !== 'update_task_list', toolName: m.name } // the task list is small and is the model's own plan: it stays
		}
		if (m.role === 'compacted_summary') return { role: 'compacted_summary', size: Object.values(m.summary).join('\n').length }
		return { role: m.role, size: 0 }
	}

	private _renderMessageForCompaction(m: ChatMessage): string {
		if (m.role === 'user') return `USER: ${m.displayContent || m.content}`
		if (m.role === 'assistant') return `ASSISTANT: ${m.displayContent}`
		if (m.role === 'tool') {
			if (m.type === 'success') return `TOOL[${m.name}]: ${truncate(m.content, 2000)}`
			if (m.type === 'tool_error') return `TOOL[${m.name}] ERROR: ${m.content}`
			if (m.type === 'rejected') return `TOOL[${m.name}] REJECTED: ${m.content}`
			return ''
		}
		return '' // checkpoint / interrupted_streaming_tool / compacted_summary don't contribute raw content
	}

	private _parseCompactionTags(text: string): CompactedSummaryEntry['summary'] {
		const extract = (tag: string): string => {
			const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
			return m ? m[1].trim() : '(not extracted)'
		}
		return {
			objective: extract('objective'),
			constraints: extract('constraints'),
			decisions: extract('decisions'),
			architectureNotes: extract('architecture_notes'),
			filesModified: extract('files_modified'),
			importantLocations: extract('important_locations'),
			unresolvedProblems: extract('unresolved_problems'),
			testResults: extract('test_results'),
			nextSteps: extract('next_steps'),
		}
	}

	private _sendCompactionRequest(conversationText: string, modelSelection: ModelSelection): Promise<string> {
		return new Promise((resolve, reject) => {
			const { messages, separateSystemMessage } = this._convertToLLMMessagesService.prepareLLMSimpleMessages({
				simpleMessages: [{ role: 'user', content: contextCompaction_userMessage(conversationText) }],
				systemMessage: contextCompaction_systemMessage,
				modelSelection,
				// there's no dedicated Settings-configurable "Summarization" feature (see
				// vaderSettingsTypes.ts's featureNames) - reuse 'Chat' purely for
				// optionsOfModelSelection lookup (reasoning slider, etc); which *model* gets
				// used is already decided by the Model Router before this is called.
				featureName: 'Chat',
			})
			this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				chatMode: null,
				messages,
				modelSelection,
				modelSelectionOptions: undefined,
				overridesOfModel: this._settingsService.state.overridesOfModel,
				logging: { loggingName: 'Vader - Context Compaction' },
				separateSystemMessage,
				onText: () => { },
				onFinalMessage: ({ fullText }) => resolve(fullText),
				onError: (error) => reject(error),
				onAbort: () => reject(new Error('Compaction request was aborted')),
			})
		})
	}

	private async _maybeCompactThread(threadId: string, modelSelection: ModelSelection | null): Promise<void> {
		if (!modelSelection) return
		let thread = this.state.allThreads[threadId]
		if (!thread) return

		const { overridesOfModel } = this._settingsService.state
		const { contextWindow, reservedOutputTokenSpace } = getModelCapabilities(modelSelection.providerName, modelSelection.modelName, overridesOfModel)

		// step 1, no model call: replace the output of old tool calls by a note (the chat keeps showing the full result)
		const plan = planContextReduction(thread.messages.map(m => this._sizeOfMessageForRequest(m)), { contextWindow, reservedOutputTokenSpace })
		if (plan.pruneIndexes.length > 0) {
			const toPrune = new Set(plan.pruneIndexes)
			const prunedThread = { ...thread, messages: thread.messages.map((m, i) => (toPrune.has(i) && m.role === 'tool') ? { ...m, outputPruned: true } : m) }
			const prunedThreads = { ...this.state.allThreads, [threadId]: prunedThread }
			this._storeAllThreads(prunedThreads)
			this._setState({ allThreads: prunedThreads })
			thread = prunedThread
		}
		if (!plan.summarise) return // plenty of room left - the common case, checked cheaply every turn

		// step 2: a structured summary of the older messages
		const lastSummaryIdx = findLastIdx(thread.messages, m => m.role === 'compacted_summary') ?? -1
		const compactableRange = thread.messages.slice(lastSummaryIdx + 1)
		if (compactableRange.length <= ChatThreadService.COMPACTION_TAIL_MESSAGES_TO_KEEP + ChatThreadService.COMPACTION_MIN_MESSAGES_TO_COMPACT) return

		const toCompact = compactableRange.slice(0, compactableRange.length - ChatThreadService.COMPACTION_TAIL_MESSAGES_TO_KEEP)
		if (toCompact.length < ChatThreadService.COMPACTION_MIN_MESSAGES_TO_COMPACT) return

		const conversationText = toCompact.map(m => this._renderMessageForCompaction(m)).filter(Boolean).join('\n\n')
		if (!conversationText.trim()) return

		// Vader addition: route the summarization call itself through the Model Router's
		// 'summarization' category (favors cheap/configured models - see
		// modelRouterService.ts's scoreForCategory) rather than always reusing the thread's
		// own Chat model, falling back to it if the router has nothing better configured.
		const compactionModelSelection = this._modelRouterService.resolveModel('summarization') ?? modelSelection

		let summaryText: string
		try {
			summaryText = await this._sendCompactionRequest(conversationText, compactionModelSelection)
		} catch {
			// compaction is a best-effort optimization, never load-bearing - if the
			// summarization call itself fails, do nothing this round. Vader's original
			// per-message truncation (prepareMessages, convertToLLMMessageService.ts) is
			// still the final safety net if the raw context genuinely overflows.
			return
		}

		const summary = this._parseCompactionTags(summaryText)
		const compactedAt = new Date().toISOString()

		// archive the raw messages being replaced - moved out of the live context sent to
		// the model, never destroyed - see common/memory/ ('compactionArchive' scope)
		this._memoryService.write({
			scope: 'compactionArchive',
			scopeKey: threadId,
			label: `Compacted ${toCompact.length} messages at ${compactedAt}`,
			content: JSON.stringify(toCompact),
			source: 'compaction',
		})

		const summaryEntry: CompactedSummaryEntry = { role: 'compacted_summary', originalMessageCount: toCompact.length, compactedAt, summary }
		const beforeRange = thread.messages.slice(0, lastSummaryIdx + 1)
		const preservedTail = compactableRange.slice(toCompact.length)
		const newMessages: ChatMessage[] = [...beforeRange, summaryEntry, ...preservedTail]

		const { allThreads } = this.state
		const newThreads = {
			...allThreads,
			[threadId]: { ...thread, messages: newMessages, lastModified: new Date().toISOString() },
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads })
	}

	// Vader addition: Plan Mode's plan capture. Parses a <vader_plan> block (see
	// contextCompaction-style tag extraction; prompts.ts's planMode_instructions for the
	// exact tags asked for) out of an assistant message and stores it as the thread's
	// activePlan - structured fields, not the raw prose, so "Approve & Execute" hands the
	// agent something it doesn't have to re-derive by re-reading the whole plan message.
	private _maybeCaptureThreadPlan(threadId: string, assistantText: string): void {
		const blockMatch = assistantText.match(/<vader_plan>([\s\S]*?)<\/vader_plan>/i)
		if (!blockMatch) return
		const block = blockMatch[1]

		const extract = (tag: string): string => {
			const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
			return m ? m[1].trim() : ''
		}
		const extractList = (tag: string): string[] => extract(tag)
			.split('\n')
			.map(line => line.replace(/^[-*\d.)\s]+/, '').trim())
			.filter(Boolean)

		const plan: PlanObject = {
			objective: extract('objective'),
			phases: extractList('phases'),
			filesOrSubsystems: extractList('files_or_subsystems'),
			constraints: extract('constraints'),
			validationRequirements: extract('validation_requirements'),
			unresolvedAssumptions: extract('unresolved_assumptions'),
		}
		// nothing meaningful parsed (e.g. the model echoed the tag names without content) -
		// don't clobber a previously-captured real plan with an empty one
		if (!plan.objective && plan.phases.length === 0) return

		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const newThreads = { ...this.state.allThreads, [threadId]: { ...thread, activePlan: plan } }
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads })
	}

	clearThreadPlan(threadId: string): void {
		const thread = this.state.allThreads[threadId]
		if (!thread || !thread.activePlan) return
		const newThreads = { ...this.state.allThreads, [threadId]: { ...thread, activePlan: null } }
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads })
	}

	// Vader addition, part of the Cline Main Agent Runtime integration (see
	// docs/integrations/agent-runtime.md). Cline is Vader's one and only Main Agent runtime -
	// there is no other loop to dispatch to or fall back on. Every call site
	// (_addUserMessageAndStreamResponse, editUserMessageAndStreamResponse, runSubagentTask,
	// runVerificationTask, _resumeToolRequestAfterRestart) goes through this single entry
	// point. A genuine per-task error (a provider error, a tool throwing, an unexpected runtime
	// exception) is surfaced as a clear, ordinary stream error on that thread - it is never
	// swallowed into a silent retry through a different runtime, because none exists.
	private _runChatAgent = async (opts: {
		threadId: string,
		modelSelection: ModelSelection | null,
		modelSelectionOptions: ModelSelectionOptions | undefined,
	}): Promise<void> => {
		try {
			await this._runChatAgentImpl(opts.threadId, opts.modelSelection, opts.modelSelectionOptions)
		} catch (error) {
			const errorMessage = getErrorMessage(error)
			this._addUserCheckpoint({ threadId: opts.threadId })
			this._setStreamState(opts.threadId, { isRunning: undefined, error: { message: errorMessage, fullError: error instanceof Error ? error : null } })
		}
	}

	// A model name Vader does not recognise is first offered native tool calling (common/modelCapabilities.ts). When the server refuses the tools, remember that for this model
	// (an override that reads as "no native tools", so the prompt describes the tools as XML from now on) and say that the request may be sent again. Only for a model that was
	// never configured by hand, and only for a message that is really about tools being unsupported (common/toolSupport.ts).
	private async _fallBackToXmlTools(modelSelection: ModelSelection | null, errorMessage: string): Promise<boolean> {
		if (!modelSelection) { return false }
		const { providerName, modelName } = modelSelection
		const { overridesOfModel } = this._settingsService.state
		const caps = getModelCapabilities(providerName, modelName, overridesOfModel)
		if (!caps.isUnrecognizedModel || !caps.specialToolFormat) { return false }
		if (overridesOfModel[providerName]?.[modelName]?.specialToolFormat !== undefined) { return false } // the person (or an earlier fallback) already decided
		if (!looksLikeToolsRejected(errorMessage)) { return false }
		await this._settingsService.setOverridesOfModel(providerName, modelName, { specialToolFormat: null })
		return true
	}

	// Vader addition: drives one Main Agent turn through @cline/agents' AgentRuntime. See
	// vaderAgentModel.ts/clineToolAdapter.ts/clineRuntimeAdapter.ts for the three pieces this
	// assembles, and docs/integrations/agent-runtime.md for the full design this implements.
	private async _runChatAgentImpl(threadId: string, modelSelection: ModelSelection | null, modelSelectionOptions: ModelSelectionOptions | undefined): Promise<void> {
		// Vader addition: when the person chose an external coding agent (Settings > Models), their chat turns go to that agent and not to a Vader model.
		// The hidden threads Vader starts for itself (sub-agents, verification, research) keep using the configured models.
		const externalAgentId = this._settingsService.state.globalSettings.externalAgentId
		const thisThread = this.state.allThreads[threadId]
		if (externalAgentId && !thisThread?.isSubagentThread && !thisThread?.isVerificationThread && !thisThread?.routerCategoryOverride) {
			return this._runExternalAgentTurn(threadId, externalAgentId)
		}

		// Fail fast and clearly if Cline itself can't even initialize, rather than letting a
		// deep, possibly confusing construction error surface from inside createClineAgentRuntime.
		// There is no other runtime to fall back to, so this is the whole story.
		const health = this._agentRuntimeRegistryService.getHealth()
		if (health.status !== 'initialized') {
			throw new Error(`Cline Agent Runtime is not available (${health.status}): ${health.detail}`)
		}

		const isVerificationThread = !!this.state.allThreads[threadId]?.isVerificationThread
		const isResearchThread = this.state.allThreads[threadId]?.routerCategoryOverride === 'research'
		const { chatMode: globalChatMode } = this._settingsService.state.globalSettings
		const chatMode = (isVerificationThread || isResearchThread) ? 'gather' : globalChatMode
		const agentId = this.state.allThreads[threadId]?.agentId

		const mcpTools = this._mcpService.getMCPTools()
		const tools = buildClineTools({
			chatMode,
			mcpTools,
			computeMCPServerOfToolName: this._computeMCPServerOfToolName,
			runToolCallInline: (toolName, toolId, mcpServerName, params) => this._runToolCallInline(threadId, toolName, toolId, mcpServerName, params),
		})

		const model = new VaderAgentModel(this._llmMessageService, this._convertToLLMMessagesService, {
			getThreadMessages: () => this.state.allThreads[threadId]?.messages ?? [],
			maybeCompactThread: () => this._maybeCompactThread(threadId, modelSelection),
			chatMode,
			agentId,
			modelSelection,
			modelSelectionOptions,
			overridesOfModel: this._settingsService.state.overridesOfModel,
			getOverridesOfModel: () => this._settingsService.state.overridesOfModel,
			onNativeToolsRejected: (errorMessage) => this._fallBackToXmlTools(modelSelection, errorMessage),
			beforeRequest: () => this._beforeLLMRequest(threadId),
			onTurnUsage: (usage) => this._recordTurnUsage(threadId, modelSelection, usage),
			loggingName: `Chat - ${chatMode} (Cline)`,
		})

		const runtime = createClineAgentRuntime({ model, tools })

		let textSoFar = ''
		let reasoningSoFar = ''
		// Loop guard: a model that makes the very same call (same tool, same arguments) many times in a row is stuck, and every further turn costs the
		// user tokens for nothing. The runtime's own iteration cap only trips after dozens of turns.
		let lastCallKey = ''
		let identicalCallsInARow = 0
		// ...and the second guard: a loop that alternates between a few calls never repeats the same call twice in a row (common/loopDetection.ts)
		const repeatedCalls = new RepeatedCallDetector()
		// ...and the third: text that repeats itself (a small model chanting one sentence, in its answer or its reasoning) makes no tool call at all
		const textLoop = new TextRepetitionDetector()
		const reasoningLoop = new TextRepetitionDetector()
		const stopForRepeatedText = (where: 'answer' | 'reasoning', sample: string | undefined) => {
			if (loopStopMessage) { return }
			loopStopMessage = `The model kept repeating the same text in its ${where}${sample ? ` ("${sample.slice(0, 60)}")` : ''}, so Vader stopped the run instead of spending more tokens. Rephrase the request, or pick a different model.`
			runtime.abort()
		}
		let loopStopMessage: string | undefined
		let lastTurnWasEmpty: { hadReasoning: boolean } | null = null
		const unsubscribe = runtime.subscribe((event) => {
			if (event.type === 'tool-started') {
				const key = event.toolCall.toolName + '\u0000' + JSON.stringify(event.toolCall.input ?? {})
				identicalCallsInARow = key === lastCallKey ? identicalCallsInARow + 1 : 1
				lastCallKey = key
				const cycle = repeatedCalls.push(event.toolCall.toolName, event.toolCall.input)
				if (cycle.stuck && !loopStopMessage) {
					loopStopMessage = `The model went round in circles: its last ${cycle.window} tool calls used only ${cycle.distinct} different calls, so Vader stopped the run instead of spending more tokens. Rephrase the request, or pick a different model.`
					runtime.abort()
				}
				if (identicalCallsInARow >= MAX_IDENTICAL_TOOL_CALLS_IN_A_ROW && !loopStopMessage) {
					loopStopMessage = `The model made the same "${event.toolCall.toolName}" call ${identicalCallsInARow} times in a row without making progress, so Vader stopped the run. Rephrase the request or pick a different model.`
					runtime.abort()
				}
			}
			else if (event.type === 'assistant-text-delta') {
				textSoFar = event.accumulatedText
				const repeated = textLoop.update(textSoFar)
				if (repeated.stuck) { stopForRepeatedText('answer', repeated.sample) }
				this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: textSoFar, reasoningSoFar, toolCallSoFar: null }, interrupt: Promise.resolve(() => runtime.abort()) })
			}
			else if (event.type === 'assistant-reasoning-delta') {
				reasoningSoFar = event.accumulatedText
				const repeated = reasoningLoop.update(reasoningSoFar)
				if (repeated.stuck) { stopForRepeatedText('reasoning', repeated.sample) }
				this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: textSoFar, reasoningSoFar, toolCallSoFar: null }, interrupt: Promise.resolve(() => runtime.abort()) })
			}
			else if (event.type === 'tool-finished') {
				// Calls the runtime answers itself - an unknown tool name, arguments that are not valid JSON, a tool that is switched off - never reach
				// _runToolCallInline, so nothing was recorded in the thread and the next request to the model lacked both the call and its error.
				// Record them as failed calls, so the model is told what went wrong and can correct itself.
				const result = event.message.content.find(p => p.type === 'tool-result') as { toolCallId: string, toolName: string, output: unknown, isError?: boolean } | undefined
				const thread = this.state.allThreads[threadId]
				if (result?.isError && thread && !thread.messages.some(m => m.role === 'tool' && m.id === result.toolCallId)) {
					const out = result.output
					const rawErrorText = typeof out === 'string' ? out : (out && typeof out === 'object' && typeof (out as { error?: unknown }).error === 'string') ? (out as { error: string }).error : JSON.stringify(out)
					// "Unknown tool: shell" tells a model nothing: say which tools exist and which one it probably meant (common/toolNameHints.ts)
					const unknownTool = /^Unknown tool:\s*(.+?)\s*$/i.exec(rawErrorText)
					const errorText = unknownTool ? unknownToolMessage(unknownTool[1], tools.map(t => t.name)) : rawErrorText
					const input = event.toolCall.input
					const rawParams = (input && typeof input === 'object' && !Array.isArray(input)) ? input as RawToolParamsObj : {}
					this._addMessageToThread(threadId, { role: 'tool', type: 'invalid_params', rawParams, result: null, name: result.toolName as ToolName, content: errorText, id: result.toolCallId, mcpServerName: undefined })
				}
			}
			else if (event.type === 'assistant-message') {
				const text = event.message.content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('')
				const reasoning = event.message.content.filter(p => p.type === 'reasoning').map(p => (p as { text: string }).text).join('')
				// anthropicReasoning is not preserved for Cline-driven turns: Cline abstracts
				// reasoning as plain text across providers, so Anthropic's raw signed
				// extended-thinking blocks (needed only for exact replay on a later turn) - a
				// known, honest fidelity gap, documented in docs/integrations/agent-runtime.md.
				this._addMessageToThread(threadId, { role: 'assistant', displayContent: text, reasoning, anthropicReasoning: null })
				// A turn with neither text nor a tool call would end the run with nothing on screen: the user cannot tell a finished task from a broken one.
				const hasToolCall = event.message.content.some(p => p.type === 'tool-call')
				lastTurnWasEmpty = (!text.trim() && !hasToolCall) ? { hadReasoning: !!reasoning.trim() } : null
				this._maybeCaptureThreadPlan(threadId, text)
				textSoFar = ''
				reasoningSoFar = ''
				textLoop.reset()
				reasoningLoop.reset()
			}
		})

		this._setStreamState(threadId, { isRunning: 'idle', interrupt: Promise.resolve(() => runtime.abort()) })

		const lastUserMsg = findLast(this.state.allThreads[threadId]?.messages ?? [], m => m.role === 'user')
		const runInput = (lastUserMsg && lastUserMsg.role === 'user') ? lastUserMsg.content : ''

		try {
			const result = await runtime.run(runInput)
			unsubscribe()

			if (result.status === 'aborted') {
				if (loopStopMessage) {
					this._setStreamState(threadId, { isRunning: undefined, error: { message: loopStopMessage, fullError: null } })
					this._addUserCheckpoint({ threadId })
					return
				}
				this._setStreamState(threadId, undefined)
				return
			}
			if (result.status === 'failed') {
				const message = explainRunFailure(result.error?.message ?? 'Cline runtime run failed for an unknown reason.')
				this._setStreamState(threadId, { isRunning: undefined, error: { message, fullError: result.error ?? null } })
				this._addUserCheckpoint({ threadId })
				return
			}

			// 'completed': if a tool call is still awaiting approval, _runToolCallInline has
			// already set isRunning to 'awaiting_user' and this must not clear it.
			if (this._currentIsRunning(threadId) !== 'awaiting_user') {
				const emptyTurn = lastTurnWasEmpty as { hadReasoning: boolean } | null
				if (emptyTurn) {
					// say so instead of stopping silently
					const message = emptyTurn.hadReasoning
						? 'The model only produced reasoning and then stopped, without an answer or an action. Send the message again, or try another model.'
						: 'The model sent an empty reply (no text and no action), so nothing happened. Send the message again, or try another model; if it keeps happening, check that the model supports the Agent mode (tool use).'
					this._setStreamState(threadId, { isRunning: undefined, error: { message, fullError: null } })
				}
				else {
					this._setStreamState(threadId, undefined)
				}
				this._addUserCheckpoint({ threadId })
			}
			this._metricsService.capture('Agent Loop Done', { chatMode, runtime: 'cline' })
		} catch (error) {
			unsubscribe()
			throw error // handled by _runChatAgent, which surfaces it as a per-task stream error
		}
	}


	private _externalRunOfThread = new Map<string, number>()
	private _externalRunSeq = 0

	// Vader addition: one turn with an external agent speaking the Agent Client Protocol (docs/integrations/external-agents.md). The agent keeps its own
	// tools, its own files access and its own account; Vader shows what it says and does, and asks the person whenever the agent asks for permission.
	private async _runExternalAgentTurn(threadId: string, agentId: string): Promise<void> {
		const custom = this._settingsService.state.globalSettings.customAcpAgents.find(c => c.id === agentId)
		const def = externalAgentById(agentId)
		const name = def?.name ?? custom?.name ?? agentId
		if ((!def && !custom) || def?.kind === 'terminal') {
			throw new Error(`${name} cannot take part in the chat: it runs in its own terminal (Settings > Models > External agents > Open). Choose another agent or a model.`)
		}
		const cwd = this._externalAgents.workingFolder()
		if (!cwd) { throw new Error(`${name} works inside the folder you have open. Open a folder first (File > Open Folder), then send your message again.`) }
		const lastUserMsg = findLast(this.state.allThreads[threadId]?.messages ?? [], m => m.role === 'user')
		const text = lastUserMsg?.role === 'user' ? lastUserMsg.content : ''
		if (!text.trim()) { return }
		// the agent's own id of this conversation, for when its process has to be started again (it is ignored while the process is still running)
		const earlier = this.state.allThreads[threadId]?.externalSession
		const resumeSessionId = earlier && earlier.agentId === agentId ? earlier.sessionId : undefined

		const runId = ++this._externalRunSeq
		this._externalRunOfThread.set(threadId, runId)
		const isCurrent = () => this._externalRunOfThread.get(threadId) === runId
		const segments: ({ kind: 'text', text: string } | { kind: 'tool', id: string, title: string, status: string, paths: readonly string[] })[] = []
		let reasoning = ''
		let sawTool = false
		const display = () => segments.map(sg => sg.kind === 'text' ? sg.text : `\n\n> ${sg.title || 'Working'}${sg.paths.length ? ` - ${sg.paths.map(baseName).join(', ')}` : ''} (${sg.status.replace('_', ' ')})\n\n`).join('')
		const interrupt = Promise.resolve(() => { void this._externalAgentMain.cancel(threadId) })
		const publish = () => {
			if (!isCurrent() || this._currentIsRunning(threadId) !== 'LLM') { return }
			this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: display(), reasoningSoFar: reasoning, toolCallSoFar: null }, interrupt })
		}

		const listener = this._externalAgentMain.onEvent((e: ExternalAgentEvent) => {
			if (e.sessionKey !== threadId || !isCurrent()) { return }
			if (e.type === 'text') {
				const last = segments[segments.length - 1]
				if (last?.kind === 'text') { last.text += e.text } else { segments.push({ kind: 'text', text: e.text }) }
			}
			else if (e.type === 'thought') { reasoning += e.text }
			else if (e.type === 'tool') {
				sawTool = true
				const known = segments.find(sg => sg.kind === 'tool' && sg.id === e.toolCallId)
				if (known?.kind === 'tool') { if (e.title) { known.title = e.title } known.status = e.status; if (e.paths?.length) { known.paths = e.paths } }
				else { segments.push({ kind: 'tool', id: e.toolCallId, title: e.title, status: e.status, paths: e.paths ?? [] }) }
			}
			else if (e.type === 'plan') {
				reasoning += (reasoning ? '\n' : '') + e.entries.map(p => `- [${p.status}] ${p.content}`).join('\n')
			}
			else if (e.type === 'status') { if (!segments.length) { reasoning = e.message } }
			else if (e.type === 'session') {
				if (!e.resumed && resumeSessionId) {
					segments.push({ kind: 'text', text: `_${name} started a new conversation: it could not restore the earlier one, so it does not remember what was said before._\n\n` })
				}
				this._setExternalSession(threadId, agentId, e.sessionId)
			}
			else if (e.type === 'permission') {
				void this._dialogService.prompt<string | null>({
					type: 'question',
					message: `${name} asks for permission`,
					detail: e.title,
					buttons: e.options.map(o => ({ label: o.name, run: () => o.id })),
					cancelButton: { label: 'Dismiss', run: () => null },
				}).then(r => this._externalAgentMain.answerPermission(e.requestId, r.result ?? null))
					.catch(() => this._externalAgentMain.answerPermission(e.requestId, null))
			}
			else if (e.type === 'auth-terminal') {
				void this._externalAgents.openSignInTerminal(name, e.command, e.args, e.env).catch(err => this._notificationService.warn(getErrorMessage(err)))
			}
			publish()
		})

		this._setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null }, interrupt })
		const keepPartialAnswer = () => {
			const answer = display().trim()
			if (answer || reasoning) { this._addMessageToThread(threadId, { role: 'assistant', displayContent: answer, reasoning, anthropicReasoning: null }) }
			return answer
		}
		try {
			const { stopReason } = await this._externalAgentMain.runTurn({ sessionKey: threadId, agentId, custom, cwd, text, resumeSessionId })
			if (!isCurrent() || this._currentIsRunning(threadId) !== 'LLM') { return } // stopped by the person: abortRunning already kept what was shown
			if (stopReason !== 'end_turn' && stopReason !== 'cancelled') { segments.push({ kind: 'text', text: `\n\n_(${name} stopped: ${stopReason.replace(/_/g, ' ')})_` }) }
			const answer = keepPartialAnswer()
			if (!answer && !sawTool) {
				this._setStreamState(threadId, { isRunning: undefined, error: { message: `${name} finished without an answer. Send the message again.`, fullError: null } })
			} else {
				this._setStreamState(threadId, undefined)
			}
			this._addUserCheckpoint({ threadId })
		} catch (error) {
			const message = getErrorMessage(error)
			if (isCurrent() && this._currentIsRunning(threadId) === 'LLM') { keepPartialAnswer() }
			if (message.includes('SIGN_IN_IN_TERMINAL')) {
				throw new Error(`${name} needs you to sign in. A terminal opened for it: finish the sign-in there, then send your message again.`)
			}
			throw error
		} finally {
			listener.dispose()
			if (isCurrent()) { this._externalRunOfThread.delete(threadId) }
		}
	}

	private _setExternalSession(threadId: string, agentId: string, sessionId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread || (thread.externalSession?.agentId === agentId && thread.externalSession.sessionId === sessionId)) { return }
		const newThreads = { ...this.state.allThreads, [threadId]: { ...thread, externalSession: { agentId, sessionId } } }
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads })
	}

	private _addCheckpoint(threadId: string, checkpoint: CheckpointEntry) {
		this._addMessageToThread(threadId, checkpoint)
		// // update latest checkpoint idx to the one we just added
		// const newThread = this.state.allThreads[threadId]
		// if (!newThread) return // should never happen
		// const currCheckpointIdx = newThread.messages.length - 1
		// this._setThreadState(threadId, { currCheckpointIdx: currCheckpointIdx })
	}



	private _editMessageInThread(threadId: string, messageIdx: number, newMessage: ChatMessage,) {
		const { allThreads } = this.state
		const oldThread = allThreads[threadId]
		if (!oldThread) return // should never happen
		// update state and store it
		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: [
					...oldThread.messages.slice(0, messageIdx),
					newMessage,
					...oldThread.messages.slice(messageIdx + 1, Infinity),
				],
			}
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads }) // the current thread just changed (it had a message added to it)
	}


	private _getCheckpointInfo = (checkpointMessage: ChatMessage & { role: 'checkpoint' }, fsPath: string, opts: { includeUserModifiedChanges: boolean }) => {
		const vaderFileSnapshot = checkpointMessage.vaderFileSnapshotOfURI ? checkpointMessage.vaderFileSnapshotOfURI[fsPath] ?? null : null
		if (!opts.includeUserModifiedChanges) { return { vaderFileSnapshot, } }

		const userModifiedVaderFileSnapshot = fsPath in checkpointMessage.userModifications.vaderFileSnapshotOfURI ? checkpointMessage.userModifications.vaderFileSnapshotOfURI[fsPath] ?? null : null
		return { vaderFileSnapshot: userModifiedVaderFileSnapshot ?? vaderFileSnapshot, }
	}

	private _computeNewCheckpointInfo({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const lastCheckpointIdx = findLastIdx(thread.messages, (m) => m.role === 'checkpoint') ?? -1
		if (lastCheckpointIdx === -1) return

		const vaderFileSnapshotOfURI: { [fsPath: string]: VaderFileSnapshot | undefined } = {}

		// add a change for all the URIs in the checkpoint history
		const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: 0, hiIdx: lastCheckpointIdx, }) ?? {}
		for (const fsPath in lastIdxOfURI ?? {}) {
			const { model } = this._vaderModelService.getModelFromFsPath(fsPath)
			if (!model) continue
			const checkpoint2 = thread.messages[lastIdxOfURI[fsPath]] || null
			if (!checkpoint2) continue
			if (checkpoint2.role !== 'checkpoint') continue
			const res = this._getCheckpointInfo(checkpoint2, fsPath, { includeUserModifiedChanges: false })
			if (!res) continue
			const { vaderFileSnapshot: oldVaderFileSnapshot } = res

			// if there was any change to the str or diffAreaSnapshot, update. rough approximation of equality, oldDiffAreasSnapshot === diffAreasSnapshot is not perfect
			const vaderFileSnapshot = this._editCodeService.getVaderFileSnapshot(URI.file(fsPath))
			if (oldVaderFileSnapshot === vaderFileSnapshot) continue
			vaderFileSnapshotOfURI[fsPath] = vaderFileSnapshot
		}

		// // add a change for all user-edited files (that aren't in the history)
		// for (const fsPath of this._userModifiedFilesToCheckInCheckpoints.keys()) {
		// 	if (fsPath in lastIdxOfURI) continue // if already visisted, don't visit again
		// 	const { model } = this._vaderModelService.getModelFromFsPath(fsPath)
		// 	if (!model) continue
		// 	currStrOfFsPath[fsPath] = model.getValue(EndOfLinePreference.LF)
		// }

		return { vaderFileSnapshotOfURI }
	}


	private _addUserCheckpoint({ threadId }: { threadId: string }) {
		const { vaderFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {}
		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'user_edit',
			vaderFileSnapshotOfURI: vaderFileSnapshotOfURI ?? {},
			userModifications: { vaderFileSnapshotOfURI: {}, },
		})
	}
	// call this right after LLM edits a file
	private _addToolEditCheckpoint({ threadId, uri, }: { threadId: string, uri: URI }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const { model } = this._vaderModelService.getModel(uri)
		if (!model) return // should never happen
		const diffAreasSnapshot = this._editCodeService.getVaderFileSnapshot(uri)
		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'tool_edit',
			vaderFileSnapshotOfURI: { [uri.fsPath]: diffAreasSnapshot },
			userModifications: { vaderFileSnapshotOfURI: {} },
		})
	}


	private _getCheckpointBeforeMessage = ({ threadId, messageIdx }: { threadId: string, messageIdx: number }): [CheckpointEntry, number] | undefined => {
		const thread = this.state.allThreads[threadId]
		if (!thread) return undefined
		for (let i = messageIdx; i >= 0; i--) {
			const message = thread.messages[i]
			if (message.role === 'checkpoint') {
				return [message, i]
			}
		}
		return undefined
	}

	private _getCheckpointsBetween({ threadId, loIdx, hiIdx }: { threadId: string, loIdx: number, hiIdx: number }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return { lastIdxOfURI: {} } // should never happen
		const lastIdxOfURI: { [fsPath: string]: number } = {}
		for (let i = loIdx; i <= hiIdx; i += 1) {
			const message = thread.messages[i]
			if (message?.role !== 'checkpoint') continue
			for (const fsPath in message.vaderFileSnapshotOfURI) { // do not include userModified.beforeStrOfURI here, jumping should not include those changes
				lastIdxOfURI[fsPath] = i
			}
		}
		return { lastIdxOfURI }
	}

	private _readCurrentCheckpoint(threadId: string): [CheckpointEntry, number] | undefined {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const { currCheckpointIdx } = thread.state
		if (currCheckpointIdx === null) return

		const checkpoint = thread.messages[currCheckpointIdx]
		if (!checkpoint) return
		if (checkpoint.role !== 'checkpoint') return
		return [checkpoint, currCheckpointIdx]
	}
	private _addUserModificationsToCurrCheckpoint({ threadId }: { threadId: string }) {
		const { vaderFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {}
		const res = this._readCurrentCheckpoint(threadId)
		if (!res) return
		const [checkpoint, checkpointIdx] = res
		this._editMessageInThread(threadId, checkpointIdx, {
			...checkpoint,
			userModifications: { vaderFileSnapshotOfURI: vaderFileSnapshotOfURI ?? {}, },
		})
	}


	private _makeUsStandOnCheckpoint({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		if (thread.state.currCheckpointIdx === null) {
			const lastMsg = thread.messages[thread.messages.length - 1]
			if (lastMsg?.role !== 'checkpoint')
				this._addUserCheckpoint({ threadId })
			this._setThreadState(threadId, { currCheckpointIdx: thread.messages.length - 1 })
		}
	}

	jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx, jumpToUserModified }: { threadId: string, messageIdx: number, jumpToUserModified: boolean }) {

		// if null, add a new temp checkpoint so user can jump forward again
		this._makeUsStandOnCheckpoint({ threadId })

		const thread = this.state.allThreads[threadId]
		if (!thread) return
		if (this.streamState[threadId]?.isRunning) return

		const c = this._getCheckpointBeforeMessage({ threadId, messageIdx })
		if (c === undefined) return // should never happen

		const fromIdx = thread.state.currCheckpointIdx
		if (fromIdx === null) return // should never happen

		const [_, toIdx] = c
		if (toIdx === fromIdx) return

		// console.log(`going from ${fromIdx} to ${toIdx}`)

		// update the user's checkpoint
		this._addUserModificationsToCurrCheckpoint({ threadId })

		/*
if undoing

A,B,C are all files.
x means a checkpoint where the file changed.

A B C D E F G H I
  x x x x x   x           <-- you can't always go up to find the "before" version; sometimes you need to go down
  | | | | |   | x
--x-|-|-|-x---x-|-----     <-- to
	| | | | x   x
	| | x x |
	| |   | |
----x-|---x-x-------     <-- from
	  x

We need to revert anything that happened between to+1 and from.
**We do this by finding the last x from 0...`to` for each file and applying those contents.**
We only need to do it for files that were edited since `to`, ie files between to+1...from.
*/
		if (toIdx < fromIdx) {
			const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: toIdx + 1, hiIdx: fromIdx })

			const idxes = function* () {
				for (let k = toIdx; k >= 0; k -= 1) { // first go up
					yield k
				}
				for (let k = toIdx + 1; k < thread.messages.length; k += 1) { // then go down
					yield k
				}
			}

			for (const fsPath in lastIdxOfURI) {
				// find the first instance of this file starting at toIdx (go up to latest file; if there is none, go down)
				for (const k of idxes()) {
					const message = thread.messages[k]
					if (message.role !== 'checkpoint') continue
					const res = this._getCheckpointInfo(message, fsPath, { includeUserModifiedChanges: jumpToUserModified })
					if (!res) continue
					const { vaderFileSnapshot } = res
					if (!vaderFileSnapshot) continue
					this._editCodeService.restoreVaderFileSnapshot(URI.file(fsPath), vaderFileSnapshot)
					break
				}
			}
		}

		/*
if redoing

A B C D E F G H I J
  x x x x x   x     x
  | | | | |   | x x x
--x-|-|-|-x---x-|-|---     <-- from
	| | | | x   x
	| | x x |
	| |   | |
----x-|---x-x-----|---     <-- to
	  x           x


We need to apply latest change for anything that happened between from+1 and to.
We only need to do it for files that were edited since `from`, ie files between from+1...to.
*/
		if (toIdx > fromIdx) {
			const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: fromIdx + 1, hiIdx: toIdx })
			for (const fsPath in lastIdxOfURI) {
				// apply lowest down content for each uri
				for (let k = toIdx; k >= fromIdx + 1; k -= 1) {
					const message = thread.messages[k]
					if (message.role !== 'checkpoint') continue
					const res = this._getCheckpointInfo(message, fsPath, { includeUserModifiedChanges: jumpToUserModified })
					if (!res) continue
					const { vaderFileSnapshot } = res
					if (!vaderFileSnapshot) continue
					this._editCodeService.restoreVaderFileSnapshot(URI.file(fsPath), vaderFileSnapshot)
					break
				}
			}
		}

		this._setThreadState(threadId, { currCheckpointIdx: toIdx })
	}


	private _wrapRunAgentToNotify(p: Promise<void>, threadId: string) {
		const notify = ({ error }: { error: string | null }) => {
			const thread = this.state.allThreads[threadId]
			if (!thread) return
			const userMsg = findLast(thread.messages, m => m.role === 'user')
			if (!userMsg) return
			if (userMsg.role !== 'user') return
			const messageContent = truncate(userMsg.displayContent, 50, '...')

			this._notificationService.notify({
				severity: error ? Severity.Warning : Severity.Info,
				message: error ? `Error: ${error} ` : `A new Chat result is ready.`,
				source: messageContent,
				sticky: true,
				actions: {
					primary: [{
						id: 'vader.goToChat',
						enabled: true,
						label: `Jump to Chat`,
						tooltip: '',
						class: undefined,
						run: () => {
							this.switchToThread(threadId)
							// scroll to bottom
							this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
								m.scrollToBottom()
							})
						}
					}]
				},
			})
		}

		p.then(() => {
			if (threadId !== this.state.currentThreadId) notify({ error: null })
		}).catch((e) => {
			if (threadId !== this.state.currentThreadId) notify({ error: getErrorMessage(e) })
			throw e
		})
	}

	dismissStreamError(threadId: string): void {
		this._setStreamState(threadId, undefined)
	}


	private async _addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId }: { userMessage: string, _chatSelections?: StagingSelectionItem[], threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		// interrupt existing stream
		if (this.streamState[threadId]?.isRunning) {
			await this.abortRunning(threadId)
		}

		// add dummy before this message to keep checkpoint before user message idea consistent
		if (thread.messages.length === 0) {
			this._addUserCheckpoint({ threadId })
		}


		// add user's message to chat history
		const instructions = userMessage
		const currSelns: StagingSelectionItem[] = _chatSelections ?? thread.state.stagingSelections

		const userMessageContent = await chat_userMessageContent(instructions, currSelns, { directoryStrService: this._directoryStringService, fileService: this._fileService }) // user message + names of files (NOT content)
		const userHistoryElt: ChatMessage = { role: 'user', content: userMessageContent, displayContent: instructions, selections: currSelns, state: defaultMessageState }
		this._addMessageToThread(threadId, userHistoryElt)

		this._setThreadState(threadId, { currCheckpointIdx: null }) // no longer at a checkpoint because started streaming

		this._wrapRunAgentToNotify(
			this._runChatAgent({ threadId, ...this._currentModelSelectionProps(threadId), }),
			threadId,
		)

		// scroll to bottom
		this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
			m.scrollToBottom()
		})
	}


	async addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId }: { userMessage: string, _chatSelections?: StagingSelectionItem[], threadId: string }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return

		// if there's a current checkpoint, delete all messages after it
		if (thread.state.currCheckpointIdx !== null) {
			const checkpointIdx = thread.state.currCheckpointIdx;
			const newMessages = thread.messages.slice(0, checkpointIdx + 1);

			// Update the thread with truncated messages
			const newThreads = {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					lastModified: new Date().toISOString(),
					messages: newMessages,
				}
			};
			this._storeAllThreads(newThreads);
			this._setState({ allThreads: newThreads });
		}

		// Now call the original method to add the user message and stream the response
		await this._addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId });

	}

	editUserMessageAndStreamResponse: IChatThreadService['editUserMessageAndStreamResponse'] = async ({ userMessage, messageIdx, threadId }) => {

		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		if (thread.messages?.[messageIdx]?.role !== 'user') {
			throw new Error(`Error: editing a message with role !=='user'`)
		}

		// get prev and curr selections before clearing the message
		const currSelns = thread.messages[messageIdx].state.stagingSelections || [] // staging selections for the edited message

		// clear messages up to the index
		const slicedMessages = thread.messages.slice(0, messageIdx)
		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					messages: slicedMessages
				}
			}
		})

		// re-add the message and stream it
		this._addUserMessageAndStreamResponse({ userMessage, _chatSelections: currSelns, threadId })
	}

	// ---------- the rest ----------

	private _getAllSeenFileURIs(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return []

		const fsPathsSet = new Set<string>()
		const uris: URI[] = []
		const addURI = (uri: URI) => {
			if (!fsPathsSet.has(uri.fsPath)) uris.push(uri)
			fsPathsSet.add(uri.fsPath)
			uris.push(uri)
		}

		for (const m of thread.messages) {
			// URIs of user selections
			if (m.role === 'user') {
				for (const sel of m.selections ?? []) {
					addURI(sel.uri)
				}
			}
			// URIs of files that have been read
			else if (m.role === 'tool' && m.type === 'success' && m.name === 'read_file') {
				const params = m.params as BuiltinToolCallParams['read_file']
				addURI(params.uri)
			}
		}
		return uris
	}



	getRelativeStr = (uri: URI) => {
		const isInside = this._workspaceContextService.isInsideWorkspace(uri)
		if (isInside) {
			const f = this._workspaceContextService.getWorkspace().folders.find(f => uri.fsPath.startsWith(f.uri.fsPath))
			if (f) { return uri.fsPath.replace(f.uri.fsPath, '') }
			else { return undefined }
		}
		else {
			return undefined
		}
	}


	// gets the location of codespan link so the user can click on it
	generateCodespanLink: IChatThreadService['generateCodespanLink'] = async ({ codespanStr: _codespanStr, threadId }) => {

		// process codespan to understand what we are searching for
		// TODO account for more complicated patterns eg `ITextEditorService.openEditor()`
		const functionOrMethodPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/; // `fUnCt10n_name`
		const functionParensPattern = /^([^\s(]+)\([^)]*\)$/; // `functionName( args )`

		let target = _codespanStr // the string to search for
		let codespanType: 'file-or-folder' | 'function-or-class'
		if (target.includes('.') || target.includes('/')) {

			codespanType = 'file-or-folder'
			target = _codespanStr

		} else if (functionOrMethodPattern.test(target)) {

			codespanType = 'function-or-class'
			target = _codespanStr

		} else if (functionParensPattern.test(target)) {
			const match = target.match(functionParensPattern)
			if (match && match[1]) {

				codespanType = 'function-or-class'
				target = match[1]

			}
			else { return null }
		}
		else {
			return null
		}

		// get history of all AI and user added files in conversation + store in reverse order (MRU)
		const prevUris = this._getAllSeenFileURIs(threadId).reverse()

		if (codespanType === 'file-or-folder') {
			const doesUriMatchTarget = (uri: URI) => uri.path.includes(target)

			// check if any prevFiles are the `target`
			for (const [idx, uri] of prevUris.entries()) {
				if (doesUriMatchTarget(uri)) {

					// shorten it

					// TODO make this logic more general
					const prevUriStrs = prevUris.map(uri => uri.fsPath)
					const shortenedUriStrs = shorten(prevUriStrs)
					let displayText = shortenedUriStrs[idx]
					const ellipsisIdx = displayText.lastIndexOf('…/');
					if (ellipsisIdx >= 0) {
						displayText = displayText.slice(ellipsisIdx + 2)
					}

					return { uri, displayText }
				}
			}

			// else search codebase for `target`
			let uris: URI[] = []
			try {
				const { result } = await this._toolsService.callTool['search_pathnames_only']({ query: target, includePattern: null, pageNumber: 0 })
				const { uris: uris_ } = await result
				uris = uris_
			} catch (e) {
				return null
			}

			for (const [idx, uri] of uris.entries()) {
				if (doesUriMatchTarget(uri)) {

					// TODO make this logic more general
					const prevUriStrs = prevUris.map(uri => uri.fsPath)
					const shortenedUriStrs = shorten(prevUriStrs)
					let displayText = shortenedUriStrs[idx]
					const ellipsisIdx = displayText.lastIndexOf('…/');
					if (ellipsisIdx >= 0) {
						displayText = displayText.slice(ellipsisIdx + 2)
					}


					return { uri, displayText }
				}
			}

		}


		if (codespanType === 'function-or-class') {


			// check all prevUris for the target
			for (const uri of prevUris) {

				const modelRef = await this._vaderModelService.getModelSafe(uri)
				const { model } = modelRef
				if (!model) continue

				const matches = model.findMatches(
					target,
					false, // searchOnlyEditableRange
					false, // isRegex
					true,  // matchCase
					null, //' ',   // wordSeparators
					true   // captureMatches
				);

				const firstThree = matches.slice(0, 3);

				// take first 3 occurences, attempt to goto definition on them
				for (const match of firstThree) {
					const position = new Position(match.range.startLineNumber, match.range.startColumn);
					const definitionProviders = this._languageFeaturesService.definitionProvider.ordered(model);

					for (const provider of definitionProviders) {

						const _definitions = await provider.provideDefinition(model, position, CancellationToken.None);

						if (!_definitions) continue;

						const definitions = Array.isArray(_definitions) ? _definitions : [_definitions];

						for (const definition of definitions) {

							return {
								uri: definition.uri,
								selection: {
									startLineNumber: definition.range.startLineNumber,
									startColumn: definition.range.startColumn,
									endLineNumber: definition.range.endLineNumber,
									endColumn: definition.range.endColumn,
								},
								displayText: _codespanStr,
							};

							// const defModelRef = await this._textModelService.createModelReference(definition.uri);
							// const defModel = defModelRef.object.textEditorModel;

							// try {
							// 	const symbolProviders = this._languageFeaturesService.documentSymbolProvider.ordered(defModel);

							// 	for (const symbolProvider of symbolProviders) {
							// 		const symbols = await symbolProvider.provideDocumentSymbols(
							// 			defModel,
							// 			CancellationToken.None
							// 		);

							// 		if (symbols) {
							// 			const symbol = symbols.find(s => {
							// 				const symbolRange = s.range;
							// 				return symbolRange.startLineNumber <= definition.range.startLineNumber &&
							// 					symbolRange.endLineNumber >= definition.range.endLineNumber &&
							// 					(symbolRange.startLineNumber !== definition.range.startLineNumber || symbolRange.startColumn <= definition.range.startColumn) &&
							// 					(symbolRange.endLineNumber !== definition.range.endLineNumber || symbolRange.endColumn >= definition.range.endColumn);
							// 			});

							// 			// if we got to a class/function get the full range and return
							// 			if (symbol?.kind === SymbolKind.Function || symbol?.kind === SymbolKind.Method || symbol?.kind === SymbolKind.Class) {
							// 				return {
							// 					uri: definition.uri,
							// 					selection: {
							// 						startLineNumber: definition.range.startLineNumber,
							// 						startColumn: definition.range.startColumn,
							// 						endLineNumber: definition.range.endLineNumber,
							// 						endColumn: definition.range.endColumn,
							// 					}
							// 				};
							// 			}
							// 		}
							// 	}
							// } finally {
							// 	defModelRef.dispose();
							// }
						}
					}
				}
			}

			// unlike above do not search codebase (doesnt make sense)

		}

		return null

	}

	getCodespanLink({ codespanStr, messageIdx, threadId }: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined {
		const thread = this.state.allThreads[threadId]
		if (!thread) return undefined;

		const links = thread.state.linksOfMessageIdx?.[messageIdx]
		if (!links) return undefined;

		const link = links[codespanStr]

		return link
	}

	async addCodespanLink({ newLinkText, newLinkLocation, messageIdx, threadId }: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({

			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					state: {
						...thread.state,
						linksOfMessageIdx: {
							...thread.state.linksOfMessageIdx,
							[messageIdx]: {
								...thread.state.linksOfMessageIdx?.[messageIdx],
								[newLinkText]: newLinkLocation
							}
						}
					}

				}
			}
		})
	}


	getCurrentThread(): ThreadType {
		const state = this.state
		const thread = state.allThreads[state.currentThreadId]
		if (!thread) throw new Error(`Current thread should never be undefined`)
		return thread
	}

	getCurrentFocusedMessageIdx() {
		const thread = this.getCurrentThread()

		// get the focusedMessageIdx
		const focusedMessageIdx = thread.state.focusedMessageIdx
		if (focusedMessageIdx === undefined) return;

		// check that the message is actually being edited
		const focusedMessage = thread.messages[focusedMessageIdx]
		if (focusedMessage.role !== 'user') return;
		if (!focusedMessage.state) return;

		return focusedMessageIdx
	}

	isCurrentlyFocusingMessage() {
		return this.getCurrentFocusedMessageIdx() !== undefined
	}

	switchToThread(threadId: string) {
		this._setState({ currentThreadId: threadId })
	}


	openNewThread() {
		// if a thread with 0 messages already exists, switch to it
		const { allThreads: currentThreads } = this.state
		for (const threadId in currentThreads) {
			if (currentThreads[threadId]!.messages.length === 0) {
				// switch to the existing empty thread and exit (it belongs to the project that is open now)
				this._adoptCurrentProject(threadId)
				this.switchToThread(threadId)
				return
			}
		}
		// otherwise, start a new thread
		const newThread = newThreadObject(this._currentWorkspaceFolders())

		// update state
		const newThreads: ChatThreads = {
			...currentThreads,
			[newThread.id]: newThread
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads, currentThreadId: newThread.id })
	}


	deleteThread(threadId: string): void {
		const { allThreads: currentThreads } = this.state

		// Vader addition, found in a production-hardening audit: a tool call still awaiting
		// approval on this thread would otherwise leave its resolver in _pendingInlineApprovals
		// forever - nothing can ever call approveLatestToolRequest/rejectLatestToolRequest for a
		// deleted thread, so the promise _runToolCallInline is awaiting (and the AgentRuntime.run()
		// call and its event subscription above it) would never settle. Resolving it as
		// 'rejected' here is the correct default: the thread is gone, so there is no longer any
		// user who could approve it, and a stuck action must never be silently left running.
		this._bumpToolQueueEpoch(threadId)
		this._releasePause(threadId, 'aborted')
		const pendingInline = this._pendingInlineApprovals.get(threadId)
		if (pendingInline) {
			this._pendingInlineApprovals.delete(threadId)
			pendingInline('rejected')
		}
		this._externalRunOfThread.delete(threadId)
		void this._externalAgentMain.closeSession(threadId).catch(() => { /* no agent was running for this thread */ })

		// delete the thread
		const newThreads = { ...currentThreads };
		delete newThreads[threadId];

		// store the updated threads
		this._storeAllThreads(newThreads);
		this._setState({ ...this.state, allThreads: newThreads })
	}

	duplicateThread(threadId: string) {
		const { allThreads: currentThreads } = this.state
		const threadToDuplicate = currentThreads[threadId]
		if (!threadToDuplicate) return
		const newThread = {
			...deepClone(threadToDuplicate),
			id: generateUuid(),
		}
		const newThreads = {
			...currentThreads,
			[newThread.id]: newThread,
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads })
	}


	private _addMessageToThread(threadId: string, message: ChatMessage) {
		const { allThreads } = this.state
		const oldThread = allThreads[threadId]
		if (!oldThread) return // should never happen
		// update state and store it
		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: [
					...oldThread.messages,
					message
				],
			}
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads }) // the current thread just changed (it had a message added to it)
	}

	// sets the currently selected message (must be undefined if no message is selected)
	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined) {

		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					state: {
						...thread.state,
						focusedMessageIdx: messageIdx,
					}
				}
			}
		})

		// // when change focused message idx, jump - do not jump back when click edit, too confusing.
		// if (messageIdx !== undefined)
		// 	this.jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx, jumpToUserModified: true })
	}


	addNewStagingSelection(newSelection: StagingSelectionItem): void {

		const focusedMessageIdx = this.getCurrentFocusedMessageIdx()

		// set the selections to the proper value
		let selections: StagingSelectionItem[] = []
		let setSelections = (s: StagingSelectionItem[]) => { }

		if (focusedMessageIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections
			setSelections = (s: StagingSelectionItem[]) => this.setCurrentThreadState({ stagingSelections: s })
		} else {
			selections = this.getCurrentMessageState(focusedMessageIdx).stagingSelections
			setSelections = (s) => this.setCurrentMessageState(focusedMessageIdx, { stagingSelections: s })
		}

		// if matches with existing selection, overwrite (since text may change)
		const idx = findStagingSelectionIndex(selections, newSelection)
		if (idx !== null && idx !== -1) {
			setSelections([
				...selections!.slice(0, idx),
				newSelection,
				...selections!.slice(idx + 1, Infinity)
			])
		}
		// if no match, add it
		else {
			setSelections([...(selections ?? []), newSelection])
		}
	}


	// Pops the staging selections from the current thread's state
	popStagingSelections(numPops: number): void {

		numPops = numPops ?? 1;

		const focusedMessageIdx = this.getCurrentFocusedMessageIdx()

		// set the selections to the proper value
		let selections: StagingSelectionItem[] = []
		let setSelections = (s: StagingSelectionItem[]) => { }

		if (focusedMessageIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections
			setSelections = (s: StagingSelectionItem[]) => this.setCurrentThreadState({ stagingSelections: s })
		} else {
			selections = this.getCurrentMessageState(focusedMessageIdx).stagingSelections
			setSelections = (s) => this.setCurrentMessageState(focusedMessageIdx, { stagingSelections: s })
		}

		setSelections([
			...selections.slice(0, selections.length - numPops)
		])

	}

	// set message.state
	private _setCurrentMessageState(state: Partial<UserMessageState>, messageIdx: number): void {

		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					messages: thread.messages.map((m, i) =>
						i === messageIdx && m.role === 'user' ? {
							...m,
							state: {
								...m.state,
								...state
							},
						} : m
					)
				}
			}
		})

	}

	// set thread.state
	setThreadAgentId(threadId: string, agentId: string | null): void {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: { ...thread, agentId }
			}
		}, true)
	}

	private _createHiddenSubagentThread(agentId: string | undefined, routerCategoryOverride?: 'research' | 'browser'): string {
		const newThread: ThreadType = { ...newThreadObject(), isSubagentThread: true, agentId: agentId ?? null, routerCategoryOverride }
		// deliberately does NOT change currentThreadId, so the user's active thread is untouched
		this._setState({ allThreads: { ...this.state.allThreads, [newThread.id]: newThread } }, true)
		return newThread.id
	}

	async runSubagentTask({ task, agentId, onThreadCreated, routerCategoryOverride }: { task: string, agentId?: string, onThreadCreated?: (threadId: string) => void, routerCategoryOverride?: 'research' | 'browser' }): Promise<SubagentTaskResult> {
		const threadId = this._createHiddenSubagentThread(agentId, routerCategoryOverride)
		// Vader addition: lets a caller (the Agent Orchestration service, for cancellable
		// parallel runs) capture the hidden thread's id synchronously, before this resolves,
		// so it has something to call abortRunning/cancelTask on if the run is cancelled
		// mid-flight - runSubagentTask itself only ever resolves once the subagent is done.
		onThreadCreated?.(threadId)

		this._addUserCheckpoint({ threadId })
		const userMessageContent = await chat_userMessageContent(task, [], { directoryStrService: this._directoryStringService, fileService: this._fileService })
		this._addMessageToThread(threadId, { role: 'user', content: userMessageContent, displayContent: task, selections: null, state: defaultMessageState })
		this._setThreadState(threadId, { currCheckpointIdx: null })

		// unlike the interactive path, we await _runChatAgent directly so this resolves
		// exactly when the subagent's loop truly stops (success, error, or a stall) - see
		// the "SubagentTaskResult stalledAwaitingApproval" note below for why a stall isn't
		// silently auto-approved.
		await this._runChatAgent({ threadId, ...this._currentModelSelectionProps(threadId) })

		const finalThread = this.state.allThreads[threadId]
		const messages = finalThread?.messages ?? []

		const lastAssistant = findLast(messages, m => m.role === 'assistant')
		const conclusion = (lastAssistant && lastAssistant.role === 'assistant' && lastAssistant.displayContent)
			|| '(the subagent finished without producing a final text response - see changedFilePaths/stalledAwaitingApproval for what happened instead)'

		const editToolNames = new Set(['edit_file', 'rewrite_file', 'create_file_or_folder', 'delete_file_or_folder'])
		const changedFilePaths = [...new Set(
			messages
				.filter((m): m is ChatMessage & { role: 'tool', type: 'success' } => m.role === 'tool' && m.type === 'success' && editToolNames.has(m.name))
				.map(m => (m.params as { uri?: URI }).uri?.fsPath)
				.filter((p): p is string => !!p)
		)]

		const finalStreamState = this.streamState[threadId]
		const stalledAwaitingApproval = finalStreamState?.isRunning === 'awaiting_user'
		const hadError = !!finalStreamState?.error

		return { threadId, conclusion, changedFilePaths, stalledAwaitingApproval, hadError }
	}

	private _createHiddenVerificationThread(): string {
		const newThread: ThreadType = { ...newThreadObject(), isSubagentThread: true, isVerificationThread: true, agentId: null }
		this._setState({ allThreads: { ...this.state.allThreads, [newThread.id]: newThread } }, true)
		return newThread.id
	}

	// Vader addition: runs an independent verification pass. See PlanObject's sibling
	// concept above and common/verification/verificationTypes.ts's IVerificationService,
	// which is the actual caller of this - VerificationService gathers real evidence (git
	// diff, diagnostics, build/lint/test results) and passes it here as plain text; this
	// method's only job is running that judgment in a hard-enforced-read-only hidden thread
	// and parsing the structured <vader_verdict> block back out.
	async runVerificationTask({ objective, evidenceText, onThreadCreated }: { objective: string, evidenceText: string, onThreadCreated?: (threadId: string) => void }): Promise<VerificationVerdict> {
		const threadId = this._createHiddenVerificationThread()
		onThreadCreated?.(threadId)

		this._addUserCheckpoint({ threadId })
		const userMessage = verificationAgent_userMessage(objective, evidenceText)
		const userMessageContent = await chat_userMessageContent(userMessage, [], { directoryStrService: this._directoryStringService, fileService: this._fileService })
		this._addMessageToThread(threadId, { role: 'user', content: userMessageContent, displayContent: userMessage, selections: null, state: defaultMessageState })
		this._setThreadState(threadId, { currCheckpointIdx: null })

		await this._runChatAgent({ threadId, ...this._currentModelSelectionProps(threadId) })

		const finalThread = this.state.allThreads[threadId]
		const messages = finalThread?.messages ?? []
		const lastAssistant = findLast(messages, m => m.role === 'assistant')
		const text = (lastAssistant && lastAssistant.role === 'assistant' && lastAssistant.displayContent) || ''

		return parseVerificationVerdict(text)
	}

	private _setThreadState(threadId: string, state: Partial<ThreadType['state']>, doNotRefreshMountInfo?: boolean): void {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					state: {
						...thread.state,
						...state
					}
				}
			}
		}, doNotRefreshMountInfo)

	}


	// closeCurrentStagingSelectionsInThread = () => {
	// 	const currThread = this.getCurrentThreadState()

	// 	// close all stagingSelections
	// 	const closedStagingSelections = currThread.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

	// 	const newThread = currThread
	// 	newThread.stagingSelections = closedStagingSelections

	// 	this.setCurrentThreadState(newThread)

	// }

	// closeCurrentStagingSelectionsInMessage: IChatThreadService['closeCurrentStagingSelectionsInMessage'] = ({ messageIdx }) => {
	// 	const currMessage = this.getCurrentMessageState(messageIdx)

	// 	// close all stagingSelections
	// 	const closedStagingSelections = currMessage.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

	// 	const newMessage = currMessage
	// 	newMessage.stagingSelections = closedStagingSelections

	// 	this.setCurrentMessageState(messageIdx, newMessage)

	// }



	getCurrentThreadState = () => {
		const currentThread = this.getCurrentThread()
		return currentThread.state
	}
	setCurrentThreadState = (newState: Partial<ThreadType['state']>) => {
		this._setThreadState(this.state.currentThreadId, newState)
	}

	// gets `staging` and `setStaging` of the currently focused element, given the index of the currently selected message (or undefined if no message is selected)

	getCurrentMessageState(messageIdx: number): UserMessageState {
		const currMessage = this.getCurrentThread()?.messages?.[messageIdx]
		if (!currMessage || currMessage.role !== 'user') return defaultMessageState
		return currMessage.state
	}
	setCurrentMessageState(messageIdx: number, newState: Partial<UserMessageState>) {
		const currMessage = this.getCurrentThread()?.messages?.[messageIdx]
		if (!currMessage || currMessage.role !== 'user') return
		this._setCurrentMessageState(newState, messageIdx)
	}



}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);
