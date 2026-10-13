/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Models trained against other coding tools write the file argument as `path`, `file_path`, `filename`... instead of Vader's `uri`.
// The meaning is unambiguous, so the value is accepted under `uri` when `uri` itself is absent (the tool's own validation still runs on it).
// Found by a benchmark run: a model's `write_file({ path, content })` failed with "Provided uri must be a string, but it's a(n) undefined",
// and a model that has just been told that often does not recover.

const URI_ARG_ALIASES = ['path', 'file_path', 'filepath', 'file_name', 'filename', 'file', 'target_file', 'absolute_path'] as const

export const withUriAlias = <T extends { [name: string]: unknown }>(params: T): T => {
	if (!params || typeof params !== 'object' || params.uri !== undefined) { return params }
	for (const alias of URI_ARG_ALIASES) {
		const value = params[alias]
		if (typeof value === 'string' && value.trim() !== '') { return { ...params, uri: value } }
	}
	return params
}
