# VADER — FINAL PRODUCTION READINESS REPORT

This report closes out the two-mission production-hardening effort covering Vader's agent
platform (see `ARCHITECTURE.md` for the subsystem map, `CHANGELOG.md` for the full change-by-change
history, and `docs/integrations/` for per-subsystem design docs). It follows the evidence-level
discipline both missions required: every claim below is tagged with how it was actually verified,
never blurred into a stronger-sounding category than the evidence supports.

**Evidence-level taxonomy used throughout:**

| Tag | Meaning |
|---|---|
| **COMPILED** | `tsc --noEmit` / `npm run compile` passed; proves the code is well-typed and builds, nothing about runtime behavior |
| **UNIT** | A narrow, in-process check of one function/class in isolation |
| **INTEGRATION** | Real, unmodified Vader code exercised outside Electron (the several services with zero DI dependencies - `BrowserToolMainService`, `MCPChannel`, `GitWorktreeMainService` - allow this) against a real local dependency (a real spawned process, a real Playwright browser, a real MCP SDK client/server pair) |
| **PRODUCTION-SIMULATION** | Real, unmodified Vader provider-transport code (the actual `openai`/`@anthropic-ai/sdk` SDK calls Vader ships) exercised against a deterministic **local** HTTP server that speaks the real wire protocol but is not a real model - proves Vader's architecture (streaming, parsing, tool-calling, retries, cancellation, error classification), proves nothing about a real model's actual outputs |
| **REAL-MODEL** | A real, paid API call to an actual hosted model |
| **LIVE-UI** | The actual Electron workbench, launched and interacted with visually |
| **WINDOWS-LIVE** | Actually built and run on a Windows machine |

**Do not read PRODUCTION-SIMULATION results as REAL-MODEL results.** They test different things and
this report never conflates them.

---

## 1. Executive verdict

**READY WITH SPECIFIC EXTERNAL VALIDATION STILL REQUIRED.** Not "not ready" - the architecture is
sound, hard-enforced where it matters (Policy Engine, worktree isolation, verification), and every
backend subsystem this mission could reach has real, passing, non-mocked test coverage, including
several genuine defects found by that testing and fixed, not just documented. But two categories of
evidence this verdict would need to say "ready for daily use" outright were never obtainable from
this sandboxed environment, through no lack of trying:

1. **No REAL-MODEL run ever completed.** The mandated live OpenRouter test was correctly blocked by
   this environment's network egress policy for the entire duration of both missions (per the
   explicit, absolute instruction never to bypass that block). The substitute built instead - a
   deterministic local production-simulation server - is real, valuable evidence about Vader's own
   code, but it is not evidence that a real model, talking to Vader through Vader's real prompts and
   tool descriptions, actually produces good agentic behavior day to day.
2. **No LIVE-UI run ever completed.** Electron starts and creates a window, but every attempt in
   this sandbox stops short of a mounted workbench on a CSS-MIME/dynamic-import error (see
   `docs/integrations/windows-build.md` for the full account) - and critically, **the same failure
   reproduces identically on an unmodified upstream Void checkout** in this same sandbox, so this is
   not attributed to anything Vader added. But that comparison only proves "not a regression here";
   it does not prove the workbench loads correctly on a normal desktop. Nobody has ever seen Vader's
   chat UI, Settings panel, Marketplace pane, or Agent Manager actually render.

Everything else - the backend logic, the safety gates, the resource-lifecycle correctness, the
provider transport layer - has real, verified, evidence-backed answers below.

## 2. Architecture

