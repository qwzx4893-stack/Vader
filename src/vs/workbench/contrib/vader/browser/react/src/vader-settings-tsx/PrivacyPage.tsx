/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState } from 'react'
import { URI } from '../../../../../../../base/common/uri.js'
import { VSBuffer } from '../../../../../../../base/common/buffer.js'
import { AGENT_IGNORE_FILE, AGENT_IGNORE_TEMPLATE, countIgnorePatterns } from '../../../../common/agentIgnore.js'
import { useAccessor, useCodebaseIndexState, useSettingsState } from '../util/services.js'
import { indexStatusWords } from '../../../../common/codebaseIndex/indexWords.js'
import { Group, Line, PageHead, Switch } from './ui.js'

// Privacy and network (board R20): what Vader sends over the network, and to whom. The list of who it can contact is the whole list; nothing else is contacted at
// start-up (docs/integrations/privacy.md says how that is checked).

export const REPO_URL = 'https://github.com/qwzx4893-stack/Vader'

/** the list of files the agent must never read, list, search or change (`.vaderignore` at the root of the project): whether there is one, how many lines it has, and a way to open it or start one */
const IgnoreList = ({ root }: { root: string }) => {
	const accessor = useAccessor()
	const files = accessor.get('IFileService')
	const commands = accessor.get('ICommandService')
	const uri = URI.file(`${root.replace(/[\\/]+$/, '')}/${AGENT_IGNORE_FILE}`)
	const [state, setState] = useState<{ exists: boolean, patterns: number } | undefined>()
	const [problem, setProblem] = useState<string | undefined>()
	const look = useCallback(async () => {
		try {
			if (!(await files.exists(uri))) { setState({ exists: false, patterns: 0 }); return }
			setState({ exists: true, patterns: countIgnorePatterns((await files.readFile(uri)).value.toString()) })
		} catch { setState(undefined) }
	}, [files, root])
	useEffect(() => { void look() }, [look])
	const open = () => { void commands.executeCommand('vscode.open', uri) }
	const create = async () => {
		setProblem(undefined)
		try { await files.createFile(uri, VSBuffer.fromString(AGENT_IGNORE_TEMPLATE)); await look(); open() }
		catch (e) { setProblem(e instanceof Error ? e.message : String(e)) }
	}
	return <Group title='Files the agent never reads'>
		<Line first testId='vader-privacy-ignore' title={<span className='mo'>{AGENT_IGNORE_FILE}</span>}
			detail={<span data-testid='vader-privacy-ignore-detail'>{state?.exists
				? `${state.patterns} pattern${state.patterns === 1 ? '' : 's'}. The agent does not read, list, search or change those files, and the project index does not hold them. Files you attach to a message yourself are not stopped.`
				: 'None in this project. List the files or folders the agent must never see, in the syntax of .gitignore: it then refuses to read, list, search or change them, and the project index does not hold them.'}{problem ? ` Could not create it: ${problem}` : ''}</span>}
			right={state === undefined ? null : state.exists ? <button className='gb' data-testid='vader-privacy-ignore-open' onClick={open}>Open</button> : <button className='gb' data-testid='vader-privacy-ignore-create' onClick={() => { void create() }}>Create</button>} />
	</Group>
}

