/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { promisify } from 'util'
import { execFile as _execFile } from 'child_process'
import { IVaderSCMService } from '../common/vaderSCMTypes.js'

interface NumStat {
	file: string
	added: number
	removed: number
}

const execFile = promisify(_execFile)

//8000 and 10 were chosen after some experimentation on small-to-moderately sized changes
const MAX_DIFF_LENGTH = 8000
const MAX_DIFF_FILES = 10
const GIT_TIMEOUT_MS = 20_000
const GIT_MAX_BUFFER = 16 * 1024 * 1024

// Arguments are passed as an array and never through a shell: file names come from the opened
// repository and can contain quotes, `;`, `$()` or backticks (a hostile repo could otherwise run commands).
const git = async (args: string[], path: string): Promise<string> => {
	const { stdout, stderr } = await execFile('git', args, {
		cwd: path,
		timeout: GIT_TIMEOUT_MS,
		maxBuffer: GIT_MAX_BUFFER,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
	})
	if (stderr) {
		throw new Error(stderr)
	}
	return stdout.trim()
}

// `-z` output is NUL-separated and never quoted/escaped, so any legal file name round-trips exactly.
// Entries are `added\tremoved\tpath\0`; for renames the path is empty and `old\0new\0` follow.
const parseNumStatZ = (output: string): NumStat[] => {
	const fields = output.split('\0')
	const result: NumStat[] = []
	for (let i = 0; i < fields.length; i++) {
		const entry = fields[i]
		if (!entry) { continue }
		const [added, removed, file] = entry.split('\t')
		let path = file
		if (file === '') {
			path = fields[i + 2] // renamed/copied: skip the old name, keep the new one
			i += 2
		}
		if (path === undefined) { continue }
		result.push({ file: path, added: parseInt(added, 10) || 0, removed: parseInt(removed, 10) || 0 })
	}
	return result
}

const getNumStat = async (path: string, useStagedChanges: boolean): Promise<NumStat[]> => {
	const output = await git(['diff', '--numstat', '-z', ...(useStagedChanges ? ['--staged'] : [])], path)
	return parseNumStatZ(output)
}

const getSampledDiff = async (file: string, path: string, useStagedChanges: boolean): Promise<string> => {
	const diff = await git(['diff', '--unified=0', '--no-color', ...(useStagedChanges ? ['--staged'] : []), '--', file], path)
	return diff.slice(0, MAX_DIFF_LENGTH)
}

const hasStagedChanges = async (path: string): Promise<boolean> => {
	const output = await git(['diff', '--staged', '--name-only'], path)
	return output.length > 0
}

export class VaderSCMService implements IVaderSCMService {
	readonly _serviceBrand: undefined

	async gitStat(path: string): Promise<string> {
		const useStagedChanges = await hasStagedChanges(path)
		return git(['diff', '--stat', ...(useStagedChanges ? ['--staged'] : [])], path)
	}

	async gitSampledDiffs(path: string): Promise<string> {
		const useStagedChanges = await hasStagedChanges(path)
		const numStatList = await getNumStat(path, useStagedChanges)
		const topFiles = numStatList
			.sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
			.slice(0, MAX_DIFF_FILES)
		const diffs = await Promise.all(topFiles.map(async ({ file }) => ({ file, diff: await getSampledDiff(file, path, useStagedChanges) })))
		return diffs.map(({ file, diff }) => `==== ${file} ====\n${diff}`).join('\n\n')
	}

	gitBranch(path: string): Promise<string> {
		return git(['branch', '--show-current'], path)
	}

	gitLog(path: string): Promise<string> {
		return git(['log', '--pretty=format:%h|%s|%ad', '--date=short', '--no-merges', '-n', '5'], path)
	}
}
