/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Real models are sloppy in small ways: relative paths, "./" prefixes, numbers sent as strings, optional fields sent as null, the project folder
// itself as ".". Each of these used to be able to end a run with an error the model could not act on (or a wrong file). They must just work.

import { seq } from '../modelServer.mjs';

const fwd = (p) => p.replace(/\\/g, '/');
const call = (name, args) => ({ toolCalls: [{ name, args }] });

export const toleranceScenarios = [
	{
		name: 'tolerance: relative paths are resolved against the open folder',
		fn: async (t) => {
			t.use(seq([
				call('read_file', { uri: 'notes.txt' }),
				call('read_file', { uri: './src/app.js' }),
				call('ls_dir', { uri: '.' }),
				call('ls_dir', { uri: 'src' }),
				call('search_in_file', { uri: 'src/app.js', query: 'BUG' }),
				{ text: 'Done.' },
			]));
			await t.send('read some files with relative paths');
			t.check('the run ends', await t.idle({ timeout: 60_000 }));
			const r = t.server.chatRequests().slice(1).map(x => x.ctx.lastToolResult ?? '');
			t.check('notes.txt is read', r[0].includes('hello world'), r[0].slice(0, 160));
			t.check('./src/app.js is read', r[1].includes('function add'), r[1].slice(0, 160));
			t.check('"." lists the project folder', /notes\.txt/.test(r[2]) && /README\.md/.test(r[2]), r[2].slice(0, 200));
			t.check('"src" lists the src folder', /app\.js/.test(r[3]), r[3].slice(0, 200));
			t.check('search_in_file with a relative path finds the line', /BUG|2/.test(r[4]) && !/error|not exist|no such/i.test(r[4]), r[4].slice(0, 200));
		},
	},
	{
		name: 'tolerance: numbers sent as strings, optional fields sent as null or empty are accepted',
		fn: async (t) => {
			t.use(seq([
				call('read_file', { uri: fwd(t.abs('notes.txt')), start_line: '2', end_line: '2', page_number: '1' }),
				call('read_file', { uri: fwd(t.abs('notes.txt')), start_line: null, end_line: null, page_number: null }),
				call('read_file', { uri: fwd(t.abs('notes.txt')), start_line: '', end_line: '', page_number: '' }),
				call('search_for_files', { query: 'hello', is_regex: 'false', search_in_folder: '', page_number: 1 }),
				{ text: 'Done.' },
			]));
			await t.send('read with odd argument types');
			t.check('the run ends', await t.idle({ timeout: 60_000 }));
			const r = t.server.chatRequests().slice(1).map(x => x.ctx.lastToolResult ?? '');
			t.check('string line numbers select the second line only', r[0].includes('second line') && !r[0].includes('hello world'), r[0].slice(0, 160));
			t.check('null optional fields read the whole file', r[1].includes('hello world') && r[1].includes('second line'), r[1].slice(0, 160));
			t.check('empty-string optional fields read the whole file', r[2].includes('hello world'), r[2].slice(0, 160));
			t.check('a search with empty optional fields works', /notes\.txt/.test(r[3]), r[3].slice(0, 200));
		},
	},
	{
		name: 'tolerance: file:// URLs and a missing file are handled with a clear message',
		fn: async (t) => {
			const fileUrl = 'file://' + (fwd(t.abs('notes.txt')).startsWith('/') ? '' : '/') + fwd(t.abs('notes.txt'));
			t.use(seq([
				call('read_file', { uri: fileUrl }),
				call('read_file', { uri: fwd(t.abs('does-not-exist.txt')) }),
				(c) => ({ text: 'Understood.' }),
			]));
			await t.send('read a file url and a missing file');
			t.check('the run ends', await t.idle({ timeout: 60_000 }));
			const r = t.server.chatRequests().slice(1).map(x => x.ctx.lastToolResult ?? '');
			t.check('a file:// URL is read', r[0].includes('hello world'), r[0].slice(0, 160));
			t.check('a missing file is reported in words', /not exist|no such|not found|cannot|could not|doesn't exist/i.test(r[1]), r[1].slice(0, 200));
			t.check('and the final answer is shown', (await t.ui.assistantTexts(t.page)).some(x => x.includes('Understood.')));
		},
	},
	{
		name: 'tolerance: a file created or rewritten with a relative path lands inside the open folder (not at the root of the disk)',
		fn: async (t) => {
			t.use(seq([
				call('create_file_or_folder', { uri: 'made/relative.txt' }),
				call('rewrite_file', { uri: './made/relative.txt', new_content: 'written by relative path\n' }),
				{ text: 'Done.' },
			]));
			await t.send('create made/relative.txt');
			for (let i = 0; i < 2; i++) { if (await t.waitApproval(20_000)) { await t.approve(); } }
			t.check('the run ends', await t.idle({ timeout: 60_000 }));
			t.check('the file exists inside the workspace with its content', t.exists('made/relative.txt') && t.read('made/relative.txt').includes('written by relative path'), t.exists('made/relative.txt') ? t.read('made/relative.txt') : 'missing');
		},
	},
	{
		name: 'tolerance: edit_file on a file with Windows (CRLF) line endings works with the LF text the model saw',
		fn: async (t) => {
			t.write('crlf.txt', 'first line\r\nsecond line\r\nthird line\r\n');
			t.use(seq([
				call('read_file', { uri: fwd(t.abs('crlf.txt')) }),
				call('edit_file', { uri: fwd(t.abs('crlf.txt')), search_replace_blocks: '<<<<<<< ORIGINAL\nsecond line\n=======\nsecond line (edited)\n>>>>>>> UPDATED' }),
				{ text: 'Edited.' },
			]));
			await t.send('edit the crlf file');
			if (await t.waitApproval(20_000)) { await t.approve(); }
			t.check('the run ends', await t.idle({ timeout: 60_000 }));
			await t.ui.runCommand(t.page, 'File: Save All').catch(() => { });
			t.check('the file contains the edit', await t.waitFor(() => t.read('crlf.txt').includes('second line (edited)'), 15_000), JSON.stringify(t.read('crlf.txt')));
			t.check('and the other lines are intact', t.read('crlf.txt').includes('first line') && t.read('crlf.txt').includes('third line'));
		},
	},
	{
		name: 'tolerance: an edit_file whose ORIGINAL text is not in the file is reported to the model in words and changes nothing',
		fn: async (t) => {
			t.use(seq([
				call('edit_file', { uri: fwd(t.abs('notes.txt')), search_replace_blocks: '<<<<<<< ORIGINAL\nthis text is not in the file\n=======\nreplacement\n>>>>>>> UPDATED' }),
				(c) => ({ text: 'Result seen: ' + (c.lastToolResult ?? '').slice(0, 200) }),
			]));
			await t.send('edit with wrong original');
			if (await t.waitApproval(15_000)) { await t.approve(); }
			t.check('the run ends', await t.idle({ timeout: 60_000 }));
			const reqs = t.server.chatRequests();
			t.check('the model was told the text was not found', /not found|could not find|no match|did not match|doesn't match|does not match|original/i.test(reqs[1]?.ctx.lastToolResult ?? ''), (reqs[1]?.ctx.lastToolResult ?? '').slice(0, 300));
			t.check('the file is unchanged', t.read('notes.txt').includes('hello world') && !t.read('notes.txt').includes('replacement'));
		},
	},
	{
		name: 'tolerance: a network share path in a file tool is refused with a reason (Windows would send the login hash to that host)',
		fn: async (t) => {
			t.use(seq([
				call('read_file', { uri: '\\\\attacker.example\\share\\notes.txt' }),
				call('read_file', { uri: '//attacker.example/share/notes.txt' }),
				call('ls_dir', { uri: 'file://attacker.example/share' }),
				call('read_file', { uri: 'file://localhost' + (fwd(t.abs('notes.txt')).startsWith('/') ? '' : '/') + fwd(t.abs('notes.txt')) }),
				{ text: 'Done.' },
			]));
			await t.send('read from a share');
			t.check('the run ends', await t.idle({ timeout: 60_000 }));
			const r = t.server.chatRequests().slice(1).map(x => x.ctx.lastToolResult ?? '');
			t.check('a \\\\host\\share path is refused in words', /network share|another computer/i.test(r[0]), r[0].slice(0, 200));
			t.check('a //host/share path is refused', /network share|another computer/i.test(r[1]), r[1].slice(0, 200));
			t.check('a file://host/share URL is refused', /network share|another computer/i.test(r[2]), r[2].slice(0, 200));
			t.check('file://localhost/... is still a normal local file', r[3].includes('hello world'), r[3].slice(0, 160));
		},
	},
];
