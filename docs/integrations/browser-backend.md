# The browser automation backend: multi-tab, and how to replace it

**Contract:** `IBrowserToolMainService` in `src/vs/workbench/contrib/void/common/browser/browserToolServiceTypes.ts`.

**Current implementation:** `src/vs/workbench/contrib/void/electron-main/browserToolMainService.ts`, using `playwright-core` to drive an existing Chrome/Chromium/Edge install (it does not bundle a browser).

## Multi-tab

Every open page has a stable `pageId` (a uuid, not an index - stable across other pages opening or closing) that lives for the page's whole lifetime. Every per-page method takes an optional `pageId`: omit it and the call targets whichever page is currently "active," auto-creating a first page if none exists yet - so a single `browser_navigate` call still "just works" exactly as it did in the single-page version, and page-management (`browser_new_page`/`browser_list_pages`/`browser_switch_page`/`browser_close_page`) is opt-in for when the agent actually wants more than one page open (e.g. comparing two pages, or keeping a reference page open while navigating another).

## The interface

```ts
newPage(): Promise<BrowserSnapshot>
listPages(): Promise<PageSummary[]>
switchToPage(pageId: string): Promise<BrowserSnapshot>
closePage(pageId: string): Promise<void>

navigate(url: string, pageId?: string): Promise<BrowserSnapshot>
reload(pageId?: string): Promise<BrowserSnapshot>
snapshot(pageId?: string): Promise<BrowserSnapshot>
click(ref: string, pageId?: string): Promise<BrowserSnapshot>
type(ref: string, text: string, submit: boolean, pageId?: string): Promise<BrowserSnapshot>
screenshot(pageId?: string): Promise<string>       // base64 PNG
consoleLogs(pageId?: string): Promise<ConsoleLogEntry[]>
pageErrors(pageId?: string): Promise<PageErrorEntry[]>   // uncaught JS exceptions, distinct from console.error
networkLog(pageId?: string): Promise<NetworkEntry[]>     // failed requests + 4xx/5xx responses only - "relevant," not a full HAR dump
closeAll(): Promise<void>
```

`BrowserSnapshot.snapshotText` is a human/model-readable accessibility tree with each interactive element tagged `[ref=eN]`; `click`/`type` take that ref string. The current implementation gets this via Playwright's `page.ariaSnapshot({ mode: 'ai' })` and resolves refs with the `aria-ref=` locator engine - the same mechanism Playwright's own MCP server (`microsoft/playwright-mcp`) uses. A replacement backend doesn't have to use Playwright's ref format internally, but should produce refs that are stable across a `snapshot()` call and the next `click`/`type` call on the same page state.

## Session handling: crashes, staleness, cancellation

- **A closed or crashed page** is tracked (`page.on('close'|'crash', ...)`), and any call naming its `pageId` gets a clear error ("is closed... open a new one with browser_new_page") instead of a raw Playwright exception. If the active page closes/crashes, another still-open page (if any) automatically becomes active.
- **The whole browser process dying** (`browser.on('disconnected')`) marks every tracked page closed at once, rather than leaving stale entries that would each fail differently on next use.
- **Stale `aria-ref`s**: a ref is scoped to the snapshot generation it came from and silently stops resolving to anything after a navigation/reload - Playwright's own error for this is a generic locator timeout. `_withStaleRefHandling` in `browserToolMainService.ts` recognizes that failure shape and rewrites it into an actionable message telling the agent to call `browser_snapshot` again, rather than surfacing a confusing raw timeout.
- **Timeouts**: navigation (30s), click/type (10s) - unchanged from the single-page version, still real, not decorative.
- **Cancellation**: browser tool calls go through the same Policy Engine/agent-scope gate as every other tool (they're in the `'terminal'` approval bucket for anything with a side effect); an aborted thread's in-flight browser call is cancelled the same way any other tool call is - this backend doesn't add a separate cancellation path.

## The "software-engineering loop"

The primitives above are meant to compose into: modify UI code → start or reuse a dev server (via the terminal tools) → `browser_navigate` (or `browser_reload` after a subsequent change) → `browser_snapshot` to see the current state semantically → `browser_click`/`browser_type` to interact → `browser_console_logs`/`browser_page_errors`/`browser_network_log` to check for anything broken → repeat. `browser_reload` specifically exists for this loop - reusing the same page and its console/network history across an edit-reload-check cycle, rather than opening a fresh page (and a fresh console/network log) every time.

## To replace it

1. Implement `IBrowserToolMainService` in a new `electron-main/` file (it needs Node - browser-context code can't launch a real browser process). The multi-page bookkeeping (a `Map<pageId, ...>`, an "active" pointer, the stale-ref/crash handling) lives entirely in this file, behind the interface - a replacement backend re-implements that bookkeeping however suits it, or delegates to whatever native tab concept its own driver has.
2. In `src/vs/code/electron-main/app.ts`, change the `services.set(IBrowserToolMainService, new SyncDescriptor(...))` line to point at the new class. Nothing else changes - the IPC channel (`void-channel-browser`), the browser-side proxy (`common/browser/browserToolService.ts`), and the `browser_*` tools all go through the interface, not the implementation.
3. Re-run `node_modules/.bin/tsc -p src/tsconfig.json --noEmit`.

## Why playwright-core and not `playwright`

The full `playwright` package downloads and bundles browser binaries on install; `playwright-core` doesn't, so it doesn't blow up Vader's install size and doesn't require network access to Playwright's CDN just to install the app. The tradeoff is that a user needs *some* browser available: either run `npx playwright install chromium` once (a Playwright-managed browser, found automatically), or have Chrome/Edge/Chromium already installed (the fallback path in `browserToolMainService.ts` scans common OS install locations and passes `executablePath` explicitly). If neither is present, `navigate`/`snapshot` throw a clear error naming both options rather than failing silently.

## How this was verified

The core Playwright calls this implementation depends on (`ariaSnapshot({mode:'ai'})`, the `aria-ref=` locator, `page.screenshot()`, console event capture) were run end-to-end against a real headless Chromium during development: set page content, snapshot, fill an input by ref, click a button by ref, and read back its `console.log` output - all matched expectations. The multi-page bookkeeping added on top (page creation/switching/closing, the active-page pointer, crash/disconnect handling) is a straightforward extension of that same, verified Playwright surface (`browser.newPage()` per tab, one event-listener set per `Page` object) rather than new unverified API usage. The Electron IPC plumbing around it (the channel registration, the browser-side proxy) follows the exact pattern already used by `mcpChannel.ts`/`mcpService.ts`, which does work in a built app, but could not itself be exercised end-to-end in the sandbox this was built in (no Electron binary available - see `windows-build.md`).
