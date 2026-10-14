/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

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
	readonly entries: readonly GithubSkillEntry[];
	/** set when the repository could not be read (not found, rate limited, offline); the entries are then empty */
	readonly error?: string;
};

export interface IDiscoveryMainService {
	readonly _serviceBrand: undefined;
	searchMcpRegistry(query: string): Promise<McpRegistrySearchResult[]>;
	searchSkillNet(query: string): Promise<SkillNetSearchResult[]>;
	/** the skills in a GitHub repository ("owner/repo" or its https://github.com address); read from GitHub's public API, nothing about the workspace is sent */
	listGithubSkills(repo: string): Promise<GithubSkillListing>;
	/** fetches a skill's primary instructions file (SKILL.md, README.md, ...) as plain text, for use as an instructions layer */
	fetchSkillInstructions(repositoryUrl: string): Promise<string | null>;
}

export const IDiscoveryMainService = createDecorator<IDiscoveryMainService>('VaderDiscoveryMainService');
