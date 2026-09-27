/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { PolicyRule } from './policyServiceTypes.js';

// `locked: true` rules can never be disabled or deleted, from settings or otherwise -
// these are the "explicitly forbidden" invariants that autonomous mode must still
// respect (mission requirement: hard policy independent of model obedience or user
// permission mode). Everything else is a built-in default that ships enabled but that
// the user may turn off in settings if it doesn't fit their workflow.

export const builtInPolicyRules: PolicyRule[] = [
	// --- locked hard denies: catastrophic, essentially never a legitimate agent action ---
	{
		id: 'vader.deny.destructive-fs',
		description: 'Blocked: command looks like it would recursively delete a root/home directory or wipe a filesystem/disk.',
		effect: 'deny',
		kinds: ['terminal-command'],
		commandPatterns: [
			String.raw`\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(/|~|\$HOME)(\s|$|/\*)`,
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
			'/etc/sudoers',
			'/etc/sudoers.d/**',
			'/boot/**',
			'C:/Windows/System32/**',
			'C:/Windows/SysWOW64/**',
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
