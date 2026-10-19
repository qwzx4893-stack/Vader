/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// "Only the problems this change introduced." A project that already fails its type check or has a failing test would block every task's merge if a failing check were enough
// to refuse it: the task is blamed for what was there before. The checks that fail in a task's copy are run again on the project as it was, and the problems of the two runs are
// compared by what they say, not by where they are (a line number moves when a few lines are added above). Only a problem that is new, or a check that fails and says nothing
// Vader can read, counts against the task. Pure.

export type Problem = { kind: 'compile' | 'test'; file: string; message: string; code?: string; line?: number }

const strip = (s: string) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '')

/** the problems in the output of a build, a type check, a linter or a test run: the formats of tsc, gcc/clang, go, rust, mypy, pyright, eslint (compact), jest, pytest, go test, and TAP */
export function parseProblems(outputIn: string): Problem[] {
	const out: Problem[] = []
	const lines = strip(outputIn).split('\n')
	const seen = new Set<string>()
	const add = (p: Problem) => { const k = problemKey(p); if (!seen.has(k + '#' + (p.line ?? 0))) { seen.add(k + '#' + (p.line ?? 0)); out.push(p) } }
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i].trimEnd()
		let m: RegExpExecArray | null
		// tsc: src/a.ts(12,5): error TS2322: Type ...   (and the "pretty" form: src/a.ts:12:5 - error TS2322: ...)
		if ((m = /^(.+?)\((\d+),(\d+)\): (?:error|warning) (TS\d+): (.+)$/.exec(l))) { add({ kind: 'compile', file: norm(m[1]), line: +m[2], code: m[4], message: m[5] }); continue }
		if ((m = /^(.+?):(\d+):(\d+) - error (TS\d+): (.+)$/.exec(l))) { add({ kind: 'compile', file: norm(m[1]), line: +m[2], code: m[4], message: m[5] }); continue }
		// gcc, clang, go build, mypy, eslint --format unix: file:line:col: error: message / file:line: error: message
		if ((m = /^(.+?):(\d+)(?::(\d+))?: (?:fatal )?(?:error|Error)(?:\[([A-Za-z0-9_-]+)\])?:? (.+)$/.exec(l)) && !/^\s*at /.test(l)) { add({ kind: 'compile', file: norm(m[1]), line: +m[2], code: m[4], message: m[5] }); continue }
		// go vet and go build without the word error: file.go:12:5: undefined: x
		if ((m = /^(\S+\.go):(\d+):(\d+): (.+)$/.exec(l))) { add({ kind: 'compile', file: norm(m[1]), line: +m[2], message: m[4] }); continue }
		// rust: error[E0308]: mismatched types \n  --> src/main.rs:12:5
		if ((m = /^error(?:\[(E\d+)\])?: (.+)$/.exec(l)) && !/^error: aborting|^error: could not compile/.test(l)) {
			const next = lines.slice(i + 1, i + 4).map(x => /^\s*--> (.+?):(\d+):(\d+)/.exec(x)).find(Boolean)
			if (next) add({ kind: 'compile', file: norm(next[1]), line: +next[2], code: m[1], message: m[2] })
			continue
		}
		// pyright / mypy: file.py:12:5 - error: message  /  file.py:12: error: message [code]
		if ((m = /^(.+?\.pyi?):(\d+)(?::(\d+))? - error: (.+)$/.exec(l))) { add({ kind: 'compile', file: norm(m[1]), line: +m[2], message: m[4] }); continue }
		// eslint "stylish": a file line, then "  12:5  error  message  rule-id"
		if ((m = /^\s+(\d+):(\d+)\s+error\s+(.+?)\s{2,}([\w@/-]+)\s*$/.exec(l))) {
			let file = ''
			for (let k = i - 1; k >= 0 && k >= i - 200; k--) { if (lines[k] && !/^\s/.test(lines[k]) && /[\\/.]/.test(lines[k])) { file = lines[k].trim(); break } }
			add({ kind: 'compile', file: norm(file), line: +m[1], code: m[4], message: m[3] }); continue
		}
		// tests: jest "FAIL src/a.test.ts" and "  ✕ name", pytest "FAILED tests/a.py::test_x - msg", go "--- FAIL: TestX", TAP "not ok 3 - name", node:test "✖ name"
		if ((m = /^FAILED (\S+?)(?: - .*)?$/.exec(l))) { add({ kind: 'test', file: norm(m[1].split('::')[0]), message: m[1] }); continue }
		if ((m = /^--- FAIL: (\S+)/.exec(l))) { add({ kind: 'test', file: '', message: m[1] }); continue }
		if ((m = /^not ok \d+ - (.+)$/.exec(l))) { add({ kind: 'test', file: '', message: m[1].trim() }); continue }
		if ((m = /^\s*[✕✖×] (.+?)(?: \(\d+ ?ms\))?$/.exec(l))) { add({ kind: 'test', file: '', message: m[1].trim() }); continue }
		if ((m = /^\s*FAIL (\S+\.(?:[jt]sx?|mjs|cjs|py|go|rs))\b/.exec(l))) { add({ kind: 'test', file: norm(m[1]), message: `suite ${norm(m[1])}` }); continue }
	}
	return out
}

