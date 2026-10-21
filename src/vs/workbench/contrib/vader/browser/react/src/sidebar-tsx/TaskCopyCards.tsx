/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { useTaskCopyState } from '../util/services.js'
import { agentMergingWords, branchLabel, conflictWords, copyFailedWords, dirtyWords, discardWords, mergeFailedWords, mergeProgressRows, mergedWords, notGitWords, ownCopyWords } from '../../../../common/taskCopyModel.js'
import type { StartAnswer, StartQuestion, TaskCopyState } from '../../../../common/taskCopyModel.js'

// A task's own copy of the project (boards S06 and R01): the card that says where the agent is working, what it changed, and what to do with it - merge it, keep one
// side where two tasks met, undo a merge, discard it - and the questions asked before a task starts. The words are in common/taskCopyModel.ts. The class names are
// written out in each className on purpose: the build that scopes Tailwind to Vader's UI prefixes only the names it finds written there.

const Warn = () => <svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' className='shrink-0'><path d='M7.5 2.2 13.3 12.6H1.7z' fill='none' stroke='#e2a93f' strokeWidth='1.3' strokeLinejoin='round' /></svg>
const BranchIcon = () => <svg width='14' height='14' viewBox='0 0 16 16' aria-hidden='true' className='shrink-0 text-vader-fg-3'><g fill='none' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round'><circle cx='4.5' cy='3.5' r='1.5' /><circle cx='4.5' cy='12.5' r='1.5' /><circle cx='11.5' cy='5.5' r='1.5' /><path d='M4.5 5v6M11.5 7c0 3-7 2-7 4' /></g></svg>
const Spinner = () => <svg width='13' height='13' viewBox='0 0 16 16' aria-hidden='true' className='shrink-0 animate-spin text-vader-fg-3' data-testid='vader-taskcopy-spinner'><circle cx='8' cy='8' r='6' fill='none' stroke='currentColor' strokeWidth='2' strokeOpacity='0.25' /><path d='M8 2a6 6 0 0 1 6 6' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' /></svg>

const Primary = ({ children, onClick, testId, disabled, title }: { children: React.ReactNode, onClick: () => void, testId: string, disabled?: boolean, title?: string }) =>
	<button type='button' data-testid={testId} disabled={disabled} title={title} className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed' onClick={onClick}>{children}</button>
const Secondary = ({ children, onClick, testId, disabled, title }: { children: React.ReactNode, onClick: () => void, testId: string, disabled?: boolean, title?: string }) =>
	<button type='button' data-testid={testId} disabled={disabled} title={title} className='px-3 py-1 rounded-md border border-vader-border-2 text-vader-fg-1 hover:bg-vader-bg-2-hover text-sm disabled:opacity-40 disabled:cursor-not-allowed' onClick={onClick}>{children}</button>
const Quiet = ({ children, onClick, testId }: { children: React.ReactNode, onClick: () => void, testId: string }) =>
	<button type='button' data-testid={testId} className='px-2 py-1 text-vader-fg-2 hover:text-vader-fg-1 text-sm' onClick={onClick}>{children}</button>

/** words with the file names in them set in code, as the boards show them */
const WithNames = ({ text, names }: { text: string, names: readonly string[] }) => {
	const shown = names.filter(n => text.includes(n))
	if (shown.length === 0) return <>{text}</>
	const escaped = shown.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
	const parts = text.split(new RegExp(`(${escaped.join('|')})`))
	return <>{parts.map((p, i) => shown.includes(p) ? <code key={i} className='font-mono text-[0.92em] text-vader-fg-1'>{p}</code> : <React.Fragment key={i}>{p}</React.Fragment>)}</>
}

const Card = ({ children, testId, role }: { children: React.ReactNode, testId: string, role?: string }) =>
	<div className='motion-safe:animate-card-in rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2' data-testid={testId} role={role}>{children}</div>

// ---- the questions before a task starts

