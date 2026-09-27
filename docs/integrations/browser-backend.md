# Replacing the browser automation backend

**Contract:** `IBrowserToolMainService` in `src/vs/workbench/contrib/void/common/browser/browserToolServiceTypes.ts`.

**Current implementation:** `src/vs/workbench/contrib/void/electron-main/browserToolMainService.ts`, using `playwright-core` to drive an existing Chrome/Chromium/Edge install (it does not bundle a browser).

## The interface

```ts
navigate(url: string): Promise<BrowserSnapshot>
snapshot(): Promise<BrowserSnapshot>
click(ref: string): Promise<BrowserSnapshot>
type(ref: string, text: string, submit: boolean): Promise<BrowserSnapshot>
screenshot(): Promise<string>       // base64 PNG
consoleLogs(): Promise<ConsoleLogEntry[]>
close(): Promise<void>
```

`BrowserSnapshot.snapshotText` is a human/model-readable accessibility tree with each interactive element tagged `[ref=eN]`; `click`/`type` take that ref string. The current implementation gets this via Playwright's `page.ariaSnapshot({ mode: 'ai' })` and resolves refs with the `aria-ref=` locator engine - the same mechanism Playwright's own MCP server (`microsoft/playwright-mcp`) uses. A replacement backend doesn't have to use Playwright's ref format internally, but should produce refs that are stable across a `snapshot()` call and the next `click`/`type` call on the same page state.

## To replace it

1. Implement `IBrowserToolMainService` in a new `electron-main/` file (it needs Node - browser-context code can't launch a real browser process).
2. In `src/vs/code/electron-main/app.ts`, change the `services.set(IBrowserToolMainService, new SyncDescriptor(...))` line to point at the new class. Nothing else changes - the IPC channel (`void-channel-browser`), the browser-side proxy (`common/browser/browserToolService.ts`), and the six `browser_*` tools all go through the interface, not the implementation.
3. Re-run `node_modules/.bin/tsc -p src/tsconfig.json --noEmit`.

## Why playwright-core and not `playwright`

The full `playwright` package downloads and bundles browser binaries on install; `playwright-core` doesn't, so it doesn't blow up Vader's install size and doesn't require network access to Playwright's CDN just to install the app. The tradeoff is that a user needs *some* browser available: either run `npx playwright install chromium` once (a Playwright-managed browser, found automatically), or have Chrome/Edge/Chromium already installed (the fallback path in `browserToolMainService.ts` scans common OS install locations and passes `executablePath` explicitly). If neither is present, `navigate`/`snapshot` throw a clear error naming both options rather than failing silently.

## What v1 doesn't do

Single page/tab only - no tab management. `BrowserSnapshot` and the tool surface would need a `tabId` added throughout to support multiple tabs; the interface was kept minimal rather than half-implementing multi-tab support.

## How this was verified

The core Playwright calls this implementation depends on (`ariaSnapshot({mode:'ai'})`, the `aria-ref=` locator, `page.screenshot()`, console event capture) were run end-to-end against a real headless Chromium during development: set page content, snapshot, fill an input by ref, click a button by ref, and read back its `console.log` output - all matched expectations. The Electron IPC plumbing around it (the channel registration, the browser-side proxy) follows the exact pattern already used by `mcpChannel.ts`/`mcpService.ts`, which does work in a built app, but could not itself be exercised in the sandbox this was built in (no Electron binary available - see `windows-build.md`).
