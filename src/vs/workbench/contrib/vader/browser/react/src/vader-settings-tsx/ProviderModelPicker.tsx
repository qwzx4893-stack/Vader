/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useFloating, autoUpdate, offset, flip, shift, size } from '@floating-ui/react'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { ProviderName } from '../../../../common/vaderSettingsTypes.js'
import { PickerOption, pickerLayout, showSearchBox, groupByProvider } from '../../../../common/modelPickerGroups.js'

// The model picker of the chat box. One provider with a key: its live list of models. Several providers: the providers (logo, name, how many models), and a click on
// one opens its models. A search box appears when there are many models and finds across all providers. Pure props, no editor services, so it is also what the
// design preview renders.

const Check = () => <svg className='size-3 flex-none' viewBox='0 0 12 12' fill='none' aria-hidden='true'><path d='M10 3L4.5 8.5L2 6' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' /></svg>
const Chevron = ({ open }: { open?: boolean }) => <svg className={`size-3 flex-none transition-transform duration-100 ${open ? 'rotate-90' : ''}`} viewBox='0 0 12 12' fill='none' aria-hidden='true'><path d='M4.5 2.5L8 6L4.5 9.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' /></svg>
const Caret = () => <svg className='size-3 flex-none' viewBox='0 0 12 12' fill='none' aria-hidden='true'><path d='M2.5 4.5L6 8L9.5 4.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' /></svg>

export type ProviderModelPickerProps<S> = {
	options: readonly PickerOption<S>[]
	/** the option currently chosen (matched by provider and model name) */
	selected: { providerName: string, modelName: string } | undefined
	onChange: (option: PickerOption<S>) => void
	className?: string
	/** start with the popup open (design preview only) */
	defaultOpen?: boolean
}

