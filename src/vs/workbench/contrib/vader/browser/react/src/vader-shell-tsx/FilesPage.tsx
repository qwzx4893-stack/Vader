/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor, useShellState } from '../util/services.js'
import { Icon } from './icons.js'

// "Open in editor": the files of the project, to look at the code. Back at the top left, the folders and files of the project on the left, the file you chose on the right,
// in the interface's own design. It is for reading (nothing here changes a file); the agent does the editing. The editor of the classic layout is not shown from here.

type Entry = { name: string, path: string, dir: boolean }
const HIDDEN = new Set(['.git', 'node_modules'])
const MAX_BYTES = 2 * 1024 * 1024
const MAX_LINES = 5000
const MONO = "'Cascadia Code','Cascadia Mono',Consolas,ui-monospace,monospace"

const fwd = (p: string) => p.replace(/\\/g, '/')
const byKind = (a: Entry, b: Entry) => a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

type Shown = { path: string, lines: string[], note?: string } | { path: string, lines?: undefined, note: string }

export const FilesPage = () => {
	const accessor = useAccessor()
	const files = accessor.get('IFileService')
	const workspace = accessor.get('IWorkspaceContextService')
	const shellService = accessor.get('IVaderShellService')
	const shell = useShellState()
	const root = workspace.getWorkspace().folders[0]?.uri
	const rootPath = root?.fsPath ?? ''
	const [kids, setKids] = useState<Record<string, Entry[] | 'error'>>({})
	const [open, setOpen] = useState<Record<string, boolean>>({})
	const [shown, setShown] = useState<Shown | null>(null)

	const load = useCallback(async (dir: string) => {
		try {
			const stat = await files.resolve(URI.file(dir))
			const list = (stat.children ?? []).filter(c => !HIDDEN.has(c.name)).map(c => ({ name: c.name, path: c.resource.fsPath, dir: c.isDirectory })).sort(byKind)
			setKids(k => ({ ...k, [dir]: list }))
		} catch { setKids(k => ({ ...k, [dir]: 'error' })) }
	}, [files])

	useEffect(() => { if (rootPath) void load(rootPath) }, [rootPath, load])

	// a file chosen from elsewhere (the search): open the folders above it
	const chosen = shell.file
	useEffect(() => {
		if (!chosen || !rootPath || !fwd(chosen).toLowerCase().startsWith(fwd(rootPath).toLowerCase())) { return }
		const parts = fwd(chosen).slice(rootPath.length).split('/').filter(Boolean)
		const sep = rootPath.includes('\\') ? '\\' : '/'
		let dir = rootPath
		for (const part of parts.slice(0, -1)) {
			dir = dir.replace(/[\\/]$/, '') + sep + part
			const d = dir
			setOpen(o => ({ ...o, [d]: true }))
			void load(d)
		}
	}, [chosen, rootPath, load])

	useEffect(() => {
		if (!chosen) { setShown(null); return }
		let live = true
		void (async () => {
			try {
				const uri = URI.file(chosen)
				const stat = await files.stat(uri)
				if (!live) { return }
				if (stat.size > MAX_BYTES) { setShown({ path: chosen, note: 'This file is larger than 2 MB, so it is not shown.' }); return }
				const bytes = (await files.readFile(uri)).value.buffer
				if (!live) { return }
				if (bytes.subarray(0, 8000).includes(0)) { setShown({ path: chosen, note: 'This file is not text, so it is not shown.' }); return }
				const all = new TextDecoder('utf-8').decode(bytes).split(/\r?\n/)
				setShown({ path: chosen, lines: all.slice(0, MAX_LINES), note: all.length > MAX_LINES ? `Showing the first ${MAX_LINES} of ${all.length} lines.` : undefined })
			} catch { if (live) { setShown({ path: chosen, note: 'This file could not be read.' }) } }
		})()
		return () => { live = false }
	}, [chosen, files])

	const toggle = (e: Entry) => {
		setOpen(o => ({ ...o, [e.path]: !o[e.path] }))
		if (!kids[e.path]) { void load(e.path) }
	}

	const row = (e: Entry, depth: number) => {
		const selected = !e.dir && e.path === chosen
		return <button key={e.path} type='button' data-testid={e.dir ? 'vader-files-dir' : 'vader-files-file'} data-path={e.path} aria-expanded={e.dir ? !!open[e.path] : undefined} aria-current={selected ? 'true' : undefined}
			onClick={() => e.dir ? toggle(e) : shellService.openFile(e.path)}
			style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: 26, padding: `0 8px 0 ${8 + depth * 14}px`, border: 0, borderRadius: 6, background: selected ? 'var(--g3)' : 'transparent', color: selected ? 'var(--t1)' : 'var(--t2)', fontSize: 13, textAlign: 'start', cursor: 'pointer', flex: 'none' }}>
			<Icon k={e.dir ? (open[e.path] ? 'down' : 'right') : 'file'} small />
			<span className='fl tr' data-i18n-skip>{e.name}</span>
		</button>
	}

	const dirRows = (dir: string, depth: number): React.ReactNode => {
		const list = kids[dir]
		if (!list) { return <div className='t3' style={{ padding: `4px 8px 4px ${8 + depth * 14}px`, fontSize: 12.5 }}>Loading...</div> }
		if (list === 'error') { return <div className='t3' style={{ padding: `4px 8px 4px ${8 + depth * 14}px`, fontSize: 12.5 }}>This folder could not be read.</div> }
		return list.map(e => <React.Fragment key={e.path}>{row(e, depth)}{e.dir && open[e.path] ? dirRows(e.path, depth + 1) : null}</React.Fragment>)
	}

	const relative = shown && rootPath && fwd(shown.path).toLowerCase().startsWith(fwd(rootPath).toLowerCase()) ? fwd(shown.path).slice(rootPath.length).replace(/^\//, '') : shown?.path

	return <div className='r' style={{ height: '100%', alignItems: 'stretch', minHeight: 0 }} data-testid='vader-files'>
		<div className='c' style={{ width: 280, flex: 'none', borderRight: '1px solid var(--ln)', minHeight: 0 }}>
			<div className='r' style={{ height: 44, padding: '0 10px', flex: 'none', borderBottom: '1px solid var(--ln)' }}>
				<button type='button' className='tx t1' data-testid='vader-files-back' onClick={() => shellService.show('conversation')}><Icon k='left' small /> Back</button>
			</div>
			<div className='c' style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 6px' }} data-testid='vader-files-tree'>
				{root ? dirRows(rootPath, 0) : <div className='t3' style={{ padding: 8, fontSize: 12.5 }}>Open a folder to see its files.</div>}
			</div>
		</div>
		<div className='c fl' style={{ minWidth: 0, minHeight: 0 }}>
			{shown ? <>
				<div className='r' style={{ height: 44, padding: '0 16px', flex: 'none', borderBottom: '1px solid var(--ln)', gap: 10 }}>
					<span className='mo t2 tr fl' data-testid='vader-files-path' data-i18n-skip>{relative}</span>
					{shown.lines && shown.note ? <span className='hint'>{shown.note}</span> : null}
				</div>
				{shown.lines
					? <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} data-testid='vader-files-code' data-i18n-skip>
						<div dir='ltr' style={{ display: 'flex', minWidth: 'max-content', fontFamily: MONO, fontSize: 12.5, lineHeight: '20px' }}>
							<pre style={{ margin: 0, padding: '10px 12px', textAlign: 'end', color: 'var(--t3)', userSelect: 'none', position: 'sticky', left: 0, background: 'var(--g1)' }}>{shown.lines.map((_, i) => i + 1).join('\n')}</pre>
							<pre style={{ margin: 0, padding: '10px 24px 10px 4px', flex: 1, tabSize: 4, userSelect: 'text' }}>{shown.lines.join('\n')}</pre>
						</div>
					</div>
					: <div className='t3' style={{ padding: 24 }} data-testid='vader-files-note'>{shown.note}</div>}
			</> : <div className='c' style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><span className='t3' data-testid='vader-files-empty'>Choose a file on the left.</span></div>}
		</div>
	</div>
}
