/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useFloating, autoUpdate, offset, flip, shift, size } from '@floating-ui/react'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { ProviderName } from '../../../../common/vaderSettingsTypes.js'
import { PickerOption, pickerLayout, showSearchBox, groupByProvider, noMatchWords, addableLine, agoWords, friendlyModelName } from '../../../../common/modelPickerGroups.js'

// The model picker of the chat box (boards S04 and R06). One provider with a key: its live list of models. Several providers: the providers (logo, name, how many
// models), and a click on one opens its models. A search box appears when there are many models and finds across all providers. The states the boards show are
// here too: providers that have no key are offered (not hidden), a list that is being asked for keeps the saved one meanwhile, a list that could not be fetched says so
// and offers to try again, and a search that finds nothing says where it looked. Pure props, no editor services, so it is also what the tests and the design preview render.
// The class names are written out in each className on purpose: the build that scopes Tailwind to Vader's UI prefixes only the names it finds written there.

const Check = () => <svg className='size-3 flex-none' viewBox='0 0 12 12' fill='none' aria-hidden='true'><path d='M10 3L4.5 8.5L2 6' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' /></svg>
const Chevron = ({ open }: { open?: boolean }) => <svg className={`size-3 flex-none transition-transform duration-150 ${open ? 'rotate-90' : ''}`} viewBox='0 0 12 12' fill='none' aria-hidden='true'><path d='M4.5 2.5L8 6L4.5 9.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' /></svg>
const Caret = () => <svg className='size-3 flex-none' viewBox='0 0 12 12' fill='none' aria-hidden='true'><path d='M2.5 4.5L6 8L9.5 4.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' /></svg>
const Magnifier = () => <svg className='size-3 flex-none opacity-60' viewBox='0 0 12 12' fill='none' aria-hidden='true'><circle cx='5' cy='5' r='3.2' stroke='currentColor' strokeWidth='1.2' /><path d='m7.5 7.5 2.7 2.7' stroke='currentColor' strokeWidth='1.2' strokeLinecap='round' /></svg>
const Spinner = () => <svg className='size-3.5 flex-none motion-safe:animate-spin' viewBox='0 0 14 14' fill='none' aria-hidden='true'><circle cx='7' cy='7' r='5.2' stroke='currentColor' strokeOpacity='.25' strokeWidth='1.5' /><path d='M7 1.8a5.2 5.2 0 0 1 5.2 5.2' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' /></svg>
const Triangle = () => <svg className='size-3.5 flex-none' viewBox='0 0 15 15' aria-hidden='true'><path d='M7.5 2.2 13.3 12.6H1.7z' fill='none' stroke='#e2a93f' strokeWidth='1.3' strokeLinejoin='round' /></svg>

export type PickerProviderState = {
	providerName: string
	providerTitle: string
	/** loading: being asked for; error: could not be fetched (the saved list is shown); ok / idle: nothing to say */
	status: 'idle' | 'loading' | 'ok' | 'error'
	/** when the list last arrived, for "fetched just now" */
	fetchedAt?: number
}

export type ProviderModelPickerProps<S> = {
	options: readonly PickerOption<S>[]
	/** the option currently chosen (matched by provider and model name) */
	selected: { providerName: string, modelName: string } | undefined
	onChange: (option: PickerOption<S>) => void
	className?: string
	/** start with the popup open (design preview only) */
	defaultOpen?: boolean
	/** the providers that have a key and their lists' state; any not named here have nothing to say */
	providerStates?: readonly PickerProviderState[]
	/** providers that have no key yet: offered with Add, not hidden */
	withoutKey?: readonly { providerName: string, providerTitle: string }[]
	/** how many providers could still be added (the line under them) */
	addableCount?: number
	/** a provider's models are on this computer */
	isLocal?: (providerName: string) => boolean
	onRetry?: (providerName: string) => void
	/** Add a key (the provider's, or any with none given): opens the page of providers and keys */
	onAddKey?: (providerName?: string) => void
	/** called when the picker opens, so lists that are old can be asked for again */
	onOpen?: () => void
	now?: () => number
}

