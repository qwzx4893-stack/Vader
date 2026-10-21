/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Hosted providers: type a key in Settings and Vader asks the provider which models that key can use. Run against a
// hosted provider whose endpoint is user-editable (Moonshot), pointed at the stub server, so the whole path is real:
// UI -> settings service -> IPC -> main-process request with the key -> answer -> model list in the app.
// The providers are one list on the Settings > Models page: a row per provider, opened to show its fields and its models.

const TID = (id) => `[data-testid="${id}"]`;

/** Settings > Models, the provider's row found by the search box and opened */
const openProvider = async (t, id, search) => {
	await t.ui.runCommand(t.page, 'Vader: Open Settings');
	await t.page.locator(TID('vader-settings-nav-models')).click({ timeout: 20_000 });
	await t.page.locator(TID('vader-models-search')).fill(search);
	await t.sleep(400);
	const row = t.page.locator(`[data-testid="vader-provider-row"][data-provider="${id}"]`);
	if (!(await row.locator(TID('vader-provider-body')).count())) { await row.locator(TID('vader-provider-toggle')).click({ timeout: 20_000 }); }
	await t.sleep(400);
	return row;
};
const status = (row) => row.locator(TID('vader-provider-status'));
const setField = async (row, placeholderStart, value) => {
	const input = row.locator(`input[placeholder^="${placeholderStart}"]`).first();
	await input.fill(value);
};
/** the key is shown masked once saved: changing it starts with "Replace" */
const replaceKey = async (row, value) => {
	const replace = row.locator(TID('vader-provider-apiKey-replace'));
	if (await replace.count()) { await replace.click(); }
	await setField(row, 'API Key', value);
};
const rowText = async (row) => (await row.innerText()).replace(/•/g, '*');