export const ProviderModelPicker = <S,>({ options, selected, onChange, className = '', defaultOpen = false }: ProviderModelPickerProps<S>) => {
	const [isOpen, setIsOpen] = useState(defaultOpen)
	const [query, setQuery] = useState('')
	const [openProvider, setOpenProvider] = useState<string | null>(selected?.providerName ?? null)
	const searchRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)

	const { x, y, strategy, refs } = useFloating({
		open: isOpen,
		onOpenChange: setIsOpen,
		placement: 'bottom-start',
		middleware: [
			offset({ mainAxis: 2, crossAxis: -6 }),
			flip({ boundary: document.body, padding: 8 }),
			shift({ boundary: document.body, padding: 8 }),
			size({ apply({ availableHeight, elements }) { Object.assign(elements.floating.style, { maxHeight: `${Math.max(160, availableHeight)}px` }) }, padding: 8, boundary: document.body }),
		],
		whileElementsMounted: autoUpdate,
		strategy: 'fixed',
	})

	const isChosen = (o: PickerOption<S>) => !!selected && o.providerName === selected.providerName && o.modelName === selected.modelName
	const selectedOption = useMemo(() => options.find(isChosen) ?? options[0], [options, selected]) // eslint-disable-line react-hooks/exhaustive-deps
	const total = options.length
	const layout = pickerLayout(options, query)
	const withSearch = showSearchBox(total)

	// close on a click outside, and on Escape
	useEffect(() => {
		if (!isOpen) return
		const onDown = (e: MouseEvent) => {
			const t = e.target as Node
			const floating = refs.floating.current, reference = refs.reference.current as HTMLElement | null
			if (floating && !floating.contains(t) && !(reference && reference.contains(t))) setIsOpen(false)
		}
		document.addEventListener('mousedown', onDown)
		return () => document.removeEventListener('mousedown', onDown)
	}, [isOpen, refs.floating, refs.reference])

	useEffect(() => {
		if (isOpen) { setQuery(''); setOpenProvider(selected?.providerName ?? layout.groups[0]?.providerName ?? null); queueMicrotask(() => searchRef.current?.focus()) }
	}, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

	if (!selectedOption) return null

	const choose = (o: PickerOption<S>) => { onChange(o); setIsOpen(false) }

	// arrow keys move between the rows; Enter on a row chooses it (the rows are buttons)
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Escape') { setIsOpen(false); (refs.reference.current as HTMLElement | null)?.focus(); return }
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
		const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-picker-row]') ?? [])
		if (rows.length === 0) return
		e.preventDefault()
		const at = rows.indexOf(document.activeElement as HTMLElement)
		const next = e.key === 'ArrowDown' ? (at + 1) % rows.length : (at <= 0 ? rows.length - 1 : at - 1)
		rows[next].focus()
	}

	const modelRow = (o: PickerOption<S>, indent: boolean, withProvider: boolean) => {
		const chosen = isChosen(o)
		return (
			<button
				key={o.providerName + '\u0000' + o.modelName}
				type='button' role='option' aria-selected={chosen} data-picker-row
				title={withProvider ? `${o.modelName} (${o.providerTitle})` : o.modelName}
				onClick={() => choose(o)}
				className={`flex w-full items-center gap-1.5 py-1 pr-3 text-left text-xs whitespace-nowrap transition-colors duration-100 ${indent ? 'pl-7' : 'pl-2'} ${chosen ? 'bg-blue-500 text-white/80' : 'hover:bg-blue-500 hover:text-white/80 focus:bg-blue-500 focus:text-white/80'} outline-none`}
			>
				<span className='w-3 flex-none flex justify-center'>{chosen && <Check />}</span>
				<span className='truncate'>{o.modelName}</span>
			</button>
		)
	}

	const providerHeader = (providerName: string, title: string, count: number | null, open: boolean | null) => (
		<div className='flex items-center gap-1.5 px-2 py-1 text-xs font-medium'>
			{open !== null && <Chevron open={open} />}
			<ProviderLogo providerName={providerName as ProviderName} size={13} />
			<span className='truncate'>{title}</span>
			{count !== null && <span className='ml-auto pl-3 opacity-60 font-normal'>{count}</span>}
		</div>
	)

	let body: React.ReactNode
	if (layout.groups.length === 0) {
		body = <div className='px-3 py-2 text-xs opacity-60'>No model matches "{query.trim()}"</div>
	}
	else if (layout.layout === 'providers') {
		// the providers; the one that is open lists its models
		body = layout.groups.map(g => {
			const open = openProvider === g.providerName
			return (
				<div key={g.providerName} role='group' aria-label={g.providerTitle}>
					<button
						type='button' data-picker-row aria-expanded={open}
						onClick={() => setOpenProvider(open ? null : g.providerName)}
						className='w-full text-left hover:bg-vader-bg-2 focus:bg-vader-bg-2 outline-none'
					>{providerHeader(g.providerName, g.providerTitle, g.models.length, open)}</button>
					{open && <div>{g.models.map(m => modelRow(m, true, false))}</div>}
				</div>
			)
		})
	}
	else if (layout.groups.length > 1) {
		// a search across several providers: the matches stay under their provider
		body = layout.groups.map(g => (
			<div key={g.providerName} role='group' aria-label={g.providerTitle}>
				<div className='opacity-80 border-t border-vader-border-3 first:border-t-0'>{providerHeader(g.providerName, g.providerTitle, g.models.length, null)}</div>
				{g.models.map(m => modelRow(m, true, true))}
			</div>
		))
	}
	else {
		body = layout.groups[0].models.map(m => modelRow(m, false, false))
	}

	return (
		<div className={`inline-block relative ${className}`}>
			<button
				type='button' ref={refs.setReference}
				aria-haspopup='listbox' aria-expanded={isOpen}
				title={`${selectedOption.modelName} (${selectedOption.providerTitle})`}
				className='flex items-center gap-1 h-4 bg-transparent whitespace-nowrap hover:brightness-90 max-w-full'
				onClick={() => setIsOpen(!isOpen)}
			>
				<ProviderLogo providerName={selectedOption.providerName as ProviderName} size={12} />
				<span className='truncate'>{selectedOption.modelName}</span>
				<Caret />
			</button>

			{isOpen && (
				<div
					ref={refs.setFloating}
					role='listbox' aria-label='Choose a model'
					onKeyDown={onKeyDown}
					onWheel={(e) => e.stopPropagation()}
					className='z-[100] flex flex-col bg-vader-bg-1 border border-vader-border-3 rounded shadow-lg text-vader-fg-2'
					style={{ position: strategy, top: y ?? 0, left: x ?? 0, width: 280, maxWidth: 'calc(100vw - 16px)' }}
				>
					{withSearch && (
						<div className='p-1.5 border-b border-vader-border-3'>
							<input
								ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
								placeholder={`Search ${total} models`} aria-label='Search models'
								className='w-full text-xs px-2 py-1 rounded bg-vader-bg-2 border border-vader-border-2 text-vader-fg-1 outline-none focus:border-blue-500'
							/>
						</div>
					)}
					<div ref={listRef} className='overflow-auto py-1' style={{ maxHeight: 320 }}>{body}</div>
					{layout.singleProvider && options.length > 0 && !layout.searching && (
						<div className='flex items-center gap-1.5 px-2 py-1 border-t border-vader-border-3 text-xs opacity-60'>
							<ProviderLogo providerName={options[0].providerName as ProviderName} size={12} />
							<span className='truncate'>{groupByProvider(options)[0].providerTitle} · {total} models</span>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
