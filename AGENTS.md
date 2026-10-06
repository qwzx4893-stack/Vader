# Working on Vader's own agent platform

This is guidance for an AI agent (Vader's own, or any other coding agent) asked to modify, extend, or replace part of the agent platform described in `ARCHITECTURE.md`. Read that file first for the subsystem map; this one is about how to make a change safely.

## Before changing anything

1. Read `ARCHITECTURE.md`'s subsystem table and find which subsystem owns the thing you're touching.
2. Check `docs/integrations/` for a guide specific to that subsystem, if one exists.
3. Run a full TypeScript check before AND after your change: `node_modules/.bin/tsc -p src/tsconfig.json --noEmit`. This project's build has no test suite beyond that type check and whatever `npm run compile` (gulp) catches - treat a clean compile as the minimum bar, not full verification.
4. If you touch anything under `browser/react/src/`, rebuild it (`npm run buildreact`) before re-running the type check above - `src/tsconfig.json` resolves against the built `react/out/` bundle, not the `.tsx` source, so stale output hides real errors.

## Rules that exist for a reason, not by accident

- **The three tool-registration maps in `toolsService.ts` (`validateParams`/`callTool`/`stringOfResult`) are typed as exhaustive over `BuiltinToolName`.** If you add a tool to `toolsServiceTypes.ts` and the compiler doesn't immediately complain about a missing case somewhere, you've missed a step - go back and check `toolsServiceTypes.ts`, `prompts.ts`, and `toolsService.ts` are all three updated.
- **Never add a way to disable a `locked: true` policy rule from configuration.** That flag exists specifically to be non-negotiable; a settings toggle that reaches it defeats the point of a "hard" policy engine.
- **The Policy Engine and agent-scope checks in `chatThreadService.ts`'s `_runToolCall` run before the approval-request UI is even shown**, not as an alternative to it. If you're adding a new gate, it belongs in that same sequence (see the numbered comments `// 1.4`, `// 1.5`, `// 2.` in that function), not bolted on somewhere the model or user could route around it.
- **`ChatMessage` and `ThreadType` are persisted to disk** (see the `WARNING: changing this format is a big deal` comment in `chatThreadServiceTypes.ts`). Add optional fields with safe defaults for old data; don't change the meaning of an existing field.
- **Renderer-side code (`browser/`, `common/`) must not import npm packages by bare name** (`import ... from 'some-package'`). The sandboxed workbench resolves no bare specifiers and `build/lib/optimize.ts` leaves every bare package external, so a bare import survives into the packaged app and leaves a blank gray window at startup - which no Node-based test can reveal. `@cline/agents` is reached through the generated `browser/agentRuntime/clineBundle/index.js` (`npm run buildcline`, run it after a fresh clone and before compile). Verify renderer-reachable changes with `node src/vs/workbench/contrib/vader/test/clineBundleBrowserE2E.mjs` and, for packaged builds, the `Windows Smoke Test` workflow.
- **Anything that reaches the network** should go through an `electron-main/*MainService.ts` behind an IPC channel (see `discoveryMainService.ts`), not a direct `fetch()` from browser code - this repo's own convention (every existing network call already works this way) suggests the renderer's CSP or sandboxing doesn't reliably allow it, and it keeps all outbound network calls in one auditable place per subsystem.

## When asked to replace a subsystem or integrate a new project

The mission this platform was built under anticipates being told things like "replace the browser backend with project X" or "update the MCP integration." Do this by:

1. Reading that subsystem's entry in `ARCHITECTURE.md`'s extension-points section for the exact interface to implement.
2. Writing a new implementation of that interface - not modifying the interface itself unless the new project genuinely can't fit it (in which case, widen the interface deliberately and update every existing implementation, don't just reshape it around the new one).
3. Swapping the `registerSingleton`/`services.set` call to point at the new implementation.
4. Running the verification in "Before changing anything" above.
5. Checking licenses before copying code from a donor project (see `README.md`'s license section) - reimplement the idea if the license doesn't allow copying the code.

## Where this platform is still thin

Read the final report delivered with this build (or `CHANGELOG.md`) for the current, honest list of what's implemented at MVP depth vs. what's a stub. Don't assume a subsystem is more complete than its own file's comments say it is.