const StartQuestionCard = ({ q, project, onAnswer }: { q: StartQuestion, project: string, onAnswer: (a: StartAnswer) => void }) => {
	if (q.kind === 'dirty') {
		const w = dirtyWords(q.files, q.project || project)
		return <Card testId='vader-taskcopy-dirty' role='alert'>
			<div className='flex items-center gap-2'><Warn /><span className='font-semibold text-vader-fg-1' data-testid='vader-taskcopy-title'>{w.title}</span></div>
			<div className='text-vader-fg-2 leading-relaxed' data-testid='vader-taskcopy-body'>{w.body}</div>
			<div className='flex flex-wrap gap-2 items-center'>
				<Primary testId='vader-taskcopy-start-anyway' onClick={() => onAnswer('start-anyway')}>{w.startAnyway}</Primary>
				<Secondary testId='vader-taskcopy-commit-first' onClick={() => onAnswer('commit')}>{w.commitFirst}</Secondary>
				<Quiet testId='vader-taskcopy-cancel' onClick={() => onAnswer('cancel')}>{w.cancel}</Quiet>
			</div>
		</Card>
	}
	if (q.kind === 'not-git') {
		const w = notGitWords()
		return <Card testId='vader-taskcopy-notgit' role='alert'>
			<div className='flex items-center gap-2'><Warn /><span className='font-semibold text-vader-fg-1' data-testid='vader-taskcopy-title'>{w.title}</span></div>
			<div className='text-vader-fg-2 leading-relaxed' data-testid='vader-taskcopy-body'>{w.body}</div>
			<div className='flex flex-wrap gap-2 items-center'>
				<Primary testId='vader-taskcopy-init-git' onClick={() => onAnswer('init-git')}>{w.start}</Primary>
				<Secondary testId='vader-taskcopy-use-chat' onClick={() => onAnswer('use-chat')}>{w.useChat}</Secondary>
			</div>
		</Card>
	}
	const w = copyFailedWords(q.reason)
	return <Card testId='vader-taskcopy-failed-start' role='alert'>
		<div className='flex items-center gap-2'><Warn /><span className='font-semibold text-vader-fg-1' data-testid='vader-taskcopy-title'>{w.title}</span></div>
		<div className='text-vader-fg-2 leading-relaxed' data-testid='vader-taskcopy-body'>{w.body}</div>
		<div className='flex flex-wrap gap-2 items-center'>
			<Secondary testId='vader-taskcopy-work-here' onClick={() => onAnswer('work-in-folder')}>{w.workHere}</Secondary>
			<Quiet testId='vader-taskcopy-cancel' onClick={() => onAnswer('cancel')}>{w.cancel}</Quiet>
		</div>
	</Card>
}

// ---- the copy itself

const DiscardDialog = ({ s, onCancel, onConfirm }: { s: TaskCopyState, onCancel: () => void, onConfirm: () => void }) => {
	const w = discardWords(s)
	return <div className='motion-safe:animate-card-in rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-4 flex flex-col gap-3' data-testid='vader-taskcopy-discard' role='alertdialog' aria-label={w.title}>
		<div className='font-semibold text-vader-fg-1 text-base' data-testid='vader-taskcopy-title'>{w.title}</div>
		<div className='text-vader-fg-2 leading-relaxed' data-testid='vader-taskcopy-body'>{w.body}</div>
		<div className='flex gap-2 justify-end'>
			<Secondary testId='vader-taskcopy-discard-cancel' onClick={onCancel}>{w.cancel}</Secondary>
			<Primary testId='vader-taskcopy-discard-confirm' onClick={onConfirm}>{w.confirm}</Primary>
		</div>
	</div>
}

