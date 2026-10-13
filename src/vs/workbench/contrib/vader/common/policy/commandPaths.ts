/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The path rules (credential files, files that run code on their own later) used to see only the file tools: a terminal command carried its text and
// nothing else, so `cat ~/.ssh/id_rsa` or `echo x >> .vscode/tasks.json` passed every one of them, in the very mode (autonomous) where they are meant to
// be the last line of defence. This lists the path-like words of a command, and which of them it may write, so the same globs can be applied.
//
// It is a best effort over a shell string, like the command patterns next to it: `cat $(echo ~/.ss)h/id_rsa`, an encoded payload or a script that
// builds the path at run time still evades it. It narrows the gap; a sandbox is what closes it.

import { canonicalWindowsAlias, normalizeDotSegments } from './realPaths.js';
import { normalizeCommandForPolicy } from './commandNormalizer.js';

export interface CommandPaths {
	/** every word of the command that could name a path, home and profile shorthands expanded */
	readonly all: string[];
	/** the words of the commands that are not plain readers (a redirection, cp/mv/tee/sed -i/Set-Content, curl -o, git add...) */
	readonly writes: string[];
}

/** Commands that only read what they are given; their path words are not write targets (unless the same segment redirects output). */
const READ_ONLY_HEADS = new Set([
	'cat', 'type', 'ls', 'dir', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'find', 'stat', 'wc', 'file', 'tree', 'diff', 'cmp',
	'get-content', 'gc', 'select-string', 'sls', 'findstr', 'get-childitem', 'gci', 'get-item', 'gi', 'test-path', 'resolve-path', 'bat', 'od', 'xxd', 'hexdump', 'strings', 'sha256sum', 'md5sum',
	'echo', 'printf', 'write-output', 'write-host', 'pwd', 'cd', 'chdir', 'set-location', 'which', 'where', 'where.exe', 'whoami', 'cut', 'sort', 'uniq', 'basename', 'dirname', 'realpath', 'readlink',
]);
const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'blame', 'ls-files', 'branch', 'rev-parse', 'describe', 'shortlog', 'grep', 'ls-tree', 'cat-file', 'remote', 'tag', 'stash']);
const WRAPPER_HEADS = new Set(['sudo', 'doas', 'time', 'nice', 'nohup', 'env', 'command', 'builtin', 'exec', 'call', 'start', 'cmd', 'cmd.exe', '&']);

// `$HOME`, `~`, `%USERPROFILE%`, `$env:USERPROFILE`, `$PROFILE` and friends, as the `~` that the credential globs (the .ssh one, for example) expect.
const expandShorthands = (text: string): string => text
	.replace(/\$\{?env:(?:USERPROFILE|HOME)\}?|%USERPROFILE%|%HOMEPATH%|\$HOME\b|\$\{HOME\}|\$USERPROFILE\b/gi, '~')
	.replace(/\$PROFILE\b|\$PSHOME\\profile\.ps1/gi, '~/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1');

const splitSegments = (text: string): string[] => text.split(/\r?\n|;|&&|\|\||\||&(?!>)/).map(s => s.trim()).filter(Boolean);

const wordsOf = (segment: string): string[] => segment
	.split(/[\s=,()<>]+/) // `>`/`<` and `=` split words so `2>.env`, `--output=.envrc` and `a>b` expose the path
	.map(w => w.replace(/^[@"'`]+|["'`]+$/g, '')) // curl's `-d @.env`, quotes
	.filter(Boolean);

// `>file`, `>>file`, `1>file`, `x>file` (no space), but not `2>&1` or an arrow such as `->` / `=>`
const hasRedirect = (segment: string): boolean => /(?<![\-=])>>?(?![&>])/.test(segment.replace(/\d?>&\d/g, ' '));

const canonical = (word: string): string => normalizeDotSegments(canonicalWindowsAlias(word));

/** The path words of a terminal command, and the ones it may write. */
export function pathsInCommand(command: string): CommandPaths {
	const all = new Set<string>();
	const writes = new Set<string>();
	// the command as written and as normalized (quotes inside words, fullwidth letters, zero-width characters: commandNormalizer.ts)
	for (const text of new Set([command, normalizeCommandForPolicy(command)])) {
		for (const segment of splitSegments(expandShorthands(text))) {
			const bare = segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, ''); // `FOO=bar cmd args`: the assignment is not the command
			const words = wordsOf(bare);
			if (words.length === 0) { continue; }
			let i = 0;
			while (i < words.length && WRAPPER_HEADS.has(words[i].toLowerCase())) { i++; }
			const head = (words[i] ?? '').toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
			const sub = (words[i + 1] ?? '').toLowerCase();
			// a reader that can still write: find -delete/-exec/-fprint, sort/tree -o FILE
			const writingReader = (head === 'find' && /\s-(delete|exec|execdir|ok|fprint|fprintf|fls)\b/.test(bare)) || ((head === 'sort' || head === 'tree') && /\s-o\b/.test(bare));
			const readOnly = (READ_ONLY_HEADS.has(head) || (head === 'git' && READ_ONLY_GIT.has(sub))) && !writingReader;
			const redirects = hasRedirect(bare);
			for (const w of words.slice(i + 1)) {
				// a word that cannot be a path (an option, a plain number) is skipped; everything else is tried against the globs
				if (w.startsWith('-') && !w.includes('/') && !w.includes('\\')) { continue; }
				const c = canonical(w);
				if (!c) { continue; }
				all.add(c);
				if (!readOnly || redirects) { writes.add(c); }
			}
		}
	}
	return { all: [...all], writes: [...writes] };
}
