/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react'
import { ArrowLeft, BadgeCheck, Check, ChevronRight, Copy, ExternalLink, FileText, Globe, Loader2, ShieldCheck, Star, Terminal } from 'lucide-react'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor } from '../util/services.js'
import { AgentLogo } from '../util/AgentLogo.js'
import { ProviderLogo } from '../util/ProviderLogo.js'
import { Icon } from '../vader-shell-tsx/icons.js'
import type { ProviderName } from '../../../../common/vaderSettingsTypes.js'
import type { ExternalAgentLogoName } from '../../../../common/externalAgents/externalAgentCatalog.js'
import type { ItemFact, MarketplaceItem } from '../../../../common/marketplace/marketplaceTypes.js'
import { skillAsks, trustLevelOf } from '../../../../common/marketplace/trustScore.js'
import { categoryOf, CategoryKind } from '../../../../common/marketplace/categories.js'
import { TrustMeter } from './TrustMeter.js'

// The page of one skill, MCP server, extension or agent: what a person opens by clicking its row (not its install button). It is built like the
// boards of the design canvas (P01 to P04): a header with the logo, name, publisher and sections; tabs; and on the right an install card, the trust
// card with its reasons, and the facts. Each kind has its own arrangement, because what a person needs to decide differs:
//   skill      what the text asks for (terminal, network, files), the first lines of SKILL.md, the full text
//   MCP server where it runs and what leaves this computer, what it needs first, and the exact entry that would be written into mcp.json
//   extension  a marketplace page: icon, rating, installs, version, sections, then the details
//   agent      three steps to get from here to a working chat, and who counts the cost
// The facts, the sections and the setup come from the item itself (metadata.facts, metadata.categories, metadata.setup), filled in by its provider.
// The colours are written inline in each className on purpose: the build that scopes Tailwind to Vader's own UI rewrites class names it finds
// inside className attributes, not ones kept in a constant.

export type ItemPageProps = {
	item: MarketplaceItem
	/** other items of the same kind and section, so a person can keep browsing without going back */
	related?: readonly MarketplaceItem[]
	onOpenRelated?: (item: MarketplaceItem) => void
	busy: boolean
	refining?: boolean
	error?: string
	onAction: () => void
	onActionAndEnable?: () => void
	onBack: () => void
}

const KIND_NOUN: Record<string, string> = { SKILL: 'Skill', MCP_SERVER: 'MCP server', EXTENSION: 'Extension', ACP_AGENT: 'Agent', LANGUAGE_SERVER: 'Language server', DEBUG_ADAPTER: 'Debugger', FORMATTER: 'Formatter', TREE_SITTER_GRAMMAR: 'Grammar', JUPYTER_KERNEL: 'Notebook kernel' }

/** a colour for a letter, the same every time for the same name, so a row without a logo is still recognisable */
const hueOf = (s: string): number => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h }

/** the mark of the publisher when it is one Vader has the logo of (read from the address the add-on comes from), else nothing: a letter is better than a wrong mark */
export const PUBLISHER_MARK: { [owner: string]: ProviderName } = { anthropics: 'anthropic', anthropic: 'anthropic', openai: 'openAI', google: 'gemini', googleapis: 'gemini', 'google-gemini': 'gemini', mistralai: 'mistral', 'xai-org': 'xAI', 'deepseek-ai': 'deepseek' }
const publisherMarkOf = (item: MarketplaceItem): ProviderName | undefined => {
	const where = String(item.metadata.repositoryUrl ?? item.source ?? '')
	const owner = /(?:github\.com\/|^)([A-Za-z0-9_.-]+)\//.exec(where)?.[1]?.toLowerCase()
	return owner ? PUBLISHER_MARK[owner] : undefined
}

