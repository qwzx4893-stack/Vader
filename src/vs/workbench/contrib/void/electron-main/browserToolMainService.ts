/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { existsSync } from 'fs';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWindows, isMacintosh } from '../../../../base/common/platform.js';
import { BrowserSnapshot, ConsoleLogEntry, IBrowserToolMainService } from '../common/browser/browserToolServiceTypes.js';

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

const MAX_CONSOLE_LOGS = 200;

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

export class BrowserToolMainService extends Disposable implements IBrowserToolMainService {
	_serviceBrand: undefined;

	private _browser: import('playwright-core').Browser | undefined;
	private _page: import('playwright-core').Page | undefined;
	private _consoleLogs: ConsoleLogEntry[] = [];
	private _playwright: PlaywrightModule | undefined;

	private async _getPage() {
		if (this._page && !this._page.isClosed()) return this._page;

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

		const page = await this._browser.newPage();
		this._consoleLogs = [];
		page.on('console', msg => {
			this._consoleLogs.push({ type: msg.type(), text: msg.text() });
			if (this._consoleLogs.length > MAX_CONSOLE_LOGS) this._consoleLogs.shift();
		});
		page.on('close', () => { if (this._page === page) this._page = undefined; });

		this._page = page;
		return page;
	}

	private async _computeSnapshot(page: import('playwright-core').Page): Promise<BrowserSnapshot> {
		const snapshotText = await page.ariaSnapshot({ mode: 'ai' }).catch(() => '(could not compute an accessibility snapshot of this page)');
		return { url: page.url(), title: await page.title(), snapshotText };
	}

	async navigate(url: string): Promise<BrowserSnapshot> {
		const page = await this._getPage();
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		return this._computeSnapshot(page);
	}

	async snapshot(): Promise<BrowserSnapshot> {
		const page = await this._getPage();
		return this._computeSnapshot(page);
	}

	async click(ref: string): Promise<BrowserSnapshot> {
		const page = await this._getPage();
		await page.locator(`aria-ref=${ref}`).click({ timeout: 10_000 });
		return this._computeSnapshot(page);
	}

	async type(ref: string, text: string, submit: boolean): Promise<BrowserSnapshot> {
		const page = await this._getPage();
		const locator = page.locator(`aria-ref=${ref}`);
		await locator.fill(text, { timeout: 10_000 });
		if (submit) await locator.press('Enter');
		return this._computeSnapshot(page);
	}

	async screenshot(): Promise<string> {
		const page = await this._getPage();
		const buf = await page.screenshot({ type: 'png' });
		return buf.toString('base64');
	}

	async consoleLogs(): Promise<ConsoleLogEntry[]> {
		return this._consoleLogs;
	}

	async close(): Promise<void> {
		await this._page?.close().catch(() => { });
		await this._browser?.close().catch(() => { });
		this._page = undefined;
		this._browser = undefined;
	}

	override dispose(): void {
		super.dispose();
		void this.close();
	}
}
