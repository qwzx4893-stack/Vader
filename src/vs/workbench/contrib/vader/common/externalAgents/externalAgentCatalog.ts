/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The coding agents a person can bring into Vader with the account they already have: their own subscription, a free daily allowance, a free tier.
//
// Two ways in, chosen by what each vendor officially supports (see docs/integrations/external-agents.md):
//   'acp'      The agent speaks the Agent Client Protocol (Zed / JetBrains). Vader starts the vendor's official program, shows the conversation in
//              its own chat, and the agent keeps its own tools and its own permission rules. The sign-in happens in the vendor's program and its
//              browser page; Vader never sees a token.
//   'terminal' The vendor's official terminal program runs unchanged in a Vader terminal. Used where there is no protocol (Freebuff), or where the
//              vendor's terms say the subscription may only be used through its own unmodified program (Claude Code).
// Nothing here talks to a vendor on its own: every install and every sign-in is started by the person with a click, and the exact command is shown first.

import { acpRegistrySnapshot, RegistryDistribution } from './acpRegistrySnapshot.js'

export type ExternalAgentKind = 'acp' | 'terminal'

/** key of the logo in providerLogoData.ts (`agent:<name>`) */
export type ExternalAgentLogoName = 'codex' | 'opencode' | 'cursor' | 'copilot' | 'mistral' | 'grok' | 'kimi' | 'claudecode' | 'antigravity' | 'freebuff' | 'custom'

export type TerminalAgentSpec = {
	/** the program to run once installed */
	readonly command: string
	/** install commands as the vendor documents them, per platform; shown to the person before anything runs */
	readonly install: { readonly windows: string, readonly posix: string }
	/** folders (relative to the home folder) where the installer puts the program, for when the PATH of this window predates the install */
	readonly candidateDirs: readonly string[]
	readonly needsNode?: boolean
}

export type AcpAgentSpec = {
	/** id of the entry in the ACP Agent Registry */
	readonly registryId: string
	/** shown when a sign-in needs the person to do something outside Vader */
	readonly loginNote: string
	/** ids of the agent's sign-in methods that use the person's account, best first. Agents list their methods in their own order (Codex lists "API Key" before "ChatGPT"). */
	readonly authPreference?: readonly string[]
	/** a downloaded program may only come from an address that starts with one of these (the vendor's own release location), whatever the registry says */
	readonly archivePrefixes?: readonly string[]
	/**
	 * The program a person who already uses this agent has on their computer. When it is found and answers the protocol (checked with a handshake) it is used as it
	 * is: nothing is downloaded and the sign-in it already holds counts. `args` are what make it speak ACP (the registry's own arguments for the agent).
	 */
	readonly local?: { readonly command: string, readonly args: readonly string[], readonly candidateDirs?: readonly string[] }
}

export type ExternalAgentDef = {
	readonly id: string
	readonly name: string
	readonly kind: ExternalAgentKind
	readonly logo: ExternalAgentLogoName
	/** one line about what the account gives */
	readonly tagline: string
	readonly website: string
	/** extra honest detail for the card (limits, who bills, what Vader does not control) */
	readonly note?: string
	readonly acp?: AcpAgentSpec
	readonly terminal?: TerminalAgentSpec
}

