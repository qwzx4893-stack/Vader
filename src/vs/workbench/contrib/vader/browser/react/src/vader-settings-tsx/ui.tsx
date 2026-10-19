/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react'
import { NumberInput } from '../../../../common/settingsInput.js'

// The parts every Settings page is made of, in the shape of the interface boards (R08 to R30): a title with one short paragraph, small group labels in sentence
// case, rows between hairlines, a switch that is a button (so it is reached by the keyboard and read by a screen reader), a two-way choice. Class names are
// written as literals; the build prefixes them and shell.css styles them.

/** a question with two answers, over the page: what will happen, and what stays (boards S10 and S11). Escape or a click outside is Cancel. */
export const Ask = ({ title, text, yes, onYes, onNo, testId, danger }: { title: string, text: string, yes: string, onYes: () => void, onNo: () => void, testId: string, danger?: boolean }) =>
	<div role='alertdialog' aria-modal='true' aria-label={title} data-testid={testId} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onNo() } }} onMouseDown={e => { if (e.target === e.currentTarget) onNo() }}
		style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
		<div className='c' style={{ width: 400, maxWidth: 'calc(100vw - 32px)', padding: '20px 22px', gap: 10, background: 'var(--g2)', border: '1px solid var(--ln2)', borderRadius: 14, boxShadow: '0 16px 40px rgba(0,0,0,.55)' }}>
			<span className='t1' style={{ fontWeight: 600, fontSize: 16 }} data-testid={`${testId}-title`}>{title}</span>
			<span className='t2' style={{ lineHeight: 1.55 }} data-testid={`${testId}-text`}>{text}</span>
			<span className='r' style={{ gap: 8, justifyContent: 'flex-end', paddingTop: 6 }}>
				<button className='gb' data-testid={`${testId}-no`} autoFocus onClick={onNo}>Cancel</button>
				<button className='pb' data-testid={`${testId}-yes`} style={danger ? { background: '#f06a6e', color: '#000' } : undefined} onClick={onYes}>{yes}</button>
			</span>
		</div>
	</div>

export const PageHead = ({ title, desc, right }: { title: string, desc?: React.ReactNode, right?: React.ReactNode }) => <div className='c' style={{ gap: 6, marginBottom: 22 }}>
	<div className='r' style={{ gap: 12 }}><h1 className='ttl fl' style={{ margin: 0 }}>{title}</h1>{right}</div>
	{desc ? <p className='t2' style={{ margin: 0, maxWidth: 520, lineHeight: 1.55 }}>{desc}</p> : null}
</div>

export const Group = ({ title, note, right, children, first }: { title: string, note?: React.ReactNode, right?: React.ReactNode, children?: React.ReactNode, first?: boolean }) => <section className='c' style={{ marginTop: first ? 0 : 28 }}>
	<div className='r' style={{ gap: 8, padding: '0 2px 8px' }}><span className='hint'>{title}{note ? <span className='t4'> {note}</span> : null}</span><span className='fl' />{right}</div>
	{children}
</section>

/** one line of a list: what it is on the left, what is set or what can be done on the right */
export const Line = ({ title, detail, right, testId, first }: { title: React.ReactNode, detail?: React.ReactNode, right?: React.ReactNode, testId?: string, first?: boolean }) => <div className='r' data-testid={testId} style={{ gap: 14, minHeight: 44, padding: '8px 0', borderTop: first === false ? undefined : '1px solid var(--ln)' }}>
	<div className='c fl' style={{ gap: 1, minWidth: 0 }}><span className='t1'>{title}</span>{detail ? <span className='hint' style={{ lineHeight: 1.45 }}>{detail}</span> : null}</div>
	{right}
</div>

export const Switch = ({ on, onChange, label, testId }: { on: boolean, onChange: (v: boolean) => void, label: string, testId?: string }) =>
	<button role='switch' aria-checked={on} aria-label={label} data-testid={testId} className={on ? 'sw' : 'sw off'} onClick={() => onChange(!on)}><i /></button>

