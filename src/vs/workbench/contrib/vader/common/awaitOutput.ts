/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Waiting for a background terminal (a dev server, a watcher, a long build) to say something, without the agent polling it turn after turn. The agent names a terminal and what it
// waits for (a pattern in the output, or just for it to go quiet), and gets the new output back when that happens or when the time is up. Only output written after the call counts,
// so a message that was already there does not end the wait at once. Pure: the terminal is read through a function the caller gives, and time through another, so it is tested
// without either.

export type AwaitReason = 'matched' | 'quiet' | 'timeout'
export type AwaitResult = { reason: AwaitReason; output: string; match?: string; waitedMs: number }

export const MAX_AWAIT_SECONDS = 120
export const DEFAULT_AWAIT_SECONDS = 30
export const QUIET_SECONDS = 5
export const MAX_AWAIT_OUTPUT_CHARS = 8000

/** a pattern the model gave, as a regex, or the reason it cannot be used: too long, not valid, or built in the way that makes a regex run for minutes on a short text */
export function parsePattern(text: string): { ok: true; re: RegExp } | { ok: false; reason: string } {
	if (text.length > 200) return { ok: false, reason: 'The pattern is longer than 200 characters.' }
	if (/\([^)]*[+*][^)]*\)[+*{]/.test(text) || /\(\?:?[^)]*\|[^)]*\)[+*]/.test(text) && /\([^)]*[+*][^)]*\)/.test(text)) return { ok: false, reason: 'The pattern repeats a repeated group, which can make the search run for a very long time. Use a simpler pattern.' }
	try { return { ok: true, re: new RegExp(text, 'm') } } catch (e) { return { ok: false, reason: `The pattern is not a valid regular expression: ${e instanceof Error ? e.message : String(e)}` } }
}

/** the end of what was written since the call: the buffer may have scrolled, in which case all of it is taken */
export const freshOutput = (baseline: string, current: string): string => current.startsWith(baseline) ? current.slice(baseline.length) : current

export async function awaitOutput(io: {
	read: () => Promise<string>
	sleep: (ms: number) => Promise<void>
	now: () => number
}, opts: { re?: RegExp; timeoutMs: number; pollMs?: number; quietMs?: number }): Promise<AwaitResult> {
	const poll = opts.pollMs ?? 400
	const quiet = opts.quietMs ?? QUIET_SECONDS * 1000
	const start = io.now()
	const baseline = await io.read()
	let lastText = baseline
	let lastChange = start
	for (;;) {
		await io.sleep(poll)
		const now = io.now()
		const current = await io.read()
		if (current !== lastText) { lastText = current; lastChange = now }
		const fresh = freshOutput(baseline, current)
		if (opts.re) {
			const m = opts.re.exec(fresh)
			if (m) return { reason: 'matched', output: tail(fresh), match: m[0].slice(0, 200), waitedMs: now - start }
		} else if (fresh.length > 0 && now - lastChange >= quiet) {
			return { reason: 'quiet', output: tail(fresh), waitedMs: now - start }
		}
		if (now - start >= opts.timeoutMs) return { reason: 'timeout', output: tail(fresh), waitedMs: now - start }
	}
}

const tail = (s: string): string => s.length > MAX_AWAIT_OUTPUT_CHARS ? '...\n' + s.slice(s.length - MAX_AWAIT_OUTPUT_CHARS) : s

/** what the agent is told */
export function awaitWords(r: AwaitResult, terminalId: string, untilRegex: string | null): string {
	const secs = Math.round(r.waitedMs / 100) / 10
	const head = r.reason === 'matched' ? `Terminal ${terminalId} printed a line matching /${untilRegex}/ after ${secs}s (${JSON.stringify(r.match)}).`
		: r.reason === 'quiet' ? `Terminal ${terminalId} went quiet after ${secs}s.`
			: untilRegex ? `Terminal ${terminalId} did not print anything matching /${untilRegex}/ in ${secs}s. It may still be running.` : `Terminal ${terminalId} was still printing after ${secs}s. It may still be running.`
	return r.output.trim() ? `${head}\nNew output:\n${r.output}` : `${head}\n(no new output)`
}
