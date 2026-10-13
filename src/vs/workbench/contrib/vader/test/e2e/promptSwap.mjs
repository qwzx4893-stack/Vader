/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// TEST-ONLY. Lets an installed Vader be measured with the agent instructions of the SOURCE tree, without rebuilding the app: the proxy (llmProxy.mjs) passes every
// chat request through `swap`, which puts the source's agent behaviour block and tool descriptions in place of the ones the installed app sent. The same binary, the
// same model and the same exercises then differ only in the instructions: an A/B of the instructions alone.
//
// What is replaced: in the system message, everything from the first "<role>" (or, for an installed app that has none, from "Important notes:") up to the file overview;
// in the tool list, the description of each tool and of each parameter whose text differs from the source's. Nothing else is touched.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadPromptSwap(repoRoot) {
	const require = createRequire(path.join(repoRoot, 'package.json'));
	const esbuild = require('esbuild');
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-swap-'));
	await esbuild.build({
		entryPoints: [path.join(repoRoot, 'src/vs/workbench/contrib/vader/common/prompt/prompts.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'p.mjs'), logLevel: 'silent',
		tsconfigRaw: JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } }),
	});
	const { chat_systemMessage, builtinTools } = await import(pathToFileURL(path.join(tmp, 'p.mjs')).href);
	fs.rmSync(tmp, { recursive: true, force: true });

	// the source's version of the block that sits between the system information and the file overview, built once with placeholder inputs
	const probe = chat_systemMessage({ workspaceFolders: ['/w'], openedURIs: [], activeURI: undefined, persistentTerminalIDs: [], directoryStr: '', mcpTools: undefined, includeXMLToolDefinitions: false, chatMode: 'agent' });
	const from = probe.indexOf('<role>');
	const to = probe.indexOf("Here is an overview of the user's file system:");
	if (from < 0 || to < 0) { throw new Error('promptSwap: the source prompt has no <role> block or no file overview'); }
	const newBlock = probe.slice(from, to).trimEnd();

	const swapSystem = (text) => {
		const start = text.includes('<role>') ? text.indexOf('<role>') : text.indexOf('Important notes:');
		const end = text.indexOf("Here is an overview of the user's file system:");
		if (start < 0 || end < 0 || end < start) { return text; }
		return text.slice(0, start) + newBlock + '\n\n\n' + text.slice(end);
	};

	const swapTools = (tools) => {
		let changed = 0;
		for (const t of tools ?? []) {
			const fn = t.function ?? t; const src = builtinTools[fn.name];
			if (!src) { continue; }
			if (src.description !== fn.description) { fn.description = src.description; changed++; }
			const props = (fn.parameters ?? fn.input_schema)?.properties ?? {};
			for (const [k, v] of Object.entries(src.params ?? {})) { if (props[k] && props[k].description !== v.description) { props[k].description = v.description; changed++; } }
		}
		return changed;
	};

	/** Rewrites a chat-completions request body in place; returns how many pieces changed (0 = nothing to swap, for example a request that is not an agent turn). */
	const swap = (body) => {
		let n = 0;
		for (const m of body.messages ?? []) {
			if ((m.role === 'system' || m.role === 'developer') && typeof m.content === 'string') { const t = swapSystem(m.content); if (t !== m.content) { m.content = t; n++; } }
			else if ((m.role === 'system' || m.role === 'developer') && Array.isArray(m.content)) { for (const p of m.content) { if (typeof p?.text === 'string') { const t = swapSystem(p.text); if (t !== p.text) { p.text = t; n++; } } } }
		}
		n += swapTools(body.tools);
		return n;
	};
	return { swap, newBlock };
}
