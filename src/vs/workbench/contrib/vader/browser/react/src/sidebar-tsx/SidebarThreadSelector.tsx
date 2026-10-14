/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useMemo, useState } from 'react';
import { CopyButton, IconShell1 } from '../markdown/ApplyBlockHoverButtons.js';
import { useAccessor, useChatThreadsState, useChatThreadsStreamState, useFullChatThreadsStreamState, useSettingsState } from '../util/services.js';
import { IconX } from './SidebarChat.js';
import { Check, ChevronRight, Copy, Icon, LoaderCircle, MessageCircleQuestion, Pause, Trash2, UserCheck, X } from 'lucide-react';
import { projectDisplayNames } from '../../../../common/threadProjects.js';
import { IsRunningType, ThreadType } from '../../../chatThreadService.js';


const numInitialThreads = 3

// Vader addition: the conversations under the project they were started in (like the sidebar of Claude Code or Codex), the open project first.
// Conversations from before projects were remembered are under "Chats". A conversation shows where it stands: waiting for you, working,
// paused, stopped by an error, or with changes ready to read.
const THREADS_SHOWN_PER_PROJECT = 5

export const PastThreadsList = ({ className = '' }: { className?: string }) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
	const [expanded, setExpanded] = useState<{ [groupKey: string]: boolean }>({})
	const [collapsed, setCollapsed] = useState<{ [groupKey: string]: boolean }>({})

	const threadsState = useChatThreadsState()
	const { allThreads } = threadsState

	const streamState = useFullChatThreadsStreamState()

	const runningThreadIds: { [threadId: string]: IsRunningType | undefined } = {}
	for (const threadId in streamState) {
		const isRunning = streamState[threadId]?.isRunning
		if (isRunning) { runningThreadIds[threadId] = isRunning }
	}

	if (!allThreads) {
		return <div key="error" className="p-1">{`Error accessing chat history.`}</div>;
	}

	// hidden threads made by the sub-agent tools, and empty ones, are left out by listProjectGroups
	const groups = chatThreadsService.listProjectGroups()
	const names = projectDisplayNames(groups)
	let idx = 0

	return (
		<div className={`flex flex-col mb-2 gap-2 w-full text-nowrap text-vader-fg-3 select-none relative ${className}`}>
			{groups.map(group => {
				const groupKey = group.key ?? '__chats__'
				const isCollapsed = !!collapsed[groupKey]
				const showAll = !!expanded[groupKey]
				const shown = showAll ? group.threadIds : group.threadIds.slice(0, THREADS_SHOWN_PER_PROJECT)
				const hidden = group.threadIds.length - shown.length
				return <div key={groupKey} className='flex flex-col gap-1'>
					<div
						className='flex items-center gap-1 px-1 text-xs cursor-pointer hover:text-vader-fg-1'
						onClick={() => setCollapsed(c => ({ ...c, [groupKey]: !isCollapsed }))}
						data-tooltip-id='vader-tooltip'
						data-tooltip-content={group.key ?? 'Conversations that were not started in a project'}
						data-tooltip-place='top'
					>
						<ChevronRight size={12} className={isCollapsed ? '' : 'rotate-90'} />
						<span className='font-medium truncate'>{names.get(group.key) ?? group.name}</span>
						<span className='opacity-60'>{group.threadIds.length}</span>
					</div>
					{isCollapsed ? null : <>
						{shown.map(threadId => {
							const pastThread = allThreads[threadId];
							if (!pastThread) { return null }
							const myIdx = idx++
							return <PastThreadElement
								key={pastThread.id}
								pastThread={pastThread}
								idx={myIdx}
								hoveredIdx={hoveredIdx}
								setHoveredIdx={setHoveredIdx}
								isRunning={runningThreadIds[pastThread.id]}
							/>
						})}
						{hidden > 0 ? <div className="text-vader-fg-3 opacity-80 hover:opacity-100 cursor-pointer p-1 text-xs" onClick={() => setExpanded(e => ({ ...e, [groupKey]: true }))}>Show {hidden} more...</div> : null}
						{showAll && group.threadIds.length > THREADS_SHOWN_PER_PROJECT ? <div className="text-vader-fg-3 opacity-80 hover:opacity-100 cursor-pointer p-1 text-xs" onClick={() => setExpanded(e => ({ ...e, [groupKey]: false }))}>Show less</div> : null}
					</>}
				</div>
			})}
		</div>
	);
};





// Format date to display as today, yesterday, or date
const formatDate = (date: Date) => {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	if (date >= today) {
		return 'Today';
	} else if (date >= yesterday) {
		return 'Yesterday';
	} else {
		return `${date.toLocaleString('default', { month: 'short' })} ${date.getDate()}`;
	}
};

// Format time to 12-hour format
const formatTime = (date: Date) => {
	return date.toLocaleString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});
};


const DuplicateButton = ({ threadId }: { threadId: string }) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	return <IconShell1
		Icon={Copy}
		className='size-[11px]'
		onClick={() => { chatThreadsService.duplicateThread(threadId); }}
		data-tooltip-id='vader-tooltip'
		data-tooltip-place='top'
		data-tooltip-content='Duplicate thread'
	>
	</IconShell1>

}

