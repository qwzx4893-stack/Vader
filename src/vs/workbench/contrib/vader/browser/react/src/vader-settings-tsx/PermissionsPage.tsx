/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react'
import { useAccessor, usePolicyServiceState, useSettingsState } from '../util/services.js'
import { formatCost, formatUsd } from '../../../../common/usageAccounting.js'
import { toolApprovalTypes, ToolApprovalType } from '../../../../common/toolsServiceTypes.js'
import { PolicyRequestKind, UserPolicyRuleInput } from '../../../../common/policy/policyService.js'
import { validateUserPattern } from '../../../../common/helpers/safeRegex.js'
import { parseMoney } from '../../../../common/settingsInput.js'
import { Group, LockMark, Line, NumberBox, PageHead, Switch, Note } from './ui.js'

// Permissions (board R08): how much the agent may do on its own, the commands allowed in this project, what is allowed without asking by kind, the daily limit,
// and the rules that always apply. All of it is the real policy engine and settings, nothing here is a copy.

const MODES = [
	['safe', 'Safe', 'Asks before every change and every command.'],
	['balanced', 'Balanced', 'Edits go through. Commands and sensitive files ask.'],
	['autonomous', 'Autonomous', 'Runs without asking, except what is locked.'],
] as const

const KIND_ROWS: { type: ToolApprovalType, title: string, detail?: string }[] = [
	{ type: 'edits', title: 'Edit files', detail: 'edits are shown to you either way' },
	{ type: 'terminal', title: 'Run commands', detail: 'except the ones that always ask' },
	{ type: 'MCP tools', title: 'Use MCP tools' },
]

const KINDS: PolicyRequestKind[] = ['file-write', 'file-delete', 'terminal-command', 'mcp-tool']

/** the first sentence of a rule, without the "Blocked:" lead, as one line */
const shortRule = (d: string) => { const s = d.replace(/^Blocked:\s*/, '').split(/(?<=\.)\s/)[0].replace(/\.$/, ''); return s.charAt(0).toUpperCase() + s.slice(1) }

