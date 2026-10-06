/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

// Vader's browser automation tool. Backed by Playwright (playwright-core, so it drives an
// existing Chrome/Chromium/Edge install rather than bundling one) behind this interface so
// the backend is swappable (see ARCHITECTURE.md) - e.g. for vercel-labs/agent-browser or a
// future CDP-only implementation - without changing the tool surface above it.
//
// Multi-tab: every open page has a stable pageId (a uuid, not an index - stable across
// other pages opening/closing) that survives for the page's whole lifetime. Every method
// below takes an optional pageId; omitting it targets whichever page is currently "active"
// (see switchToPage), and if nothing is open yet, a page is created automatically - so
// existing single-page usage (always omitting pageId) keeps working unchanged. See
// docs/integrations/browser-backend.md for the full multi-tab lifecycle and the
// crash/stale-reference/timeout handling this version adds.

export type BrowserSnapshot = {
	readonly pageId: string;
	readonly url: string;
	readonly title: string;
	/**
	 * Playwright's own AI-mode aria snapshot: a YAML-like accessibility tree where each
	 * interactive/nameable node is tagged `[ref=eN]`. click/type target elements by that
	 * ref string (resolved via the `aria-ref=` locator engine) - this is the same
	 * mechanism Playwright's own MCP server uses, verified against a real headless
	 * Chromium rather than assumed. Refs are scoped to the snapshot generation they came
	 * from - a ref from before a navigation/reload is stale; see
	 * IBrowserToolMainService.click's stale-reference error message.
	 */
	readonly snapshotText: string;
};

export type PageSummary = {
	readonly pageId: string;
	readonly url: string;
	readonly title: string;
	readonly isActive: boolean;
	readonly isClosed: boolean;
};

export type ConsoleLogEntry = {
	readonly type: string;
	readonly text: string;
};

/** an uncaught JS exception thrown by the page itself - distinct from console.error, which is just a logged message */
export type PageErrorEntry = {
	readonly message: string;
};

/** only failed requests and non-2xx responses - "relevant" network activity for debugging, not a full HAR dump */
export type NetworkEntry = {
	readonly url: string;
	readonly method: string;
	readonly status: number | null; // null when the request failed outright (never got a response)
	readonly failureText: string | null;
};

export interface IBrowserToolMainService {
	readonly _serviceBrand: undefined;

	// page lifecycle
	newPage(): Promise<BrowserSnapshot>;
	listPages(): Promise<PageSummary[]>;
	switchToPage(pageId: string): Promise<BrowserSnapshot>;
	closePage(pageId: string): Promise<void>;

	// per-page actions - pageId omitted targets the active page (auto-created if none exists)
	navigate(url: string, pageId?: string): Promise<BrowserSnapshot>;
	reload(pageId?: string): Promise<BrowserSnapshot>;
	snapshot(pageId?: string): Promise<BrowserSnapshot>;
	click(ref: string, pageId?: string): Promise<BrowserSnapshot>;
	type(ref: string, text: string, submit: boolean, pageId?: string): Promise<BrowserSnapshot>;
	screenshot(pageId?: string): Promise<string>; // base64 PNG
	consoleLogs(pageId?: string): Promise<ConsoleLogEntry[]>;
	pageErrors(pageId?: string): Promise<PageErrorEntry[]>;
	networkLog(pageId?: string): Promise<NetworkEntry[]>;

	closeAll(): Promise<void>;
}

export const IBrowserToolMainService = createDecorator<IBrowserToolMainService>('VaderBrowserToolMainService');
