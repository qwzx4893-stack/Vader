/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What a task cost: tokens read from each provider's own answer, priced with the model's list price, added up per task and per day.
//
// Three rules keep the numbers honest:
//  - Tokens are a fact (the provider reported them). Money is a calculation, unless the provider reported what it charged (OpenRouter does):
//    then that amount is used and called "billed". Every other amount is an estimate from list prices, shown with "≈", and the person is
//    pointed to the provider's own usage page for the figure that is actually charged.
//  - A price that is not known is not shown as zero. A cloud model whose price Vader does not have counts as an "unpriced turn", and the
//    totals say how many there were, so "$0.31" never hides a turn it could not price. Only a local model is free.
//  - The tokens come from the provider's answer. When a provider sends none (some OpenAI-compatible servers), the turn is counted as
//    "without usage" instead of being guessed from the text.

export type TokenUsage = {
	readonly inputTokens: number;
	readonly outputTokens: number;
	/** the part of inputTokens the provider served from its prompt cache, when it says so */
	readonly cachedInputTokens?: number;
	/** the part of inputTokens written to the provider's prompt cache (Anthropic prices that above plain input), when it says so */
	readonly cacheWriteInputTokens?: number;
	/** what the provider says it charged for this request, in US dollars (OpenRouter sends it); when present it is used instead of an estimate */
	readonly reportedCostUsd?: number;
};

/** where an amount of money comes from */
export type CostSource = 'billed' | 'estimate' | 'free' | 'unpriced';

/** US dollars per million tokens, as in modelCapabilities.ts */
export type ModelPrice = { readonly input: number; readonly output: number; readonly cache_read?: number; readonly cache_write?: number };

export type ThreadUsage = {
	readonly turns: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cachedInputTokens: number;
	/** dollars for the turns that could be priced */
	readonly costUsd: number;
	/** the part of costUsd that providers reported as charged; the rest is an estimate from list prices (missing in threads saved before this existed) */
	readonly billedCostUsd?: number;
	/** turns whose model has no known price */
	readonly unpricedTurns: number;
	/** turns where the provider sent no token counts */
	readonly turnsWithoutUsage: number;
};

export const EMPTY_THREAD_USAGE: ThreadUsage = { turns: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0, billedCostUsd: 0, unpricedTurns: 0, turnsWithoutUsage: 0 };

const finiteNonNegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** a usage object from whatever a provider sent; anything that is not a pair of counts gives undefined */
export function normalizeUsage(raw: { inputTokens?: unknown; outputTokens?: unknown; cachedInputTokens?: unknown; cacheWriteInputTokens?: unknown; reportedCostUsd?: unknown } | null | undefined): TokenUsage | undefined {
	if (!raw || !finiteNonNegative(raw.inputTokens) || !finiteNonNegative(raw.outputTokens)) return undefined;
	const cached = finiteNonNegative(raw.cachedInputTokens) ? Math.min(raw.cachedInputTokens, raw.inputTokens) : undefined;
	const written = finiteNonNegative(raw.cacheWriteInputTokens) ? Math.min(raw.cacheWriteInputTokens, raw.inputTokens - (cached ?? 0)) : undefined;
	return {
		inputTokens: Math.round(raw.inputTokens), outputTokens: Math.round(raw.outputTokens),
		...(cached !== undefined ? { cachedInputTokens: Math.round(cached) } : {}),
		...(written !== undefined && written > 0 ? { cacheWriteInputTokens: Math.round(written) } : {}),
		...(finiteNonNegative(raw.reportedCostUsd) ? { reportedCostUsd: raw.reportedCostUsd } : {}),
	};
}

/**
 * Dollars for one turn. A local model is free (0). A cloud model with no price (both rates zero, which is what an unrecognised model name
 * falls back to) gives undefined: unknown, not free.
 */
