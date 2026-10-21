/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { isAllowedUpdateUrl, UPDATE_HOSTS } from '../common/updateModel.js';

// Downloads a release file to disk with progress. The host of every step (redirects included) must be GitHub's; the file is written beside its final name and moved only
// when its size (and checksum, when GitHub states one) is right, so a half file is never taken for an installer. Cancel stops it and removes what was written.

export class DownloadError extends Error {
	constructor(message: string, readonly code?: string, readonly status?: number, readonly bytes = 0) { super(message); }
}

export type DownloadOptions = {
	readonly url: string;
	readonly dest: string;
	readonly expectedSize?: number;
	readonly sha256?: string;
	readonly onProgress: (done: number, total: number) => void;
	readonly signal?: AbortSignal;
	/** for tests: hosts other than GitHub's, and plain http */
	readonly allowHosts?: readonly string[];
	readonly allowHttp?: boolean;
	readonly maxRedirects?: number;
};

export function downloadFile(o: DownloadOptions): Promise<{ bytes: number }> {
	const hosts = o.allowHosts ?? UPDATE_HOSTS;
	const part = o.dest + '.part';
	return new Promise((resolve, reject) => {
		let settled = false;
		let written = 0;
		let req: http.ClientRequest | undefined;
		let out: fs.WriteStream | undefined;
		const cleanup = () => { try { out?.destroy(); } catch { /* closed */ } try { fs.unlinkSync(part); } catch { /* not there */ } };
		const fail = (e: DownloadError) => { if (settled) return; settled = true; try { req?.destroy(); } catch { /* done */ } cleanup(); reject(e); };
		const onAbort = () => fail(new DownloadError('The download was cancelled.', 'cancelled', undefined, written));
		if (o.signal?.aborted) { onAbort(); return; }
		o.signal?.addEventListener('abort', onAbort, { once: true });

		const go = (url: string, redirects: number) => {
			const allowed = o.allowHttp ? (() => { try { const u = new URL(url); return hosts.includes(u.hostname) && (u.protocol === 'https:' || u.protocol === 'http:'); } catch { return false; } })() : isAllowedUpdateUrl(url, hosts);
			if (!allowed) { fail(new DownloadError('The download pointed somewhere other than GitHub.', 'host', undefined, written)); return; }
			const lib = url.startsWith('http:') ? http : https;
			req = lib.get(url, { headers: { 'User-Agent': 'Vader-updater', 'Accept': 'application/octet-stream' }, timeout: 20_000 }, res => {
				const status = res.statusCode ?? 0;
				if (status >= 300 && status < 400 && res.headers.location) {
					res.resume();
					if (redirects >= (o.maxRedirects ?? 5)) { fail(new DownloadError('Too many redirects.', 'redirect', undefined, written)); return; }
					go(new URL(res.headers.location, url).toString(), redirects + 1);
					return;
				}
				if (status !== 200) { res.resume(); fail(new DownloadError(`The server answered ${status}.`, 'status', status, written)); return; }
				const total = Number(res.headers['content-length'] ?? o.expectedSize ?? 0) || o.expectedSize || 0;
				const hash = o.sha256 ? crypto.createHash('sha256') : undefined;
				out = fs.createWriteStream(part);
				out.on('error', e => fail(new DownloadError(e.message, (e as NodeJS.ErrnoException).code, undefined, written)));
				res.on('data', (chunk: Buffer) => { written += chunk.length; hash?.update(chunk); o.onProgress(written, total); });
				res.on('error', e => fail(new DownloadError(e.message, (e as NodeJS.ErrnoException).code, undefined, written)));
				res.on('aborted', () => fail(new DownloadError('The connection was lost.', 'ECONNRESET', undefined, written)));
				res.pipe(out);
				out.on('finish', () => {
					if (settled) return;
					if (res.complete === false) { fail(new DownloadError('The connection was lost.', 'ECONNRESET', undefined, written)); return; }
					if (o.expectedSize !== undefined && written !== o.expectedSize) { fail(new DownloadError('The size is wrong.', 'size', undefined, written)); return; }
					if (hash && hash.digest('hex') !== o.sha256!.toLowerCase()) { fail(new DownloadError('The checksum is wrong.', 'checksum', undefined, written)); return; }
					try { fs.renameSync(part, o.dest); } catch (e) { fail(new DownloadError((e as Error).message, (e as NodeJS.ErrnoException).code, undefined, written)); return; }
					settled = true;
					o.signal?.removeEventListener('abort', onAbort);
					resolve({ bytes: written });
				});
			});
			req.on('timeout', () => fail(new DownloadError('The connection timed out.', 'timeout', undefined, written)));
			req.on('error', e => fail(new DownloadError(e.message, (e as NodeJS.ErrnoException).code, undefined, written)));
		};
		go(o.url, 0);
	});
}
