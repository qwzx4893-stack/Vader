/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The app started with NO folder open (a very common state: the first launch, or a chat opened from the Start screen). The agent must still be
// usable: tools that can work without a folder work, and the ones that cannot say so in words the model understands, so the run goes on instead
// of ending silently. The files used here sit in a temporary directory that is simply not opened as a workspace.

import { seq } from '../modelServer.mjs';

const fwd = (p) => p.replace(/\\/g, '/');

export const noWorkspaceScenarios = [
	{
		name: 'no workspace: the model is told no folder is open, and reading a file by absolute path works',
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'read_file', args: { uri: fwd(t.abs('notes.txt')) } }] },
				(c) => ({ text: `Got: ${(c.lastToolResult ?? '').includes('hello world') ? 'hello world' : '(no content) ' + (c.lastToolResult ?? '').slice(0, 120)}` }),
			]));
			await t.send('read the notes file');
			t.check('the run ends', await t.idle());
			const reqs = t.server.chatRequests();
			t.check('the system prompt says no folder is open', /NO FOLDERS OPEN/.test(reqs[0]?.ctx.allText ?? ''));
			t.check('the file content came back to the model', (reqs[1]?.ctx.lastToolResult ?? '').includes('hello world'), (reqs[1]?.ctx.lastToolResult ?? '').slice(0, 200));
			t.check('the answer is shown', (await t.ui.assistantTexts(t.page)).some(x => x.includes('Got: hello world')));
		},
	},
	{
		name: 'no workspace: a relative path or an empty directory argument gets an answer the model can act on, and the run goes on',
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'read_file', args: { uri: 'notes.txt' } }] },
				{ toolCalls: [{ name: 'ls_dir', args: { uri: '' } }] },
				{ toolCalls: [{ name: 'ls_dir', args: {} }] },
				(c) => ({ text: 'Understood.' }),
			]));
			await t.send('look around');
			t.check('the run ends', await t.idle());
			const reqs = t.server.chatRequests();
			t.check('every call was answered (the model was asked 4 times)', reqs.length === 4, reqs.length);
			const results = reqs.slice(1).map(r => r.ctx.lastToolResult ?? '');
			t.check('none of the answers is empty', results.every(r => r.trim().length > 0), JSON.stringify(results.map(r => r.slice(0, 60))));
			t.check('the relative path is explained (needs an open folder or an absolute path)', /folder|workspace|absolute|full path|not exist|no such|not found/i.test(results[0]), results[0].slice(0, 200));
			t.check('the final answer is shown', (await t.ui.assistantTexts(t.page)).some(x => x.includes('Understood.')));
		},
	},
	{
		name: 'no workspace: listing a folder and searching by absolute path work',
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'ls_dir', args: { uri: fwd(t.abs('src')) } }] },
				{ toolCalls: [{ name: 'get_dir_tree', args: { uri: fwd(t.abs('')) } }] },
				{ toolCalls: [{ name: 'search_for_files', args: { query: 'BUG', search_in_folder: fwd(t.abs('')) } }] },
				{ text: 'Done looking.' },
			]));
			await t.send('explore');
			t.check('the run ends', await t.idle({ timeout: 60_000 }));
			const reqs = t.server.chatRequests();
			t.check('the model was asked 4 times', reqs.length === 4, reqs.length);
			t.check('the folder listing shows app.js', /app\.js/.test(reqs[1]?.ctx.lastToolResult ?? ''), (reqs[1]?.ctx.lastToolResult ?? '').slice(0, 200));
			t.check('the tree shows notes.txt', /notes\.txt/.test(reqs[2]?.ctx.lastToolResult ?? ''), (reqs[2]?.ctx.lastToolResult ?? '').slice(0, 200));
			t.check('the search answered (found the file or said nothing matched)', (reqs[3]?.ctx.lastToolResult ?? '').trim().length > 0, (reqs[3]?.ctx.lastToolResult ?? '').slice(0, 200));
		},
	},
	{
		name: 'no workspace: creating a file by absolute path asks for approval and writes it',
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'create_file_or_folder', args: { uri: fwd(t.abs('made.txt')) } }] },
				{ text: 'Created.' },
			]));
			await t.send('make made.txt');
			t.check('approval is requested', await t.waitApproval(30_000));
			await t.approve();
			t.check('the run ends', await t.idle());
			t.check('the file exists', t.exists('made.txt'));
		},
	},
	{
		name: 'no workspace: a terminal command still runs (in the home folder) instead of failing',
		needs: ['natives'],
		timeout: 90_000,
		fn: async (t) => {
			t.use(seq([
				{ toolCalls: [{ name: 'run_command', args: { command: 'node -e "console.log(6*7)"' } }] },
				(c) => ({ text: `Result: ${/42/.test(c.lastToolResult ?? '') ? '42' : '(not found) ' + (c.lastToolResult ?? '').slice(0, 150)}` }),
			]));
			await t.send('compute 6*7 with node');
			t.check('approval is requested', await t.waitApproval(30_000));
			await t.approve();
			t.check('the run ends', await t.idle({ timeout: 60_000 }));
			t.check('the command ran', (await t.ui.assistantTexts(t.page)).some(x => x.includes('Result: 42')));
		},
	},
];
