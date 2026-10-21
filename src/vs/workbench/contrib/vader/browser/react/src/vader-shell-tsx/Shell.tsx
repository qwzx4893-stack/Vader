/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import '../styles.css'
import './shell.css'
import { useShellState } from '../util/services.js'
import { Nav } from './Nav.js'
import { ShellStrip } from './ShellStrip.js'
import { ConversationPage } from './ConversationPage.js'
import { AgentsPage } from './AgentsPage.js'
import { AddonsPage } from './AddonsPage.js'
import { FilesPage } from './FilesPage.js'
import { SearchPalette } from './SearchPalette.js'

// The Vader window: the sidebar on the left, and on the right one page: a conversation (with its review, browser and terminals), all agents, or Add-ons.
// Boards R01 to R05 and R25 of the interface canvas. The editor is one click away (Open in editor) and the window comes back from the editor's title.

export const Shell = () => {
	const shell = useShellState()
	const [navOpen, setNavOpen] = useState(true)
	return <div className='shell' data-testid='vader-shell' data-page={shell.page}>
		<ShellStrip navOpen={navOpen} onToggleNav={() => setNavOpen(o => !o)} />
		<div className='r fl' style={{ alignItems: 'stretch' }}>
			{navOpen && shell.page !== 'files' ? <Nav /> : null}
			<div className='main-sheet fl' data-testid='vader-shell-main'>
				<div key={shell.page} className='pg c' style={{ flex: 1, minHeight: 0, minWidth: 0, height: '100%' }}>{shell.page === 'conversation' ? <ConversationPage /> : shell.page === 'agents' ? <AgentsPage /> : shell.page === 'files' ? <FilesPage /> : <AddonsPage />}</div>
			</div>
		</div>
		{shell.searchOpen ? <SearchPalette /> : null}
	</div>
}
