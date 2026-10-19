/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// When to ask for a next edit, and when not to. Every ask is a request to a model, which costs time and (with a hosted model) money, so the gate asks only when the person has stopped
// for a moment, never while they are choosing from a list or have text selected, not again on the line where they just pressed Escape, not more than once in a second and a half, and not
// more than twenty times a minute. Pure: it is told the time.

export type AskReason = 'line-change' | 'pause' | 'manual' | 'focus'

export type GateOptions = { lineChangeMs?: number; pauseMs?: number; rejectLockoutMs?: number; minIntervalMs?: number; perMinute?: number }

export class NextEditGate {
	private _lastKey = 0
	private _rejectUntil = 0
	private _rejectLine = -1
	private _asked: number[] = []

	constructor(private readonly _o: GateOptions = {}) { }

	onKeystroke(line: number, now: number): void {
		this._lastKey = now
		if (line !== this._rejectLine) this._rejectUntil = 0 // moving to another line ends the lockout
	}

	/** the person dismissed a suggestion (Escape): nothing is asked on that line for a while */
	onReject(line: number, now: number): void {
		this._rejectLine = line
		this._rejectUntil = now + (this._o.rejectLockoutMs ?? 2500)
	}

	shouldAsk(a: { line: number; now: number; reason: AskReason; selectionEmpty: boolean; suggestWidgetOpen?: boolean }): { ok: true } | { ok: false; why: string } {
		const o = this._o
		if (a.reason === 'manual') return { ok: true }
		if (!a.selectionEmpty) return { ok: false, why: 'text is selected' }
		if (a.suggestWidgetOpen) return { ok: false, why: 'a list of suggestions is open' }
		if (a.now < this._rejectUntil && a.line === this._rejectLine) return { ok: false, why: 'the person just dismissed a suggestion here' }
		const quiet = a.now - this._lastKey
		if (a.reason === 'line-change' && quiet < (o.lineChangeMs ?? 120)) return { ok: false, why: 'still typing' }
		if (a.reason === 'pause' && quiet < (o.pauseMs ?? 350)) return { ok: false, why: 'still typing' }
		this._asked = this._asked.filter(t => a.now - t < 60_000)
		const last = this._asked[this._asked.length - 1]
		if (last !== undefined && a.now - last < (o.minIntervalMs ?? 1500)) return { ok: false, why: 'asked a moment ago' }
		if (this._asked.length >= (o.perMinute ?? 20)) return { ok: false, why: 'the limit of asks per minute is reached' }
		return { ok: true }
	}

	/** an ask was made */
	asked(now: number): void { this._asked.push(now) }

	/** asks made in the last minute (for Settings to say) */
	askedInLastMinute(now: number): number { return this._asked.filter(t => now - t < 60_000).length }
}
