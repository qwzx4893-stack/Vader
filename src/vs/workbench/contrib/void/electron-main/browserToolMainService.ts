/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWindows, isMacintosh } from '../../../../base/common/platform.js';
import { BrowserSnapshot, ConsoleLogEntry, IBrowserToolMainService, NetworkEntry, PageErrorEntry, PageSummary } from '../common/browser/browserToolServiceTypes.js';

// playwright-core drives an existing browser rather than bundling one, so it needs either a
// Playwright-managed browser (from `npx playwright install chromium`, respecting
// PLAYWRIGHT_BROWSERS_PATH the same way this repo's own dev tooling does) or a system
// Chrome/Edge install to point `executablePath` at. See findFallbackExecutablePath below.
//
// The ref-based click/type below uses Playwright's `aria-ref=` locator engine against a
// `page.ariaSnapshot({ mode: 'ai' })` snapshot - the same mechanism Playwright's own MCP
// server (microsoft/playwright-mcp) uses, verified directly against a real headless
// Chromium during development rather than assumed from docs.
type PlaywrightModule = typeof import('playwright-core');
type Page = import('playwright-core').Page;

const MAX_CONSOLE_LOGS = 200;
const MAX_PAGE_ERRORS = 100;
const MAX_NETWORK_ENTRIES = 100;

function findFallbackExecutablePath(): string | undefined {
	const candidates = isWindows ? [
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	] : isMacintosh ? [
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
	] : [
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/microsoft-edge',
	];
	return candidates.find(p => existsSync(p));
}

type PageEntry = {
	page: Page;
	consoleLogs: ConsoleLogEntry[];
	pageErrors: PageErrorEntry[];
	networkLog: NetworkEntry[];
	closed: boolean;
};

export class BrowserToolMainService extends Disposable implements IBrowserToolMainService {
	_serviceBrand: undefined;

	private _browser: import('playwright-core').Browser | undefined;
	private _playwright: PlaywrightModule | undefined;
	private readonly _pages = new Map<string, PageEntry>();
	private _activePageId: string | undefined;

	private async _getBrowser(): Promise<import('playwright-core').Browser> {
		if (this._browser && this._browser.isConnected()) return this._browser;

		if (!this._playwright) {
			// dynamic import: playwright-core is a real runtime dependency, but importing it
			// lazily keeps it off the startup path for users who never touch the browser tool.
			this._playwright = await import('playwright-core');
		}

		let launchError: unknown;
		try {
			this._browser = await this._playwright.chromium.launch({ headless: true });
		} catch (e) {
			launchError = e;
			const executablePath = findFallbackExecutablePath();
			if (!executablePath) {
				throw new Error(`Could not launch a browser. Run "npx playwright install chromium" once, or install Google Chrome/Microsoft Edge. (${launchError instanceof Error ? launchError.message : String(launchError)})`);
			}
			this._browser = await this._playwright.chromium.launch({ headless: true, executablePath });
		}

		// the whole browser process dying (crash, killed) should not leave stale page
		// entries pointing at a dead browser - every page is considered closed too
		this._browser.on('disconnected', () => {
			for (const entry of this._pages.values()) entry.closed = true;
			this._activePageId = undefined;
		});

		return this._browser;
	}

	private async _createPageEntry(): Promise<string> {
		const browser = await this._getBrowser();
		const page = await browser.newPage();
		const pageId = randomUUID();
		const entry: PageEntry = { page, consoleLogs: [], pageErrors: [], networkLog: [], closed: false };

		page.on('console', msg => {
			entry.consoleLogs.push({ type: msg.type(), text: msg.text() });
			if (entry.consoleLogs.length > MAX_CONSOLE_LOGS) entry.consoleLogs.shift();
		});
		page.on('pageerror', err => {
			entry.pageErrors.push({ message: err instanceof Error ? err.message : String(err) });
			if (entry.pageErrors.length > MAX_PAGE_ERRORS) entry.pageErrors.shift();
		});
		page.on('requestfailed', req => {
			entry.networkLog.push({ url: req.url(), method: req.method(), status: null, failureText: req.failure()?.errorText ?? 'request failed' });
			if (entry.networkLog.length > MAX_NETWORK_ENTRIES) entry.networkLog.shift();
		});
		page.on('response', res => {
			if (res.status() < 400) return; // "relevant" network activity only - not a full HAR dump
			entry.networkLog.push({ url: res.url(), method: res.request().method(), status: res.status(), failureText: null });
			if (entry.networkLog.length > MAX_NETWORK_ENTRIES) entry.networkLog.shift();
		});
		// renderer crash - a distinct failure mode from a deliberate close(), and one that
		// leaves the Page object unusable for anything further
		page.on('crash', () => { entry.closed = true; });
		page.on('close', () => {
			entry.closed = true;
			if (this._activePageId === pageId) {
				const stillOpen = [...this._pages.entries()].find(([id, e]) => id !== pageId && !e.closed);
				this._activePageId = stillOpen?.[0];
			}
		});

		this._pages.set(pageId, entry);
		this._activePageId = pageId;
		return pageId;
	}

