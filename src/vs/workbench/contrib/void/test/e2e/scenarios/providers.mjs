/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Hosted providers: type a key in Settings and Vader asks the provider which models that key can use. Run against a
// hosted provider whose endpoint is user-editable (Moonshot), pointed at the stub server, so the whole path is real:
// UI -> settings service -> IPC -> main-process request with the key -> answer -> model list in the app.

const openSettings = async (t, tab) => {
	await t.ui.runCommand(t.page, 'Vader: Open Settings');
	await t.page.getByText(tab, { exact: true }).first().click({ timeout: 20_000 });
	await t.sleep(700);
};
const providerBlock = (t, title) => t.page.locator('.void-scope h3', { hasText: title }).first().locator('xpath=../..');
const status = (t) => t.page.locator('[data-testid="vader-cloud-models-status"]');
const setField = async (block, placeholderStart, value) => {
	const input = block.locator(`input[placeholder^="${placeholderStart}"]`).first();
	await input.fill(value);
};
const modelsTabText = async (t) => {
	await t.page.getByText('Models', { exact: true }).first().click();
	await t.sleep(700);
	return (await t.page.locator('.void-scope').allInnerTexts()).join('\n');
};

export const providerScenarios = [
	{
		name: 'providers: a working key unlocks the live model list, a rejected key is reported, removing it restores the defaults',
		timeout: 150_000,
		fn: async (t) => {
			const KEY = 'sk-live-test-1234';
			t.server.setModelsHandler(({ auth }) => auth === `Bearer ${KEY}`
				? { body: { object: 'list', data: [{ id: 'kimi-live-alpha', created: 20 }, { id: 'kimi-k3', created: 10 }] } }
				: { status: 401, body: { error: { message: `bad key ${auth}` } } });
			await openSettings(t, 'Main Providers');
			const block = providerBlock(t, 'Moonshot');
			t.check('the Moonshot fields are labelled (they used to show "(never)")', (await block.innerText()).includes('Endpoint') && !(await block.innerText()).includes('(never)'));

			// point the provider at the stub server, then type a WRONG key
			await setField(block, 'Endpoint', t.server.url);
			await setField(block, 'API Key', 'sk-wrong');
			t.check('a wrong key is reported as rejected by the provider', await t.waitFor(async () => (await status(t).getAttribute('data-status').catch(() => null)) === 'error', 15_000), await status(t).innerText().catch(() => '(no status)'));
			t.check('the message says the key was rejected and does not echo the key', /rejected/i.test(await status(t).innerText()) && !(await status(t).innerText()).includes('sk-wrong'));
			t.check('the key was sent to the provider as a bearer token', t.server.modelListRequests.some(r => r.auth === 'Bearer sk-wrong'));
			let text = await modelsTabText(t);
			t.check('while the key is rejected the built-in defaults stay (kimi-k2.6 is listed)', text.includes('kimi-k2.6'));

			// now the right key
			await openSettings(t, 'Main Providers');
			await setField(providerBlock(t, 'Moonshot'), 'API Key', KEY);
			t.check('the right key turns the status to "works" with the model count', await t.waitFor(async () => (await status(t).getAttribute('data-status').catch(() => null)) === 'ok', 15_000) && /2 models/.test(await status(t).innerText()), await status(t).innerText().catch(() => '(no status)'));
			text = await modelsTabText(t);
			t.check('the models the key offers are listed (kimi-live-alpha)', text.includes('kimi-live-alpha'));
			t.check('models the key does not offer are gone (kimi-k2.6)', !text.includes('kimi-k2.6'));

			// remove the key again
			await openSettings(t, 'Main Providers');
			await setField(providerBlock(t, 'Moonshot'), 'API Key', '');
			await t.sleep(1500);
			text = await modelsTabText(t);
			t.check('removing the key brings the built-in defaults back', text.includes('kimi-k2.6') && !text.includes('kimi-live-alpha'));
			await openSettings(t, 'Main Providers');
			await setField(providerBlock(t, 'Moonshot'), 'Endpoint', 'https://api.moonshot.ai/v1');
		},
	},
	{
		name: 'providers: a provider that cannot be reached keeps the built-in list and says so',
		timeout: 90_000,
		fn: async (t) => {
			await openSettings(t, 'Main Providers');
			const block = providerBlock(t, 'Moonshot');
			await setField(block, 'Endpoint', 'http://127.0.0.1:9'); // nothing listens there
			await setField(block, 'API Key', 'sk-any');
			t.check('the status explains that the provider could not be reached', await t.waitFor(async () => /could not reach|did not answer/i.test(await status(t).innerText().catch(() => '')), 20_000), await status(t).innerText().catch(() => '(no status)'));
			t.check('and says the built-in list is shown meanwhile', /built-in list/i.test(await status(t).innerText()));
			t.check('a Retry button is offered', (await status(t).getByText('Retry').count()) === 1);
			await setField(block, 'API Key', '');
			await setField(block, 'Endpoint', 'https://api.moonshot.ai/v1');
		},
	},
];
