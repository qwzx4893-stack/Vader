/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A message is looked at before it leaves the computer (board S02, "A secret in the text"): if it contains what looks like a key, it is not sent, and the person
// is told which kind and which end of it, never the whole value. The patterns are the shapes the providers document; a long random string alone is not a key.

export type SecretHit = {
	readonly kind: string;
	/** the value with its middle hidden: the first characters and the last four */
	readonly masked: string;
	readonly index: number;
};

const PATTERNS: { kind: string, re: RegExp }[] = [
	{ kind: 'an Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
	{ kind: 'an OpenRouter key', re: /\bsk-or-v1-[A-Za-z0-9]{20,}/g },
	{ kind: 'an OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
	{ kind: 'a GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
	{ kind: 'a GitHub token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
	{ kind: 'an AWS access key', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
	{ kind: 'a Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
	{ kind: 'a Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
	{ kind: 'a Stripe key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/g },
	{ kind: 'a private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
	{ kind: 'a Groq key', re: /\bgsk_[A-Za-z0-9]{40,}/g },
	{ kind: 'an xAI key', re: /\bxai-[A-Za-z0-9]{40,}/g },
];

export function maskSecret(value: string): string {
	if (value.length <= 12) return value.slice(0, 2) + '…';
	return `${value.slice(0, 5)}…${value.slice(-4)}`;
}

/** every key-like value in the text, once each, in the order they appear */
export function findSecrets(text: string): SecretHit[] {
	const hits: SecretHit[] = [];
	const taken: [number, number][] = [];
	for (const { kind, re } of PATTERNS) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) {
			const start = m.index, end = start + m[0].length;
			if (taken.some(([a, b]) => start < b && end > a)) continue; // a more specific pattern already took it
			taken.push([start, end]);
			hits.push({ kind, masked: kind === 'a private key' ? 'BEGIN PRIVATE KEY' : maskSecret(m[0]), index: start });
		}
	}
	return hits.sort((a, b) => a.index - b.index);
}

/** the text with each key replaced by its masked form, for showing the person what would have gone */
export function redactSecrets(text: string): string {
	let out = text;
	const spans: { s: number, e: number, m: string }[] = [];
	for (const { re } of PATTERNS) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) { if (!spans.some(x => m!.index < x.e && m!.index + m![0].length > x.s)) spans.push({ s: m.index, e: m.index + m[0].length, m: maskSecret(m[0]) }); }
	}
	for (const sp of spans.sort((a, b) => b.s - a.s)) out = out.slice(0, sp.s) + sp.m + out.slice(sp.e);
	return out;
}
