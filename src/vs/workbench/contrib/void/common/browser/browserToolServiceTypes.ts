/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

// Vader's browser automation tool. Backed by Playwright (playwright-core, so it drives an
// existing Chrome/Chromium/Edge install rather than bundling one) behind this interface so
// the backend is swappable (see ARCHITECTURE.md) - e.g. for vercel-labs/agent-browser or a
// future CDP-only implementation - without changing the tool surface above it.
//
// v1 deliberately manages a single page (no multi-tab juggling) - see BrowserAutomationService
// for why, and ARCHITECTURE.md for what a multi-tab version would need.

export type BrowserSnapshot = {
	readonly url: string;
	readonly title: string;
	/**
	 * Playwright's own AI-mode aria snapshot: a YAML-like accessibility tree where each
	 * interactive/nameable node is tagged `[ref=eN]`. click/type target elements by that
	 * ref string (resolved via the `aria-ref=` locator engine) - this is the same
	 * mechanism Playwright's own MCP server uses, verified against a real headless
	 * Chromium rather than assumed.
	 */
	readonly snapshotText: string;
};

export type ConsoleLogEntry = {
	readonly type: string;
	readonly text: string;
};

export interface IBrowserToolMainService {
	readonly _serviceBrand: undefined;
	navigate(url: string): Promise<BrowserSnapshot>;
	snapshot(): Promise<BrowserSnapshot>;
	click(ref: string): Promise<BrowserSnapshot>;
	type(ref: string, text: string, submit: boolean): Promise<BrowserSnapshot>;
	screenshot(): Promise<string>; // base64 PNG
	consoleLogs(): Promise<ConsoleLogEntry[]>;
	close(): Promise<void>;
}

export const IBrowserToolMainService = createDecorator<IBrowserToolMainService>('VoidBrowserToolMainService');
