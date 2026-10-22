/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { equals } from '../../../../base/common/objects.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { MCPServerOfName, MCPConfigFileJSON, MCPConfigFileEntryJSON, MCPServer, MCPToolCallParams, RawMCPToolCall, MCPServerEventResponse, removeMCPToolNamePrefix } from './mcpServiceTypes.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { InternalToolInfo } from './prompt/prompts.js';
import { IVaderSettingsService } from './vaderSettingsService.js';
import { MCPUserStateOfName } from './vaderSettingsTypes.js';
import { allowTools, keepToolsOff, reviewTools, toolCallRefusal } from './mcpToolReview.js';


type MCPServiceState = {
	mcpServerOfName: MCPServerOfName,
	error: string | undefined, // global parsing error
}

export interface IMCPService {
	readonly _serviceBrand: undefined;
	revealMCPConfigFile(): Promise<void>;
	toggleServerIsOn(serverName: string, isOn: boolean): Promise<void>;

	/**
	 * Vader addition: programmatic add/update of one server entry in mcp.json, so the
	 * Unified Capability Marketplace's "Configure" action for an MCP Registry result doesn't
	 * require the user to hand-edit the config file for ordinary supported installs - see
	 * docs/integrations/marketplace.md. Writing the file is enough: the existing file watcher
	 * (`_addMCPConfigFileWatcher`) picks up the change and runs the real
	 * add-server/health-check flow exactly as if the user had edited it by hand, so this adds
	 * no second server-lifecycle path.
	 */
	addOrUpdateServer(name: string, entry: MCPConfigFileEntryJSON): Promise<void>;
	removeServer(name: string): Promise<void>;

	readonly state: MCPServiceState; // NOT persisted
	onDidChangeState: Event<void>;

	getMCPTools(): InternalToolInfo[] | undefined;
	/** the tools a server added since the person set it up, waiting for an answer ("A tool changed", board S07) */
	pendingToolsOf(serverName: string): string[];
	allowTools(serverName: string, names: string[]): Promise<void>;
	keepToolsOff(serverName: string, names: string[]): Promise<void>;
	callMCPTool(toolData: MCPToolCallParams): Promise<{ result: RawMCPToolCall }>;
	stringifyResult(result: RawMCPToolCall): string
}

export const IMCPService = createDecorator<IMCPService>('mcpConfigService');



const MCP_CONFIG_FILE_NAME = 'mcp.json';
const MCP_CONFIG_SAMPLE = { mcpServers: {} }
const MCP_CONFIG_SAMPLE_STRING = JSON.stringify(MCP_CONFIG_SAMPLE, null, 2);


// export interface MCPCallToolOfToolName {
// 	[toolName: string]: (params: any) => Promise<{
// 		result: any | Promise<any>,
// 		interruptTool?: () => void
// 	}>;
// }


class MCPService extends Disposable implements IMCPService {
	_serviceBrand: undefined;


	private readonly channel: IChannel // MCPChannel
	private _lastConfig: MCPConfigFileJSON = { mcpServers: {} }
	private _refreshQueue: Promise<void> = Promise.resolve()

	// list of MCP servers pulled from mcpChannel
	state: MCPServiceState = {
		mcpServerOfName: {},
		error: undefined,
	}

	// Emitters for server events
	private readonly _onDidChangeState = new Emitter<void>();
	public readonly onDidChangeState = this._onDidChangeState.event;