export function costOfUsage(usage: TokenUsage, price: ModelPrice | undefined, isLocal: boolean): number | undefined {
	if (isLocal) return 0;
	if (!price || (price.input === 0 && price.output === 0)) return undefined;
	const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
	const written = Math.min(usage.cacheWriteInputTokens ?? 0, usage.inputTokens - cached);
	const fresh = usage.inputTokens - cached - written;
	const perM = 1_000_000;
	return (fresh * price.input + cached * (price.cache_read ?? price.input) + written * (price.cache_write ?? price.input) + usage.outputTokens * price.output) / perM;
}

/** the person's own prices, for a contract or a model Vader does not know (Settings > Usage and cost) */
export type PriceSettings = {
	/** a flat percentage taken off every list price, 0 to 100 */
	readonly discountPercent?: number;
	/** US dollars per million tokens by model name; replaces the built-in price of that model */
	readonly overrides?: { readonly [modelName: string]: ModelPrice | undefined };
};

/**
 * One turn: its money and where the money comes from.
 *  - a local model is free
 *  - the amount the provider says it charged is used as it is ("billed")
 *  - otherwise tokens times the person's own price for the model, or the built-in list price, less the person's discount ("estimate")
 *  - no price anywhere is "unpriced", never zero
 */
export function priceTurn(usage: TokenUsage, builtIn: ModelPrice | undefined, isLocal: boolean, modelName: string, settings?: PriceSettings): { costUsd: number | undefined; source: CostSource } {
	if (isLocal) return { costUsd: 0, source: 'free' };
	if (usage.reportedCostUsd !== undefined) return { costUsd: usage.reportedCostUsd, source: 'billed' };
	const own = settings?.overrides?.[modelName];
	const estimate = costOfUsage(usage, own ?? builtIn, false);
	if (estimate === undefined) return { costUsd: undefined, source: 'unpriced' };
	const d = settings?.discountPercent;
	const factor = d !== undefined && Number.isFinite(d) && d > 0 && d <= 100 ? 1 - d / 100 : 1;
	return { costUsd: estimate * factor, source: 'estimate' };
}

export function addTurnToThreadUsage(prev: ThreadUsage | undefined, usage: TokenUsage | undefined, cost: number | undefined, source?: CostSource): ThreadUsage {
	const p = prev ?? EMPTY_THREAD_USAGE;
	if (!usage) return { ...p, turns: p.turns + 1, turnsWithoutUsage: p.turnsWithoutUsage + 1 };
	return {
		turns: p.turns + 1,
		inputTokens: p.inputTokens + usage.inputTokens,
		outputTokens: p.outputTokens + usage.outputTokens,
		cachedInputTokens: p.cachedInputTokens + (usage.cachedInputTokens ?? 0),
		costUsd: p.costUsd + (cost ?? 0),
		billedCostUsd: (p.billedCostUsd ?? 0) + (source === 'billed' ? cost ?? 0 : 0),
		unpricedTurns: p.unpricedTurns + (cost === undefined ? 1 : 0),
		turnsWithoutUsage: p.turnsWithoutUsage,
	};
}

// ---- per day

/** what one model used in one day; kept so Settings can say which model the money went to */
export type ModelDayTotals = { readonly providerName: string; readonly modelName: string; readonly isLocal: boolean; readonly turns: number; readonly costUsd: number; readonly billedCostUsd: number; readonly inputTokens: number; readonly outputTokens: number; readonly unpricedTurns: number };
export type DayTotals = { readonly costUsd: number; readonly billedCostUsd?: number; readonly inputTokens: number; readonly outputTokens: number; readonly unpricedTurns: number; readonly models?: { readonly [key: string]: ModelDayTotals | undefined } };
export type UsageLedger = { readonly [day: string]: DayTotals | undefined };

const LEDGER_KEEP_DAYS = 62;

