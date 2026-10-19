/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *  Rewritten by Vader (the first run of boards R22 to R24 and W02: where the models come from, the project and how much Vader asks, a first task).
 *--------------------------------------------------------------------------------------*/

// First run, in three steps with what each one means shown beside it. Step 1 sets where the models come from and really tests it (a key is saved, the provider is
// asked for its models, and what came back is said: how many, or why not). Step 2 shows the open folder and sets how much Vader asks before it acts. Step 3
// offers a first task. Every step can be skipped, and everything can be changed later in Settings. The step the person is on is remembered, because choosing a
// folder reloads the window.

import React, { useEffect, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { StorageScope, StorageTarget } from '../../../../../../../platform/storage/common/storage.js'
import { useAccessor, useCloudModelListState, usePolicyServiceState, useRefreshModelState, useSettingsState, useExternalAgentsState } from '../util/services.js'
import { OneClickSwitchButton } from '../vader-settings-tsx/Settings.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { transferEditorTypes } from '../../../extensionTransferTypes.js'
import { cloudListedProviderNames, CloudListedProviderName } from '../../../../common/cloudModelListTypes.js'
import { displayInfoOfProviderName, isFeatureNameDisabled, localProviderNames, providerNames } from '../../../../common/vaderSettingsTypes.js'
import { VADER_OPEN_SETTINGS_ACTION_ID } from '../../../actionIDs.js'
import '../styles.css'
import '../vader-shell-tsx/shell.css'

const STEP_KEY = 'vader.onboardingStep'
type Step = 1 | 2 | 3
type Choice = 'key' | 'agent' | 'local'

const FIRST = ['openRouter', 'anthropic', 'openAI', 'gemini', 'groq', 'mistral'] as const
const providersInOrder = (): CloudListedProviderName[] => [...FIRST.filter(p => (cloudListedProviderNames as readonly string[]).includes(p)), ...cloudListedProviderNames.filter(p => !(FIRST as readonly string[]).includes(p))] as CloudListedProviderName[]

const Stepper = ({ step }: { step: Step }) => <div className='r' style={{ gap: 10 }} data-testid='vader-onboarding-steps'>
	{(['Models', 'Project', 'First task'] as const).map((label, i) => {
		const n = (i + 1) as Step
		const done = n < step
		return <React.Fragment key={label}>
			{i > 0 ? <span style={{ width: 28, height: 1, background: 'var(--ln2)' }} /> : null}
			<span className='r' style={{ gap: 8, color: n === step ? 'var(--t1)' : 'var(--t3)', fontWeight: n === step ? 600 : 400 }} aria-current={n === step ? 'step' : undefined}>
				<span className='r' style={{ width: 20, height: 20, borderRadius: 10, justifyContent: 'center', fontSize: 11, border: n === step ? '1px solid var(--t1)' : '1px solid var(--ln2)', background: done ? 'var(--t1)' : undefined, color: done ? '#000' : undefined }}>{done ? '✓' : n}</span>{label}
			</span>
		</React.Fragment>
	})}
</div>

const Radio = ({ on }: { on: boolean }) => <span className='r' style={{ width: 16, height: 16, borderRadius: 8, border: '1px solid ' + (on ? 'var(--t1)' : 'var(--ln2)'), justifyContent: 'center', flex: 'none' }}>{on ? <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--t1)' }} /> : null}</span>

const Side = ({ title, rows, thenTitle, then }: { title: string, rows: [string, string][], thenTitle?: string, then?: [string, string][] }) => <div className='c' style={{ width: 440, gap: 4, justifyContent: 'center' }}>
	<span className='hint' style={{ padding: '0 0 6px' }}>{title}</span>
	{rows.map(([t, d]) => <div key={t} className='c' style={{ gap: 3, padding: '14px 0', borderTop: '1px solid var(--ln)' }}><span className='t1' style={{ fontWeight: 600 }}>{t}</span><span className='t2' style={{ lineHeight: 1.5 }}>{d}</span></div>)}
	{thenTitle ? <span className='hint' style={{ padding: '26px 0 6px' }}>{thenTitle}</span> : null}
	{(then ?? []).map(([t, d], i) => <div key={t} className='r' style={{ gap: 14, padding: '12px 0', borderTop: '1px solid var(--ln)', alignItems: 'flex-start' }}><span className='t3' style={{ width: 14 }}>{i + 2}</span><div className='c' style={{ gap: 2 }}><span className='t1' style={{ fontWeight: 600 }}>{t}</span><span className='t2'>{d}</span></div></div>)}
</div>

export const VaderOnboarding = () => {
	const settingsState = useSettingsState()
	const complete = settingsState.globalSettings.isOnboardingComplete
	return <div className='shell' data-testid='vader-onboarding' style={{ position: 'fixed', inset: 0, zIndex: 99999, height: '100vh', width: '100vw', transition: 'opacity 600ms ease-in-out', opacity: complete ? 0 : 1, pointerEvents: complete ? 'none' : 'auto' }}>
		<ErrorBoundary><Pages /></ErrorBoundary>
	</div>
}

const Pages = () => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const policy = accessor.get('IPolicyService')
	const storage = accessor.get('IStorageService')
	const commands = accessor.get('ICommandService')
	const opener = accessor.get('IOpenerService')
	const chat = accessor.get('IChatThreadService')
	const gateway = accessor.get('IAgentGatewayService')
	const refresh = accessor.get('IRefreshModelService')
	const workspace = accessor.get('IWorkspaceContextService')
	const settingsState = useSettingsState()
	const policyState = usePolicyServiceState()
	const cloud = useCloudModelListState()
	const localState = useRefreshModelState()
	const agents = useExternalAgentsState()

	const [step, setStepState] = useState<Step>(() => { const s = Number(storage.get(STEP_KEY, StorageScope.APPLICATION)); return s === 2 || s === 3 ? s : 1 })
	const setStep = (s: Step) => { setStepState(s); storage.store(STEP_KEY, String(s), StorageScope.APPLICATION, StorageTarget.MACHINE) }
	const [choice, setChoice] = useState<Choice>('key')
	const [provider, setProvider] = useState<CloudListedProviderName>('openRouter')
	const [key, setKey] = useState('')
	const [asked, setAsked] = useState(false)
	const [showImport, setShowImport] = useState(false)
	const [task, setTask] = useState('')
	const [noModel, setNoModel] = useState(false)

	const finish = () => {
		settings.setGlobalSetting('isOnboardingComplete', true)
		storage.remove(STEP_KEY, StorageScope.APPLICATION)
		accessor.get('IMetricsService').capture('Completed Onboarding', {})
	}

	// ---- step 1: the key, really tested
	const who = displayInfoOfProviderName(provider).title
	const list = cloud[provider]
	const testing = asked && list?.status === 'loading'
	const works = asked && list?.status === 'ok'
	const failed = asked && list?.status === 'error' ? list : undefined
	const test = () => {
		if (!key.trim()) return
		setAsked(true)
		void settings.setSettingOfProvider(provider, 'apiKey', key.trim())
		void refresh.refreshCloudModels(provider)
	}
	/** make the first model of the provider the one the chat uses, when nothing is chosen yet */
	const useProviderModel = (p: CloudListedProviderName | 'ollama' | 'lmStudio' | 'vLLM', modelName?: string) => {
		const models = settingsState.settingsOfProvider[p].models.filter(m => !m.isHidden)
		const name = modelName ?? models[0]?.modelName
		if (name) settings.setModelSelectionOfFeature('Chat', { providerName: p, modelName: name })
	}
	const continueFromKey = () => { if (!settingsState.modelSelectionOfFeature.Chat || settingsState.modelSelectionOfFeature.Chat.providerName !== provider) useProviderModel(provider); setStep(2) }

	// local models: Ollama and LM Studio are looked for by themselves; "Look again" asks once more
	const ollama = settingsState.settingsOfProvider.ollama.models.filter(m => !m.isHidden)
	const lmStudio = settingsState.settingsOfProvider.lmStudio.models.filter(m => !m.isHidden)
	const found = ollama.length > 0 ? { p: 'ollama' as const, name: 'Ollama', port: 11434, models: ollama } : lmStudio.length > 0 ? { p: 'lmStudio' as const, name: 'LM Studio', port: 1234, models: lmStudio } : undefined
	const lookAgain = () => { for (const p of localProviderNames) { if (p !== 'vLLM') refresh.startRefreshingModels(p, { enableProviderOnSuccess: true, doNotFire: false }) } }
	useEffect(() => { if (choice === 'local') lookAgain() }, [choice]) // eslint-disable-line react-hooks/exhaustive-deps
	const looking = localProviderNames.some(p => p !== 'vLLM' && localState[p]?.state === 'refreshing')

	// ---- connected agents the person may already pay for
	const readyAgents = Object.entries(agents.statuses).filter(([, s]) => s && s.state === 'ready').map(([id]) => id)

	// ---- step 2: the folder
	const folder = workspace.getWorkspace().folders[0]
	// ---- step 3: the first task
	const startTask = (text: string, mode: 'gather' | 'agent') => {
		if (isFeatureNameDisabled('Chat', settingsState) && !settingsState.globalSettings.externalAgentId) { setNoModel(true); return }
		settings.setGlobalSetting('chatMode', mode)
		chat.openNewThread()
		const threadId = chat.state.currentThreadId
		finish()
		void gateway.startTask({ userMessage: text, threadId })
	}

	const TASKS: { title: string, text: string, tag: string, mode: 'gather' | 'agent', prompt: string }[] = [
		{ title: 'Explain this project', text: 'Reads it and tells you how it fits together. Changes nothing.', tag: 'Read only', mode: 'gather', prompt: 'Explain this project: what it is, how it is laid out, and how the main parts fit together.' },
		{ title: 'Find out why a test fails', text: 'Runs the tests, reads the failure, proposes a fix.', tag: 'Runs commands', mode: 'agent', prompt: 'Run the tests of this project. If one fails, find out why and propose a fix.' },
		{ title: 'Write tests for a file', text: 'Choose the file; it writes tests and runs them.', tag: 'Edits files', mode: 'agent', prompt: 'Write tests for the file I have open, and run them. If no file is open, ask me which one.' },
		{ title: 'Add a rules file for this project', text: 'Writes AGENTS.md so every later task starts with what matters here.', tag: 'Edits files', mode: 'agent', prompt: 'Write an AGENTS.md for this project: how to build and test it, its conventions, and what to avoid.' },
	]

	return <div className='r' style={{ height: '100%', alignItems: 'stretch' }}>
		{/* the title strip: the app has no menu here yet, so only its name */}
		<div className='c' style={{ width: 760, flex: 'none', padding: '0 0 0 120px', minHeight: 0 }}>
			<div className='r' style={{ height: 38, flex: 'none' }} />
			<div className='r' style={{ height: 76, flex: 'none', alignItems: 'flex-end', paddingBottom: 14 }}><Stepper step={step} /></div>

			{step === 1 ? <div className='c fl scroll' style={{ gap: 6, paddingRight: 120, minHeight: 0 }} data-testid='vader-onboarding-step1'>
				<span className='ttl' style={{ fontSize: 28, marginTop: 20 }}>Welcome to Vader</span>
				<span className='t2' style={{ lineHeight: 1.6, maxWidth: 440, marginTop: 6 }}>Vader works in your projects and asks before anything risky. First choose where its models come from. You can change this later in Settings.</span>

				<div className='c' style={{ marginTop: 22, borderTop: '1px solid var(--ln)' }}>
					{/* a model with a key */}
					<div className='c' style={{ padding: '14px 0', borderBottom: '1px solid var(--ln)', gap: 10 }}>
						<button className='r' style={{ gap: 12, alignItems: 'flex-start', width: '100%' }} data-testid='vader-onboarding-choice-key' onClick={() => setChoice('key')}>
							<span style={{ paddingTop: 3 }}><Radio on={choice === 'key'} /></span>
							<span className='c fl' style={{ gap: 2 }}><span className='t1' style={{ fontWeight: 600 }}>A model with my own key</span><span className='t3'>{providerNames.length} providers. Paste a key and the live list of models appears.</span></span>
						</button>
						{choice === 'key' ? <div className='c' style={{ gap: 12, paddingLeft: 28 }}>
							<div className='r' style={{ gap: 12, alignItems: 'flex-end' }}>
								<label className='c' style={{ gap: 5, width: 170 }}><span className='hint'>Provider</span>
									<span className='fld r' style={{ gap: 8 }}><ProviderLogo providerName={provider} size={14} />
										<select data-testid='vader-onboarding-provider' className='fl' style={{ background: 'transparent', color: 'var(--t1)', border: 0, outline: 0 }} value={provider} onChange={e => { setProvider(e.target.value as CloudListedProviderName); setAsked(false) }}>
											{providersInOrder().map(p => <option key={p} value={p} style={{ background: '#19191c' }}>{displayInfoOfProviderName(p).title}</option>)}
										</select></span></label>
								<label className='c fl' style={{ gap: 5 }}><span className='hint'>API key</span>
									<input data-testid='vader-onboarding-key' className='fld mo' style={failed ? { borderColor: '#f06a6e' } : undefined} placeholder='sk-or-...' value={key} onChange={e => { setKey(e.target.value); setAsked(false) }} onKeyDown={e => { if (e.key === 'Enter') test() }} autoComplete='off' spellCheck={false} /></label>
							</div>
							{!asked ? <div className='r' style={{ gap: 12 }}><button className='pb' data-testid='vader-onboarding-test' disabled={!key.trim()} onClick={test}>Test and continue</button><span className='hint'>The key is only sent to {who}, to ask for its list of models.</span></div> : null}
							{testing ? <div className='c' style={{ gap: 8 }} data-testid='vader-onboarding-testing'><span className='r' style={{ gap: 8 }}><span className='spin' style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--ln2)', borderTopColor: '#6ea0ff', borderRadius: '50%' }} /><span className='t2'>Asking {who} for its models</span></span><span><button className='pb' disabled>Testing...</button></span></div> : null}
							{works && list?.status === 'ok' ? <div className='r' style={{ gap: 12 }} data-testid='vader-onboarding-works'><span className='r' style={{ gap: 8, color: '#4cc38a' }}><span>{'✓'}</span>Works. {list.count} model{list.count === 1 ? '' : 's'} found</span><button className='pb' data-testid='vader-onboarding-key-continue' onClick={continueFromKey}>Continue</button><span className='hint'>Pick a model next</span></div> : null}
							{failed ? <div className='c' style={{ gap: 6 }} role='alert' data-testid='vader-onboarding-failed' data-reason={failed.reason}>
								<span className='r' style={{ gap: 8, color: 'var(--wa)' }}>{'△'}<span>{failed.reason === 'unauthorized' ? `${who} answered 401` : failed.reason === 'rate-limited' ? `${who} limits this key for now` : failed.reason === 'network' ? `Could not reach ${who}` : failed.reason === 'unsupported' ? `${who} does not list its models` : `${who} did not answer as expected`}</span></span>
								<span className='t2' style={{ lineHeight: 1.55 }}>{failed.reason === 'unauthorized' ? 'The key may have a space at the end, or may have been revoked. Paste it again.' : failed.reason === 'network' ? 'Nothing was sent. Check your connection or proxy, or choose a model on this computer instead.' : failed.message}</span>
								<span className='r' style={{ gap: 8 }}><button className='pb' data-testid='vader-onboarding-test-again' onClick={test}>{failed.reason === 'network' ? 'Try again' : 'Test again'}</button>{failed.reason === 'network' ? <><button className='gb' onClick={() => setChoice('local')}>Use a local model</button><button className='tx' onClick={() => { void commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID) }}>Network settings</button></> : null}</span>
							</div> : null}
						</div> : null}
					</div>

					{/* a connected agent */}
					<div className='c' style={{ padding: '14px 0', borderBottom: '1px solid var(--ln)', gap: 10 }}>
						<button className='r' style={{ gap: 12, alignItems: 'flex-start', width: '100%' }} data-testid='vader-onboarding-choice-agent' onClick={() => setChoice('agent')}>
							<span style={{ paddingTop: 3 }}><Radio on={choice === 'agent'} /></span>
							<span className='c fl' style={{ gap: 2 }}><span className='t1' style={{ fontWeight: 600 }}>A connected agent I already pay for</span><span className='t3'>Codex, Copilot, Cursor and others, inside Vader&apos;s chat.</span></span>
						</button>
						{choice === 'agent' ? <div className='c' style={{ gap: 8, paddingLeft: 28 }} data-testid='vader-onboarding-agent-panel'>
							{readyAgents.length > 0 ? <>
								<span className='t2'>Found on this computer, signed in:</span>
								{readyAgents.map(id => <span key={id} className='r' style={{ gap: 10 }}><span className='t1 fl'>{id}</span><button className='gb' onClick={() => { settings.setGlobalSetting('externalAgentId', id); setStep(2) }}>Use it</button></span>)}
							</> : <span className='t2' style={{ lineHeight: 1.55 }}>None is installed here yet. Install one from Add-ons, Agents, or in Settings, Connected agents, then come back.</span>}
							<span><button className='tx' style={{ padding: 0 }} onClick={() => { void commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID) }}>Open Settings, Connected agents</button></span>
						</div> : null}
					</div>

					{/* a model on this computer */}
					<div className='c' style={{ padding: '14px 0', borderBottom: '1px solid var(--ln)', gap: 10 }}>
						<button className='r' style={{ gap: 12, alignItems: 'flex-start', width: '100%' }} data-testid='vader-onboarding-choice-local' onClick={() => setChoice('local')}>
							<span style={{ paddingTop: 3 }}><Radio on={choice === 'local'} /></span>
							<span className='c fl' style={{ gap: 2 }}><span className='t1' style={{ fontWeight: 600 }}>A model on this computer</span><span className='t3'>{found ? `${found.name} is running with ${found.models.length} model${found.models.length === 1 ? '' : 's'}. Nothing leaves your machine.` : 'Ollama or LM Studio. Nothing leaves your machine.'}</span></span>
						</button>
						{choice === 'local' ? (found ? <div className='c' style={{ gap: 8, paddingLeft: 28 }} data-testid='vader-onboarding-local-found'>
							<span className='t2'>Found at localhost:{found.port} with {found.models.length} model{found.models.length === 1 ? '' : 's'}.</span>
							{found.models.slice(0, 4).map(m => <span key={m.modelName} className='mo t1' style={{ lineHeight: '24px' }}>{m.modelName}</span>)}
							<span><button className='pb' data-testid='vader-onboarding-local-use' onClick={() => { useProviderModel(found.p); setStep(2) }}>Use {found.models[0].modelName}</button></span>
						</div> : <div className='c' style={{ gap: 8, paddingLeft: 28 }} data-testid='vader-onboarding-local-none'>
							{looking ? <span className='t2'>Looking for Ollama and LM Studio...</span> : <>
								<span className='t1' style={{ fontWeight: 600 }}>No local model found</span>
								<span className='t2' style={{ lineHeight: 1.55 }}>Looked for Ollama on 11434 and LM Studio on 1234. Start one of them, then look again. Nothing leaves your machine either way.</span>
								<span className='r' style={{ gap: 8 }}><button className='pb' data-testid='vader-onboarding-local-again' onClick={lookAgain}>Look again</button><button className='gb' onClick={() => { void opener.open(URI.parse('https://ollama.com/download')) }}>Open Ollama&apos;s site</button></span></>}
						</div>) : null}
					</div>
				</div>
				<span className='fl' />
				<div className='r' style={{ height: 70, flex: 'none', justifyContent: 'flex-end', paddingBottom: 6 }}>
					<button className='tx' data-testid='vader-welcome-continue' onClick={() => setStep(2)}>Skip for now</button>
				</div>
			</div> : null}

			{step === 2 ? <div className='c fl scroll' style={{ gap: 6, paddingRight: 120, minHeight: 0 }} data-testid='vader-onboarding-step2'>
				<span className='ttl' style={{ fontSize: 28, marginTop: 20, lineHeight: 1.25 }}>Open a project, and choose how much Vader asks</span>
				<span className='hint' style={{ marginTop: 22 }}>Project</span>
				<div className='r' style={{ gap: 12, padding: '10px 0', borderTop: '1px solid var(--ln)', borderBottom: '1px solid var(--ln)' }} data-testid='vader-onboarding-project'>
					<span className='t3'>{'□'}</span>
					<div className='c fl' style={{ minWidth: 0 }}>{folder ? <><span className='t1' style={{ fontWeight: 600 }}>{folder.name}</span><span className='mo t3 tr' style={{ fontSize: 12 }}>{folder.uri.fsPath}</span></> : <span className='t2'>No folder is open</span>}</div>
					<button className='gb' data-testid='vader-onboarding-change-folder' onClick={() => { void commands.executeCommand('workbench.action.files.openFolder') }}>{folder ? 'Change' : 'Open a folder'}</button>
				</div>
				<span className='t3' style={{ lineHeight: 1.5, padding: '8px 0 6px' }}>{folder ? 'Vader reads and edits the files of this folder and shows every change for you to accept or reject.' : 'Without a folder this is a plain conversation. Open a folder to let the agent work in a project.'}</span>
				<span className='hint' style={{ marginTop: 14 }}>How much should Vader ask before it acts?</span>
				<div className='c' style={{ gap: 8 }} data-testid='vader-onboarding-safety'>
					{([['safe', 'Safe', 'Asks before every change and every command.'], ['balanced', 'Balanced', 'Edits go through. Commands and sensitive files ask.'], ['autonomous', 'Autonomous', 'Runs without asking, except what is locked.']] as const).map(([mode, title, text]) =>
						<button key={mode} className='r' data-testid={`vader-onboarding-mode-${mode}`} aria-pressed={policyState.mode === mode} style={{ gap: 12, padding: '12px 14px', border: '1px solid ' + (policyState.mode === mode ? 'var(--ln2)' : 'var(--ln)'), borderRadius: 10, background: policyState.mode === mode ? 'var(--g2)' : 'transparent', alignItems: 'flex-start', width: '100%' }} onClick={() => policy.setMode(mode)}>
							<span style={{ paddingTop: 2 }}><Radio on={policyState.mode === mode} /></span>
							<span className='c fl' style={{ gap: 2 }}><span className='t1' style={{ fontWeight: 600 }}>{title}</span><span className='t2'>{text}</span></span>
							{mode === 'balanced' ? <span className='hint'>Recommended</span> : null}
						</button>)}
				</div>
				<span className='t3' style={{ lineHeight: 1.5, padding: '8px 0' }}>Some rules are locked in every mode: never touching your keys or system files, and always asking before installing anything. You can change all of this in Settings.</span>
				{showImport ? <div className='c' style={{ gap: 10, padding: '6px 0' }} data-testid='vader-import-editors'><span className='t2'>Bring your theme, keybindings and extensions over. Nothing is changed in the original editor.</span><div className='r' style={{ gap: 8, flexWrap: 'wrap' }}>{transferEditorTypes.map(editor => <OneClickSwitchButton key={editor} fromEditor={editor} className='px-3 py-1.5' />)}</div></div> : null}
				<span className='fl' />
				<div className='r' style={{ height: 70, flex: 'none', gap: 10, paddingBottom: 6 }}>
					<button className='tx' data-testid='vader-import-toggle' style={{ padding: 0 }} onClick={() => setShowImport(v => !v)}>Import settings from VS Code or Cursor</button>
					<span className='fl' />
					<button className='gb' data-testid='vader-onboarding-back' onClick={() => setStep(1)}>Back</button>
					<button className='pb' data-testid='vader-onboarding-continue' onClick={() => setStep(3)}>Continue</button>
				</div>
			</div> : null}

			{step === 3 ? <div className='c fl scroll' style={{ gap: 6, paddingRight: 120, minHeight: 0 }} data-testid='vader-onboarding-step3'>
				<span className='ttl' style={{ fontSize: 28, marginTop: 20 }}>Try a first task</span>
				<span className='t2' style={{ lineHeight: 1.6, maxWidth: 440, marginTop: 6 }}>Pick one, or write your own. You will see the plan, every step, and the changes before anything is kept.</span>
				{noModel ? <div className='c' style={{ gap: 6, padding: '12px 14px', border: '1px solid var(--ln2)', borderRadius: 10, background: 'var(--g2)', marginTop: 12 }} role='alert' data-testid='vader-onboarding-no-model'>
					<span className='t1' style={{ fontWeight: 600 }}>Choose a model first</span><span className='t2'>No provider has a key yet, so there is no model to ask.</span>
					<span className='r' style={{ gap: 8 }}><button className='pb' onClick={() => { setNoModel(false); setStep(1) }}>Add a key</button><button className='gb' onClick={() => { setNoModel(false); setChoice('local'); setStep(1) }}>Use a local model</button></span>
				</div> : null}
				<div className='c' style={{ marginTop: 18, borderTop: '1px solid var(--ln)' }}>
					{TASKS.map(t => <button key={t.title} className='r' data-testid='vader-onboarding-task' style={{ gap: 12, padding: '14px 0', borderBottom: '1px solid var(--ln)', width: '100%', alignItems: 'flex-start' }} onClick={() => startTask(t.prompt, t.mode)}>
						<span className='c fl' style={{ gap: 3 }}><span className='t1' style={{ fontWeight: 600 }}>{t.title}</span><span className='t2'>{t.text}</span></span><span className='hint' style={{ paddingTop: 2 }}>{t.tag}</span>
					</button>)}
				</div>
				<div className='c' style={{ marginTop: 22, padding: '12px 14px', gap: 10, border: '1px solid var(--ln2)', borderRadius: 12 }}>
					<textarea data-testid='vader-onboarding-own-task' className='t1' style={{ minHeight: 44, resize: 'none', lineHeight: 1.5 }} placeholder='Or describe your own task' value={task} onChange={e => setTask(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && task.trim()) { e.preventDefault(); startTask(task.trim(), 'agent') } }} />
					<span className='r' style={{ justifyContent: 'flex-end' }}><button className='pb' data-testid='vader-onboarding-own-send' disabled={!task.trim()} onClick={() => startTask(task.trim(), 'agent')}>Send</button></span>
				</div>
				<span className='fl' />
				<div className='r' style={{ height: 70, flex: 'none', gap: 10, paddingBottom: 6 }}>
					<button className='tx' data-testid='vader-import-done' style={{ padding: 0 }} onClick={finish}>Skip, open Vader</button>
					<span className='fl' />
					<button className='gb' onClick={() => setStep(2)}>Back</button>
				</div>
			</div> : null}
		</div>

		{/* what each step means */}
		<div className='r fl' style={{ background: 'var(--g1)', borderLeft: '1px solid var(--ln)', justifyContent: 'center', padding: '0 60px', minWidth: 0 }}>
			{step === 1 ? <Side title='Before you choose' rows={[['Your key stays on this computer', 'Stored encrypted. It is only sent to the provider you choose.'], ['Your code goes to one place', 'The model you pick, and nowhere else. No analytics, no account.'], ['You decide what it may do', 'The next step sets how much it asks first. Some actions are never allowed.']]} thenTitle='Then' then={[['Open a project', 'And choose how much Vader asks before it acts.'], ['Try a first task', 'A small one, so you see what it asks and shows. You can skip it.']]} />
				: step === 2 ? <Side title='What Balanced looks like' rows={[['Edits go through, and you review them afterwards', 'Each changed file has Accept and Reject.'], ['Commands ask first', 'Allow once, allow in this project, or reject. The whole command is shown.'], ['Credentials are never touched', 'Reading ~/.ssh/id_rsa is never allowed, in any mode.']]} />
					: <Side title='What happens after you send it' rows={[['It works, and you can watch', 'Each step shows as a quiet line: what it read, searched, edited, ran.'], ['It asks when it needs you', 'The chat is marked "Needs you" in the list, even when you are in another one.'], ['You review the changes', 'Accept a file, a part of a file, or all of it. Undo goes back to a checkpoint.']]} />}
		</div>
	</div>
}
