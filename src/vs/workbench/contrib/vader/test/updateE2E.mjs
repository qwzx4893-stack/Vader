#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Updating Vader: the words and rules (common/updateModel.ts) and the download itself, run for real against a local web server (electron-main/updateDownloader.ts).
// Run: node src/vs/workbench/contrib/vader/test/updateE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-upd-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/updateModel.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
await esbuild.build({ entryPoints: [path.join(here, '../electron-main/updateDownloader.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'd.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);
const D = await import(pathToFileURL(path.join(tmp, 'd.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };

// ---- the rules
const asset = (name, size = 1000, url = `https://github.com/qwzx4893-stack/Vader/releases/download/v1.4.0/${name}`) => ({ name, size, browser_download_url: url });
check('the installer of this computer is the one named for its architecture and the version', M.pickInstaller([asset('Vader-Setup-x64-1.4.0.exe'), asset('Vader-Setup-arm64-1.4.0.exe')], '1.4.0', 'win32', 'arm64')?.name === 'Vader-Setup-arm64-1.4.0.exe');
check('no installer is picked on a computer Vader builds none for, or when the file is not in the release, or is empty', M.pickInstaller([asset('Vader-Setup-x64-1.4.0.exe')], '1.4.0', 'linux', 'x64') === undefined && M.pickInstaller([asset('other.exe')], '1.4.0', 'win32', 'x64') === undefined && M.pickInstaller([asset('Vader-Setup-x64-1.4.0.exe', 0)], '1.4.0', 'win32', 'x64') === undefined);
check('a file that is not on GitHub is not an installer', M.pickInstaller([asset('Vader-Setup-x64-1.4.0.exe', 10, 'https://evil.example/Vader-Setup-x64-1.4.0.exe')], '1.4.0', 'win32', 'x64') === undefined && !M.isAllowedUpdateUrl('http://github.com/x') && M.isAllowedUpdateUrl('https://objects.githubusercontent.com/x'));
check('the checksum GitHub states is read, and anything else is not', M.sha256Of('sha256:' + 'AB'.repeat(32)) === 'ab'.repeat(32) && M.sha256Of('sha1:abc') === undefined && M.sha256Of(undefined) === undefined);
check('the release notes give one plain line, not the install instructions', M.summaryOfNotes('## Vader 1.4.0\n\n**Install:** download the file below\n\nAdds Add-ons, a cost line that says where its number comes from, and a new welcome. 18 fixes.') === 'Adds Add-ons, a cost line that says where its number comes from, and a new welcome. 18 fixes.', M.summaryOfNotes('## Vader 1.4.0\n\n**Install:** download the file below\n\nAdds Add-ons.'));
check('sizes are said in MB', M.megabytes(74 * 1024 * 1024) === '74 MB' && M.megabytes(119 * 1024 * 1024) === '119 MB' && M.megabytes(480 * 1024) === '480 KB');
const offer = { version: '1.4.0', tag: 'v1.4.0', releaseUrl: 'https://github.com/qwzx4893-stack/Vader/releases/tag/v1.4.0', summary: 'Adds Add-ons.', asset: { name: 'Vader-Setup-x64-1.4.0.exe', size: 119 * 1024 * 1024, url: 'https://github.com/x' } };
check('an update says what it is, with its three choices', M.availableWords(offer).title === 'Vader 1.4.0 is ready' && M.availableWords(offer).download === 'Download' && M.availableWords(offer).changed === 'Read what changed' && M.availableWords(offer).later === 'Later');
check('without an installer the choice is the release page', M.availableWords({ ...offer, asset: undefined }).download === 'Open the release page');
check('downloading says how much of how much', M.downloadingWords({ offer, done: 74 * 1024 * 1024, total: 119 * 1024 * 1024 }).progress === '74 MB of 119 MB' && Math.abs(M.downloadingWords({ offer, done: 74 * 1024 * 1024, total: 119 * 1024 * 1024 }).fraction - 74 / 119) < 1e-9);
check('the restart question says what happens to running tasks, in the singular and the plural', M.readyWords(2).body === '2 tasks are running. Restart when they are done, or now: they stop and can be continued after.' && M.readyWords(1).body.startsWith('1 task is running.') && M.readyWords(0).body.startsWith('Nothing is running.'));
check('a failure says where it stopped and that the old version works', M.failedWords({ offer, done: 74 * 1024 * 1024, reason: '', current: '1.3.2' }).body === 'The download stopped at 74 MB. You are still on 1.3.2, which works as before.' && M.failedWords({ offer, done: 0, reason: 'The connection was lost.', current: '1.3.2' }).body === 'The connection was lost. You are still on 1.3.2, which works as before.');
check('the reasons are in plain words', M.downloadFailureReason({ code: 'ECONNRESET' }) === 'The connection was lost.' && M.downloadFailureReason({ code: 'size' }).includes('not the size') && M.downloadFailureReason({ status: 404 }) === 'GitHub answered 404.' && M.downloadFailureReason({ code: 'ENOSPC' }) === 'The disk is full.');

// ---- the download, against a local server
const body = crypto.randomBytes(300_000);
const goodSum = crypto.createHash('sha256').update(body).digest('hex');
const server = http.createServer((req, res) => {
	if (req.url === '/file') { res.writeHead(200, { 'content-length': body.length }); const half = body.length / 2; res.write(body.subarray(0, half)); setTimeout(() => res.end(body.subarray(half)), 30); return; }
	if (req.url === '/redirect') { res.writeHead(302, { location: '/file' }); res.end(); return; }
	if (req.url === '/away') { res.writeHead(302, { location: 'http://evil.example/file' }); res.end(); return; }
	if (req.url === '/missing') { res.writeHead(404); res.end('no'); return; }
	if (req.url === '/cut') { res.writeHead(200, { 'content-length': body.length }); res.write(body.subarray(0, 100_000)); setTimeout(() => res.socket.destroy(), 30); return; }
	if (req.url === '/slow') { res.writeHead(200, { 'content-length': body.length }); res.write(body.subarray(0, 50_000)); return; }
	res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const opts = (p, extra = {}) => ({ url: base + p, dest: path.join(tmp, 'out-' + p.replace(/\W/g, '') + '.exe'), onProgress: () => { }, allowHosts: ['127.0.0.1'], allowHttp: true, ...extra });
const tryDl = async (o) => { try { return { ok: true, ...(await D.downloadFile(o)) }; } catch (e) { return { ok: false, code: e.code, status: e.status, bytes: e.bytes, message: e.message }; } };

{
	const seen = [];
	const r = await tryDl(opts('/file', { expectedSize: body.length, sha256: goodSum, onProgress: (d, t) => seen.push([d, t]) }));
	const dest = path.join(tmp, 'out-file.exe');
	check('a download arrives whole, with the right size and checksum', r.ok && r.bytes === body.length && Buffer.compare(fs.readFileSync(dest), body) === 0, JSON.stringify(r));
	check('the progress is reported as it goes, ending at the total', seen.length >= 2 && seen[seen.length - 1][0] === body.length && seen[seen.length - 1][1] === body.length && seen.every((s, i) => i === 0 || s[0] >= seen[i - 1][0]));
	check('no half file is left beside it', !fs.existsSync(dest + '.part'));
}
check('a redirect to the same host is followed', (await tryDl(opts('/redirect', { expectedSize: body.length }))).ok);
{
	const r = await tryDl(opts('/away'));
	check('a redirect to another host is not followed', !r.ok && r.code === 'host', JSON.stringify(r));
}
{
	const r = await tryDl(opts('/missing'));
	check('an answer other than 200 is a failure with its number', !r.ok && r.status === 404 && M.downloadFailureReason(r) === 'GitHub answered 404.', JSON.stringify(r));
}
{
	const r = await tryDl(opts('/cut'));
	check('a connection that drops half way is a failure that says how far it got, and leaves nothing behind', !r.ok && r.bytes > 0 && r.bytes < body.length && !fs.existsSync(path.join(tmp, 'out-cut.exe')) && !fs.existsSync(path.join(tmp, 'out-cut.exe.part')), JSON.stringify(r));
}
{
	const r = await tryDl(opts('/file', { expectedSize: body.length + 1 }));
	check('a file of the wrong size is thrown away', !r.ok && r.code === 'size' && !fs.existsSync(path.join(tmp, 'out-file.exe.part')), JSON.stringify(r));
}
{
	const r = await tryDl(opts('/file', { dest: path.join(tmp, 'sum.exe'), sha256: '0'.repeat(64) }));
	check('a file that does not match its checksum is thrown away', !r.ok && r.code === 'checksum' && !fs.existsSync(path.join(tmp, 'sum.exe')), JSON.stringify(r));
}
{
	const ac = new AbortController();
	const started = tryDl(opts('/slow', { signal: ac.signal, onProgress: () => ac.abort() }));
	const r = await started;
	check('cancelling stops the download and removes what was written', !r.ok && r.code === 'cancelled' && !fs.existsSync(path.join(tmp, 'out-slow.exe.part')), JSON.stringify(r));
}
{
	const r = await tryDl({ url: 'http://github.com/x', dest: path.join(tmp, 'h.exe'), onProgress: () => { } });
	check('plain http and other hosts are refused by default', !r.ok && r.code === 'host', JSON.stringify(r));
}

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