/** the local calendar day, yyyy-mm-dd: "today" is the person's today, not UTC's */
export function dayKey(date: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function addToLedger(ledger: UsageLedger, day: string, usage: TokenUsage | undefined, cost: number | undefined, source?: CostSource, model?: { providerName: string; modelName: string; isLocal: boolean }): UsageLedger {
	const d = ledger[day] ?? { costUsd: 0, billedCostUsd: 0, inputTokens: 0, outputTokens: 0, unpricedTurns: 0 };
	let models = d.models;
	if (model && usage) {
		const key = `${model.providerName}/${model.modelName}`;
		const m = models?.[key] ?? { providerName: model.providerName, modelName: model.modelName, isLocal: model.isLocal, turns: 0, costUsd: 0, billedCostUsd: 0, inputTokens: 0, outputTokens: 0, unpricedTurns: 0 };
		models = { ...models, [key]: { ...m, turns: m.turns + 1, costUsd: m.costUsd + (cost ?? 0), billedCostUsd: m.billedCostUsd + (source === 'billed' ? cost ?? 0 : 0), inputTokens: m.inputTokens + usage.inputTokens, outputTokens: m.outputTokens + usage.outputTokens, unpricedTurns: m.unpricedTurns + (cost === undefined ? 1 : 0) } };
	}
	const next: DayTotals = {
		...(models ? { models } : {}),
		costUsd: d.costUsd + (usage ? cost ?? 0 : 0),
		billedCostUsd: (d.billedCostUsd ?? 0) + (usage && source === 'billed' ? cost ?? 0 : 0),
		inputTokens: d.inputTokens + (usage?.inputTokens ?? 0),
		outputTokens: d.outputTokens + (usage?.outputTokens ?? 0),
		unpricedTurns: d.unpricedTurns + (usage && cost === undefined ? 1 : 0),
	};
	const merged: { [day: string]: DayTotals | undefined } = { ...ledger, [day]: next };
	const days = Object.keys(merged).sort();
	for (const old of days.slice(0, Math.max(0, days.length - LEDGER_KEEP_DAYS))) delete merged[old];
	return merged;
}

function parseModelTotals(raw: unknown): { [key: string]: ModelDayTotals } | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const out: { [key: string]: ModelDayTotals } = {};
	for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
		const m = v as Partial<ModelDayTotals> | null;
		if (m && typeof m.providerName === 'string' && typeof m.modelName === 'string' && finiteNonNegative(m.costUsd) && finiteNonNegative(m.inputTokens) && finiteNonNegative(m.outputTokens)) {
			out[key] = { providerName: m.providerName, modelName: m.modelName, isLocal: m.isLocal === true, turns: finiteNonNegative(m.turns) ? m.turns : 0, costUsd: m.costUsd, billedCostUsd: finiteNonNegative(m.billedCostUsd) ? m.billedCostUsd : 0, inputTokens: m.inputTokens, outputTokens: m.outputTokens, unpricedTurns: finiteNonNegative(m.unpricedTurns) ? m.unpricedTurns : 0 };
		}
	}
	return Object.keys(out).length ? out : undefined;
}