export const providerScenarios = [
	{
		name: 'providers: models appear only from the key (live list), a rejected key lists none and is reported, removing the key clears them',
		timeout: 150_000,
		fn: async (t) => {
			const KEY = 'sk-live-test-1234';
			t.server.setModelsHandler(({ auth }) => auth === `Bearer ${KEY}`
				? { body: { object: 'list', data: [{ id: 'kimi-live-alpha', created: 20 }, { id: 'kimi-live-beta', created: 10 }] } }
				: { status: 401, body: { error: { message: `bad key ${auth}` } } });
			let row = await openProvider(t, 'moonshot', 'moonshot');
			t.check('the Moonshot fields are labelled (they used to show "(never)")', (await row.innerText()).includes('Endpoint') && !(await row.innerText()).includes('(never)'));

			// point the provider at the stub server, then type a WRONG key
			await setField(row, 'Endpoint', t.server.url);
			await setField(row, 'API Key', 'sk-wrong');
			t.check('a wrong key is reported as rejected by the provider', await t.waitFor(async () => (await status(row).getAttribute('data-status').catch(() => null)) === 'error', 15_000), await status(row).innerText().catch(() => '(no status)'));
			t.check('the message says the key was rejected and does not echo the key', /rejected/i.test(await status(row).innerText()) && !(await status(row).innerText()).includes('sk-wrong'));
			t.check('the key was sent to the provider as a bearer token', t.server.modelListRequests.some(r => r.auth === 'Bearer sk-wrong'));
			let text = await rowText(row);
			const liveRows = (x) => new Set(x.match(/kimi-live-[a-z]+/g) ?? []).size; // distinct ids
			t.check('with only a rejected key none of Moonshot\'s models is listed (no names are written in)', liveRows(text) === 0 && !/moonshot-v1|kimi-k2\.6\b/.test(text), text.split('\n').filter(l => /kimi|moonshot-v1/.test(l)).join(' | ').slice(0, 200));

			// now the right key
			await replaceKey(row, KEY);
			t.check('the right key turns the status to "works" with the model count', await t.waitFor(async () => (await status(row).getAttribute('data-status').catch(() => null)) === 'ok', 15_000) && /2 models/.test(await status(row).innerText()), await status(row).innerText().catch(() => '(no status)'));
			text = await rowText(row);
			t.check('the models the key offers are listed (kimi-live-alpha)', text.includes('kimi-live-alpha'));
			t.check('exactly what the key offers is listed for Moonshot (both models, nothing else made up)', liveRows(text) === 2 && text.includes('kimi-live-beta'), String(liveRows(text)));

			// remove the key again
			row = await openProvider(t, 'moonshot', 'moonshot');
			await replaceKey(row, '');
			await t.sleep(1500);
			text = await rowText(row);
			t.check('removing the key clears the list again (nothing left over from the live answer)', liveRows(text) === 0, String(liveRows(text)));
			await setField(row, 'Endpoint', 'https://api.moonshot.ai/v1');
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
			let row = await openProvider(t, 'together', 'together');
			const search = t.page.locator(TID('vader-models-search'));
			t.check('a search box offers to search all the providers', (await search.count()) === 1 && /Search \d+ providers/.test(await search.getAttribute('placeholder')));
			const titles = async () => (await t.page.locator(`${TID('vader-provider-row')}[data-has-key] ${TID('vader-provider-toggle')}`).allInnerTexts());
			t.check('searching "together" leaves Together AI', (await titles()).some(x => x.includes('Together AI')), JSON.stringify((await titles()).slice(0, 8)));
			t.check('...and hides the others (Moonshot is gone)', !(await titles()).some(x => x.includes('Moonshot')));
			await search.fill('qwen');
			await t.sleep(500);
			t.check('searching "qwen" finds Alibaba Cloud (Qwen)', (await titles()).some(x => x.includes('Alibaba Cloud')));
			await search.fill('together');
			await t.sleep(500);
			row = t.page.locator('[data-testid="vader-provider-row"][data-provider="together"]');
			if (process.env.E2E_SHOTS) { await search.fill(''); await t.sleep(600); await t.page.screenshot({ path: `${process.env.E2E_SHOTS}/providers-list.png` }); await search.fill('together'); await t.sleep(500); }
			t.check('the provider row carries its real logo (an inline one-colour svg)', (await row.locator('svg[data-provider-logo="together"] path').count()) > 0);
			const hint = await row.locator('input[placeholder^="Endpoint"]').first().getAttribute('placeholder');
			t.check('the vendor fields are labelled with its real gateway as the endpoint hint', !!hint && hint.includes('api.together.xyz') && !(await row.innerText()).includes('(never)'), String(hint));
			await setField(row, 'Endpoint', t.server.url);
			await setField(row, 'API Key', KEY);
			t.check('the key turns the status to "works" with the vendor\'s model count', await t.waitFor(async () => (await status(row).getAttribute('data-status').catch(() => null)) === 'ok', 15_000) && /2 models/.test(await status(row).innerText()), await status(row).innerText().catch(() => '(no status)'));
			t.check('the key reached the vendor\'s own endpoint as a bearer token', t.server.modelListRequests.some(r => r.auth === `Bearer ${KEY}`));
			t.check('the vendor\'s real models are listed (together-live-llama)', (await rowText(row)).includes('together-live-llama'));
			row = await openProvider(t, 'together', 'together');
			await replaceKey(row, '');
			await setField(row, 'Endpoint', 'https://api.together.xyz/v1');
			await t.page.locator(TID('vader-models-search')).fill(''); // the filter survives navigation: leave the page as it was
		},
	},
	{
		name: 'providers: a provider that cannot be reached lists nothing it cannot confirm, and says so',
		timeout: 90_000,
		fn: async (t) => {
			const row = await openProvider(t, 'moonshot', 'moonshot');
			await setField(row, 'Endpoint', 'http://127.0.0.1:9'); // nothing listens there
			await setField(row, 'API Key', 'sk-any');
			t.check('the status explains that the provider could not be reached', await t.waitFor(async () => /could not reach|did not answer/i.test(await status(row).innerText().catch(() => '')), 20_000), await status(row).innerText().catch(() => '(no status)'));
			t.check('and says no models are listed until the provider answers', /No models are listed until the provider answers/i.test(await status(row).innerText()));
			t.check('asking again is offered (Refresh models)', (await row.locator(TID('vader-provider-refresh')).count()) === 1);
			await replaceKey(row, '');
			await setField(row, 'Endpoint', 'https://api.moonshot.ai/v1');
		},
	},
];
