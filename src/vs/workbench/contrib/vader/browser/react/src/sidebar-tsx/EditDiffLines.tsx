/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The change an edit made, as the lines of the boards (R01): the line number, the sign, the line; the words that changed are marked inside the line.
// It is plain markup, so it shows the same in the Vader window, in the side bar and in a test page; no editor is started for it.
import React, { useEffect, useState } from 'react'
import { diffLines, diffWordsWithSpace } from 'diff'
import { useAccessor } from '../util/services.js'
import { extractSearchReplaceBlocks } from '../../../../common/helpers/extractCodeFromResult.js'

type Kind = 'n' | 'x' | 'p'
type Row = { kind: Kind, text: string, no: number | undefined, words?: { text: string, changed: boolean }[] }

const MONO = "'Cascadia Code','Cascadia Mono',Consolas,ui-monospace,monospace"
const lines = (s: string): string[] => { const out = s.split(/\r?\n/); if (out.length && out[out.length - 1] === '') out.pop(); return out }

/** the line where a block starts in the file (1 based): where the new text is when the edit was applied, else where the old text is; undefined when the file is not at hand */
export const startLineOf = (fileText: string | undefined, orig: string, final: string): number | undefined => {
	if (!fileText) return undefined
	const at = (needle: string) => { if (!needle) return -1; const i = fileText.indexOf(needle); return i < 0 ? -1 : fileText.slice(0, i).split('\n').length }
	const a = at(final), b = at(orig)
	const n = a > 0 ? a : b > 0 ? b : -1
	return n > 0 ? n : undefined
}

/** the rows of one block: the old lines that went (x), the new lines that came (p) and the lines that stayed (n), with numbers when the start is known */
export const rowsOfBlock = (orig: string, final: string, start: number | undefined): Row[] => {
	const rows: Row[] = []
	let oldNo = start, newNo = start
	const parts = diffLines(orig, final)
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i]
		const ls = lines(p.value)
		if (p.removed) {
			const next = parts[i + 1]
			const pair = next?.added ? lines(next.value) : undefined
			ls.forEach((text, k) => {
				const row: Row = { kind: 'x', text, no: oldNo === undefined ? undefined : oldNo + k }
				if (pair && pair.length === ls.length) row.words = diffWordsWithSpace(text, pair[k]).filter(c => !c.added).map(c => ({ text: c.value, changed: !!c.removed }))
				rows.push(row)
			})
			if (oldNo !== undefined) oldNo += ls.length
		} else if (p.added) {
			const prev = parts[i - 1]
			const pair = prev?.removed ? lines(prev.value) : undefined
			ls.forEach((text, k) => {
				const row: Row = { kind: 'p', text, no: newNo === undefined ? undefined : newNo + k }
				if (pair && pair.length === ls.length) row.words = diffWordsWithSpace(pair[k], text).filter(c => !c.removed).map(c => ({ text: c.value, changed: !!c.added }))
				rows.push(row)
			})
			if (newNo !== undefined) newNo += ls.length
		} else {
			ls.forEach((text, k) => rows.push({ kind: 'n', text, no: newNo === undefined ? undefined : newNo + k }))
			if (oldNo !== undefined) oldNo += ls.length
			if (newNo !== undefined) newNo += ls.length
		}
	}
	return rows
}

export const countsOfBlocks = (searchReplaceBlocks: string): { added: number, removed: number } => {
	let added = 0, removed = 0
	for (const b of extractSearchReplaceBlocks(searchReplaceBlocks)) {
		for (const p of diffLines(b.orig, b.final)) { const n = lines(p.value).length; if (p.added) added += n; else if (p.removed) removed += n }
	}
	return { added, removed }
}

const TINT = { x: 'rgba(229,72,77,.085)', p: 'rgba(46,160,98,.095)', n: 'transparent' } as const
const WORD = { x: 'rgba(229,72,77,.3)', p: 'rgba(46,160,98,.32)' } as const

export const EditDiffLines = ({ uri, searchReplaceBlocks }: { uri?: any, searchReplaceBlocks: string }) => {
	const accessor = useAccessor()
	const blocks = extractSearchReplaceBlocks(searchReplaceBlocks ?? '')
	// the text of the file, to number the lines: read when it is at hand, so a file the agent changed in the background is numbered too
	const [fileText, setFileText] = useState<string | undefined>()
	useEffect(() => {
		let gone = false
		void (async () => { try { const r = uri ? await accessor.get('IVaderModelService').getModelSafe(uri) : undefined; if (!gone) setFileText(r?.model?.getValue()) } catch { /* no numbers */ } })()
		return () => { gone = true }
	}, [accessor, uri?.fsPath, searchReplaceBlocks])
	if (blocks.length === 0) return <div className='py-1 text-vader-fg-4 text-xs' data-testid='vader-diff-empty'>No changes found</div>
	return <div className='flex flex-col py-1' data-testid='vader-diff' style={{ fontFamily: MONO, fontSize: 12, lineHeight: '20px' }}>
		{blocks.map((block, bi) => {
			const rows = rowsOfBlock(block.orig, block.final, startLineOf(fileText, block.orig, block.final))
			return <div key={bi} className='flex flex-col' style={bi > 0 ? { marginTop: 6, borderTop: '1px dashed var(--vader-border-3)', paddingTop: 6 } : undefined}>
				{rows.map((r, i) => <div key={i} data-testid='vader-diff-line' data-kind={r.kind} className='whitespace-pre text-vader-fg-2' style={{ background: TINT[r.kind], tabSize: 2, minWidth: 'max-content' }}>
					<b className='inline-block text-right text-vader-fg-4 font-normal select-none' style={{ width: 40, paddingRight: 10 }}>{r.no ?? ''}</b>
					<i className='inline-block not-italic text-center select-none text-vader-fg-4' style={{ width: 16, color: r.kind === 'x' ? 'var(--delt, #f1a1a4)' : r.kind === 'p' ? 'var(--addt, #8fd7ac)' : undefined }}>{r.kind === 'x' ? '−' : r.kind === 'p' ? '+' : ''}</i>
					{r.words && r.kind !== 'n' ? r.words.map((w, k) => w.changed ? <span key={k} style={{ background: WORD[r.kind as 'x' | 'p'], borderRadius: 2 }}>{w.text}</span> : <React.Fragment key={k}>{w.text}</React.Fragment>) : r.text}
				</div>)}
			</div>
		})}
	</div>
}
