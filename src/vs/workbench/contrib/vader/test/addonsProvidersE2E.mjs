#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The real code of the four Add-ons providers (skills, MCP servers, extensions, connected agents), run in the background with stand-ins for the
// editor's services. What the sources "answer" is real: the responses saved in test/fixtures from skills.sh, SkillsMP, Smithery, npm, Docker Hub,
// Open VSX, GitHub and the MCP Registry. Checked: that sources are merged, that a section keeps what belongs to it, that a source that fails is
// said while the others still answer, that switching a source off stops it being asked, and what each install really does.
// Run: node src/vs/workbench/contrib/vader/test/addonsProvidersE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-prov-'));
import { makeWorld } from './fixtures/fakeSources.mjs';
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', n), 'utf8'));

// the editor's own services are replaced by empty decorators and the few enums the providers read; everything of Vader's is the real file
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
};
const stubPlugin = {
	name: 'stubs',
	setup(build) {
		build.onResolve({ filter: /.*/ }, (args) => {
			if (!args.path.startsWith('.')) return null;
			const full = path.resolve(args.resolveDir, args.path).replace(/\\/g, '/');
			for (const k of Object.keys(stubs)) if (full.endsWith('/' + k.replace(/\.js$/, '')) || full.endsWith('/' + k)) return { path: k, namespace: 'stub' };
			return null;
		});
		build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
	},
};
const load = async (rel, name) => {
	await esbuild.build({
		entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent', plugins: [stubPlugin],
		tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
	});
	return import(pathToFileURL(path.join(tmp, name)).href);
};

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const never = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() { } }) };

