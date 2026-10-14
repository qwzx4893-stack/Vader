/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor } from '../util/services.js'
import { VADER_OPEN_ADDONS_ACTION_ID, VADER_OPEN_SETTINGS_ACTION_ID } from '../../../actionIDs.js'
import { Icon, ReviewRing, Spinner, WaitDot, Gap } from './icons.js'
import { useShellData } from './useShellData.js'
import { glyphOf } from '../../../../common/shellModel.js'

// Search over conversations, files and commands in one list (board S09, "Search"): Ctrl K, type, Enter. Esc closes it.

type Entry =
	| { kind: 'chat', id: string, title: string, where: string, glyph: ReturnType<typeof glyphOf> }
	| { kind: 'file', path: string, name: string, where: string }
	| { kind: 'command', id: string, title: string, run: () => void }

export const SearchPalette = () => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const shellService = accessor.get('IVaderShellService')
	const tools = accessor.get('IToolsService')
	const commands = accessor.get('ICommandService')
	const data = useShellData()
	const [q, setQ] = useState('')
	const [files, setFiles] = useState<{ path: string, name: string, where: string }[]>([])
	const [active, setActive] = useState(0)
	const input = useRef<HTMLInputElement>(null)
	useEffect(() => { input.current?.focus() }, [])

	const close = () => shellService.setSearchOpen(false)
	const query = q.trim().toLowerCase()

	// files of the open project, asked for after a pause in typing
	useEffect(() => {
		if (query.length < 2) { setFiles([]); return }
		let live = true
		const t = setTimeout(async () => {
			try {
				const res = (await (await tools.callTool.search_pathnames_only({ query: q.trim(), includePattern: null, pageNumber: 1 })).result).uris
				if (!live) return
				setFiles(res.slice(0, 6).map(u => {
					const p = u.fsPath.replace(/\\/g, '/')
					const parts = p.split('/')
					return { path: u.fsPath, name: parts[parts.length - 1], where: parts.slice(-3, -1).join('/') }
				}))
			} catch { if (live) setFiles([]) }
		}, 200)
		return () => { live = false; clearTimeout(t) }
	}, [q, query, tools])

	const entries = useMemo<Entry[]>(() => {
		const out: Entry[] = []
		for (const g of data.groups) for (const t of g.threads) {
			if (!query || t.title.toLowerCase().includes(query) || g.name.toLowerCase().includes(query)) out.push({ kind: 'chat', id: t.id, title: t.title, where: g.name, glyph: glyphOf(t.status) })
		}
		const chats = out.slice(0, 6)
		const cmds: Entry[] = ([
			['New chat', () => { chat.openNewThread(); shellService.show('conversation', 'conversation') }],
			['All agents', () => shellService.show('agents')],
			['Open Add-ons', () => { void commands.executeCommand(VADER_OPEN_ADDONS_ACTION_ID) }],
			['Open Settings', () => { void commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID) }],
			['Open in editor', () => shellService.openEditor()],
		] as [string, () => void][]).filter(([title]) => !query || title.toLowerCase().includes(query)).map(([title, run]) => ({ kind: 'command' as const, id: title, title, run }))
		return [...chats, ...files.map(f => ({ kind: 'file' as const, ...f })), ...(query ? cmds : cmds.slice(0, 3))]
	}, [data.groups, query, files, chat, shellService, commands])

	useEffect(() => { setActive(0) }, [q])

	const choose = (e: Entry) => {
		close()
		if (e.kind === 'chat') { chat.switchToThread(e.id); shellService.show('conversation') }
		else if (e.kind === 'file') { void commands.executeCommand('vscode.open', URI.file(e.path)); shellService.openEditor() }
		else e.run()
	}

	const sectionOf = (e: Entry) => e.kind === 'chat' ? 'Chats' : e.kind === 'file' ? 'Files' : 'Commands'
	let prevSection = ''

	return <div data-testid='vader-shell-search-palette' role='dialog' aria-label='Search' style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(0,0,0,.45)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 110 }} onMouseDown={close}>
		<div className='pop c' style={{ width: 560 }} onMouseDown={e => e.stopPropagation()}>
			<div className='r' style={{ height: 44, padding: '0 14px', gap: 10, borderBottom: '1px solid var(--ln)' }}>
				<span className='t3'><Icon k='search' /></span>
				<input ref={input} data-testid='vader-shell-search-input' className='fl' placeholder='Search chats, files and commands' value={q} onChange={e => setQ(e.target.value)}
					onKeyDown={e => {
						if (e.key === 'Escape') { e.preventDefault(); close() }
						else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(entries.length - 1, a + 1)) }
						else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
						else if (e.key === 'Enter' && entries[active]) { e.preventDefault(); choose(entries[active]) }
					}} />
			</div>
			<div className='c scroll' style={{ maxHeight: 380, padding: '4px 0' }}>
				{entries.length === 0 ? <div className='c' style={{ padding: '18px 16px', gap: 10 }} data-testid='vader-shell-search-empty'>
					<span className='t2'>Nothing matches &ldquo;{q.trim()}&rdquo; in {data.all.length} chats{data.currentProjectKey ? ` or in ${data.currentProjectName}` : ''}.</span>
					<span className='r' style={{ gap: 8 }}><button className='gb' onClick={() => setQ('')}>Clear</button></span>
				</div> : null}
				{entries.map((e, i) => {
					const s = sectionOf(e)
					const head = s !== prevSection ? <div key={'h' + s} className='hint' style={{ padding: '8px 14px 2px' }}>{s}</div> : null
					prevSection = s
					return <React.Fragment key={i}>
						{head}
						<button className={i === active ? 'opt on' : 'opt'} data-testid='vader-shell-search-result' onMouseEnter={() => setActive(i)} onClick={() => choose(e)} style={{ height: 32, padding: '0 14px' }}>
							{e.kind === 'chat' ? (e.glyph === 'running' ? <Spinner /> : e.glyph === 'needs_you' ? <WaitDot /> : e.glyph === 'review' ? <ReviewRing /> : <Gap />) : e.kind === 'file' ? <span className='t3'><Icon k='file' /></span> : <span className='t3'><Icon k='bolt' /></span>}
							<span className='fl tr'>{e.kind === 'file' ? e.name : e.title}</span>
							{e.kind === 'chat' || e.kind === 'file' ? <span className='hint tr' style={{ maxWidth: 200 }}>{e.where}</span> : null}
						</button>
					</React.Fragment>
				})}
			</div>
		</div>
	</div>
}