/** the logo of an add-on, on the tile of the boards (L01, A01): the publisher's mark, the extension's own icon, the agent's logo, a plug for a server, else the first letter */
export const ItemLogo = ({ item, size = 40, plain }: { item: MarketplaceItem, size?: number, plain?: boolean }) => {
	const testid = plain ? undefined : 'vader-item-logo'
	const [failed, setFailed] = useState(false)
	const logo = typeof item.metadata.logo === 'string' ? item.metadata.logo as ExternalAgentLogoName : undefined
	const iconUrl = typeof item.metadata.iconUrl === 'string' ? item.metadata.iconUrl : undefined
	const tile = { width: size, height: size, borderRadius: Math.round(size * 0.24) }
	const inner = Math.round(size * 0.58)
	if (item.type === 'ACP_AGENT' && logo) {
		return <div data-testid={testid} className='logo' style={tile}><AgentLogo logo={logo} size={inner} /></div>
	}
	if (iconUrl && !failed) {
		return <img data-testid={testid} src={iconUrl} alt='' className='shrink-0 object-contain' style={tile} onError={() => setFailed(true)} />
	}
	const mark = publisherMarkOf(item)
	if (mark) return <div data-testid={testid} aria-hidden='true' className='logo' style={tile}><ProviderLogo providerName={mark} size={inner} /></div>
	if (item.type === 'MCP_SERVER') return <div data-testid={testid} aria-hidden='true' className='logo' style={tile}><Icon k='plug' /></div>
	return <div data-testid={testid} aria-hidden='true' className='logo select-none' style={{ ...tile, fontSize: Math.round(size * 0.42), fontWeight: 600, color: 'var(--t2)' }}>{item.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?'}</div>
}

const Facts = ({ facts, onLink }: { facts: readonly ItemFact[], onLink: (href: string) => void }) => <div className='flex flex-col' data-testid='vader-item-facts'>
	{facts.map((f, i) => <div key={i} className='flex gap-3 py-2 border-t border-vader-border-3 first:border-t-0'>
		<span className='text-vader-fg-3 shrink-0' style={{ width: 104 }}>{f.label}</span>
		{f.href ? <button className='text-left text-vader-fg-1 hover:underline break-words min-w-0 flex items-center gap-1' onClick={() => onLink(f.href!)}>{f.value}<ExternalLink className='w-3 h-3 shrink-0 text-vader-fg-3' /></button> : <span className='text-vader-fg-1 break-words min-w-0'>{f.value}</span>}
	</div>)}
</div>

const Tabs = ({ tabs, active, onChange }: { tabs: { id: string, label: string }[], active: string, onChange: (id: string) => void }) => <div className='flex border-b border-vader-border-3' role='tablist'>
	{tabs.map(t => <button key={t.id} role='tab' aria-selected={active === t.id} data-testid={`vader-item-tab-${t.id}`} className={`px-1 py-2.5 mr-6 border-b ${active === t.id ? 'border-vader-fg-1 text-vader-fg-1' : 'border-transparent text-vader-fg-3'}`} onClick={() => onChange(t.id)}>{t.label}</button>)}
</div>

const Card = ({ children }: { children: React.ReactNode }) => <div className='rounded-lg border border-vader-border-3 bg-vader-bg-2'>{children}</div>

const SectionTitle = ({ children, right }: { children: React.ReactNode, right?: React.ReactNode }) => <div className='flex items-center gap-3 h-7'><span className='font-semibold text-vader-fg-1'>{children}</span><span className='flex-1' />{right}</div>

const About = ({ title, children }: { title: string, children: React.ReactNode }) => <div className='flex flex-col gap-2'><span className='font-semibold text-vader-fg-1'>{title}</span><div className='text-vader-fg-2 leading-relaxed' style={{ maxWidth: '72ch' }}>{children}</div></div>

const Code = ({ children, testid }: { children: string, testid?: string }) => <pre data-testid={testid} className='text-sm font-mono whitespace-pre-wrap break-words px-4 py-3 rounded-lg border border-vader-border-3 bg-vader-bg-1 text-vader-fg-2 leading-6 overflow-y-auto' style={{ maxHeight: 420 }}>{children}</pre>

const WhyScore = ({ item, refining }: { item: MarketplaceItem, refining?: boolean }) => {
	const s = item.trustScore
	if (!s) return <div className='text-vader-fg-3 py-4'>This kind of add-on has no trust score.</div>
	const listedBy = Array.isArray(item.metadata.sourcesListing) ? (item.metadata.sourcesListing as string[]).join(', ') : ''
	return <div className='flex flex-col' data-testid='vader-item-why'>
		{s.factors.map((f, i) => <div key={i} className='flex items-center justify-between gap-3 py-2 border-t border-vader-border-3 first:border-t-0'>
			<span className='text-vader-fg-2'>{f.label}</span>
			<span className={f.points > 0 && i > 0 ? 'text-green-500' : f.points < 0 ? 'text-red-500' : 'text-vader-fg-2'}>{f.points > 0 && i > 0 ? `+${f.points}` : f.points < 0 ? `−${-f.points}` : f.points}</span>
		</div>)}
		<div className='text-vader-fg-3 pt-3 leading-relaxed'>{refining ? 'Asking the sources again for the latest numbers...' : item.metadata.refined ? 'Scored just now from what the sources say today.' : 'Scored from what the listing says.'}{listedBy ? ` Found in: ${listedBy}.` : ''} It is computed again whenever it is listed, and again for what is installed. It is a guide to what to read first, not a safety check: Vader still asks before the agent runs anything.</div>
	</div>
}

/** the install control of a page: the white button that says what it does, or the state the item is in */
const InstallCard = ({ item, busy, error, onAction, onActionAndEnable }: Pick<ItemPageProps, 'item' | 'busy' | 'error' | 'onAction' | 'onActionAndEnable'>) => {
	const level = item.trustScore ? trustLevelOf(item.trustScore.score) : undefined
	const label = typeof item.metadata.actionLabel === 'string' ? item.metadata.actionLabel : item.metadata.openOnly ? 'Open' : item.type === 'SKILL' ? 'Install, switched off' : 'Install'
	const hint = item.installed ? '' : item.type === 'SKILL' ? 'It is stored switched off. Read it, then switch it on when you are ready.'
		: item.type === 'MCP_SERVER' ? (item.metadata.setup as { transport?: string } | undefined)?.transport === 'none' ? '' : 'Adds the entry to your mcp.json and starts it once to check it works.'
			: item.type === 'EXTENSION' ? 'Installed and updated by the editor, like any other extension.' : ''
	return <div className='flex flex-col gap-2.5' data-testid='vader-item-install-card'>
		{item.installed ? <span className='flex items-center gap-1.5 text-vader-fg-2'><Check className='w-4 h-4 text-green-500' />Installed</span>
			: busy ? <span className='flex items-center gap-1.5 text-vader-fg-2'><Loader2 className='w-4 h-4 animate-spin' />Installing</span>
				: item.installMethod ? <>
					<button data-testid='vader-item-install' className={`w-full h-9 rounded-md font-medium text-center ${level === 'low' ? 'border border-vader-border-1 text-vader-fg-1' : 'bg-vader-fg-0 text-vader-bg-3 hover:opacity-90'}`} onClick={onAction}>{label}</button>
					{item.type === 'SKILL' && onActionAndEnable && level !== 'low' ? <button data-testid='vader-item-install-enable' className='gb' style={{ width: '100%', height: 36, justifyContent: 'center' }} title='Install it and switch it on. You can still read it afterwards.' onClick={onActionAndEnable}>Install and switch on</button> : null}
					{hint ? <span className='text-vader-fg-3 text-sm leading-snug'>{hint}</span> : null}
				</> : <span className='text-vader-fg-3'>{item.metadata.state === 'needs-node' ? 'Needs Node.js first' : item.metadata.state === 'unsupported' ? 'No build for this computer' : 'Nothing to install'}</span>}
		{level === 'low' && !item.installed && item.installMethod ? <span className='text-red-500 text-sm leading-snug'>This scores {item.trustScore!.score}%. Read why before you install it.</span> : null}
		{error ? <span className='text-red-500 text-sm leading-snug' data-testid='vader-item-error'>{error}</span> : null}
	</div>
}

/** the score as a person reads it: the number, the word, the reasons that moved it, and a way to the full list */
const TrustCard = ({ item, onWhy }: { item: MarketplaceItem, onWhy?: () => void }) => {
	const s = item.trustScore
	if (!s) return null
	const level = trustLevelOf(s.score)
	const reasons = s.factors.slice(1, 5)
	return <Card><div className='flex flex-col gap-3 p-4' data-testid='vader-item-trust'>
		<div className='flex items-end gap-4'>
			<TrustMeter score={s} large />
			<span className='text-vader-fg-2 leading-snug pb-0.5 flex-1'>{level === 'high' ? 'Nothing here gives a reason to hold back.' : level === 'medium' ? 'Read it before you switch it on.' : 'Read why before you install it.'}</span>
		</div>
		<div className='flex flex-col'>
			{reasons.map((f, i) => <div key={i} className='flex items-center justify-between gap-3 min-h-7 border-t border-vader-border-3 text-sm'>
				<span className='text-vader-fg-2'>{f.label}</span>
				<span className={f.points > 0 ? 'text-green-500' : f.points < 0 ? 'text-red-500' : 'text-vader-fg-3'}>{f.points > 0 ? `+${f.points}` : f.points < 0 ? `−${-f.points}` : '0'}</span>
			</div>)}
		</div>
		{onWhy ? <button className='flex items-center gap-1 text-left text-vader-fg-2 hover:text-vader-fg-1 w-fit' onClick={onWhy}>See every reason<ChevronRight className='w-3.5 h-3.5' /></button> : null}
	</div></Card>
}

const Related = ({ title, items, onOpen }: { title: string, items: readonly MarketplaceItem[], onOpen?: (i: MarketplaceItem) => void }) => {
	if (items.length === 0 || !onOpen) return null
	return <div className='flex flex-col pt-4 shrink-0' data-testid='vader-item-related'>
		<SectionTitle>{title}</SectionTitle>
		<div className='grid gap-x-8' style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}>
			{items.map(i => <div key={`${i.type}:${i.id}:${i.name}`} role='button' tabIndex={0} data-testid='vader-item-related-row' className='flex items-center gap-3 h-16 border-b border-vader-border-3 text-left min-w-0 cursor-pointer hover:bg-vader-bg-2-hover rounded-sm' onClick={() => onOpen(i)} onKeyDown={e => { if (e.key === 'Enter') onOpen(i) }}>
				<ItemLogo item={i} size={34} plain />
				<span className='flex flex-col min-w-0 flex-1'><span className='font-medium text-vader-fg-1 truncate'>{i.name}</span><span className='text-vader-fg-3 text-sm truncate'>{i.description || i.source}</span></span>
				{i.trustScore ? <TrustMeter score={i.trustScore} /> : <span className='text-vader-fg-3 text-sm shrink-0'>{i.installed ? 'Installed' : 'Not installed'}</span>}
			</div>)}
		</div>
	</div>
}