Unchanged from `ARCHITECTURE.md`'s own account, which remains accurate (spot-checked against the
current repository state while writing this report, not merely quoted): Cline's `@cline/agents`
`AgentRuntime` is the sole Main Agent runtime; Vader supplies its own `AgentModel`
(`VaderAgentModel`) rather than using any of `@cline/llms`'s built-in providers; the Policy Engine
and agent-scope checks run before tool-call approval UI is even shown, not as an alternative to it.
**COMPILED** (the whole subsystem map corresponds to real, currently-compiling code - verified by
this pass's own full `npm run compile`, 0 errors, and `tsc --noEmit`, clean).

## 3. Cline runtime integration

**INTEGRATION.** `test/clineRuntimeSmoke.mjs` runs 14 real scenarios against the actual installed
`@cline/agents` package (not a mock): basic completion, real tool execution, three-tool
mid-batch-approval interleaving (A runs, B pauses for approval, C stays queued behind B, all three
eventually complete in order), cancellation mid-tool, and policy-rejection recovery. All 14 pass
against the currently-installed `@cline/agents@0.0.86`/`@cline/shared@0.0.86`, version-guarded by
`test/checkClineTypingsVersion.mjs` so a future dependency bump that changes the shape Vader's
hand-written typings shim assumes is caught immediately rather than silently miscompiling.

## 4. Deterministic production simulation

**PRODUCTION-SIMULATION.** `test/simulatedProviderServer.mjs` is a real local HTTP server speaking
the exact OpenAI-compatible wire protocol Vader's shipped transport code
(`sendLLMMessage.impl.ts`) speaks - streaming SSE, non-streaming JSON, tool-call payloads, and a
scriptable fault-injection queue (auth errors, rate limits, context-limit errors, malformed
bodies, connection resets, hangs, truncated streams). `test/productionSimE2E.mjs` runs 19 scenarios
across five groups (basic protocol, error taxonomy/fault injection, cancellation propagation,
Policy ALLOW/ASK/DENY matrix, multi-turn state coherence) through the real Cline `AgentRuntime` and
Vader's real `VaderAgentModel` - 19/19 passing.

This work directly found and fixed a **real, severe defect**, not merely tested around one: the
`_setAborter` cancellation callback for `_sendOpenAICompatibleChat`/`_sendOpenAICompatibleFIM` was
wired up inside a `.then()` continuation - after the request's promise had already resolved -
meaning cancellation was completely inert for any request that hung before receiving its first
response (the exact case fault injection reproduced with a `hang` scenario). Fixed by constructing
the `AbortController` up front and passing its signal directly into the SDK call. Verified: what
used to hang until the SDK's own 10-minute default timeout now cancels in ~1ms, both at the raw
provider-call level and through the full real Cline runtime stack. `_sendOpenAICompatibleFIM` had
no cancellation wiring at all before this fix (autocomplete requests could never be cancelled).
Anthropic's path was checked and found already correct. Gemini's `@google/genai` SDK has no public
abort-signal hook at all - documented as a real, unfixed, upstream SDK limitation, not something
Vader can currently correct.

A second real finding from this same testing: none of the three SDKs Vader depends on
(`openai`, `@anthropic-ai/sdk`, `@google/genai`) needed a second, Vader-level retry layer - each
already retries 408/409/429/5xx with its own bounded backoff internally (confirmed by reading
`node_modules/openai/core.mjs`'s own `shouldRetry()`). Vader deliberately does not add a competing
retry loop, which would silently multiply attempts. `providerErrorTypes.ts`'s 13-category error
taxonomy (`classifyProviderError`) surfaces this as `retryable: true/false` informationally,
feeding Cline's own `errorClass`/`errorRetryable` protocol fields, without Vader acting on it by
retrying again itself.

## 5. Real-model status

**Not run. Explicitly, by design, for the entire duration of both missions.** The mission's
security constraints required never bypassing this environment's OpenRouter network block, and no
substitute network path was ever made available. What exists instead (see §4) is real evidence
about Vader's own code, deliberately never presented as evidence about a real model's behavior.
**This is the single largest piece of unverified surface in this whole report** - it means no one
has ever watched Vader run an actual multi-turn agentic coding task against a real hosted model and
confirmed the tool-call loop, context assembly, and response quality hold up in practice.

## 6. Short/multi-turn E2E

Covered under §4's Group E (multi-turn state coherence, PRODUCTION-SIMULATION) and §3's
mid-batch-approval scenario (INTEGRATION, real Cline runtime). No REAL-MODEL multi-turn session
was ever run (see §5).

## 7. Policy Engine

**INTEGRATION + PRODUCTION-SIMULATION.** `productionSimE2E.mjs` Group D exercises the real
ALLOW/ASK-approve/ASK-reject/DENY/mid-batch-approval-resume matrix through the real Policy Engine
and real Cline runtime - 5/5 passing, including confirming a DENY rule blocks a tool call without
ever prompting for approval (the gate genuinely runs first, not as UI-only theater) and an
ASK-reject path completes cleanly with the file never written. `locked: true` rules remain
non-configurable from Settings by construction (no code path reaches them from a settings toggle -
confirmed by reading `common/policy/builtInPolicyRules.ts` and the Settings UI's rule-editing
surface).

## 8. Plan Mode

Unchanged from Mission A's account: hard-enforced read-only (every tool that could modify state or
run a command is disabled at the gate for a Plan Mode thread, not just hidden from the prompt) -
**COMPILED** and reasoned from code structure; not independently re-tested with a fresh scenario in
this pass.

## 9. Context Engine

**UNIT** (the specific fix) **+ COMPILED** (the rest). This pass found and fixed the unbounded-cache
defect Mission A's audit had flagged but left open: `contextEngineService.ts`'s three per-file-URI
maps (symbol cache, diagnostics cache, marker-version tracker) were plain `Map`s that grew for the
entire lifetime of the window, keyed by every file ever mentioned/opened in chat or touched by the
marker service - effectively every file in the workspace over a long session with a project-wide
linter, never evicted. Replaced with VS Code's own real `LRUCache` (`base/common/map.ts`, already
used elsewhere in this codebase for the identical shape of problem), bounded at 500 files.
`test/cacheBoundsE2E.mjs` proves the exact class and constructor arguments now in use stay bounded
under 10x-over-limit insertion load and correctly protect a repeatedly-touched entry from eviction
(6/6 passing).

