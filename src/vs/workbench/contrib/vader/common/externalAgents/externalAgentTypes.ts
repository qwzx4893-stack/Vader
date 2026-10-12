/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

/** An agent the person added by hand: any program that speaks the Agent Client Protocol on stdin/stdout. Stored in Vader's settings. */
export type CustomAcpAgent = { readonly id: string, readonly name: string, readonly command: string, readonly args: readonly string[] }

export type ExternalAgentState =
	| 'ready'               // can be started now
	| 'not-installed'       // the program has to be downloaded first
	| 'needs-node'          // distributed as an npm package and Node.js is not installed
	| 'unsupported'         // no build for this computer
	| 'missing-command'     // a custom agent whose program was not found

export type ExternalAgentStatus = {
	readonly id: string
	readonly state: ExternalAgentState
	readonly detail?: string
	/** the version that is installed (or, for a program found on the PATH, nothing) */
	readonly installedVersion?: string
	/** a newer version is known (live registry) than the installed one */
	readonly latestVersion?: string
}

/** A setting the agent offers for its session (its model, its mode, how hard it thinks), as the Agent Client Protocol describes it. */
export type AgentConfigOption = {
	readonly id: string
	readonly name: string
	/** `model`, `mode`, `thought_level`, ... when the agent says what the option is */
	readonly category?: string
	readonly description?: string
	readonly type: 'select' | 'boolean'
	readonly value: string | boolean
	readonly choices?: readonly { readonly value: string, readonly name: string, readonly description?: string }[]
}

export type ProbeResult = {
	readonly ok: boolean
	readonly agentName?: string
	readonly agentVersion?: string
	readonly protocolVersion?: number
	readonly authMethods?: readonly { readonly id: string, readonly name: string }[]
	/** the agent can pick a conversation up again after a restart */
	readonly canResume?: boolean
	readonly ms?: number
	readonly error?: string
}

export type PermissionOption = { readonly id: string, readonly name: string, readonly kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string }

/** What an agent does during a turn, in the order it happens. `sessionKey` identifies the conversation (one per Vader chat thread). */
export type ExternalAgentEvent =
	| { readonly sessionKey: string, readonly type: 'text', readonly text: string }
	| { readonly sessionKey: string, readonly type: 'thought', readonly text: string }
	| { readonly sessionKey: string, readonly type: 'tool', readonly toolCallId: string, readonly title: string, readonly status: string, readonly kind?: string, readonly paths?: readonly string[] }
	| { readonly sessionKey: string, readonly type: 'plan', readonly entries: readonly { readonly content: string, readonly status: string }[] }
	| { readonly sessionKey: string, readonly type: 'permission', readonly requestId: string, readonly title: string, readonly options: readonly PermissionOption[] }
	/** the agent's own sign-in has to run in a terminal: open `command args` there, then ask again */
	| { readonly sessionKey: string, readonly type: 'auth-terminal', readonly methodName: string, readonly command: string, readonly args: readonly string[], readonly env: { readonly [k: string]: string } }
	| { readonly sessionKey: string, readonly type: 'status', readonly message: string }
	/** the agent's own id of this conversation, to be passed back as `resumeSessionId` after a restart; `resumed` false when an earlier id could not be picked up again */
	| { readonly sessionKey: string, readonly type: 'session', readonly sessionId: string, readonly resumed: boolean }
	/** the settings the agent offers for this conversation (sent when it starts and whenever something changes) */
	| { readonly sessionKey: string, readonly type: 'config', readonly options: readonly AgentConfigOption[] }

export type RunTurnParams = {
	readonly sessionKey: string
	readonly agentId: string
	readonly custom?: CustomAcpAgent
	/** absolute folder the agent works in */
	readonly cwd: string
	readonly text: string
	/** the `sessionId` of an earlier `session` event for this chat; used when the agent has to be started again */
	readonly resumeSessionId?: string
}

export interface IExternalAgentMainService {
	readonly _serviceBrand: undefined;

	readonly onEvent: Event<ExternalAgentEvent>;

	getStatuses(custom: readonly CustomAcpAgent[]): Promise<ExternalAgentStatus[]>;
	/** downloads an agent: a binary (checksum verified when the registry gives one) or an npm package installed into Vader's own folder; progress is reported as `status` events with the session key `install:<id>` */
	install(agentId: string): Promise<ExternalAgentStatus>;
	/** deletes what `install` put on disk */
	uninstall(agentId: string): Promise<ExternalAgentStatus>;
	/** starts the agent, does the protocol handshake and stops it again: proves the program works and reports what it is, without signing in or sending a prompt */
	probe(agentId: string, custom?: CustomAcpAgent): Promise<ProbeResult>;
	/** reads the live ACP registry for newer versions of the agents in the catalog; the snapshot built into Vader stays as the fallback */
	checkRegistry(): Promise<{ readonly updated: readonly string[] }>;

	/** one prompt; resolves with the stop reason (`end_turn`, `cancelled`, ...), rejects with a readable message */
	runTurn(params: RunTurnParams): Promise<{ readonly stopReason: string }>;
	/** the person's answer to a `permission` event; null = dismissed */
	answerPermission(requestId: string, optionId: string | null): Promise<void>;
	/** changes one of the settings the agent offers (its model, mode, ...) for a chat */
	setConfigOption(sessionKey: string, optionId: string, value: string | boolean): Promise<void>;
	cancel(sessionKey: string): Promise<void>;
	closeSession(sessionKey: string): Promise<void>;

	/** finds a program on the PATH, or in `candidateDirs` (relative to the home folder); null when it is not installed */
	resolveProgram(program: string, candidateDirs: readonly string[]): Promise<string | null>;
	hasNode(): Promise<boolean>;
}

export const IExternalAgentMainService = createDecorator<IExternalAgentMainService>('vaderExternalAgentMainService');
