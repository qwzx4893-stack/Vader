/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { trustLevelOf, TrustScore } from '../../../../common/marketplace/trustScore.js'

export const LEVEL_WORD = { high: 'High trust', medium: 'Read first', low: 'Risky' } as const

// The colours are written inline in each className on purpose: the build that scopes Tailwind to Vader's own UI rewrites class names
// it finds inside className attributes, not ones kept in a constant, and a rewritten name is the one the stylesheet defines.
export const TrustMeter = ({ score, large }: { score: TrustScore, large?: boolean }) => {
	const level = trustLevelOf(score.score)
	return <div className={`flex flex-col items-end gap-1 shrink-0 ${large ? 'w-24' : 'w-20'}`} title={`${LEVEL_WORD[level]}: ${score.score} out of 100`} aria-label={`Trust ${score.score} percent, ${LEVEL_WORD[level]}`}>
		<span className={`font-semibold tabular-nums leading-none ${level === 'high' ? 'text-green-500' : level === 'medium' ? 'text-yellow-500' : 'text-red-500'} ${large ? 'text-3xl' : 'text-root'}`}>{score.score}%</span>
		<div className={`rounded-full bg-black/10 dark:bg-white/10 overflow-hidden ${large ? 'h-1.5 w-16' : 'h-1 w-12'}`}>
			<div className={`h-full rounded-full ${level === 'high' ? 'bg-green-500' : level === 'medium' ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${score.score}%` }} />
		</div>
		<span className={`text-xs leading-none whitespace-nowrap ${level === 'high' ? 'text-green-500' : level === 'medium' ? 'text-yellow-500' : 'text-red-500'}`}>{LEVEL_WORD[level]}</span>
	</div>
}