## 10. Memory and compaction

Unchanged from Mission A's account (persistent project/agent memory, structured compaction with
raw messages archived not destroyed). Not independently re-tested in this pass; **COMPILED** only.

## 11. Filesystem, terminal

Inherited Void tool implementations, not modified by either mission beyond the shell-injection fix
covered in §14 (worktree-specific, not the general filesystem/terminal tools). **COMPILED** only for
this report's scope - a full DI-graph test of `toolsService.ts`'s ~15-platform-service-dependent
tool executors was assessed and deliberately not attempted (see `test/openRouterE2E.mjs`'s own
comment on why: building a full fake of that DI graph is a bigger, riskier undertaking than the
things actually novel in this mission).

## 12. Subagents

Subagent delegation (`runSubagentTask`) returns a structured summary rather than the full
transcript by design. Exercised indirectly via `test/clineRuntimeSmoke.mjs`'s tool-execution
scenarios; not independently re-tested with a dedicated subagent-specific E2E scenario in this pass.

## 13. Parallel agents / orchestration

**COMPILED + code review**, not independently re-verified with a fresh integration test in this
pass. `orchestrationService.ts`'s `MAX_RETAINED_RUNS`/`_pruneOldRuns` (fixed in Mission A's audit,
never evicting a still-in-progress run) could not be re-exercised with a real integration test in
this pass: `AgentOrchestrationService` is not exported outside DI registration and depends on four
other DI-heavy services (`IAgentGatewayService`, `IGitWorktreeMainService`, `IAgentsService`,
`IVerificationService`), making a full non-Electron instantiation a bigger scaffolding effort than
its ROI justified given everything else this pass needed to cover. The pruning algorithm itself
(a straightforward array-splice bound, unconditional on `finishedAt`) was re-read and remains
correct by inspection - stated plainly as **not independently re-tested this pass**, not silently
assumed fine.

