/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor, useSettingsState } from '../util/services.js'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { formatCost, formatTokens, formatUsd, lastDays, modelRows, ModelRow, PROVIDER_USAGE_PAGES } from '../../../../common/usageAccounting.js'
import { parseMoney, parsePercent, parsePrice } from '../../../../common/settingsInput.js'
import { Group, NumberBox, Note, PageHead, Switch } from './ui.js'

// Usage and cost (board C01, C02, C03): the tokens each provider reported, the money worked out from list prices (shown with "≈" unless the provider billed it),
// which model it went to and where each number comes from, the daily limit, the provider pages that show the real bill, and the person's own prices.

const DAYS = 14
const SOURCE_LABEL: { [s in ModelRow['source']]: string } = { billed: 'Billed by provider', estimate: 'Estimate', free: 'Free, runs here', unpriced: 'No price known' }
const SOURCE_COLOR: { [s in ModelRow['source']]: string } = { billed: '#4cc38a', estimate: '#e2a93f', free: 'var(--t2)', unpriced: 'var(--t3)' }

export const UsagePage = () => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const settings = accessor.get('IVaderSettingsService')
	const opener = accessor.get('IOpenerService')
	const state = useSettingsState()
	const g = state.globalSettings
	const [, tick] = useState(0)
	useEffect(() => { const d = chat.onDidChangeUsage(() => tick(n => n + 1)); return () => d.dispose() }, [chat])

	const now = new Date()
	const ledger = chat.getUsageLedger()
	const days = lastDays(ledger, DAYS, now)
	const rows = modelRows(ledger, DAYS, now)
	const today = days[days.length - 1]
	const todayTotals = chat.getUsageToday()
	const total = days.reduce((a, d) => ({ cost: a.cost + d.costUsd, tokens: a.tokens + d.inputTokens + d.outputTokens }), { cost: 0, tokens: 0 })
	const billedAll = rows.length > 0 && rows.every(r => r.source === 'billed' || r.source === 'free')
	const peak = Math.max(...days.map(d => d.costUsd), 0.0001)
	const unpriced = rows.filter(r => r.source === 'unpriced')

	// the daily limit: off means no limit; on keeps the amount last typed
	const limit = g.dailySpendLimitUsd
	const [lastLimit, setLastLimit] = useState(limit === null ? 5 : limit)

	// the person's own prices and discount
	const withKey = Object.entries(PROVIDER_USAGE_PAGES).filter(([provider]) => (state.settingsOfProvider as any)[provider]?._didFillInProviderSettings)
	const [model, setModel] = useState('')
	const [inText, setInText] = useState('')
	const [outText, setOutText] = useState('')
	const [ownOpen, setOwnOpen] = useState(false)
	const ownRef = useRef<HTMLDivElement>(null)
	const overrides = g.modelPriceOverrides ?? {}
	const [priceProblem, setPriceProblem] = useState<string | undefined>()
	const addOverride = () => {
		if (!model.trim()) { setPriceProblem('Name the model the price is for.'); return }
		const i = parsePrice(inText), o = parsePrice(outText)
		if (!i.ok) { setPriceProblem(`Input: ${i.message}`); return }
		if (!o.ok) { setPriceProblem(`Output: ${o.message}`); return }
		setPriceProblem(undefined)
		settings.setGlobalSetting('modelPriceOverrides', { ...overrides, [model.trim()]: { input: i.value ?? 0, output: o.value ?? 0 } })
		setModel(''); setInText(''); setOutText('')
	}
	const removeOverride = (name: string) => { const { [name]: _drop, ...rest } = overrides; settings.setGlobalSetting('modelPriceOverrides', rest) }
	const setPriceFor = (name: string) => { setModel(name); setOwnOpen(true); setTimeout(() => ownRef.current?.scrollIntoView({ block: 'center' }), 0) }

	return <div data-testid='vader-settings-usage'>
		<PageHead title='Usage and cost' desc='Vader counts the tokens each provider reports. The money is worked out from list prices, so it is an estimate unless the provider billed it. Your provider’s own page is the bill.' />

		<div className='r' style={{ gap: 36, alignItems: 'flex-end' }}>
			<div className='c' style={{ gap: 4 }} data-testid='vader-usage-today'>
				<span className='hint'>Today</span>
				<span style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}>{formatCost(todayTotals.costUsd, todayTotals.billedCostUsd)}{todayTotals.unpricedTurns > 0 ? ' +' : ''}</span>
				<span className='hint'>{todayTotals.inputTokens.toLocaleString('en-US')} tokens in, {todayTotals.outputTokens.toLocaleString('en-US')} out</span>
			</div>
			<div className='c' style={{ gap: 4 }} data-testid='vader-usage-total'>
				<span className='hint'>Last {DAYS} days</span>
				<span style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}>{billedAll ? formatUsd(total.cost) : `≈ ${formatUsd(total.cost)}`}</span>
				<span className='hint'>{formatTokens(total.tokens)} tokens</span>
			</div>
			<div className='c fl' style={{ gap: 6, minWidth: 0 }}>
				<div className='r' data-testid='vader-usage-chart' role='img' aria-label={`Spending per day for the last ${DAYS} days`} style={{ gap: 6, height: 84, alignItems: 'flex-end' }}>
					{days.map((d, i) => <span key={d.day} title={`${d.day}  ${formatUsd(d.costUsd)}`} data-testid='vader-usage-bar' data-day={d.day} className='fl' style={{ height: Math.max(3, Math.round(80 * d.costUsd / peak)), borderRadius: 2, background: i === days.length - 1 && d.costUsd > 0 ? 'var(--t1)' : 'rgba(255,255,255,.2)' }} />)}
				</div>
				<div className='r hint'><span>{days[0].day.slice(5)}</span><span className='fl' /><span>Today</span></div>
			</div>
		</div>

		<Group title={`By model, last ${DAYS} days`}>
			<div className='th' style={{ gridTemplateColumns: 'minmax(0,1fr) 150px 90px 190px', padding: '0 2px', borderBottom: '1px solid var(--ln)' }}><span>Model</span><span style={{ textAlign: 'right' }}>Tokens in / out</span><span style={{ textAlign: 'right' }}>Cost</span><span style={{ textAlign: 'right' }}>Where the number comes from</span></div>
			{rows.length === 0 ? <div className='c' style={{ gap: 4, padding: '18px 2px' }} data-testid='vader-usage-empty'><span className='t1' style={{ fontWeight: 600 }}>Nothing used yet</span><span className='t2'>When a model answers, its tokens and cost appear here, by model.</span></div>
				: rows.map(r => <div key={r.key} className='td' data-testid='vader-usage-model' data-source={r.source} style={{ gridTemplateColumns: 'minmax(0,1fr) 150px 90px 190px', padding: '0 2px' }}>
					<span className='r' style={{ gap: 10, minWidth: 0 }}><span className='t3' style={{ width: 16, flex: 'none' }}><ProviderLogo providerName={r.providerName as any} size={15} /></span><span className='t1 tr'>{r.modelName}</span></span>
					<span className='mo' style={{ textAlign: 'right' }}>{formatTokens(r.inputTokens)} / {formatTokens(r.outputTokens)}</span>
					<span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className='t1'>{r.source === 'free' ? 'Free' : r.source === 'unpriced' ? <button className='tx' style={{ height: 'auto', padding: 0, color: 'var(--ac)' }} data-testid='vader-usage-set-price' onClick={() => setPriceFor(r.modelName)}>Set a price</button> : r.source === 'billed' ? formatUsd(r.costUsd) : `≈ ${formatUsd(r.costUsd)}`}</span>
					<span style={{ textAlign: 'right' }}><span className='hint' style={{ border: '1px solid var(--ln2)', borderRadius: 5, padding: '2px 7px', color: SOURCE_COLOR[r.source] }}>{SOURCE_LABEL[r.source]}</span></span>
				</div>)}
			{unpriced.length > 0 ? <span className='hint' style={{ paddingTop: 10, lineHeight: 1.5 }} data-testid='vader-usage-unpriced'>{unpriced.map(r => r.modelName).join(', ')} {unpriced.length === 1 ? 'has' : 'have'} no price Vader knows. {unpriced.length === 1 ? 'Its' : 'Their'} cost is not in the totals above, and never counted as free.</span> : null}
		</Group>

		<Group title='Daily limit'>
			<div className='r' style={{ gap: 14, padding: '10px 0', borderTop: '1px solid var(--ln)', borderBottom: '1px solid var(--ln)' }}>
				<div className='c fl' style={{ gap: 2 }}><span className='t1' style={{ fontWeight: 600 }}>Pause a task when today&rsquo;s estimate reaches</span><span className='hint' style={{ lineHeight: 1.5 }}>The limit counts the estimate. A provider that bills more than the list price can still spend more than this.</span></div>
				<NumberBox testId='vader-usage-limit' label='Daily limit in dollars' prefix='$' disabled={limit === null} initial={(limit ?? lastLimit).toFixed(2)} parse={t => parseMoney(t, { allowEmpty: false })} onCommit={v => { if (v !== null) { setLastLimit(v); settings.setGlobalSetting('dailySpendLimitUsd', v) } }} saved={v => `Daily limit set to ${formatUsd(v ?? 0)}`} />
				<Switch on={limit !== null} label='Daily limit' testId='vader-usage-limit-switch' onChange={v => { if (v) settings.setGlobalSetting('dailySpendLimitUsd', lastLimit); else settings.setGlobalSetting('dailySpendLimitUsd', null) }} />
			</div>
		</Group>

		<Group title='Check against the provider'>
			<div className='r' style={{ gap: 10, flexWrap: 'wrap' }} data-testid='vader-usage-providers'>
				{(withKey.length ? withKey : Object.entries(PROVIDER_USAGE_PAGES).slice(0, 4)).map(([provider, page]) => <button key={provider} className='gb' data-testid='vader-usage-provider-page' onClick={() => { void opener.open(URI.parse(page!.url)) }}><ProviderLogo providerName={provider as any} size={14} />{page!.label}</button>)}
				<span className='hint'>opens in your browser</span>
			</div>
		</Group>

		<div className='c' ref={ownRef} style={{ marginTop: 22, gap: 10 }}>
			<span className='hint' style={{ lineHeight: 1.5 }}>List prices are built into this version of Vader. <button className='tx' style={{ height: 'auto', padding: 0, color: 'var(--ac)' }} data-testid='vader-usage-own-toggle' aria-expanded={ownOpen} onClick={() => setOwnOpen(v => !v)}>Use my own prices</button> if you pay a contracted rate.</span>
			{ownOpen ? <div className='c' style={{ gap: 14, padding: '14px 16px', border: '1px solid var(--ln)', borderRadius: 10, background: 'var(--g1)' }} data-testid='vader-usage-own'>
				<div className='r' style={{ gap: 14 }}>
					<div className='c fl' style={{ gap: 2 }}><span className='t1'>Discount on list prices</span><span className='hint'>For a flat discount, such as 20% off. It changes the estimate only, never what you are charged.</span></div>
					<NumberBox testId='vader-usage-discount' label='Discount in percent' suffix='%' placeholder='0' width={84} initial={String(g.priceDiscountPercent || '')} parse={parsePercent} onCommit={v => settings.setGlobalSetting('priceDiscountPercent', v ?? 0)} saved={v => (v ?? 0) > 0 ? `Estimates are ${v}% lower` : 'No discount'} />
				</div>
				<div className='c' style={{ gap: 8 }}>
					<span className='t1'>Your own prices</span>
					<span className='hint' style={{ lineHeight: 1.5 }}>For a model Vader has no price for, or a contract. US dollars per million tokens. A model whose provider reports the charge does not need one.</span>
					{Object.entries(overrides).map(([name, p]) => <div key={name} className='r' style={{ gap: 10 }} data-testid='vader-usage-override'><span className='mo fl tr'>{name}</span><span className='hint'>in {p?.input} / out {p?.output}</span><button className='tx' onClick={() => removeOverride(name)}>Remove</button></div>)}
					<div className='r' style={{ gap: 8 }}>
						<input className='fld fl mo' data-testid='vader-usage-own-model' aria-label='Model name' placeholder='Model name' value={model} onChange={e => setModel(e.target.value)} />
						<input className='fld' style={{ width: 90 }} data-testid='vader-usage-own-in' aria-label='Input price' inputMode='decimal' placeholder='Input' value={inText} onChange={e => setInText(e.target.value)} />
						<input className='fld' style={{ width: 90 }} data-testid='vader-usage-own-out' aria-label='Output price' inputMode='decimal' placeholder='Output' value={outText} onChange={e => setOutText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addOverride() }} />
						<button className='pb' data-testid='vader-usage-own-add' onClick={addOverride}>Add</button>
					</div>
					{priceProblem ? <Note kind='warn' testId='vader-usage-own-problem'>{priceProblem}</Note> : null}
				</div>
			</div> : null}
		</div>
	</div>
}