const norm = (p: string): string => p.trim().replace(/\\/g, '/').replace(/^\.\//, '')

/** what makes a problem the same problem in another run: the file, the code and the words, not the line; digits in the words are folded (a count, a line number inside the text) */
export function problemKey(p: Problem): string {
	return `${p.kind}|${p.file.toLowerCase()}|${p.code ?? ''}|${p.message.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase()}`
}

export type CheckOutput = { name: string; passed: boolean; exitCode: number | null; output: string }
export type CheckVerdict = { name: string; regression: boolean; newProblems: Problem[]; existing: number; reason: string }

/**
 * Is a check that fails in the task's copy the task's doing? `base` is the same check run on the project as it was. Not a regression only when the check also fails there and
 * every problem it names now was already named then; a check that fails with output nothing can be read from is a regression, as is one that passed before.
 */
export function judgeCheck(after: CheckOutput, base: CheckOutput | undefined): CheckVerdict {
	if (after.passed) return { name: after.name, regression: false, newProblems: [], existing: 0, reason: 'passes' }
	if (!base) return { name: after.name, regression: true, newProblems: [], existing: 0, reason: 'it was not run on the project as it was' }
	if (base.passed) return { name: after.name, regression: true, newProblems: parseProblems(after.output), existing: 0, reason: 'it passed before this task' }
	const now = parseProblems(after.output)
	if (now.length === 0) return { name: after.name, regression: true, newProblems: [], existing: 0, reason: 'it fails and its output names no problem that can be compared with before' }
	const before = new Set(parseProblems(base.output).map(problemKey))
	const fresh = now.filter(p => !before.has(problemKey(p)))
	return fresh.length > 0
		? { name: after.name, regression: true, newProblems: fresh, existing: now.length - fresh.length, reason: `${fresh.length} new problem${fresh.length === 1 ? '' : 's'}` }
		: { name: after.name, regression: false, newProblems: [], existing: now.length, reason: `fails the same way before this task (${now.length} problem${now.length === 1 ? '' : 's'}), nothing new` }
}

/** the words that go with a merge that was let through, or a refusal */
export function deltaSummary(verdicts: readonly CheckVerdict[]): string {
	const failing = verdicts.filter(v => v.reason !== 'passes')
	if (failing.length === 0) return ''
	const bad = failing.filter(v => v.regression)
	if (bad.length === 0) return `Checks that fail (${failing.map(v => v.name).join(', ')}) failed the same way before this task: ${failing.reduce((n, v) => n + v.existing, 0)} problem${failing.reduce((n, v) => n + v.existing, 0) === 1 ? '' : 's'} that were already there, none new.`
	return bad.map(v => `${v.name}: ${v.reason}${v.newProblems.length ? ` (${v.newProblems.slice(0, 3).map(p => `${p.file}${p.line ? ':' + p.line : ''} ${p.message.slice(0, 80)}`).join('; ')}${v.newProblems.length > 3 ? '; ...' : ''})` : ''}`).join('\n')
}
