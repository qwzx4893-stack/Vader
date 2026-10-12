/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// "Export Settings" writes a JSON file the user may attach to a bug report or send to a colleague; "Import Settings" reads one that may have come from
// anyone. Two rules follow:
//   - an export never contains secrets (API keys, custom headers - which often hold an Authorization token);
//   - an import can never make an existing secret travel to a different server: a key already on this computer is kept only for a provider whose endpoint is
//     unchanged, otherwise the provider comes in without a key and the user types it again;
//   - an import can never add a program that Vader would run: the coding agents a person adds by hand (a command line) and which agent is in use are this
//     computer's own choice. A file that came from anyone must not be able to plant "run this program" and select it for the next chat message.

type ProviderBag = { [providerName: string]: Record<string, unknown> | undefined }
type SettingsLike = { settingsOfProvider?: ProviderBag, globalSettings?: Record<string, unknown> } & Record<string, unknown>

const SECRET_FIELDS = ['apiKey', 'headersJSON'] as const
/** global settings that name programs to run: never exported, never imported */
const LOCAL_ONLY_GLOBAL_SETTINGS = ['customAcpAgents', 'externalAgentId'] as const

/** a deep copy of the settings with every secret emptied */
export const redactSettingsForExport = <T extends SettingsLike>(state: T): T => {
	const copy = JSON.parse(JSON.stringify(state)) as T
	for (const bag of Object.values(copy.settingsOfProvider ?? {})) {
		if (!bag) continue
		for (const f of SECRET_FIELDS) { if (f in bag) bag[f] = '' }
	}
	for (const f of LOCAL_ONLY_GLOBAL_SETTINGS) { if (copy.globalSettings) delete copy.globalSettings[f] }
	return copy
}

const sameEndpoint = (a: unknown, b: unknown) => {
	const norm = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\/+$/, '').toLowerCase() : '')
	return norm(a) === norm(b)
}

/** the imported settings, with this computer's secrets put back where it is safe to do so */
export const mergeImportedSettings = <T extends SettingsLike>(imported: T, current: SettingsLike): T => {
	const out = JSON.parse(JSON.stringify(imported)) as T
	// this computer's own coding-agent choices stay as they are, whatever the file says
	if (out.globalSettings || current.globalSettings) {
		out.globalSettings = { ...(out.globalSettings ?? {}) }
		for (const f of LOCAL_ONLY_GLOBAL_SETTINGS) {
			if (current.globalSettings && f in current.globalSettings) { out.globalSettings[f] = current.globalSettings[f] } else { delete out.globalSettings[f] }
		}
	}
	for (const [providerName, bag] of Object.entries(out.settingsOfProvider ?? {})) {
		const cur = current.settingsOfProvider?.[providerName]
		if (!bag || !cur) continue
		const endpointUnchanged = sameEndpoint(bag['endpoint'], cur['endpoint'])
		for (const f of SECRET_FIELDS) {
			const importedHasValue = typeof bag[f] === 'string' && (bag[f] as string).trim() !== '' && bag[f] !== '{}'
			if (importedHasValue) continue // the file carries its own value (an older export): the user chose to import it
			bag[f] = endpointUnchanged && typeof cur[f] === 'string' ? cur[f] : (f === 'headersJSON' ? '{}' : '')
		}
	}
	return out
}
