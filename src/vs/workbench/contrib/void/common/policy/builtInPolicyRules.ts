/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { PolicyRule } from './policyServiceTypes.js';

// `locked: true` rules can never be disabled or deleted, from settings or otherwise -
// these are the "explicitly forbidden" invariants that autonomous mode must still
// respect (mission requirement: hard policy independent of model obedience or user
// permission mode). Everything else is a built-in default that ships enabled but that
// the user may turn off in settings if it doesn't fit their workflow.

// A token that names something whose recursive deletion/ownership change is never a legitimate
// agent action: a root, a home directory, a top-level system directory or a drive root. Anchored
// so `/tmp/x` and `$HOME/project` (a subdirectory) stay allowed. Matched on text where quotes are already stripped.
const CRITICAL_TARGET = String.raw`(?:/\*?|~/?\*?|\$home/?\*?|/(?:home|users|usr|etc|var|bin|sbin|boot|lib|lib64|root|opt|srv|dev|sys|proc)/?\*?|[a-z]:[\\/]?\*?)(?=\s|$|[;&|)])`;
const WINDOWS_TARGET = String.raw`(?:[a-z]:[\\/]?\*?|\$home[\\/]?\*?|\$env:(?:userprofile|systemroot|windir|systemdrive|homedrive)[\\/]?\*?|%(?:userprofile|systemroot|windir|systemdrive|homedrive)%[\\/]?\*?|[a-z]:[\\/](?:users|windows|program files(?: \(x86\))?|programdata)[\\/]?\*?)(?=\s|$|[;&|)])`;

