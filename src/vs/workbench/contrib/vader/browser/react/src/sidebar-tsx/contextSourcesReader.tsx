/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { useAccessor } from '../util/services.js'
import { clipContext, ContextSourceId, ContextSourceInfo, hostAndPort, offeredSources, sourceTitle } from '../../../../common/contextSources.js'

// Reads the three sources of the @ menu from the real services: the active terminal's text, the page open in the agent's browser, the changes in git.

type Accessor = ReturnType<typeof useAccessor>

const terminalText = async (accessor: Accessor): Promise<string> => {
	try {
		const instance = accessor.get('ITerminalService').activeInstance
		const text = instance?.xterm?.getContentsAsText() ?? ''
		return text.replace(/\s+$/, '')
	} catch { return '' }
}

const activePage = async (accessor: Accessor): Promise<{ pageId: string, url: string } | undefined> => {
	try {
		const pages = await accessor.get('IBrowserToolMainService').listPages()
		const p = pages.find(x => x.isActive && !x.isClosed)
		return p && p.url && p.url !== 'about:blank' ? { pageId: p.pageId, url: p.url } : undefined
	} catch { return undefined }
}

/** which sources have something to give right now, and what to say beside each */
export async function peekContextSources(accessor: Accessor): Promise<ContextSourceInfo[]> {
	const [text, page, changes] = await Promise.all([
		terminalText(accessor),
		activePage(accessor),
		accessor.get('IVaderReviewService').changesForContext().catch(() => ({ files: 0, text: '' })),
	])
	return offeredSources({ terminalLines: text ? text.split(/\r?\n/).filter(l => l.trim()).length : 0, browserUrl: page?.url, gitFiles: changes.files })
}

/** what a source holds now, cut to a size the model can be given */
export async function readContextSource(accessor: Accessor, id: ContextSourceId): Promise<{ title: string, text: string, cut: boolean } | undefined> {
	if (id === 'terminal') {
		const text = await terminalText(accessor)
		if (!text) return undefined
		const c = clipContext(text, 'terminal')
		return { title: sourceTitle('terminal'), text: c.text, cut: c.cut }
	}
	if (id === 'browser') {
		const page = await activePage(accessor)
		if (!page) return undefined
		const snap = await accessor.get('IBrowserToolMainService').snapshot(page.pageId)
		const c = clipContext(`${snap.title}\n${snap.url}\n\n${snap.snapshotText}`, 'browser')
		return { title: sourceTitle('browser', hostAndPort(snap.url)), text: c.text, cut: c.cut }
	}
	const changes = await accessor.get('IVaderReviewService').changesForContext()
	if (!changes.text) return undefined
	const c = clipContext(changes.text, 'git')
	return { title: sourceTitle('git'), text: c.text, cut: c.cut }
}
