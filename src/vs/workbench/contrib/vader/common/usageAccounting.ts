/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What a task cost: tokens read from each provider's own answer, priced with the model's list price, added up per task and per day.
//
// Two rules keep the numbers honest:
//  - A price that is not known is not shown as zero. A cloud model whose price Vader does not have counts as an "unpriced turn", and the
//    totals say how many there were, so "$0.31" never hides a turn it could not price. Only a local model is free.
//  - The tokens come from the provider's answer. When a provider sends none (some OpenAI-compatible servers), the turn is counted as
//    "without usage" instead of being guessed from the text.

export type TokenUsage = {
	readonly inputTokens: number;
	readonly outputTokens: number;
	/** the part of inputTokens the provider served from its prompt cache, when it says so */
	readonly cachedInputTokens?: number;
};

/** US dollars per million tokens, as in modelCapabilities.ts */
export type ModelPrice = { readonly input: number; readonly output: number; readonly cache_read?: number };

export type ThreadUsage = {
	readonly turns: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cachedInputTokens: number;
	/** dollars for the turns that could be priced */
	readonly costUsd: number;
	/** turns whose model has no known price */
	readonly unpricedTurns: number;
	/** turns where the provider sent no token counts */
	readonly turnsWithoutUsage: number;
};

export const EMPTY_THREAD_USAGE: ThreadUsage = { turns: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, unpricedTurns: 0, turnsWithoutUsage: 0 };

const finiteNonNegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** a usage object from whatever a provider sent; anything that is not a pair of counts gives undefined */
export function normalizeUsage(raw: { inputTokens?: unknown; outputTokens?: unknown; cachedInputTokens?: unknown } | null | undefined): TokenUsage | undefined {
	if (!raw || !finiteNonNegative(raw.inputTokens) || !finiteNonNegative(raw.outputTokens)) return undefined;
	const cached = finiteNonNegative(raw.cachedInputTokens) ? Math.min(raw.cachedInputTokens, raw.inputTokens) : undefined;
	return { inputTokens: Math.round(raw.inputTokens), outputTokens: Math.round(raw.outputTokens), ...(cached !== undefined ? { cachedInputTokens: Math.round(cached) } : {}) };
}

/**
 * Dollars for one turn. A local model is free (0). A cloud model with no price (both rates zero, which is what an unrecognised model name
 * falls back to) gives undefined: unknown, not free.
 */
export function costOfUsage(usage: TokenUsage, price: ModelPrice | undefined, isLocal: boolean): number | undefined {
	if (isLocal) return 0;
	if (!price || (price.input === 0 && price.output === 0)) return undefined;
	const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
	const fresh = usage.inputTokens - cached;
	const perM = 1_000_000;
	return (fresh * price.input + cached * (price.cache_read ?? price.input) + usage.outputTokens * price.output) / perM;
}

export function addTurnToThreadUsage(prev: ThreadUsage | undefined, usage: TokenUsage | undefined, cost: number | undefined): ThreadUsage {
	const p = prev ?? EMPTY_THREAD_USAGE;
	if (!usage) return { ...p, turns: p.turns + 1, turnsWithoutUsage: p.turnsWithoutUsage + 1 };
	return {
		turns: p.turns + 1,
		inputTokens: p.inputTokens + usage.inputTokens,
		outputTokens: p.outputTokens + usage.outputTokens,
		cachedInputTokens: p.cachedInputTokens + (usage.cachedInputTokens ?? 0),
		costUsd: p.costUsd + (cost ?? 0),
		unpricedTurns: p.unpricedTurns + (cost === undefined ? 1 : 0),
		turnsWithoutUsage: p.turnsWithoutUsage,
	};
}

// ---- per day

export type DayTotals = { readonly costUsd: number; readonly inputTokens: number; readonly outputTokens: number; readonly unpricedTurns: number };
export type UsageLedger = { readonly [day: string]: DayTotals | undefined };

const LEDGER_KEEP_DAYS = 62;

/** the local calendar day, yyyy-mm-dd: "today" is the person's today, not UTC's */
export function dayKey(date: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function addToLedger(ledger: UsageLedger, day: string, usage: TokenUsage | undefined, cost: number | undefined): UsageLedger {
	const d = ledger[day] ?? { costUsd: 0, inputTokens: 0, outputTokens: 0, unpricedTurns: 0 };
	const next: DayTotals = {
		costUsd: d.costUsd + (usage ? cost ?? 0 : 0),
		inputTokens: d.inputTokens + (usage?.inputTokens ?? 0),
		outputTokens: d.outputTokens + (usage?.outputTokens ?? 0),
		unpricedTurns: d.unpricedTurns + (usage && cost === undefined ? 1 : 0),
	};
	const merged: { [day: string]: DayTotals | undefined } = { ...ledger, [day]: next };
	const days = Object.keys(merged).sort();
	for (const old of days.slice(0, Math.max(0, days.length - LEDGER_KEEP_DAYS))) delete merged[old];
	return merged;
}

/** reads a ledger back from storage; anything that is not shaped like one is dropped rather than trusted */
export function parseLedger(raw: unknown): UsageLedger {
	if (!raw || typeof raw !== 'object') return {};
	const out: { [day: string]: DayTotals } = {};
	for (const [day, v] of Object.entries(raw as Record<string, unknown>)) {
		const t = v as Partial<DayTotals> | null;
		if (/^\d{4}-\d{2}-\d{2}$/.test(day) && t && finiteNonNegative(t.costUsd) && finiteNonNegative(t.inputTokens) && finiteNonNegative(t.outputTokens)) {
			out[day] = { costUsd: t.costUsd, inputTokens: t.inputTokens, outputTokens: t.outputTokens, unpricedTurns: finiteNonNegative(t.unpricedTurns) ? t.unpricedTurns : 0 };
		}
	}
	return out;
}

export const spentOn = (ledger: UsageLedger, day: string): number => ledger[day]?.costUsd ?? 0;

// ---- the daily limit

export type BudgetState = 'none' | 'ok' | 'near' | 'over';
/** the limit is optional: null or 0 means no limit. "near" starts at 80%. */
export function budgetState(spentUsd: number, limitUsd: number | null | undefined): BudgetState {
	if (!limitUsd || limitUsd <= 0) return 'none';
	if (spentUsd >= limitUsd) return 'over';
	return spentUsd >= limitUsd * 0.8 ? 'near' : 'ok';
}

export function formatUsd(n: number): string {
	if (n > 0 && n < 0.01) return '<$0.01';
	return `$${n.toFixed(2)}`;
}

export function formatTokens(n: number): string {
	return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}
