// The model picker as it is built for the app (react/src2), alone on a plain page. The test sets what the picker is given (models, providers without a key, lists
// that are loading or could not be fetched) and reads what it does. Used by test/pickerUiE2E.mjs.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../browser/react/src2/styles.css'
import { ProviderModelPicker } from '../../browser/react/src2/vader-settings-tsx/ProviderModelPicker'

const w = window as any
w.__log = [] as string[]
const log = (s: string) => w.__log.push(s)
const root = createRoot(document.getElementById('root')!)

type P = { options: [string, string, string[]][], selected?: [string, string], providerStates?: any[], withoutKey?: any[], addableCount?: number, local?: string[], open?: boolean }
w.__show = (p: P) => {
	const options = p.options.flatMap(([providerName, providerTitle, models]) => models.map(modelName => ({ selection: { providerName, modelName }, providerName, providerTitle, modelName })))
	root.render(<div className='vader-scope' style={{ padding: 20, height: 700, background: '#121214' }}>
		<div style={{ fontSize: 13, color: '#b0b0b5' }}>
			<ProviderModelPicker
				key={JSON.stringify(p).length + (p.open ? 'o' : 'c')}
				options={options}
				selected={p.selected ? { providerName: p.selected[0], modelName: p.selected[1] } : undefined}
				onChange={(o) => log(`choose:${o.providerName}/${o.modelName}`)}
				providerStates={p.providerStates}
				withoutKey={p.withoutKey}
				addableCount={p.addableCount}
				isLocal={(n) => (p.local ?? []).includes(n)}
				onRetry={(n) => log(`retry:${n}`)}
				onAddKey={(n) => log(`addkey:${n ?? ''}`)}
				onOpen={() => log('opened')}
				now={() => 1_000_000}
				defaultOpen={!!p.open}
			/>
		</div>
	</div>)
}
w.__mounted = true
