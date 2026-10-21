#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Images in a message (common/imageRules.ts).
// Run: node src/vs/workbench/contrib/vader/test/imageRulesE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-image-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/imageRules.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'i.mjs'), logLevel: 'silent' });
const I = await import(pathToFileURL(path.join(tmp, 'i.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const MB = 1024 * 1024;

check('the type of an image comes from its type, or from its name', I.imageMimeOf({ name: 'a', type: 'image/png' }) === 'image/png' && I.imageMimeOf({ name: 'a.JPG' }) === 'image/jpeg' && I.imageMimeOf({ name: 'x', type: 'image/jpg' }) === 'image/jpeg' && I.imageMimeOf({ name: 'x.webp' }) === 'image/webp' && I.imageMimeOf({ name: 'x.gif', type: '' }) === 'image/gif');
check('an image of a kind that is not sent has no type', I.imageMimeOf({ name: 'x.svg', type: 'image/svg+xml' }) === undefined && I.imageMimeOf({ name: 'x.heic' }) === undefined && I.imageMimeOf({ name: 'notes.txt' }) === undefined);
check('what looks like an image at all is told apart from a file', I.looksLikeImage({ name: 'x.svg' }) && I.looksLikeImage({ name: 'a', type: 'image/bmp' }) && !I.looksLikeImage({ name: 'a.ts' }));

check('a small image keeps its size, a large one is made smaller with its shape kept', JSON.stringify(I.scaledSize(800, 600)) === '{"width":800,"height":600}' && JSON.stringify(I.scaledSize(3136, 1568)) === '{"width":1568,"height":784}' && JSON.stringify(I.scaledSize(1000, 4000)) === '{"width":392,"height":1568}');
check('no size at all is no size', JSON.stringify(I.scaledSize(0, 100)) === '{"width":0,"height":0}');
check('an image costs what providers publish, within bounds', I.imageTokens(1000, 750) === 1000 && I.imageTokens(1568, 1568) === 1600 && I.imageTokens(10, 10) === 85 && I.imageChars(1000, 750) === 4000);

{
	const f = (name, size, type) => ({ name, size, type });
	const v = I.checkImages([f('a.png', 1000, 'image/png'), f('b.txt', 10), f('c.svg', 10, 'image/svg+xml'), f('d.png', 20 * MB, 'image/png'), f('e.png', 0, 'image/png')], 0);
	check('images are taken, and what is not is refused with the reason', v.accepted.join() === '0' && v.refused.map(r => `${r.name}: ${r.why}`).join(' | ') === 'b.txt: it is not an image | c.svg: only PNG, JPEG, WebP and GIF images can be sent | d.png: it is larger than 15 MB | e.png: it is empty', v.refused.map(r => r.why).join(' | '));
	const many = I.checkImages(Array.from({ length: 6 }, (_, i) => f(`i${i}.png`, 10, 'image/png')), 1);
	check('no more than four for one message, counting those already there', many.accepted.length === 3 && many.refused.length === 3 && /4 images is the most/.test(many.refused[0].why));
}

check('a model that cannot read images says so by its name', I.cannotReadImagesWords('qwen3-coder') === 'qwen3-coder cannot read images.');

const img = { id: '1', name: 'error.png', mimeType: 'image/png', base64: 'QUJD', bytes: 3, width: 10, height: 10 };
{
	const a = I.userPartsWithImages('anthropic', 'why?', [img]);
	check('Anthropic gets a base64 source, the image before the text', a[0].type === 'image' && a[0].source.type === 'base64' && a[0].source.media_type === 'image/png' && a[0].source.data === 'QUJD' && a[1].type === 'text' && a[1].text === 'why?');
	const o = I.userPartsWithImages('openai', 'why?', [img]);
	check('OpenAI-compatible providers get an image_url with a data address', o[0].type === 'image_url' && o[0].image_url.url === 'data:image/png;base64,QUJD' && o[1].text === 'why?');
	const g = I.userPartsWithImages('gemini', 'why?', [img]);
	check('Gemini gets inline data', g[0].inlineData.mimeType === 'image/png' && g[0].inlineData.data === 'QUJD' && g[1].text === 'why?');
}
check('each provider is given images the way it takes them', I.imageStyleOfProvider('anthropic') === 'anthropic' && I.imageStyleOfProvider('gemini') === 'gemini' && I.imageStyleOfProvider('openRouter') === 'openai' && I.imageStyleOfProvider('ollama') === 'openai');
check('an export or a summary names the image and never holds it', I.imagePlaceholder(img) === '[image: error.png]' && I.dataUrlOf(img) === 'data:image/png;base64,QUJD');

{
	check('a model that cannot read images is sent none; one that can is sent the latest few', I.sentWithImages([1, 4, 6, 9, 12], false, 3).size === 0 && [...I.sentWithImages([1, 4, 6, 9, 12], true, 3)].join() === '6,9,12');
	const msgs = [
		{ role: 'user', content: 'old', images: [img] },
		{ role: 'assistant', content: 'ok' },
		{ role: 'user', content: [{ type: 'text', text: 'why?' }, { type: 'tool_result', tool_use_id: 'x', content: 'r' }], images: [img] },
		{ role: 'user', content: 'plain' },
	];
	I.giveImagesToMessages(msgs, 'anthropic');
	check('a message with images becomes parts, the text kept, and the field is removed from every message', msgs.every(m => !('images' in m)) && Array.isArray(msgs[0].content) && msgs[0].content[0].type === 'image' && msgs[0].content[1].text === 'old' && msgs[1].content === 'ok' && msgs[3].content === 'plain');
	check('the text of a message that already had parts is kept, joined', msgs[2].content[1].text === 'why?');
	const o = [{ role: 'user', content: 'hi', images: [img] }];
	I.giveImagesToMessages(o, 'openai');
	check('the same for an OpenAI-compatible provider', o[0].content[0].type === 'image_url' && o[0].content[1].text === 'hi');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
