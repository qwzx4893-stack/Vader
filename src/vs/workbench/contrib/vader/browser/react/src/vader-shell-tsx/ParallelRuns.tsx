/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { useAccessor, useOrchestrationRunsState } from '../util/services.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { conflictWords, isRunning, middleCut, rowOf, runSummary } from '../../../../common/parallelRunModel.js'
import { Spinner } from './icons.js'

// Parallel runs (board R05): tasks an agent split a job into, each in its own copy of the project, with where each stands and, for a task that conflicts with the
// current branch, the three ways out. What is shown is what the orchestration service holds; a button here calls that service.

const COLS = 'minmax(0,1fr) 200px 130px 170px 80px'
const TONE: { [t: string]: string } = { ok: '#4cc38a', warn: '#e2a93f', bad: '#f06a6e', plain: 'var(--t2)' }

export const ParallelRuns = () => {
	const accessor = useAccessor()
	const orch = accessor.get('IAgentOrchestrationService')
	const commands = accessor.get('ICommandService')
	const runs = useOrchestrationRunsState()
	const [now, setNow] = useState(() => Date.now())
	const [busy, setBusy] = useState<string | undefined>()
	const [problem, setProblem] = useState<{ [taskId: string]: string }>({})
	const anyRunning = runs.some(isRunning)
	useEffect(() => {
		if (!anyRunning) return
		const t = setInterval(() => setNow(Date.now()), 15_000)
		return () => clearInterval(t)
	}, [anyRunning])
	if (runs.length === 0) return null

	const resolve = async (runId: string, taskId: string, choice: 'target' | 'branch' | 'agent') => {
		setBusy(taskId + choice)
		try {
			const r = await orch.resolveConflict(runId, taskId, choice)
			setProblem(p => ({ ...p, [taskId]: r.ok ? '' : r.reason }))
		} catch (e) { setProblem(p => ({ ...p, [taskId]: e instanceof Error ? e.message : String(e) })) }
		finally { setBusy(undefined) }
	}

	return <div className='c' style={{ gap: 28, padding: '20px 24px 8px' }} data-testid='vader-parallel-runs'>
		{[...runs].reverse().slice(0, 3).map(run => {
			const rows = run.tasks.map(t => ({ row: rowOf(t, now), t }))
			return <div key={run.id} className='c' style={{ gap: 0 }} data-testid='vader-parallel-run'>
				<div className='r' style={{ gap: 14, alignItems: 'baseline', paddingBottom: 12 }}>
					<span className='t1' style={{ fontWeight: 600 }}>Run started {new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
					<span className='t3' data-testid='vader-parallel-summary'>{runSummary(run)}</span>
					<span className='fl' />
					<span className='t3'>Each task works in its own copy of the project. Finished work is merged one by one.</span>
					{isRunning(run) ? <button className='tx' data-testid='vader-parallel-stop' onClick={() => orch.cancelRun(run.id)}>Stop all</button> : null}
				</div>
				<div className='th' style={{ gridTemplateColumns: COLS, padding: 0 }}><span>Task</span><span>Helper</span><span>Branch</span><span>Result</span><span style={{ textAlign: 'right' }}>Files</span></div>
				{rows.map(({ row, t }) => <div key={t.id} className='td' style={{ gridTemplateColumns: COLS, height: 'auto', minHeight: 52, padding: '8px 0' }} data-testid='vader-parallel-task' data-kind={row.kind}>
					<span className='c' style={{ minWidth: 0, gap: 2 }}><span className='t1 tr'>{row.title}</span><span className='t3' style={{ fontSize: 12 }}>{row.sub}</span></span>
					<span className='t2 tr'>{row.helper}</span>
					<span className='mo t3 tr' title={row.branch}>{row.branch}</span>
					<span className='r' style={{ gap: 8, color: TONE[row.tone] }} data-testid='vader-parallel-result'>{row.kind === 'working' ? <Spinner /> : null}{row.result}</span>
					<span className='t2' style={{ textAlign: 'right' }}>{row.files}</span>
				</div>)}
				{rows.filter(x => x.row.kind === 'conflict').map(({ t }) => {
					const w = conflictWords(t)
					const choices: { id: 'agent' | 'target' | 'branch', label: string }[] = [{ id: 'agent', label: 'Let an agent merge them' }, { id: 'target', label: 'Keep the current version' }, { id: 'branch', label: 'Keep this task’s version' }]
					return <div key={t.id} className='c' style={{ gap: 8, padding: '18px 0 6px', maxWidth: 760 }} data-testid='vader-parallel-conflict'>
						<span className='r' style={{ gap: 12, alignItems: 'baseline' }}><span className='t1' style={{ fontWeight: 600 }}>{w.title}</span>{w.files.length > 0 ? <span className='mo t3 tr' data-testid='vader-parallel-conflict-file'>{middleCut(w.files[0])}</span> : null}</span>
						<span className='t2' style={{ lineHeight: 1.6 }}>{w.text}</span>
						<span className='r' style={{ gap: 8, flexWrap: 'wrap' }}>
							{choices.map((c, i) => <button key={c.id} className={i === 0 ? 'pb' : 'gb'} disabled={busy !== undefined} data-testid={`vader-parallel-${c.id}`} onClick={() => { void resolve(run.id, t.id, c.id) }}>{busy === t.id + c.id ? 'Working...' : c.label}</button>)}
							{w.files.length > 0 && t.repoPath ? <button className='tx' data-testid='vader-parallel-open-file' onClick={() => { void commands.executeCommand('vscode.open', URI.file(t.repoPath + '/' + w.files[0])) }}>Open the file</button> : null}
						</span>
						{problem[t.id] ? <span className='t2' style={{ color: '#f06a6e' }} role='alert' data-testid='vader-parallel-problem'>{problem[t.id]}</span> : null}
					</div>
				})}
				{rows.filter(x => x.row.kind === 'merge-failed' || x.row.kind === 'checks-failed' || x.row.kind === 'error').map(({ t, row }) => t.errorMessage ? <div key={t.id} className='c' style={{ gap: 4, padding: '14px 0 4px', maxWidth: 760 }} data-testid='vader-parallel-failure'>
					<span className='t1' style={{ fontWeight: 600 }}>{row.kind === 'checks-failed' ? 'The checks failed before the merge' : row.kind === 'merge-failed' ? `Could not merge ${t.branchName ?? 'the task'}` : 'The task failed'}</span>
					<span className='mo t2' style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{t.errorMessage}</span>
				</div> : null)}
			</div>
		})}
	</div>
}