export const PrivacyPage = () => {
	const accessor = useAccessor()
	const settings = accessor.get('IVaderSettingsService')
	const opener = accessor.get('IOpenerService')
	const auto = useSettingsState().globalSettings.autoCheckUpdates
	const indexOn = useSettingsState().globalSettings.codebaseIndex !== false
	const root = accessor.get('IWorkspaceContextService').getWorkspace().folders[0]?.uri.fsPath
	const { service: indexService, state: indexState } = useCodebaseIndexState(indexOn ? root : undefined)
	const indexWords = indexStatusWords(indexState, { on: indexOn, hasFolder: !!root, now: Date.now() })

	const contacts: { who: string, when: string, host: string }[] = [
		{ who: 'Your model provider', when: 'Only when you chat or fetch the model list with a key you set. Your code goes to that provider and nowhere else.', host: 'the provider you configure, or localhost' },
		{ who: 'Extension registry', when: 'When you look at extensions in Add-ons or the editor, or install one.', host: 'open-vsx.org' },
		{ who: 'Add-ons lists', when: 'When you open Add-ons or search there, and when the agent searches for a skill or a server. Only the search words are sent, or a repository’s public file list. Nothing from your project.', host: 'api.github.com, raw.githubusercontent.com, registry.modelcontextprotocol.io, skills.sh, registry.smithery.ai, registry.npmjs.org, api-skillnet.openkg.cn' },
		{ who: 'Release check', when: auto ? 'Now on: a quiet check for a newer release every few hours, and the Check for updates button.' : 'Only when you press "Check for updates", or if you turn the automatic check on.', host: 'api.github.com' },
		{ who: 'Connected agents you add', when: 'Only after you press Install, or send the agent a message. The vendor’s own program then talks to the vendor with your account. Vader does not see the sign-in.', host: 'the vendor of that agent' },
		{ who: 'Pages the agent opens', when: 'Only when it uses its browser, and only sites it was told to visit.', host: 'the sites in question' },
	]

	return <div data-testid='vader-settings-privacy'>
		<PageHead title='Privacy and network' desc='What Vader sends over the network, and to whom. Nothing else is contacted at start-up.' />
		<div className='r' style={{ gap: 40, marginBottom: 6 }}>
			{[['No analytics', 'no crash reporter, no account'], ['Keys stay here', 'sent only to their provider'], ['Your code and chats', 'leave only to the model you chose']].map(([t, d]) => <div key={t} className='c' style={{ gap: 1 }}><span className='t1' style={{ fontWeight: 600 }}>{t}</span><span className='hint'>{d}</span></div>)}
		</div>

		<Group title='Who Vader can contact'>
			<div data-testid='vader-settings-contacts'>
				{contacts.map((c, i) => <Line key={c.who} first={i === 0} testId='vader-privacy-contact' title={c.who} detail={c.when} right={<span className='mo t3' style={{ maxWidth: 300, textAlign: 'right', overflowWrap: 'anywhere' }}>{c.host}</span>} />)}
			</div>
		</Group>

		<Group title='Updates'>
			<Line first title='Check for new releases automatically' lockKey='autoCheckUpdates' detail='Looks at the public list of Vader releases and sends nothing about you. Off by default.' right={<Switch on={auto} label='Check for new releases automatically' testId='vader-settings-privacy-autocheck' onChange={v => settings.setGlobalSetting('autoCheckUpdates', v)} />} />
		</Group>
		{root ? <IgnoreList root={root} /> : null}
		<Group title='Search in the project'>
			<Line first lockKey='codebaseIndex' title='Keep an index of the project for search' detail='Lets the agent find code by what it does, not only by exact text. The index is made and kept on this computer; no file, no word of it is sent anywhere. Files that hold secrets (.env, keys) are never read.' right={<Switch on={indexOn} label='Keep an index of the project for search' testId='vader-privacy-index' onChange={v => settings.setGlobalSetting('codebaseIndex', v)} />} />
			<Line testId='vader-privacy-index-status' title={<span data-testid='vader-privacy-index-title'>{indexWords.title}</span>} detail={<span data-testid='vader-privacy-index-detail'>{indexWords.detail}</span>} right={indexOn && root ? <button className='gb' data-testid='vader-privacy-index-rebuild' disabled={indexWords.tone === 'busy'} onClick={() => { void indexService.rebuild(root) }}>Rebuild</button> : undefined} />
		</Group>
		<div style={{ paddingTop: 14 }}><button className='gb' data-testid='vader-privacy-verified' onClick={() => { void opener.open(URI.parse(`${REPO_URL}/blob/main/docs/integrations/privacy.md`)) }}>How this is verified</button></div>
	</div>
}