export const TaskCopyArea = ({ threadId, isRunning }: { threadId: string, isRunning: boolean }) => {
	const { service, state: s, question } = useTaskCopyState(threadId)
	const [confirmDiscard, setConfirmDiscard] = useState(false)
	const [showOutput, setShowOutput] = useState(false)
	const project = (s?.repoPath ?? '').split(/[\\/]/).filter(Boolean).pop() ?? 'this project'

	if (question) return <StartQuestionCard q={question} project={project} onAnswer={a => service.answerQuestion(threadId, a)} />
	if (!s) return null
	const note = s.note ? <div className='text-vader-fg-3 text-xs px-1 leading-relaxed' data-testid='vader-taskcopy-note'>{s.note}</div> : null

	if (confirmDiscard) return <DiscardDialog s={s} onCancel={() => setConfirmDiscard(false)} onConfirm={() => { setConfirmDiscard(false); void service.discard(threadId) }} />

	if (s.phase === 'merged') {
		const w = mergedWords(s)
		return <div className='flex flex-col gap-2' data-testid='vader-taskcopy-merged'>
			<div className='motion-safe:animate-card-in rounded-lg border border-vader-border-2 bg-vader-bg-2 px-3 py-2 flex items-center gap-2' role='status'>
				<svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' className='shrink-0'><path d='M3 8l3 3 6-7' fill='none' stroke='#5fb878' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' /></svg>
				<span className='text-vader-fg-1' data-testid='vader-taskcopy-title'>{w.title}</span>
			</div>
			<div className='text-vader-fg-2 leading-relaxed px-1' data-testid='vader-taskcopy-body'>{w.body}</div>
			<div className='flex gap-2 items-center px-1'>
				{s.undone ? null : <Secondary testId='vader-taskcopy-undo' onClick={() => void service.undoMerge(threadId)}>Undo the merge</Secondary>}
				<Quiet testId='vader-taskcopy-done' onClick={() => service.dismiss(threadId)}>Done</Quiet>
			</div>
			{note}
		</div>
	}

	if (s.phase === 'merging') {
		return <Card testId='vader-taskcopy-merging'>
			<div className='flex items-center gap-2'><Spinner /><span className='text-vader-fg-1' data-testid='vader-taskcopy-title'>Merging {branchLabel(s.branchName)} into {s.baseBranch}</span></div>
		</Card>
	}

	if (s.phase === 'agent-merging') {
		const w = agentMergingWords(s)
		const all = [...(s.resolved ?? []), ...(s.resolving ?? [])].filter((f, i, a) => a.indexOf(f) === i)
		const rows = mergeProgressRows(all.length ? all : (s.conflictFiles ?? []), s.resolved ?? [])
		return <Card testId='vader-taskcopy-agent-merging'>
			<div className='flex items-center gap-2'>
				<span className='text-vader-fg-1' data-testid='vader-taskcopy-title'>{w.title}</span>
				<span className='flex-1' />
				<Spinner />
			</div>
			<div className='flex flex-col gap-1' data-testid='vader-taskcopy-progress'>
				{rows.map(r => <div key={r.name} className='flex gap-3 text-vader-fg-2' data-testid='vader-taskcopy-progress-row' data-state={r.state}>
					<span className='w-16 shrink-0'>{r.state === 'resolved' ? 'Resolved' : 'Resolving'}</span>
					<code className='font-mono text-[0.92em] text-vader-fg-1 truncate'>{r.name}</code>
				</div>)}
			</div>
			<div className='text-vader-fg-3 text-xs'>{w.footer}</div>
		</Card>
	}

	if (s.phase === 'conflict') {
		const w = conflictWords(s)
		const busy = false
		return <div className='flex flex-col gap-2'>
			<Card testId='vader-taskcopy-conflict' role='alert'>
				<div className='flex items-center gap-2'><Warn /><span className='font-semibold text-vader-fg-1' data-testid='vader-taskcopy-title'>{w.title}</span></div>
				<div className='text-vader-fg-2 leading-relaxed' data-testid='vader-taskcopy-body'><WithNames text={w.body} names={s.conflictFiles ?? []} /></div>
				<div className='flex flex-col gap-1.5 items-start'>
					<Primary testId='vader-taskcopy-keep-mine' disabled={busy} onClick={() => void service.resolveConflict(threadId, 'target')}>{w.keepMine}</Primary>
					<Secondary testId='vader-taskcopy-keep-task' disabled={busy} onClick={() => void service.resolveConflict(threadId, 'branch')}>{w.keepTask}</Secondary>
					<Secondary testId='vader-taskcopy-ask-agent' disabled={busy} onClick={() => void service.resolveConflict(threadId, 'agent')}>{w.askAgent}</Secondary>
				</div>
			</Card>
			{note}
		</div>
	}

	if (s.phase === 'failed') {
		const w = mergeFailedWords(s)
		return <div className='flex flex-col gap-2'>
			<Card testId='vader-taskcopy-merge-failed' role='alert'>
				<div className='flex items-center gap-2'><Warn /><span className='font-semibold text-vader-fg-1' data-testid='vader-taskcopy-title'>{w.title}</span></div>
				<div className='text-vader-fg-2 leading-relaxed' data-testid='vader-taskcopy-body'><WithNames text={w.body} names={s.failure?.files ?? []} /></div>
				<div className='flex flex-wrap gap-2 items-center'>
					<Primary testId='vader-taskcopy-retry' onClick={() => void (s.failure?.kind === 'local-changes' ? service.stashAndRetry(threadId) : service.merge(threadId))}>{w.retry}</Primary>
					<Secondary testId='vader-taskcopy-show-output' onClick={() => setShowOutput(v => !v)}>{showOutput ? 'Hide the git output' : w.output}</Secondary>
				</div>
				{showOutput ? <pre className='text-xs text-vader-fg-2 whitespace-pre-wrap break-words rounded-md bg-vader-bg-2 p-2 max-h-48 overflow-auto' data-testid='vader-taskcopy-output'>{s.failure?.reason}</pre> : null}
			</Card>
			{note}
		</div>
	}

	// working: the copy exists and the agent edits it
	if (!isRunning && s.files === 0) return null
	const w = ownCopyWords(s, project)
	return <div className='flex flex-col gap-2'>
		<Card testId='vader-taskcopy-card'>
			<div className='flex items-center gap-2'>
				<BranchIcon />
				<span className='font-semibold text-vader-fg-1 truncate' data-testid='vader-taskcopy-branch'>{w.branch}</span>
				<span className='flex-1' />
				<span className='text-vader-fg-3 text-xs shrink-0' data-testid='vader-taskcopy-from'>{w.from}</span>
			</div>
			<div className='text-vader-fg-2 leading-relaxed' data-testid='vader-taskcopy-body'>{w.body}</div>
			<div className='flex flex-wrap gap-2 items-center'>
				<Primary testId='vader-taskcopy-merge' disabled={isRunning || s.files === 0} title={isRunning ? 'Wait for the task to finish' : undefined} onClick={() => void service.merge(threadId)}>Merge into {s.baseBranch}</Primary>
				<Quiet testId='vader-taskcopy-discard-open' onClick={() => setConfirmDiscard(true)}>Discard</Quiet>
			</div>
		</Card>
		{note}
	</div>
}
