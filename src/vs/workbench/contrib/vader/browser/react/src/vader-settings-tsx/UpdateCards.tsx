/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { useAccessor } from '../util/services.js'
import { availableWords, downloadingWords, failedWords, readyWords } from '../../../../common/updateModel.js'
import type { UpdateState } from '../../../../common/updateModel.js'

// Updating Vader (board S11): the three cards of an update that is on its way - ready to download, downloading with its progress, ready to restart - and the one for a
// download that failed. The words are in common/updateModel.ts; the work is done in the main process (vaderUpdateMainService.ts).

/** the state of the update, following the main process; the restart that waits for the tasks is kept by the coordinator */
export const useUpdate = () => {
	const accessor = useAccessor()
	const service = accessor.get('IVaderUpdateService')
	const coordinator = accessor.get('IVaderUpdateCoordinator')
	const [state, setState] = useState<UpdateState>({ kind: 'idle' })
	const [, bump] = useState(0)
	useEffect(() => {
		let live = true
		void service.getUpdateState().then(s => { if (live) setState(s) })
		const a = service.onDidChangeUpdateState(s => setState(s))
		const b = coordinator.onDidChange(() => bump(n => n + 1))
		return () => { live = false; a.dispose(); b.dispose() }
	}, [service, coordinator])
	return { service, coordinator, state }
}

const Card = ({ testId, children, alert }: { testId: string, children: React.ReactNode, alert?: boolean }) =>
	<div className='c' role={alert ? 'alert' : 'status'} data-testid={testId} style={{ gap: 8, padding: '14px 16px', border: '1px solid var(--ln2)', borderRadius: 10, background: 'var(--g1)', maxWidth: 520, margin: '10px 0' }}>{children}</div>

export const UpdateCards = ({ current, openUrl }: { current: string, openUrl: (u: string) => void }) => {
	const { service, coordinator, state } = useUpdate()
	const [problem, setProblem] = useState<string | undefined>()

	if (state.kind === 'available') {
		const w = availableWords(state.offer)
		return <Card testId='vader-update-available'>
			<span className='t1' style={{ fontWeight: 600 }} data-testid='vader-update-title'>{w.title}</span>
			<span className='t2' style={{ lineHeight: 1.5 }} data-testid='vader-update-body'>{w.body}</span>
			<span className='r' style={{ gap: 8, flexWrap: 'wrap' }}>
				<button className='pb' data-testid='vader-update-download' onClick={() => { if (state.offer.asset) void service.downloadUpdate(); else openUrl(state.offer.releaseUrl) }}>{w.download}</button>
				<button className='gb' data-testid='vader-update-changed' onClick={() => openUrl(state.offer.releaseUrl)}>{w.changed}</button>
				<button className='tx' data-testid='vader-update-later' onClick={() => void service.dismissUpdate()}>{w.later}</button>
			</span>
		</Card>
	}

	if (state.kind === 'downloading') {
		const w = downloadingWords(state)
		return <Card testId='vader-update-downloading'>
			<span className='t1' style={{ fontWeight: 600 }} data-testid='vader-update-title'>{w.title}</span>
			<div role='progressbar' aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w.fraction * 100)} aria-label={w.title} style={{ height: 4, borderRadius: 2, background: 'var(--ln2)', overflow: 'hidden' }}>
				<div data-testid='vader-update-bar' style={{ width: `${Math.round(w.fraction * 100)}%`, height: 4, background: 'var(--t1)', transition: 'width .2s' }} />
			</div>
			<span className='hint' data-testid='vader-update-progress'>{w.progress}</span>
			<span className='r'><button className='gb' data-testid='vader-update-cancel' onClick={() => void service.cancelUpdateDownload()}>{w.cancel}</button></span>
		</Card>
	}

	if (state.kind === 'ready') {
		const running = coordinator.runningTasks()
		const w = readyWords(running)
		return <Card testId='vader-update-ready'>
			<span className='t1' style={{ fontWeight: 600 }} data-testid='vader-update-title'>{w.title}</span>
			<span className='t2' style={{ lineHeight: 1.5 }} data-testid='vader-update-body'>{coordinator.waiting ? w.waiting : w.body}</span>
			<span className='r' style={{ gap: 8, flexWrap: 'wrap' }}>
				{running > 0 && !coordinator.waiting ? <button className='pb' data-testid='vader-update-when-done' onClick={() => coordinator.installWhenIdle()}>{w.whenDone}</button> : null}
				{coordinator.waiting ? <button className='gb' data-testid='vader-update-stop-waiting' onClick={() => coordinator.stopWaiting()}>{w.cancelWaiting}</button> : null}
				<button className={running > 0 ? 'gb' : 'pb'} data-testid='vader-update-now' onClick={() => { void coordinator.installNow().then(r => { if (!r.ok) setProblem(r.reason) }) }}>{w.now}</button>
			</span>
			{problem ? <span className='t2' role='alert' data-testid='vader-update-problem' style={{ color: 'var(--wa)' }}>{problem}</span> : null}
		</Card>
	}

	if (state.kind === 'failed') {
		const w = failedWords({ offer: state.offer, done: state.done, reason: state.reason, current: current || state.current })
		return <Card testId='vader-update-failed' alert>
			<span className='r' style={{ gap: 8 }}><svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true'><path d='M7.5 2.2 13.3 12.6H1.7z' fill='none' stroke='#f2a3a6' strokeWidth='1.3' strokeLinejoin='round' /></svg><span className='t1' style={{ fontWeight: 600 }} data-testid='vader-update-title'>{w.title}</span></span>
			<span className='t2' style={{ lineHeight: 1.5 }} data-testid='vader-update-body'>{w.body}</span>
			<span className='r' style={{ gap: 8, flexWrap: 'wrap' }}>
				<button className='pb' data-testid='vader-update-retry' onClick={() => void service.downloadUpdate()}>{w.retry}</button>
				<button className='gb' data-testid='vader-update-website' onClick={() => openUrl(state.offer.releaseUrl)}>{w.website}</button>
			</span>
		</Card>
	}

	return null
}
