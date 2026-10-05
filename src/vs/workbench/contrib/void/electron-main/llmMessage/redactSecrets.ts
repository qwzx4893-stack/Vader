/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Provider error bodies sometimes quote the API key that was rejected ("Incorrect API key provided: sk-..."), and SDK error
// objects carry the whole body. Errors are shown in the chat, logged, and can end up in screenshots and bug reports, so every
// secret from the provider's own settings is removed from an error before it leaves the main process.

const SECRET_KEY_NAMES = /key|token|secret|password|authorization/i
const MIN_SECRET_LENGTH = 8 // shorter strings would also blank out ordinary words

export const collectSecrets = (providerSettings: unknown): string[] => {
	const out = new Set<string>()
	const visit = (v: unknown, name: string, depth: number) => {
		if (depth > 3 || v === null || v === undefined) return
		if (typeof v === 'string') {
			if (SECRET_KEY_NAMES.test(name) && v.trim().length >= MIN_SECRET_LENGTH) out.add(v.trim())
			// custom headers are stored as a JSON string: its values (e.g. an Authorization header) are secrets too
			if (name === 'headersJSON') {
				try { visit(JSON.parse(v), '', depth + 1) } catch { /* not JSON */ }
			}
		}
		else if (typeof v === 'object') {
			for (const [k, x] of Object.entries(v as Record<string, unknown>)) visit(x, SECRET_KEY_NAMES.test(name) ? name : k, depth + 1)
		}
	}
	visit(providerSettings, '', 0)
	return [...out].sort((a, b) => b.length - a.length)
}

export const redactString = (s: string, secrets: string[]): string => {
	let out = s
	for (const secret of secrets) out = out.split(secret).join('[redacted]')
	return out
}

/** A copy of `err` (an Error, SDK error or plain value) with every secret removed from all of its strings. */
export const redactError = <T>(err: T, secrets: string[], depth = 0): T => {
	if (!secrets.length || err === null || err === undefined) return err
	if (typeof err === 'string') return redactString(err, secrets) as unknown as T
	if (typeof err !== 'object' || depth > 5) return err
	if (Array.isArray(err)) return err.map(x => redactError(x, secrets, depth + 1)) as unknown as T
	const source = err as unknown as Record<string, unknown>
	const copy = (err instanceof Error ? Object.assign(new Error(redactString(err.message, secrets)), { name: err.name }) : {}) as Record<string, unknown>
	if (err instanceof Error && typeof err.stack === 'string') copy.stack = redactString(err.stack, secrets)
	for (const k of Object.keys(source)) {
		if (k === 'message' || k === 'stack') continue
		copy[k] = redactError(source[k], secrets, depth + 1)
	}
	return copy as unknown as T
}
