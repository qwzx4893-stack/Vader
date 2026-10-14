/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What the trust monitor remembers about each installed add-on: the score the first time it was seen, the last one, and the reasons that
// were behind it. Remembering is what lets Vader say "it was 87% and now it is 61%, because it has not changed for 2 years" instead of just
// showing a number. Pure functions, so the rules for when to speak up are tested.

export type TrustHistoryEntry = {
	/** the score the first time the monitor saw it */
	readonly first: number;
	readonly score: number;
	/** when it was last scored (ms since 1970) */
	readonly at: number;
	/** the labels of what counted against it at the last scoring */
	readonly against: readonly string[];
};

export type TrustHistory = { readonly [key: string]: TrustHistoryEntry | undefined };

export const TRUST_HISTORY_STORAGE_KEY = 'vader.trust.history';
const MAX_ENTRIES = 400;

export function parseTrustHistory(raw: unknown): TrustHistory {
	if (!raw || typeof raw !== 'object') return {};
	const out: { [k: string]: TrustHistoryEntry } = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		const e = v as Partial<TrustHistoryEntry> | null;
		if (e && typeof e.first === 'number' && typeof e.score === 'number' && typeof e.at === 'number' && Array.isArray(e.against)) {
			out[k] = { first: e.first, score: e.score, at: e.at, against: e.against.filter((x): x is string => typeof x === 'string') };
		}
	}
	return out;
}

/** the labels of the factors that took points away; the notice names the new ones */
export const labelsAgainst = (factors: readonly { label: string; points: number }[]): string[] => factors.filter(f => f.points < 0).map(f => f.label);

export type TrustAlert = {
	readonly from: number;
	readonly to: number;
	/** what counts against it now that did not at the last scoring, in the order the score lists them */
	readonly newReasons: readonly string[];
	readonly kind: 'dropped' | 'now-risky';
};

/**
 * Whether a new score deserves a notice. It does when the score fell by ten points or more since the last time, or when it fell into "risky"
 * (under 50) from somewhere above it. A rise, a small change, and the first time an add-on is seen are not worth interrupting anyone for.
 */
export function trustAlert(prev: TrustHistoryEntry | undefined, score: number, against: readonly string[]): TrustAlert | undefined {
	if (!prev) return undefined;
	const newReasons = against.filter(l => !prev.against.includes(l));
	if (prev.score >= 50 && score < 50) return { from: prev.score, to: score, newReasons, kind: 'now-risky' };
	if (prev.score - score >= 10) return { from: prev.score, to: score, newReasons, kind: 'dropped' };
	return undefined;
}

export function recordScore(history: TrustHistory, key: string, score: number, against: readonly string[], at: number): TrustHistory {
	const prev = history[key];
	const next: { [k: string]: TrustHistoryEntry | undefined } = { ...history, [key]: { first: prev?.first ?? score, score, at, against } };
	const keys = Object.keys(next);
	if (keys.length > MAX_ENTRIES) {
		for (const k of keys.sort((a, b) => (next[a]?.at ?? 0) - (next[b]?.at ?? 0)).slice(0, keys.length - MAX_ENTRIES)) delete next[k];
	}
	return next;
}
