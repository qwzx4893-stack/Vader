/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React from 'react'
import { useAccessor, useModelRouterServiceState, useSettingsState } from '../util/services.js'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { RouterCategory } from '../../../../common/modelRouter/modelRouterTypes.js'
import { ProviderName } from '../../../../common/vaderSettingsTypes.js'
import { PageHead, Segmented } from './ui.js'

// Model router (board R10): besides the model you chat with, Vader makes helper calls (handing work to a sub-agent, researching, driving a browser, summarising old
// messages, the independent check). Automatic picks among the models you have a key for; Choose myself lets each job have its own. The table shows the model each
// job uses right now, and what it costs per million tokens, from the same router the agent asks.

const JOBS: { category: RouterCategory, label: string, what: string }[] = [
	{ category: 'subagent', label: 'Sub-agent work', what: 'Tasks handed off to a helper agent' },
	{ category: 'research', label: 'Research', what: 'Read-only look-ups' },
	{ category: 'browser', label: 'Browser', what: 'Turns that drive a web page' },
	{ category: 'summarization', label: 'Summaries', what: 'Shrinking old messages when the window fills' },
	{ category: 'verification', label: 'Independent check', what: 'The second agent that reviews a result' },
]
const CHAT = '(Chat model)'
const money = (n: number) => `$${n < 10 ? String(Math.round(n * 100) / 100) : String(Math.round(n))}`

export const RouterPage = () => {
	const accessor = useAccessor()
	const router = accessor.get('IModelRouterService')
	const state = useModelRouterServiceState()
	useSettingsState() // what is "configured" follows the provider settings
	const configured = router.listConfiguredModels()
	const auto = state.mode === 'auto'

	return <div data-testid='vader-settings-router'>
		<PageHead title='Model router' desc='Besides the model you chat with, Vader makes helper calls: handing work to a sub-agent, researching, driving a browser, summarising old messages and checking results. The router decides which model each one uses.' />
		<Segmented testId='vader-router-mode' value={state.mode} options={[{ id: 'auto', label: 'Automatic' }, { id: 'manual', label: 'Choose myself' }]} onChange={m => router.setMode(m as 'auto' | 'manual')} />
		<p className='hint' style={{ margin: '10px 0 22px', maxWidth: 520, lineHeight: 1.5 }} data-testid='vader-router-explain'>{auto ? 'Automatic picks the best model you have a key for, by what it can do. It never picks a provider you have not set up.' : 'Choose myself: every job uses your Chat model, unless you pick another one for it below.'}</p>

		{configured.length === 0 ? <div className='c' style={{ gap: 6, padding: '16px 0', borderTop: '1px solid var(--ln)' }} data-testid='vader-router-none'>
			<span className='t1' style={{ fontWeight: 600 }}>No model is set up yet</span>
			<span className='t2' style={{ lineHeight: 1.55 }}>Add a provider key on the Models page. Until then helper calls have nothing to run on.</span>
		</div> : <>
			<div className='th' style={{ gridTemplateColumns: '150px minmax(0,1fr) 250px 110px', padding: '0 2px', borderBottom: '1px solid var(--ln)' }}><span>Job</span><span>What it is</span><span>Model used now</span><span style={{ textAlign: 'right' }}>Cost per 1M</span></div>
			{JOBS.map(j => {
				const used = router.resolveModel(j.category)
				const d = used ? router.describeModel(used) : undefined
				const override = router.getCategoryOverride(j.category)
				const key = (p: ProviderName, m: string) => `${p}/${m}`
				const cost = !d ? '' : d.isLocal ? 'free, local' : d.costPerMillionInputTokens === 0 && d.costPerMillionOutputTokens === 0 ? 'no price known' : `${money(d.costPerMillionInputTokens)} / ${money(d.costPerMillionOutputTokens)}`
				return <div key={j.category} className='td' data-testid='vader-router-job' data-category={j.category} style={{ gridTemplateColumns: '150px minmax(0,1fr) 250px 110px', height: 50, padding: '0 2px' }}>
					<span className='t1' style={{ fontWeight: 500 }}>{j.label}</span>
					<span className='t3 tr'>{j.what}</span>
					{auto ? <span className='r t1' style={{ gap: 8, minWidth: 0 }} data-testid='vader-router-model'>{used ? <><ProviderLogo providerName={used.providerName} size={14} /><span className='tr'>{used.modelName}</span></> : <span className='t3'>none</span>}</span>
						: <span className='r' style={{ gap: 8, minWidth: 0 }}>{used ? <span className='t2' style={{ flex: 'none' }}><ProviderLogo providerName={used.providerName} size={14} /></span> : null}
							<select className='fl' aria-label={`Model for ${j.label}`} data-testid='vader-router-select' value={override ? key(override.providerName, override.modelName) : CHAT} style={{ background: 'transparent', color: 'var(--t1)', border: 0, outline: 0, minWidth: 0 }}
								onChange={e => { const v = e.target.value; if (v === CHAT) { router.setCategoryOverride(j.category, null); return } const i = v.indexOf('/'); router.setCategoryOverride(j.category, { providerName: v.slice(0, i) as ProviderName, modelName: v.slice(i + 1) }) }}>
								<option value={CHAT} style={{ background: '#19191c' }}>Chat model{used && !override ? ` (${used.modelName})` : ''}</option>
								{configured.map(c => <option key={key(c.providerName, c.modelName)} value={key(c.providerName, c.modelName)} style={{ background: '#19191c' }}>{c.modelName}</option>)}
							</select></span>}
					<span className='t2' data-testid='vader-router-cost' style={{ textAlign: 'right' }}>{cost}</span>
				</div>
			})}
			<div className='c' style={{ gap: 6, marginTop: 26 }}>
				<span className='hint'>How Automatic chooses</span>
				<p className='t2' style={{ margin: 0, maxWidth: 560, lineHeight: 1.6 }}>For sub-agents, research, the browser and the independent check it looks for a model that calls tools natively, can make several calls in one turn, and has a long context. For summaries it prefers the cheapest model, one that caches its prompt. It keeps your Chat model unless another one is clearly better for the job.</p>
			</div>
		</>}
	</div>
}