## 14. Worktrees

**INTEGRATION.** `test/worktreeE2E.mjs` (15/15 passing) covers the real success path
(create→edit→commit→merge, with the merged change confirmed actually visible on the main branch),
the no-changes path, a real merge-conflict path (confirmed the aborted merge leaves the main repo
byte-for-byte untouched, no lingering conflict markers), verification-failure semantics (a failed
worktree and its branch are deliberately retained on disk for manual review), and shell-injection
regression at every git-argument boundary (`branchName`, `targetBranch`, both the original found
path and the boundary this pass's own testing extended it to).

This pass additionally found and fixed a real, previously-undiscovered defect in the same file:
`gitWorktreeMainService.ts`'s `git()` helper had **no timeout at all** on any subprocess call. A
hung `git commit` (GPG pinentry, a blocking hook, `.git/index.lock` contention) would await
forever, permanently consuming one of `orchestrationService.ts`'s `MAX_CONCURRENCY` worker slots -
a real, reachable way to slowly deadlock the whole parallel-task system one hung git call at a
time. Fixed with a 60s `execFile` timeout (SIGTERM on expiry, clear error message) plus
`GIT_TERMINAL_PROMPT=0` so a credential prompt fails fast instead of hanging. Verified with a real
hung subprocess (a fake `git` shell script that genuinely sleeps): `test/timeoutPolicyE2E.mjs`
confirms the timeout fires at the configured bound (not immediately, not never), the hung process
is actually SIGTERM-killed (checked via `ps`, not assumed), and `createWorktree()` resolves with a
clear timeout error instead of hanging the caller forever.

## 15. Verification Agent

Independent, hard-enforced-read-only verify→repair→re-verify loop, unchanged from Mission A's
account. Not independently re-tested in this pass; **COMPILED** only.

## 16. Browser automation

**INTEGRATION.** `test/browserE2E.mjs` (13/13 passing) runs real Playwright against a real local
static-HTML fixture server: navigation, real ARIA-snapshot generation, ref-based click
interaction, real console-log/network-log/page-error capture, multi-page create/list/switch,
reload, and explicit close. `test/soakE2E.mjs` extends this to ~170 real open/navigate/close
cycles mixed with intentionally-long-lived pages, confirming the closed-page retention cap
(`MAX_CLOSED_PAGES_RETAINED`) holds under sustained load and never evicts a still-open page.

Two real findings from this pass's browser work:

- **A genuine environment-robustness gap, found and fixed.** `chromium.launch()` fails outright
  when the installed `playwright-core` expects a bundled-browser revision that doesn't match
  what's actually cached under `PLAYWRIGHT_BROWSERS_PATH` (a real, plausible skew after a
  dependency bump, in any environment - not unique to this sandbox). `findFallbackExecutablePath()`
  now also tries that path's own stable `chromium` convention symlink after the existing
  system-Chrome/Edge candidates. Verified against this sandbox's own real, actually-mismatched
  browser cache: fails without the fix, launches successfully with it.
- **A wrong assumption in the test suite itself, found and corrected.** An earlier comment claimed
  explicit `closePage()` bypasses the closed-page retention cap entirely. Direct measurement
  against real `playwright-core` showed this is false: Playwright's `'close'` event fires (and the
  cap-eviction handler runs) *before* `page.close()`'s own promise resolves, so the cap is
  exercised on every close, explicit or not. Comment corrected; `soakE2E.mjs` proves the cap holds
  under both explicit and cap-triggered eviction paths in the same run.

## 17. Vision

Real image+prompt→text pipeline via a Model-Router-resolved vision-capable model, unchanged from
Mission A's account. `modelSupportsVision()` remains a documented, deliberately-conservative
pattern-matching heuristic rather than a static per-model field (see §26 for why this wasn't
converted to full static metadata in this pass). Not independently re-tested in this pass;
**COMPILED** only.

## 18. MCP

