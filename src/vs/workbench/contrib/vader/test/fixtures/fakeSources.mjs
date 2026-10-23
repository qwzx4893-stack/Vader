// Stand-ins for the sources and the editor's services, shared by the provider test (node) and the page test (a real browser, headless).
// What the sources "answer" is the real saved responses in test/fixtures, read through the real parsers.

export function makeWorld(P, fixture) {
	const calls = { skillsSh: [], topic: [], smithery: [], npm: [], docker: [], openVsx: [], skillsMp: [], smitherySkills: [], registry: [], resolve: [] };
	const skillEntry = (name, desc, owner, repoName, dir, size, text) => ({ name, description: desc, repositoryUrl: `https://github.com/${owner}/${repoName}/tree/main/${dir}`, owner, repo: repoName, sizeBytes: size, instructions: text });
	const PDF_TEXT = '---\nname: pdf\ndescription: Read, fill in and create PDF files\n---\nUse pypdf to read a PDF. Run the python script with the terminal.';
	const repoSignals = (repo, extra = {}) => ({ repo, stars: 181000, forks: 20000, openIssues: 40, pushedAt: '2026-10-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z', archived: false, license: 'MIT', ownerType: 'Organization', url: `https://github.com/${repo}`, ...extra });
	const discovery = (over = {}) => ({
		listGithubSkills: async (r) => r === 'anthropics/skills'
			? { repo: r, stars: 181000, signals: repoSignals(r), entries: [skillEntry('pdf', 'Read, fill in and create PDF files', 'anthropics', 'skills', 'skills/pdf', 58692, PDF_TEXT), skillEntry('webapp-testing', 'Test a local web app with Playwright', 'anthropics', 'skills', 'skills/webapp-testing', 22000, 'Run playwright tests.')] }
			: { repo: r, stars: 28000, signals: repoSignals(r, { license: undefined }), entries: [skillEntry('pdf', 'PDF', 'openai', 'skills', 'skills/.curated/pdf', 9000, PDF_TEXT)] },
		searchSkillsSh: async (q) => { calls.skillsSh.push(q); return P.parseSkillsSh(fixture('skillssh-search.json')); },
		searchSkillsMp: async (q) => { calls.skillsMp.push(q); return P.parseSkillsMp(fixture('skillsmp-search.json')); },
		searchSmitherySkills: async (q) => { calls.smitherySkills.push(q); return P.parseSmitherySkills(fixture('smithery-skills.json')); },
		searchSkillNet: async () => [{ name: 'pdf-tools', description: 'PDF helper', repositoryUrl: 'https://github.com/anymouschina/pdf-skill', stars: 301 }],
		querySkillNet: async () => [{ name: 'pdf-tools', description: 'PDF helper', repositoryUrl: 'https://github.com/anymouschina/pdf-skill', stars: 301 }],
		searchGithubTopic: async (topic, q) => { calls.topic.push([topic, q]); return P.parseGithubSearch(fixture('github-topic-search.json')); },
		getRepoSignals: async (r) => repoSignals(r),
		getNpmInfo: async () => ({ installScripts: false, deprecated: false, license: 'MIT' }),
		resolveGithubSkill: async (r, id) => { calls.resolve.push([r, id]); return r === 'anthropics/skills' && id !== 'gone' ? skillEntry(id, 'Read, fill in and create PDF files', 'anthropics', 'skills', 'skills/' + id, 58692, PDF_TEXT) : undefined; },
		fetchSkillInstructions: async (u) => (/skillnet|pdf-skill/.test(u) ? 'Plain instructions.' : null),
		searchSmithery: async (q) => { calls.smithery.push(q); return P.parseSmithery(fixture('smithery-search.json')); },
		searchNpmMcp: async (q) => { calls.npm.push(q); return P.parseNpmSearch(fixture('npm-mcp-search.json')); },
		searchDockerMcp: async (q) => { calls.docker.push(q); return P.parseDockerMcp(fixture('dockerhub-mcp.json')); },
		queryMcpRegistry: async (q) => { calls.registry.push(q); return registryResults(); },
		searchOpenVsx: async (q, cat, sort) => { calls.openVsx.push([q, cat, sort]); return P.parseOpenVsx(fixture('openvsx-search.json')); },
		...over,
	});
	const registryResults = () => fixture('mcp-registry-search.json').servers.map((e) => {
		const s = e.server;
		const remote = (s.remotes ?? []).find((r) => r.url)?.url;
		return { name: s.name, description: s.description, version: s.version, remoteUrl: remote, localOnly: !remote && (s.packages ?? []).length > 0, repositoryUrl: s.repository?.url, packages: s.packages?.map((p) => ({ registryType: p.registryType, identifier: p.identifier, version: p.version, runtimeHint: p.runtimeHint, environmentVariables: p.environmentVariables })) };
	});
	const settings = (off = []) => ({ state: { globalSettings: { addonSourcesOff: off } } });
	const skillSvc = (installed = []) => {
		const s = { installs: [], installed, listSources: () => ['anthropics/skills', 'openai/skills'], list: () => s.installed, get: (id) => s.installed.find((x) => x.id === id), install: (o) => { s.installs.push(o); return { id: 'new' }; }, remove() { }, setEnabled() { } };
		return s;
	};


	return { calls, discovery, settings, skillSvc, registryResults, repoSignals, skillEntry, PDF_TEXT };
}