	/** resolves a possibly-omitted pageId to a live PageEntry, auto-creating a first page if none exists yet - this is what keeps every existing single-page tool call (which never passes pageId) working unchanged */
	private async _resolvePage(pageId: string | undefined): Promise<{ id: string; entry: PageEntry }> {
		if (pageId) {
			const entry = this._pages.get(pageId);
			if (!entry) throw new Error(`Browser page "${pageId}" does not exist (it may have already been closed). Call browser_list_pages to see currently open pages.`);
			if (entry.closed || entry.page.isClosed()) throw new Error(`Browser page "${pageId}" is closed (it may have crashed or been closed by the site itself) - open a new one with browser_new_page.`);
			return { id: pageId, entry };
		}
		if (this._activePageId) {
			const entry = this._pages.get(this._activePageId);
			if (entry && !entry.closed && !entry.page.isClosed()) return { id: this._activePageId, entry };
		}
		const id = await this._createPageEntry();
		return { id, entry: this._pages.get(id)! };
	}

	private async _computeSnapshot(pageId: string, page: Page): Promise<BrowserSnapshot> {
		const snapshotText = await page.ariaSnapshot({ mode: 'ai' }).catch(() => '(could not compute an accessibility snapshot of this page)');
		return { pageId, url: page.url(), title: await page.title(), snapshotText };
	}

	/** wraps a ref-targeting action (click/type) with a clear, actionable error when the ref is stale - an aria-ref is scoped to the snapshot generation it came from, so it silently stops resolving to anything after a navigation/reload rather than throwing something self-explanatory on its own */
	private async _withStaleRefHandling<T>(fn: () => Promise<T>): Promise<T> {
		try {
			return await fn();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (/waiting for locator|no element matches|not found|timeout/i.test(message)) {
				throw new Error(`This element reference is no longer valid - the page likely navigated, reloaded, or changed since your last snapshot. Call browser_snapshot again to get fresh references, then retry. (original error: ${message})`);
			}
			throw e;
		}
	}

	async newPage(): Promise<BrowserSnapshot> {
		const id = await this._createPageEntry();
		return this._computeSnapshot(id, this._pages.get(id)!.page);
	}

	async listPages(): Promise<PageSummary[]> {
		const out: PageSummary[] = [];
		for (const [id, entry] of this._pages) {
			out.push({
				pageId: id,
				url: entry.closed ? '' : entry.page.url(),
				title: entry.closed ? '' : await entry.page.title().catch(() => ''),
				isActive: id === this._activePageId,
				isClosed: entry.closed || entry.page.isClosed(),
			});
		}
		return out;
	}

	async switchToPage(pageId: string): Promise<BrowserSnapshot> {
		const { id, entry } = await this._resolvePage(pageId);
		this._activePageId = id;
		return this._computeSnapshot(id, entry.page);
	}

	async closePage(pageId: string): Promise<void> {
		const entry = this._pages.get(pageId);
		if (!entry) return;
		await entry.page.close().catch(() => { });
		entry.closed = true;
		this._pages.delete(pageId);
		if (this._activePageId === pageId) {
			const stillOpen = [...this._pages.entries()].find(([, e]) => !e.closed);
			this._activePageId = stillOpen?.[0];
		}
	}

	async navigate(url: string, pageId?: string): Promise<BrowserSnapshot> {
		const { id, entry } = await this._resolvePage(pageId);
		await entry.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		return this._computeSnapshot(id, entry.page);
	}

	async reload(pageId?: string): Promise<BrowserSnapshot> {
		const { id, entry } = await this._resolvePage(pageId);
		await entry.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
		return this._computeSnapshot(id, entry.page);
	}

	async snapshot(pageId?: string): Promise<BrowserSnapshot> {
		const { id, entry } = await this._resolvePage(pageId);
		return this._computeSnapshot(id, entry.page);
	}

	async click(ref: string, pageId?: string): Promise<BrowserSnapshot> {
		const { id, entry } = await this._resolvePage(pageId);
		await this._withStaleRefHandling(() => entry.page.locator(`aria-ref=${ref}`).click({ timeout: 10_000 }));
		return this._computeSnapshot(id, entry.page);
	}

	async type(ref: string, text: string, submit: boolean, pageId?: string): Promise<BrowserSnapshot> {
		const { id, entry } = await this._resolvePage(pageId);
		await this._withStaleRefHandling(async () => {
			const locator = entry.page.locator(`aria-ref=${ref}`);
			await locator.fill(text, { timeout: 10_000 });
			if (submit) await locator.press('Enter');
		});
		return this._computeSnapshot(id, entry.page);
	}

	async screenshot(pageId?: string): Promise<string> {
		const { entry } = await this._resolvePage(pageId);
		const buf = await entry.page.screenshot({ type: 'png' });
		return buf.toString('base64');
	}

	async consoleLogs(pageId?: string): Promise<ConsoleLogEntry[]> {
		const { entry } = await this._resolvePage(pageId);
		return entry.consoleLogs;
	}

	async pageErrors(pageId?: string): Promise<PageErrorEntry[]> {
		const { entry } = await this._resolvePage(pageId);
		return entry.pageErrors;
	}

	async networkLog(pageId?: string): Promise<NetworkEntry[]> {
		const { entry } = await this._resolvePage(pageId);
		return entry.networkLog;
	}

	async closeAll(): Promise<void> {
		for (const entry of this._pages.values()) {
			await entry.page.close().catch(() => { });
		}
		this._pages.clear();
		this._activePageId = undefined;
		await this._browser?.close().catch(() => { });
		this._browser = undefined;
	}

	override dispose(): void {
		super.dispose();
		void this.closeAll();
	}
}
