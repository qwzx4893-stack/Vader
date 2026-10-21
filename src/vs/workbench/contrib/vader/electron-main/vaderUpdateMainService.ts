/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILifecycleMainService } from '../../../../platform/lifecycle/electron-main/lifecycleMainService.js';
import { downloadFile, DownloadError } from './updateDownloader.js';
import { downloadFailureReason, pickInstaller, ReleaseAsset, sha256Of, summaryOfNotes, UpdateOffer, UpdateState } from '../common/updateModel.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { asJson, IRequestService, isSuccess } from '../../../../platform/request/common/request.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { IVaderUpdateService } from '../common/vaderUpdateService.js';
import { VaderCheckUpdateRespose } from '../common/vaderUpdateServiceTypes.js';



const RELEASES_API_URL = 'https://api.github.com/repos/qwzx4893-stack/Vader/releases/latest'
const RELEASES_TIMEOUT_MS = 10_000

/** '1.2.3' / 'v1.2.3' / '1.2.3-beta' -> [1, 2, 3]; null when it does not look like a version */
export const parseVersion = (v: string): number[] | null => {
	const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** true when `candidate` is a strictly newer version than `current` */
export const isNewerVersion = (candidate: string, current: string): boolean => {
	const a = parseVersion(candidate), b = parseVersion(current)
	if (!a || !b) return false
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) return a[i] > b[i]
	}
	return false
}

export class VaderMainUpdateService extends Disposable implements IVaderUpdateService {
	_serviceBrand: undefined;

	private readonly _onDidChangeUpdateState = this._register(new Emitter<UpdateState>());
	readonly onDidChangeUpdateState: Event<UpdateState> = this._onDidChangeUpdateState.event;
	private _state: UpdateState = { kind: 'idle' };
	private _abort: AbortController | undefined;

	private _setState(s: UpdateState): void { this._state = s; this._onDidChangeUpdateState.fire(s); }
	async getUpdateState(): Promise<UpdateState> { return this._state; }

	async dismissUpdate(): Promise<void> {
		if (this._state.kind === 'downloading') return;
		this._setState({ kind: 'idle' });
	}

	async cancelUpdateDownload(): Promise<void> { this._abort?.abort(); }

	async downloadUpdate(): Promise<void> {
		const s = this._state;
		if (s.kind !== 'available' && s.kind !== 'failed') return;
		const offer = s.offer;
		if (!offer.asset) return;
		const current = this._productService.vaderVersion ?? 'this version';
		const dir = path.join(os.tmpdir(), 'vader-update');
		const dest = path.join(dir, offer.asset.name);
		this._abort = new AbortController();
		let last = 0;
		this._setState({ kind: 'downloading', offer, done: 0, total: offer.asset.size });
		try {
			fs.mkdirSync(dir, { recursive: true });
			await downloadFile({
				url: offer.asset.url, dest, expectedSize: offer.asset.size, sha256: offer.asset.sha256, signal: this._abort.signal,
				onProgress: (done, total) => { const now = Date.now(); if (now - last > 150) { last = now; this._setState({ kind: 'downloading', offer, done, total: total || offer.asset!.size }); } },
			});
			this._setState({ kind: 'ready', offer, file: dest });
		} catch (e) {
			const err = e as DownloadError;
			if (err.code === 'cancelled') { this._setState({ kind: 'available', offer }); return; }
			this._setState({ kind: 'failed', offer, done: err.bytes ?? 0, reason: downloadFailureReason({ code: err.code, message: err.message, status: err.status }), current });
		} finally {
			this._abort = undefined;
		}
	}

