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
const providerBlock = (t, title) => t.page.locator('.vader-scope h3', { hasText: title }).first().locator('xpath=../..');
const status = (t) => t.page.locator('[data-testid="vader-cloud-models-status"]');
const setField = async (block, placeholderStart, value) => {
	const input = block.locator(`input[placeholder^="${placeholderStart}"]`).first();
	await input.fill(value);
};
const modelsTabText = async (t) => {
	await t.page.getByText('Models', { exact: true }).first().click();
	await t.sleep(700);
	return (await t.page.locator('.vader-scope').allInnerTexts()).join('\n');
};

export const providerScenarios = [
	{
		name: 'providers: models appear only from the key (live list), a rejected key lists none and is reported, removing the key clears them',
		timeout: 150_000,
		fn: async (t) => {
			const KEY = 'sk-live-test-1234';
			t.server.setModelsHandler(({ auth }) => auth === `Bearer ${KEY}`
				? { body: { object: 'list', data: [{ id: 'kimi-live-alpha', created: 20 }, { id: 'kimi-live-beta', created: 10 }] } }
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
			const liveRows = (x) => new Set(x.match(/kimi-live-[a-z]+/g) ?? []).size; // distinct ids (the chosen model is also shown in the model pickers)
			t.check('with only a rejected key none of Moonshot\'s models is listed (no names are written in)', liveRows(text) === 0 && !/moonshot-v1|kimi-k2\.6\b/.test(text.replace(/@cf\/moonshotai\/kimi-k2\.6/g, '')), text.split('\n').filter(l => /kimi|moonshot-v1/.test(l)).join(' | ').slice(0, 200));

			// now the right key
			await openSettings(t, 'Main Providers');
			await setField(providerBlock(t, 'Moonshot'), 'API Key', KEY);
			t.check('the right key turns the status to "works" with the model count', await t.waitFor(async () => (await status(t).getAttribute('data-status').catch(() => null)) === 'ok', 15_000) && /2 models/.test(await status(t).innerText()), await status(t).innerText().catch(() => '(no status)'));
			text = await modelsTabText(t);
			t.check('the models the key offers are listed (kimi-live-alpha)', text.includes('kimi-live-alpha'));
			t.check('exactly what the key offers is listed for Moonshot (both models, nothing else made up)', liveRows(text) === 2 && text.includes('kimi-live-beta'), String(liveRows(text)));

			// remove the key again
			await openSettings(t, 'Main Providers');
			await setField(providerBlock(t, 'Moonshot'), 'API Key', '');
			await t.sleep(1500);
			text = await modelsTabText(t);
			t.check('removing the key clears the list again (nothing left over from the live answer)', liveRows(text) === 0, String(liveRows(text)));
			await openSettings(t, 'Main Providers');
			await setField(providerBlock(t, 'Moonshot'), 'Endpoint', 'https://api.moonshot.ai/v1');
		},
	},
	{
		name: 'providers: the search box finds a vendor among the many providers, and a key there unlocks that vendor\'s real model list',
		timeout: 120_000,
		fn: async (t) => {
			const KEY = 'sk-together-test-1234';
			t.server.setModelsHandler(({ auth }) => auth === `Bearer ${KEY}`
				? { body: { object: 'list', data: [{ id: 'together-live-llama', created: 30 }, { id: 'together-live-qwen', created: 20 }] } }
				: { status: 401, body: { error: { message: 'bad key' } } });
			await openSettings(t, 'Main Providers');
			const search = t.page.locator('.vader-scope input[placeholder^="Search "]').first();
			t.check('a search box offers to search all the providers', (await search.count()) === 1 && /Search \d+ providers/.test(await search.getAttribute('placeholder')));
			await search.fill('together');
			await t.sleep(500);
			const titles = await t.page.locator('.vader-scope h3').allInnerTexts();
			t.check('searching "together" leaves Together AI', titles.some(x => x.includes('Together AI')), JSON.stringify(titles.slice(0, 8)));
			t.check('...and hides the others (Moonshot is gone)', !titles.some(x => x.includes('Moonshot')));
			await search.fill('qwen');
			await t.sleep(500);
			t.check('searching "qwen" finds Alibaba Cloud (Qwen)', (await t.page.locator('.vader-scope h3').allInnerTexts()).some(x => x.includes('Alibaba Cloud')));
			await search.fill('together');
			await t.sleep(500);
			const block = providerBlock(t, 'Together AI');
			if (process.env.E2E_SHOTS) { await search.fill(''); await t.sleep(600); await t.page.screenshot({ path: `${process.env.E2E_SHOTS}/providers-list.png` }); await search.fill('together'); await t.sleep(500); }
			t.check('the provider heading carries its real logo (an inline one-colour svg)', (await t.page.locator('.vader-scope h3 svg[data-provider-logo="together"] path').count()) > 0);
			const hint = await block.locator('input[placeholder^="Endpoint"]').first().getAttribute('placeholder');
			t.check('the vendor fields are labelled with its real gateway as the endpoint hint', !!hint && hint.includes('api.together.xyz') && !(await block.innerText()).includes('(never)'), String(hint));
			await setField(block, 'Endpoint', t.server.url);
			await setField(block, 'API Key', KEY);
			t.check('the key turns the status to "works" with the vendor\'s model count', await t.waitFor(async () => (await status(t).getAttribute('data-status').catch(() => null)) === 'ok', 15_000) && /2 models/.test(await status(t).innerText()), await status(t).innerText().catch(() => '(no status)'));
			t.check('the key reached the vendor\'s own endpoint as a bearer token', t.server.modelListRequests.some(r => r.auth === `Bearer ${KEY}`));
			const models = await modelsTabText(t);
			t.check('the vendor\'s real models are listed (together-live-llama)', models.includes('together-live-llama'));
			await openSettings(t, 'Main Providers');
			await t.page.locator('.vader-scope input[placeholder^="Search "]').first().fill('together');
			await setField(providerBlock(t, 'Together AI'), 'API Key', '');
			await setField(providerBlock(t, 'Together AI'), 'Endpoint', 'https://api.together.xyz/v1');
			await t.page.locator('.vader-scope input[placeholder^="Search "]').first().fill(''); // the filter survives navigation: leave the page as it was
		},
	},
	{
		name: 'providers: a provider that cannot be reached lists nothing it cannot confirm, and says so',
		timeout: 90_000,
		fn: async (t) => {
			await openSettings(t, 'Main Providers');
			const block = providerBlock(t, 'Moonshot');
			await setField(block, 'Endpoint', 'http://127.0.0.1:9'); // nothing listens there
			await setField(block, 'API Key', 'sk-any');
			t.check('the status explains that the provider could not be reached', await t.waitFor(async () => /could not reach|did not answer/i.test(await status(t).innerText().catch(() => '')), 20_000), await status(t).innerText().catch(() => '(no status)'));
			t.check('and says no models are listed until the provider answers', /No models are listed until the provider answers/i.test(await status(t).innerText()));
			t.check('a Retry button is offered', (await status(t).getByText('Retry').count()) === 1);
			await setField(block, 'API Key', '');
			await setField(block, 'Endpoint', 'https://api.moonshot.ai/v1');
		},
	},
];
