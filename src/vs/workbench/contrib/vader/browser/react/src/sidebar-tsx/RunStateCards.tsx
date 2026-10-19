/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { useAccessor, useChatThreadsState, useSettingsState, useShellState } from '../util/services.js'
import { VADER_OPEN_SETTINGS_ACTION_ID } from '../../../actionIDs.js'
import { getModelCapabilities } from '../../../../common/modelCapabilities.js'
import { isFeatureNameDisabled } from '../../../../common/vaderSettingsTypes.js'
import { contextBanner, contextShare, describePaste, messageChars, QueuedMessage } from '../../../../common/runStateModel.js'
import { changedFilePaths } from '../../../../common/shellModel.js'
import { formatUsd } from '../../../../common/usageAccounting.js'

// What the chat says about the run, in the shape of the interface boards S01 and S03: stopped by you, paused, finished with changes, messages that wait their turn, a
// conversation that is getting full, no model to ask, a long paste folded to one line. Each card says what happened and offers what can be done, and is drawn
// from the real state of the conversation (the stop remembered by the chat service, the queue, the size of the messages against the model's window).
// The class names are written out in each className on purpose: the build that scopes Tailwind to Vader's UI prefixes only the names it finds written there.


const Triangle = ({ color }: { color: string }) => <svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' className='shrink-0'><path d='M7.5 2.2 13.3 12.6H1.7z' fill='none' stroke={color} strokeWidth='1.3' strokeLinejoin='round' /></svg>

// ---- the run ended, or is held

/** the person stopped the run: what it was doing, what is kept, and the two things to do next */
export const StoppedCard = ({ threadId }: { threadId: string }) => {
	const accessor = useAccessor()
	const gateway = accessor.get('IAgentGatewayService')
	const shell = accessor.get('IVaderShellService')
	const threads = useChatThreadsState()
	const inWindow = useShellState()?.mode === 'window'
	const thread = threads.allThreads[threadId]
	if (!thread?.stopped) return null
	const changed = changedFilePaths(thread.messages as never)
	return <div className='rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2.5' data-testid='vader-stopped' role='status'>
		<div className='flex items-center gap-2'><Triangle color='#e2a93f' /><span className='font-semibold text-vader-fg-1' data-testid='vader-stopped-title'>{thread.stopped.doing}</span></div>
		<div className='text-vader-fg-2 leading-relaxed'>You stopped it. What it had done so far is kept{changed.length > 0 ? `, and the ${changed.length} file${changed.length === 1 ? '' : 's'} it changed ${changed.length === 1 ? 'is' : 'are'} there for you to review` : ''}.</div>
		<div className='flex flex-wrap gap-2'>
			<button data-testid='vader-stopped-continue' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={() => { void gateway.startTask({ threadId, userMessage: 'Continue the task from where you stopped.' }) }}>Continue the task</button>
			{inWindow && changed.length > 0 ? <button data-testid='vader-stopped-review' className='px-3 py-1 rounded-md text-sm border border-vader-border-2 text-vader-fg-1 hover:bg-vader-bg-2-hover' onClick={() => shell.show('conversation', 'review')}>Review what it did</button> : null}
		</div>
	</div>
}

/** the run finished on its own and changed files: how many, and the way to the review page (in the Vader window) */
export const FinishedCard = ({ threadId, isRunning }: { threadId: string, isRunning: boolean }) => {
	const accessor = useAccessor()
	const shell = accessor.get('IVaderShellService')
	const threads = useChatThreadsState()
	const inWindow = useShellState()?.mode === 'window'
	const thread = threads.allThreads[threadId]
	if (!thread || isRunning || thread.stopped || !inWindow) return null
	const last = thread.messages[thread.messages.length - 1]
	if (!last || last.role !== 'assistant') return null
	// only the changes since the person's last message
	let lastUser = -1
	for (let i = thread.messages.length - 1; i >= 0; i--) { if (thread.messages[i].role === 'user') { lastUser = i; break } }
	const changed = changedFilePaths(thread.messages.slice(lastUser + 1) as never)
	if (changed.length === 0) return null
	return <div className='rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2.5' data-testid='vader-finished'>
		<div className='flex items-center gap-3'>
			<span className='text-vader-fg-1' data-testid='vader-finished-count'>{changed.length} file{changed.length === 1 ? '' : 's'} changed</span>
			<span className='flex-1' />
			<button data-testid='vader-finished-review' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={() => shell.show('conversation', 'review')}>Review changes</button>
		</div>
	</div>
}

