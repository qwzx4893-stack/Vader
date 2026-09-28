/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { AgentRuntimeHealth, AgentRuntimeSelection, IAgentRuntimeRegistryService } from '../../common/agentRuntime/agentRuntimeTypes.js';

export * from '../../common/agentRuntime/agentRuntimeTypes.js';

// Vader addition, part of the Cline Main Agent Runtime integration (see
// docs/integrations/agent-runtime.md for the full design). Today this service reports the
// honest, current state of that integration in *this* build: the `legacy` runtime
// (chatThreadService.ts's existing, hardened tool-calling loop) is always initialized, and
// `cline` is genuinely `unavailable` - the `@cline/agents`/`@cline/shared` dependency this
// integration needs is declared in package.json but could not be installed in this
// environment (the sandbox's own dependency-install safety policy declined it as
// "Untrusted Code Integration" pending explicit user approval - see the doc above for the
// exact command). This is not a stub standing in for a finished ClineRuntimeAdapter: there
// is no ClineRuntimeAdapter class yet, deliberately, because writing one that imports a
// package this build cannot resolve would fail this project's own mandatory
// `tsc --noEmit` gate. Once the dependency is actually installed, ClineRuntimeAdapter (per
// the doc's design) replaces this file's hardcoded `unavailable` report with a real
// initialization probe.
class AgentRuntimeRegistryService extends Disposable implements IAgentRuntimeRegistryService {
	readonly _serviceBrand: undefined;

	private _selection: AgentRuntimeSelection;

	constructor() {
		super();
		this._selection = this._computeSelection();
	}

	private _computeSelection(): AgentRuntimeSelection {
		const checkedAt = new Date().toISOString();

		const legacyHealth: AgentRuntimeHealth = {
			kind: 'legacy',
			status: 'initialized',
			detail: 'Legacy runtime (the Void-derived, Vader-hardened chatThreadService tool-calling loop) is always available - it has no external dependency beyond what already ships.',
			checkedAt,
		};

		const clineHealth: AgentRuntimeHealth = {
			kind: 'cline',
			status: 'unavailable',
			detail: 'Cline Agent Runtime is not wired into this build yet. package.json declares @cline/agents@0.0.86 and @cline/shared@0.0.86 (verified real, Apache-2.0-licensed packages), but installing them was declined by this environment\'s dependency-install policy. Run `npm install @cline/agents@0.0.86 @cline/shared@0.0.86 --save-exact` (or grant the equivalent Bash permission) to enable it - see docs/integrations/agent-runtime.md for the full ClineRuntimeAdapter design that activates once the dependency resolves.',
			version: '0.0.86 (declared, not installed)',
			checkedAt,
		};

		return {
			active: 'legacy',
			reason: 'fallback',
			clineHealth,
			legacyHealth,
		};
	}

	getSelection(): AgentRuntimeSelection {
		return this._selection;
	}

	async refresh(): Promise<AgentRuntimeSelection> {
		this._selection = this._computeSelection();
		return this._selection;
	}
}

registerSingleton(IAgentRuntimeRegistryService, AgentRuntimeRegistryService, InstantiationType.Delayed);