export const externalAgentCatalog: readonly ExternalAgentDef[] = [
	{
		id: 'codex', name: 'Codex', kind: 'acp', logo: 'codex',
		tagline: 'Your ChatGPT plan (Plus, Pro, Business) or an OpenAI API key, through OpenAI\'s Codex.',
		website: 'https://developers.openai.com/codex',
		note: 'Needs Node.js. You sign in with your OpenAI account in the browser; OpenAI counts the usage on your plan.',
		acp: { registryId: 'codex-acp', loginNote: 'A browser page opens to sign in with your ChatGPT account.', authPreference: ['chat-gpt'] },
	},
	{
		id: 'opencode', name: 'OpenCode', kind: 'acp', logo: 'opencode',
		tagline: 'Free models from OpenCode Zen (no card), your ChatGPT plan, or any provider key.',
		website: 'https://opencode.ai',
		note: 'The free models change from time to time and OpenCode may use the free-tier prompts to improve them. Limits are OpenCode\'s.',
		acp: { registryId: 'opencode', loginNote: 'OpenCode asks which provider to use; free Zen models need no payment details.', local: { command: 'opencode', args: ['acp'], candidateDirs: ['.opencode/bin'] }, archivePrefixes: ['https://github.com/anomalyco/opencode/releases/download/', 'https://github.com/sst/opencode/releases/download/'] },
	},
	{
		id: 'cursor', name: 'Cursor', kind: 'acp', logo: 'cursor',
		tagline: 'Your Cursor subscription, through Cursor\'s own agent.',
		website: 'https://cursor.com/docs/cli/acp',
		note: 'You sign in with your Cursor account; Cursor counts the usage on your plan.',
		acp: { registryId: 'cursor', loginNote: 'A browser page opens to sign in to Cursor.', local: { command: 'cursor-agent', args: ['acp'], candidateDirs: ['.local/bin'] }, archivePrefixes: ['https://downloads.cursor.com/'] },
	},
	{
		id: 'copilot', name: 'GitHub Copilot', kind: 'acp', logo: 'copilot',
		tagline: 'Your GitHub Copilot plan (a free plan exists; Pro and Pro+ for more), through GitHub\'s own Copilot CLI.',
		website: 'https://github.com/features/copilot/cli/',
		note: 'Needs Node.js. You sign in with your GitHub account in the terminal that opens; GitHub counts the usage on your Copilot plan.',
		acp: { registryId: 'github-copilot-cli', loginNote: 'A terminal runs GitHub\'s own "copilot login" (a code to confirm in the browser).', local: { command: 'copilot', args: ['--acp'] } },
	},
	{
		id: 'mistral-vibe', name: 'Mistral Vibe', kind: 'acp', logo: 'mistral',
		tagline: 'Your Mistral Le Chat plan (Pro or Team), through Mistral\'s own coding agent.',
		website: 'https://mistral.ai/products/vibe',
		note: 'You sign in with your Mistral account; Mistral counts the usage on your plan. The free plan has only limited coding access.',
		acp: { registryId: 'mistral-vibe', loginNote: 'A browser page opens to sign in to Mistral.', authPreference: ['browser-auth'], local: { command: 'vibe-acp', args: [] }, archivePrefixes: ['https://github.com/mistralai/mistral-vibe/releases/download/'] },
	},
	{
		id: 'grok-build', name: 'Grok Build', kind: 'acp', logo: 'grok',
		tagline: 'Your SuperGrok or X Premium+ plan, through xAI\'s own coding agent.',
		website: 'https://x.ai/cli',
		note: 'Needs Node.js and a paid SuperGrok or X Premium+ plan (the free Grok chat does not include it). xAI has not published usage limits.',
		acp: { registryId: 'grok-build', loginNote: 'A browser page opens to sign in with Grok.', local: { command: 'grok', args: ['agent', 'stdio'] } },
	},
	{
		id: 'kimi', name: 'Kimi Code', kind: 'acp', logo: 'kimi',
		tagline: 'Your Kimi membership (a free tier exists), through Moonshot\'s own Kimi Code CLI.',
		website: 'https://moonshotai.github.io/kimi-cli/',
		note: 'You sign in with your Kimi account in the terminal that opens; Moonshot counts the usage on your membership.',
		acp: { registryId: 'kimi', loginNote: 'A terminal runs Kimi\'s own "kimi login".', local: { command: 'kimi', args: ['acp'] }, archivePrefixes: ['https://github.com/MoonshotAI/kimi-cli/releases/download/'] },
	},
	{
		id: 'claude-code', name: 'Claude Code', kind: 'terminal', logo: 'claudecode',
		tagline: 'Your Claude plan (Pro, Max, Team) in Anthropic\'s own program.',
		website: 'https://code.claude.com/docs/en/setup',
		note: 'Needs a paid Claude plan (Pro, Max, Team or Enterprise; the free plan does not include Claude Code). Anthropic allows its subscription only inside its own unmodified Claude Code, so it runs here exactly as Anthropic ships it, in a terminal, and is not wired into Vader\'s chat. Vader never handles the sign-in.',
		terminal: {
			command: 'claude',
			install: { windows: 'irm https://claude.ai/install.ps1 | iex', posix: 'curl -fsSL https://claude.ai/install.sh | bash' },
			candidateDirs: ['.local/bin'],
		},
	},
	{
		id: 'antigravity', name: 'Antigravity', kind: 'acp', logo: 'antigravity',
		tagline: 'Google\'s Antigravity agent with your Google account\'s plan.',
		website: 'https://antigravity.google/docs/ide/extensions',
		note: 'Google\'s own agent server for editors (listed in the ACP registry). The models are the ones your plan offers; limits and data use are Google\'s.',
		acp: { registryId: 'antigravity-acp', loginNote: 'Sign in with your Google account when Antigravity asks.', archivePrefixes: ['https://dl.google.com/agy-extensions/'] },
	},
	{
		id: 'freebuff', name: 'Freebuff', kind: 'terminal', logo: 'freebuff',
		tagline: 'A free daily allowance, no subscription: models are paid for by short text ads in the terminal.',
		website: 'https://freebuff.com',
		note: 'Needs Node.js. Freebuff has no integration protocol, so its CLI runs unchanged in a terminal. Limits, ads and data use are Freebuff\'s.',
		terminal: {
			command: 'freebuff',
			install: { windows: 'npm install -g freebuff', posix: 'npm install -g freebuff' },
			candidateDirs: [],
			needsNode: true,
		},
	},
]

