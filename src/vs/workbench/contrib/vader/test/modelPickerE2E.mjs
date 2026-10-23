#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// The arrangement of the model picker in the chat box (common/modelPickerGroups.ts), bundled from source, and the checks on how the picker is wired
// (ProviderModelPicker.tsx, ModelDropdown.tsx) that the compiler cannot make. The look itself was judged on a rendered preview, not here.
// Run: node src/vs/workbench/contrib/vader/test/modelPickerE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-picker-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/modelPickerGroups.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'g.mjs'), logLevel: 'silent' });
const G = await import(pathToFileURL(path.join(tmp, 'g.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const title = { openRouter: 'OpenRouter', anthropic: 'Anthropic', openAI: 'OpenAI', ollama: 'Ollama' };
const mk = (providerName, models) => models.map(modelName => ({ selection: { providerName, modelName }, providerName, providerTitle: title[providerName], modelName }));
const one = mk('openRouter', ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'meta-llama/llama-3.3-70b-instruct:free']);
const many = [...mk('anthropic', ['claude-sonnet-4-5', 'claude-opus-4-1']), ...mk('openAI', ['gpt-5', 'gpt-5-mini']), ...one, ...mk('ollama', ['qwen2.5-coder:7b'])];

// ---- grouping
const groups = G.groupByProvider(many);
check('providers appear in the order they first appear', groups.map(g => g.providerName).join() === 'anthropic,openAI,openRouter,ollama');
check('each provider keeps its models in the given order', groups[0].models.map(m => m.modelName).join() === 'claude-sonnet-4-5,claude-opus-4-1');
check('a model is in exactly one group', groups.reduce((n, g) => n + g.models.length, 0) === many.length);
check('providers interleaved in the input are still one group each', G.groupByProvider([...mk('openAI', ['a']), ...mk('ollama', ['b']), ...mk('openAI', ['c'])]).map(g => g.models.length).join() === '2,1');
check('no models, no groups', G.groupByProvider([]).length === 0);

// ---- layout
check('one provider: a flat list of its live models', (() => { const l = G.pickerLayout(one, ''); return l.layout === 'flat' && l.singleProvider && l.groups.length === 1 && l.groups[0].models.length === 3; })());
check('several providers: the providers first', (() => { const l = G.pickerLayout(many, ''); return l.layout === 'providers' && !l.singleProvider && l.groups.length === 4; })());
check('typing something turns the providers into a flat, grouped list of matches', (() => { const l = G.pickerLayout(many, 'gpt'); return l.layout === 'flat' && l.searching && l.groups.map(g => g.providerName).join() === 'openAI,openRouter'; })());
check('...a search that matches in one provider only', (() => { const l = G.pickerLayout(many, 'qwen'); return l.groups.length === 1 && l.groups[0].providerName === 'ollama'; })());
check('...nothing matches: no groups', G.pickerLayout(many, 'zzzz').groups.length === 0);
check('spaces only are not a search', G.pickerLayout(many, '   ').layout === 'providers');
check('a single provider that is searched stays flat', G.pickerLayout(one, 'gpt').layout === 'flat');

// ---- search
const names = (q) => G.filterOptions(many, q).map(o => o.providerName + ':' + o.modelName).join(' | ');
check('every word has to match, in any order', G.filterOptions(many, 'sonnet claude').length === 2 && G.filterOptions(many, 'claude sonnet').length === 2);
check('the provider name counts ("openrouter gpt")', names('openrouter gpt') === 'openRouter:openai/gpt-5', names('openrouter gpt'));
check('case and separators are ignored', G.filterOptions(many, 'GPT5').length === 3 /* gpt-5, gpt-5-mini, openai/gpt-5 */ && G.filterOptions(many, 'llama 3.3').length === 1 && G.filterOptions(many, 'qwen2.5coder').length === 1);
check('a provider name lists all its models', G.filterOptions(many, 'ollama').length === 1 && G.filterOptions(many, 'anthropic').length === 3 /* two native + one OpenRouter id */);
check('an empty query gives everything', G.filterOptions(many, '').length === many.length);
check('the input is not modified', (() => { const copy = JSON.stringify(many); G.filterOptions(many, 'gpt'); G.pickerLayout(many, 'gpt'); return JSON.stringify(many) === copy; })());
check('a search box appears only for long lists', !G.showSearchBox(8) && G.showSearchBox(9) && !G.showSearchBox(3));
// a big live list (OpenRouter has hundreds) is still instant
{
	const big = mk('openRouter', Array.from({ length: 800 }, (_, i) => `vendor${i % 40}/model-${i}-instruct`));
	const t0 = Date.now(); for (let i = 0; i < 20; i++) G.pickerLayout(big, 'vendor7 model'); const ms = (Date.now() - t0) / 20;
	check('800 models: a search takes well under a frame (16 ms)', ms < 16, `${ms} ms`);
}

// ---- the words of the states (board S04)
check('names are listed the way a person says them', G.listNames(['OpenAI']) === 'OpenAI' && G.listNames(['OpenAI', 'Gemini']) === 'OpenAI and Gemini' && G.listNames(['A', 'B', 'C']) === 'A, B and C' && G.listNames([]) === '');
{
	const w = G.noMatchWords('sonnet 9', 4, ['OpenAI', 'Gemini']);
	check('nothing found says what was searched and which providers could not be', w.headline === 'No model named “sonnet 9”.' && w.detail === 'Searched 4 providers with a key. OpenAI and Gemini have no key yet.');
	check('one provider and none missing read right', G.noMatchWords(' x ', 1, []).detail === 'Searched 1 provider with a key.' && G.noMatchWords('x', 2, ['Groq']).detail === 'Searched 2 providers with a key. Groq has no key yet.');
}
check('the line under the providers with no key counts them', G.addableLine(48) === '48 providers can be added. Models appear as soon as a key works.' && G.addableLine(1).startsWith('1 provider can be added'));
check('"fetched" is said as a person would', G.agoWords(1000) === 'just now' && G.agoWords(5 * 60_000) === '5 min ago' && G.agoWords(3 * 3_600_000) === '3 h ago' && G.agoWords(3 * 86_400_000) === '3 days ago');
check('a list is asked for again after ten minutes, never before', !G.listIsStale(1000, 1000 + 9 * 60_000) && G.listIsStale(1000, 1000 + 10 * 60_000) && G.listIsStale(undefined, 5));
check('Anthropic ids read as names, other ids are left as written', G.friendlyModelName('anthropic', 'claude-sonnet-4-5').text === 'Claude Sonnet 4.5' && G.friendlyModelName('anthropic', 'claude-3-5-haiku-20241022').text === 'Claude Haiku 3.5' && G.friendlyModelName('anthropic', 'claude-opus-4-1').text === 'Claude Opus 4.1' && G.friendlyModelName('openRouter', 'deepseek/deepseek-v3.2').mono === true && G.friendlyModelName('anthropic', 'something-else').text === 'something-else');

// ---- how the picker is wired (static checks)
check('a long routed model has a compact caption without changing its id', G.compactModelName('openRouter', 'nvidia/nemotron-3-super-120b-a12b:free') === 'NVIDIA Nemotron 3 Super');
check('compact names preserve family versions and do not alter full catalogue names', G.compactModelName('anthropic', 'claude-sonnet-4-5') === 'Claude Sonnet 4.5' && G.friendlyModelName('openRouter', 'nvidia/nemotron-3-super-120b-a12b:free').text === 'nvidia/nemotron-3-super-120b-a12b:free');
const read = (rel) => fs.readFileSync(path.join(here, rel), 'utf8');
const picker = read('../browser/react/src/vader-settings-tsx/ProviderModelPicker.tsx'), dropdown = read('../browser/react/src/vader-settings-tsx/ModelDropdown.tsx');
check('the dropdown for every feature uses the new picker', /<ProviderModelPicker/.test(dropdown) && !/<VaderCustomDropdownBox/.test(dropdown));
check('the picker shows the real provider logo on the button and on each provider', (picker.match(/<ProviderLogo/g) ?? []).length >= 3);
check('the picker has no innerHTML (the workbench enforces Trusted Types)', !/dangerouslySetInnerHTML|innerHTML/.test(picker));
check('it can be used from the keyboard: arrows, Escape, rows are buttons', /ArrowDown/.test(picker) && /Escape/.test(picker) && /<button/.test(picker) && /role='listbox'/.test(picker));
check('a saved choice that is no longer offered moves to the first model offered', /onChangeOption\(options\[0\]\)/.test(dropdown));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
