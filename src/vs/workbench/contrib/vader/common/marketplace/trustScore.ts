/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A trust score from 0 to 100 for something a person can install: a skill, an MCP server, a coding agent.
//
// It is computed again every time an item is listed or opened, from what the live sources say at that moment (stars, when the repository was
// last changed, its licence, how many people install it, what its text asks for); there is no ready-made number stored anywhere. A watcher in
// the app computes it again for what is installed and tells the person when it falls (see browser/trustMonitor.ts).
//
// What it is: a plain, explainable heuristic. Every point it adds or takes away comes with a reason the UI can show
// ("Publisher is unknown, -10"). It starts from a base and moves with what can actually be observed: who published it, how many
// people starred it, what its instructions ask for, and whether the text has patterns that are common in malicious skills.
//
// What it is not: a security scan. A high score does not mean a skill is safe, and installing still asks the user first; the
// agent's own Policy Engine still checks every command it runs. The score only helps a person decide what to read first.
// The three trust states a skill can have in skillServiceTypes.ts (trusted, review_required, blocked) are a separate, explicit
// decision by the user and always win over the score.

export type TrustLevel = 'high' | 'medium' | 'low';

export type TrustFactor = {
	readonly label: string;
	/** points added (positive) or taken away (negative); 0 for a neutral observation */
	readonly points: number;
};

export type TrustScore = {
	readonly score: number;
	readonly level: TrustLevel;
	readonly factors: readonly TrustFactor[];
};

export type TrustInputs = {
	/** 'skill' text is instructions the model reads; 'mcp' and 'agent' run code on this computer */
	readonly kind: 'skill' | 'mcp' | 'agent' | 'extension';
	/** owner or organisation, for example "anthropics" for github.com/anthropics/skills */
	readonly publisher?: string;
	/** stars of the repository it comes from, when known */
	readonly stars?: number;
	/** true only when a signature or checksum was actually verified */
	readonly signatureVerified?: boolean;
	/** the instructions text of a skill, when it has been fetched */
	readonly instructions?: string;
	/** a remote MCP server (an https address) needs nothing installed; a package runs code here */
	readonly runsLocalCode?: boolean;
	/** the instructions changed since the user last reviewed them */
	readonly changedSinceReview?: boolean;
	// for an extension (what the gallery says about it)
	/** the publisher proved it owns its domain */
	readonly publisherVerified?: boolean;
	/** how many times it was installed */
	readonly installs?: number;
	readonly rating?: number;
	readonly ratingCount?: number;
	/** the gallery flagged it as malicious */
	readonly flaggedMalicious?: boolean;
	/** an explicit decision by the user always wins */
	readonly userTrustState?: 'trusted' | 'review_required' | 'blocked';
	// live signals: whatever the sources said when the score was computed. Missing means "not known", which is not scored either way.
	/** the name it is listed under, to notice a copy of a well-known one */
	readonly name?: string;
	readonly forks?: number;
	/** when the repository last changed (ISO date) */
	readonly pushedAt?: string;
	readonly createdAt?: string;
	readonly archived?: boolean;
	/** an SPDX id; null means the repository is known to declare none, undefined means not known */
	readonly license?: string | null;
	readonly ownerType?: 'Organization' | 'User';
	/** installs counted by the source that lists it (skills.sh installs, Smithery uses) */
	readonly sourceInstalls?: number;
	/** npm downloads in the last week */
	readonly weeklyDownloads?: number;
	/** published from a CI workflow under npm's trusted-publisher identity */
	readonly trustedPublisher?: boolean;
	/** the source says it is no longer maintained */
	readonly deprecated?: boolean;
	/** how many different sources list it; two that list the same thing corroborate each other */
	readonly listedBy?: number;
	/** the package runs a script when it is installed */
	readonly installScripts?: boolean;
	/** how many secrets (keys, tokens) it asks the person to give it */
	readonly secretsRequested?: number;
	/** the moment to measure ages from; the clock, unless a test says otherwise */
	readonly now?: number;
};