export const ProviderModelPicker = <S,>({ options, selected, onChange, className = '', defaultOpen = false, providerStates = [], withoutKey = [], addableCount, isLocal, onRetry, onAddKey, onOpen, now = Date.now }: ProviderModelPickerProps<S>) => {
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
	const stateOf = (providerName: string) => providerStates.find(s => s.providerName === providerName)
	const failed = providerStates.filter(s => s.status === 'error')
	const loading = providerStates.filter(s => s.status === 'loading')

	// close on a click outside, and on Escape
	useEffect(() => {
		if (!isOpen) return
		const onDown = (e: Event) => {
			const t = e.target as Node
			const floating = refs.floating.current, reference = refs.reference.current as HTMLElement | null
			if (floating && !floating.contains(t) && !(reference && reference.contains(t))) setIsOpen(false)
		}
		document.addEventListener('mousedown', onDown)
		return () => document.removeEventListener('mousedown', onDown)
	}, [isOpen, refs.floating, refs.reference])

	useEffect(() => {
		if (isOpen) { setQuery(''); setOpenProvider(selected?.providerName ?? layout.groups[0]?.providerName ?? null); queueMicrotask(() => searchRef.current?.focus()); onOpen?.() }
	}, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

	if (!selectedOption) return null

	const choose = (o: PickerOption<S>) => { onChange(o); setIsOpen(false) }
	const addKey = (providerName?: string) => { setIsOpen(false); onAddKey?.(providerName) }

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
		const name = friendlyModelName(o.providerName, o.modelName)
		const st = stateOf(o.providerName)
		const saved = st?.status === 'loading' || st?.status === 'error'
		return (
			<button
				key={o.providerName + '\u0000' + o.modelName}
				type='button' role='option' aria-selected={chosen} data-picker-row data-testid='vader-picker-model'
				title={withProvider ? `${o.modelName} (${o.providerTitle})` : o.modelName}
				onClick={() => choose(o)}
				className={`flex w-full items-center gap-2 h-[30px] pr-3 text-left text-[13px] whitespace-nowrap transition-colors duration-150 outline-none ${indent ? 'pl-8' : 'pl-3'} ${chosen ? 'bg-vader-bg-2-hover text-vader-fg-1' : 'text-vader-fg-1 hover:bg-vader-bg-2-hover focus:bg-vader-bg-2-hover'}`}
			>
				<span className={`truncate ${name.mono ? 'font-mono text-[12px]' : ''}`}>{name.text}</span>
				<span className='flex-1' />
				{saved ? <span className='text-vader-fg-3 text-xs' data-testid='vader-picker-saved'>saved list</span> : null}
				<span className='w-3 flex-none flex justify-center text-vader-fg-2'>{chosen && <Check />}</span>
			</button>
		)
	}

	const countWords = (providerName: string, n: number) => isLocal?.(providerName) ? `${n}, on this computer` : `${n}`
	const providerHeader = (providerName: string, title: string, count: number | null, open: boolean | null) => (
		<div className='flex items-center gap-2 h-[30px] px-3 text-[13px] text-vader-fg-1'>
			{open !== null ? <Chevron open={open} /> : <span className='w-3 flex-none' />}
			<ProviderLogo providerName={providerName as ProviderName} size={14} />
			<span className='truncate'>{title}</span>
			{count !== null && <span className='ml-auto pl-3 text-vader-fg-3 text-xs font-normal'>{countWords(providerName, count)}</span>}
		</div>
	)

	const askingRow = (title: string, indent: boolean) => (
		<div key={'asking-' + title} className={`flex items-center gap-2 h-[30px] pr-3 text-[13px] text-vader-fg-2 ${indent ? 'pl-8' : 'pl-3'}`} data-testid='vader-picker-asking'>
			<span className='truncate'>Asking {title}…</span><span className='flex-1' /><Spinner />
		</div>
	)

	let body: React.ReactNode
	if (layout.groups.length === 0) {
		const words = noMatchWords(query, Math.max(1, groupByProvider(options).length), withoutKey.map(w => w.providerTitle))
		body = <div className='px-3 py-3 flex flex-col gap-2' data-testid='vader-picker-nomatch'>
			<div className='text-vader-fg-1 text-[13px]'>{words.headline}</div>
			<div className='text-vader-fg-3 text-xs leading-relaxed'>{words.detail}</div>
			<div className='flex gap-2 pt-1'>
				{withoutKey.length > 0 && onAddKey ? <button type='button' data-testid='vader-picker-add-key' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-[13px] font-medium' onClick={() => addKey()}>Add a key</button> : null}
				<button type='button' data-testid='vader-picker-clear' className='px-2 py-1 text-vader-fg-2 hover:text-vader-fg-1 text-[13px]' onClick={() => { setQuery(''); searchRef.current?.focus() }}>Clear the search</button>
			</div>
		</div>
	}
	else if (layout.layout === 'providers') {
		// the providers; the one that is open lists its models
		body = layout.groups.map(g => {
			const open = openProvider === g.providerName
			const st = stateOf(g.providerName)
			return (
				<div key={g.providerName} role='group' aria-label={g.providerTitle}>
					<button
						type='button' data-picker-row data-testid='vader-picker-provider' aria-expanded={open}
						onClick={() => setOpenProvider(open ? null : g.providerName)}
						className='w-full text-left hover:bg-vader-bg-2-hover focus:bg-vader-bg-2-hover outline-none transition-colors duration-150'
					>{providerHeader(g.providerName, g.providerTitle, g.models.length, open)}</button>
					{open && <div>{g.models.map(m => modelRow(m, true, false))}{st?.status === 'loading' ? askingRow(g.providerTitle, true) : null}</div>}
				</div>
			)
		})
	}
	else if (layout.groups.length > 1) {
		// a search across several providers: the matches stay under their provider
		body = layout.groups.map(g => (
			<div key={g.providerName} role='group' aria-label={g.providerTitle}>
				<div className='flex items-center gap-2 h-7 px-3 text-xs text-vader-fg-3 border-t border-vader-border-3 first:border-t-0'><ProviderLogo providerName={g.providerName as ProviderName} size={12} /><span className='truncate'>{g.providerTitle}</span></div>
				{g.models.map(m => modelRow(m, true, true))}
			</div>
		))
	}
	else {
		const g = layout.groups[0]
		body = <>
			{g.models.map(m => modelRow(m, false, false))}
			{stateOf(g.providerName)?.status === 'loading' ? askingRow(g.providerTitle, false) : null}
		</>
	}

	const showUnkeyed = layout.layout === 'providers' && !layout.searching && withoutKey.length > 0
	const single = layout.singleProvider && options.length > 0 && !layout.searching ? groupByProvider(options)[0] : undefined
	const singleState = single ? stateOf(single.providerName) : undefined

	return (
		<div className={`inline-block relative ${className}`}>
			<button
				type='button' ref={refs.setReference} data-testid='vader-picker-button'
				aria-haspopup='listbox' aria-expanded={isOpen}
				title={`${selectedOption.modelName} (${selectedOption.providerTitle})`}
				className='flex items-center gap-1 h-4 bg-transparent whitespace-nowrap hover:brightness-90 max-w-full'
				onClick={() => setIsOpen(!isOpen)}
			>
				<ProviderLogo providerName={selectedOption.providerName as ProviderName} size={12} />
				<span className='truncate'>{friendlyModelName(selectedOption.providerName, selectedOption.modelName).text}</span>
				<Caret />
			</button>

			{isOpen && (
				<div
					ref={refs.setFloating} data-testid='vader-picker'
					role='listbox' aria-label='Choose a model'
					onKeyDown={onKeyDown}
					onWheel={(e) => e.stopPropagation()}
					className='motion-safe:animate-card-in z-[100] flex flex-col bg-vader-bg-1 border border-vader-border-2 rounded-lg shadow-lg text-vader-fg-2 overflow-hidden'
					style={{ position: strategy, top: y ?? 0, left: x ?? 0, width: 340, maxWidth: 'calc(100vw - 16px)' }}
				>
					{withSearch && (
						<div className='flex items-center gap-2 px-3 h-9 border-b border-vader-border-3'>
							<Magnifier />
							<input
								ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
								placeholder={`Search ${total} models`} aria-label='Search models' data-testid='vader-picker-search'
								className='flex-1 min-w-0 text-[13px] bg-transparent text-vader-fg-1 placeholder:text-vader-fg-3 outline-none'
							/>
						</div>
					)}
					{failed.map(f => (
						<div key={f.providerName} className='flex items-center gap-2 mx-2 mt-2 px-3 py-2 rounded-md border border-[#5b4a1f] bg-[#2a2415] text-[13px] text-vader-fg-1' data-testid='vader-picker-failed'>
							<Triangle /><span className='truncate'>{f.providerTitle} did not answer</span><span className='flex-1' />
							{onRetry ? <button type='button' data-testid='vader-picker-retry' className='text-vader-fg-2 hover:text-vader-fg-1 text-[13px]' onClick={() => onRetry(f.providerName)}>Try again</button> : null}
						</div>
					))}
					<div ref={listRef} className='overflow-auto py-1' style={{ maxHeight: 320 }}>{body}</div>
					{showUnkeyed && (
						<div className='border-t border-vader-border-3 py-1' data-testid='vader-picker-unkeyed'>
							{withoutKey.map(w => (
								<div key={w.providerName} className='flex items-center gap-2 h-[30px] px-3 text-[13px] text-vader-fg-1'>
									<span className='w-3 flex-none' /><ProviderLogo providerName={w.providerName as ProviderName} size={14} /><span className='truncate'>{w.providerTitle}</span>
									<span className='flex-1' /><span className='text-vader-fg-3 text-xs'>No key yet</span>
									{onAddKey ? <button type='button' data-testid='vader-picker-add' className='px-2.5 py-0.5 rounded border border-vader-border-2 text-vader-fg-1 hover:bg-vader-bg-2-hover text-xs transition-colors duration-150' onClick={() => addKey(w.providerName)}>Add</button> : null}
								</div>
							))}
							{addableCount && addableCount > 0 ? <div className='px-3 pt-1 pb-1 text-xs text-vader-fg-3 leading-relaxed' data-testid='vader-picker-addable'>{addableLine(addableCount)}</div> : null}
						</div>
					)}
					{failed.length > 0 ? <div className='px-3 py-2 border-t border-vader-border-3 text-xs text-vader-fg-3 leading-relaxed' data-testid='vader-picker-failed-note'>You can still send; only a model that is gone would fail.</div>
						: loading.length > 0 ? <div className='px-3 py-2 border-t border-vader-border-3 text-xs text-vader-fg-3 leading-relaxed' data-testid='vader-picker-loading-note'>Models are fetched when you open the picker and cached for 10 minutes.</div>
							: single ? (
								<div className='flex items-center gap-2 px-3 h-8 border-t border-vader-border-3 text-xs text-vader-fg-3' data-testid='vader-picker-footer'>
									<ProviderLogo providerName={single.providerName as ProviderName} size={12} />
									<span className='truncate'>{single.providerTitle}{singleState?.fetchedAt !== undefined ? `, fetched ${agoWords(now() - singleState.fetchedAt)}` : ` · ${total} models`}</span>
									<span className='flex-1' />
									{onAddKey ? <button type='button' data-testid='vader-picker-providers' className='hover:text-vader-fg-1' onClick={() => addKey()}>Providers and keys</button> : null}
								</div>
							) : onAddKey ? (
								<div className='flex items-center px-3 h-8 border-t border-vader-border-3 text-xs text-vader-fg-3'>
									<button type='button' data-testid='vader-picker-providers' className='hover:text-vader-fg-1' onClick={() => addKey()}>Providers and keys</button>
								</div>
							) : null}
				</div>
			)}
		</div>
	)
}
