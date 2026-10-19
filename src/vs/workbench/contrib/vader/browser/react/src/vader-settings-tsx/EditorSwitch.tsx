/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react'
import { useAccessor } from '../util/services.js'
import { TransferEditorType } from '../../../extensionTransferTypes.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import { Note } from './ui.js'

// Bringing the theme, the keybindings and the extensions over from another editor (Settings > Data and backup, and the second step of the first run). Nothing in the
// other editor is changed, and keys and chats are not copied. One button per editor; each says what it is doing and what came out of it, including the real error.

export const EditorSwitchButton = ({ fromEditor }: { fromEditor: TransferEditorType }) => {
	const accessor = useAccessor()
	const transfer = accessor.get('IExtensionTransferService')
	const [state, setState] = useState<{ type: 'idle' } | { type: 'working' } | { type: 'done' } | { type: 'failed', message: string }>({ type: 'idle' })
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

	const run = async () => {
		if (state.type === 'working') return
		setState({ type: 'working' })
		try {
			const error = await transfer.transferExtensions(os, fromEditor)
			if (error) { setState({ type: 'failed', message: String(error) }); return }
			setState({ type: 'done' })
			timer.current = setTimeout(() => setState({ type: 'idle' }), 4000)
		} catch (e) { setState({ type: 'failed', message: e instanceof Error ? e.message : String(e) }) }
	}

	return <span className='c' style={{ gap: 6, alignItems: 'flex-start', minWidth: 0 }}>
		<button className='gb' data-testid='vader-switch-editor' data-editor={fromEditor} disabled={state.type === 'working'} onClick={() => void run()}>{state.type === 'working' ? 'Bringing it over...' : `From ${fromEditor}`}</button>
		{state.type === 'done' ? <Note kind='ok' testId='vader-switch-done'>Brought over from {fromEditor}</Note> : null}
		{state.type === 'failed' ? <Note kind='warn' testId='vader-switch-failed'>{state.message}</Note> : null}
	</span>
}
