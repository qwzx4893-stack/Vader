/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { BlockCode } from '../util/BlockCodeExport.js'
import { Folded, moreLines } from '../../../../common/outputFold.js'

/** a result of a command: whole when short; when long, its head and how many lines are not shown, with Show all (the agent got all of it; board S13) */
export const FoldedOutput = ({ full, fold }: { full: string, fold: Folded }) => {
	const [all, setAll] = useState(false)
	return <div className='!select-text cursor-auto' data-testid='vader-command-output' data-folded={fold.folded && !all ? 'yes' : 'no'}>
		<BlockCode initValue={fold.folded && !all ? fold.text : full} language='shellscript' />
		{fold.folded ? <div className='flex items-center gap-3 pt-1 text-xs'>
			{all ? null : <span className='font-mono text-vader-fg-3' data-testid='vader-command-more'>{moreLines(fold.hidden)}</span>}
			<button type='button' data-testid='vader-command-showall' className='text-vader-fg-2 hover:text-vader-fg-1' onClick={() => setAll(a => !a)}>{all ? 'Show less' : 'Show all'}</button>
		</div> : null}
	</div>
}
