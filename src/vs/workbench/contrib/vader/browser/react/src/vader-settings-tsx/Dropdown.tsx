/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../vader-shell-tsx/icons.js'

// The drop-down of Settings and of the first run, drawn like the rest of the interface (boards R08 to R30) in place of the system's list: a box with what is chosen and a
// chevron, and a list under it (above it when there is no room) with a check on the chosen one. It opens over everything (position: fixed, so no page clips it), scrolls
// when it is long, and is used with the keyboard: Up, Down, Enter, Escape. Each option may have a mark, and a second line.

export type DropOption = { value: string, label: string, detail?: string, mark?: React.ReactNode }

export const Dropdown = ({ value, options, onChange, testId, label, width = 250, placeholder, disabled }: {
	value: string, options: DropOption[], onChange: (value: string) => void, testId: string,
	/** what a screen reader says for the box */
	label: string, width?: number | string, placeholder?: string, disabled?: boolean,
}) => {
	const [open, setOpen] = useState(false)
	const [active, setActive] = useState(0)
	const [place, setPlace] = useState<{ left: number, top?: number, bottom?: number, width: number, max: number }>({ left: 0, width: 0, max: 300 })
	const box = useRef<HTMLButtonElement>(null)
	const list = useRef<HTMLDivElement>(null)
	const current = options.find(o => o.value === value)

	useLayoutEffect(() => {
		if (!open || !box.current) { return }
		const r = box.current.getBoundingClientRect()
		const below = window.innerHeight - r.bottom - 12, above = r.top - 12
		const up = below < 180 && above > below
		setPlace({ left: r.left, width: Math.max(r.width, 200), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }), max: Math.max(140, Math.min(320, up ? above : below)) })
		setActive(Math.max(0, options.findIndex(o => o.value === value)))
	}, [open]) // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!open) { return }
		const away = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !box.current?.contains(e.target as Node)) { setOpen(false) } }
		const close = () => setOpen(false)
		document.addEventListener('mousedown', away)
		window.addEventListener('resize', close)
		return () => { document.removeEventListener('mousedown', away); window.removeEventListener('resize', close) }
	}, [open])

	useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active, open])

	const pick = (o: DropOption) => { setOpen(false); box.current?.focus(); if (o.value !== value) { onChange(o.value) } }
	const onKey = (e: React.KeyboardEvent) => {
		if (!open) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } return }
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); box.current?.focus(); return }
		const focusedIndex = (e.target as HTMLElement).getAttribute('data-index')
		const from = focusedIndex === null ? active : Number(focusedIndex)
		const move = (next: number) => {
			setActive(next)
			if (focusedIndex !== null) list.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus()
		}
		// Focused option buttons already activate natively. Hover may have moved
		// the visual highlight; it must never override Enter/Space on that button.
		if (focusedIndex !== null && (e.key === 'Enter' || e.key === ' ')) return
		if (e.key === 'ArrowDown') { e.preventDefault(); move(Math.min(options.length - 1, from + 1)) }
		else if (e.key === 'ArrowUp') { e.preventDefault(); move(Math.max(0, from - 1)) }
		else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = options[active]; if (o) { pick(o) } }
	}

	return <span style={{ position: 'relative', display: 'inline-flex', width }} onKeyDown={onKey}>
		<button ref={box} type='button' className='fld' data-testid={testId} data-value={value} aria-label={label} aria-haspopup='listbox' aria-expanded={open} disabled={disabled} style={{ width: '100%', gap: 8, justifyContent: 'flex-start' }} onClick={() => setOpen(v => !v)}>
			{current?.mark ? <span style={{ display: 'flex', flex: 'none' }}>{current.mark}</span> : null}
			<span className='fl tr' style={{ textAlign: 'start', color: current ? 'var(--t1)' : 'var(--t3)' }}>{current?.label ?? placeholder ?? ''}</span>
			<span style={{ display: 'flex', color: 'var(--t3)', flex: 'none' }}><Icon k='down' small /></span>
		</button>
		{open ? <div ref={list} role='listbox' aria-label={label} data-testid={`${testId}-list`} className='menu' style={{ position: 'fixed', left: place.left, top: place.top, bottom: place.bottom, width: place.width, maxHeight: place.max, overflowY: 'auto', zIndex: 2000, right: 'auto' }}>
			{options.length === 0 ? <span className='t3' style={{ padding: '8px 10px' }}>Nothing to choose from yet</span> : options.map((o, i) =>
				<button key={o.value} type='button' role='option' data-index={i} data-value={o.value} data-testid={`${testId}-option`} aria-selected={o.value === value} aria-checked={o.value === value} style={{ height: o.detail ? 44 : 30, background: i === active ? 'var(--g3)' : undefined, color: i === active || o.value === value ? 'var(--t1)' : undefined }}
					onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => pick(o)}>
					<span style={{ width: 14, display: 'flex', flex: 'none', color: 'var(--t1)' }}>{o.value === value ? <Icon k='check' small /> : null}</span>
					{o.mark ? <span style={{ display: 'flex', flex: 'none' }}>{o.mark}</span> : null}
					<span className='c' style={{ minWidth: 0, textAlign: 'start' }}><span className='tr'>{o.label}</span>{o.detail ? <span className='hint tr'>{o.detail}</span> : null}</span>
				</button>)}
		</div> : null}
	</span>
}