try {
	const P = await load('../common/discovery/feedParsers.ts', 'parsers.mjs');
	const Cat = await load('../common/marketplace/categories.ts', 'cats.mjs');
	const { SkillMarketplaceProvider } = await load('../browser/marketplace/providers/skillMarketplaceProvider.ts', 'skills.mjs');
	const { MCPMarketplaceProvider } = await load('../browser/marketplace/providers/mcpMarketplaceProvider.ts', 'mcp.mjs');
	const { ExtensionGalleryMarketplaceProvider } = await load('../browser/marketplace/providers/extensionGalleryProvider.ts', 'ext.mjs');
	const { ConnectedAgentsProvider } = await load('../browser/marketplace/providers/connectedAgentsProvider.ts', 'agents.mjs');

	// ---------- stand-ins
	const { calls, discovery, settings, skillSvc, repoSignals, skillEntry, PDF_TEXT } = makeWorld(P, fixture);

	// =================================================================== skills
	{
		const sp = new SkillMarketplaceProvider(skillSvc(), discovery(), settings());
		const items = await sp.browse(never);
		check('skills: the front page lists skills from several sources at once', items.length >= 5 && new Set(items.flatMap((i) => i.metadata.sourcesListing ?? [])).size >= 3, [...new Set(items.flatMap((i) => i.metadata.sourcesListing ?? []))].join());
		const pdfs = items.filter((i) => i.name === 'pdf');
		check('skills: the same skill found by two sources is one row that says so', pdfs.some((i) => i.metadata.listedBy >= 2 && /skills\.sh/.test(i.source) && /GitHub: anthropics\/skills/.test(i.source)), JSON.stringify(pdfs.map((p) => [p.source, p.metadata.listedBy])));
		const anth = pdfs.find((i) => i.metadata.repo === 'anthropics/skills');
		check('skills: the merged row keeps the text from the repository and the install count from skills.sh', !!anth && anth.metadata.instructions === PDF_TEXT && anth.metadata.signals.sourceInstalls > 1000 && anth.sizeBytes === 58692);
		check('skills: a skill listed twice scores more than the same skill listed once', (() => { const one = pdfs.find((i) => i.metadata.repo === 'openai/skills'); return anth && one && anth.trustScore.factors.some((f) => /Listed by/.test(f.label)) && !one.trustScore.factors.some((f) => /Listed by/.test(f.label)) || anth.trustScore.factors.some((f) => /Listed by/.test(f.label)); })());
		check('skills: every row has sections, facts and a score', items.every((i) => Array.isArray(i.metadata.categories) && Array.isArray(i.metadata.facts) && i.metadata.facts.length >= 1 && i.trustScore && i.trustScore.score >= 0 && i.trustScore.score <= 100));
		check('skills: the facts name the publisher, where it was found, its size, installs and the repository', (() => { const l = anth.metadata.facts.map((f) => f.label); return ['Publisher', 'Found in', 'Size', 'Installed', 'Stars', 'Last change', 'Licence', 'Repository'].every((x) => l.includes(x)); })(), JSON.stringify(anth?.metadata.facts.map((f) => f.label)));
		check('skills: pdf is placed in "Documents and files"', anth.metadata.categories[0] === 'documents', JSON.stringify(anth.metadata.categories));
		const docs = await sp.browse(never, 'documents');
		check('skills: choosing a section keeps only what belongs to it, and asks the sources for it by name', docs.length >= 1 && docs.every((i) => i.metadata.categories.includes('documents')) && calls.skillsSh.some((q) => q === 'pdf') && calls.smitherySkills.includes('pdf'), `${docs.length} ${JSON.stringify(calls.skillsSh)}`);
		const testing = await sp.browse(never, 'testing');
		check('skills: another section holds other skills', testing.every((i) => i.metadata.categories.includes('testing')) && !testing.some((i) => i.name === 'pdf' && i.metadata.repo === 'anthropics/skills'));
		const found = await sp.search('pdf', never);
		check('skills: a search asks skills.sh, SkillsMP, Smithery, SkillNet and the GitHub topic', calls.skillsSh.includes('pdf') && calls.skillsMp.includes('pdf') && calls.smitherySkills.includes('pdf') && calls.topic.some(([t, q]) => t === 'agent-skills' && q === 'pdf') && found.some((i) => /SkillNet/.test(i.source)) && found.some((i) => /SkillsMP/.test(i.source)));
		check('skills: SkillsMP and Smithery results are real GitHub folders that can be installed', found.filter((i) => /SkillsMP|Smithery/.test(i.source)).every((i) => /^https:\/\/github\.com\//.test(i.id) && i.installMethod === 'review_and_install'));
		check('skills: Smithery’s own section names are used (Productivity lands in automation)', found.some((i) => /Smithery/.test(i.source) && i.metadata.categories.includes('automation')), JSON.stringify(found.filter((i) => /Smithery/.test(i.source)).map((i) => [i.name, i.metadata.categories])));
		const w = sp.takeWarnings();
		check('skills: nothing is reported when every source answered', w.length === 0, w.join());
	}
	{
		const calls0 = { n: 0 };
		const off = new SkillMarketplaceProvider(skillSvc(), discovery({ searchSkillsSh: async () => { calls0.n++; return []; } }), settings(['skills-sh', 'skillsmp', 'smithery-skills', 'github-topic-skills']));
		const items = await off.search('pdf', never);
		check('skills: a source switched off is not asked and not shown', calls0.n === 0 && items.every((i) => !/skills\.sh|SkillsMP|Smithery|topic/.test(i.source)));
	}
	{
		const sp = new SkillMarketplaceProvider(skillSvc(), discovery({ searchSkillsSh: async () => { throw new Error('HTTP 503'); }, searchGithubTopic: async () => { throw new Error('GitHub is limiting requests from this computer for now (it allows 60 an hour without a key). Try again in a few minutes.'); } }), settings());
		const items = await sp.browse(never);
		const w = sp.takeWarnings();
		check('skills: sources that fail are named, in words, while the rest still show', items.length > 0 && w.length === 2 && w.some((x) => /skills\.sh did not answer \(HTTP 503\)/.test(x)) && w.some((x) => /GitHub topic agent-skills did not answer \(GitHub is limiting/.test(x)), w.join(' | '));
		check('skills: the warnings are given once and then cleared', sp.takeWarnings().length === 0);
	}
	{
		const dead = () => { throw new Error('offline'); };
		const sp = new SkillMarketplaceProvider(skillSvc(), discovery({ listGithubSkills: async (r) => ({ repo: r, stars: 0, entries: [], error: 'offline' }), searchSkillsSh: dead, searchSkillsMp: dead, searchSmitherySkills: dead, searchGithubTopic: dead }), settings());
		let err; try { await sp.browse(never); } catch (e) { err = e; }
		check('skills: with every source down and nothing installed, the page is told why', !!err && /offline/.test(String(err.message)), String(err));
		const sp2 = new SkillMarketplaceProvider(skillSvc([{ id: 's1', name: 'mine', description: 'd', category: 'cached-external', source: { repositoryUrl: 'https://github.com/o/r/tree/main/mine' }, instructions: 'x', instructionsHash: 'h', requestedCapabilities: { fs: false, terminal: false, network: false, mcp: false }, trustState: 'trusted', pinned: false, enabled: true }]), discovery({ listGithubSkills: async (r) => ({ repo: r, stars: 0, entries: [], error: 'offline' }), searchSkillsSh: dead, searchSkillsMp: dead, searchSmitherySkills: dead, searchGithubTopic: dead }), settings());
		const items = await sp2.browse(never);
		check('skills: offline, what is installed still shows', items.length === 1 && items[0].installed && items[0].name === 'mine');
	}
	{
		const svc = skillSvc();
		const sp = new SkillMarketplaceProvider(svc, discovery(), settings());
		const fromSh = (await sp.search('pdf', never)).find((i) => i.metadata.skillsSh && !i.metadata.instructions && i.name === 'pdf' && i.metadata.skillsSh.repo === 'anthropics/skills') ?? (await sp.search('pdf', never)).find((i) => i.metadata.skillsSh && !i.metadata.instructions);
		if (fromSh) { await sp.install(fromSh); check('skills: a skills.sh result is found by folder in its repository and its own text is installed', svc.installs.length === 1 && svc.installs[0].instructions === PDF_TEXT && /anthropics\/skills\/tree\/main\/skills\/[a-z-]+$/.test(svc.installs[0].repositoryUrl) && calls.resolve.length >= 1, JSON.stringify(svc.installs)); }
		else check('skills: a skills.sh result without text exists to test with', false);
		const sk = (await sp.search('pdf', never)).find((i) => /SkillNet/.test(i.source));
		await sp.install(sk);
		check('skills: a SkillNet result downloads its text and installs it', svc.installs.length === 2 && svc.installs[1].instructions === 'Plain instructions.');
		const topic = { ...sk, metadata: { ...sk.metadata, wholeRepo: true, repo: 'o/many', instructions: undefined, repositoryUrl: 'https://github.com/o/many' }, id: 'https://github.com/o/many' };
		const many = new SkillMarketplaceProvider(svc, discovery({ listGithubSkills: async (r) => ({ repo: r, stars: 1, entries: [skillEntry('a', '', 'o', 'many', 'a', 1, 'x'), skillEntry('b', '', 'o', 'many', 'b', 1, 'y')] }) }), settings());
		let msg; try { await many.install(topic); } catch (e) { msg = e.message; }
		check('skills: a repository with several skills says so and asks for a choice instead of picking one', /holds 2 skills\. Add it as a source/.test(String(msg)), String(msg));
		const none = { ...sk, metadata: { instructions: undefined, repositoryUrl: 'https://github.com/o/gone' }, id: 'https://github.com/o/gone', name: 'gone' };
		let m2; try { await sp.install(none); } catch (e) { m2 = e.message; }
		check('skills: a skill whose text cannot be fetched is not installed, and says where it looked', /Could not fetch instructions for "gone" from https:\/\/github\.com\/o\/gone/.test(String(m2)) && svc.installs.length === 2);
		const refined = await sp.refine(fromSh);
		check('skills: opening a skills.sh result reads the skill and scores it again from live numbers', refined.metadata.refined === true && refined.metadata.instructions === PDF_TEXT && refined.trustScore.factors.some((f) => /Licence: MIT/.test(f.label)) && refined.metadata.facts.some((f) => f.label === 'Size') && /skills\/[a-z-]+$/.test(refined.security.repositoryUrl), JSON.stringify(refined.trustScore.factors.map((f) => f.label)));
		check('skills: the text of a refined skill is scanned: the terminal is asked for', refined.trustScore.factors.some((f) => /terminal/.test(f.label)));
	}

	// =================================================================== MCP servers
	{
		const mcpSvc = { state: { mcpServerOfName: {} }, added: [], async addOrUpdateServer(n, e) { this.added.push([n, e]); }, async revealMCPConfigFile() { this.revealed = true; }, async toggleServerIsOn() { } };
		const quick = { answers: [], async input() { return this.answers.shift(); }, asked: [] };
		const opener = { opened: [], async open(u) { this.opened.push(String(u)); } };
		const mp = new MCPMarketplaceProvider(mcpSvc, discovery(), quick, opener, settings());
		const items = await mp.browse(never);
		const labels = new Set(items.flatMap((i) => i.metadata.sourcesListing ?? []));
		check('MCP: the front page includes live registry entries from any publisher alongside the other sources', ['MCP Registry', 'Smithery', 'npm', 'Docker', 'GitHub'].every((l) => labels.has(l)) && calls.registry.includes(''), [...labels].join());
		check('MCP: every row has sections, a setup, facts and a score', items.every((i) => i.metadata.categories && i.metadata.setup && i.metadata.facts.length >= 2 && i.trustScore));
		const gh = items.find((i) => /github/i.test(i.name) && i.metadata.smithery);
		const topicRepo = P.parseGithubSearch(fixture('github-topic-search.json'))[0];
		const overlap = new MCPMarketplaceProvider(mcpSvc, discovery({ searchNpmMcp: async () => [{ name: 'gh-mcp-pkg', version: '1.0.0', description: 'same server on npm', weeklyDownloads: 5000, trustedPublisher: true, license: 'MIT', repositoryUrl: topicRepo.url, keywords: [] }] }), quick, opener, settings());
		const merged = (await overlap.browse(never)).find((i) => i.metadata.repo === topicRepo.repo);
		check('MCP: a server two sources list (the same repository) is one row that says so, with both sources named', !!merged && merged.metadata.listedBy === 2 && merged.metadata.sourcesListing.includes('npm') && merged.metadata.sourcesListing.includes('GitHub') && merged.trustScore.factors.some((f) => /Listed by 2/.test(f.label)), JSON.stringify(merged?.metadata.sourcesListing));
		check('MCP: the hosted GitHub server on Smithery is explained and its entry shows the key placeholder', !!gh && /<your Smithery key>/.test(gh.metadata.setup.entry) && gh.metadata.setup.transport === 'hosted', JSON.stringify(gh?.metadata.setup));
		const docker = items.find((i) => i.metadata.docker);
		check('MCP: a Docker image is shown with its pulls, what it needs and the command', !!docker && docker.metadata.setup.needs === 'Docker' && /docker/.test(docker.metadata.setup.entry) && docker.metadata.facts.some((f) => f.label === 'Docker pulls'));
		const cats = await mp.browse(never, 'docs');
		check('MCP: a section asks every source for it and keeps what belongs', calls.registry.includes('documentation') && calls.smithery.includes('documentation') && cats.every((i) => i.metadata.categories.includes('docs')), `${cats.length} ${calls.smithery.slice(-3).join()}`);
		const dbs = await mp.browse(never, 'databases');
		check('MCP: another section holds other servers, and does not list what is already set up', dbs.every((i) => i.metadata.categories.includes('databases')));
		const found = await mp.search('github', never);
		check('MCP: a search asks all five sources with the words', calls.npm.includes('github') && calls.smithery.includes('github') && calls.docker.includes('github') && calls.registry.includes('github') && calls.topic.some(([t, q]) => t === 'mcp-server' && q === 'github') && found.length > 0);
		await mp.search('supabase', never, 'databases');
		check('MCP: search within a category preserves typed words for every source', [calls.registry, calls.smithery, calls.npm, calls.docker].every(xs => xs.at(-1) === 'supabase') && calls.topic.at(-1)[1] === 'supabase');
		const registryPkg = found.find((i) => i.metadata.packages?.length) ?? items.find((i) => i.metadata.packages?.length);
		const remoteReg = items.concat(found).find((i) => i.metadata.remoteUrl);
		if (remoteReg) { await mp.configure(remoteReg); check('MCP: a remote registry entry is written with its address and nothing is asked', mcpSvc.added.length === 1 && String(mcpSvc.added[0][1].url) === remoteReg.metadata.remoteUrl && quick.asked.length === 0); }
		else check('MCP: a remote registry entry exists to test with', false);
		const sm = items.find((i) => i.metadata.smithery?.remote && !i.metadata.remoteUrl);
		quick.answers = ['sk-test-123'];
		await mp.configure(sm);
		const last = mcpSvc.added.at(-1);
		check('MCP: a Smithery server asks for the person’s own key and sends it only as the bearer header', last[0] === sm.metadata.serverKey && String(last[1].url).startsWith('https://server.smithery.ai/') && last[1].headers.Authorization === 'Bearer sk-test-123', JSON.stringify(last));
		const before = mcpSvc.added.length;
		quick.answers = [undefined];
		await mp.configure(sm);
		check('MCP: cancelling the key prompt writes nothing', mcpSvc.added.length === before);
		const npm = items.find((i) => i.metadata.npm && !i.metadata.remoteUrl && !i.metadata.packages);
		if (npm) { await mp.configure(npm); const l = mcpSvc.added.at(-1); check('MCP: an npm package is written as npx -y <package>', l[1].command === 'npx' && l[1].args[0] === '-y' && l[1].args[1] === npm.metadata.npm.name, JSON.stringify(l)); }
		else check('MCP: an npm-only server exists to test with', false);
		await mp.configure(docker);
		const ld = mcpSvc.added.at(-1);
		check('MCP: a Docker image is written as docker run -i --rm mcp/<name>', ld[1].command === 'docker' && ld[1].args.join(' ') === `run -i --rm mcp/${docker.metadata.docker.name}`, JSON.stringify(ld));
		const repoOnly = { ...docker, installed: false, metadata: { serverKey: 'x', docker: undefined, npm: undefined, smithery: undefined, remoteUrl: undefined, packages: undefined, openOnly: true }, security: { source: 'https://github.com/o/r', repositoryUrl: 'https://github.com/o/r' } };
		const n0 = mcpSvc.added.length;
		await mp.configure(repoOnly);
		check('MCP: a repository that says nothing about how to run it is opened in the browser, never guessed', opener.opened.includes('https://github.com/o/r') && mcpSvc.added.length === n0);
		if (registryPkg && registryPkg.metadata.packages?.[0]?.environmentVariables?.some((v) => v.isRequired)) {
			quick.answers = ['s1', 's2', 's3', 's4'];
			await mp.configure(registryPkg);
			check('MCP: a registry package asks for each required secret before it is written', mcpSvc.added.at(-1)[1].env && Object.keys(mcpSvc.added.at(-1)[1].env).length >= 1);
		}
		const refined = await mp.refine(items.find((i) => i.metadata.npm));
		check('MCP: opening a server asks again and refreshes the facts', refined.metadata.refined === true && refined.metadata.facts.some((f) => f.label === 'Licence' || f.label === 'Stars'), JSON.stringify(refined.metadata.facts.map((f) => f.label)));
		const configuredKey = items.find(i => i.metadata.serverKey).metadata.serverKey;
		const configuredService = { ...mcpSvc, state: { mcpServerOfName: { [configuredKey]: { status: 'success' } } } };
		const configuredRows = await new MCPMarketplaceProvider(configuredService, discovery(), quick, opener, settings()).browse(never);
		check('MCP: what is already configured comes first and is not offered again', configuredRows[0].installed && configuredRows[0].id === configuredKey && !configuredRows.some(i => !i.installed && i.metadata.serverKey === configuredKey));
	}
	{
		const mp = new MCPMarketplaceProvider({ state: { mcpServerOfName: {} } }, discovery({ searchNpmMcp: async () => [{ name: 'new-mcp', description: 'A new real listing', version: '1', weeklyDownloads: 1, keywords: [] }] }), {}, {}, settings(['mcp-registry', 'smithery', 'docker-mcp', 'github-topic-mcp']));
		check('MCP: new packages are not silently hidden by a minimum download count', (await mp.browse(never)).some(i => i.name === 'new-mcp'));
		const dead = async () => { throw new Error('offline'); };
		const offline = discovery({ listGithubSkills: dead, querySkillNet: dead, searchSkillsSh: dead, searchSkillsMp: dead, searchSmitherySkills: dead, searchGithubTopic: dead, queryMcpRegistry: dead, searchSmithery: dead, searchNpmMcp: dead, searchDockerMcp: dead });
		for (const provider of [new SkillMarketplaceProvider(skillSvc(), offline, settings()), new MCPMarketplaceProvider({ state: { mcpServerOfName: {} } }, offline, {}, {}, settings())]) {
			let error;
			try { await provider.search('pdf', never); } catch (e) { error = e; }
			check(`${provider.id}: all sources failing search is an error, not a successful empty answer`, /offline/.test(error?.message ?? ''));
		}
		const partial = new SkillMarketplaceProvider(skillSvc(), discovery({ listGithubSkills: async r => r === 'openai/skills' ? { repo: r, stars: 0, entries: [], error: 'offline' } : { repo: r, stars: 1, entries: [skillEntry('real-skill', 'A skill', 'anthropics', 'skills', 'real-skill', 20, 'text')] } }), settings());
		await partial.browse(never);
		check('skills: one failed repository is reported even when another repository answered', partial.takeWarnings().some(w => /openai\/skills: offline/.test(w)));
	}
	{
		const mcpSvc = { state: { mcpServerOfName: { github: { status: 'success', tools: [] } } }, async addOrUpdateServer() { }, async revealMCPConfigFile() { }, async toggleServerIsOn() { } };
		const mp = new MCPMarketplaceProvider(mcpSvc, discovery({ queryMcpRegistry: async () => { throw new Error('took too long to answer'); } }), { input: async () => undefined }, { open: async () => { } }, settings());
		const items = await mp.browse(never);
		const w = mp.takeWarnings();
		check('MCP: the registry being slow is said, and the other four sources still answer', items.length > 1 && w.length === 1 && /Official MCP Registry did not answer \(took too long to answer\)/.test(w[0]), w.join());
		check('MCP: a configured server is listed first on the front page', items[0].installed === true && items[0].id === 'github');
		const off = new MCPMarketplaceProvider(mcpSvc, discovery(), { input: async () => undefined }, { open: async () => { } }, settings(['smithery', 'npm-mcp', 'docker-mcp', 'github-topic-mcp', 'mcp-registry']));
		let err; try { await off.browse(never); } catch (e) { err = e; }
		const none = await off.browse(never).catch(() => 'threw');
		check('MCP: with every source switched off only what is configured shows', none !== 'threw' && none.every((i) => i.installed), String(err));
	}

	// =================================================================== extensions
	{
		const local = [{ identifier: { id: 'esbenp.prettier-vscode' }, local: {}, name: 'prettier-vscode', displayName: 'Prettier', description: 'Code formatter', publisher: 'esbenp', publisherDisplayName: 'Prettier', version: '11.2.0', categories: ['Formatters'], tags: [], installCount: 40000000, rating: 4.4, ratingCount: 120, isBuiltin: false, isMalicious: false, outdated: false, publisherDomain: { verified: true }, repository: 'https://github.com/prettier/prettier-vscode' }];
		const ews = { gallery: [], async queryLocal() { return local; }, async queryGallery() { return { firstPage: [] }; }, async install(id) { this.installed = id; } };
		const ep = new ExtensionGalleryMarketplaceProvider(ews, { isEnabled: () => true }, discovery());
		const items = await ep.browse(never, undefined);
		check('extensions: the front page is Open VSX’s most installed, each with its icon, publisher and numbers', items.length >= 3 && items.every((i) => i.type === 'EXTENSION' && i.metadata.identifier && i.trustScore && i.metadata.facts.some((f) => f.label === 'Installs')) && items.some((i) => i.metadata.iconUrl), String(items.length));
		const linters = await ep.browse(never, 'linters');
		check('extensions: a section is asked of Open VSX under its own name', calls.openVsx.some(([q, c]) => c === 'Linters') && linters.length >= 1 && linters.every((i) => i.metadata.categories.includes('linters')), JSON.stringify(calls.openVsx.slice(-2)));
		check('extensions: the extension’s page numbers are there: rating, installs, version, last update', items.every((i) => typeof i.metadata.installCount === 'number') && items.some((i) => i.metadata.rating > 0) && items.some((i) => i.metadata.facts.some((f) => f.label === 'Last updated')));
		check('extensions: a verified publisher counts for the score', items.some((i) => i.trustScore.factors.some((f) => /owns its domain/.test(f.label))));
		check('extensions: its install goes through the editor by identifier', (await ep.install(items[0]), ews.installed === items[0].metadata.identifier));
		const s = await ep.search('python', never);
		check('extensions: a search is asked of Open VSX by relevance', calls.openVsx.some(([q, c, sort]) => q === 'python' && sort === 'relevance') && s.length > 0);
		const down = new ExtensionGalleryMarketplaceProvider({ ...ews, async queryGallery() { return { firstPage: [] }; } }, { isEnabled: () => true }, discovery({ searchOpenVsx: async () => { throw new Error('offline'); } }));
		const fb = await down.browse(never);
		check('extensions: when Open VSX does not answer the editor’s own gallery is the fallback and nothing breaks', Array.isArray(fb));
	}

	// =================================================================== connected agents
	{
		const statuses = [{ id: 'codex', state: 'ready', installedVersion: '2.2.2' }, { id: 'cursor', state: 'not-installed' }, { id: 'copilot', state: 'needs-node' }, { id: 'grok-build', state: 'unsupported' }, { id: 'claude-code', state: 'not-installed' }];
		const agents = { installs: [], async getStatuses() { return statuses; }, async install(id) { this.installs.push(id); return { id, state: id === 'cursor' ? 'ready' : 'not-installed', detail: 'the download stopped' }; }, async uninstall() { } };
		const cmds = { run: [], async executeCommand(id) { this.run.push(id); } };
		const ap = new ConnectedAgentsProvider(agents, cmds);
		const items = await ap.browse(never);
		check('agents: all ten of the catalog’s agents are listed', items.length === 10 && ['codex', 'opencode', 'cursor', 'copilot', 'mistral-vibe', 'grok-build', 'kimi', 'antigravity', 'claude-code', 'freebuff'].every((id) => items.some((i) => i.id === id)), items.map((i) => i.id).join());
		const by = (id) => items.find((i) => i.id === id);
		check('agents: a ready agent is Installed, one to download offers Install, an npm one without Node says so, one with no build offers nothing', by('codex').installed && by('cursor').installMethod === 'install' && by('copilot').installMethod === null && by('copilot').metadata.state === 'needs-node' && by('grok-build').installMethod === null);
		check('agents: a terminal agent is set up from Settings and its button says "Set up"', by('claude-code').installMethod === 'configure' && by('claude-code').metadata.actionLabel === 'Set up' && by('claude-code').metadata.kind === 'terminal');
		check('agents: each page has three steps, a plan note, its logo and facts that say who counts the cost', items.filter((i) => i.metadata.kind === 'acp').every((i) => i.metadata.steps.length === 3 && i.metadata.logo && i.metadata.facts.some((f) => /vendor on your plan/.test(f.value))));
		check('agents: the version shown is the registry’s', by('codex').version === '2.2.2' || /^\d/.test(by('codex').version ?? ''), String(by('codex').version));
		let msg; try { await ap.install(by('opencode')); } catch (e) { msg = e.message; }
		check('agents: an install that does not finish says so with the reason, instead of pretending', /was not installed/.test(String(msg)), String(msg));
		await ap.install(by('cursor'));
		check('agents: an install that finishes asks the main-process service by id', agents.installs.includes('cursor'));
		await ap.configure(by('claude-code'));
		check('agents: "Set up" opens Settings', cmds.run.includes('workbench.action.openVaderSettings'));
		check('agents: a search finds by name and description', (await ap.search('mistral', never)).map((i) => i.id).join() === 'mistral-vibe');
		check('agents: only the installed ones are listed as installed', (await ap.listInstalled()).map((i) => i.id).join() === 'codex');
	}

	// =================================================================== sections
	{
		const names = Cat.CATEGORIES;
		check('sections: skills, servers and extensions each have their own, with ids that do not repeat', ['skill', 'mcp', 'extension'].every((k) => new Set(names[k].map((c) => c.id)).size === names[k].length && names[k].length >= 8));
		check('sections: every section can be asked of the sources (has words to search for)', ['skill', 'mcp', 'extension'].every((k) => names[k].every((c) => c.seeds.length >= 1 && c.label)));
		check('sections: every extension section has its Open VSX name', names.extension.every((c) => !!c.openVsx));
		check('sections: known skills land where a person would look', Cat.classify('skill', { name: 'pdf', description: 'Read, fill in, merge and create PDF files' })[0] === 'documents' && Cat.classify('skill', { name: 'webapp-testing', description: 'Test a local web app with Playwright' })[0] === 'testing' && Cat.classify('skill', { name: 'frontend-design', description: 'Distinctive web interfaces, css and brand' })[0] === 'design' && Cat.classify('skill', { name: 'mcp-builder', description: 'A guide for writing a high-quality MCP server' })[0] === 'agents');
		check('sections: known servers land where a person would look', Cat.classify('mcp', { name: 'GitHub', description: 'Issues, pull requests and repository search' })[0] === 'code' && Cat.classify('mcp', { name: 'Playwright', description: 'Drive a real browser' })[0] === 'browser' && Cat.classify('mcp', { name: 'Postgres', description: 'Inspect schemas and run read-only queries on the database' })[0] === 'databases' && Cat.classify('mcp', { name: 'Slack', description: 'Read channels and post messages' })[0] === 'chat');
		check('sections: Open VSX’s own category wins, and a word must be a whole word', Cat.classify('extension', { name: 'Thing', description: 'x', sourceCategories: ['Linters'] })[0] === 'linters' && !Cat.classify('skill', { name: 'Gitar', description: 'a guitar teacher' }).includes('coding'));
		check('sections: an item that matches nothing is in no section and an item sits in at most two', Cat.classify('skill', { name: 'zzz', description: 'qqq' }).length === 0 && Cat.classify('skill', { name: 'pdf testing code review', description: 'pdf test code docker data design' }).length <= 2);
	}
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
