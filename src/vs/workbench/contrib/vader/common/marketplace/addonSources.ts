/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The live sources Add-ons asks, one list for the providers (what to ask) and for Settings (what the person can switch off).
// Each is a public address asked with the words typed, nothing from the workspace; docs/integrations/privacy.md lists the hosts.
// All are on until the person turns one off (the setting stores only the ones that are off, so a source added later is on).

export type AddonSourceKind = 'skill' | 'mcp' | 'extension' | 'agent';

export type AddonSource = {
	readonly id: string;
	readonly kind: AddonSourceKind;
	readonly label: string;
	/** one line: what it is and what it gives the score */
	readonly hint: string;
	/** the host Vader contacts, as shown in Settings > Privacy */
	readonly host: string;
	/** extension and agent sources are fixed by the product; they are listed so the person sees where results come from, but not switched */
	readonly fixed?: boolean;
};

export const ADDON_SOURCES: readonly AddonSource[] = [
	{ id: 'github-repos', kind: 'skill', label: 'GitHub repositories of skills', hint: 'anthropics/skills, openai/skills and the repositories you add. Gives stars, last change, licence.', host: 'api.github.com' },
	{ id: 'skills-sh', kind: 'skill', label: 'skills.sh', hint: 'A live index of skills with how many times each was installed.', host: 'skills.sh' },
	{ id: 'github-topic-skills', kind: 'skill', label: 'GitHub, repositories tagged agent-skills', hint: 'Any public repository that tags itself as holding skills, most starred first.', host: 'api.github.com' },
	{ id: 'skillsmp', kind: 'skill', label: 'SkillsMP', hint: 'Skills indexed from GitHub with the repository’s stars and when each last changed.', host: 'skillsmp.com' },
	{ id: 'smithery-skills', kind: 'skill', label: 'Smithery skills', hint: 'Smithery’s registry of skills; it also says which section each belongs to.', host: 'registry.smithery.ai' },
	{ id: 'skillnet', kind: 'skill', label: 'SkillNet', hint: 'A public index of community skills.', host: 'api-skillnet.openkg.cn' },
	{ id: 'mcp-registry', kind: 'mcp', label: 'Official MCP Registry', hint: 'The registry of the Model Context Protocol project. Says if an entry is deprecated.', host: 'registry.modelcontextprotocol.io' },
	{ id: 'smithery', kind: 'mcp', label: 'Smithery', hint: 'A hosted registry of MCP servers with use counts and verified publishers.', host: 'registry.smithery.ai' },
	{ id: 'npm-mcp', kind: 'mcp', label: 'npm, packages that call themselves MCP servers', hint: 'Gives weekly downloads and whether it was published from a CI workflow.', host: 'registry.npmjs.org' },
	{ id: 'docker-mcp', kind: 'mcp', label: 'Docker MCP images', hint: 'The MCP server images Docker curates, with how many times each was pulled. Needs Docker to run.', host: 'hub.docker.com' },
	{ id: 'github-topic-mcp', kind: 'mcp', label: 'GitHub, repositories tagged mcp-server', hint: 'Any public repository that tags itself as an MCP server, most starred first.', host: 'api.github.com' },
	{ id: 'open-vsx', kind: 'extension', label: 'Open VSX', hint: 'The editor’s extension gallery. Gives installs, ratings and whether the publisher is verified.', host: 'open-vsx.org', fixed: true },
	{ id: 'acp-registry', kind: 'agent', label: 'Agent Client Protocol registry', hint: 'The list of agents that speak ACP, with how each is installed.', host: 'cdn.agentclientprotocol.com', fixed: true },
];

export const isSourceOn = (off: readonly string[] | undefined, id: string): boolean => !(off ?? []).includes(id);
export const sourcesOfKind = (kind: AddonSourceKind): readonly AddonSource[] => ADDON_SOURCES.filter(s => s.kind === kind);