	async installUpdate(): Promise<{ ok: true } | { ok: false; reason: string }> {
		const s = this._state;
		if (s.kind !== 'ready') return { ok: false, reason: 'There is no downloaded update to install.' };
		try {
			const st = fs.statSync(s.file);
			if (!st.isFile() || (s.offer.asset && st.size !== s.offer.asset.size)) return { ok: false, reason: 'The downloaded file is no longer whole. Download it again.' };
		} catch { return { ok: false, reason: 'The downloaded file is gone. Download it again.' }; }
		try {
			// the installer closes Vader if it is still open and opens it again when it is done; it runs on its own, so Vader can quit
			const child = spawn(s.file, ['/SILENT', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'], { detached: true, stdio: 'ignore' });
			child.on('error', () => { /* reported below by the missing quit; a failed start leaves Vader running */ });
			child.unref();
		} catch (e) {
			return { ok: false, reason: `The installer could not be started: ${e instanceof Error ? e.message : String(e)}` };
		}
		setTimeout(() => { void this._lifecycleMainService.quit(); }, 400);
		return { ok: true };
	}

	constructor(
		@ILifecycleMainService private readonly _lifecycleMainService: ILifecycleMainService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
		@IUpdateService private readonly _updateService: IUpdateService,
		@IProductService private readonly _productService: IProductService,
		@IRequestService private readonly _requestService: IRequestService,
	) {
		super()
	}


	async check(explicit: boolean): Promise<VaderCheckUpdateRespose> {

		const isDevMode = !this._envMainService.isBuilt // found in abstractUpdateService.ts

		if (isDevMode) {
			return { message: null } as const
		}

		// if disabled and not explicitly checking, return early
		if (this._updateService.state.type === StateType.Disabled) {
			if (!explicit)
				return { message: null } as const
		}

		this._updateService.checkForUpdates(false) // implicity check, then handle result ourselves

		console.log('updateState', this._updateService.state)

		if (this._updateService.state.type === StateType.Uninitialized) {
			// The update service hasn't been initialized yet
			return { message: explicit ? 'Checking for updates soon...' : null, action: explicit ? 'reinstall' : undefined } as const
		}

		if (this._updateService.state.type === StateType.Idle) {
			// No updates currently available
			return { message: explicit ? 'No updates found!' : null, action: explicit ? 'reinstall' : undefined } as const
		}

		if (this._updateService.state.type === StateType.CheckingForUpdates) {
			// Currently checking for updates
			return { message: explicit ? 'Checking for updates...' : null } as const
		}

		if (this._updateService.state.type === StateType.AvailableForDownload) {
			// Update available but requires manual download (mainly for Linux)
			return { message: 'A new update is available!', action: 'download', } as const
		}

		if (this._updateService.state.type === StateType.Downloading) {
			// Update is currently being downloaded
			return { message: explicit ? 'Currently downloading update...' : null } as const
		}

		if (this._updateService.state.type === StateType.Downloaded) {
			// Update has been downloaded but not yet ready
			return { message: explicit ? 'An update is ready to be applied!' : null, action: 'apply' } as const
		}

		if (this._updateService.state.type === StateType.Updating) {
			// Update is being applied
			return { message: explicit ? 'Applying update...' : null } as const
		}

		if (this._updateService.state.type === StateType.Ready) {
			// Update is ready
			return { message: 'Restart Vader to update!', action: 'restart' } as const
		}

		if (this._updateService.state.type === StateType.Disabled) {
			// Vader ships no `updateUrl` (no update server of its own), so the editor's built-in updater is off. Instead the
			// newest GitHub release of this project is compared with the running version; installing it is left to the user.
			return this._checkGitHubReleases(explicit)
		}
		return null
	}

	private async _checkGitHubReleases(explicit: boolean): Promise<VaderCheckUpdateRespose> {
		const current = this._productService.vaderVersion
		if (!current) return { message: explicit ? 'This build has no version number, so it cannot be compared with the latest release.' : null } as const

		// the editor's own request service: it follows the system / corporate proxy settings, which a bare fetch() in the main process does not
		const cts = new CancellationTokenSource()
		const timeoutId = setTimeout(() => cts.cancel(), RELEASES_TIMEOUT_MS)
		try {
			const context = await this._requestService.request({ type: 'GET', url: RELEASES_API_URL, headers: { 'Accept': 'application/vnd.github+json' }, callSite: 'vaderUpdate.checkReleases' }, cts.token)
			if (!isSuccess(context)) throw new Error(`GitHub answered ${context.res.statusCode}`)
			const release = await asJson<{ tag_name?: string, html_url?: string, draft?: boolean, prerelease?: boolean, body?: string, assets?: ReleaseAsset[] }>(context)
			const tag = release?.tag_name
			if (!release || !tag || release.draft || release.prerelease) {
				return { message: explicit ? `Vader ${current} is up to date.` : null } as const
			}
			if (isNewerVersion(tag, current)) {
				const url = typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/qwzx4893-stack/Vader/')
					? release.html_url : 'https://github.com/qwzx4893-stack/Vader/releases/latest'
				const version = tag.replace(/^v/, '')
				const picked = pickInstaller(release.assets ?? [], version, process.platform, process.arch)
				const offer: UpdateOffer = { version, tag, releaseUrl: url, summary: summaryOfNotes(release.body), ...(picked ? { asset: { name: picked.name, size: picked.size, url: picked.browser_download_url, sha256: sha256Of(picked.digest) } } : {}) }
				// what is being downloaded or waits to be installed is not replaced by a second look at the same release
				if (this._state.kind === 'idle' || this._state.kind === 'available' || this._state.kind === 'failed') this._setState({ kind: 'available', offer })
				return { message: `Vader ${version} is available (you have ${current}).`, action: 'release', url } as const
			}
			return { message: explicit ? `Vader ${current} is up to date.` : null } as const
		}
		catch (e) {
			console.log('Vader update check failed:', e)
			// a silent background check never nags about a missing connection; a manual one says what happened
			return { message: explicit ? 'Could not reach GitHub to look for a newer version. Check your connection and try again.' : null } as const
		}
		finally {
			clearTimeout(timeoutId)
			cts.dispose()
		}
	}
}
