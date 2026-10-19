/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAccessor, useChatThreadsState, useChatThreadsStreamState } from '../util/services.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { changeWords, compareSteps, stepsOfThread } from '../../../../common/checkpointModel.js'
import { CompareDiff } from './CompareDiff.js'

// The checkpoints of a chat, each with what its step changed (board S13, "Checkpoints"): pick one to go back to it (after the same question as on the line in the chat),
// or pick two to see what changed between them. A checkpoint keeps the files as they were; "what changed" is worked out from those copies, so it is exact for the files kept.
// The class names are written out in each className on purpose: the build that scopes Tailwind to Vader's UI prefixes only the names it finds written there.

const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

export const CheckpointsButton = () => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const threads = useChatThreadsState()
	const threadId = threads.currentThreadId
	const running = !!useChatThreadsStreamState(threadId)?.isRunning
	const messages = threads.allThreads[threadId]?.messages ?? []
	const [open, setOpen] = useState(false)
	const [picked, setPicked] = useState<number[]>([])
	const [asking, setAsking] = useState(false)
	const [comparing, setComparing] = useState(false)
	const [diffOf, setDiffOf] = useState<string | undefined>()
	const ref = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!open) return
		const away = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.('[data-testid="vader-compare-diff"]')) setOpen(false) }
		const esc = (e: Event) => { if ((e as { key?: string }).key === 'Escape') setOpen(false) }
		document.addEventListener('mousedown', away)
		document.addEventListener('keydown', esc)
		return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
	}, [open])

	const steps = useMemo(() => {
		if (!open) return []
		const model = accessor.get('IModelService')
		return stepsOfThread(messages as never, (p) => {
			try { return model.getModel(URI.file(p))?.getValue() } catch { return undefined }
		})
	}, [open, messages, accessor])

	const count = useMemo(() => messages.filter(m => m.role === 'checkpoint').length, [messages])
	if (count < 2) return null

	const toggle = (n: number) => { setAsking(false); setComparing(false); setPicked(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n].slice(-2)) }
	const goTo = picked.length > 0 ? picked[picked.length - 1] : undefined
	const goBack = () => {
		const step = steps.find(s => s.n === goTo)
		if (!step) return
		setAsking(false); setOpen(false)
		chat.jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx: step.messageIdx, jumpToUserModified: step.messageIdx === messages.length - 1 })
	}
	const cmp = picked.length === 2 ? compareSteps(steps, picked[0], picked[1]) : undefined

	return <div ref={ref} className='relative' onClick={e => e.stopPropagation()}>
		<button type='button' data-testid='vader-checkpoints-button' aria-expanded={open} aria-haspopup='dialog' className='underline-offset-2 hover:underline hover:text-vader-fg-1' onClick={() => { setOpen(o => !o); setPicked([]); setAsking(false); setComparing(false) }}>Checkpoints</button>
		{open ? <div className='absolute bottom-full left-1/2 mb-2 z-50 flex justify-center' style={{ width: 0 }}><div role='dialog' aria-label='Checkpoints' data-testid='vader-checkpoints' className='motion-safe:animate-card-in shrink-0 rounded-xl border border-vader-border-2 bg-vader-bg-1 py-2 shadow-lg flex flex-col text-[13px] text-vader-fg-1' style={{ width: 360, maxWidth: 'calc(100vw - 24px)' }}>
			<div className='px-4 pb-1 text-xs text-vader-fg-3'>Each step the agent finished, with its changes</div>
			<div className='max-h-64 overflow-auto' data-testid='vader-checkpoints-list'>
				{[...steps].reverse().map(s => <button key={s.n} type='button' data-testid='vader-checkpoint-row' data-n={s.n} aria-pressed={picked.includes(s.n)}
					className={`flex w-full items-center gap-3 px-4 h-9 text-left border-t border-vader-border-3 first:border-t-0 transition-colors duration-100 ${picked.includes(s.n) ? 'bg-vader-bg-2-hover' : 'hover:bg-vader-bg-2-hover'}`} onClick={() => toggle(s.n)}>
					<span className='w-3 text-xs text-vader-fg-3 tabular-nums'>{s.n}</span>
					<span className='truncate flex-1'>{s.label}</span>
					<span className={`text-xs tabular-nums ${s.added || s.removed ? 'text-vader-fg-2' : 'text-vader-fg-3'}`}>{changeWords(s.added, s.removed)}</span>
				</button>)}
			</div>
			{asking && goTo !== undefined ? <div className='mx-3 mt-2 rounded-lg border border-vader-border-2 px-3 py-2.5 flex flex-col gap-2' data-testid='vader-checkpoints-confirm'>
				<div className='font-semibold'>Go back to checkpoint {goTo}?</div>
				<div className='text-vader-fg-2 text-xs leading-relaxed'>Files return to how they were at this checkpoint. The messages after it stay visible but greyed out, and the next message continues from here.</div>
				<div className='flex gap-2 justify-end'>
					<button type='button' data-testid='vader-checkpoints-cancel' className='px-3 py-1 rounded-md text-sm border border-vader-border-2 hover:bg-vader-bg-2-hover' onClick={() => setAsking(false)}>Cancel</button>
					<button type='button' data-testid='vader-checkpoints-go' className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium' onClick={goBack}>Go back</button>
				</div>
			</div> : null}
			{comparing && cmp ? <div className='mx-3 mt-2 rounded-lg border border-vader-border-2 px-3 py-2.5 flex flex-col gap-1' data-testid='vader-checkpoints-compare'>
				<div className='text-xs text-vader-fg-3'>Between checkpoint {Math.min(...picked)} and {Math.max(...picked)}: {cmp.files.length} file{cmp.files.length === 1 ? '' : 's'}, {changeWords(cmp.added, cmp.removed)}</div>
				{cmp.files.length === 0 ? <div className='text-vader-fg-2'>Nothing changed in the files the checkpoints kept.</div> : cmp.files.map(f => <button key={f.path} type='button' disabled={f.before === undefined || f.after === undefined} data-testid='vader-compare-file' title={f.before === undefined ? f.path : `Open ${f.path} side by side`} className='flex gap-3 font-mono text-[12px] text-left rounded px-1 -mx-1 hover:bg-vader-bg-2-hover disabled:hover:bg-transparent' onClick={() => setDiffOf(f.path)}><span className='truncate flex-1'>{baseName(f.path)}</span><span className='text-vader-fg-2'>{changeWords(f.added, f.removed)}</span></button>)}
			</div> : null}
			<div className='flex items-center gap-2 px-3 pt-2'>
				<button type='button' data-testid='vader-checkpoints-goback' disabled={goTo === undefined || running} title={running ? 'Wait for the run to end, or stop it' : undefined} className='px-3 py-1 rounded-md text-sm border border-vader-border-2 hover:bg-vader-bg-2-hover disabled:opacity-40 disabled:hover:bg-transparent' onClick={() => { setComparing(false); setAsking(true) }}>{goTo === undefined ? 'Go back to…' : `Go back to ${goTo}`}</button>
				<button type='button' data-testid='vader-checkpoints-compare-button' disabled={picked.length !== 2} className='px-2 py-1 text-sm text-vader-fg-2 hover:text-vader-fg-1 disabled:opacity-40 disabled:hover:text-vader-fg-2' onClick={() => { setAsking(false); setComparing(true) }}>{picked.length === 2 ? `Compare ${Math.min(...picked)} and ${Math.max(...picked)}` : 'Compare…'}</button>
			</div>
		</div></div> : null}
		{diffOf && cmp ? (() => { const f = cmp.files.find(x => x.path === diffOf); return f && f.before !== undefined && f.after !== undefined ? <CompareDiff path={f.path} before={f.before} after={f.after} from={Math.min(...picked)} to={Math.max(...picked)} added={f.added} removed={f.removed} host={ref.current?.closest('.vader-scope') ?? null} onClose={() => setDiffOf(undefined)} /> : null })() : null}
	</div>
}
