/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor, useCommandBarState } from '../util/services.js'
import type { Diff } from '../../../../common/editCodeServiceTypes.js'
import type { VerificationEvidence, VerificationVerdict } from '../../../../common/verification/verificationTypes.js'
import { commitSummary, fileCounts, FolderGroup, groupByFolder, hunkRows, isFolded, relativePath, Row } from '../../../../common/reviewModel.js'
import { Spinner, WarnTri } from './icons.js'
import { useShellData } from './useShellData.js'

// The review of what an agent changed (boards R02, S05): the changed files on the left, the changes of the chosen file on the right with Accept and Reject for
// the file and for each piece, a comment on a line that goes back to the agent, the checks that ran, and below it all the commit. Everything here works on the
// edits the editor is holding right now (the same ones the editor shows as accept-and-reject marks), so Accept keeps a change, Reject puts the file back.

type FileEntry = { path: string, uri: URI, diffs: Diff[], added: number, removed: number, streaming: boolean }

/** what was accepted and rejected in each conversation this session, so going to the conversation tab and back does not forget it */
const doneOfThread = new Map<string, { accepted: number, rejected: number }>()

const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p

export const ReviewView = () => {
	const accessor = useAccessor()
	const edit = accessor.get('IEditCodeService')
	const modelService = accessor.get('IModelService')
	const chat = accessor.get('IChatThreadService')
	const gateway = accessor.get('IAgentGatewayService')
	const verification = accessor.get('IVerificationService')
	const reviewService = accessor.get('IVaderReviewService')
	const workspace = accessor.get('IWorkspaceContextService')
	const shellService = accessor.get('IVaderShellService')
	const data = useShellData()
	const { stateOfURI, sortedURIs } = useCommandBarState()
	const root = workspace.getWorkspace().folders[0]?.uri.fsPath
	const thread = data.all.find(t => t.id === data.currentId)

	const files = useMemo<FileEntry[]>(() => sortedURIs.map(uri => {
		const st = stateOfURI[uri.fsPath]
		const diffs = (st?.sortedDiffIds ?? []).map(id => edit.diffOfId[id]).filter((d): d is Diff => !!d)
		const c = fileCounts(diffs)
		return { path: uri.fsPath, uri, diffs, added: c.added, removed: c.removed, streaming: !!st?.isStreaming }
	}).filter(f => f.diffs.length > 0 || f.streaming), [sortedURIs, stateOfURI, edit])
	const totals = useMemo(() => ({ files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) }), [files])

	const [picked, setPicked] = useState<string | undefined>()
	const [mode, setMode] = useState<'unified' | 'split'>('unified')
	const [opened, setOpened] = useState<Record<string, boolean>>({})
	const threadKey = thread?.id ?? ''
	const [done, setDoneState] = useState<{ accepted: number, rejected: number }>(() => doneOfThread.get(threadKey) ?? { accepted: 0, rejected: 0 })
	const setDone = (f: (d: { accepted: number, rejected: number }) => { accepted: number, rejected: number }) => setDoneState(d => { const n = f(d); doneOfThread.set(threadKey, n); return n })
	useEffect(() => { setDoneState(doneOfThread.get(threadKey) ?? { accepted: 0, rejected: 0 }) }, [threadKey])
	const current = files.find(f => f.path === picked) ?? files[0]

	// a file that leaves the list was either rejected here or kept (a file whose pieces were kept one by one leaves the same way)
	const rejectedHere = useRef<Set<string>>(new Set())
	const previous = useRef<string[]>([])
	useEffect(() => {
		const now = files.map(f => f.path)
		const gone = previous.current.filter(p => !now.includes(p))
		previous.current = now
		if (gone.length === 0) return
		const rejected = gone.filter(p => rejectedHere.current.has(p)).length
		setDone(d => ({ accepted: d.accepted + gone.length - rejected, rejected: d.rejected + rejected }))
		gone.forEach(p => rejectedHere.current.delete(p))
	}, [files])
	const act = useCallback((f: FileEntry, behavior: 'accept' | 'reject') => {
		if (behavior === 'reject') rejectedHere.current.add(f.path)
		edit.acceptOrRejectAllDiffAreas({ uri: f.uri, removeCtrlKs: true, behavior, _addToHistory: true })
	}, [edit])
	const allOf = (behavior: 'accept' | 'reject') => { files.forEach(f => act(f, behavior)) }

	// ---- a comment on a line, sent to the agent
	const [comment, setComment] = useState<{ path: string, line: number, snippet: string } | null>(null)
	const [commentText, setCommentText] = useState('')
	const [sent, setSent] = useState<string | null>(null)
	const sendComment = async () => {
		if (!comment || !thread) return
		const ok = await chat.addReviewComment(thread.id, { path: relativePath(comment.path, root), line: comment.line, snippet: comment.snippet, text: commentText })
		if (ok) { setSent(`Sent to the agent: ${relativePath(comment.path, root)}, line ${comment.line}`); setComment(null); setCommentText('') }
	}

	// ---- the checks that ran on the project, again whenever the set of changed files changes
	const [evidence, setEvidence] = useState<VerificationEvidence | 'loading' | { error: string } | undefined>()
	const key = files.map(f => `${f.path}:${f.added}:${f.removed}`).join('|')
	useEffect(() => {
		if (files.length === 0) { setEvidence(undefined); return }
		let live = true
		setEvidence('loading')
		const t = setTimeout(() => {
			verification.gatherEvidence().then(e => { if (live) setEvidence(e) }).catch(e => { if (live) setEvidence({ error: e instanceof Error ? e.message : String(e) }) })
		}, 900)
		return () => { live = false; clearTimeout(t) }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key])
	const [verdict, setVerdict] = useState<VerificationVerdict | 'running' | { error: string } | undefined>()
	const runIndependentCheck = async () => {
		setVerdict('running')
		try { setVerdict((await verification.runIndependentVerification({ objective: thread?.title ?? 'the change' })).verdict) }
		catch (e) { setVerdict({ error: e instanceof Error ? e.message : String(e) }) }
	}
	const fixBlockers = (v: VerificationVerdict) => {
		if (!thread) return
		const text = v.findings.filter(f => f.severity === 'blocker').map(f => `${f.description}${f.location ? ` (${f.location})` : ''}`).join('\n')
		chat.switchToThread(thread.id)
		shellService.setTab('conversation')
		void gateway.startTask({ threadId: thread.id, userMessage: `An independent check of your change found a problem. Fix it:\n${text}` })
	}

	// ---- the commit
	const [message, setMessage] = useState('')
	const touched = useRef(false)
	useEffect(() => { if (!touched.current && thread) setMessage(thread.title) }, [thread?.id, thread?.title]) // eslint-disable-line react-hooks/exhaustive-deps
	const [commitState, setCommitState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'done', hash: string } | { kind: 'error', text: string }>({ kind: 'idle' })
	const [repo, setRepo] = useState<{ branch: string, pullRequestUrl: string | undefined } | undefined>()
	useEffect(() => { reviewService.repoInfo().then(setRepo).catch(() => setRepo(undefined)) }, [reviewService, commitState.kind])
	const commit = async () => {
		setCommitState({ kind: 'busy' })
		try { setCommitState({ kind: 'done', hash: await reviewService.commit(message) }) }
		catch (e) { setCommitState({ kind: 'error', text: e instanceof Error ? e.message : String(e) }) }
	}

	const groups: FolderGroup<FileEntry>[] = useMemo(() => groupByFolder(files, root), [files, root])
	const doneAll = files.length === 0 && (done.accepted > 0 || done.rejected > 0)

	const renderRows = (rows: Row[], path: string) => mode === 'unified'
		? rows.map((r, i) => <div key={i} className={r.kind === 'del' ? 'dl x' : r.kind === 'add' ? 'dl p' : 'dl n'} data-testid='vader-review-line' data-kind={r.kind}
			onClick={() => { if (r.kind !== 'del') { setComment({ path, line: r.n, snippet: r.text }); setSent(null) } }} style={{ cursor: r.kind === 'del' ? 'default' : 'pointer' }}>
			<b>{r.n}</b><i>{r.kind === 'del' ? '−' : r.kind === 'add' ? '+' : ''}</i>{r.text}
		</div>)
		: <div className='r' style={{ alignItems: 'flex-start' }}>
			<div className='c fl' style={{ minWidth: 0 }}>{rows.filter(r => r.kind !== 'add').map((r, i) => <div key={i} className={r.kind === 'del' ? 'dl x' : 'dl n'}><b>{r.n}</b><i>{r.kind === 'del' ? '−' : ''}</i>{r.text}</div>)}</div>
			<div className='c fl' style={{ minWidth: 0, borderLeft: '1px solid var(--ln)' }}>{rows.filter(r => r.kind !== 'del').map((r, i) => <div key={i} className={r.kind === 'add' ? 'dl p' : 'dl n'} onClick={() => { if (r.kind === 'add') { setComment({ path, line: r.n, snippet: r.text }); setSent(null) } }}><b>{r.n}</b><i>{r.kind === 'add' ? '+' : ''}</i>{r.text}</div>)}</div>
		</div>

	const fileLinesOf = (f: FileEntry): string[] => modelService.getModel(f.uri)?.getValue().replace(/\r\n/g, '\n').split('\n') ?? []

	return <div className='c fl' style={{ minHeight: 0 }} data-testid='vader-shell-review-view'>
		<div className='r fl' style={{ minHeight: 0, alignItems: 'stretch' }}>
			{/* the files */}
			<div className='c' style={{ width: 290, flex: 'none', borderRight: '1px solid var(--ln)', minHeight: 0 }}>
				<div className='r' style={{ height: 46, padding: '0 16px', gap: 10, flex: 'none' }}>
					<span className='t1' style={{ fontWeight: 600 }} data-testid='vader-review-total'>{totals.files} file{totals.files === 1 ? '' : 's'}</span>
					{totals.files > 0 ? <><span className='add'>+{totals.added}</span><span className='del'>{'−'}{totals.removed}</span></> : null}
					<span className='fl' />
					{totals.files > 1 ? <button className='tx' data-testid='vader-review-accept-all' onClick={() => allOf('accept')}>Accept all</button> : null}
				</div>
				<div className='c fl scroll' style={{ padding: '0 8px' }}>
					{groups.map(g => <React.Fragment key={g.folder}>
						{g.folder ? <div className='hint' style={{ padding: '10px 8px 4px' }}>{g.folder}</div> : null}
						{g.files.map(f => <button key={f.path} className={f.path === current?.path ? 'fr on' : 'fr'} data-testid='vader-review-file' data-path={f.path} onClick={() => setPicked(f.path)}>
							<span className='fl tr'>{baseName(f.path)}</span>
							{f.streaming ? <Spinner /> : <><span className='add sm'>+{f.added}</span><span className='del sm'>{'−'}{f.removed}</span></>}
						</button>)}
					</React.Fragment>)}
				</div>
				{/* the checks */}
				{files.length > 0 ? <div className='c' style={{ padding: '10px 16px 12px', gap: 7, borderTop: '1px solid var(--ln)', flex: 'none' }} data-testid='vader-review-checks'>
					{evidence === 'loading' ? <span className='r t3' style={{ gap: 8 }}><Spinner />Running the checks</span>
						: evidence && 'error' in evidence ? <span className='r t2' style={{ gap: 8 }}><WarnTri />Could not run the checks</span>
							: evidence && !evidence.checksDetected ? <span className='t3'>No automatic checks were found for this project.</span>
								: evidence ? evidence.checks.map((c, i) => <span key={i} className='r' style={{ gap: 8 }}><span style={{ color: c.passed ? '#4cc38a' : '#f06a6e' }}>{c.passed ? '✓' : '✕'}</span><span className={c.passed ? 't2' : 't1'}>{c.name}{c.passed ? ' passed' : ' failed'}</span></span>) : null}
					{evidence && evidence !== 'loading' && !('error' in evidence) && evidence.diagnosticsSummary ? <span className='r t2' style={{ gap: 8 }}><WarnTri />Problems in the changed files</span> : null}
					{verdict === undefined ? <span className='r' style={{ gap: 8 }}><span className='t4'>{'○'}</span><span className='t3 fl'>Independent check not run</span><button className='tx' data-testid='vader-review-run-check' onClick={runIndependentCheck}>Run</button></span>
						: verdict === 'running' ? <span className='r t3' style={{ gap: 8 }}><Spinner />A second agent is checking the result</span>
							: 'error' in verdict ? <span className='r t2' style={{ gap: 8 }}><WarnTri />{verdict.error}</span>
								: <div className='c' style={{ gap: 6 }} data-testid='vader-review-verdict'>
									<span className='t1' style={{ fontWeight: 600 }}>{verdict.passed ? 'The independent check agrees' : 'Needs changes'}</span>
									{verdict.findings.slice(0, 3).map((f, i) => <span key={i} className='r' style={{ gap: 10, alignItems: 'flex-start' }}><span style={{ width: 50, flex: 'none', color: f.severity === 'blocker' ? '#f06a6e' : 'var(--t3)' }}>{f.severity === 'blocker' ? 'Blocker' : 'Note'}</span><span className='t2'>{f.description}</span></span>)}
									{!verdict.passed && verdict.findings.some(f => f.severity === 'blocker') ? <span className='r' style={{ gap: 8 }}><button className='pb' data-testid='vader-review-fix' onClick={() => fixBlockers(verdict)}>Fix the blocker</button><button className='tx' onClick={() => setVerdict(undefined)}>Ignore</button></span> : null}
								</div>}
				</div> : null}
			</div>

			{/* the changes of the chosen file */}
			<div className='c fl' style={{ minWidth: 0, minHeight: 0 }}>
				{files.length === 0 ? <div className='c' style={{ margin: 'auto', width: 400, gap: 10 }} data-testid='vader-review-empty' data-accepted={done.accepted} data-rejected={done.rejected}>
					{doneAll && done.rejected === 0 ? <>
						<span className='r' style={{ gap: 8, background: 'var(--g2)', border: '1px solid var(--ln2)', borderRadius: 8, padding: '9px 12px' }}><span style={{ color: '#4cc38a' }}>{'✓'}</span><span className='t1'>{done.accepted} file{done.accepted === 1 ? '' : 's'} accepted</span></span>
						<span className='t2' style={{ lineHeight: 1.55 }}>The changes were applied to your folder. Commit them below, or from Source Control.</span>
					</> : doneAll && done.accepted === 0 ? <>
						<span className='t2' style={{ lineHeight: 1.55 }}>You rejected {done.rejected} file{done.rejected === 1 ? '' : 's'}. Your folder is as it was before the task.</span>
						<span className='r' style={{ gap: 8 }}><button className='gb' data-testid='vader-review-tell-why' onClick={() => shellService.setTab('conversation')}>Tell the agent why</button></span>
					</> : doneAll ? <span className='t2' data-testid='vader-review-mixed'>{done.accepted} file{done.accepted === 1 ? '' : 's'} accepted, {done.rejected} rejected.</span> : <>
						<span className='t2' style={{ lineHeight: 1.55 }}>The agent has not edited any file in this task yet.</span>
						<span className='hint'>Changes appear here as it works.</span>
					</>}
				</div> : current ? <>
					<div className='r' style={{ height: 56, padding: '0 20px', gap: 12, flex: 'none', borderBottom: '1px solid var(--ln)' }}>
						<span className='t1' style={{ fontWeight: 600 }}>{baseName(current.path)}</span>
						<span className='t3 tr fl'>{relativePath(current.path, root).split('/').slice(0, -1).join('/')}</span>
						<span className='r' style={{ border: '1px solid var(--ln2)', borderRadius: 6, overflow: 'hidden' }}>
							<button className={mode === 'unified' ? 'tx t1' : 'tx'} style={{ borderRadius: 0, background: mode === 'unified' ? 'var(--g3)' : undefined }} onClick={() => setMode('unified')}>Unified</button>
							<button className={mode === 'split' ? 'tx t1' : 'tx'} style={{ borderRadius: 0, background: mode === 'split' ? 'var(--g3)' : undefined }} onClick={() => setMode('split')}>Split</button>
						</span>
						<button className='tx' data-testid='vader-review-reject-file' onClick={() => act(current, 'reject')}>Reject file</button>
						<button className='pb' data-testid='vader-review-accept-file' onClick={() => act(current, 'accept')}>Accept file</button>
					</div>
					<div className='c fl scroll' style={{ minHeight: 0 }}>
						{isFolded(current.path, current.added + current.removed) && !opened[current.path]
							? <div className='c' style={{ padding: 20, gap: 8 }} data-testid='vader-review-folded'><span className='t2'>Large and generated files are folded. Open one to read it.</span><span><button className='gb' onClick={() => setOpened(o => ({ ...o, [current.path]: true }))}>Open it</button></span></div>
							: current.diffs.map(d => {
								const lines = fileLinesOf(current)
								const end = d.type === 'deletion' ? d.startLine : d.endLine
								return <div key={d.diffid} className='c' data-testid='vader-review-hunk' style={{ borderBottom: '1px solid var(--ln)', paddingBottom: 6 }}>
									<div className='r' style={{ height: 30, padding: '0 20px', gap: 10 }}>
										<span className='mo t3 fl' style={{ fontSize: 11.5 }}>Lines {d.startLine}{end !== d.startLine ? `–${end}` : ''}</span>
										<button className='tx' data-testid='vader-review-reject-hunk' onClick={() => edit.rejectDiff({ diffid: d.diffid })}>Reject hunk</button>
										<button className='tx t1' data-testid='vader-review-accept-hunk' onClick={() => edit.acceptDiff({ diffid: d.diffid })}>Accept hunk</button>
									</div>
									<div className='c' style={{ overflowX: 'auto' }}>{renderRows(hunkRows(d, lines, 2), current.path)}</div>
									{comment && comment.path === current.path && d.startLine - 3 <= comment.line && comment.line <= end + 2 ? <div className='c' style={{ margin: '8px 20px 4px 60px', padding: '12px 14px', gap: 8, border: '1px solid var(--ln2)', borderRadius: 10, background: 'var(--g2)' }} data-testid='vader-review-comment'>
										<span className='r' style={{ gap: 8 }}><span className='t1' style={{ fontWeight: 600 }}>You</span><span className='hint'>on line {comment.line}</span><span className='fl' /><span className='hint'>draft</span></span>
										<textarea autoFocus data-testid='vader-review-comment-text' className='t1' style={{ minHeight: 44, resize: 'vertical', lineHeight: 1.5 }} placeholder='Write to the agent about this line' value={commentText} onChange={e => setCommentText(e.target.value)}
											onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void sendComment() } else if (e.key === 'Escape') { setComment(null) } }} />
										<span className='r' style={{ gap: 8 }}><button className='pb' data-testid='vader-review-comment-send' disabled={!commentText.trim()} onClick={() => void sendComment()}>Send to agent</button><button className='tx' onClick={() => { setComment(null); setCommentText('') }}>Discard</button><span className='fl' /><span className='hint'>Ctrl Enter sends</span></span>
									</div> : null}
								</div>
							})}
						{sent ? <div className='r t2' style={{ gap: 8, padding: '10px 20px' }} data-testid='vader-review-sent'><span style={{ color: '#4cc38a' }}>{'✓'}</span>{sent}</div> : null}
					</div>
				</> : null}
			</div>
		</div>

		{/* the commit */}
		<div className='r' style={{ height: 60, padding: '0 20px', gap: 12, flex: 'none', borderTop: '1px solid var(--ln)' }} data-testid='vader-review-commit-bar'>
			<input className='fld fl' style={{ height: 34 }} data-testid='vader-review-message' placeholder='Commit message' value={message} onChange={e => { touched.current = true; setMessage(e.target.value) }} />
			<span className='hint' style={{ minWidth: 150 }}>{commitSummary(totals.files, totals.added, totals.removed)}</span>
			<button className='pb' data-testid='vader-review-commit' disabled={commitState.kind === 'busy' || !message.trim()} onClick={() => void commit()}>{commitState.kind === 'busy' ? 'Committing' : 'Commit'}</button>
			<button className='gb' data-testid='vader-review-pr' disabled={!repo?.pullRequestUrl} title={repo?.pullRequestUrl ? 'Open the pull request page for this branch' : 'Needs a GitHub remote and a branch'} onClick={() => { void reviewService.openPullRequestPage() }}>Create pull request</button>
		</div>
		{commitState.kind === 'done' ? <div className='r t2' style={{ gap: 8, padding: '6px 20px 10px' }} data-testid='vader-review-committed'><span style={{ color: '#4cc38a' }}>{'✓'}</span>Committed {commitState.hash}{repo?.branch ? ` on ${repo.branch}` : ''}.</div>
			: commitState.kind === 'error' ? <div className='r' style={{ gap: 8, padding: '6px 20px 10px', color: 'var(--delt)' }} role='alert' data-testid='vader-review-commit-error'><WarnTri color='#f06a6e' />{commitState.text}</div> : null}
	</div>
}
