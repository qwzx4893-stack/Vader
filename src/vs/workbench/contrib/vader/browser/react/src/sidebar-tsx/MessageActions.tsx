/*--------------------------------------------------------------------------------------
 * Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/
import React, { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy, GitBranch, Pencil, RotateCcw } from 'lucide-react'
import { useAccessor, useChatThreadsState, useChatThreadsStreamState } from '../util/services.js'
import { ChatMessage } from '../../../../common/chatThreadServiceTypes.js'

/** Actions always address the thread and message that rendered them, including after an async operation. */
export const MessageActions = ({ threadId, messageIdx, message, role, onEdit, onBranch }: {
	threadId: string, messageIdx: number, role: 'user' | 'assistant',
	message: Extract<ChatMessage, { role: 'user' | 'assistant' }>,
	onEdit?: () => void, onBranch: (id: string) => void,
}) => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const gateway = accessor.get('IAgentGatewayService')
	const stream = useChatThreadsStreamState(threadId)
	const threads = useChatThreadsState()
	const renderedMessage = useRef(message)
	renderedMessage.current = message
	const mounted = useRef(false)
	useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
	const pending = useRef(false)
	const retryButton = useRef<HTMLButtonElement>(null)
	const cancelButton = useRef<HTMLButtonElement>(null)
	const descriptionId = useId()
	const [busy, setBusy] = useState(false)
	const [copied, setCopied] = useState(false)
	const [error, setError] = useState('')
	const [retryTarget, setRetryTarget] = useState<{ message: ChatMessage, user: ChatMessage, userIdx: number } | null>(null)
	const confirmRetry = !!retryTarget
	useEffect(() => { if (confirmRetry && !busy) cancelButton.current?.focus() }, [confirmRetry, busy])
	useEffect(() => { setCopied(false); setError(''); setRetryTarget(null) }, [message.displayContent, threadId, messageIdx])
	const working = stream?.isRunning !== undefined || !!stream?.isPreparing || busy
	const messages = threads.allThreads[threadId]?.messages ?? []
	const available = messages[messageIdx] === message && message.role === role
	let userIdx = messageIdx
	while (userIdx >= 0 && messages[userIdx]?.role !== 'user') userIdx--
	const branchEnd = role === 'assistant' ? messageIdx + 1 : messageIdx

	const closeRetry = () => {
		setRetryTarget(null)
		retryButton.current?.focus()
		requestAnimationFrame(() => { if (mounted.current) retryButton.current?.focus() })
	}
	const validate = (mutates: boolean) => {
		if (chat.state.currentThreadId !== threadId || chat.state.allThreads[threadId]?.messages[messageIdx] !== message) throw new Error('This message changed. Try again.')
		if (mutates && (chat.streamState[threadId]?.isRunning !== undefined || chat.streamState[threadId]?.isPreparing)) throw new Error('Wait for the current reply to finish.')
	}
	const askRetry = () => {
		if (pending.current) return
		try {
			validate(true)
			setError('')
			setRetryTarget({ message, user: messages[userIdx], userIdx })
		} catch (e) { setError(e instanceof Error ? e.message : String(e)) }
	}
	const run = async (action: () => void | Promise<void>, mutates = true) => {
		if (pending.current) return
		pending.current = true
		setBusy(true); setError('')
		try { validate(mutates); await action() }
		catch (e) { if (mounted.current && renderedMessage.current.displayContent === message.displayContent) setError(e instanceof Error ? e.message : String(e)) }
		finally { pending.current = false; if (mounted.current) setBusy(false) }
	}
	const retry = () => run(async () => {
		// Re-check persisted state, rather than resending stale text if history changed.
		const current = chat.state.allThreads[threadId]?.messages
		if (!retryTarget || !current || current[messageIdx] !== retryTarget.message || current[retryTarget.userIdx] !== retryTarget.user || retryTarget.user.role !== 'user') throw new Error('This message changed. Try again.')
		// The revision API reads staging selections, while a retry must reuse the sent context.
		chat.setCurrentMessageState(retryTarget.userIdx, { stagingSelections: retryTarget.user.selections ?? [] })
		const updated = chat.state.allThreads[threadId]?.messages
		if (!updated) throw new Error('This message changed. Try again.')
		setRetryTarget({ ...retryTarget, message: updated[messageIdx], user: updated[retryTarget.userIdx] })
		await gateway.reviseTask({ threadId, fromMessageIdx: retryTarget.userIdx, userMessage: retryTarget.user.displayContent ?? '' })
		if (mounted.current) closeRetry()
	})

	return <div className='flex flex-col gap-1' data-testid='vader-message-actions' aria-busy={busy}>
		<div className='flex items-center gap-1'>
			<button type='button' aria-label='Copy' title={copied ? 'Copied' : 'Copy'} data-testid={role === 'user' ? 'vader-copy-message' : 'vader-copy-answer'} disabled={!available || busy || !message.displayContent} className='message-action message-copy inline-flex items-center justify-center h-7 w-7 rounded-md border-0 bg-transparent text-vader-fg-3 hover:text-vader-fg-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-vader-fg-3 disabled:opacity-40' onClick={() => { void run(async () => { setCopied(false); await accessor.get('IClipboardService').writeText(message.displayContent ?? ''); if (mounted.current && renderedMessage.current === message) setCopied(true) }, false) }}>
				{copied ? <Check size={14} aria-hidden='true' /> : <Copy size={14} aria-hidden='true' />}
			</button>
			{onEdit ? <button type='button' aria-label='Edit message' title='Edit message' data-testid='vader-edit-message' disabled={working || !available || confirmRetry} className='message-action inline-flex items-center justify-center h-7 w-7 rounded-md border-0 bg-transparent text-vader-fg-3 hover:text-vader-fg-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-vader-fg-3 disabled:opacity-40' onClick={() => { void run(onEdit) }}><Pencil size={14} aria-hidden='true' /></button> : null}
			{userIdx >= 0 ? <button ref={retryButton} type='button' aria-label={role === 'assistant' ? 'Regenerate reply' : 'Redo from here'} title={role === 'assistant' ? 'Regenerate reply' : 'Redo from here'} aria-expanded={confirmRetry} aria-controls={confirmRetry ? `${descriptionId}-confirm` : undefined} data-testid={role === 'assistant' ? 'vader-regenerate-answer' : 'vader-redo'} disabled={working || !available} className='message-action inline-flex items-center justify-center h-7 w-7 rounded-md border-0 bg-transparent text-vader-fg-3 hover:text-vader-fg-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-vader-fg-3 disabled:opacity-40' onClick={askRetry}><RotateCcw size={14} aria-hidden='true' /></button> : null}
			{branchEnd > 0 ? <button type='button' aria-label='Branch the chat' title={role === 'assistant' ? 'Start a new chat including this reply' : 'Start a new chat before this message'} data-testid={role === 'assistant' ? 'vader-branch-answer' : 'vader-branch'} disabled={working || !available || confirmRetry} className='message-action inline-flex items-center justify-center h-7 w-7 rounded-md border-0 bg-transparent text-vader-fg-3 hover:text-vader-fg-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-vader-fg-3 disabled:opacity-40' onClick={() => { void run(() => { const id = chat.branchThread(threadId, branchEnd); if (!id) throw new Error('Could not branch this chat.'); onBranch(id) }) }}><GitBranch size={14} aria-hidden='true' /></button> : null}
		</div>
		{copied ? <span role='status' className='text-xs text-vader-fg-3'>Copied</span> : null}
		{confirmRetry ? <div id={`${descriptionId}-confirm`} role='group' aria-label='Send this message again?' aria-describedby={descriptionId} data-testid='vader-retry-confirm' className='flex flex-col gap-2 py-2 text-xs text-vader-fg-2' onKeyDown={e => { if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); closeRetry() } }}>
			<span id={descriptionId}>This replaces the reply and later messages. Existing file changes stay. A new request uses your account allowance.</span>
			<div className='flex items-center gap-3'><button type='button' data-testid='vader-retry-confirm-go' disabled={working || !available} className='underline disabled:opacity-40' onClick={() => { void retry() }}>Send again</button><button ref={cancelButton} type='button' data-testid='vader-retry-confirm-cancel' disabled={busy} onClick={closeRetry}>Cancel</button></div>
		</div> : null}
		{error ? <div role='alert' data-testid='vader-message-action-error' className='text-xs text-vader-fg-2'><span>The action failed. Try again.</span><div>{error}</div></div> : null}
	</div>
}
