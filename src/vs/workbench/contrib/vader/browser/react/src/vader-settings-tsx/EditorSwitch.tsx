/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react'
import { useAccessor } from '../util/services.js'
import { EditorInspection, TransferEditorType, TransferPart } from '../../../extensionTransferTypes.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import { Note } from './ui.js'

// Bringing the theme, the keybindings, the extensions list and the snippets over from another editor (Settings > Data and backup, and the second step of the first run).
// Nothing in the other editor is changed, and keys and chats are not copied. One button per editor: it first looks at what that editor has and offers it as a list of
// what can be brought over, to be ticked or not (board W02, "Settings from another editor"); nothing is done silently. Each step says what it is doing and what came
// out of it, including the real error.

type State =
	| { type: 'idle' } | { type: 'looking' }
	| { type: 'found', found: EditorInspection, picked: { [p in TransferPart]: boolean } }
	| { type: 'working' } | { type: 'done', parts: TransferPart[] } | { type: 'failed', message: string }

const PART_WORDS: { [p in TransferPart]: string } = { theme: 'Theme and keybindings', extensions: 'Extensions list', snippets: 'Snippets' }

export const EditorSwitchButton = ({ fromEditor }: { fromEditor: TransferEditorType }) => {
	const accessor = useAccessor()
	const transfer = accessor.get('IExtensionTransferService')
	const [state, setState] = useState<State>({ type: 'idle' })
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

	const look = async () => {
		if (state.type === 'looking' || state.type === 'working') return
		setState({ type: 'looking' })
		try {
			const found = await transfer.inspectEditor(os, fromEditor)
			if (!found.found) { setState({ type: 'failed', message: `${fromEditor} was not found on this computer, or it has no settings to bring over.` }); return }
			setState({ type: 'found', found, picked: { theme: found.theme, extensions: found.extensions > 0, snippets: found.snippets } })
		} catch (e) { setState({ type: 'failed', message: e instanceof Error ? e.message : String(e) }) }
	}
	const run = async (parts: TransferPart[]) => {
		setState({ type: 'working' })
		try {
			const error = await transfer.transferExtensions(os, fromEditor, parts)
			if (error) { setState({ type: 'failed', message: String(error) }); return }
			setState({ type: 'done', parts })
			timer.current = setTimeout(() => setState({ type: 'idle' }), 4000)
		} catch (e) { setState({ type: 'failed', message: e instanceof Error ? e.message : String(e) }) }
	}

	return <span className='c' style={{ gap: 6, alignItems: 'flex-start', minWidth: 0 }}>
		<button className='gb' data-testid='vader-switch-editor' data-editor={fromEditor} disabled={state.type === 'working' || state.type === 'looking'} onClick={() => void look()}>{state.type === 'working' ? 'Bringing it over...' : state.type === 'looking' ? 'Looking...' : `From ${fromEditor}`}</button>
		{state.type === 'found' ? <div className='c' style={{ gap: 8, padding: '12px 14px', border: '1px solid var(--ln2)', borderRadius: 10, background: 'var(--g2)', width: 300, maxWidth: '100%' }} data-testid='vader-switch-found' role='group' aria-label={`${fromEditor} settings found`}>
			<span className='t1' style={{ fontWeight: 600 }}>{fromEditor} settings found</span>
			<span className='t2' style={{ lineHeight: 1.5 }}>Vader can copy your theme, keybindings and extensions list. Keys and chats are not copied.</span>
			{(['theme', 'extensions', 'snippets'] as TransferPart[]).filter(p => p === 'theme' ? state.found.theme : p === 'extensions' ? state.found.extensions > 0 : state.found.snippets).map(p => <label key={p} className='r' style={{ gap: 8, cursor: 'pointer' }}>
				<input type='checkbox' data-testid={`vader-switch-part-${p}`} checked={state.picked[p]} onChange={e => setState({ ...state, picked: { ...state.picked, [p]: e.target.checked } })} />
				<span className='t1'>{PART_WORDS[p]}{p === 'extensions' ? ` (${state.found.extensions})` : ''}</span>
			</label>)}
			<span className='r' style={{ gap: 8, paddingTop: 2 }}>
				<button className='pb' data-testid='vader-switch-import' disabled={!Object.values(state.picked).some(Boolean)} onClick={() => void run((Object.keys(state.picked) as TransferPart[]).filter(p => state.picked[p]))}>Import</button>
				<button className='tx' data-testid='vader-switch-notnow' onClick={() => setState({ type: 'idle' })}>Not now</button>
			</span>
		</div> : null}
		{state.type === 'done' ? <Note kind='ok' testId='vader-switch-done'>Brought over from {fromEditor}: {state.parts.map(p => PART_WORDS[p].toLowerCase()).join(', ')}</Note> : null}
		{state.type === 'failed' ? <Note kind='warn' testId='vader-switch-failed'>{state.message}</Note> : null}
	</span>
}
