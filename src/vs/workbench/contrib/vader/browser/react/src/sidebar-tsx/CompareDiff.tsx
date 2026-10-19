/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { changeWords, sideBySide } from '../../../../common/checkpointModel.js'

// "Compare 1 and 3" opened as a diff (board S13): one file as it was at the first checkpoint beside what it was at the last, changed lines marked, the rest folded into
// "N unchanged lines". It opens over the window, since a popover is too narrow for two columns. The class names are written out in each className on purpose: the build
// that scopes Tailwind to Vader's UI prefixes only the names it finds written there.

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

export const CompareDiff = ({ path, before, after, from, to, added, removed, host, onClose }: { path: string, before: string, after: string, from: number, to: number, added: number, removed: number, host: Element | null, onClose: () => void }) => {
	const rows = useMemo(() => sideBySide(before, after, 3), [before, after])
	useEffect(() => {
		const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
		document.addEventListener('keydown', esc, true)
		return () => document.removeEventListener('keydown', esc, true)
	}, [onClose])

	const cell = (c: { no: number, text: string, changed: boolean } | undefined, side: 'left' | 'right') => {
		const tint = c?.changed ? (side === 'left' ? 'bg-red-500/15' : 'bg-green-500/15') : ''
		return <div className={`flex min-w-0 ${tint}`}>
			<span className='w-10 shrink-0 text-right pr-2 text-vader-fg-4 select-none tabular-nums'>{c?.no ?? ''}</span>
			<span className='w-3 shrink-0 text-vader-fg-3 select-none'>{c?.changed ? (side === 'left' ? '−' : '+') : ''}</span>
			<span className='whitespace-pre-wrap break-words min-w-0 flex-1 text-vader-fg-1'>{c?.text ?? ''}</span>
		</div>
	}

	const panel = <div role='dialog' aria-modal='true' aria-label={`Changes in ${baseName(path)}`} data-testid='vader-compare-diff' className='vader-scope fixed inset-0 z-[1000] flex items-center justify-center bg-black/50' onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
		<div className='motion-safe:animate-card-in w-[min(960px,calc(100vw-32px))] max-h-[80vh] flex flex-col rounded-xl border border-vader-border-2 bg-vader-bg-1 shadow-2xl overflow-hidden'>
			<div className='flex items-center gap-3 px-4 py-3 border-b border-vader-border-3'>
				<span className='font-semibold text-vader-fg-1 truncate' title={path} data-testid='vader-compare-title'>{baseName(path)}</span>
				<span className='text-xs text-vader-fg-3' data-testid='vader-compare-between'>checkpoint {from} to {to}</span>
				<span className='flex-1' />
				<span className='text-xs text-vader-fg-2 tabular-nums' data-testid='vader-compare-counts'>{changeWords(added, removed)}</span>
				<button type='button' data-testid='vader-compare-close' aria-label='Close' className='px-2 text-vader-fg-3 hover:text-vader-fg-1 text-lg leading-none' onClick={onClose}>&times;</button>
			</div>
			<div className='grid grid-cols-2 text-xs text-vader-fg-3 border-b border-vader-border-3'>
				<div className='px-4 py-1.5'>At checkpoint {from}</div>
				<div className='px-4 py-1.5 border-l border-vader-border-3'>At checkpoint {to}</div>
			</div>
			<div className='overflow-auto font-mono text-[12px] leading-5' data-testid='vader-compare-rows'>
				{rows.length === 0 ? <div className='px-4 py-6 text-vader-fg-2 font-sans'>The two versions are the same.</div> : rows.map((r, i) => r.gap !== undefined
					? <div key={i} className='grid grid-cols-2 bg-vader-bg-2 text-vader-fg-3 font-sans' data-testid='vader-compare-gap'><div className='px-4 py-0.5 col-span-2 text-center'>{r.gap} unchanged line{r.gap === 1 ? '' : 's'}</div></div>
					: <div key={i} className='grid grid-cols-2' data-testid='vader-compare-row'>{cell(r.left, 'left')}<div className='border-l border-vader-border-3 min-w-0'>{cell(r.right, 'right')}</div></div>)}
			</div>
		</div>
	</div>
	return host ? createPortal(panel, host) : panel
}
