/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { waitingWords } from '../../../../common/terminalInput.js'
import type { InputPrompt } from '../../../../common/terminalInput.js'

// A command that is waiting for input (board S14): what it asked, and that the agent will not answer it (never a password). The person answers in the terminal. The class
// names are written out in each className on purpose: the build that scopes Tailwind to Vader's UI prefixes only the names it finds written there.

export const TerminalWaitingCard = ({ command, prompt, persistent, onOpen }: { command: string, prompt: InputPrompt, persistent: boolean, onOpen: () => void }) => {
	const w = waitingWords(command, prompt)
	return <div className='mx-2 mt-1 rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2' data-testid='vader-terminal-waiting' role='alert'>
		<div className='flex items-center gap-2'>
			<svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' className='shrink-0'><path d='M7.5 2.2 13.3 12.6H1.7z' fill='none' stroke='#e2a93f' strokeWidth='1.3' strokeLinejoin='round' /></svg>
			<span className='font-semibold text-vader-fg-1' data-testid='vader-terminal-waiting-title'>{w.title}</span>
		</div>
		<div className='text-vader-fg-2 leading-relaxed' data-testid='vader-terminal-waiting-body'><code className='font-mono text-[0.92em] text-vader-fg-1'>{w.name}</code>{w.body}</div>
		{persistent ? null : <div className='text-vader-fg-3 text-xs'>{w.stopped}</div>}
		<div className='flex gap-2'>
			<button type='button' data-testid='vader-terminal-waiting-open' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={onOpen}>{w.open}</button>
		</div>
	</div>
}
