/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Ordinary editor use that has nothing to do with the model: the IDE underneath must still behave like VS Code.

const norm = (s) => s.replace(/ /g, ' ');
const editorText = (page) => page.locator('.monaco-editor .view-lines').first().innerText().then(norm);

export const generalScenarios = [
	{
		name: 'general: open a file, edit it, save it - the change is on disk',
		fn: async (t) => {
			await t.ui.openFile(t.page, 'notes.txt');
			t.check('the file opens in the editor', (await editorText(t.page)).includes('hello world'));
			await t.page.locator('.monaco-editor .view-lines').first().click();
			await t.page.keyboard.press('Control+End');
			await t.page.keyboard.type('typed by a user');
			await t.page.keyboard.press('Control+S');
			t.check('the edit is saved to disk', await t.waitFor(() => t.read('notes.txt').includes('typed by a user'), 10_000), t.read('notes.txt'));
		},
	},
	{
		name: 'general: find in files locates text across the workspace',
		fn: async (t) => {
			await t.page.keyboard.press('Control+Shift+F');
			await t.sleep(800);
			await t.page.keyboard.type('Used by the Vader');
			await t.page.keyboard.press('Enter');
			t.check('the search result shows README.md', await t.waitFor(async () => (await t.page.locator('.search-view').innerText()).includes('README.md'), 20_000), await t.page.locator('.search-view').innerText().catch(() => ''));
			await t.page.keyboard.press('Control+Shift+E');
		},
	},
	{
		name: 'general: a new file can be created, typed into and saved through the Explorer',
		fn: async (t) => {
			await t.ui.runCommand(t.page, 'File: New File...');
			await t.sleep(600);
			await t.page.keyboard.type('created.txt');
			await t.page.keyboard.press('Enter');
			await t.sleep(1200);
			await t.page.keyboard.press('Escape');
			await t.page.locator('.monaco-editor .view-lines').first().click().catch(() => { });
			await t.page.keyboard.type('brand new content');
			await t.page.keyboard.press('Control+S');
			t.check('the new file exists with its content', await t.waitFor(() => t.exists('created.txt') && t.read('created.txt').includes('brand new content'), 15_000), t.exists('created.txt') ? t.read('created.txt') : 'missing');
		},
	},
	{
		name: 'general: the command palette offers the Vader commands',
		fn: async (t) => {
			await t.page.keyboard.press('F1');
			await t.page.waitForSelector('.quick-input-widget', { state: 'visible' });
			await t.page.keyboard.type('Vader:');
			await t.sleep(900);
			const list = norm(await t.page.locator('.quick-input-list').innerText());
			for (const c of ['Quick Edit', 'Open Sidebar', 'Generate Commit Message', 'Open Settings']) { t.check(`"Vader: ${c}" is listed`, list.includes(c), list.slice(0, 200)); }
			await t.page.keyboard.press('Escape');
		},
	},
	{
		name: 'general: Source Control shows a modified file and the settings editor opens',
		fn: async (t) => {
			t.write('notes.txt', 'changed on disk\n');
			await t.page.keyboard.press('Control+Shift+G');
			t.check('the modified file is listed under Source Control', await t.waitFor(async () => (await t.page.locator('.part.sidebar').innerText()).includes('notes.txt'), 25_000), await t.page.locator('.part.sidebar').innerText().catch(() => ''));
			await t.page.keyboard.press('Control+Shift+E');
			await t.page.keyboard.press('Control+,');
			t.check('the Settings editor opens', await t.page.locator('.settings-editor').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false));
			await t.page.keyboard.press('Control+W');
		},
	},
	{
		name: 'general: the integrated editor features work (find/replace, go to line, split editor)',
		fn: async (t) => {
			await t.ui.openFile(t.page, 'app.js');
			await t.page.locator('.monaco-editor .view-lines').first().click();
			await t.page.keyboard.press('Control+H');
			await t.page.keyboard.type('a - b');
			await t.page.keyboard.press('Tab');
			await t.page.keyboard.type('a * b');
			await t.page.keyboard.press('Control+Alt+Enter');
			await t.sleep(500);
			await t.page.keyboard.press('Escape');
			t.check('replace-all changed the buffer', (await editorText(t.page)).includes('a * b'), await editorText(t.page));
			await t.page.keyboard.press('Control+Z');
			await t.page.keyboard.press('Control+G');
			await t.page.keyboard.type('3');
			await t.page.keyboard.press('Enter');
			await t.ui.runCommand(t.page, 'View: Split Editor Right');
			t.check('the editor was split into two groups', await t.waitFor(async () => (await t.page.locator('.editor-group-container').count()) >= 2, 8000));
			await t.ui.runCommand(t.page, 'View: Reset Editor Group Sizes');
		},
	},
	{
		name: 'general: previous chat threads are listed and can be reopened with their history',
		fn: async (t) => {
			t.use(() => ({ text: 'Answer for the history test.' }));
			await t.send('remember this question please');
			await t.idle();
			await t.ui.newThread(t.page);
			await t.sleep(600);
			const prev = t.page.getByText('remember this question please').first();
			t.check('the old thread is listed under Previous Threads', await prev.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false));
			await prev.click().catch(() => { });
			t.check('opening it shows the earlier answer', await t.waitFor(async () => (await t.ui.assistantTexts(t.page)).some(x => x.includes('Answer for the history test.')), 10_000));
		},
	},
];

if (process.env.E2E_PRISTINE === '1') {
	generalScenarios.push({
		name: 'general: a clean install shows no "corrupt installation" or other warning notifications',
		fn: async (t) => {
			await t.sleep(3000);
			const toasts = await t.ui.toastTexts(t.page);
			t.check('no "appears to be corrupt" notification', !toasts.some(x => /corrupt/i.test(x)), toasts.join(' | '));
		},
	});
}
