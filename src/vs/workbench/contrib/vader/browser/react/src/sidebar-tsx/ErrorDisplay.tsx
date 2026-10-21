/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { URI } from '../../../../../../../base/common/uri.js';
import { useAccessor, useSettingsState } from '../util/services.js';
import { errorDetails } from '../../../../common/sendLLMMessageTypes.js';
import { classifyProviderError, ProviderErrorCategory } from '../../../../common/providerErrorTypes.js';
import { displayInfoOfProviderName } from '../../../../common/vaderSettingsTypes.js';
import { PROVIDER_USAGE_PAGES } from '../../../../common/usageAccounting.js';
import { VADER_OPEN_SETTINGS_ACTION_ID } from '../../../actionIDs.js';
import { cardForAgentError } from '../../../../common/externalAgentWords.js';
import { externalAgentById } from '../../../../common/externalAgents/externalAgentCatalog.js';

// What goes wrong in a run and what the person can do about it (board S12 and R21): what happened, what was kept, and the next step as a button. The
// provider's own words are always shown too, never hidden behind the explanation.

type Card = { title: string, text: string, actions: ('settings' | 'again' | 'another' | 'newChat' | 'billing' | 'provider')[] }

const statusOf = (e: unknown): number | undefined => typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number' ? (e as { status: number }).status : undefined

/** the explanation for a failure, in the words of the boards; null when nothing better than the message itself is known */
export const cardForError = (category: ProviderErrorCategory, status: number | undefined, who: string, model: string | undefined): Card | null => {
	if (status === 402) return { title: `${who} says your credit is used up`, text: 'The provider answered 402. Add credit on its site, or choose another model. The work so far is saved.', actions: ['billing', 'another'] }
	switch (category) {
		case 'AUTHENTICATION': return { title: `${who} rejected your key`, text: `The provider answered ${status ?? 401}. The key may have been revoked or pasted with a space. Nothing was changed.`, actions: ['settings', 'again'] }
		case 'RATE_LIMIT': return { title: `${who} limits this key for now`, text: 'The provider answered 429: too many requests too fast. Wait a little and send again, or choose another model. Everything the agent did is saved.', actions: ['again', 'another'] }
		case 'PROVIDER_UNAVAILABLE': return { title: `${who} is having trouble${status ? ` (${status})` : ''}`, text: 'It is overloaded or down, not your key. Vader tried again before showing this.', actions: ['again', 'another'] }
		case 'MODEL_NOT_FOUND': return { title: `${who} has no model called ${model ?? 'this one'}`, text: 'The provider retired it or renamed it. Nothing was sent.', actions: ['another', 'provider'] }
		case 'CONTEXT_LIMIT': return { title: "The chat no longer fits in the model's window", text: 'The conversation is longer than this model reads. Start a new chat, or choose a model with a larger window.', actions: ['newChat', 'another'] }
		case 'NETWORK': return { title: `Could not reach ${who}`, text: 'Nothing was sent. Check your connection or proxy, or choose a model on this computer instead.', actions: ['again', 'another'] }
		case 'TIMEOUT': return { title: `${who} did not answer in time`, text: 'The provider is slow, not down. Send the message again.', actions: ['again', 'another'] }
		case 'TOOL_UNSUPPORTED': return { title: 'This model cannot use tools', text: 'Agent mode needs a model that supports tool calls. Switch to Chat mode or choose another model.', actions: ['another'] }
		case 'VISION_UNSUPPORTED': return { title: 'This model cannot read images', text: 'Remove the image or choose a model that sees.', actions: ['another'] }
		case 'MALFORMED_RESPONSE': return { title: `${who} sent an answer Vader could not read`, text: 'Send the message again; if it keeps happening, choose another model.', actions: ['again', 'another'] }
		case 'INVALID_REQUEST': return { title: `${who} refused the request`, text: 'Its explanation is below.', actions: ['again', 'another'] }
		default: return null
	}
}

