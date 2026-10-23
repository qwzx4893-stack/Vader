// Independent inventory of required real-app scenario identities; dropping a group from suite.mjs cannot silently pass.
import { coreScenarios } from '../e2e/scenarios/core.mjs';
import { xmlScenarios, unknownModelScenarios } from '../e2e/scenarios/xml.mjs';
import { terminalScenarios, browserScenarios, mcpScenarios, agentScenarios } from '../e2e/scenarios/tools.mjs';
import { editorScenarios, autocompleteScenarios } from '../e2e/scenarios/editor.mjs';
import { generalScenarios } from '../e2e/scenarios/general.mjs';
import { providerScenarios } from '../e2e/scenarios/providers.mjs';
import { robustnessScenarios } from '../e2e/scenarios/robustness.mjs';
import { toleranceScenarios } from '../e2e/scenarios/tolerance.mjs';
import { noWorkspaceScenarios } from '../e2e/scenarios/noWorkspace.mjs';
import { realLlmScenarios } from '../e2e/scenarios/realLlm.mjs';
import { realLlmTaskScenarios, oracleTaskScenarios } from '../e2e/scenarios/realLlmTasks.mjs';
import { externalAgentScenarios } from '../e2e/scenarios/externalAgents.mjs';

const grouped = (name, scenarios) => scenarios.map(s => `${name}\n${s.name}`);
export function expectedScenarios(mode) {
	if (mode === 'smoke') {
		return ['app process stays alive and exposes CDP', 'workbench window target exists',
			'the expected modern window rendered with visible usable controls (not a blank/gray window)',
			'window title mentions Vader', 'the classic menubar does not overlap the modern window',
			'command palette opens (UI responds to input)', 'Vader commands are registered in the palette',
			'no renderer errors / failed requests after attach', 'no uncaught exceptions / missing modules in main & utility process logs'];
	}
	if (mode === 'live') { return grouped('real-llm', [...realLlmScenarios, ...realLlmTaskScenarios]); }
	if (mode !== 'scripted') { throw new Error('Unknown validation mode'); }
	return [
		...grouped('native-tools', [...coreScenarios, ...agentScenarios, ...browserScenarios, ...mcpScenarios, ...terminalScenarios, ...editorScenarios, ...generalScenarios, ...toleranceScenarios]),
		...grouped('xml-tools', xmlScenarios), ...grouped('unknown-model', unknownModelScenarios), ...grouped('providers', providerScenarios),
		...grouped('robustness', robustnessScenarios), ...grouped('external-agents', externalAgentScenarios), ...grouped('no-workspace', noWorkspaceScenarios),
		...grouped('agent-tasks', oracleTaskScenarios), ...grouped('autocomplete', autocompleteScenarios),
		'vader-window\nwindow: the Vader window opens first, shows conversations, All agents, search, Add-ons and Settings, and leads to the editor and back',
		'persistence\nrestart: provider, model and chat history survive closing and reopening the app',
		'persistence\nupgrade: data left by an earlier build is not inherited, and a chat closed mid-approval opens ready to use',
		'privacy\nprivacy: a started, configured and used app makes no request to any host the user did not configure',
	];
}
