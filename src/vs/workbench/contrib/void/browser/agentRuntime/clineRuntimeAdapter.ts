/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { AgentRuntime, type AgentRuntimeConfig } from '@cline/agents';
import type { AgentModel, AgentTool } from '@cline/shared';

// Vader addition, part of the Cline Main Agent Runtime integration (see
// docs/integrations/agent-runtime.md). `@cline/agents`/`@cline/shared` are real, installed
// dependencies (verified: registry.npmjs.org, an actual `npm install`, and resolving in this
// build's own node_modules) - version pinned exact in package.json. These two constants are
// also the compatibility contract the hand-transcribed `src/typings/cline-{agents,shared}.d.ts`
// shims were written against - keep in sync with `test/checkClineTypingsVersion.mjs`, which
// fails loudly if the installed packages ever drift from what's declared here.
export const CLINE_AGENTS_VERSION = '0.0.86';
export const CLINE_SHARED_VERSION = '0.0.86';

/**
 * Lightweight, synchronous-ish health probe: constructs a throwaway `AgentRuntime` with a
 * no-op model and no tools. `AgentRuntime`'s constructor only stores config (its real
 * initialization - provider/telemetry wiring - is lazy, triggered by `.run()`, per its own
 * `ensureInitialized`/`initialize` private methods), so this is a cheap, real check that the
 * installed package's constructor and type surface actually behave as documented in this
 * environment, without making any network/provider call. A thrown error here means a genuine
 * runtime incompatibility, surfaced as real, honest unhealthy status in
 * IAgentRuntimeRegistryService (see agentRuntimeRegistryService.ts) - Cline is Vader's only
 * Main Agent runtime, so this probe informs diagnostics, not a runtime-selection fallback.
 */
export function probeClineRuntime(): { ok: true } | { ok: false, reason: string } {
	try {
		const noopModel: AgentModel = { stream: async function* () { /* never called */ } };
		const probe = new AgentRuntime({ model: noopModel, tools: [], systemPrompt: '' });
		void probe; // constructed successfully; never run
		return { ok: true };
	} catch (e) {
		return { ok: false, reason: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
	}
}

/**
 * Constructs the real `AgentRuntime` that drives one Main Agent turn - see
 * chatThreadService.ts's `_runChatAgentImpl` for how this is actually used (event
 * subscription, thread-message recording, cancellation wiring). `systemPrompt`/`tools` are
 * still supplied for AgentRuntime's own bookkeeping/telemetry even though
 * `VaderAgentModel.stream()` doesn't read `request.systemPrompt`/`request.messages` for the
 * actual provider call (see vaderAgentModel.ts's doc comment for why) - AgentRuntime still
 * needs a real, non-empty `tools` array to know which tool names it's allowed to dispatch a
 * model's tool-call-delta events to.
 */
export function createClineAgentRuntime(opts: {
	model: AgentModel;
	tools: AgentTool<any, any>[];
	maxIterations?: number;
}): AgentRuntime {
	const config: AgentRuntimeConfig = {
		model: opts.model,
		tools: opts.tools,
		clientName: 'vader',
		maxIterations: opts.maxIterations ?? 50,
	};
	return new AgentRuntime(config);
}

export type { AgentRuntime };