// Names people look for, and who really publishes them. Anyone can publish a server called "github" to a public registry; this list
// is what makes a copy visible.
const WELL_KNOWN_NAMES: { readonly [name: string]: readonly string[] } = {
	github: ['github'], stripe: ['stripe'], playwright: ['microsoft'], filesystem: ['modelcontextprotocol'], postgres: ['modelcontextprotocol', 'supabase'],
	slack: ['slackapi', 'modelcontextprotocol'], notion: ['notionhq', 'makenotion'], linear: ['linear'], sentry: ['getsentry', 'sentry'], puppeteer: ['modelcontextprotocol'],
	context7: ['upstash'], figma: ['figma'], cloudflare: ['cloudflare'], docker: ['docker'], mongodb: ['mongodb', 'mongodb-js'], supabase: ['supabase', 'supabase-community'],
};

const editDistance = (a: string, b: string): number => {
	const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let diag = prev[0]; prev[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const keep = prev[j];
			prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
			diag = keep;
		}
	}
	return prev[b.length];
};

/** the core of a listing's name: "io.github.acme/Github-MCP-Server" -> "github" */
const coreName = (name: string): string => (name.split('/').pop() ?? name).toLowerCase().replace(/[-_. ]?(mcp|server|official)\b/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Whether a name copies a well-known one: the same name from someone who is not its publisher, or a name one or two letters away from it
 * ("githab", "striipe"). Returns what it copies, or undefined.
 */
export function lookalikeOf(name: string | undefined, publisher: string | undefined): { readonly of: string; readonly kind: 'same-name' | 'near-name' } | undefined {
	if (!name) return undefined;
	const core = coreName(name);
	if (core.length < 4) return undefined;
	const pub = (publisher ?? '').toLowerCase();
	for (const [known, owners] of Object.entries(WELL_KNOWN_NAMES)) {
		if (core === known) return owners.includes(pub) || KNOWN_PUBLISHERS.has(pub) ? undefined : { of: known, kind: 'same-name' };
		if (core.length >= 5 && known.length >= 5 && editDistance(core, known) <= 2 && !owners.includes(pub)) return { of: known, kind: 'near-name' };
	}
	return undefined;
}

const DAY_MS = 86_400_000;
function ageText(days: number): string {
	if (days < 60) return `${Math.max(1, Math.round(days))} days`;
	if (days < 700) return `${Math.round(days / 30)} months`;
	return `${(days / 365).toFixed(1).replace(/\.0$/, '')} years`;
}

export const TRUST_BASE = 70;
export const TRUST_HIGH_FROM = 80;
export const TRUST_MEDIUM_FROM = 50;

/**
 * Publishers whose repositories are well known and maintained by a company or a standards body. This is a short, conservative
 * list; being on it adds points, being absent only removes a few. Owners are compared in lower case.
 */
export const KNOWN_PUBLISHERS: ReadonlySet<string> = new Set([
	'anthropics', 'modelcontextprotocol', 'openai', 'microsoft', 'github', 'google', 'googlechrome', 'vercel', 'cloudflare', 'stripe',
	'aws', 'awslabs', 'hashicorp', 'docker', 'mongodb', 'redis', 'supabase', 'sentry', 'getsentry', 'linear', 'notionhq', 'slackapi',
]);

export function trustLevelOf(score: number): TrustLevel {
	return score >= TRUST_HIGH_FROM ? 'high' : score >= TRUST_MEDIUM_FROM ? 'medium' : 'low';
}

// Patterns that are common in skills written to do harm. Each one is looked for in the instructions text. They are signals to read the
// text, not proof; a legitimate deploy skill can contain "sudo" too, which is why each one costs points instead of blocking.
const RISKY_PATTERNS: readonly { readonly re: RegExp; readonly label: string; readonly points: number }[] = [
	{ re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b|\b(irm|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*iex\b/i, label: 'Pipes a download straight into a shell', points: -25 },
	{ re: /\bsudo\b|\brunas\b|\bchmod\s+(-R\s+)?7[0-7][0-7]\b/i, label: 'Asks for elevated privileges', points: -12 },
	{ re: /\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME|\*)|\bformat\s+[a-z]:|\bdel\s+\/[sq]/i, label: 'Contains a command that deletes broadly', points: -25 },
	{ re: /\b(base64\s+(-d|--decode)|atob\(|frombase64string)\b/i, label: 'Decodes hidden text', points: -15 },
	{ re: /ignore (all )?(the )?(previous|prior|above) (instructions|rules)|disregard (all )?(previous|prior) (instructions|rules)|do not (tell|inform) the user/i, label: 'Tries to override earlier instructions or hide things from you', points: -25 },
	{ re: /[​-‏‪-‮⁠-⁤﻿]/, label: 'Contains invisible characters', points: -15 },
	{ re: /\.(ssh|aws|gnupg)\/|\bid_rsa\b|\.env\b|credentials\.json|\bapi[_-]?key\b.{0,20}(send|post|upload|curl)/i, label: 'Mentions keys or credentials next to a transfer', points: -12 },
];

/** what a skill's text asks for; the same heuristic the skill service stores as requestedCapabilities, kept here so the score does not depend on it */
function requestedFrom(text: string): { fs: boolean; terminal: boolean; network: boolean; mcp: boolean } {
	const t = text.toLowerCase();
	return {
		fs: /\b(read|write|edit|create|delete)\s+(a\s+)?file|file system|filesystem/.test(t),
		terminal: /\bterminal|\bshell|\brun\s+(the\s+)?command|```(bash|sh|shell)|npm (install|run)|pip install|\bcurl /.test(t),
		network: /https?:\/\/(?!github\.com|raw\.githubusercontent\.com|localhost)|\bwebhook|\bfetch\(/.test(t),
		mcp: /\bmcp\b|model context protocol/.test(t),
	};
}

/** what a skill's text asks for, for the skill's own page */
export const skillAsks = (text: string): { fs: boolean; terminal: boolean; network: boolean; mcp: boolean } => requestedFrom(text);

export function computeTrust(i: TrustInputs): TrustScore {
	if (i.userTrustState === 'blocked' || i.flaggedMalicious) {
		return { score: 0, level: 'low', factors: [{ label: i.flaggedMalicious ? 'The gallery flags it as malicious' : 'You blocked it', points: 0 }] };
	}
	const factors: TrustFactor[] = [{ label: 'Starting point', points: TRUST_BASE }];
	let score = TRUST_BASE;
	const add = (label: string, points: number) => { factors.push({ label, points }); score += points; };

	const publisher = (i.publisher ?? '').toLowerCase();
	if (!publisher) add('Publisher is unknown', -10);
	else if (KNOWN_PUBLISHERS.has(publisher)) add(`Published by ${i.publisher}, a known organisation`, 20);
	else add(`Published by ${i.publisher}, not on the known list`, -5);

	if (i.publisherVerified) add('The publisher proved it owns its domain', 12);
	if (i.signatureVerified) add('Signature was verified', 5);
	else if (i.kind !== 'skill' && i.kind !== 'extension') add('No signature to check', -5); // an extension's signature is the gallery's business; the settings page says that checking is off for Open VSX

	if (i.kind === 'extension') {
		if (typeof i.installs === 'number') {
			if (i.installs >= 1_000_000) add(`Installed ${formatCount(i.installs)} times`, 8);
			else if (i.installs >= 100_000) add(`Installed ${formatCount(i.installs)} times`, 4);
			else if (i.installs < 1000) add(`Installed only ${i.installs} times`, -8);
		}
		if (typeof i.rating === 'number' && (i.ratingCount ?? 0) >= 10) {
			if (i.rating >= 4) add(`Rated ${i.rating.toFixed(1)} by ${i.ratingCount} people`, 4);
			else if (i.rating < 3) add(`Rated only ${i.rating.toFixed(1)} by ${i.ratingCount} people`, -6);
		}
		add('Runs code inside the editor', -5);
	}

	// ---- live signals
	const now = i.now ?? Date.now();
	if (i.deprecated) add('The source says it is no longer maintained', -25);
	if (i.archived) add('The repository is archived: no one is maintaining it', -20);
	if (i.pushedAt && !i.archived) {
		const t = Date.parse(i.pushedAt);
		if (Number.isFinite(t)) {
			const days = (now - t) / DAY_MS;
			if (days <= 90) add(`Changed ${ageText(days)} ago`, 3);
			else if (days > 730) add(`Not changed for ${ageText(days)}`, -12);
			else if (days > 365) add(`Not changed for ${ageText(days)}`, -6);
		}
	}
	if (i.createdAt) {
		const t = Date.parse(i.createdAt);
		if (Number.isFinite(t) && (now - t) / DAY_MS < 30) add(`The repository is only ${ageText((now - t) / DAY_MS)} old`, -6);
	}
	if (i.license === null) add('Declares no licence', -4);
	else if (typeof i.license === 'string') add(`Licence: ${i.license}`, 2);
	if (i.ownerType === 'Organization' && !KNOWN_PUBLISHERS.has(publisher)) add('Owned by an organisation, not a single account', 2);
	if (typeof i.sourceInstalls === 'number' && i.kind !== 'extension') {
		const [hi, mid, low] = i.kind === 'skill' ? [100_000, 10_000, 1_000] : [5_000, 500, 50];
		if (i.sourceInstalls >= hi) add(`Installed ${formatCount(i.sourceInstalls)} times`, 10);
		else if (i.sourceInstalls >= mid) add(`Installed ${formatCount(i.sourceInstalls)} times`, 6);
		else if (i.sourceInstalls >= low) add(`Installed ${formatCount(i.sourceInstalls)} times`, 3);
		else add(`Installed only ${i.sourceInstalls} times`, -3);
	}
	if (typeof i.weeklyDownloads === 'number') {
		if (i.weeklyDownloads >= 100_000) add(`${formatCount(i.weeklyDownloads)} downloads a week`, 8);
		else if (i.weeklyDownloads >= 10_000) add(`${formatCount(i.weeklyDownloads)} downloads a week`, 5);
		else if (i.weeklyDownloads >= 1_000) add(`${formatCount(i.weeklyDownloads)} downloads a week`, 2);
		else if (i.weeklyDownloads < 100) add(`Only ${i.weeklyDownloads} downloads a week`, -5);
	}
	if (i.trustedPublisher) add('Published from a CI workflow with provenance', 4);
	if (i.installScripts) add('Runs a script when it is installed', -10);
	if (typeof i.secretsRequested === 'number' && i.secretsRequested > 0) add(`Asks you for ${i.secretsRequested} secret${i.secretsRequested === 1 ? '' : 's'}`, 0);
	if (typeof i.listedBy === 'number' && i.listedBy >= 2) add(`Listed by ${i.listedBy} different sources`, i.listedBy >= 3 ? 6 : 4);
	const copy = lookalikeOf(i.name, i.publisher);
	if (copy) add(copy.kind === 'same-name' ? `Uses the name "${copy.of}" but is not published by its owner` : `Its name is a letter or two away from "${copy.of}"`, copy.kind === 'same-name' ? -12 : -20);

	if (typeof i.stars === 'number') {
		if (i.stars >= 1000) add(`${formatCount(i.stars)} stars`, 5);
		else if (i.stars >= 100) add(`${i.stars} stars`, 2);
		else if (i.stars < 10) add(`Only ${i.stars} stars`, -5);
	}

	if (i.kind === 'skill' && i.instructions !== undefined) {
		const req = requestedFrom(i.instructions);
		if (req.terminal) add('Asks for the terminal', -8);
		if (req.network) add('Asks for the network', -8);
		if (req.fs && !req.terminal && !req.network) add('Asks for files only', -3);
		if (req.mcp) add('Mentions MCP tools', -3);
		for (const p of RISKY_PATTERNS) { if (p.re.test(i.instructions)) add(p.label, p.points); }
		if (i.instructions.length > 100_000) add('Very long instructions are hard to read in full', -5);
		if (!req.terminal && !req.network && !RISKY_PATTERNS.some(p => p.re.test(i.instructions!))) add('Plain instructions, nothing unusual', 4);
	}
	if (i.kind !== 'skill' && i.kind !== 'extension' && i.runsLocalCode) add('Runs a program on this computer', -8);
	if (i.kind !== 'skill' && i.kind !== 'extension' && i.runsLocalCode === false) add('Remote server, nothing runs here', 5);
	if (i.changedSinceReview) add('Changed since you last read it', -15);
	if (i.userTrustState === 'trusted') add('You marked it as trusted', 10);

	score = Math.max(0, Math.min(100, Math.round(score)));
	return { score, level: trustLevelOf(score), factors };
}

function formatCount(n: number): string {
	if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M` }
	return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);
}
