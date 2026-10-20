#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A folder of three pages to try Vader's screens in a browser, with nothing in them that a clean install would not have (no chats, no keys, no usage, no project):
//   index.html       the window: the sidebar, the chat, All agents, Add-ons (the lists are saved answers of the real sources); Settings opens settings.html
//   settings.html    Settings, every page, including Language; "Back to the app" returns to index.html
//   welcome.html     the first run
// They are the real screens (react/src2) with stand-ins for the services behind them, so nothing is saved, no model answers, and nothing is sent anywhere. The pages open from
// the file system, no server needed.
// Run: node src/vs/workbench/contrib/vader/test/uiPreview.mjs <folder>        (needs `npm run buildreact`)

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const src2 = path.join(here, '../browser/react/src2');
if (!fs.existsSync(path.join(src2, 'vader-shell-tsx/Shell.tsx'))) { console.log('Run `npm run buildreact` first (react/src2 is built from react/src).'); process.exit(1); }
const out = path.resolve(process.argv[2] ?? path.join(here, '../../../../../../ui-preview'));
fs.mkdirSync(out, { recursive: true });

const stubs = {
	'workbench/common/contributions.js': 'export const registerWorkbenchContribution2 = () => {}; export const WorkbenchPhase = { BlockRestore: 1, Eventually: 4 };',
	'common/skills/skillService.js': 'const d = () => () => {}; export const ISkillService = d;',
	'common/mcpService.js': 'const d = () => () => {}; export const IMCPService = d;',
	'common/vaderSettingsService.js': 'const d = () => () => {}; export const IVaderSettingsService = d;',
	'platform/quickinput/common/quickInput.js': 'const d = () => () => {}; export const IQuickInputService = d;',
	'platform/opener/common/opener.js': 'const d = () => () => {}; export const IOpenerService = d;',
	'platform/commands/common/commands.js': 'const d = () => () => {}; export const ICommandService = d;',
	'contrib/extensions/common/extensions.js': 'const d = () => () => {}; export const IExtensionsWorkbenchService = d;',
	'services/extensionManagement/common/extensionManagement.js': 'const d = () => () => {}; export const IWorkbenchExtensionEnablementService = d; export const EnablementState = { EnabledGlobally: 1, DisabledGlobally: 2 };',
	'platform/extensionManagement/common/extensionManagement.js': 'export const SortBy = { InstallCount: "InstallCount" };',
	'common/externalAgents/externalAgentTypes.js': 'const d = () => () => {}; export const IExternalAgentMainService = d;',
	'common/marketplace/marketplaceTypes.js': 'const d = () => () => {}; export const IUnifiedMarketplaceService = d;',
	'common/discovery/discoveryServiceTypes.js': 'const d = () => () => {}; export const IDiscoveryMainService = d;',
	'platform/instantiation/common/extensions.js': 'export const registerSingleton = (id, ctor) => { if (/Unified/.test(ctor && ctor.name)) globalThis.__UnifiedCtor = ctor; }; export const InstantiationType = { Delayed: 1, Eager: 0 };',
};
const stubbed = [/\/markdown\/ChatMarkdownRender\.js$/, /\/vader-settings-tsx\/ExternalAgents\.js$/, /\/sidebar-tsx\/SidebarThreadSelector\.js$/, /\/util\/BlockCodeExport\.js$/];
const fixtures = (f) => path.join(here, 'fixtures', f);
const norm = (p) => p.replace(/\\/g, '/');

const pages = [
	{
		name: 'index', entry: 'windowHarness.tsx',
		resolve: (full, dir) => {
			if (/\/util\/services\.js$/.test(full) || /fixtures\/(shell|chat)HarnessServices(\.js|\.ts)?$/.test(full)) return { path: fixtures('windowHarnessServices.ts') };
			if (stubbed.some(r => r.test(full)) && !/fixtures\//.test(norm(dir))) return { path: fixtures('chatStubs.tsx') };
			if (/\/terminalToolService\.js$/.test(full)) return { path: fixtures('terminalToolStub.ts') };
			if (/\/contrib\/vader\/browser\/marketplace(\/|$)/.test(norm(dir))) for (const k of Object.keys(stubs)) if (full.endsWith('/' + k.replace(/\.js$/, '')) || full.endsWith('/' + k)) return { path: k, namespace: 'stub' };
		},
	},
	{
		name: 'settings', entry: 'settingsHarness.tsx',
		resolve: (full) => {
			if (/\/util\/services\.js$/.test(full)) return { path: fixtures('settingsHarnessServices.ts') };
			if (/\/vader-settings-tsx\/Settings\.js$/.test(full) || /\/sidebar-tsx\/ErrorBoundary\.js$/.test(full) || /\/common\/vaderSettingsService\.js$/.test(full)) return { path: fixtures('settingsStubs.tsx') };
		},
	},
	{
		name: 'welcome', entry: 'onboardingHarness.tsx',
		resolve: (full) => {
			if (/\/util\/services\.js$/.test(full)) return { path: fixtures('onboardingHarnessServices.ts') };
			if (/\/sidebar-tsx\/ErrorBoundary\.js$/.test(full)) return { path: fixtures('onboardingStubs.tsx') };
		},
	},
];

for (const p of pages) {
	const plugin = {
		name: 'harness',
		setup(build) {
			build.onResolve({ filter: /.*/ }, (args) => {
				if (!args.path.startsWith('.')) return null;
				return p.resolve(norm(path.resolve(args.resolveDir, args.path)), args.resolveDir) ?? null;
			});
			build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
		},
	};
	await esbuild.build({
		entryPoints: [fixtures(p.entry)], bundle: true, platform: 'browser', format: 'iife', outfile: path.join(out, `${p.name}.js`), logLevel: 'error',
		plugins: [plugin], jsx: 'automatic', loader: { '.json': 'json', '.css': 'css', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
		define: { 'process.env.NODE_ENV': '"production"', 'process.env.VADER_LANG': '"en"', 'process.env.VADER_PREVIEW': '"1"' },
		tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, jsx: 'react-jsx' } },
	});
	fs.writeFileSync(path.join(out, `${p.name}.html`), `<!doctype html><html><head><meta charset="utf-8"><title>Vader</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${p.name}.css"><style>html,body{margin:0;height:100%;background:#0b0b0c;color:#e6e6e6}#root{width:100vw;height:100vh;overflow:hidden;position:relative}</style></head><body><div id="root"></div><script src="${p.name}.js"></script></body></html>`);
	console.log('built', p.name);
}
console.log(`\nOpen ${path.join(out, 'index.html')}`);
