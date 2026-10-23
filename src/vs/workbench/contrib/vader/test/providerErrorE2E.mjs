#!/usr/bin/env node
// Pure source tests. No React rendering, browser, provider, network or built out/ bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = process.env.VADER_TEST_REPO ?? path.resolve(here, '../../../../../..');
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const root = path.join(repo, 'src/vs/workbench/contrib/vader');
const load = relative => {
	const source = fs.readFileSync(path.join(root, relative), 'utf8');
	const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } });
	const sandbox = { exports: {}, require: () => ({}) };
	vm.runInNewContext(outputText, sandbox, { filename: relative });
	return sandbox.exports;
};
const { classifyProviderError: classify, userFacingProviderError: words } = load('common/providerErrorTypes.ts');
// Execute only the exported pure card function. Imported service/rendering bindings
// are deliberately inert; this does not establish rendered UI or service behavior.
const { cardForError } = load('browser/react/src/sidebar-tsx/ErrorDisplay.tsx');
let passed = 0, failed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log(`PASS: ${name}`); } catch (e) { failed++; console.error(`FAIL: ${name}\n${e.stack}`); } };
const expect = (name, message, error, category, retryable = false, opts) => check(name, () => {
	const actual = classify(message, error, opts);
	assert.equal(actual.category, category);
	assert.equal(actual.retryable, retryable);
});
const restriction = 'thinkingmachines/inkling-small:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps';
expect('raw observed SDK 403 is a model access restriction', `Error: 403 ${restriction}`, { status: 403 }, 'ACCESS_RESTRICTED');
expect('SDK nested body preserves restriction with generic outer message', 'Forbidden', { status: 403, error: { message: restriction } }, 'ACCESS_RESTRICTED');
expect('nested provider error body is inspected', 'Forbidden', { status: 403, error: { error: { message: restriction } } }, 'ACCESS_RESTRICTED');
expect('SDK own message carries model restriction', 'Request failed', { status: 403, message: restriction }, 'ACCESS_RESTRICTED');
expect('plain 403 is permissions, not a bad key', 'Forbidden', { status: 403 }, 'PERMISSION_DENIED');
expect('403 with invalid key wording still reflects authorization status', 'Invalid API key', { status: 403 }, 'PERMISSION_DENIED');
expect('401 remains authentication', 'Invalid API key', { status: 401 }, 'AUTHENTICATION');
expect('explicit 401 outranks model restriction wording', restriction, { status: 401 }, 'AUTHENTICATION');
expect('serialized observed error retains access classification', `Error: 403 ${restriction}`, null, 'ACCESS_RESTRICTED');
expect('message-only generic HTTP 403 retains permissions', 'Error: 403 Forbidden', null, 'PERMISSION_DENIED');
expect('message-only HTTP 401 retains authentication', 'Error: 401 Incorrect API key provided', null, 'AUTHENTICATION');
expect('HTTP status form is recognized', 'HTTP 403: Forbidden', null, 'PERMISSION_DENIED');
expect('unknown numeric content is not an HTTP status', 'Request involved 401 tokens and 403 bytes', null, 'UNKNOWN');
expect('unrelated mention of agents does not imply a restriction', 'Agent requested a model and was denied', { status: 403 }, 'PERMISSION_DENIED');
expect('real 500 outranks access-like message', restriction, { status: 503 }, 'PROVIDER_UNAVAILABLE', true);
expect('cancellation stays authoritative', restriction, { status: 403 }, 'CANCELLED', false, { wasCancelled: true });
expect('429 stays retryable', 'Too many requests', { status: 429 }, 'RATE_LIMIT', true);
expect('400 context limit stays non-retryable', 'maximum context length', { status: 400 }, 'CONTEXT_LIMIT');
expect('404 stays missing model', 'not found', { status: 404 }, 'MODEL_NOT_FOUND');
expect('network cause remains recognized', 'Connection error', { cause: { code: 'ECONNRESET' } }, 'NETWORK', true);
expect('timeout remains retryable', 'deadline exceeded', null, 'TIMEOUT', true);
expect('unknown error is retained', 'Something unusual happened', null, 'UNKNOWN');
for (const category of ['AUTHENTICATION', 'PERMISSION_DENIED', 'ACCESS_RESTRICTED']) {
	check(`${category}: runtime-to-UI round trip retains category and raw details`, () => {
		const status = category === 'AUTHENTICATION' ? 401 : 403;
		const raw = `Error: ${status} ${category === 'ACCESS_RESTRICTED' ? restriction : 'Request denied'}`;
		const text = words(category, raw);
		assert.ok(text.endsWith(`Details: ${raw}`));
		assert.equal(classify(text, null).category, category);
		if (category !== 'AUTHENTICATION') assert.doesNotMatch(text, /rejected your API key|invalid key/i);
	});
	check(`${category}: pure error card offers appropriate recovery`, () => {
		const card = cardForError(category, category === 'AUTHENTICATION' ? 401 : 403, 'OpenRouter', 'restricted-model');
		assert.ok(card);
		if (category === 'AUTHENTICATION') { assert.match(card.title, /rejected your key/); assert.ok(card.actions.includes('settings')); }
		else {
			assert.doesNotMatch(`${card.title} ${card.text}`, /rejected your key|key.*revoked|pasted with a space/i);
			assert.ok(card.actions.includes('another'));
			assert.ok(!card.actions.includes('again'));
			assert.match(`${card.title} ${card.text}`, category === 'ACCESS_RESTRICTED' ? /access|restrict/i : /permission|access/i);
		}
	});
}
check('existing billing card is preserved', () => assert.match(cardForError('UNKNOWN', 402, 'OpenRouter', undefined).title, /credit/));
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