export const externalAgentById = (id: string): ExternalAgentDef | undefined => externalAgentCatalog.find(a => a.id === id)

/** ids of the agents whose conversation can be shown in Vader's own chat */
export const acpAgentIds = (): string[] => externalAgentCatalog.filter(a => a.kind === 'acp').map(a => a.id)

// ---------- where to get an ACP agent ----------

export type PlatformKey = 'darwin-aarch64' | 'darwin-x86_64' | 'linux-aarch64' | 'linux-x86_64' | 'windows-aarch64' | 'windows-x86_64'

export const platformKeyOf = (platform: string, arch: string): PlatformKey | undefined => {
	const os = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : undefined
	const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : undefined
	return os && cpu ? `${os}-${cpu}` as PlatformKey : undefined
}

/** the version and distribution of a catalog agent, from the registry snapshot, or from a live registry document when one was read */
export const distributionOf = (def: ExternalAgentDef, live?: { [registryId: string]: { version: string, distribution: RegistryDistribution } }): { version: string, distribution: RegistryDistribution } | undefined => {
	if (!def.acp) { return undefined }
	return live?.[def.acp.registryId] ?? acpRegistrySnapshot[def.acp.registryId]
}

// ---------- safety rules for what is downloaded and run ----------

/** an npm package spec (`@scope/name@1.2.3`) or a plain argument: nothing a shell would treat specially */
export const isPlainSpec = (s: string): boolean => /^[A-Za-z0-9@/._:=+-]+$/.test(s)

/** archives may only come from these hosts, over https */
const ARCHIVE_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'downloads.cursor.com', 'dl.google.com']
export const isAllowedArchiveUrl = (url: string, prefixes?: readonly string[]): boolean => {
	try {
		const u = new URL(url)
		if (!(u.protocol === 'https:' && !u.username && !u.password && ARCHIVE_HOSTS.includes(u.hostname))) { return false }
		return !prefixes || prefixes.some(p => url.startsWith(p))
	} catch { return false }
}

/** the relative path an archive entry or a registry `cmd` may point at: inside the install folder, no drive, no `..` */
export const isSafeRelativePath = (p: string): boolean => {
	if (!p || p.includes('\0') || /^([a-zA-Z]:)?[\\/]/.test(p)) { return false }
	return !p.split(/[\\/]+/).includes('..')
}
