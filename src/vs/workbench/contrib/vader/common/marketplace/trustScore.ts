/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A trust score from 0 to 100 for something a person can install: a skill, an MCP server, a coding agent.
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
	readonly kind: 'skill' | 'mcp' | 'agent';
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
	/** an explicit decision by the user always wins */
	readonly userTrustState?: 'trusted' | 'review_required' | 'blocked';
};

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

export function computeTrust(i: TrustInputs): TrustScore {
	if (i.userTrustState === 'blocked') {
		return { score: 0, level: 'low', factors: [{ label: 'You blocked it', points: 0 }] };
	}
	const factors: TrustFactor[] = [{ label: 'Starting point', points: TRUST_BASE }];
	let score = TRUST_BASE;
	const add = (label: string, points: number) => { factors.push({ label, points }); score += points; };

	const publisher = (i.publisher ?? '').toLowerCase();
	if (!publisher) add('Publisher is unknown', -10);
	else if (KNOWN_PUBLISHERS.has(publisher)) add(`Published by ${i.publisher}, a known organisation`, 20);
	else add(`Published by ${i.publisher}, not on the known list`, -5);

	if (i.signatureVerified) add('Signature was verified', 5);
	else if (i.kind !== 'skill') add('No signature to check', -5);

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
	if (i.kind !== 'skill' && i.runsLocalCode) add('Runs a program on this computer', -8);
	if (i.kind !== 'skill' && i.runsLocalCode === false) add('Remote server, nothing runs here', 5);
	if (i.changedSinceReview) add('Changed since you last read it', -15);
	if (i.userTrustState === 'trusted') add('You marked it as trusted', 10);

	score = Math.max(0, Math.min(100, Math.round(score)));
	return { score, level: trustLevelOf(score), factors };
}

function formatCount(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n);
}
