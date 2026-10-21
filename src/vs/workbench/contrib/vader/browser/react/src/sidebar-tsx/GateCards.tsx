/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { useAccessor, usePolicyServiceState } from '../util/services.js'
import { VADER_OPEN_SETTINGS_ACTION_ID } from '../../../actionIDs.js'
import { SecretHit } from '../../../../common/secretScan.js'
import { GateAction, GateInfo, gateSpecOfBlock, gateSpecOfRequest, GateSpec, MODE_WORD } from '../../../../common/gateModel.js'

// The safety gate as the chat shows it (boards S02 and R07): when it asks, one card says what is asked, where, why and what can be chosen; when it refuses, one card
// says what did not run and why. The words come from common/gateModel.ts, made from what the gate really decided (the rule, the scope, the mode), never from a guess.
// The class names are written out in each className on purpose: the build that scopes Tailwind to Vader's UI prefixes only the names it finds written there.

const Triangle = ({ color }: { color: string }) => <svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' className='shrink-0'><path d='M7.5 2.2 13.3 12.6H1.7z' fill='none' stroke={color} strokeWidth='1.3' strokeLinejoin='round' /></svg>
const Lock = ({ color }: { color: string }) => <svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' className='shrink-0'><rect x='3' y='6.5' width='9' height='6.3' rx='1.4' fill='none' stroke={color} strokeWidth='1.3' /><path d='M5 6.5V4.8a2.5 2.5 0 0 1 5 0v1.7' fill='none' stroke={color} strokeWidth='1.3' /></svg>
const NoEntry = ({ color }: { color: string }) => <svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' className='shrink-0'><circle cx='7.5' cy='7.5' r='5.4' fill='none' stroke={color} strokeWidth='1.3' /><path d='M3.7 11.3 11.3 3.7' stroke={color} strokeWidth='1.3' /></svg>
const Eye = ({ color }: { color: string }) => <svg width='14' height='14' viewBox='0 0 15 15' aria-hidden='true' className='shrink-0'><circle cx='6.6' cy='6.6' r='3.8' fill='none' stroke={color} strokeWidth='1.3' /><path d='m9.5 9.5 3.3 3.3' stroke={color} strokeWidth='1.3' strokeLinecap='round' /></svg>

const useGateContext = () => {
	const accessor = useAccessor()
	const chat = accessor.get('IChatThreadService')
	const gateway = accessor.get('IAgentGatewayService')
	const commands = accessor.get('ICommandService')
	const settings = accessor.get('IVaderSettingsService')
	const policy = usePolicyServiceState()
	const threadId = chat.state.currentThreadId
	const projectKey = chat.getCurrentProjectKey()
	const projectName = projectKey ? projectKey.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : undefined
	return { chat, gateway, commands, settings, policy, threadId, projectName }
}

const Code = ({ children, testId }: { children: React.ReactNode, testId?: string }) =>
	<pre data-testid={testId} className='m-0 px-3 py-2 rounded-lg bg-vader-bg-3 border border-vader-border-1 font-mono text-sm text-vader-fg-1 whitespace-pre-wrap break-all select-text max-h-40 overflow-auto'>{children}</pre>

const Words = ({ spec }: { spec: GateSpec }) => <>
	{spec.text ? <div className='text-vader-fg-2 leading-relaxed' data-testid='vader-gate-text'>{spec.text}</div> : null}
	{spec.code ? <Code testId='vader-gate-code'>{spec.code}</Code> : null}
	{spec.note ? <div className='text-vader-fg-3 text-sm leading-relaxed' data-testid='vader-gate-note'>{spec.note}</div> : null}
</>

const Btn = ({ kind, testId, onClick, children, title }: { kind: 'primary' | 'secondary' | 'quiet', testId: string, onClick: () => void, children: React.ReactNode, title?: string }) =>
	kind === 'primary' ? <button data-testid={testId} title={title} onClick={onClick} className='px-3 py-1 rounded-md bg-vader-fg-0 text-vader-bg-3 hover:opacity-90 text-sm font-medium transition-opacity duration-150'>{children}</button>
		: kind === 'secondary' ? <button data-testid={testId} title={title} onClick={onClick} className='px-3 py-1 rounded-md text-sm border border-vader-border-2 text-vader-fg-1 hover:bg-vader-bg-2-hover transition-colors duration-150'>{children}</button>
			: <button data-testid={testId} title={title} onClick={onClick} className='px-2 py-1 text-vader-fg-2 hover:text-vader-fg-1 text-sm transition-colors duration-150'>{children}</button>

