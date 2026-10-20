/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useMemo, useState } from 'react'
import { useAccessor, useCommandBarState } from '../util/services.js'
import type { Diff } from '../../../../common/editCodeServiceTypes.js'
import { fileCounts } from '../../../../common/reviewModel.js'
import { Icon } from './icons.js'
import { WindowStrip } from './WindowStrip.js'
import { useShellData } from './useShellData.js'

// The strip of the Vader window (board R01): the mark, the button that hides the sidebar, the project, and on the right what the task changed, which opens its review.

/** what the open task has changed and not settled yet, as the Review page counts it: files, lines added, lines removed */
export const useReviewTotals = (): { files: number, added: number, removed: number } => {
	const accessor = useAccessor()
	const edit = accessor.get('IEditCodeService')
	const { stateOfURI, sortedURIs } = useCommandBarState()
	return useMemo(() => {
		let files = 0, added = 0, removed = 0
		for (const uri of sortedURIs) {
			const st = stateOfURI[uri.fsPath]
			const diffs = (st?.sortedDiffIds ?? []).map(id => edit.diffOfId[id]).filter((d): d is Diff => !!d)
			if (diffs.length === 0 && !st?.isStreaming) continue
			const c = fileCounts(diffs)
			files++; added += c.added; removed += c.removed
		}
		return { files, added, removed }
	}, [sortedURIs, stateOfURI, edit])
}

const ProjectMenu = ({ name }: { name: string }) => {
	const accessor = useAccessor()
	const commands = accessor.get('ICommandService')
	const [open, setOpen] = useState(false)
	const run = (id: string) => { setOpen(false); void commands.executeCommand(id) }
	return <span style={{ position: 'relative' }}>
		<button className='tx t1' style={{ padding: '0 8px' }} aria-haspopup='menu' aria-expanded={open} data-testid='vader-strip-project' onClick={() => setOpen(o => !o)}>{name}<Icon k='down' small /></button>
		{open ? <>
			<div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onMouseDown={() => setOpen(false)} />
			<div className='pop c' role='menu' data-testid='vader-strip-project-menu' style={{ position: 'absolute', left: 0, top: 32, zIndex: 41, width: 220, padding: 4 }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }}>
				<button className='opt' role='menuitem' data-testid='vader-strip-open-folder' onClick={() => run('workbench.action.files.openFolder')}>Open a folder{'…'}</button>
				<button className='opt' role='menuitem' data-testid='vader-strip-open-recent' onClick={() => run('workbench.action.openRecent')}>Open a recent project{'…'}</button>
			</div>
		</> : null}
	</span>
}

export const ShellStrip = ({ navOpen, onToggleNav }: { navOpen: boolean, onToggleNav: () => void }) => {
	const accessor = useAccessor()
	const shellService = accessor.get('IVaderShellService')
	const data = useShellData()
	const totals = useReviewTotals()
	const thread = data.all.find(t => t.id === data.currentId)
	// the task's own copy of the project (while it has one) knows its totals before any file is open in the editor
	const files = totals.files > 0 ? totals.files : thread?.copy?.files ?? 0
	const added = totals.files > 0 ? totals.added : thread?.copy?.added
	const removed = totals.files > 0 ? totals.removed : thread?.copy?.removed
	return <WindowStrip>
		<button className='ic' aria-label={navOpen ? 'Hide sidebar' : 'Show sidebar'} aria-pressed={!navOpen} data-testid='vader-strip-sidebar' onClick={onToggleNav}><Icon k='panel' /></button>
		<ProjectMenu name={data.currentProjectName || 'No project'} />
		<span className='fl' />
		{thread?.isTask && files > 0 ? <button className='tx' style={{ gap: 8 }} data-testid='vader-strip-review' onClick={() => shellService.setTab('review')}>
			<span>Review</span><span className='t3'>{files} {files === 1 ? 'file' : 'files'}</span>
			{added !== undefined ? <span className='add'>+{added}</span> : null}{removed !== undefined ? <span className='del'>{'−'}{removed}</span> : null}
		</button> : null}
	</WindowStrip>
}