export const PermissionsPage = ({ goto }: { goto: (page: 'usage') => void }) => {
	const accessor = useAccessor()
	const policy = accessor.get('IPolicyService')
	const chat = accessor.get('IChatThreadService')
	const settings = accessor.get('IVaderSettingsService')
	const policyState = usePolicyServiceState()
	const state = useSettingsState()
	const g = state.globalSettings
	const [, tick] = useState(0)
	useEffect(() => {
		const a = chat.onDidChangeUsage(() => tick(n => n + 1))
		const b = chat.onDidChangeProjectApprovals(() => tick(n => n + 1))
		return () => { a.dispose(); b.dispose() }
	}, [chat])

	const projectKey = chat.getCurrentProjectKey()
	const approvals = chat.listProjectApprovals(projectKey)
	const projectName = projectKey ? projectKey.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : undefined
	const today = chat.getUsageToday()
	const limit = g.dailySpendLimitUsd

	const rules = policy.getAllRules()
	const locked = rules.filter(r => r.builtIn && r.locked)
	const asking = rules.filter(r => r.builtIn && !r.locked)
	const custom = rules.filter(r => !r.builtIn)
	const [showAll, setShowAll] = useState(false)

	// a rule of the person's own
	const [adding, setAdding] = useState(false)
	const [kind, setKind] = useState<PolicyRequestKind>('terminal-command')
	const [effect, setEffect] = useState<'deny' | 'ask'>('ask')
	const [what, setWhat] = useState('')
	const [pattern, setPattern] = useState('')
	const [problem, setProblem] = useState('')
	const create = () => {
		const patterns = pattern.split(',').map(s => s.trim()).filter(Boolean)
		if (!what.trim()) { setProblem('Say what the rule is for, so the question it asks makes sense.'); return }
		if (patterns.length === 0 && kind !== 'mcp-tool') { setProblem(kind === 'terminal-command' ? 'Write the command, or part of it, that the rule is about.' : 'Write the path or pattern that the rule is about.'); return }
		const regexKind = kind === 'terminal-command' || kind === 'mcp-tool'
		// regex rules run against every command: refuse patterns that are invalid or could hang the window (see policyService.ts)
		const bad = regexKind ? patterns.map(p => { try { new RegExp(p, 'i') } catch { return `"${p}" is not a valid regular expression.` } return validateUserPattern(p) }).find(Boolean) : undefined
		if (bad) { setProblem(bad); return }
		const input: UserPolicyRuleInput = { description: what.trim(), effect, kinds: [kind], pathGlobs: kind === 'file-write' || kind === 'file-delete' ? patterns : undefined, commandPatterns: kind === 'terminal-command' ? patterns : undefined, serverNamePatterns: kind === 'mcp-tool' ? patterns : undefined }
		policy.addCustomRule(input)
		setWhat(''); setPattern(''); setProblem(''); setAdding(false)
	}

	return <div data-testid='vader-settings-permissions'>
		<PageHead title='Permissions' desc='Decide what the agent may do on its own. Some rules are locked and apply in every mode.' />

		<Group title='Mode' first>
			<div className='c' style={{ gap: 10 }} role='radiogroup' data-testid='vader-perm-mode'>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
					{MODES.map(([mode, title, text]) => <button key={mode} role='radio' aria-checked={policyState.mode === mode} data-testid={`vader-perm-mode-${mode}`} className={policyState.mode === mode ? 'card on' : 'card'} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6, padding: '14px 16px', textAlign: 'left' }} onClick={() => policy.setMode(mode)}>
						<span className='t1' style={{ fontWeight: 600 }}>{title}</span><span className='t2' style={{ lineHeight: 1.5 }}>{text}</span>
					</button>)}
				</div>
			</div>
		</Group>

		<Group title='Allowed in this project' note={projectName ? undefined : undefined}>
			{!projectKey ? <span className='t3' style={{ padding: '4px 2px' }}>Open a folder to keep approvals for it.</span>
				: approvals.length === 0 ? <span className='t3' style={{ padding: '4px 2px', lineHeight: 1.55, maxWidth: 560 }}>Nothing yet. When the agent asks to run a command, &quot;Allow in this project&quot; remembers that exact command here, and &quot;Allow this host here&quot; remembers a site. Rules that always ask (keys, installs, sudo) are never skipped.</span>
					: approvals.map((a, i) => <Line key={a.key} first={i === 0} testId='vader-perm-approval' title={<span className='mo'>{a.label}</span>} detail={`${a.kind === 'mcp' ? 'MCP tool' : a.kind === 'host' ? 'Site' : 'Command'}, allowed ${new Date(a.addedAt).toLocaleDateString()}`}
						right={<><span className='hint'>{projectName}</span><button className='tx' data-testid='vader-perm-revoke' onClick={() => chat.revokeProjectApproval(projectKey, a.key)}>Revoke</button></>} />)}
		</Group>

		<Group title='Allow without asking, by kind' note='on top of the mode'>
			{KIND_ROWS.filter(r => toolApprovalTypes.has(r.type)).map((r, i) => <Line key={r.type} first={i === 0} title={r.title} right={<>{r.detail ? <span className='hint'>{r.detail}</span> : null}<Switch on={g.autoApprove[r.type] ?? false} label={`Allow without asking: ${r.title}`} testId={`vader-perm-kind-${r.type.replace(/\s+/g, '-')}`} onChange={v => settings.setGlobalSetting('autoApprove', { ...settings.state.globalSettings.autoApprove, [r.type]: v })} />
			</>} />)}
			<Line title='Accept the agent&rsquo;s changes as they are made' right={<><span className='hint'>no Accept button per file</span><Switch on={g.autoAcceptLLMChanges} label='Accept the agent&rsquo;s changes as they are made' testId='vader-perm-autoaccept' onChange={v => settings.setGlobalSetting('autoAcceptLLMChanges', v)} /></>} />
			<Line title='Fix the lint errors it causes' right={<Switch on={g.includeToolLintErrors} label='Fix the lint errors it causes' testId='vader-perm-lint' onChange={v => settings.setGlobalSetting('includeToolLintErrors', v)} />} />
		</Group>

		<Group title='Spending'>
			<Line first title='Today' detail={<>An estimate from list prices. <button className='tx' style={{ height: 'auto', padding: 0, color: 'var(--ac)' }} data-testid='vader-perm-to-usage' onClick={() => goto('usage')}>Usage and cost</button></>}
				right={<span className='t1' data-testid='vader-perm-today' style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCost(today.costUsd, today.billedCostUsd)}{today.unpricedTurns > 0 ? ' +' : ''}</span>} />
			<Line title='Daily limit' detail='at the estimate a running task pauses and asks before it goes on'
			right={<NumberBox testId='vader-perm-limit' label='Daily limit in dollars' prefix='$' placeholder='none' initial={limit === null ? '' : String(limit)} parse={t => parseMoney(t, { allowEmpty: true })} onCommit={v => settings.setGlobalSetting('dailySpendLimitUsd', v)} saved={v => v === null ? 'No daily limit' : `Daily limit set to ${formatUsd(v)}`} />} />
		</Group>

		<Group title='Locked rules' note='cannot be turned off in any mode'>
			{(showAll ? locked : locked.slice(0, 5)).map((r, i) => <Line key={r.id} first={i === 0} testId='vader-perm-locked' title={<span className='r' style={{ gap: 10 }}><LockMark />{shortRule(r.description)}</span>} right={<span className='hint'>{r.effect}</span>} />)}
			<div className='r' style={{ paddingTop: 10 }}>
				{locked.length > 5 ? <button className='tx' style={{ padding: 0 }} data-testid='vader-perm-show-locked' onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${locked.length} locked rules`}</button> : null}
				<span className='fl' />
				<button className='tx' data-testid='vader-perm-add-rule' onClick={() => setAdding(v => !v)}>+ Add my own rule</button>
			</div>
		</Group>

		<Group title='Rules that ask' note='you can turn each one off'>
			{asking.map((r, i) => <Line key={r.id} first={i === 0} testId='vader-perm-asking' title={shortRule(r.description)} right={<Switch on={r.enabled} label={shortRule(r.description)} testId={`vader-perm-rule-${r.id}`} onChange={v => policy.setRuleEnabled(r.id, v)} />} />)}
		</Group>

		<Group title='My own rules'>
			{custom.length === 0 && !adding ? <span className='t3' style={{ padding: '4px 2px', lineHeight: 1.55, maxWidth: 560 }}>None. A rule of your own can ask or refuse before any matching command, file change or MCP tool, whatever the mode.</span> : null}
			{custom.map((r, i) => <Line key={r.id} first={i === 0} testId='vader-perm-custom' title={r.description} detail={`${r.effect === 'deny' ? 'Refuses' : 'Asks'} for ${r.kinds.join(', ')}`} right={<button className='tx' onClick={() => policy.removeCustomRule(r.id)}>Remove</button>} />)}
			{adding ? <div className='c' style={{ gap: 12, padding: '14px 0', borderTop: '1px solid var(--ln)' }} data-testid='vader-perm-new-rule'>
				<div className='r' style={{ gap: 12 }}>
					<label className='c' style={{ gap: 5, width: 170 }}><span className='hint'>It applies to</span><select className='fld' data-testid='vader-perm-new-kind' value={kind} onChange={e => setKind(e.target.value as PolicyRequestKind)} style={{ background: 'transparent', color: 'var(--t1)' }}>{KINDS.map(k => <option key={k} value={k} style={{ background: '#19191c' }}>{k === 'file-write' ? 'Changing a file' : k === 'file-delete' ? 'Deleting a file' : k === 'terminal-command' ? 'A command' : 'An MCP tool'}</option>)}</select></label>
					<label className='c' style={{ gap: 5, width: 130 }}><span className='hint'>Then</span><select className='fld' data-testid='vader-perm-new-effect' value={effect} onChange={e => setEffect(e.target.value as 'deny' | 'ask')} style={{ background: 'transparent', color: 'var(--t1)' }}><option value='ask' style={{ background: '#19191c' }}>Ask me</option><option value='deny' style={{ background: '#19191c' }}>Refuse</option></select></label>
					<label className='c fl' style={{ gap: 5 }}><span className='hint'>{kind === 'terminal-command' ? 'Command pattern, comma-separated' : kind === 'mcp-tool' ? 'Server name pattern, empty means every server' : 'Path pattern, comma-separated'}</span><input className='fld mo' data-testid='vader-perm-new-pattern' placeholder={kind === 'terminal-command' ? 'rm -rf' : kind === 'mcp-tool' ? '' : '**/.env*'} value={pattern} onChange={e => setPattern(e.target.value)} /></label>
				</div>
				<label className='c' style={{ gap: 5 }}><span className='hint'>What it is for</span><input className='fld' data-testid='vader-perm-new-what' placeholder='Shown when the rule fires' value={what} onChange={e => setWhat(e.target.value)} /></label>
				{problem ? <Note kind='warn' testId='vader-perm-new-problem'>{problem}</Note> : null}
				<div className='r' style={{ gap: 8 }}><button className='pb' data-testid='vader-perm-new-create' onClick={create}>Add rule</button><button className='tx' onClick={() => { setAdding(false); setProblem('') }}>Cancel</button></div>
			</div> : null}
		</Group>
	</div>
}