/** a request for the person's say, as one card: what is asked, in which mode, the thing itself, and the choices the gate offers */
export const GateCard = ({ toolName, params, mcpServerName, gate, isCheckpointGhost, children, extra }: {
	toolName: string, params: unknown, mcpServerName: string | undefined, gate: GateInfo | undefined, isCheckpointGhost: boolean,
	/** the tool's own view of what it does (the diff of an edit), shown when the card has nothing more exact to say */
	children?: React.ReactNode, extra?: React.ReactNode,
}) => {
	const { chat, gateway, commands, policy, threadId, projectName } = useGateContext()
	const [reading, setReading] = useState(false)
	const canRemember = chat.canRememberForProject(threadId)
	const spec = gateSpecOfRequest({ toolName, params, mcpServerName, gate, mode: policy.mode, projectName, canRemember })
	const everyMode = spec.kind === 'rule' || spec.kind === 'skill' || spec.kind === 'extension'
	const approve = (rememberForProject?: boolean) => { try { gateway.approveToolRequest(threadId, rememberForProject ? { rememberForProject: true } : undefined) } catch (e) { console.error('Error while approving in chat:', e) } }
	const reject = () => { try { gateway.rejectToolRequest(threadId) } catch (e) { console.error('Error while rejecting in chat:', e) } }
	const instructions = (params as { instructions?: unknown } | null)?.instructions
	const act = (a: GateAction): React.ReactNode => {
		switch (a) {
			case 'allow-once': return <Btn key={a} kind='primary' testId='vader-tool-approve' onClick={() => approve()}>Allow once</Btn>
			case 'install-off': return <Btn key={a} kind='primary' testId='vader-tool-approve' onClick={() => approve()}>Install, switched off</Btn>
			case 'allow-project': return <Btn key={a} kind='secondary' testId='vader-tool-approve-project' title='Allow this, and do not ask about this exact one in this project again' onClick={() => approve(true)}>Allow in this project</Btn>
			case 'allow-host': return <Btn key={a} kind='secondary' testId='vader-tool-approve-host' title='Allow this, and let the agent open pages on this site in this project without asking' onClick={() => approve(true)}>Allow this host here</Btn>
			case 'read-first': return typeof instructions === 'string' ? <Btn key={a} kind='secondary' testId='vader-gate-read' onClick={() => setReading(r => !r)}>{reading ? 'Hide it' : 'Read it first'}</Btn> : null
			case 'change-rule': return <Btn key={a} kind='quiet' testId='vader-gate-change-rule' onClick={() => { void commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID, 'permissions') }}>Change the rule</Btn>
			case 'reject': return <Btn key={a} kind='quiet' testId='vader-tool-reject' onClick={reject}>Reject</Btn>
			default: return null
		}
	}
	const showTool = (spec.kind === 'edit' || spec.kind === 'generic') && children
	return <div data-testid='vader-gate' data-kind={spec.kind} role='group' aria-label={spec.title} className={`motion-safe:animate-card-in rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2.5 ${isCheckpointGhost ? 'opacity-50 pointer-events-none' : ''}`}>
		<div className='flex items-center gap-2'>
			<Triangle color='#e2a93f' />
			<span className='font-semibold text-vader-fg-1' data-testid='vader-gate-title'>{spec.title}</span>
			<span className='flex-1' />
			<span className='text-vader-fg-3 text-xs' data-testid='vader-gate-mode'>{everyMode ? 'Asks in every mode' : `Asks in ${MODE_WORD[policy.mode] ?? policy.mode} mode`}</span>
		</div>
		{spec.skill ? <div className='flex items-baseline gap-2 flex-wrap' data-testid='vader-gate-skill'>
			<span className='font-semibold text-vader-fg-1'>{spec.skill.name}</span>
			<span className='text-vader-fg-3 text-sm'>{[spec.skill.source, spec.skill.sizeKb ? `${spec.skill.sizeKb} KB` : null].filter(Boolean).join(', ')}</span>
		</div> : null}
		<Words spec={spec} />
		{showTool ? children : null}
		{reading && typeof instructions === 'string' ? <Code testId='vader-gate-instructions'>{instructions}</Code> : null}
		{spec.ruleId ? <div className='text-vader-fg-3 text-xs font-mono'>{spec.ruleId}</div> : null}
		<div className='flex flex-wrap gap-2 items-center'>
			{spec.actions.map(act)}
			{extra}
		</div>
	</div>
}