export const builtInPolicyRules: PolicyRule[] = [
	// --- locked hard denies: catastrophic, essentially never a legitimate agent action ---
	{
		id: 'vader.deny.destructive-fs',
		description: 'Blocked: command looks like it would recursively delete a root, home, system or drive directory, or wipe a filesystem/disk.',
		effect: 'deny',
		kinds: ['terminal-command'],
		commandPatterns: [
			// Unix rm with a recursive flag (-r, -rf, -fr, -R, --recursive, flags split apart) aimed at a critical target
			String.raw`\brm\b(?=[^;&|\n]*\s(?:-[a-z]*r[a-z]*|--recursive)(?=\s|$))[^;&|\n]*?\s(?:--\s+)?` + CRITICAL_TARGET,
			String.raw`\bfind\s+` + CRITICAL_TARGET + String.raw`\s[^;&|\n]*(?:-delete\b|-exec\s+rm\b)`,
			String.raw`\b(?:chmod|chown|chgrp)\b(?=[^;&|\n]*\s(?:-[a-z]*r[a-z]*|--recursive)(?=\s|$))[^;&|\n]*?\s` + CRITICAL_TARGET,
			// PowerShell
			String.raw`\b(?:remove-item|ri|del|erase|rmdir|rd)\b(?=[^;&|\n]*\s-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?(?=\s|$))[^;&|\n]*?\s(?:-(?:literal)?path\s+)?` + WINDOWS_TARGET,
			// cmd.exe rd/rmdir/del/erase with /s
			String.raw`\b(?:rd|rmdir|del|erase)\b(?=[^;&|\n]*\s/s(?=\s|$))[^;&|\n]*?\s` + WINDOWS_TARGET,
			String.raw`\b(?:format-volume|clear-disk|remove-partition|initialize-disk)\b`,
			String.raw`\brmtree\(\s*(?:/\*?|~/?|\$home/?|[a-z]:[\\/]?)\s*[,)]`,
			String.raw`\bmkfs(\.\w+)?\b`,
			String.raw`\bdd\s+[^\n]*\bof=/dev/(sd|nvme|hd|disk|xvd)`,
			String.raw`>\s*/dev/(sd|nvme|hd|disk|xvd)[a-z0-9]*\b`,
			String.raw`\bdiskpart\b`,
			String.raw`\bformat\s+[a-zA-Z]:`,
		],
		builtIn: true,
		locked: true,
		neverBypassAutonomous: true,
		enabled: true,
	},
	{
		id: 'vader.deny.fork-bomb',
		description: 'Blocked: command matches a known fork-bomb pattern.',
		effect: 'deny',
		kinds: ['terminal-command'],
		commandPatterns: [String.raw`:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:`],
		builtIn: true,
		locked: true,
		neverBypassAutonomous: true,
		enabled: true,
	},
	{
		id: 'vader.deny.system-critical-paths',
		description: 'Blocked: write/delete of an OS-critical system file.',
		effect: 'deny',
		kinds: ['file-write', 'file-delete'],
		pathGlobs: [
			'/etc/shadow',
			'/etc/passwd',
			'/etc/sudoers',
			'/etc/sudoers.d/**',
			'/etc/ssh/**',
			'/boot/**',
			'/bin/**',
			'/sbin/**',
			'/usr/bin/**',
			'/usr/sbin/**',
			'C:/Windows/**',
		],
		builtIn: true,
		locked: true,
		neverBypassAutonomous: true,
		enabled: true,
	},

	// --- default-on "ask" rules: real risk, but sometimes a legitimate thing to do ---
	{
		id: 'vader.ask.secrets-and-keys',
		description: 'This touches a file that commonly holds credentials or private keys (.env, SSH keys, cloud credentials, certificates).',
		effect: 'ask',
		kinds: ['file-read', 'file-write', 'file-delete'],
		pathGlobs: [
			'**/.env',
			'**/.env.*',
			'**/*.pem',
			'**/*.key',
			'**/*.pfx',
			'**/*.p12',
			'**/id_rsa',
			'**/id_rsa.*',
			'**/id_ed25519',
			'**/id_ed25519.*',
			'**/.ssh/**',
			'**/.aws/credentials',
			'**/.aws/config',
			'**/credentials.json',
			'**/.netrc',
			'**/.npmrc',
			'**/.docker/config.json',
			'**/.kube/config',
			'**/id_dsa',
			'**/id_ecdsa',
			'**/id_ecdsa.*',
			'**/*.keystore',
			'**/*.jks',
			'**/.git-credentials',
			'**/.config/git/credentials',
			'**/.config/gh/hosts.yml',
			'**/.config/gcloud/**',
			'**/.azure/**',
			'**/.gnupg/**',
			'**/.pgpass',
			'**/.pypirc',
			'**/.vault-token',
			'**/secrets.json',
			'**/secrets.yml',
			'**/secrets.yaml',
			'**/*.tfvars',
		],
		builtIn: true,
		locked: false,
		neverBypassAutonomous: true,
		enabled: true,
	},
	{
		// Files that make something run on its own later: opening the folder (tasks.json with runOn folderOpen), committing (git hooks),
		// entering the directory (.envrc), or opening any shell (profiles). A prompt-injected model that can write one of these gets code
		// execution without ever calling a terminal tool, and without an approval if the user auto-approves edits.
		id: 'vader.ask.autorun-config',
		description: 'This writes a file that can run code on its own later (editor tasks/settings, git hooks, .envrc, shell startup files, MCP/devcontainer config, workspace AI rules).',
		effect: 'ask',
		kinds: ['file-write', 'file-delete'],
		pathGlobs: [
			'**/.vscode/tasks.json',
			'**/.vscode/settings.json',
			'**/.vscode/launch.json',
			'**/.git/hooks/**',
			'**/.git/config',
			'**/.gitconfig',
			'**/.config/git/config',
			'**/.husky/**',
			'**/.envrc',
			'**/.devcontainer/**',
			'**/devcontainer.json',
			'**/mcp.json',
			'**/.mcp.json',
			'**/.vaderrules',
			'**/.voidrules',
			'**/.bashrc',
			'**/.bash_profile',
			'**/.bash_login',
			'**/.zshrc',
			'**/.zshenv',
			'**/.zprofile',
			'**/.profile',
			'**/.config/fish/config.fish',
			'**/Microsoft.PowerShell_profile.ps1',
			'**/profile.ps1',
		],
		builtIn: true,
		locked: false,
		neverBypassAutonomous: true,
		enabled: true,
	},
	{
		id: 'vader.ask.sudo',
		description: 'This command requests elevated (sudo/administrator) privileges.',
		effect: 'ask',
		kinds: ['terminal-command'],
		commandPatterns: [String.raw`\bsudo\b`, String.raw`\brunas\b`],
		builtIn: true,
		locked: false,
		neverBypassAutonomous: true,
		enabled: true,
	},
	{
		id: 'vader.ask.force-push',
		description: 'This is a force-push, which can overwrite remote history other people depend on.',
		effect: 'ask',
		kinds: ['terminal-command'],
		commandPatterns: [String.raw`\bgit\s+push\b[^\n]*(--force\b|-f\b)`],
		builtIn: true,
		locked: false,
		neverBypassAutonomous: false,
		enabled: true,
	},
	{
		id: 'vader.ask.pipe-remote-to-shell',
		description: 'This pipes a downloaded script directly into a shell, which is a common supply-chain risk.',
		effect: 'ask',
		kinds: ['terminal-command'],
		commandPatterns: [
			String.raw`\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(sh|bash|zsh|python[0-9.]*|node)\b`,
		],
		builtIn: true,
		locked: false,
		neverBypassAutonomous: false,
		enabled: true,
	},
];
