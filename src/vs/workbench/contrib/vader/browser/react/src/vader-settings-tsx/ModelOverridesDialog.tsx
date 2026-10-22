/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react'
import { useAccessor, useSettingsState } from '../util/services.js'
import { getModelCapabilities, modelOverrideKeys, ModelOverrides } from '../../../../common/modelCapabilities.js'
import { ProviderName, displayInfoOfProviderName } from '../../../../common/vaderSettingsTypes.js'
import { Note, Switch } from './ui.js'

// What Vader assumes about a model (its context window, whether it calls tools natively, its price) can be overridden per model with a small JSON object, for a model
// Vader does not recognise or a server that differs from the vendor's. Only the keys Vader reads are kept; empty ones are dropped.

export type OverrideTarget = { modelName: string, providerName: ProviderName, type: 'autodetected' | 'custom' | 'default' }

export const ModelOverridesDialog = ({ target, onClose }: { target: OverrideTarget, onClose: () => void }) => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const state = useSettingsState()
	const { modelName, providerName, type } = target
	const defaults = getModelCapabilities(providerName, modelName, undefined)
	const current = state.overridesOfModel?.[providerName]?.[modelName] ?? undefined
	const { recognizedModelName, isUnrecognizedModel } = defaults
	const partialDefaults: Partial<ModelOverrides> = {}
	for (const k of modelOverrideKeys) { if (defaults[k]) partialDefaults[k] = defaults[k] as any }
	const placeholder = JSON.stringify(partialDefaults, null, 2)
	const [on, setOn] = useState(!!current)
	const [text, setText] = useState(current ? JSON.stringify(current, null, 2) : placeholder)
	const [problem, setProblem] = useState<string | undefined>()
	const ref = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null
		ref.current?.focus()
		return () => { if (previous?.isConnected) previous.focus() }
	}, [])

	const save = async () => {
		if (!on) { await settings.setOverridesOfModel(providerName, modelName, undefined); onClose(); return }
		let parsed: Record<string, unknown>
		try { parsed = JSON.parse(text) } catch { setProblem('That is not valid JSON. Check the commas and the quotes.'); return }
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { setProblem('It should be an object, like { "contextWindow": 128000 }.'); return }
		const cleaned: Partial<ModelOverrides> = {}
		for (const k of modelOverrideKeys) { if (!(k in parsed)) continue; const v = parsed[k]; if (!(v === '' || v === null || v === undefined)) cleaned[k] = v as any }
		await settings.setOverridesOfModel(providerName, modelName, cleaned)
		onClose()
	}

	return <div role='dialog' aria-modal='true' aria-label={`Defaults for ${modelName}`} data-testid='vader-overrides-dialog' onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
		style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 0 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
		<div className='sheet c' style={{ width: 560, maxHeight: '88vh', padding: 22, gap: 14, overflow: 'auto' }}>
			<div className='c' style={{ gap: 4 }}><span className='t1' style={{ fontWeight: 600, fontSize: 15 }}>Defaults for {modelName}</span><span className='hint'>{displayInfoOfProviderName(providerName).title}</span></div>
			<span className='t2' style={{ lineHeight: 1.55 }}>{type === 'default' ? `${modelName} comes with Vader, so you should not need to change these.` : isUnrecognizedModel ? 'Vader does not recognise this model, so it assumes safe defaults. Set what you know about it here.' : `Vader recognises it as ${recognizedModelName}.`}</span>
			<div className='r' style={{ gap: 12 }}><Switch on={on} label='Override the defaults' testId='vader-overrides-switch' onChange={setOn} /><span className='t1'>Override the defaults</span></div>
			<textarea className='ta mo' data-testid='vader-overrides-text' rows={9} readOnly={!on} spellCheck={false} aria-label='Overrides as JSON' style={{ resize: 'vertical', userSelect: 'text', opacity: on ? 1 : .55 }} value={text} onChange={e => { setText(e.target.value); setProblem(undefined) }} />
			{problem ? <Note kind='warn' testId='vader-overrides-problem'>{problem}</Note> : null}
			<div className='r' style={{ gap: 10, justifyContent: 'flex-end' }}><button ref={ref} className='tx' onClick={onClose}>Cancel</button><button className='pb' data-testid='vader-overrides-save' onClick={() => void save()}>Save</button></div>
		</div>
	</div>
}
