/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import type { MarketplaceItemType } from '../../../../common/marketplace/marketplaceTypes.js'
import { StoreView } from './Store.js'

// Vader addition, part of the Unified Capability Marketplace (docs/integrations/marketplace.md).
// Mounted as an additive ViewPane inside the EXISTING Extensions view container (see
// marketplaceViewPane.ts) - not a new window, not a redesign of the native Extensions/
// Marketplace panes. EXTENSION-type results are deliberately left out: the native
// Marketplace/Installed panes already show those (unregressed, untouched), so this pane
// federates the other ecosystems the native Extensions view has no coverage of at all.
// The cards, the trust score and the detail pane are the same ones the Skills and MCP pages in Settings use (Store.tsx);
// here they are shown in one narrow column, with the details opening under the card.

const NON_EXTENSION_TYPES: MarketplaceItemType[] = ['SKILL', 'MCP_SERVER', 'ACP_AGENT', 'LANGUAGE_SERVER', 'DEBUG_ADAPTER', 'FORMATTER', 'TREE_SITTER_GRAMMAR', 'JUPYTER_KERNEL']

export const Marketplace = ({ query }: { query?: string }) => {
	return <div className='p-2'>
		<div className='text-vader-fg-3 pb-2'>Skills, MCP servers, coding agents, language servers, debuggers and formatters. Extensions are in the lists above.</div>
		<StoreView types={NON_EXTENSION_TYPES} layout='narrow' query={query} />
	</div>
}