const Ask = ({ icon, title, detail, on }: { icon: React.ReactNode, title: string, detail: string, on: boolean | undefined }) => <div className='flex flex-col gap-2 flex-1 min-w-0 rounded-lg border border-vader-border-3 bg-vader-bg-1 p-4'>
	<div className='flex items-center gap-2.5'><span className='text-vader-fg-2'>{icon}</span><span className='font-medium text-vader-fg-1'>{title}</span><span className='flex-1' /><span className={`text-xs px-2 py-0.5 rounded-full ${on ? 'bg-red-500/15 text-red-500' : 'bg-black/10 dark:bg-white/10 text-vader-fg-3'}`}>{on === undefined ? 'Not read yet' : on ? 'Asks for it' : 'Not asked'}</span></div>
	<span className='text-vader-fg-3 text-sm leading-relaxed'>{detail}</span>
</div>

// ---------------------------------------------------------------- skill

const SkillBody = ({ item, refining, tab, setTab }: { item: MarketplaceItem, refining?: boolean, tab: string, setTab: (t: string) => void }) => {
	const text = typeof item.metadata.instructions === 'string' ? item.metadata.instructions : undefined
	const asks = text !== undefined ? skillAsks(text) : undefined
	if (tab === 'why') return <WhyScore item={item} refining={refining} />
	if (tab === 'instructions') return <div className='flex flex-col gap-3' data-testid='vader-item-instructions'>
		<span className='text-vader-fg-3'>This is the text the agent follows when a task matches. It is composed into the agent&apos;s instructions as it is, so read it before you switch the skill on.</span>
		{text ? <Code>{text.slice(0, 20000) + (text.length > 20000 ? '\n...' : '')}</Code> : <div className='text-vader-fg-3 py-6'>{refining ? 'Reading the skill from its source...' : 'The text has not been fetched yet.'}</div>}
	</div>
	return <div className='flex flex-col gap-6'>
		<About title='What it does'>{item.description || (item.source ? `Found in ${item.source}, which gives no description. What the skill says is under SKILL.md.` : 'This source gives no description.')}</About>
		<div className='flex flex-col gap-2.5'>
			<SectionTitle right={<span className='text-vader-fg-3 text-sm'>Worked out from the skill&apos;s own text. The agent still asks before it does any of these.</span>}>What it asks for</SectionTitle>
			<div className='flex gap-3'>
				<Ask icon={<Terminal className='w-4 h-4' />} title='The terminal' detail='Runs commands such as npm install, each one asked first.' on={asks?.terminal} />
				<Ask icon={<Globe className='w-4 h-4' />} title='The network' detail='Fetches pages, documentation and packages.' on={asks?.network} />
				<Ask icon={<FileText className='w-4 h-4' />} title='Files' detail='Reads and writes files in the open project.' on={asks?.fs} />
			</div>
		</div>
		{text ? <div className='flex flex-col gap-2'>
			<SectionTitle right={<button className='text-vader-accent hover:underline' onClick={() => setTab('instructions')}>Read all of it</button>}>The first lines of SKILL.md</SectionTitle>
			<Code testid='vader-item-excerpt'>{text.split('\n').slice(0, 9).join('\n').slice(0, 700)}</Code>
		</div> : null}
	</div>
}