export const Segmented = ({ value, options, onChange, testId }: { value: string, options: { id: string, label: string }[], onChange: (id: string) => void, testId?: string }) =>
	<div className='r' role='radiogroup' data-testid={testId} style={{ gap: 2, padding: 2, border: '1px solid var(--ln2)', borderRadius: 9, alignSelf: 'flex-start', background: 'var(--g0)' }}>
		{options.map(o => <button key={o.id} role='radio' aria-checked={value === o.id} data-testid={testId ? `${testId}-${o.id}` : undefined} className={value === o.id ? 'ag on' : 'ag'} style={{ width: 'auto', height: 28, padding: '0 14px' }} onClick={() => onChange(o.id)}>{o.label}</button>)}
	</div>

/** the lock mark of a rule that cannot be turned off */
export const LockMark = () => <svg className='i' viewBox='0 0 24 24' aria-hidden='true' style={{ width: 13, height: 13, color: 'var(--t4)' }}><rect x='5' y='11' width='14' height='9' rx='2' /><path d='M8 11V8a4 4 0 0 1 8 0v3' /></svg>

export const Field = ({ label, children, width }: { label: string, children: React.ReactNode, width?: number | string }) => <label className='c' style={{ gap: 5, width }}><span className='hint'>{label}</span>{children}</label>

/** a short result sentence with a mark: green for done, amber for a problem */
export const Note = ({ kind, children, testId }: { kind: 'ok' | 'warn' | 'plain', children: React.ReactNode, testId?: string }) =>
	<span className='r' data-testid={testId} role={kind === 'warn' ? 'alert' : undefined} style={{ gap: 7, overflowWrap: 'anywhere', color: kind === 'ok' ? '#4cc38a' : kind === 'warn' ? 'var(--wa)' : 'var(--t2)' }}>{kind === 'ok' ? '✓' : kind === 'warn' ? '△' : null}<span>{children}</span></span>

/**
 * A number typed into Settings (board S10): it is read when the person leaves the box or presses Enter. A value that cannot be used is refused with words under the
 * box and the text stays so it can be fixed; one that can is saved, and the box says what was set. `initial` is the saved value as text.
 */
export const NumberBox = ({ initial, parse, onCommit, saved, label, placeholder, testId, prefix, suffix, width = 96, disabled }: {
	initial: string, parse: (text: string) => NumberInput, onCommit: (value: number | null) => void, saved?: (value: number | null) => string, label: string,
	placeholder?: string, testId: string, prefix?: string, suffix?: string, width?: number, disabled?: boolean,
}) => {
	const [text, setText] = useState(initial)
	const [problem, setProblem] = useState<string | undefined>()
	const [done, setDone] = useState<string | undefined>()
	const focused = useRef(false)
	// the saved value changed somewhere else: show it, unless the person is typing here
	useEffect(() => { if (!focused.current) { setText(initial); setProblem(undefined) } }, [initial])
	const commit = () => {
		const r = parse(text)
		if (!r.ok) { setProblem(r.message); setDone(undefined); return }
		setProblem(undefined)
		onCommit(r.value)
		setDone(saved ? saved(r.value) : undefined)
	}
	return <span className='c' style={{ gap: 4, alignItems: 'flex-end' }}>
		<span className='fld' style={{ width, opacity: disabled ? .5 : 1, borderColor: problem ? '#f06a6e' : undefined }}>
			{prefix ? <span className='t3'>{prefix}&nbsp;</span> : null}
			<input data-testid={testId} inputMode='decimal' aria-label={label} aria-invalid={problem ? true : undefined} placeholder={placeholder} value={text} disabled={disabled} style={{ width: '100%' }}
				onFocus={() => { focused.current = true }} onChange={e => { setText(e.target.value); setProblem(undefined); setDone(undefined) }}
				onBlur={() => { focused.current = false; commit() }} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
			{suffix ? <span className='t3'>{suffix}</span> : null}
		</span>
		{problem ? <span role='alert' data-testid={`${testId}-problem`} style={{ color: '#f06a6e', fontSize: 12, maxWidth: 260, textAlign: 'right' }}>{problem}</span>
			: done ? <span role='status' data-testid={`${testId}-saved`} className='hint' style={{ maxWidth: 260, textAlign: 'right' }}>{'\u2713 '}{done}</span> : null}
	</span>
}
