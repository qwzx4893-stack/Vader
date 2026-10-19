/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// What a number typed into Settings means (board S10): a value that cannot be used is said so, in words, and the text stays so the person can fix it. Nothing is
// guessed: "five" is not 5, and an empty box is "no value", which is a choice for a limit and a mistake for a price.

export type NumberInput = { readonly ok: true, readonly value: number | null } | { readonly ok: false, readonly message: string };

const NUMBER = /^\d+(?:[.,]\d+)?$|^[.,]\d+$/;

function parse(text: string): number | undefined {
	const t = text.trim().replace(/^\$/, '').trim();
	if (!NUMBER.test(t)) return undefined;
	const n = Number(t.replace(',', '.'));
	return Number.isFinite(n) ? n : undefined;
}

/** an amount of money: an empty box means none (`allowEmpty`), otherwise a number above zero */
export function parseMoney(text: string, opts: { allowEmpty: boolean }): NumberInput {
	if (!text.trim()) return opts.allowEmpty ? { ok: true, value: null } : { ok: false, message: 'Enter a number, like 5 or 12.50.' };
	const n = parse(text);
	if (n === undefined) return { ok: false, message: 'Enter a number, like 5 or 12.50.' };
	if (n <= 0) return { ok: false, message: 'Enter an amount above zero, like 5 or 12.50. To have no limit, turn it off.' };
	return { ok: true, value: n };
}

/** a percent from 0 to 100; an empty box is 0 */
export function parsePercent(text: string): NumberInput {
	if (!text.trim()) return { ok: true, value: 0 };
	const n = parse(text.replace(/%$/, ''));
	if (n === undefined || n > 100) return { ok: false, message: 'Enter a percent from 0 to 100, like 20.' };
	return { ok: true, value: n };
}

/** a price in US dollars per million tokens: zero is a price (a free model), a negative number or text is not */
export function parsePrice(text: string): NumberInput {
	if (!text.trim()) return { ok: false, message: 'Enter the price per million tokens, like 3 or 0.25.' };
	const n = parse(text);
	if (n === undefined) return { ok: false, message: 'Enter the price per million tokens, like 3 or 0.25.' };
	return { ok: true, value: n };
}