**INTEGRATION.** Beyond Mission A's fixes (stuck-loading on connect failure, dead-code Policy
Engine integration for server permissions), this pass found and fixed a real unbounded-hang defect
of the same family as §14's git timeout: `mcpChannel.ts`'s `_createClient()` had no timeout on the
connect handshake. Neither a stdio server's process spawn nor a URL-based transport's network
handshake has any timeout before the SDK's own per-request timeout logic even applies (that only
covers requests made *after* a connection exists) - so a remote MCP server URL that accepts a
connection but never completes it hung this call forever, and since `_refreshMCPServers` awaits
every server change in one `Promise.all`, a single hung server blocked every *other* server in the
same refresh batch too. Fixed with a 20s connect timeout raced against the real connect attempt,
with the half-connected client's resources properly torn down on timeout.

The first version of this fix had a real, caught-by-its-own-test bug: the cleanup call
(`createdClient?.close()`) was fire-and-forget rather than awaited, so the function could resolve
before the underlying process was actually killed - `test/timeoutPolicyE2E.mjs` caught this
directly (`leaked=1` on first run), it was fixed to `await` the cleanup, and the same test now
passes 9/9 including a "no leaked child process" check. Verified with a real hung MCP stdio server
process (`test/fixtures/hangingMcpServer.mjs`) alongside a real healthy one in the same refresh
batch: the hung server times out and reports a clear error while the healthy one still connects
successfully.