// ---------------------------------------------------------------- MCP server

type McpSetup = { summary: string, transport: string, entry?: string, env: { name: string, required: boolean, secret: boolean, description?: string }[], needs?: string }

const FlowBox = ({ title, sub, strong }: { title: string, sub: string, strong?: boolean }) => <div className={`flex flex-col gap-1 flex-1 min-w-0 rounded-lg border p-3.5 ${strong ? 'border-vader-border-2 bg-vader-bg-2' : 'border-vader-border-3 bg-vader-bg-1'}`}><span className='font-medium text-vader-fg-1'>{title}</span><span className='text-vader-fg-3 text-sm leading-snug'>{sub}</span></div>
const FlowArrow = ({ label }: { label: string }) => <div className='flex flex-col items-center justify-center shrink-0 gap-0.5 text-vader-fg-3' style={{ width: 76 }}><span className='text-xs'>{label}</span><span aria-hidden='true'>⟶</span></div>

const Step = ({ n, title, detail }: { n: number, title: string, detail: string }) => <div className='flex items-start gap-3.5 py-3 border-t border-vader-border-3'>
	<span className='shrink-0 rounded-full text-vader-fg-1 flex items-center justify-center' style={{ width: 22, height: 22, background: 'var(--g3)' }} data-step={n}><svg className='i' viewBox='0 0 24 24' aria-hidden='true' style={{ width: 13, height: 13 }}><path d='m5 12.5 4.5 4.5L19 7.5' /></svg></span>
	<span className='flex flex-col gap-0.5 min-w-0'><span className='font-medium text-vader-fg-1'>{title}</span><span className='text-vader-fg-3 leading-relaxed'>{detail}</span></span>