/** the run is held at its next step: what that means and how to go on or end it */
export const PausedCard = ({ threadId }: { threadId: string }) => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const gateway = accessor.get('IAgentGatewayService')
	const settings = useSettingsState()
	useChatThreadsState()
	const pause = chat.getPause(threadId)
	if (!pause) return null
	const limit = settings.globalSettings.dailySpendLimitUsd
	return <div className='rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2.5' data-testid='vader-paused' role='status'>
		<div className='font-semibold text-vader-fg-1'>{pause.reason === 'budget' ? `Paused: today's estimate reached ${formatUsd(limit ?? 0)}` : 'Paused'}</div>
		<div className='text-vader-fg-2 leading-relaxed'>It will not start another step.{pause.reason === 'budget' ? ' Going on is your decision, and it holds for the rest of the day.' : ' Nothing it has done is lost.'}</div>
		<div className='flex flex-wrap gap-2'>
			<button data-testid='vader-paused-resume' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={() => chat.resumeRun(threadId)}>{pause.reason === 'budget' ? 'Go on anyway' : 'Resume'}</button>
			<button data-testid='vader-paused-stop' className='px-2 py-1 text-vader-fg-2 hover:text-vader-fg-1 text-sm' onClick={() => { void gateway.cancelTask(threadId) }}>Stop</button>
		</div>
	</div>
}

// ---- messages that wait

/** what the person wrote while the run went: each waits for the run to end, or goes at once with Send now */
export const QueueList = ({ threadId, queued }: { threadId: string, queued: readonly QueuedMessage[] }) => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	if (queued.length === 0) return null
	return <div className='flex flex-col gap-2' data-testid='vader-queue'>
		{queued.map((m, i) => <div key={m.id} className='rounded-xl border border-vader-border-2 bg-vader-bg-2 px-3 py-2 flex items-center gap-3' data-testid='vader-queue-item'>
			<span className='flex-1 min-w-0 text-vader-fg-1 line-clamp-2 break-words'>{m.text}</span>
			<span className='text-xs text-vader-fg-3 border border-vader-border-2 rounded px-1.5 py-0.5 shrink-0' title={i === 0 ? 'Sent when the run ends' : 'Sent after the ones above it'}>Queued</span>
			<button className='text-vader-fg-1 hover:underline shrink-0' data-testid='vader-queue-send-now' title='Stops the run and sends this now' onClick={() => { void chat.sendQueuedMessageNow(threadId, m.id) }}>Send now</button>
			<button className='text-vader-fg-3 hover:text-vader-fg-1 shrink-0' aria-label='Remove this message' data-testid='vader-queue-remove' onClick={() => chat.removeQueuedMessage(threadId, m.id)}>{'×'}</button>
		</div>)}
	</div>
}

// ---- how full the conversation is

/** shown from 60% of the room a request may use: the real thresholds, and two things to do about it */
export const ContextBanner = ({ threadId, isRunning }: { threadId: string, isRunning: boolean }) => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const settings = useSettingsState()
	const threads = useChatThreadsState()
	const [busy, setBusy] = useState<'summarise' | 'new' | undefined>()
	const [result, setResult] = useState<string | undefined>()
	const thread = threads.allThreads[threadId]
	const sel = settings.modelSelectionOfFeature?.Chat
	if (!thread || !sel || thread.messages.length === 0) return null
	const caps = getModelCapabilities(sel.providerName, sel.modelName, settings.overridesOfModel)
	if (!caps.contextWindow) return null
	const share = contextShare(messageChars(thread.messages as never), caps.contextWindow, caps.reservedOutputTokenSpace)
	const banner = contextBanner(share)
	if (!banner && !result) return null
	const run = async (what: 'summarise' | 'new') => {
		setBusy(what); setResult(undefined)
		try {
			if (what === 'summarise') {
				const r = await chat.compactThreadNow(threadId)
				setResult(r === 'done' ? 'The older messages are summarised.' : r === 'nothing' ? 'There is too little to summarise yet.' : 'The model did not answer, so nothing was summarised.')
			} else {
				const ok = await chat.startNewChatWithSummary(threadId)
				if (!ok) setResult('The model did not answer, so the new chat was not started.')
			}
		} finally { setBusy(undefined) }
	}
	return <div className='rounded-xl border border-yellow-600/50 bg-yellow-500/10 px-4 py-3 flex flex-col gap-2' data-testid='vader-context-banner' data-share={Math.round(share * 100)}>
		{banner ? <>
			<div className='flex items-center gap-2'><Triangle color='#e2a93f' /><span className='font-semibold text-vader-fg-1'>{banner.title}</span></div>
			<div className='text-vader-fg-2 leading-relaxed'>{banner.body}</div>
		</> : null}
		<div className='flex flex-wrap gap-2 items-center'>
			{banner ? <>
				<button data-testid='vader-context-summarise' className='px-3 py-1 rounded-md text-sm border border-vader-border-2 text-vader-fg-1 hover:bg-vader-bg-2-hover' disabled={!!busy || isRunning} title={isRunning ? 'Wait for the run to end, or stop it' : undefined} onClick={() => { void run('summarise') }}>{busy === 'summarise' ? 'Summarising...' : 'Summarise now'}</button>
				<button data-testid='vader-context-newchat' className='px-3 py-1 rounded-md text-sm border border-vader-border-2 text-vader-fg-1 hover:bg-vader-bg-2-hover' disabled={!!busy || isRunning} title={isRunning ? 'Wait for the run to end, or stop it' : undefined} onClick={() => { void run('new') }}>{busy === 'new' ? 'Summarising...' : 'Start a new chat with a summary'}</button>
            </> : null}
			{result ? <span className='text-vader-fg-2' data-testid='vader-context-result' role='status'>{result}</span> : null}
		</div>
	</div>
}

