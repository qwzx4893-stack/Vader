/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { IDiscoveryMainService } from './discoveryServiceTypes.js';

export * from './discoveryServiceTypes.js';

// Thin IPC proxy to electron-main/discoveryMainService.ts, following the same pattern as
// vaderUpdateService.ts: all real network calls happen in the main process.
class DiscoveryService implements IDiscoveryMainService {
	readonly _serviceBrand: undefined;
	private readonly _mainService: IDiscoveryMainService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this._mainService = ProxyChannel.toService<IDiscoveryMainService>(mainProcessService.getChannel('vader-channel-discovery'));
	}

	searchMcpRegistry: IDiscoveryMainService['searchMcpRegistry'] = (query) => this._mainService.searchMcpRegistry(query);
	queryMcpRegistry: IDiscoveryMainService['queryMcpRegistry'] = (query) => this._mainService.queryMcpRegistry(query);
	searchSkillNet: IDiscoveryMainService['searchSkillNet'] = (query) => this._mainService.searchSkillNet(query);
	listGithubSkills: IDiscoveryMainService['listGithubSkills'] = (repo) => this._mainService.listGithubSkills(repo);
	fetchSkillInstructions: IDiscoveryMainService['fetchSkillInstructions'] = (url) => this._mainService.fetchSkillInstructions(url);
	searchSkillsSh: IDiscoveryMainService['searchSkillsSh'] = (query) => this._mainService.searchSkillsSh(query);
	searchGithubTopic: IDiscoveryMainService['searchGithubTopic'] = (topic, query) => this._mainService.searchGithubTopic(topic, query);
	searchSmithery: IDiscoveryMainService['searchSmithery'] = (query) => this._mainService.searchSmithery(query);
	searchNpmMcp: IDiscoveryMainService['searchNpmMcp'] = (query) => this._mainService.searchNpmMcp(query);
	getRepoSignals: IDiscoveryMainService['getRepoSignals'] = (repo) => this._mainService.getRepoSignals(repo);
	searchSkillsMp: IDiscoveryMainService['searchSkillsMp'] = (query) => this._mainService.searchSkillsMp(query);
	searchSmitherySkills: IDiscoveryMainService['searchSmitherySkills'] = (query) => this._mainService.searchSmitherySkills(query);
	searchDockerMcp: IDiscoveryMainService['searchDockerMcp'] = (query) => this._mainService.searchDockerMcp(query);
	searchOpenVsx: IDiscoveryMainService['searchOpenVsx'] = (query, category, sortBy) => this._mainService.searchOpenVsx(query, category, sortBy);
	getNpmInfo: IDiscoveryMainService['getNpmInfo'] = (name) => this._mainService.getNpmInfo(name);
	resolveGithubSkill: IDiscoveryMainService['resolveGithubSkill'] = (repo, skillId) => this._mainService.resolveGithubSkill(repo, skillId);
}

registerSingleton(IDiscoveryMainService, DiscoveryService, InstantiationType.Delayed);