Separately, `test/soakE2E.mjs` runs 15 real connect/disconnect cycles against a real MCP fixture
server, confirming no `infoOfClientId` leak and no orphaned child process across the whole soak
(after this pass also found and fixed a real methodology bug in its own leak-detection check: a
naive `pgrep -f "<pattern>"` always matches its own invocation, since the search pattern is a
literal argument on pgrep's own command line - corrected to a `ps -eo pid,args` check filtered in
JS, which structurally can't self-match).

## 19. Skills

Full install/cache/pin/enable/disable/update/remove lifecycle with trust states, routed through
the Policy Engine, unchanged from Mission A's account. Not independently re-tested in this pass;
**COMPILED** only.

## 20. Unified Marketplace

**UNIT** (the specific fix) **+ COMPILED** (the rest). This pass fixed the second unbounded cache
Mission A's audit had flagged: `unifiedMarketplaceService.ts`'s per-`${providerId}::${query}`
search-result cache grew one entry per distinct query string ever typed - including once per
keystroke, since `search()` is called per keystroke by the UI - with the per-entry TTL only ever
making an entry stale, never removing it. Replaced with the same real `LRUCache`, bounded at 300
entries. `test/cacheBoundsE2E.mjs` simulates a realistic incremental-search session (one query
built up character by character, five simulated providers each) and confirms the cache stays
bounded throughout.

## 21. Soak testing

**INTEGRATION.** `test/soakE2E.mjs`: ~170 real browser open/navigate/close cycles (§16) and 15 real
MCP connect/disconnect cycles (§18), both against real, unmodified Vader services with real local
dependencies, not simulations. Orchestration/agent-loop soak testing was not attempted (see §13's
DI-scaffolding note) - a real gap in this pass's soak coverage, stated plainly.

## 22. Cache bounds

Covered fully in §9 and §20. Both of the caches explicitly named as still-unbounded in Mission A's
own "Known gaps" list are now fixed and independently proven bounded under load (`test/cacheBoundsE2E.mjs`,
6/6 passing).

## 23. Provider hardening (timeouts, retries, error taxonomy)

Covered in §4 (cancellation fix, SDK-retry-reuse finding, error taxonomy), §14 (git subprocess
timeout), and §18 (MCP connect timeout). Marketplace search already had its own per-provider
timeout (`PROVIDER_SEARCH_TIMEOUT_MS`, pre-existing) confirmed consistent with the same "an
external dependency must never hold up the rest of the system" principle applied to the two new
fixes. Not separately audited in this pass: `verificationService.ts`'s build/lint/test subprocess
timeouts, and the external-agent-adapter's own request lifecycle - noted as unexamined, not
assumed fine.

## 24. Provider capability metadata

**Assessed, not converted.** `modelSupportsVision()` remains a pattern-matching heuristic rather
than a static per-model field on `VoidStaticModelInfo`, unlike `supportsFIM`/`supportsSystemMessage`/
`contextWindow`, which are genuine static per-model data. Converting it fully would mean hand-
annotating all 90+ existing static model entries across every provider - assessed as a large,
error-prone undertaking without a fresh, authoritative, per-model source for each one (the same
kind of live-verification work that surfaced real disputed/incorrect data for MiniMax-M3 and
Moonshot's catalog in §29 below). Doing it exhaustively and speculatively risks introducing new,
harder-to-notice inaccuracies rather than improving correctness. Left as a documented, bounded
limitation rather than rushed.

## 25. Provider branding

**Not implemented in this pass.** Providers are currently rendered as plain text in Settings (no
icon/logo component exists at all - confirmed by reading `Settings.tsx`, which has no
`ProviderIcon`-shaped component or per-provider asset references). Building this properly requires
real, officially-sourced logo assets (the mission's own rule: no AI-generated or recreated marks) -
this environment has no verified, license-safe path to download and embed exact official brand
assets for eleven-plus providers, and guessing at "close enough" marks would violate the very rule
meant to prevent bad branding. Stated as a real gap requiring a human maintainer to source assets
from each vendor's official brand-asset page under their usage guidelines, not attempted with a
risky approximation.

## 26. UI/UX polish

Not meaningfully assessable in this pass - see §1 and §31 for why (no LIVE-UI run ever completed
in this environment). Any UI-level claim beyond "the React build compiles" would be unverified.

## 27. Performance

No dedicated profiling was run in this pass. The concrete performance-relevant fixes that did
happen (bounded caches in §9/§20, bounded MCP-connect/git-subprocess timeouts in §14/§18, the
cancellation fix in §4 that turns indefinite hangs into ~1ms aborts) are real, verified
improvements, but a systematic performance pass (startup time, memory profile under real usage,
context-assembly latency) was not conducted.

## 28. Security

The most significant finding across both missions: a real shell-injection vulnerability in
`gitWorktreeMainService.ts` (Mission A), fixed by switching every git invocation from
shell-string interpolation to `execFile()` with an argv array, verified against a real
reproduction (a commit message containing a shell-command-substitution payload). This pass's own
security-relevant finding: the `undici` vulnerability nested under `@cline/llms`'s
`dify-ai-provider` dependency, investigated for actual reachability (not just accepted or
dismissed) via a real Node ESM module-load tracer run against the full, real
`clineRuntimeSmoke.mjs` suite - confirmed genuinely unreachable from anything Vader's code does
(§5's full account is in `docs/integrations/dependency-audit.md`), then fixed anyway via a
`package.json` override since the fix carried effectively zero behavioral risk once reachability
was ruled out. The temporary OpenRouter test credential from Mission A's mandate was verified
absent from the current working tree, the full git history, and the process environment before
this report was written (a fresh `git log --all -p | grep` and working-tree grep, both zero
matches).

## 29. Dependencies

Full account in `docs/integrations/dependency-audit.md`. Summary: the one dependency issue the
mission specifically named (`@cline/llms`'s nested `undici`) was deeply investigated and resolved
(§28). A full `npm audit` reports 86 findings across ~80 packages; the overwhelming majority are
pre-existing, inherited from the upstream VS Code fork base, and are build-time-only tooling
(`gulp`, `webpack`, `rollup`, `terser`, `eslint` plugins, `mocha`, ...) that never ships inside the
packaged Electron application - noted for completeness, not individually re-investigated in this
pass (outside the specifically-named scope). Provider catalog re-validation (live web search,
newly available in this pass) found two real, stale entries and fixed both: Moonshot's
`kimi-k2-thinking` was confirmed genuinely retired by the vendor on its direct API (2026-05-25),
replaced with the three models confirmed current (`kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`);
MiniMax's catalog was missing its whole M2.5/M2.7 line, confirmed and added via a real, merged
upstream Cline PR. MiniMax-M3 was deliberately left unadded - live sources genuinely disagree on
its context window even now, and asserting either number would be a guess dressed up as verified
data.

## 30. Windows readiness

**Static audit only - WINDOWS-LIVE never attempted, no Windows runner available.**
`docs/integrations/windows-build.md`'s account from Mission A stands: this codebase's own build
tooling only ever fetches Electron for the host's own platform (no cross-compilation), so a real
Windows package can only be produced by actually running the build on Windows - something this
sandbox structurally cannot do. A `.github/workflows/windows-build.yml` exists and has never been
run.

This pass's own static audit of Vader's additions specifically (not vanilla VS Code) found no new
cross-platform bugs: subprocess spawning in Vader's own code goes through either `execFile`
(git - a real, non-`.cmd` executable on Windows too, no shell needed) or `cross-spawn` (the
browser build's `npx` watch-mode spawns, and the MCP SDK's own stdio transport) - both verified by
reading the actual import (`cross-spawn`, not raw `child_process.spawn`) rather than assuming a
bug and fixing something that wasn't broken. Path handling throughout Vader's additions uses
`path.join`/`URI.joinPath` correctly rather than hardcoded separators; platform branches
(`isWindows`/`isMacintosh`/`isLinux` from `base/common/platform.js`) are used correctly where
platform-specific behavior is genuinely needed (browser executable fallback paths, autocomplete
line-ending handling). This pass's own new timeout/env fixes (`GIT_TERMINAL_PROMPT=0`, `execFile`
timeouts) are standard cross-platform git/Node behavior, not POSIX-only.

## 31. Build/test matrix

Run and passing as of this report, against the fully rebuilt `out/` (not a partial/quick-patched
build):

| Check | Result |
|---|---|
| `tsc -p src/tsconfig.json --noEmit` | 0 errors |
| `npm run compile` | 0 errors |
| `test/checkClineTypingsVersion.mjs` | 2/2 |
| `test/clineRuntimeSmoke.mjs` | 14/14 |
| `test/productionSimE2E.mjs` | 19/19 |
| `test/worktreeE2E.mjs` | 15/15 |
| `test/browserE2E.mjs` | 13/13 |
| `test/cacheBoundsE2E.mjs` | 6/6 |
| `test/soakE2E.mjs` | 6/6 |
| `test/timeoutPolicyE2E.mjs` | 9/9 |
| `test/dependencyReachabilityE2E.mjs` | 3/3 |
| **Total** | **87/87** |

Not run in this pass (pre-existing, environment-blocked): `test/openRouterE2E.mjs` (requires
network access this sandbox's policy denies), any LIVE-UI or WINDOWS-LIVE check.

## 32. Defects discovered (this pass, on top of Mission A's)

1. Cancellation was completely inert for any OpenAI-compatible request hanging before its first
   response - severe, fixed (§4).
2. `_sendOpenAICompatibleFIM` had no cancellation wiring at all - severe, fixed (§4).
3. Two caches flagged in Mission A as unbounded (Context Engine, Marketplace) were still
   unbounded - fixed (§9, §20).
4. `gitWorktreeMainService.ts`'s git subprocess calls had no timeout - a real deadlock vector for
   orchestration - fixed (§14).
5. `mcpChannel.ts`'s MCP connect handshake had no timeout, and could block an entire refresh
   batch - fixed (§18).
6. The first attempt at fix #5 leaked a process on timeout due to a fire-and-forget cleanup call -
   caught by its own test, fixed (§18).
7. A real environment-robustness gap in Playwright browser-revision fallback - fixed (§16).
8. A wrong assumption in `browserE2E.mjs`'s own comments about the closed-page retention cap -
   corrected (§16).
9. A `pgrep -f` self-match false positive in this pass's own soak-test leak detection - caught and
   fixed before it could hide a real problem (§18).
10. Two stale provider model-catalog entries (Moonshot's retired `kimi-k2-thinking`; MiniMax's
    missing M2.5/M2.7 line) - fixed (§29).

## 33. Defects fixed

All ten items in §32, plus every item Mission A already fixed (shell injection, stuck approval
promise, MCP stuck-loading, unbounded page/run history - see `CHANGELOG.md`). Nothing found in
either mission was left as "just documented" when a safe fix was available; the two exceptions
(MiniMax-M3's disputed context window, provider branding assets) are cases where the honest fix is
*not* guessing.

## 34. Remaining limitations

- No REAL-MODEL validation has ever been performed (§5).
- No LIVE-UI validation has ever been performed (§1, §26).
- No WINDOWS-LIVE validation has ever been performed (§30).
- Provider branding is plain text only; no real official logo assets included (§25).
- `modelSupportsVision` remains heuristic rather than static per-model metadata (§24).
- Orchestration/parallel-agent soak testing was not attempted (§13, §21).
- MiniMax-M3 is a real, released model not yet added to the static catalog pending a settled
  context-window source (§29).
- `verificationService.ts` and the external-agent-adapter's own timeout/retry policy were not
  separately audited (§23).

## 35. Short-term readiness

For a technical user running Vader from source, comfortable with a dev build, and specifically
interested in the backend/CLI-adjacent workflows this mission could actually verify end to end
(worktree-isolated parallel agents, MCP server management, the browser tool, the Policy Engine's
gating behavior) - **the evidence supports real confidence**: every one of those subsystems has
genuine, non-mocked integration tests, several real defects were found and fixed by that testing,
and the fixes are independently verified rather than assumed. What the evidence does **not**
support yet is confidence in the actual interactive product - the chat UI, Settings, Marketplace
pane - since none of it has ever been visually confirmed working in this environment, and no real
model has ever driven a real conversation through it.

## 36. Long-term readiness

The architectural decisions that matter most for months of daily use hold up under inspection:
hard-enforced (not merely UI-suggested) policy gates, worktree isolation for risky parallel work,
bounded resource lifecycles now verified across every subsystem this mission could reach, a
provider-agnostic transport layer with a real, working cancellation/timeout/retry story. What
long-term daily use would actually stress - real multi-hour agent sessions against real models,
real Windows/macOS desktop ergonomics, provider branding polish, the UI holding up under real
use - is precisely the surface this report could not verify from a sandboxed CLI session.

## 37. External validation still required

1. **A real REAL-MODEL run**, end to end, against at least one of the newly-added providers and at
   least one of the original ones, from a network that isn't policy-blocked.
2. **A real LIVE-UI run** on an actual desktop (not a headless/root/Xvfb sandbox) to confirm the
   workbench actually mounts - this sandbox's own comparison against stock Void suggests the
   current failure is environment-specific, but that has never been confirmed on a normal machine.
3. **A real WINDOWS-LIVE build and run**, watching `.github/workflows/windows-build.yml`'s first
   real execution particularly closely around its Inno Setup step.
4. **Real official provider logo assets**, sourced and licensed by a human maintainer, dropped into
   a `ProviderIcon`-shaped component still to be built.
5. **A settled, authoritative source for MiniMax-M3's context window** before adding it to the
   static catalog.

## 38. Final statement

This report is written to be falsifiable and specific rather than reassuring. Every "fixed"
claim above points at a real commit and a real, currently-passing test; every "not verified"
claim is stated as exactly that, not implied to be fine by omission. The honest verdict, restated:
**Vader's backend architecture and every subsystem this mission could reach are in real, tested,
production-grade shape - but "ready for daily use" as a whole product is not yet claimable, because
the two things that would make it claimable (a real model actually driving the app, and a human
actually seeing the app run) have never happened in any environment this mission had access to.**