// ---- no model to ask

/** the first thing to fix when there is no model: said once, with the way to it */
export const NoModelCard = () => {
	const accessor = useAccessor()
	const commands = accessor.get('ICommandService')
	const settings = useSettingsState()
	if (settings.globalSettings.externalAgentId) return null
	const why = isFeatureNameDisabled('Chat', settings)
	if (!why) return null
	const open = () => { void commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID, 'models') }
	const none = why === 'addProvider'
	return <div className='rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2.5' data-testid='vader-no-model' role='alert' data-reason={String(why)}>
		<div className='flex items-center gap-2'><Triangle color='#e2a93f' /><span className='font-semibold text-vader-fg-1'>{none ? 'Choose a model first' : why === 'needToEnableModel' ? 'Switch a model on' : 'Add a model'}</span></div>
		<div className='text-vader-fg-2 leading-relaxed'>{none ? 'No provider has a key yet, so there is no model to ask.' : why === 'needToEnableModel' ? 'A provider is set up, but all its models are hidden from the picker.' : 'A provider is set up, but it has no model yet. Add the one you use.'}</div>
		<div className='flex flex-wrap gap-2'>
			<button data-testid='vader-no-model-add-key' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={open}>{none ? 'Add a key' : 'Open Models'}</button>
			{none ? <button data-testid='vader-no-model-local' className='px-3 py-1 rounded-md text-sm border border-vader-border-2 text-vader-fg-1 hover:bg-vader-bg-2-hover' onClick={open}>Use a local model</button> : null}
		</div>
	</div>
}

// ---- a long paste

export type Paste = { id: string, text: string }

/** a pasted text that is long is one line in the message box: its size, Show and Remove; it is sent in full with the message */
export const PastedChips = ({ pastes, onRemove }: { pastes: readonly Paste[], onRemove: (id: string) => void }) => {
	const [shown, setShown] = useState<string | undefined>()
	if (pastes.length === 0) return null
	return <div className='flex flex-col gap-1.5 px-1 pb-1' data-testid='vader-pastes'>
		{pastes.map(p => {
			const d = describePaste(p.text)
			return <div key={p.id} className='rounded-lg border border-vader-border-2 bg-vader-bg-2 px-2.5 py-1.5' data-testid='vader-paste-chip'>
				<div className='flex items-center gap-2'>
					<span className='text-vader-fg-1 font-medium'>Pasted text</span>
					<span className='text-vader-fg-3 text-xs flex-1 min-w-0 truncate' data-testid='vader-paste-label'>{d.label}</span>
					<button className='text-vader-fg-2 hover:text-vader-fg-1 text-xs' data-testid='vader-paste-show' aria-expanded={shown === p.id} onClick={() => setShown(shown === p.id ? undefined : p.id)}>{shown === p.id ? 'Hide' : 'Show'}</button>
					<button className='text-vader-fg-2 hover:text-vader-fg-1 text-xs' data-testid='vader-paste-remove' onClick={() => onRemove(p.id)}>Remove</button>
				</div>
				{shown === p.id ? <pre className='mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-vader-fg-2 select-text' data-testid='vader-paste-text'>{p.text}</pre> : null}
			</div>
		})}
	</div>
}
