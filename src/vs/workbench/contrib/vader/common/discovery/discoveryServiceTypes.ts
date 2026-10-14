/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import type { DockerMcpResult, NpmMcpResult, OpenVsxResult, RepoSignals, SkillsMpResult, SkillsShResult, SmitherySkillResult, SmitheryResult } from './feedParsers.js';
export type { DockerMcpResult, NpmMcpResult, OpenVsxResult, RepoSignals, SkillsMpResult, SkillsShResult, SmitherySkillResult, SmitheryResult };

// Vader's external discovery surfaces: the official MCP Registry (a live capability
// source) and SkillNet (a live skill source, see skills/skillProviderTypes.ts for the
// provider abstraction this feeds). Both are plain, unauthenticated HTTP GET searches -
// no source code is ever uploaded to discover something, per the mission's privacy
// requirement ("do not upload project source merely to discover Skills").

// Vader addition: one real package entry from the official MCP Registry's own schema
// (verified directly against a live response from registry.modelcontextprotocol.io in this
// session) - real fields only, nothing invented, used to build an actual runnable command for
// "one-click configure" rather than just linking the user to the package.
export type McpRegistryPackage = {
	readonly registryType: string; // e.g. 'npm', 'pypi', 'oci'
	readonly identifier: string; // package name
	readonly version: string;
	readonly runtimeHint?: string; // e.g. 'npx', 'uvx', 'docker'
	readonly environmentVariables?: readonly { readonly name: string; readonly description?: string; readonly isRequired?: boolean; readonly isSecret?: boolean; readonly default?: string }[];
};

export type McpRegistrySearchResult = {
	readonly name: string;
	readonly description: string;
	readonly version: string;
	/** a directly usable remote endpoint, if the server publishes one (streamable-http/sse) */
	readonly remoteUrl?: string;
	/** true if this server only ships as a local package (npm/pip/docker/...) requiring manual setup */
	readonly localOnly: boolean;
	readonly repositoryUrl?: string;
	/** the registry marked it deprecated or deleted */
	readonly deprecated?: boolean;
	readonly publishedAt?: string;
	readonly updatedAt?: string;
	/** real package metadata for localOnly servers, straight from the registry response - lets a real command be constructed instead of only linking the user to the package */
	readonly packages?: readonly McpRegistryPackage[];
};

export type SkillNetSearchResult = {
	readonly name: string;
	readonly description: string;
	readonly repositoryUrl: string;
	readonly stars: number;
	readonly category?: string;
};

/** one skill found in a GitHub repository that holds skills (see githubSkillSources.ts); the SKILL.md text comes with it so a store can score and install it without a second download */
export type GithubSkillEntry = {
	readonly name: string;
	readonly description: string;
	/** the page of the skill's folder, in the shape fetchSkillInstructions understands */
	readonly repositoryUrl: string;
	readonly owner: string;
	readonly repo: string;
	/** every file of the skill's folder added up */
	readonly sizeBytes: number;
	/** the SKILL.md text; empty when it could not be fetched */
	readonly instructions: string;
};

export type GithubSkillListing = {
	readonly repo: string;
	readonly stars: number;
	/** what GitHub says about the repository itself (forks, last change, licence, archived), from the same call that gave the stars */
	readonly signals?: RepoSignals;
	readonly entries: readonly GithubSkillEntry[];
	/** set when the repository could not be read (not found, rate limited, offline); the entries are then empty */
	readonly error?: string;
};

export interface IDiscoveryMainService {
	readonly _serviceBrand: undefined;
	/** the registry's answer, or [] when it cannot be reached (what the agent's own tool wants: advisory, never an error) */
	searchMcpRegistry(query: string): Promise<McpRegistrySearchResult[]>;
	/** the same search, but it throws when the registry cannot be reached, so Add-ons can say that this one source did not answer while the others did */
	queryMcpRegistry(query: string): Promise<McpRegistrySearchResult[]>;
	searchSkillNet(query: string): Promise<SkillNetSearchResult[]>;
	/** the skills in a GitHub repository ("owner/repo" or its https://github.com address); read from GitHub's public API, nothing about the workspace is sent */
	listGithubSkills(repo: string): Promise<GithubSkillListing>;
	/** skills.sh: a live index of skills with how many times each was installed. Throws when the source cannot be reached, so a store can say so. */
	searchSkillsSh(query: string): Promise<SkillsShResult[]>;
	/** repositories on GitHub tagged with a topic ("agent-skills", "mcp-server"), most starred first, each with its own live signals; the query narrows by words */
	searchGithubTopic(topic: string, query: string): Promise<RepoSignals[]>;
	/** the Smithery registry of MCP servers (public listing, no key); an empty query lists the front page */
	searchSmithery(query: string): Promise<SmitheryResult[]>;
	/** npm packages that call themselves MCP servers, with how many times each was downloaded last week */
	searchNpmMcp(query: string): Promise<NpmMcpResult[]>;
	/** what npm says about the latest version of a package: whether it runs a script when installed, and whether it is deprecated */
	getNpmInfo(name: string): Promise<{ readonly installScripts: boolean; readonly deprecated: boolean; readonly license?: string } | undefined>;
	/** skillsmp.com: skills indexed from GitHub with the repository's stars and when each last changed; needs a word to search for */
	searchSkillsMp(query: string): Promise<SkillsMpResult[]>;
	/** Smithery's registry of skills, which also says which section each belongs to; an empty query lists the front page */
	searchSmitherySkills(query: string): Promise<SmitherySkillResult[]>;
	/** the MCP server images Docker curates (hub.docker.com, namespace "mcp"), most pulled first; the words narrow what is returned */
	searchDockerMcp(query: string): Promise<DockerMcpResult[]>;
	/** Open VSX, directly: optionally in one of its own categories, sorted by downloads, rating or recency; the editor still installs by id */
	searchOpenVsx(query: string, category: string | undefined, sortBy: 'downloadCount' | 'rating' | 'timestamp' | 'relevance'): Promise<OpenVsxResult[]>;
	/** the live signals of one GitHub repository ("owner/repo" or its address); cached for six hours */
	getRepoSignals(repo: string): Promise<RepoSignals | undefined>;
	/** one skill of a GitHub repository by its folder or frontmatter name; reads the file list once and only that skill's SKILL.md, not every skill of the repository */
	resolveGithubSkill(repo: string, skillId: string): Promise<GithubSkillEntry | undefined>;
	/** fetches a skill's primary instructions file (SKILL.md, README.md, ...) as plain text, for use as an instructions layer */
	fetchSkillInstructions(repositoryUrl: string): Promise<string | null>;
}

export const IDiscoveryMainService = createDecorator<IDiscoveryMainService>('VaderDiscoveryMainService');
