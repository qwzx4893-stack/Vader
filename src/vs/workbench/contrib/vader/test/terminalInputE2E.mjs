#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// A command that is waiting for input (common/terminalInput.ts).
// Run: node src/vs/workbench/contrib/vader/test/terminalInputE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-terminput-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/terminalInput.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const T = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

const p = (s) => T.inputPromptOf(s);
check('a password prompt is found, and is secret', p("$ git push\nPassword for 'https://me@github.com': ")?.secret === true && p('Password for github.com:')?.prompt === 'Password for github.com');
check('the user name is asked, and is not secret', p("Username for 'https://github.com': ")?.secret === false && p("Username for 'https://github.com': ")?.prompt === "Username for 'https://github.com'");
check('a yes or no question is found', p('Proceed with the installation? [y/N] ')?.secret === false && p('Do you want to continue (y/n)?')?.prompt.includes('continue') && p('Overwrite existing file? [Y/n]') !== undefined);
check('an interactive prompt is found', p('? Project name') !== undefined && p('Enter a version:')?.prompt === 'Enter a version' && p('Press any key to continue . . .') !== undefined);
check('a passphrase and a token are secret', p('Enter passphrase for key /home/me/.ssh/id_rsa:')?.secret === true && p('Paste your API key:')?.secret === true);
check('colours and carriage returns do not hide it', p('\u001b[1mPassword:\u001b[0m \r')?.secret === true);
check('ordinary output is not a question', p('vite v6 building...\ntransforming 412 modules') === undefined && p('built in 41.2s') === undefined && p('') === undefined);
check('a shell prompt of the person is not a question', p('done\n$ ') === undefined && p('PS C:\\work> ') === undefined && p('C:\\work>') === undefined);
check('a line far too long to be a prompt is not one', p('Password: ' + 'x'.repeat(300)) === undefined);
check('only the last line counts: a question that was answered is not still waiting', p('Password: \nAuthentication succeeded\nEverything up-to-date') === undefined);
check('the command is named by its first words', T.commandName('git push origin main') === 'git push' && T.commandName('npm run build') === 'npm run' && T.commandName('ls -la') === 'ls' && T.commandName('./deploy.sh --prod') === './deploy.sh' && T.commandName('') === 'The command');
{
	const w = T.waitingWords('git push origin main', { prompt: 'Password for github.com', secret: true });
	check('the card says what asks and what the agent will not do', w.title === 'A command is waiting for input' && w.name === 'git push' && w.body === ' is asking: Password for github.com. The agent will not type it.' && w.open === 'Open the terminal');
	check('a question that is not a secret says the agent does not answer it', T.waitingWords('npm init', { prompt: 'Project name', secret: false }).body === ' is asking: Project name. The agent does not answer questions like this for you.');
}
check('the model is told not to type a password, nor to guess', T.waitingForModel({ prompt: 'Password', secret: true }).includes('Never type a password') && T.waitingForModel({ prompt: 'Continue? [y/N]', secret: false }).includes('Do not guess') && !T.waitingForModel({ prompt: 'Continue? [y/N]', secret: false }).includes('Never type a password'));

check('the agent may have six terminals, and past that is told which to close', T.MAX_AGENT_TERMINALS === 6 && T.tooManyTerminalsMessage(6).startsWith('The agent already has 6 terminals open') && T.tooManyTerminalsMessage(6).includes('kill_persistent_terminal'));

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
