/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import type { AgentTool } from '@cline/shared';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { InternalToolInfo, availableTools } from '../../common/prompt/prompts.js';
import { ChatMode } from '../../common/voidSettingsTypes.js';
import { RawToolParamsObj } from '../../common/sendLLMMessageTypes.js';
import { ToolName } from '../../common/toolsServiceTypes.js';

/**
 * Vader addition, part of the Cline Main Agent Runtime integration (see
 * docs/integrations/agent-runtime.md). Builds `@cline/agents`' `AgentTool[]` from the exact
 * same `builtinTools`/MCP-tool registry and `availableTools(chatMode, mcpTools)` filter the
 * legacy loop's prompt already uses - no second tool-registration surface, and a thread in
 * Gather/Plan/Verification/Research mode never even has a mutating tool *advertised* to
 * Cline, on top of `_runToolCallInline`'s hard execution-level enforcement of the same rule
 * (defense in depth, matching the legacy path's own two-layer design).
 *
 * Every tool's `execute()` calls straight into `runToolCallInline` - the Cline-path
 * equivalent of `_runToolCall` that runs the exact same Policy Engine/agent-scope/read-only-
 * mode gate (see chatThreadService.ts's `_evaluateToolCallGate`). There is no path from a
 * Cline tool call to actual execution that bypasses this gate.
 *
 * Every param is typed `'string'` in the generated JSON schema, matching this codebase's own
 * existing native-tool-calling schema (see `electron-main/llmMessage/sendLLMMessage.impl.ts`'s
 * `toAnthropicTool`) - real validation happens afterward in `validateParams`, exactly as it
 * does for the legacy loop.
 */
export function buildClineTools(opts: {
	chatMode: ChatMode;
	mcpTools: InternalToolInfo[] | undefined;
	computeMCPServerOfToolName: (toolName: string) => string | undefined;
	runToolCallInline: (toolName: ToolName, toolId: string, mcpServerName: string | undefined, unvalidatedToolParams: RawToolParamsObj) => Promise<{ resultStr: string, isError: boolean }>;
}): AgentTool<RawToolParamsObj, string>[] {

	const infos = availableTools(opts.chatMode, opts.mcpTools) ?? [];

	return infos.map((info): AgentTool<RawToolParamsObj, string> => {
		const properties: Record<string, { type: 'string', description: string }> = {};
		for (const paramName in info.params) {
			properties[paramName] = { type: 'string', description: info.params[paramName].description };
		}

		return {
			name: info.name,
			description: info.description,
			inputSchema: { type: 'object', properties },
			execute: async (input: RawToolParamsObj, context) => {
				const toolName = info.name as ToolName;
				const mcpServerName = opts.computeMCPServerOfToolName(info.name);
				const toolId = context.toolCallId ?? generateUuid();
				const { resultStr } = await opts.runToolCallInline(toolName, toolId, mcpServerName, input ?? {});
				return resultStr;
			},
		};
	});
}