	// private readonly _onLoadingServersChange = new Emitter<MCPServerEventLoadingParam>();
	// public readonly onLoadingServersChange = this._onLoadingServersChange.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IProductService private readonly productService: IProductService,
		@IEditorService private readonly editorService: IEditorService,
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IVaderSettingsService private readonly vaderSettingsService: IVaderSettingsService,
	) {
		super();
		this.channel = this.mainProcessService.getChannel('vader-channel-mcp')


		const onEvent = (e: MCPServerEventResponse) => {
			// console.log('GOT EVENT', e)
			this._setMCPServerState(e.response.name, e.response.newServer)
		}
		this._register((this.channel.listen('onAdd_server') satisfies Event<MCPServerEventResponse>)(onEvent));
		this._register((this.channel.listen('onUpdate_server') satisfies Event<MCPServerEventResponse>)(onEvent));
		this._register((this.channel.listen('onDelete_server') satisfies Event<MCPServerEventResponse>)(onEvent));

		this._initialize();
	}


	private async _initialize() {
		try {
			await this.vaderSettingsService.waitForInitState;

			// Create .mcpConfig if it doesn't exist
			const mcpConfigUri = await this._getMCPConfigFilePath();
			const fileExists = await this._configFileExists(mcpConfigUri);
			if (!fileExists) {
				await this._createMCPConfigFile(mcpConfigUri);
				console.log('MCP Config file created:', mcpConfigUri.toString());
			}
			await this._addMCPConfigFileWatcher();
			await this._refreshMCPServers();
		} catch (error) {
			console.error('Error initializing MCPService:', error);
		}
	}

	private readonly _setMCPServerState = async (serverName: string, newServer: MCPServer | undefined) => {
		if (newServer === undefined) {
			// Remove the server from the state
			const { [serverName]: removed, ...remainingServers } = this.state.mcpServerOfName;
			this.state = {
				...this.state,
				mcpServerOfName: remainingServers
			}
		} else {
			// Add or update the server
			this.state = {
				...this.state,
				mcpServerOfName: {
					...this.state.mcpServerOfName,
					[serverName]: newServer
				}
			}
			// the first time a server lists its tools, those are the tools the person is adding it for: they are recorded as allowed, and later additions wait for an answer
			if (newServer.status === 'success' && newServer.tools) void this._recordFirstLook(serverName, newServer.tools.map(t => removeMCPToolNamePrefix(t.name)))
		}
		this._onDidChangeState.fire();
	}

	private async _recordFirstLook(serverName: string, tools: string[]) {
		try {
			await this.vaderSettingsService.waitForInitState
			const us = this.vaderSettingsService.state.mcpUserStateOfName[serverName]
			if (!us || us.approvedTools !== undefined) return
			await this.vaderSettingsService.setMCPServerState(serverName, { ...us, approvedTools: tools })
		} catch { /* the settings could not be written: the server stays unreviewed and offers all its tools, as before */ }
	}

	public pendingToolsOf(serverName: string): string[] {
		// the names are the tools' own: the service puts a random prefix on each listing, so a prefixed name would not be the same tool tomorrow
		const tools = this.state.mcpServerOfName[serverName]?.tools?.map(t => removeMCPToolNamePrefix(t.name)) ?? []
		return reviewTools(this.vaderSettingsService.state.mcpUserStateOfName[serverName], tools).pending
	}

	public async allowTools(serverName: string, names: string[]): Promise<void> {
		const us = this.vaderSettingsService.state.mcpUserStateOfName[serverName] ?? { isOn: true }
		await this.vaderSettingsService.setMCPServerState(serverName, { ...us, ...allowTools(us, names) } as typeof us & { approvedTools: string[], offTools: string[] })
		this._onDidChangeState.fire()
	}

	public async keepToolsOff(serverName: string, names: string[]): Promise<void> {
		const us = this.vaderSettingsService.state.mcpUserStateOfName[serverName] ?? { isOn: true }
		await this.vaderSettingsService.setMCPServerState(serverName, { ...us, ...keepToolsOff(us, names) } as typeof us & { approvedTools: string[], offTools: string[] })
		this._onDidChangeState.fire()
	}

	private readonly _setHasError = async (errMsg: string | undefined) => {
		this.state = {
			...this.state,
			error: errMsg,
		}
		this._onDidChangeState.fire();
	}

	// Create the file/directory if it doesn't exist
	private async _createMCPConfigFile(mcpConfigUri: URI): Promise<void> {
		await this.fileService.createFile(mcpConfigUri.with({ path: mcpConfigUri.path }));
		const buffer = VSBuffer.fromString(MCP_CONFIG_SAMPLE_STRING);
		await this.fileService.writeFile(mcpConfigUri, buffer);
	}


	private async _addMCPConfigFileWatcher(): Promise<void> {
		const mcpConfigUri = await this._getMCPConfigFilePath();
		this._register(
			this.fileService.watch(mcpConfigUri)
		)

		this._register(this.fileService.onDidFilesChange(async e => {
			if (!e.contains(mcpConfigUri)) return
			await this._refreshMCPServers();
		}));
	}

	// Client-side functions

	public async revealMCPConfigFile(): Promise<void> {
		try {
			const mcpConfigUri = await this._getMCPConfigFilePath();
			await this.editorService.openEditor({
				resource: mcpConfigUri,
				options: {
					pinned: true,
					revealIfOpened: true,
				}
			});
		} catch (error) {
			console.error('Error opening MCP config file:', error);
		}
	}

	public async addOrUpdateServer(name: string, entry: MCPConfigFileEntryJSON): Promise<void> {
		const mcpConfigUri = await this._getMCPConfigFilePath();
		const existing = await this._parseMCPConfigFile() ?? { mcpServers: {} };
		const newConfig: MCPConfigFileJSON = { ...existing, mcpServers: { ...existing.mcpServers, [name]: entry } };
		await this.fileService.writeFile(mcpConfigUri, VSBuffer.fromString(JSON.stringify(newConfig, null, 2)));
		// the file watcher (_addMCPConfigFileWatcher) picks this up and runs the real
		// add-server/health-check flow - no second path duplicating that logic here.
	}

	public async removeServer(name: string): Promise<void> {
		const mcpConfigUri = await this._getMCPConfigFilePath();
		const existing = await this._parseMCPConfigFile();
		if (!existing || !(name in existing.mcpServers)) return;
		const { [name]: _removed, ...remaining } = existing.mcpServers;
		const newConfig: MCPConfigFileJSON = { ...existing, mcpServers: remaining };
		await this.fileService.writeFile(mcpConfigUri, VSBuffer.fromString(JSON.stringify(newConfig, null, 2)));
	}

	public getMCPTools(): InternalToolInfo[] | undefined {
		const allTools: InternalToolInfo[] = []
		for (const serverName in this.state.mcpServerOfName) {
			const server = this.state.mcpServerOfName[serverName];
			const allowed = new Set(reviewTools(this.vaderSettingsService.state.mcpUserStateOfName[serverName], server.tools?.map(t => removeMCPToolNamePrefix(t.name)) ?? []).allowed)
			server.tools?.forEach(tool => {
				if (!allowed.has(removeMCPToolNamePrefix(tool.name))) return // new and not answered yet, or kept off: the agent is not told it exists
				allTools.push({
					description: tool.description || '',
					params: this._transformInputSchemaToParams(tool.inputSchema),
					name: tool.name,
					mcpServerName: serverName,
				})
			})
		}
		if (allTools.length === 0) return undefined
		return allTools
	}

	private _transformInputSchemaToParams(inputSchema?: Record<string, any>): { [paramName: string]: { description: string } } {

		// Check if inputSchema is valid
		if (!inputSchema || !inputSchema.properties) return {};

		const params: { [paramName: string]: { description: string } } = {};
		Object.keys(inputSchema.properties).forEach(paramName => {
			const propertyValues = inputSchema.properties[paramName];

			// Check if propertyValues is not an object
			if (typeof propertyValues !== 'object') {
				console.warn(`Invalid property value for ${paramName}: expected object, got ${typeof propertyValues}`);
				return; // in forEach the return is equivalent to continue
			}

			// Add the parameter to the params object
			params[paramName] = {
				description: JSON.stringify(propertyValues.description || '', null, 2) || '',
			}
		});
		return params;
	}

	private async _getMCPConfigFilePath(): Promise<URI> {
		const appName = this.productService.dataFolderName
		const userHome = await this.pathService.userHome();
		const uri = URI.joinPath(userHome, appName, MCP_CONFIG_FILE_NAME)
		return uri
	}

	private async _configFileExists(mcpConfigUri: URI): Promise<boolean> {
		try {
			await this.fileService.stat(mcpConfigUri);
			return true;
		} catch (error) {
			return false;
		}
	}


	private async _parseMCPConfigFile(): Promise<MCPConfigFileJSON | null> {
		const mcpConfigUri = await this._getMCPConfigFilePath();
		try {
			const fileContent = await this.fileService.readFile(mcpConfigUri);
			const contentString = fileContent.value.toString();
			const configFileJson = JSON.parse(contentString);
			if (!configFileJson.mcpServers) {
				throw new Error('Missing mcpServers property');
			}
			return configFileJson as MCPConfigFileJSON;
		} catch (error) {
			const fullError = `Error parsing MCP config file: ${error}`;
			this._setHasError(fullError)
			return null;
		}
	}


	// Handle server state changes
	private _refreshMCPServers(): Promise<void> {
		const refresh = this._refreshQueue.then(() => this._applyMCPConfig())
		this._refreshQueue = refresh.catch(() => { /* the caller receives the error; a later file change may recover */ })
		return refresh
	}

	private async _applyMCPConfig(): Promise<void> {

		this._setHasError(undefined)

		const newConfigFileJSON = await this._parseMCPConfigFile();
		if (!newConfigFileJSON) { console.log(`Not setting state: MCP config file not found`); return }
		if (!newConfigFileJSON?.mcpServers) { console.log(`Not setting state: MCP config file did not have an 'mcpServers' field`); return }


		const oldConfigFileNames = Object.keys(this._lastConfig.mcpServers)
		const newConfigFileNames = Object.keys(newConfigFileJSON.mcpServers)

		const addedServerNames = newConfigFileNames.filter(serverName => !oldConfigFileNames.includes(serverName)); // in new and not in old
		const removedServerNames = oldConfigFileNames.filter(serverName => !newConfigFileNames.includes(serverName)); // in old and not in new

		// set isOn to any new servers in the config
		const addedUserStateOfName: MCPUserStateOfName = {}
		for (const name of addedServerNames) {
			if (!this.vaderSettingsService.state.mcpUserStateOfName[name]) { addedUserStateOfName[name] = { isOn: true } }
		}
		if (Object.keys(addedUserStateOfName).length) await this.vaderSettingsService.addMCPUserStateOfNames(addedUserStateOfName);

		// delete isOn for any servers that no longer show up in the config
		if (removedServerNames.length) await this.vaderSettingsService.removeMCPUserStateOfNames(removedServerNames);

		const updatedServerNames = newConfigFileNames.filter(name => oldConfigFileNames.includes(name) && !equals(this._lastConfig.mcpServers[name], newConfigFileJSON.mcpServers[name]))
		if (addedServerNames.length + removedServerNames.length + updatedServerNames.length === 0) return

		// An unchanged save must not restart programs or discard the review state.
		for (const serverName of [...addedServerNames, ...updatedServerNames]) {
			this._setMCPServerState(serverName, { status: 'loading', tools: [] })
		}

		await this.channel.call('refreshMCPServers', {
			mcpConfigFileJSON: newConfigFileJSON,
			addedServerNames,
			removedServerNames,
			updatedServerNames,
			userStateOfName: this.vaderSettingsService.state.mcpUserStateOfName,
		})
		this._lastConfig = newConfigFileJSON
	}

	stringifyResult(result: RawMCPToolCall): string {
		let toolResultStr: string
		if (result.event === 'text') {
			toolResultStr = result.text
		} else if (result.event === 'image') {
			toolResultStr = `[Image: ${result.image.mimeType}]`
		} else if (result.event === 'audio') {
			toolResultStr = `[Audio content]`
		} else if (result.event === 'resource') {
			toolResultStr = `[Resource content]`
		} else {
			toolResultStr = JSON.stringify(result)
		}
		return toolResultStr
	}

	// toggle MCP server and update isOn in void settings
	public async toggleServerIsOn(serverName: string, isOn: boolean): Promise<void> {
		this._setMCPServerState(serverName, { status: 'loading', tools: [] })

		await this.vaderSettingsService.setMCPServerState(serverName, { ...this.vaderSettingsService.state.mcpUserStateOfName[serverName], isOn });
		await this.channel.call('toggleMCPServer', { serverName, isOn })
	}


	public async callMCPTool(toolData: MCPToolCallParams): Promise<{ result: RawMCPToolCall }> {
		// the agent is not offered a tool that is new or kept off, but a call that names one anyway is refused here too
		const refusal = toolCallRefusal(this.vaderSettingsService.state.mcpUserStateOfName[toolData.serverName], toolData.serverName, removeMCPToolNamePrefix(toolData.toolName))
		if (refusal) throw new Error(refusal)
		const result = await this.channel.call<RawMCPToolCall>('callTool', toolData);
		if (result.event === 'error') {
			throw new Error(`Error: ${result.text}`)
		}
		return { result };
	}

	// public getMCPToolFns(): MCPToolResultType {
	// 	const tools = this.getMCPTools();
	// 	const toolFns: MCPToolResultType = {};

	// 	tools.forEach((tool) => {
	// 		const name = tool.name;
	// 		// Define the tool call function
	// 		const toolFn = async (params: {
	// 			serverName: string,
	// 			toolName: string,
	// 			args: any
	// 		}) => {
	// 			const { serverName, toolName, args } = params;
	// 			const response = await this.callMCPTool({
	// 				serverName,
	// 				toolName,
	// 				params: args,
	// 			});
	// 			return { result: response }
	// 		};
	// 		toolFns[name] = toolFn;
	// 	});

	// 	return toolFns
	// }
}

registerSingleton(IMCPService, MCPService, InstantiationType.Eager);