/** what the gate refused: nothing ran, and why (the same shape for a locked rule, an agent's own scope and a read-only mode) */
export const BlockedCard = ({ toolName, params, mcpServerName, gate, isCheckpointGhost }: {
	toolName: string, params: unknown, mcpServerName: string | undefined, gate: GateInfo, isCheckpointGhost: boolean,
}) => {
	const { commands, settings, policy, projectName } = useGateContext()
	const [hidden, setHidden] = useState(false)
	const spec = gateSpecOfBlock({ toolName, params, mcpServerName, gate, mode: policy.mode, projectName, canRemember: false })
	if (hidden) return <div className='text-vader-fg-3 text-sm px-1' data-testid='vader-gate-dismissed'>{spec.title}</div>
	const red = '#e5685f'
	const icon = spec.kind === 'agent-scope' ? <NoEntry color={red} /> : spec.kind === 'read-only' ? <Eye color='#9aa0a6' /> : gate.ruleId === 'vader.deny.credential-files' ? <Lock color={red} /> : <Triangle color={red} />
	const act = (a: GateAction): React.ReactNode => {
		switch (a) {
			case 'ok': return <Btn key={a} kind='secondary' testId='vader-blocked-ok' onClick={() => setHidden(true)}>OK</Btn>
			case 'open-rule': return <Btn key={a} kind='quiet' testId='vader-blocked-rule' onClick={() => { void commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID, 'permissions') }}>Open the rule</Btn>
			case 'open-agent-settings': return <Btn key={a} kind='secondary' testId='vader-blocked-agent' onClick={() => { void commands.executeCommand(VADER_OPEN_SETTINGS_ACTION_ID, 'saved') }}>Open agent settings</Btn>
			case 'switch-agent': return <Btn key={a} kind='secondary' testId='vader-blocked-switch' onClick={() => settings.setGlobalSetting('chatMode', 'agent')}>Switch to Agent</Btn>
			default: return null
		}
	}
	return <div data-testid='vader-blocked' data-kind={spec.kind} role='status' className={`motion-safe:animate-card-in rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2.5 ${isCheckpointGhost ? 'opacity-50' : ''}`}>
		<div className='flex items-center gap-2'>
			{icon}
			<span className='font-semibold text-vader-fg-1' data-testid='vader-blocked-title'>{spec.title}</span>
			<span className='flex-1' />
			{spec.kind === 'locked' && gate.by === 'policy' ? <span className='text-vader-fg-3 text-xs'>locked</span> : null}
		</div>
		<Words spec={spec} />
		{spec.ruleId ? <div className='text-vader-fg-3 text-xs font-mono'>{spec.ruleId}</div> : null}
		<div className='flex flex-wrap gap-2 items-center'>{spec.actions.map(act)}</div>
	</div>
}

/** a key was in the message about to be sent: it was not sent, the key was taken out of the text, and the person is told which kind and which end of it (board S02) */
export const SecretBlockedCard = ({ hits, onEdit, onDismiss }: { hits: readonly SecretHit[], onEdit: () => void, onDismiss: () => void }) => {
	const [why, setWhy] = useState(false)
	const first = hits[0]
	if (!first) return null
	const what = hits.length === 1 ? `${first.kind} (${first.masked})` : `${hits.length} keys (${hits.map(h => h.kind.replace(/^an? /, '')).join(', ')})`
	return <div data-testid='vader-secret' role='alert' className='motion-safe:animate-card-in rounded-xl border border-vader-border-2 bg-vader-bg-1 px-4 py-3 flex flex-col gap-2.5'>
		<div className='flex items-center gap-2'>
			<Triangle color='#e5685f' />
			<span className='font-semibold text-vader-fg-1' data-testid='vader-secret-title'>{hits.length === 1 ? 'Stopped: a key was about to be sent' : 'Stopped: keys were about to be sent'}</span>
		</div>
		<div className='text-vader-fg-2 leading-relaxed' data-testid='vader-secret-text'>The message contained what looks like {what}. Vader removed {hits.length === 1 ? 'it' : 'them'} and did not send it.</div>
		{why ? <div className='text-vader-fg-3 text-sm leading-relaxed' data-testid='vader-secret-why'>A key in a message goes to the model’s provider and is kept in this chat. Keys are checked before anything leaves this computer, in every mode, and cannot be sent by choice. To use a key, add it in Settings, Models, where it is stored on this computer only.</div> : null}
		<div className='flex flex-wrap gap-2 items-center'>
			<Btn kind='secondary' testId='vader-secret-edit' onClick={onEdit}>Edit the message</Btn>
			<Btn kind='secondary' testId='vader-secret-why-btn' onClick={() => setWhy(w => !w)}>{why ? 'Hide the reason' : 'Why was this blocked'}</Btn>
			<Btn kind='quiet' testId='vader-secret-dismiss' onClick={onDismiss}>Dismiss</Btn>
		</div>
	</div>
}
