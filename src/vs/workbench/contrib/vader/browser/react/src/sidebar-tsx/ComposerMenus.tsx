/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react'

// The two small menus of the message box (board R06): Mode and Permissions. Each row has a name, what it does in a line under it, and, on the right, a shortcut or the
// check of the one chosen. They open above the box, move with the arrows, choose with Enter or a click, and close with Escape or a click elsewhere.
// The class names are written out in each className on purpose: the build that scopes Tailwind to Vader's UI prefixes only the names it finds written there.

const Caret = () => <svg className='size-3 flex-none' viewBox='0 0 12 12' fill='none' aria-hidden='true'><path d='M2.5 4.5L6 8L9.5 4.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' /></svg>
const Check = () => <svg className='size-3 flex-none' viewBox='0 0 12 12' fill='none' aria-hidden='true'><path d='M10 3L4.5 8.5L2 6' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' /></svg>

export type ChoiceRow<T extends string> = { readonly value: T, readonly name: string, readonly detail: string, /** a shortcut shown on the right, e.g. "Ctrl 1" */ readonly shortcut?: string }

export const ChoiceMenu = <T extends string>({ testId, label, rows, value, onChange, footer, className = '', width = 300 }: {
	testId: string, label: string, rows: readonly ChoiceRow<T>[], value: T, onChange: (v: T) => void,
	/** a line under the rows (what no choice here can change) */
	footer?: string, className?: string, width?: number,
}) => {
	const [open, setOpen] = useState(false)
	const [mark, setMark] = useState(0)
	const ref = useRef<HTMLDivElement>(null)
	const current = rows.find(r => r.value === value) ?? rows[0]
	useEffect(() => {
		if (!open) return
		const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
		document.addEventListener('mousedown', away)
		return () => document.removeEventListener('mousedown', away)
	}, [open])
	const openIt = () => { setMark(Math.max(0, rows.findIndex(r => r.value === value))); setOpen(true) }
	const choose = (v: T) => { onChange(v); setOpen(false); (ref.current?.querySelector('button[aria-haspopup]') as HTMLElement | null)?.focus() }
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (!open) return
		if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return }
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMark(m => (m + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length); return }
		if (e.key === 'Enter') { e.preventDefault(); choose(rows[mark].value) }
	}
	if (!current) return null
	return <div ref={ref} className={`relative inline-block ${className}`} onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}>
		<button type='button' data-testid={testId} aria-haspopup='listbox' aria-expanded={open} aria-label={label} onClick={() => open ? setOpen(false) : openIt()}
			className='flex items-center gap-1 h-7 px-1.5 rounded-md bg-transparent whitespace-nowrap hover:text-vader-fg-1 hover:bg-vader-bg-2-hover transition-colors duration-150'>
			<span>{current.name}</span><Caret />
		</button>
		{open ? <div role='listbox' aria-label={label} data-testid={testId + '-menu'}
			className='motion-safe:animate-card-in absolute bottom-full left-0 mb-2 z-50 rounded-xl border border-vader-border-2 bg-vader-bg-1 shadow-lg overflow-hidden' style={{ width, maxWidth: 'calc(100vw - 24px)' }}>
			{rows.map((r, i) => <button key={r.value} type='button' role='option' aria-selected={r.value === value} data-testid={testId + '-option'} data-value={r.value}
				onMouseEnter={() => setMark(i)} onClick={() => choose(r.value)}
				className={`flex flex-col w-full text-left px-4 py-2.5 gap-0.5 transition-colors duration-100 ${i === mark ? 'bg-vader-bg-2-hover' : ''}`}>
				<span className='flex items-center gap-2 text-[13px] text-vader-fg-1'>
					<span>{r.name}</span><span className='flex-1' />
					{r.shortcut ? <span className='text-vader-fg-3 text-xs'>{r.shortcut}</span> : r.value === value ? <span className='text-vader-fg-2'><Check /></span> : null}
				</span>
				<span className='text-xs text-vader-fg-3 leading-relaxed whitespace-normal'>{r.detail}</span>
			</button>)}
			{footer ? <div className='px-4 py-2.5 border-t border-vader-border-3 text-xs text-vader-fg-3 leading-relaxed whitespace-normal' data-testid={testId + '-footer'}>{footer}</div> : null}
		</div> : null}
	</div>
}
