#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The live sources behind Add-ons (skills.sh, Smithery, npm, GitHub topics, the MCP registry) and the score that is computed again from what
// they say. The parsers are run on real responses saved in test/fixtures; the score on named situations.
// Run: node src/vs/workbench/contrib/vader/test/liveSourcesE2E.mjs        (add --live to also ask the real services once)

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const tmp = fs.mkdtempSync(path.join(repo, 'node_modules', '.vader-live-'));
const load = async (rel, name) => {
	await esbuild.build({ entryPoints: [path.join(here, rel)], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, name), logLevel: 'silent' });
	return import(pathToFileURL(path.join(tmp, name)).href);
};
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', n), 'utf8'));

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

try {
	const P = await load('../common/discovery/feedParsers.ts', 'p.mjs');
	const T = await load('../common/marketplace/trustScore.ts', 't.mjs');
	const S = await load('../common/marketplace/addonSources.ts', 's.mjs');

	// ---- what each source sent, read
	const sh = P.parseSkillsSh(fixture('skillssh-search.json'));
	check('skills.sh: skills come with their repository, folder and install count', sh.length >= 3 && sh.every(s => /^[^/]+\/[^/]+$/.test(s.repo) && s.skillId && s.installs >= 0) && sh.some(s => s.repo === 'anthropics/skills' && s.skillId === 'pdf' && s.installs > 1000), JSON.stringify(sh.slice(0, 2)));
	check('skills.sh: an entry with a path-like folder name is refused', P.parseSkillsSh({ skills: [{ source: 'a/b', skillId: '../x', name: 'x', installs: 1 }, { source: 'a', skillId: 'x' }] }).length === 0);
	const sm = P.parseSmithery(fixture('smithery-search.json'));
	check('Smithery: name, verified, use count and whether it is hosted are read', sm.length >= 1 && sm[0].qualifiedName && typeof sm[0].verified === 'boolean' && sm[0].useCount >= 0, JSON.stringify(sm[0]));
	check('Smithery: an unlisted or inactive server is left out', P.parseSmithery({ servers: [{ qualifiedName: 'a/b', unlisted: true }, { qualifiedName: 'c/d', inactive: true }, { qualifiedName: 'e/f' }] }).map(s => s.qualifiedName).join() === 'e/f');
	const npm = P.parseNpmSearch(fixture('npm-mcp-search.json'));
	check('npm: package, weekly downloads and licence are read', npm.length >= 1 && npm[0].name && npm[0].weeklyDownloads >= 0, JSON.stringify(npm[0]));
	check('npm: a repository address is reduced to the GitHub page, and a package name that is not one is refused', npm.every(n => !n.repositoryUrl || /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(n.repositoryUrl)) && P.parseNpmSearch({ objects: [{ package: { name: 'Not A Name!' } }] }).length === 0);
	check('npm: a trusted publisher (provenance) is noticed', P.parseNpmSearch({ objects: [{ package: { name: 'x', publisher: { username: 'GitHub Actions', trustedPublisher: { id: 'github' } } }, downloads: { weekly: 5 } }] })[0].trustedPublisher === true && P.parseNpmSearch({ objects: [{ package: { name: 'x', publisher: { username: 'a' } } }] })[0].trustedPublisher === false);
	const gh = P.parseGithubSearch(fixture('github-topic-search.json'));
	check('GitHub: stars, forks, last change, licence, archived and owner type come from the repository object', gh.length >= 1 && gh[0].stars > 0 && gh[0].pushedAt && typeof gh[0].archived === 'boolean' && gh[0].ownerType, JSON.stringify(gh[0]));
	check('GitHub: a licence that is only "NOASSERTION" counts as none', P.parseRepoSignals({ full_name: 'a/b', license: { spdx_id: 'NOASSERTION' } }).license === undefined && P.parseRepoSignals({ full_name: 'a/b', license: { spdx_id: 'MIT' } }).license === 'MIT');
	check('GitHub: something that is not a repository is refused', P.parseRepoSignals({ full_name: 'a/../b' }) === undefined && P.parseRepoSignals({}) === undefined);
	check('repository addresses in the shapes sources use are all reduced the same way', ['git+https://github.com/o/r.git', 'https://github.com/o/r/tree/main/x', 'git@github.com:o/r.git', 'https://github.com/o/r#readme'].every(u => P.githubRepoUrlOf(u) === 'https://github.com/o/r') && P.githubRepoUrlOf('https://evil.test/github.com/o/r') === undefined && P.githubRepoUrlOf('https://github.com.evil.test/o/r') === undefined);
	const reg = fixture('mcp-registry-search.json');
	check('MCP Registry: deprecated and deleted entries are noticed', P.registryEntryStatus({ _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deprecated' } } }).deprecated === true && P.registryEntryStatus(reg.servers[0]).deprecated === false && !!P.registryEntryStatus(reg.servers[0]).publishedAt);

	// ---- the score, from live signals
	const NOW = Date.parse('2026-10-14T12:00:00Z');
	const base = { kind: 'skill', publisher: 'someone', now: NOW };
	const sc = (x) => T.computeTrust({ ...base, ...x });
	const has = (r, text) => r.factors.some(f => f.label.includes(text));
	check('nothing known means nothing is held against it', sc({}).score === sc({ now: NOW }).score && !sc({}).factors.some(f => /Changed|Not changed|licen|Installed|downloads/i.test(f.label)));
	check('changed recently adds, not changed for a year and two years take away', sc({ pushedAt: '2026-09-20T00:00:00Z' }).score > sc({}).score && sc({ pushedAt: '2025-06-01T00:00:00Z' }).score < sc({}).score && sc({ pushedAt: '2023-01-01T00:00:00Z' }).score < sc({ pushedAt: '2025-06-01T00:00:00Z' }).score);
	check('the age is said in words', has(sc({ pushedAt: '2023-01-01T00:00:00Z' }), 'Not changed for 3.8 years') && has(sc({ pushedAt: '2026-09-20T00:00:00Z' }), 'days ago'), JSON.stringify(sc({ pushedAt: '2023-01-01T00:00:00Z' }).factors.map(f => f.label)));
	check('an archived repository is held against it and its age is not also counted', sc({ archived: true, pushedAt: '2020-01-01T00:00:00Z' }).score === sc({ archived: true }).score && sc({ archived: true }).score < sc({}).score - 15);
	check('a licence adds, none takes away, unknown does neither', sc({ license: 'MIT' }).score > sc({}).score && sc({ license: null }).score < sc({}).score);
	check('a repository younger than a month is held against it', sc({ createdAt: '2026-10-01T00:00:00Z' }).score < sc({}).score && sc({ createdAt: '2024-10-01T00:00:00Z' }).score === sc({}).score);
	check('install counts are read in steps, and a skill has higher steps than a server', sc({ sourceInstalls: 250_000 }).score > sc({ sourceInstalls: 20_000 }).score && sc({ sourceInstalls: 20_000 }).score > sc({ sourceInstalls: 2_000 }).score && sc({ sourceInstalls: 2 }).score < sc({}).score
		&& T.computeTrust({ kind: 'mcp', publisher: 'x', sourceInstalls: 6_000, now: NOW }).score > T.computeTrust({ kind: 'mcp', publisher: 'x', sourceInstalls: 600, now: NOW }).score);
	check('weekly downloads count for a package', T.computeTrust({ kind: 'mcp', publisher: 'x', weeklyDownloads: 200_000, now: NOW }).score > T.computeTrust({ kind: 'mcp', publisher: 'x', weeklyDownloads: 2_000, now: NOW }).score && T.computeTrust({ kind: 'mcp', publisher: 'x', weeklyDownloads: 3, now: NOW }).score < T.computeTrust({ kind: 'mcp', publisher: 'x', now: NOW }).score);
	check('a script that runs on install and a deprecated entry are held against it', T.computeTrust({ kind: 'mcp', publisher: 'x', installScripts: true, now: NOW }).score < T.computeTrust({ kind: 'mcp', publisher: 'x', now: NOW }).score - 8 && T.computeTrust({ kind: 'mcp', publisher: 'x', deprecated: true, now: NOW }).score < T.computeTrust({ kind: 'mcp', publisher: 'x', now: NOW }).score - 20);
	check('two or three sources listing the same thing agree with each other', sc({ listedBy: 2 }).score === sc({}).score + 4 && sc({ listedBy: 3 }).score === sc({}).score + 6 && sc({ listedBy: 1 }).score === sc({}).score);
	check('secrets asked for are said, with no points either way', has(sc({ kind: 'mcp', secretsRequested: 2 }), 'Asks you for 2 secrets') && sc({ kind: 'mcp', secretsRequested: 2 }).score === sc({ kind: 'mcp' }).score);
	check('a CI-published package adds, an organisation owner adds a little', T.computeTrust({ kind: 'mcp', publisher: 'x', trustedPublisher: true, now: NOW }).score > T.computeTrust({ kind: 'mcp', publisher: 'x', now: NOW }).score && sc({ ownerType: 'Organization' }).score === sc({}).score + 2);
	check('the score never leaves 0 to 100 however the signals pile up', sc({ archived: true, deprecated: true, license: null, installScripts: true, pushedAt: '2018-01-01T00:00:00Z', sourceInstalls: 1, weeklyDownloads: 1 }).score === 0 && T.computeTrust({ kind: 'mcp', publisher: 'github', publisherVerified: true, stars: 5000, sourceInstalls: 90_000, weeklyDownloads: 900_000, trustedPublisher: true, listedBy: 4, license: 'MIT', pushedAt: '2026-10-10T00:00:00Z', runsLocalCode: false, signatureVerified: true, now: NOW }).score <= 100);

	// ---- a copy of a well-known name
	check('the same name from someone who does not publish it is noticed', T.lookalikeOf('io.github.mallory/github-mcp-server', 'mallory')?.kind === 'same-name' && T.lookalikeOf('Github', 'mallory')?.of === 'github');
	check('the real one is not', T.lookalikeOf('github-mcp-server', 'github') === undefined && T.lookalikeOf('stripe', 'stripe') === undefined && T.lookalikeOf('playwright-mcp', 'microsoft') === undefined);
	check('a name a letter or two away is noticed', T.lookalikeOf('githab', 'mallory')?.kind === 'near-name' && T.lookalikeOf('playwrigth', 'x')?.of === 'playwright' && T.lookalikeOf('striipe-mcp', 'x')?.of === 'stripe');
	check('unrelated names are left alone', T.lookalikeOf('weather-forecast', 'x') === undefined && T.lookalikeOf('csv', 'x') === undefined && T.lookalikeOf(undefined, 'x') === undefined);
	check('the score says what it copies and takes points for it', has(T.computeTrust({ kind: 'mcp', name: 'githab-mcp', publisher: 'mallory', now: NOW }), '"github"') && T.computeTrust({ kind: 'mcp', name: 'githab-mcp', publisher: 'mallory', now: NOW }).score < T.computeTrust({ kind: 'mcp', name: 'weather', publisher: 'mallory', now: NOW }).score - 15);

	// ---- the list of sources
	check('every source has a distinct id and a host', new Set(S.ADDON_SOURCES.map(s => s.id)).size === S.ADDON_SOURCES.length && S.ADDON_SOURCES.every(s => s.host && s.label && s.hint));
	check('skills and MCP servers each have several live sources, not one', S.sourcesOfKind('skill').length >= 4 && S.sourcesOfKind('mcp').length >= 4);
	check('a source is on unless it was switched off, and one added later is on', S.isSourceOn(undefined, 'smithery') && S.isSourceOn([], 'smithery') && !S.isSourceOn(['smithery'], 'smithery') && S.isSourceOn(['smithery'], 'npm-mcp'));

	// ---- the sources added later: SkillsMP, Smithery skills, Docker Hub, Open VSX
	const mp = P.parseSkillsMp(fixture('skillsmp-search.json'));
	check('SkillsMP: name, author, folder on GitHub, stars and when it changed are read; the date is turned from seconds', mp.length >= 1 && mp.every((s) => /^https:\/\/github\.com\//.test(s.githubUrl) && s.stars >= 0) && mp.some((s) => /^20\d\d-/.test(s.updatedAt ?? '')), JSON.stringify(mp[0]));
	check('SkillsMP: an entry whose address is not GitHub, or that has no name, is left out', P.parseSkillsMp({ data: { skills: [{ name: 'a', githubUrl: 'https://evil.test/x' }, { githubUrl: 'https://github.com/o/r' }, { name: 'ok', githubUrl: 'https://github.com/o/r/tree/main/s' }] } }).map((s) => s.name).join() === 'ok');
	const ss = P.parseSmitherySkills(fixture('smithery-skills.json'));
	check('Smithery skills: the section names Smithery gave and the repository’s stars are read', ss.length >= 1 && ss.some((s) => s.categories.length > 0) && ss.every((s) => /^https:\/\/github\.com\//.test(s.gitUrl)), JSON.stringify(ss[0]));
	check('Smithery skills: an unlisted skill or one without a GitHub folder is left out', P.parseSmitherySkills({ skills: [{ qualifiedName: 'a/b', gitUrl: 'https://github.com/o/r/tree/main/x', listed: false }, { qualifiedName: 'c/d', gitUrl: 'git@host:x' }] }).length === 0);
	const dk = P.parseDockerMcp(fixture('dockerhub-mcp.json'));
	check('Docker: image name, pulls and last update are read, and the catalog index itself is not a server', dk.length >= 2 && dk.every((r) => /^[a-z0-9]/.test(r.name) && r.pulls >= 0) && !dk.some((r) => r.name === 'catalog'), JSON.stringify(dk.map((r) => r.name)));
	check('Docker: a private image or a name with odd characters is refused', P.parseDockerMcp({ results: [{ name: 'x', is_private: true }, { name: 'a b' }, { name: '../x' }, { name: 'ok' }] }).map((r) => r.name).join() === 'ok');
	const ov = P.parseOpenVsx(fixture('openvsx-search.json'));
	check('Open VSX: id, downloads, rating, verified, last update and icon are read', ov.length >= 3 && ov.every((e) => /^[^.]+\.[^.]+/.test(e.id) && e.downloads >= 0) && ov.some((e) => e.rating > 0 && e.verified) && ov.some((e) => /^https:\/\/open-vsx\.org\//.test(e.iconUrl ?? '')) && ov.every((e) => /^20\d\d-/.test(e.updatedAt ?? '2026')), JSON.stringify(ov[0]));
	check('Open VSX: an icon from anywhere but open-vsx.org is dropped, and odd ids are refused', P.parseOpenVsx({ extensions: [{ namespace: 'a', name: 'b', files: { icon: 'https://evil.test/i.png' } }, { namespace: '../x', name: 'b' }] }).length === 1 && P.parseOpenVsx({ extensions: [{ namespace: 'a', name: 'b', files: { icon: 'https://evil.test/i.png' } }] })[0].iconUrl === undefined);
	check('GitHub folder addresses: a repository or a folder in one is kept, anything else refused', P.githubFolderUrlOf('https://github.com/o/r/tree/main/skills/pdf') === 'https://github.com/o/r/tree/main/skills/pdf' && P.githubFolderUrlOf('https://github.com/o/r') === 'https://github.com/o/r' && P.githubFolderUrlOf('https://github.com/o/r/blob/main/x') === undefined && P.githubFolderUrlOf('http://github.com/o/r') === undefined && P.githubFolderUrlOf('https://github.com.evil.test/o/r') === undefined);
	check('there are now six sources of skills, five of MCP servers', S.sourcesOfKind('skill').length === 6 && S.sourcesOfKind('mcp').length === 5);

	// ---- what the monitor remembers, and when it speaks up
	const H = await load('../common/marketplace/trustHistory.ts', 'h.mjs');
	const e = (first, score, against = []) => ({ first, score, at: 1, against });
	check('the first time an add-on is seen nothing is said', H.trustAlert(undefined, 20, ['x']) === undefined);
	check('a drop of ten or more is said, with the new reasons', (() => { const a = H.trustAlert(e(87, 87, ['Asks for the terminal']), 70, ['Asks for the terminal', 'Not changed for 2 years']); return a?.kind === 'dropped' && a.from === 87 && a.to === 70 && a.newReasons.join() === 'Not changed for 2 years'; })());
	check('a smaller drop, no change and a rise are not worth a notice', H.trustAlert(e(87, 87), 78, []) === undefined && H.trustAlert(e(80, 80), 80, []) === undefined && H.trustAlert(e(60, 60), 95, []) === undefined);
	check('falling into risky is said even when the fall is small', H.trustAlert(e(52, 52), 48, [])?.kind === 'now-risky' && H.trustAlert(e(40, 40), 35, []) === undefined);
	check('the first score is kept and the last one replaces the last', (() => { let h = H.recordScore({}, 'a', 80, ['r'], 5); h = H.recordScore(h, 'a', 60, [], 9); return h.a.first === 80 && h.a.score === 60 && h.a.at === 9; })());
	check('the history keeps at most 400 add-ons, dropping the oldest', (() => { let h = {}; for (let i = 0; i < 450; i++) h = H.recordScore(h, `k${i}`, 50, [], i); return Object.keys(h).length === 400 && !h.k0 && !!h.k449; })());
	check('a stored history is read back and nonsense is dropped', (() => { const h = H.parseTrustHistory({ a: { first: 1, score: 2, at: 3, against: ['x', 5] }, b: { first: 'no' }, c: 7 }); return Object.keys(h).join() === 'a' && h.a.against.join() === 'x'; })() && Object.keys(H.parseTrustHistory(null)).length === 0);
	check('the reasons against are the ones that took points', H.labelsAgainst([{ label: 'a', points: 5 }, { label: 'b', points: -3 }, { label: 'c', points: 0 }]).join() === 'b');

	if (process.argv.includes('--live')) {
		const get = async (u) => (await fetch(u, { headers: { Accept: 'application/json' } })).json();
		check('LIVE skills.sh answers', P.parseSkillsSh(await get('https://skills.sh/api/search?q=pdf')).length > 0);
		check('LIVE Smithery answers', P.parseSmithery(await get('https://registry.smithery.ai/servers?q=github&pageSize=3')).length > 0);
		check('LIVE npm answers', P.parseNpmSearch(await get('https://registry.npmjs.org/-/v1/search?text=keywords:mcp-server&size=3')).length > 0);
		check('LIVE GitHub topic search answers', P.parseGithubSearch(await get('https://api.github.com/search/repositories?q=topic:mcp-server&sort=stars&per_page=3')).length > 0);
	}
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
