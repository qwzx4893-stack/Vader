#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Policy Engine regression test, using the REAL rules and matcher (bundled from source). The locked
// "destructive" rule once missed 12 of 16 common destructive commands (`rm -rf /*`, `rm -rf "$HOME"`,
// every Windows form), and the locked system-path rule never matched on Windows because
// URI.fsPath lowercases the drive letter (`c:`) while the glob was `C:/...`.
//
// Run: node src/vs/workbench/contrib/void/test/policyBypassE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-policy-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/policy/policyService.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'p.mjs'), logLevel: 'silent' });
const { builtInPolicyRules, ruleMatches } = await import(pathToFileURL(path.join(tmp, 'p.mjs')).href);
const denyRules = builtInPolicyRules.filter(r => r.effect === 'deny');
const askRules = builtInPolicyRules.filter(r => r.effect === 'ask');

let passed = 0, failed = 0;
const check = (name, ok) => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const denied = (command) => denyRules.some(r => ruleMatches(r, { kind: 'terminal-command', toolName: 'run_command', command }));
const deniedPath = (kind, p) => denyRules.some(r => ruleMatches(r, { kind, toolName: 'edit_file', filePaths: [p] }));
const asked = (kind, p) => askRules.some(r => ruleMatches(r, { kind, toolName: 'read_file', filePaths: [p] }));

const mustBlock = [
	'rm -rf /', 'rm -rf /*', 'rm -rf ~', 'rm -rf ~/', 'rm -rf ~/*', 'rm -fr $HOME', 'rm -rf "$HOME"', 'rm -rf ${HOME}/', 'rm -rf $HOME/*',
	'rm -r -f /', 'rm --recursive --force /', 'rm -Rf /', 'sudo rm -rf --no-preserve-root /', '/bin/rm -rf /', 'rm -rf /home', 'rm -rf /usr', 'rm -rf /etc/',
	'r""m -rf /', "r'm' -rf /", 'rm -rf / ; echo done', 'echo hi && rm -rf /*', 'ｒｍ -rf /',
	'find / -delete', 'find ~ -exec rm -rf {} ;', 'chmod -R 777 /', 'chown -R nobody /',
	'Remove-Item -Recurse -Force C:\\', 'Remove-Item -Force -Recurse -Path C:\\Users', 'ri -r -fo C:\\Windows', 'rm -Recurse -Force C:\\', 'Remove-Item -Recurse $env:USERPROFILE',
	'rd /s /q C:\\', 'rmdir /s /q C:\\Windows', 'del /f /s /q C:\\*', 'del /s /q %USERPROFILE%', 'erase /s /q D:\\',
	'python3 -c "import shutil;shutil.rmtree(\'/\')"', 'Format-Volume -DriveLetter D', 'Clear-Disk -Number 0 -RemoveData',
	'mkfs.ext4 /dev/sda1', 'dd if=/dev/zero of=/dev/sda', 'diskpart', 'format C:', ':(){ :|:& };:',
];
const mustAllow = [
	'rm -rf node_modules', 'rm -rf ./build', 'rm -rf dist/', 'rm -rf /tmp/build-cache', 'rm -rf $HOME/projects/old-app', 'rm -rf ~/projects/old-app', 'rm -rf /home/user/project/dist', 'rm -r out',
	'rm file.txt', 'rm -f /tmp/lock', 'git clean -fdx', 'git status', 'ls -la /', 'find . -name "*.log" -delete', 'find /tmp/x -type f -delete', 'chmod -R 755 ./scripts',
	'Remove-Item -Recurse -Force .\\build', 'Remove-Item -Recurse C:\\Users\\me\\proj\\dist', 'del /s /q build\\*.obj', 'rd /s /q out', 'rmdir /s /q C:\\work\\tmp', 'del C:\\work\\a.txt',
	'npm run build', 'cat /etc/hostname', 'echo "rm -rf /" > notes.txt'.replace('"rm -rf /"', 'hello'), 'docker system prune -f', 'cd /; ls',
];
for (const c of mustBlock) check(`blocks: ${c}`, denied(c));
for (const c of mustAllow) check(`allows: ${c}`, !denied(c));

for (const p of ['c:/Windows/System32/drivers/etc/hosts', 'C:/Windows/System32/cmd.exe', 'c:/windows/system32/config/SAM', 'c:/Windows/notepad.exe', '/etc/shadow', '/etc/passwd', '/usr/bin/ls', '/boot/vmlinuz'])
	check(`locked deny for write to ${p}`, deniedPath('file-write', p) && deniedPath('file-delete', p));
for (const p of ['c:/work/app/src/main.ts', '/home/user/app/etc/config.json', 'c:/Users/me/windows-notes.txt'])
	check(`no system-path deny for ${p}`, !deniedPath('file-write', p));
for (const p of ['c:/proj/.env', 'C:/proj/.ENV', 'c:/Users/me/.SSH/id_rsa', 'c:/Users/me/.ssh/id_ed25519', '/home/me/.aws/credentials', 'c:/proj/Server.PEM'])
	check(`asks before touching secret ${p}`, asked('file-read', p));

// ---- user-written rules: a pattern that could hang the window must neither hang it nor stop protecting
{
	const mk = (patterns, builtIn = false) => ({ id: 'u1', description: 'user rule', effect: 'deny', kinds: ['terminal-command'], commandPatterns: patterns, builtIn, locked: false, neverBypassAutonomous: false, enabled: true });
	const req = (command) => ({ kind: 'terminal-command', toolName: 'run_command', command });
	const evil = '(a+)+$';
	const longCommand = 'a'.repeat(40) + 'b';
	let t = Date.now(); const evilHit = ruleMatches(mk([evil]), req(longCommand)); const ms = Date.now() - t;
	check(`a catastrophic user pattern returns at once (${ms} ms), it does not freeze the window`, ms < 200);
	check('a user pattern that cannot be run safely fails CLOSED: the deny rule still fires', evilHit === true);
	check('an ordinary user pattern still works (matches)', ruleMatches(mk(['curl .*\\| *sh']), req('curl http://x | sh')) === true);
	check('an ordinary user pattern still works (does not match)', ruleMatches(mk(['curl .*\\| *sh']), req('ls -la')) === false);
	check('a user pattern with invalid regex syntax is ignored, as before (and the settings UI refuses to save it)', ruleMatches(mk(['(unclosed']), req('anything')) === false);
	check('built-in patterns are used exactly as written (no length cap)', ruleMatches(mk(['rm .*'], true), req('rm x')) === true);
	t = Date.now(); ruleMatches(mk(['(x+x+)+y']), req('x'.repeat(5000))); check('a second catastrophic shape is also bounded', Date.now() - t < 200);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