</div>

const McpBody = ({ item, refining, tab }: { item: MarketplaceItem, refining?: boolean, tab: string }) => {
	const setup = item.metadata.setup as McpSetup | undefined
	const [copied, setCopied] = useState(false)
	if (tab === 'why') return <WhyScore item={item} refining={refining} />
	const transport = setup?.transport ?? 'none'
	const hosted = transport === 'remote' || transport === 'hosted'
	const secrets = setup?.env.filter(v => v.secret) ?? []
	if (tab === 'setup') return <div className='flex flex-col gap-6' data-testid='vader-item-setup'>
		<About title='How it runs'>{setup?.summary ?? 'This listing does not say how the server runs.'}</About>
		{setup && setup.env.length > 0 ? <div className='flex flex-col'>
			<SectionTitle>It asks you for</SectionTitle>
			{setup.env.map(v => <div key={v.name} className='flex items-baseline gap-3 py-2 border-t border-vader-border-3'>
				<span className='font-mono text-sm text-vader-fg-1'>{v.name}</span>
				<span className='text-vader-fg-3 text-sm flex-1'>{v.description ?? ''}</span>
				<span className={`text-sm ${v.secret ? 'text-yellow-600' : 'text-vader-fg-3'}`}>{v.secret ? 'secret' : ''}{v.required ? ' required' : ''}</span>
			</div>)}
			<span className='text-vader-fg-3 pt-2 text-sm'>Asked when you install, saved only in your mcp.json on this computer, and given only to this server.</span>
		</div> : null}
		{setup?.entry ? <div className='flex flex-col gap-2'>
			<SectionTitle right={<button className='flex items-center gap-1 text-vader-fg-2 hover:text-vader-fg-1' onClick={() => { try { void navigator.clipboard?.writeText(setup.entry!) } catch { /* no clipboard */ } setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? <Check className='w-3.5 h-3.5' /> : <Copy className='w-3.5 h-3.5' />}{copied ? 'Copied' : 'Copy'}</button>}>What is written into your mcp.json</SectionTitle>
			<Code testid='vader-item-entry'>{setup.entry}</Code>
		</div> : null}
	</div>
	return <div className='flex flex-col gap-6'>
		<About title='What it gives the agent'>{item.description || 'This source gives no description.'} Every tool it offers goes through the safety gate like any other, and a tool it adds later is switched off until you look at the new list.</About>
		{transport !== 'none' ? <div className='flex flex-col gap-2.5' data-testid='vader-item-flow'>
			<SectionTitle>Where it runs, and what leaves this computer</SectionTitle>
			<div className='flex items-stretch'>
				<FlowBox strong title='The agent' sub='In Vader, on this computer' />
				<FlowArrow label={hosted ? 'network' : 'stdio'} />
				{hosted ? <FlowBox title='A hosted server' sub={transport === 'hosted' ? 'Run by Smithery, not on this computer' : 'Run by someone else, not on this computer'} /> : <FlowBox title={transport === 'docker' ? 'A container' : 'A program on this computer'} sub={setup?.needs ? `Started with ${setup.needs}` : 'Started by Vader'} />}
			</div>
			<span className='text-vader-fg-3 text-sm leading-relaxed'>{hosted ? 'What the agent sends to its tools goes to that server over the network.' : 'Vader sends nothing to a hosted service for it. What the program itself reaches out to is up to the program.'}</span>
		</div> : null}
		<div className='flex flex-col'>
			<SectionTitle>Before you add it</SectionTitle>
			{setup?.needs ? <Step n={1} title={setup.needs} detail={`It starts with ${setup.needs}, which has to be on this computer.`} /> : <Step n={1} title='Nothing to install first' detail={hosted ? 'It is hosted, so nothing runs on this computer.' : 'The listing names no runtime.'} />}
			<Step n={2} title={secrets.length > 0 ? `${secrets.length === 1 ? 'A secret' : `${secrets.length} secrets`}: ${secrets.map(v => v.name).join(', ')}` : 'No secrets'} detail={secrets.length > 0 ? 'Asked when you install, kept only in your mcp.json, given only to this server.' : 'It asks for nothing to sign in with. A server that does is shown here with each secret named before it is added.'} />
			<Step n={3} title='Where it is saved' detail='One entry in your mcp.json, which you can open and edit. Removing it removes the entry.' />
		</div>
	</div>
}

// ---------------------------------------------------------------- extension

const Stat = ({ value, label }: { value: React.ReactNode, label: string }) => <div className='flex flex-col gap-0.5 pr-6'><span className='text-lg font-semibold text-vader-fg-1 flex items-center gap-1.5'>{value}</span><span className='text-vader-fg-3 text-sm'>{label}</span></div>

const ExtensionBody = ({ item, refining, tab }: { item: MarketplaceItem, refining?: boolean, tab: string }) => {
	const sections = ((item.metadata.categories as string[] | undefined) ?? []).map(id => categoryOf('extension', id)?.label).filter((x): x is string => !!x)
	if (tab === 'why') return <WhyScore item={item} refining={refining} />
	const tags = Array.isArray(item.capabilities) ? item.capabilities.slice(0, 10) : []
	return <div className='flex flex-col gap-6'>
		<About title='About'>{item.description || 'This source gives no description.'}</About>
		{sections.length > 0 || tags.length > 0 ? <div className='flex flex-wrap gap-x-10 gap-y-4'>
			{sections.length > 0 ? <div className='flex flex-col gap-2'><span className='text-vader-fg-3'>Sections</span><div className='flex flex-wrap gap-2'>{sections.map((s, i) => <span key={s} className={`px-3 py-1 rounded-full border text-sm ${i === 0 ? 'border-vader-border-1 bg-vader-bg-3 text-vader-fg-1' : 'border-vader-border-3 text-vader-fg-2'}`}>{s}</span>)}</div></div> : null}
			{tags.length > 0 ? <div className='flex flex-col gap-2 min-w-0'><span className='text-vader-fg-3'>Tags</span><div className='flex flex-wrap gap-2'>{tags.map(s => <span key={s} className='px-3 py-1 rounded-full border border-vader-border-3 text-vader-fg-2 text-sm'>{s}</span>)}</div></div> : null}
		</div> : null}
		<Card><div className='flex items-start gap-3.5 p-4'><ShieldCheck className='w-5 h-5 text-vader-fg-2 shrink-0 mt-0.5' /><span className='flex flex-col gap-0.5'><span className='font-medium text-vader-fg-1'>An extension runs code inside the editor</span><span className='text-vader-fg-3 leading-relaxed'>With the same access the editor has. Vader installs it through the editor&apos;s own extension manager, which also keeps it updated.</span></span></div></Card>
	</div>
}

// ---------------------------------------------------------------- agent

const AgentBody = ({ item }: { item: MarketplaceItem }) => {
	const steps = (item.metadata.steps as string[] | undefined) ?? []
	const note = typeof item.metadata.note === 'string' ? item.metadata.note : undefined
	return <div className='flex flex-col gap-6'>
		{steps.length > 0 ? <div className='flex flex-col gap-2.5' data-testid='vader-item-steps'>
			<SectionTitle>From here to a working chat</SectionTitle>
			<div data-testid='vader-item-step-list' className='grid gap-3.5' style={{ gridTemplateColumns: `repeat(${Math.min(3, steps.length)},minmax(0,1fr))` }}>
				{steps.map((st, i) => <div key={i} className='flex flex-col gap-2.5 rounded-lg border border-vader-border-3 bg-vader-bg-1 p-4'>
					<span className='rounded-full border border-vader-border-1 text-vader-fg-2 flex items-center justify-center text-xs shrink-0' style={{ width: 24, height: 24 }}>{i + 1}</span>
					<span className='text-vader-fg-2 leading-relaxed'>{st}</span>
				</div>)}
			</div>
		</div> : null}
		{note ? <Card><div className='flex gap-4 px-5 py-4' data-testid='vader-item-note'><span className='text-vader-fg-3 shrink-0' style={{ width: 150 }}>Plan, limits and cost</span><span className='text-vader-fg-1 leading-relaxed'>{note}</span></div></Card> : null}
	</div>
}

// ---------------------------------------------------------------- the page

export const ItemPage = ({ item, related, onOpenRelated, busy, refining, error, onAction, onActionAndEnable, onBack }: ItemPageProps) => {
	const accessor = useAccessor()
	const opener = accessor.get('IOpenerService')
	const openLink = (href: string) => { try { void opener.open(URI.parse(href)) } catch { /* not a link */ } }
	const kind: 'skill' | 'mcp' | 'extension' | 'agent' | 'other' = item.type === 'SKILL' ? 'skill' : item.type === 'MCP_SERVER' ? 'mcp' : item.type === 'ACP_AGENT' ? 'agent' : item.type === 'EXTENSION' ? 'extension' : 'other'
	const withScore = !!item.trustScore
	const tabs = kind === 'skill' ? [{ id: 'overview', label: 'Overview' }, { id: 'instructions', label: 'SKILL.md' }, ...(withScore ? [{ id: 'why', label: `Why ${item.trustScore!.score}%` }] : [])]
		: kind === 'mcp' ? [{ id: 'overview', label: 'Overview' }, { id: 'setup', label: 'Setup' }, ...(withScore ? [{ id: 'why', label: `Why ${item.trustScore!.score}%` }] : [])]
			: kind === 'extension' || kind === 'other' ? [{ id: 'overview', label: 'Details' }, ...(withScore ? [{ id: 'why', label: `Why ${item.trustScore!.score}%` }] : [])]
				: [{ id: 'overview', label: 'Overview' }]
	const [tab, setTab] = useState('overview')
	const facts = (item.metadata.facts as ItemFact[] | undefined) ?? [{ label: 'Source', value: item.source }, ...(item.publisher ? [{ label: 'Publisher', value: item.publisher }] : [])]
	const noun = KIND_NOUN[item.type] ?? 'Add-on'
	const rating = typeof item.metadata.rating === 'number' ? item.metadata.rating : undefined
	const ratingCount = typeof item.metadata.ratingCount === 'number' ? item.metadata.ratingCount : undefined
	const installs = typeof item.metadata.installCount === 'number' ? item.metadata.installCount : undefined
	const updated = typeof item.metadata.updatedAt === 'string' ? item.metadata.updatedAt : undefined
	const verified = facts.some(f => f.label === 'Publisher' && /verified/.test(f.value))
	const compact = kind === 'skill' || kind === 'mcp'
	const sectionKind: CategoryKind = kind === 'extension' ? 'extension' : kind === 'mcp' ? 'mcp' : 'skill'
	const sections = ((item.metadata.categories as string[] | undefined) ?? []).map(id => categoryOf(sectionKind, id)?.label).filter((x): x is string => !!x)
	const listedIn = Array.isArray(item.metadata.sourcesListing) ? (item.metadata.sourcesListing as string[]) : []
	const agentState = item.installed ? 'Installed' : item.metadata.state === 'needs-node' ? 'Needs Node.js' : item.metadata.state === 'unsupported' ? 'No build for this computer' : item.metadata.openOnly ? 'Opens in the terminal' : 'Not installed'
	const relatedTitle = kind === 'agent' ? 'Other agents you can connect' : sections[0] ? `More in ${sections[0]}` : `More ${noun.toLowerCase()}s`

	return <div className='flex flex-col min-w-0 flex-1 min-h-0 text-root overflow-y-auto' data-testid='vader-item-page' data-kind={kind}>
		<div className='flex items-center h-10 shrink-0'>
			<button data-testid='vader-item-back' className='flex items-center gap-1.5 text-vader-fg-2 hover:text-vader-fg-1' onClick={onBack}><ArrowLeft className='w-4 h-4' />Add-ons</button>
			<span className='text-vader-fg-3 mx-2'>/</span><span className='text-vader-fg-3'>{noun}s</span><span className='text-vader-fg-3 mx-2'>/</span><span className='text-vader-fg-1 truncate'>{item.name}</span>
		</div>
		<div className='flex gap-8 pt-2 items-start shrink-0'>
			<div className='flex flex-col gap-6 min-w-0 flex-1'>
				{/* header: a skill and a server get a compact one, an extension and an agent a roomier one, like the pages they know from other tools */}
				<div className='flex items-start gap-5'>
					<ItemLogo item={item} size={compact ? 76 : 96} />
					<div className='flex flex-col min-w-0 flex-1 gap-1.5'>
						<div className='flex items-baseline gap-3 flex-wrap'>
							<h2 className={`font-semibold text-vader-fg-1 break-words ${compact ? 'text-2xl' : 'text-3xl'}`}>{item.name}</h2>
							<span className='text-vader-fg-3'>{noun}</span>
							{item.version ? <span className='text-vader-fg-3 font-mono text-sm'>v{item.version.replace(/^v/, '')}</span> : null}
						</div>
						<div className='flex items-center gap-1.5 text-vader-fg-2'>{item.publisher ?? item.source}{verified ? <BadgeCheck className='w-4 h-4 text-vader-fg-1' aria-label='Verified publisher' /> : null}</div>
						{kind === 'extension' && item.description ? <div className='text-vader-fg-2 leading-snug' style={{ maxWidth: '62ch' }}>{item.description}</div> : null}
						{kind === 'agent' ? <div className='flex flex-col gap-2'>
							<span className='text-vader-fg-2 leading-relaxed' style={{ maxWidth: '62ch' }}>{item.description}</span>
							<span className='flex items-center gap-3'><span data-testid='vader-item-state' className='flex items-center gap-2 rounded-full border border-vader-border-2 px-3 py-0.5 text-vader-fg-2 w-fit'><span className={`rounded-full ${item.installed ? 'bg-green-500' : 'bg-vader-fg-3'}`} style={{ width: 7, height: 7 }} />{agentState}</span>{item.metadata.openOnly ? null : <span className='text-vader-fg-3 text-sm'>Works inside Vader&apos;s chat (Agent Client Protocol)</span>}</span>
						</div> : null}
						{compact && (sections.length > 0 || listedIn.length > 0) ? <div className='flex items-center gap-2 flex-wrap pt-0.5' data-testid='vader-item-chips'>
							{sections.map((c, i) => <span key={c} className={`px-3 py-0.5 rounded-full border text-sm ${i === 0 ? 'border-vader-border-1 bg-vader-bg-3 text-vader-fg-1' : 'border-vader-border-3 text-vader-fg-2'}`}>{c}</span>)}
							{listedIn.length > 0 ? <span className='text-vader-fg-3 text-sm ml-1'>Found in {listedIn.join(', ')}</span> : null}
						</div> : null}
						{kind === 'extension' && (rating !== undefined || installs !== undefined || item.version || updated) ? <div className='flex items-center pt-2' data-testid='vader-item-stats'>
							{rating !== undefined ? <Stat value={<><Star className='w-3.5 h-3.5 text-yellow-500' />{rating.toFixed(1)}</>} label={ratingCount !== undefined ? `${ratingCount.toLocaleString('en-US')} ratings` : 'rating'} /> : null}
							{installs !== undefined ? <Stat value={installs >= 1e6 ? `${(installs / 1e6).toFixed(1)}M` : installs >= 1e3 ? `${Math.round(installs / 1e3)}K` : String(installs)} label='installs' /> : null}
							{item.version ? <Stat value={`v${item.version.replace(/^v/, '')}`} label='version' /> : null}
							{updated ? <Stat value={updated.slice(0, 10)} label='last updated' /> : null}
						</div> : null}
					</div>
				</div>
				<Tabs tabs={tabs} active={tab} onChange={setTab} />
				{kind === 'skill' ? <SkillBody item={item} refining={refining} tab={tab} setTab={setTab} />
					: kind === 'mcp' ? <McpBody item={item} refining={refining} tab={tab} />
						: kind === 'agent' ? <AgentBody item={item} />
							: <ExtensionBody item={item} refining={refining} tab={tab} />}
			</div>
			<div className='flex flex-col gap-4 shrink-0' style={{ width: 340 }}>
				<Card><div className='p-4'><InstallCard item={item} busy={busy} error={error} onAction={onAction} onActionAndEnable={onActionAndEnable} /></div></Card>
				<TrustCard item={item} onWhy={withScore && tabs.some(t => t.id === 'why') ? () => setTab('why') : undefined} />
				<Card><div className='px-4 py-1.5'><Facts facts={facts} onLink={openLink} /></div></Card>
			</div>
		</div>
		<Related title={relatedTitle} items={related ?? []} onOpen={onOpenRelated} />
		<div className='shrink-0' style={{ height: 32 }} />
	</div>
}
