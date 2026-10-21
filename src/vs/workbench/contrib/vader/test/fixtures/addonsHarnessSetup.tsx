// The services behind the page of Add-ons (the real federating service and the real providers over saved answers of the sources), shared by the page's own test
// (addonsHarness.tsx) and by the whole window (windowHarness.tsx). Used by test/addonsUiE2E.mjs and test/windowUiE2E.mjs.
import { makeWorld } from './fakeSources.mjs'
import * as P from '../../common/discovery/feedParsers'
import { SkillMarketplaceProvider } from '../../browser/marketplace/providers/skillMarketplaceProvider'
import { MCPMarketplaceProvider } from '../../browser/marketplace/providers/mcpMarketplaceProvider'
import { ExtensionGalleryMarketplaceProvider } from '../../browser/marketplace/providers/extensionGalleryProvider'
import { ConnectedAgentsProvider } from '../../browser/marketplace/providers/connectedAgentsProvider'
import '../../browser/marketplace/unifiedMarketplaceService'
import skillssh from './skillssh-search.json'
import skillsmp from './skillsmp-search.json'
import smitherySkills from './smithery-skills.json'
import topic from './github-topic-search.json'
import smithery from './smithery-search.json'
import npm from './npm-mcp-search.json'
import docker from './dockerhub-mcp.json'
import registry from './mcp-registry-search.json'
import openvsx from './openvsx-search.json'

const FIX: { [k: string]: unknown } = { 'skillssh-search.json': skillssh, 'skillsmp-search.json': skillsmp, 'smithery-skills.json': smitherySkills, 'github-topic-search.json': topic, 'smithery-search.json': smithery, 'npm-mcp-search.json': npm, 'dockerhub-mcp.json': docker, 'mcp-registry-search.json': registry, 'openvsx-search.json': openvsx }
const world = makeWorld(P as any, (n: string) => FIX[n])

const w = window as any
w.__fail = (w.__fail ?? {}) as { [method: string]: string }
w.__delay = w.__delay ?? 0
w.__cmds = [] as string[]
w.__opened = [] as string[]
w.__installed = [] as string[]
w.__calls = world.calls

// every answer of the sources can be made slow or to fail by the test
const base = world.discovery()
const discovery = new Proxy(base, {
	get: (t: any, k: string) => typeof t[k] === 'function' ? async (...a: unknown[]) => {
		if (w.__delay) await new Promise(r => setTimeout(r, w.__delay))
		if (w.__fail[k]) throw new Error(w.__fail[k])
		return t[k](...a)
	} : t[k],
})

const installedSkills: any[] = []
const skillSvc: any = world.skillSvc(installedSkills)
const origInstall = skillSvc.install
skillSvc.install = (o: any) => {
	const rec = { id: `s${installedSkills.length + 1}`, name: o.name, description: o.description, category: o.category, source: { repositoryUrl: o.repositoryUrl }, instructions: o.instructions, instructionsHash: 'h', requestedCapabilities: { fs: false, terminal: false, network: false, mcp: false }, trustState: 'review_required', pinned: false, enabled: false }
	installedSkills.push(rec); w.__installed.push(`skill:${o.name}`); origInstall.call(skillSvc, o); return rec
}
skillSvc.setEnabled = (id: string, on: boolean) => { const s = installedSkills.find(x => x.id === id); if (s) s.enabled = on; w.__installed.push(`enable:${id}:${on}`) }
const mcpSvc: any = { state: { mcpServerOfName: {} }, async addOrUpdateServer(n: string, e: unknown) { w.__installed.push(`mcp:${n}`); this.state.mcpServerOfName[n] = { status: 'success', tools: [] }; w.__mcpEntry = e }, async revealMCPConfigFile() { }, async toggleServerIsOn() { } }
const quick: any = { async input() { return 'test-secret' } }
const opener: any = { async open(u: unknown) { w.__opened.push(String(u)) } }
const commands: any = { async executeCommand(id: string) { w.__cmds.push(id) } }
const ews: any = {
	async queryLocal() { return [] }, async queryGallery() { return { firstPage: [] } }, async install(id: string) { w.__installed.push(`ext:${id}`) },
}
const agentStatuses = [{ id: 'codex', state: 'ready', installedVersion: '2.2.2' }, { id: 'cursor', state: 'not-installed' }, { id: 'copilot', state: 'needs-node' }]
const agentsSvc: any = { async getStatuses() { return agentStatuses }, async install(id: string) { w.__installed.push(`agent:${id}`); const s = agentStatuses.find(x => x.id === id); if (s) s.state = 'ready'; return { id, state: 'ready' } }, async uninstall() { } }

const Ctor = w.__UnifiedCtor
const service = new Ctor()
service.registerProvider(new SkillMarketplaceProvider(skillSvc, discovery as any, world.settings([])))
service.registerProvider(new MCPMarketplaceProvider(mcpSvc, discovery as any, quick, opener, world.settings([])))
service.registerProvider(new ExtensionGalleryMarketplaceProvider(ews, { isEnabled: () => true } as any, discovery as any))
service.registerProvider(new ConnectedAgentsProvider(agentsSvc, commands))

export const addonsServices = { service, skillSvc, installedSkills, commands, opener }
