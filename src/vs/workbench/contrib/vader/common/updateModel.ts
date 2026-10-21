/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Updating Vader (boards S11 and R29): a newer release on GitHub is offered, its installer is downloaded with the progress shown, and Vader restarts into it when the
// person says so (at once, or when the running tasks are done). Nothing is installed without a click, and a failed download leaves the running version as it is. Pure.

/** what GitHub lists for each file of a release */
export type ReleaseAsset = { readonly name: string; readonly size: number; readonly browser_download_url: string; readonly digest?: string };

export type UpdateOffer = {
	readonly version: string;
	readonly tag: string;
	/** the release page, where "what changed" is read */
	readonly releaseUrl: string;
	/** the installer to download; absent when this kind of computer has none (then the release page is the way) */
	readonly asset?: { readonly name: string; readonly size: number; readonly url: string; readonly sha256?: string };
	/** one line from the release notes, when it has one */
	readonly summary?: string;
};

export type UpdateState =
	| { readonly kind: 'idle' }
	| { readonly kind: 'available'; readonly offer: UpdateOffer }
	| { readonly kind: 'downloading'; readonly offer: UpdateOffer; readonly done: number; readonly total: number }
	| { readonly kind: 'ready'; readonly offer: UpdateOffer; readonly file: string }
	| { readonly kind: 'failed'; readonly offer: UpdateOffer; readonly done: number; readonly reason: string; readonly current: string };

/** where the installer may come from: GitHub, and the hosts its release files are served from */
export const UPDATE_HOSTS: readonly string[] = ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com'];

export const isAllowedUpdateUrl = (url: string, hosts: readonly string[] = UPDATE_HOSTS): boolean => {
	try {
		const u = new URL(url);
		return u.protocol === 'https:' && hosts.includes(u.hostname);
	} catch { return false; }
};

/** the installer of a release for this computer: `Vader-Setup-<arch>-<version>.exe` on Windows; no other kind is built */
export function pickInstaller(assets: readonly ReleaseAsset[], version: string, platform: string, arch: string): ReleaseAsset | undefined {
	if (platform !== 'win32') return undefined;
	const want = `Vader-Setup-${arch}-${version}.exe`.toLowerCase();
	return assets.find(a => a.name.toLowerCase() === want && a.size > 0 && isAllowedUpdateUrl(a.browser_download_url));
}

/** the checksum GitHub states for a file ("sha256:abc..."), lower-cased, or undefined */
export const sha256Of = (digest: string | undefined): string | undefined => {
	const m = /^sha256:([0-9a-f]{64})$/i.exec((digest ?? '').trim());
	return m ? m[1].toLowerCase() : undefined;
};

/** the first line of the release notes that says something, without Markdown marks and without the install instructions every release carries */
export function summaryOfNotes(body: string | undefined): string | undefined {
	for (const raw of (body ?? '').split(/\r?\n/)) {
		if (/^\s*#/.test(raw)) continue; // a heading names the release, it does not say what changed
		const line = raw.replace(/^[#>*\-\s]+/, '').replace(/[*_`]/g, '').trim();
		if (!line || /^install/i.test(line) || /^see /i.test(line)) continue;
		return line.length > 140 ? line.slice(0, 139).trimEnd() + '…' : line;
	}
	return undefined;
}

/** "74 MB", "119 MB", "480 KB" */
export function megabytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}

export const availableWords = (o: UpdateOffer) => ({
	title: `Vader ${o.version} is ready`,
	body: o.summary ?? 'A newer release is on GitHub.',
	download: o.asset ? 'Download' : 'Open the release page',
	changed: 'Read what changed',
	later: 'Later',
});

export const downloadingWords = (s: { offer: UpdateOffer; done: number; total: number }) => ({
	title: `Downloading Vader ${s.offer.version}`,
	progress: `${megabytes(s.done)} of ${megabytes(s.total)}`,
	fraction: s.total > 0 ? Math.min(1, s.done / s.total) : 0,
	cancel: 'Cancel',
});

export const readyWords = (runningTasks: number) => ({
	title: 'Restart to finish the update',
	body: runningTasks > 0
		? `${runningTasks} task${runningTasks === 1 ? ' is' : 's are'} running. Restart when ${runningTasks === 1 ? 'it is' : 'they are'} done, or now: ${runningTasks === 1 ? 'it stops' : 'they stop'} and can be continued after.`
		: 'Nothing is running. Vader closes, installs the new version and opens again.',
	whenDone: 'Restart when tasks finish',
	now: 'Restart now',
	waiting: 'Waiting for the tasks to finish. Vader restarts then.',
	cancelWaiting: 'Do not wait',
});

export const failedWords = (s: { offer: UpdateOffer; done: number; reason: string; current: string }) => ({
	title: 'Could not download the update',
	body: `${s.done > 0 ? `The download stopped at ${megabytes(s.done)}. ` : ''}${s.reason ? s.reason + ' ' : ''}You are still on ${s.current}, which works as before.`.replace(/\s+/g, ' ').trim(),
	retry: 'Try again',
	website: 'Download it from the website',
});

/** words for what went wrong in the download, from what the network layer reported */
export function downloadFailureReason(e: { code?: string; message?: string; status?: number }): string {
	if (e.status && e.status >= 400) return `GitHub answered ${e.status}.`;
	if (e.code === 'size') return 'The file that arrived is not the size GitHub lists for it, so it was thrown away.';
	if (e.code === 'checksum') return 'The file that arrived does not match its checksum, so it was thrown away.';
	if (e.code === 'host') return 'The download pointed somewhere other than GitHub, so Vader did not follow it.';
	if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'timeout') return 'The connection was lost.';
	if (e.code === 'ENOSPC') return 'The disk is full.';
	return (e.message ?? '').split('\n')[0].slice(0, 160);
}