/** reads a ledger back from storage; anything that is not shaped like one is dropped rather than trusted */
export function parseLedger(raw: unknown): UsageLedger {
	if (!raw || typeof raw !== 'object') return {};
	const out: { [day: string]: DayTotals } = {};
	for (const [day, v] of Object.entries(raw as Record<string, unknown>)) {
		const t = v as Partial<DayTotals> | null;
		if (/^\d{4}-\d{2}-\d{2}$/.test(day) && t && finiteNonNegative(t.costUsd) && finiteNonNegative(t.inputTokens) && finiteNonNegative(t.outputTokens)) {
			const models = parseModelTotals(t.models);
			out[day] = { costUsd: t.costUsd, ...(finiteNonNegative(t.billedCostUsd) ? { billedCostUsd: t.billedCostUsd } : {}), inputTokens: t.inputTokens, outputTokens: t.outputTokens, unpricedTurns: finiteNonNegative(t.unpricedTurns) ? t.unpricedTurns : 0, ...(models ? { models } : {}) };
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

/**
 * The amount as the person should read it: with "≈" in front when any of it is an estimate, plainly when the provider billed all of it.
 * "≈ $0.31" says "worked out from list prices"; "$0.12" says "the provider reported this charge".
 */
export function formatCost(costUsd: number, billedUsd: number | undefined): string {
	const allBilled = costUsd > 0 && (billedUsd ?? 0) >= costUsd - 1e-9;
	return allBilled ? formatUsd(costUsd) : `≈ ${formatUsd(costUsd)}`;
}

/** the page where a provider shows what it really charged, for "check it against the provider" */
export const PROVIDER_USAGE_PAGES: { readonly [providerName: string]: { label: string; url: string } | undefined } = {
	anthropic: { label: 'Anthropic Console', url: 'https://platform.claude.com/usage' },
	openAI: { label: 'OpenAI usage', url: 'https://platform.openai.com/usage' },
	openRouter: { label: 'OpenRouter activity', url: 'https://openrouter.ai/activity' },
	gemini: { label: 'Google AI Studio', url: 'https://aistudio.google.com/usage' },
	deepseek: { label: 'DeepSeek usage', url: 'https://platform.deepseek.com/usage' },
	xAI: { label: 'xAI Console', url: 'https://console.x.ai' },
	groq: { label: 'Groq usage', url: 'https://console.groq.com/dashboard/usage' },
	mistral: { label: 'Mistral usage', url: 'https://console.mistral.ai/usage' },
};

export function formatTokens(n: number): string {
	return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}

// ---- the last days, for Settings > Usage and cost

/** the last `days` local days ending today, oldest first, with what was spent on each (0 when nothing was) */
export function lastDays(ledger: UsageLedger, days: number, now: Date): { day: string; costUsd: number; inputTokens: number; outputTokens: number }[] {
	const out: { day: string; costUsd: number; inputTokens: number; outputTokens: number }[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
		const key = dayKey(d);
		const t = ledger[key];
		out.push({ day: key, costUsd: t?.costUsd ?? 0, inputTokens: t?.inputTokens ?? 0, outputTokens: t?.outputTokens ?? 0 });
	}
	return out;
}

export type ModelRow = {
	readonly key: string; readonly providerName: string; readonly modelName: string; readonly inputTokens: number; readonly outputTokens: number; readonly costUsd: number; readonly turns: number;
	/** where the number comes from; 'unpriced' when some turns of a cloud model had no price, so the money is not complete */
	readonly source: CostSource;
};

/** what each model used over the last `days` days, the most expensive first; sources follow the rules at the top of this file */
export function modelRows(ledger: UsageLedger, days: number, now: Date): ModelRow[] {
	const rows = new Map<string, { providerName: string; modelName: string; isLocal: boolean; inputTokens: number; outputTokens: number; costUsd: number; billedCostUsd: number; unpricedTurns: number; turns: number }>();
	for (const { day } of lastDays(ledger, days, now)) {
		for (const [key, m] of Object.entries(ledger[day]?.models ?? {})) {
			if (!m) continue;
			const r = rows.get(key) ?? { providerName: m.providerName, modelName: m.modelName, isLocal: m.isLocal, inputTokens: 0, outputTokens: 0, costUsd: 0, billedCostUsd: 0, unpricedTurns: 0, turns: 0 };
			r.inputTokens += m.inputTokens; r.outputTokens += m.outputTokens; r.costUsd += m.costUsd; r.billedCostUsd += m.billedCostUsd; r.unpricedTurns += m.unpricedTurns; r.turns += m.turns;
			rows.set(key, r);
		}
	}
	return [...rows.entries()].map(([key, r]): ModelRow => ({
		key, providerName: r.providerName, modelName: r.modelName, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, turns: r.turns,
		source: r.isLocal ? 'free' : r.unpricedTurns >= r.turns ? 'unpriced' : r.billedCostUsd >= r.costUsd - 1e-9 && r.costUsd > 0 ? 'billed' : 'estimate',
	})).sort((a, b) => b.costUsd - a.costUsd || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
}