const TrashButton = ({ threadId }: { threadId: string }) => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')


	const [isTrashPressed, setIsTrashPressed] = useState(false)

	return (isTrashPressed ?
		<div className='flex flex-nowrap text-nowrap gap-1'>
			<IconShell1
				Icon={X}
				className='size-[11px]'
				onClick={() => { setIsTrashPressed(false); }}
				data-tooltip-id='vader-tooltip'
				data-tooltip-place='top'
				data-tooltip-content='Cancel'
			/>
			<IconShell1
				Icon={Check}
				className='size-[11px]'
				onClick={() => { chatThreadsService.deleteThread(threadId); setIsTrashPressed(false); }}
				data-tooltip-id='vader-tooltip'
				data-tooltip-place='top'
				data-tooltip-content='Confirm'
			/>
		</div>
		: <IconShell1
			Icon={Trash2}
			className='size-[11px]'
			onClick={() => { setIsTrashPressed(true); }}
			data-tooltip-id='vader-tooltip'
			data-tooltip-place='top'
			data-tooltip-content='Delete thread'
		/>
	)
}

// the state of a conversation that is not running right now: waiting for you, paused, stopped by an error, or with changes to read
const ThreadStatusMarker = ({ threadId }: { threadId: string }) => {
	const accessor = useAccessor()
	const status = accessor.get('IChatThreadService').getThreadStatus(threadId)
	if (status === 'needs_you') return <span title='Needs you' className='w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0' />
	if (status === 'paused') return <Pause size={12} className='flex-shrink-0' />
	if (status === 'error') return <span title='Stopped by an error' className='w-2 h-2 rounded-full bg-red-500 flex-shrink-0' />
	if (status === 'review') return <span title='Changes ready to review' className='w-2 h-2 rounded-full border border-vader-fg-3 flex-shrink-0' />
	return null
}

const PastThreadElement = ({ pastThread, idx, hoveredIdx, setHoveredIdx, isRunning }: {
	pastThread: ThreadType,
	idx: number,
	hoveredIdx: number | null,
	setHoveredIdx: (idx: number | null) => void,
	isRunning: IsRunningType | undefined,
}

) => {


	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')

	// const settingsState = useSettingsState()
	// const convertService = accessor.get('IConvertToLLMMessageService')
	// const chatMode = settingsState.globalSettings.chatMode
	// const modelSelection = settingsState.modelSelectionOfFeature?.Chat ?? null
	// const copyChatButton = <CopyButton
	// 	codeStr={async () => {
	// 		const { messages } = await convertService.prepareLLMChatMessages({
	// 			chatMessages: currentThread.messages,
	// 			chatMode,
	// 			modelSelection,
	// 		})
	// 		return JSON.stringify(messages, null, 2)
	// 	}}
	// 	toolTipName={modelSelection === null ? 'Copy As Messages Payload' : `Copy As ${displayInfoOfProviderName(modelSelection.providerName).title} Payload`}
	// />


	// const currentThread = chatThreadsService.getCurrentThread()
	// const copyChatButton2 = <CopyButton
	// 	codeStr={async () => {
	// 		return JSON.stringify(currentThread.messages, null, 2)
	// 	}}
	// 	toolTipName={`Copy As Vader Chat`}
	// />

	let firstMsg = null;
	const firstUserMsgIdx = pastThread.messages.findIndex((msg) => msg.role === 'user');

	if (firstUserMsgIdx !== -1) {
		const firsUsertMsgObj = pastThread.messages[firstUserMsgIdx];
		firstMsg = firsUsertMsgObj.role === 'user' && firsUsertMsgObj.displayContent || '';
	} else {
		firstMsg = '""';
	}

	const numMessages = pastThread.messages.filter((msg) => msg.role === 'assistant' || msg.role === 'user').length;

	const detailsHTML = <span
	// data-tooltip-id='vader-tooltip'
	// data-tooltip-content={`Last modified ${formatTime(new Date(pastThread.lastModified))}`}
	// data-tooltip-place='top'
	>
		<span className='opacity-60'>{numMessages}</span>
		{` `}
		{formatDate(new Date(pastThread.lastModified))}
		{/* {` messages `} */}
	</span>

	return <div
		key={pastThread.id}
		className={`
			py-1 px-2 rounded text-sm bg-zinc-700/5 hover:bg-zinc-700/10 dark:bg-zinc-300/5 dark:hover:bg-zinc-300/10 cursor-pointer opacity-80 hover:opacity-100
		`}
		onClick={() => {
			chatThreadsService.switchToThread(pastThread.id);
		}}
		onMouseEnter={() => setHoveredIdx(idx)}
		onMouseLeave={() => setHoveredIdx(null)}
	>
		<div className="flex items-center justify-between gap-1">
			<span className="flex items-center gap-2 min-w-0 overflow-hidden">
				{/* spinner */}
				{isRunning === 'LLM' || isRunning === 'tool' || isRunning === 'idle' ? <LoaderCircle className="animate-spin bg-vader-stroke-1 flex-shrink-0 flex-grow-0" size={14} />
					:
					isRunning === 'awaiting_user' ? <MessageCircleQuestion className="bg-vader-stroke-1 flex-shrink-0 flex-grow-0" size={14} />
						:
						<ThreadStatusMarker threadId={pastThread.id} />}
				{/* name */}
				<span className="truncate overflow-hidden text-ellipsis"
					data-tooltip-id='vader-tooltip'
					data-tooltip-content={numMessages + ' messages'}
					data-tooltip-place='top'
				>{firstMsg}</span>

				{/* <span className='opacity-60'>{`(${numMessages})`}</span> */}
			</span>

			<div className="flex items-center gap-x-1 opacity-60">
				{idx === hoveredIdx ?
					<>
						{/* trash icon */}
						<DuplicateButton threadId={pastThread.id} />

						{/* trash icon */}
						<TrashButton threadId={pastThread.id} />
					</>
					: <>
						{detailsHTML}
					</>
				}
			</div>
		</div>
	</div>
}
