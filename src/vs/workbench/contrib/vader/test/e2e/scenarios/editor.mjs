/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Editor features that are not the chat agent: Quick Edit (Ctrl+K), Apply from a chat code block, commit-message generation.

import { seq } from '../modelServer.mjs';

const editorText = (page) => page.locator('.monaco-editor .view-lines').first().innerText().then(x => x.replace(/\u00a0/g, ' '));

export const editorScenarios = [
	{
		name: 'quick edit: Ctrl+K rewrites the selected line, the diff can be accepted and saved',
		timeout: 120_000,
		fn: async (t) => {
			t.use((c) => ({ text: c.system.includes('FIM') ? '<SELECTION>  return a + b;</SELECTION>' : 'not a quick edit request' }));
			await t.ui.openFile(t.page, 'app.js');
			await t.page.locator('.monaco-editor .view-lines').first().click();
			await t.page.keyboard.press('Control+Home');
			await t.page.keyboard.press('ArrowDown');
			await t.page.keyboard.press('Home');
			await t.page.keyboard.press('Shift+End');
			await t.page.keyboard.press('Control+K');
			const input = t.page.locator('textarea[placeholder="Enter instructions..."]');
			t.check('the Quick Edit box opens', await input.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false));
			await input.fill('fix the bug');
			await t.page.keyboard.press('Enter');
			t.check('the model was asked, with the selection and the instruction in the prompt', await t.waitFor(() => t.server.chatRequests().length >= 1, 30_000));
			const r = t.server.chatRequests()[0];
			t.check('the prompt contains the selected code and the instruction', !!r && r.ctx.allText.includes('a - b') && r.ctx.allText.includes('fix the bug'), r?.ctx.allText.slice(-300));
			t.check('the corrected line appears in the editor', await t.waitFor(async () => (await editorText(t.page)).includes('a + b'), 30_000), await editorText(t.page));
			await t.ui.runCommand(t.page, 'Vader: Accept All Diffs in All Files');
			await t.sleep(800);
			await t.page.keyboard.press('Control+S');
			t.check('the fix is saved on disk', await t.waitFor(() => t.read('src/app.js').includes('return a + b;') && !t.read('src/app.js').includes('a - b'), 20_000), t.read('src/app.js'));
		},
	},
	{
		name: 'apply: a code block in the chat can be applied to the open file',
		timeout: 120_000,
		fn: async (t) => {
			const fixed = 'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n';
			t.use((c) => {
				if (/rewrite|REWRITE/.test(c.system) && !c.system.includes('chat')) { return { text: '```javascript\n' + fixed + '```' }; }
				return { text: 'Here is the fixed file:\n```javascript\n' + fixed + '```' };
			});
			await t.ui.openFile(t.page, 'app.js');
			await t.send('fix the add function in app.js');
			t.check('agent returns to idle', await t.idle({ timeout: 60_000 }));
			const block = t.page.locator('.vader-scope pre, .vader-scope [class*="code"]').filter({ hasText: 'return a + b' }).first();
			t.check('the code block is shown in the chat', await block.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false));
			await block.hover();
			const apply = t.page.locator('[data-tooltip-content="Apply"]').first();
			t.check('an Apply button appears on hover', await apply.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false));
			const before = t.server.chatRequests().length;
			await apply.click();
			t.check('applying asks the model for the change', await t.waitFor(() => t.server.chatRequests().length > before, 30_000));
			t.check('the change shows up in the editor', await t.waitFor(async () => (await editorText(t.page)).includes('a + b'), 40_000), await editorText(t.page));
			await t.ui.runCommand(t.page, 'Vader: Accept All Diffs in All Files');
			await t.sleep(800);
			await t.page.keyboard.press('Control+S');
			t.check('the file on disk is fixed', await t.waitFor(() => t.read('src/app.js').includes('return a + b;'), 20_000), t.read('src/app.js'));
		},
	},
	{
		name: 'scm: Generate Commit Message fills the commit box from the real diff',
		timeout: 120_000,
		fn: async (t) => {
			t.write('src/app.js', 'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n');
			t.use(() => ({ text: '<output>Fix add() to add instead of subtract</output>' }));
			await t.sleep(2500);
			await t.page.keyboard.press('Control+Shift+G');
			await t.sleep(1500);
			await t.ui.runCommand(t.page, 'Vader: Generate Commit Message');
			const box = t.page.locator('.scm-editor .view-lines, .scm-editor textarea').first();
			t.check('the model was called for the message', await t.waitFor(() => t.server.chatRequests().length >= 1, 30_000));
			const r = t.server.chatRequests()[0];
			t.check('the prompt contains the real diff', !!r && /a \+ b/.test(r.ctx.allText) && /a - b/.test(r.ctx.allText), r?.ctx.allText.slice(-400));
			t.check('the commit message box contains the generated message', await t.waitFor(async () => (await t.page.locator('.scm-editor').first().innerText().catch(() => '')).replace(/\s+/g, ' ').includes('Fix add() to add instead of subtract'), 20_000), await t.page.locator('.scm-editor').first().innerText().catch(() => '(no scm editor)'));
			await t.page.keyboard.press('Control+Shift+E');
		},
	},
];

// A model that supports fill-in-the-middle (codestral) - Autocomplete is only offered for such models.
export const autocompleteScenarios = [
	{
		name: 'autocomplete: typing in the editor shows an inline suggestion from the FIM endpoint, Tab accepts it',
		timeout: 150_000,
		fn: async (t) => {
			await t.ui.runCommand(t.page, 'Vader: Open Settings');
			await t.page.getByText('Feature Options', { exact: true }).first().click({ timeout: 20_000 });
			await t.sleep(800);
			await t.page.getByText('Disabled', { exact: true }).first().locator('xpath=..').locator('div').first().click({ force: true });
			await t.sleep(800);
			t.check('autocomplete is switched on in settings', await t.page.getByText('Enabled', { exact: true }).first().isVisible());
			await t.page.keyboard.press('Control+W'); // close the settings tab
			t.useFim(({ prompt, suffix }) => '  return a + b;');
			await t.ui.openFile(t.page, 'app.js');
			await t.page.locator('.monaco-editor .view-lines').first().click();
			await t.page.keyboard.press('Control+Home');
			await t.page.keyboard.press('Control+End');
			await t.page.keyboard.press('Enter');
			await t.page.keyboard.type('// next', { delay: 80 });
			await t.page.keyboard.press('Enter');
			const ghost = t.page.locator('.ghost-text, .ghost-text-decoration, [class*="ghost-text"]').first();
			const shown = await ghost.waitFor({ state: 'attached', timeout: 30_000 }).then(() => true, () => false);
			const fim = t.server.requests.filter(r => /\/completions$/.test(r.path) && !/chat\/completions$/.test(r.path));
			t.check('the FIM endpoint was called with the code before the cursor and a suffix', fim.some(r => String(r.body?.prompt).includes('return a - b') && r.body?.suffix !== undefined), fim.map(r => JSON.stringify(r.body).slice(0, 150)).join(' | ') || t.server.requests.map(r => r.path).join(','));
			t.check('an inline suggestion is displayed', shown);
			if (shown) {
				await t.page.keyboard.press('Tab');
				await t.sleep(600);
				t.check('Tab inserts the suggestion into the editor', (await t.page.locator('.monaco-editor .view-lines').first().innerText().then(x => x.replace(/ /g, ' '))).includes('return a + b;\n') || (await t.page.locator('.monaco-editor .view-lines').first().innerText()).replace(/ /g, ' ').split('return a + b;').length > 1);
			}
		},
	},
];
