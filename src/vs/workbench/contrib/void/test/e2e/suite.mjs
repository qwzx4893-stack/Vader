#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// End-to-end suite for the REAL packaged Vader app, driven through its UI.
//   env: VADER_EXE (required), PW_CORE (playwright-core path), E2E_OUT, E2E_ONLY (regex over "group scenario"),
//        E2E_NATIVES=0 (skip scenarios that need native modules), E2E_ARGS (extra app args, e.g. --no-sandbox)

import fs from 'node:fs';
import { config, runGroup, summarize } from './harness.mjs';
import { coreScenarios } from './scenarios/core.mjs';
import { xmlScenarios, unknownModelScenarios } from './scenarios/xml.mjs';
import { terminalScenarios, browserScenarios, mcpScenarios, agentScenarios } from './scenarios/tools.mjs';
import { editorScenarios, autocompleteScenarios } from './scenarios/editor.mjs';
import { generalScenarios } from './scenarios/general.mjs';
import { realLlmScenarios } from './scenarios/realLlm.mjs';
import { runPersistenceGroup } from './scenarios/persistence.mjs';

if (!config.exe || !fs.existsSync(config.exe)) { console.error(`VADER_EXE missing or not found: ${config.exe}`); process.exit(2); }

await runGroup({ name: 'native-tools', model: 'gpt-4o', scenarios: [...coreScenarios, ...agentScenarios, ...browserScenarios, ...mcpScenarios, ...terminalScenarios, ...editorScenarios, ...generalScenarios] });
await runGroup({ name: 'xml-tools', model: 'qwen2.5-coder', scenarios: xmlScenarios });
await runGroup({ name: 'unknown-model', model: 'my-local-model', scenarios: unknownModelScenarios });
await runGroup({ name: 'autocomplete', model: 'codestral-latest', scenarios: autocompleteScenarios });
await runPersistenceGroup();

if (process.env.REAL_LLM_MODEL) {
	await runGroup({ name: 'real-llm', model: process.env.REAL_LLM_MODEL, baseURL: process.env.REAL_LLM_BASEURL || 'http://localhost:11434/v1', apiKey: 'ollama', scenarios: realLlmScenarios });
}

const ok = summarize();
process.exit(ok ? 0 : 1);