export const ErrorDisplay = ({
	message: message_,
	fullError,
	onDismiss,
	showDismiss,
}: {
	message: string,
	fullError: Error | null,
	onDismiss: (() => void) | null,
	showDismiss?: boolean,
}) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const accessor = useAccessor()
	const settingsState = useSettingsState()
	const chat = accessor.get('IChatThreadService')
	const gateway = accessor.get('IAgentGatewayService')
	const commands = accessor.get('ICommandService')
	const opener = accessor.get('IOpenerService')

	const details = errorDetails(fullError)
	const message = message_ + ''
	const sel = settingsState.modelSelectionOfFeature?.Chat
	const who = sel ? displayInfoOfProviderName(sel.providerName).title : 'The provider'
	const category = classifyProviderError(message, fullError).category
	// a connected agent that needs its sign-in, or whose program stopped, has its own words; everything else is a provider's error
	const agentId = settingsState.globalSettings.externalAgentId
	const agentCard = agentId ? cardForAgentError(message, externalAgentById(agentId)?.name) : null
	const card = agentCard ? { title: agentCard.title, text: agentCard.text, actions: ['again'] as Card['actions'] } : cardForError(category, statusOf(fullError), who, sel?.modelName)

	const openSettings = () => { void commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID) }
	const sendAgain = () => {
		const threadId = chat.state.currentThreadId
		const messages = chat.getCurrentThread().messages
		let idx = -1
		for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') { idx = i; break } }
		const last = idx >= 0 ? messages[idx] : undefined
		if (!last || last.role !== 'user') return
		void gateway.reviseTask({ userMessage: last.displayContent || last.content, fromMessageIdx: idx, threadId })
	}
	const usagePage = sel ? PROVIDER_USAGE_PAGES[sel.providerName] : undefined
	const buttons: Record<string, React.ReactNode> = {
		settings: <button key='settings' data-testid='vader-error-settings' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 font-medium text-sm' onClick={openSettings}>Provider settings</button>,
		again: <button key='again' data-testid='vader-error-again' className='px-3 py-1 rounded-md border border-vader-border-2 text-vader-fg-1 text-sm' onClick={sendAgain}>{agentCard?.againLabel ?? 'Send again'}</button>,
		another: <button key='another' data-testid='vader-error-another' className='px-3 py-1 rounded-md border border-vader-border-2 text-vader-fg-1 text-sm' onClick={openSettings}>Choose another model</button>,
		provider: <button key='provider' className='px-2 py-1 text-vader-fg-2 text-sm hover:text-vader-fg-1' onClick={openSettings}>Open the provider&apos;s list</button>,
		newChat: <button key='newChat' data-testid='vader-error-new-chat' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 font-medium text-sm' onClick={() => chat.openNewThread()}>Start a new chat</button>,
		billing: usagePage ? <button key='billing' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 font-medium text-sm' onClick={() => { void opener.open(URI.parse(usagePage.url)) }}>Open {usagePage.label}</button> : null,
	}

	return (
		<div className='rounded-xl border border-vader-border-2 bg-vader-bg-1 p-4 overflow-auto flex flex-col gap-3' data-testid='vader-error' data-category={category}>
			<div className='flex items-start justify-between gap-3'>
				<div className='flex gap-2.5 min-w-0'>
					<AlertTriangle className='h-4 w-4 mt-1 shrink-0 text-vader-warning' />
					<div className='flex-1 min-w-0'>
						<h3 className='font-semibold text-vader-fg-1'>{card?.title ?? 'Something went wrong'}</h3>
						{card ? <p className='text-vader-fg-2 mt-1 leading-relaxed'>{card.text}</p> : null}
					</div>
				</div>
				<div className='flex gap-1 shrink-0'>
					{details ? <button className='text-vader-fg-3 hover:text-vader-fg-1 p-1 rounded' aria-label={isExpanded ? 'Hide the full error' : 'Show the full error'} onClick={() => setIsExpanded(!isExpanded)}>
						{isExpanded ? <ChevronUp className='h-4 w-4' /> : <ChevronDown className='h-4 w-4' />}
					</button> : null}
					{showDismiss && onDismiss ? <button className='text-vader-fg-3 hover:text-vader-fg-1 p-1 rounded' aria-label='Dismiss' onClick={onDismiss}><X className='h-4 w-4' /></button> : null}
				</div>
			</div>

			{/* what the provider itself said, never hidden */}
			<p className={`text-vader-fg-3 text-sm whitespace-pre-wrap break-words ${card ? 'border-t border-vader-border-3 pt-2' : ''}`} data-testid='vader-error-message'>{message}</p>

			{card ? <div className='flex flex-wrap gap-2'>{card.actions.map(a => buttons[a])}</div> : <div className='flex flex-wrap gap-2'><button data-testid='vader-error-settings' className='px-3 py-1 rounded-md border border-vader-border-2 text-vader-fg-1 text-sm' onClick={openSettings}>Open settings</button></div>}

			{isExpanded && details ? <div className='border-t border-vader-border-3 pt-2 overflow-auto'>
				<span className='font-semibold text-vader-fg-1'>Full error: </span>
				<pre className='text-vader-fg-3 text-sm'>{details}</pre>
			</div> : null}
		</div>
	);
};
