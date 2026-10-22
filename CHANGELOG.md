# Changelog

## Vader 1.0.0 — Production Release (2026-10-22)

- Follow-up installed-app audit: register the dynamically loaded embedding worker in both desktop build graphs and reject packages missing that entry. Worker startup/request failures now retain their cause, time out and terminate; disposal also covers idle restarts. A separate offline integration test runs the real worker against explicitly supplied local model assets; it is not an installed-app test.
- The files viewer watches disk changes, refreshes the selected file and tree, rejects stale reads and observes watcher errors. Files opened from another workspace root are watched too. FileService now publishes asynchronous watch-setup failures. The viewer remains read-only.
- Mouse clicks no longer inherit the classic blue focus frame; controls retain neutral keyboard focus and hover feedback. Settings mounts clean up after failure, preserve overlapping shell/onboarding state, and route editor Settings/Keyboard actions explicitly. Dropdown keyboard focus tracks the focused option, and unresolved model selections are distinct from Off. Selected agents can always be deselected; cached local model names no longer claim an unchecked/offline server is running.
- ACP startup reserves capacity across distinct concurrent chats, cancels startup and cold local verification when a chat closes, and tracks temporary programs for disposal. MCP tracks disconnects before publishing readiness, prevents HTTP timeout fallback leaks, skips queued starts during shutdown and joins application shutdown. Controlled subprocess/protocol regressions cover these paths; real vendor credentials and the rebuilt installed app remain unverified.

- Agent inventories now inspect local files without protocol/sign-in launches. Explicit Connect/Test/chat actions still run the agent. Installation polling is serial and stops on disposal; sign-in terminals are opened only by the requesting window. Repeated UI renders no longer restart installed-add-on discovery. Concurrent opens of one agent session share a single launch.
- MCP refreshes preserve disabled/review state, skip identical configuration, serialize per-server transitions, and close superseded clients. Existing connections publish their state to later windows and repeated enable requests without restarting. Tool failures retain their actual error message.
- The full-window shell starts at the first layout; its startup splash omits classic editor panels. Vader layers hide inherited titlebar menus and the window border while keeping window controls and keyboard focus available. Closing Settings preserves the shell layer. Completed onboarding unmounts; synchronous mount failures clean up and remain retryable.
- Background semantic indexing checks power holds before loading the code model. A model finishing after folder close is released and cannot start embedding. Added controlled service/browser regressions and local before/after failure evidence. Installed-app resource usage/native window behavior still require verification in a rebuilt app; no installer or release was built for these fixes.

- Added a standard-library Python command-evidence runner, acceptance-plan audit, tracked-diff review heuristics, and isolated adversarial regressions under `build/integrity/`. Repository instructions now distinguish static, harness, installed-app and real-model evidence. CI is configured to run the integrity tests; the new workflow step has not yet been executed on GitHub. No application runtime behavior or existing test expectations changed. See `docs/engineering-integrity.md` for limits and commands.

## Vader 0.2.0 - The interface of the design boards as the app (2026-10-21)

The whole interface is the one drawn on the design boards: the window with the chat, All agents, Add-ons, Settings and the first run; English, Arabic (right to left) and Chinese; drop-downs and the + button of the message box; no sample data anywhere. This version replaces 0.1.0.

- **Open in editor** no longer leaves for the classic VS Code layout: it opens a files page in the window's own design. Back at the top left, the folders and files of the project on the left, the chosen file on the right with its line numbers (reading only, no colours for the code yet; the agent does the editing). Files named in the chat, in the search and in Settings open there too. The classic layout is still in the code and is reached only by turning the window off (`vader.window.agentsFirst`).


- **After the owner tried the preview**: the **drop-downs of Settings and the first run** are drawn like the rest (a box with a chevron and a list with a check, over everything, with the keyboard) instead of the system's list; the **Model router page is gone** (the router still chooses the helper models by itself); **Add a model by name** is shown only for a provider that publishes no list of its own, since a provider with a key gives its live list; the **permission menu (Safe, Balanced, Autonomous) left the message box**, which is where Settings, Permissions already is, and a **+ at the left of the box** takes files and photos from this computer (the same as dropping them) and the project's context; the screen in English no longer watches the page at all (the translator is off), and in Arabic and Chinese it works in short passes; the chat with no project no longer shows three example questions. The preview folder is clean: no chats, keys, agents, skills, memory or usage.
- **Language of the screens** (Settings, Language; also on the first screen): English, Arabic (right to left) and Chinese. Every screen follows the choice on the spot; what a person or the agent wrote, code, paths and model names are left as they are; a text with no entry shows in English. See docs/integrations/language.md. **Get your key**: a small underlined link under the key box of each provider (Settings, Models, and the first run) opens the page where the key is made. The boxes no longer show example values. **Antigravity** is connected through Google's own ACP server (Antigravity ACP); checked live: it downloads, answers the handshake, offers its four sign-ins and says it is not signed in; Vader starts the Google account one. Live checks of the other agents pass; on Windows an agent's files could not be deleted while it was still stopping (uninstall now retries), the sign-in check gave up after 30 seconds on a cold start of OpenCode (now 2 minutes), and the live test could not run on Windows.
- **Second look at the whole window against the boards**: Settings frame and page widths as the boards (aside, search, page heads, rows of 34 and 44), Connected agents rows, Skills row actions (Read, Pin, Remove), the MCP servers note; **Add-ons** got the Source, Runs, Category, Needs and Sort drop-downs beside the search (only what the loaded items really have is offered), the notes of boards A03 and A05, and a real **Installed page** (board A07: back arrow, filter, a banner only when an update or a skill to read waits, a list per kind with a switch, Read and Update); install steps on an MCP server page are checks, the second install button has its frame; the **first run** panels are the ones of boards R22 to R24 (marks, what the chosen mode does as cards); **a button with a frame inside the window lost its frame** (the reset of `.vader-shell button` also cleared the border style of the utility classes), which hid the frame of Send again, Choose another model, Allow in this project; the error card no longer has a second "Open settings" under it. `test/fixtures/uiAudit.mjs` (set `VADER_AUDIT=file`) checks each photograph of the UI tests for a label off the middle of its button, text cut off, wrong plurals, doubled words.
- **The real window, looked at as one page** (`test/windowUiE2E.mjs`, the real window with the real chat and the real Add-ons page at 1440 x 900): it found a fault the pieces tested apart did not show, a long conversation pushed the message box out of the window (`.fl` had no `min-height: 0`). Fixed.
- **The chat as board R01** instead of the old Void chat: one column of 720 under the strip, your message in a quiet box with the files it names under it, reads and searches folded into one line ("Explored 3 files, read 2, searched 1"), the plan without a box and with marks, an edit as path, +n -n, Reject, Accept and its lines (no editor is started for it any more: `EditDiffLines.tsx`, numbered, the changed words marked), the checkpoint as a line, the message box as one object with its choices under it and cost, tokens and the branch under that, the files waiting for you as one quiet row with Reject all and Accept all. A long run no longer hides the top of the conversation.
- **The strip across the top of each page** (boards R01, R08, R22): the mark, the project (Open a folder, Open a recent project), Hide sidebar, and what the task changed (opens its review); in Settings the project and "Settings"; on the first screen the name. Drawn on Windows and macOS, where the system draws the window controls over the page; elsewhere the editor's title bar stays.
- **All agents tells the truth about each task**: the Model column shows the model the task ran with (kept on the conversation: `ThreadType.model`), not the one chosen now; the side panel lists the helpers the task started (Sub-agents: research, browser, verification, saved agents, parallel tasks); the filter also searches branches.
- **Terminals are named by what runs in them** ("dev server", "tests", "build"), with how each stands ("running, kept open by the agent", "finished, exit 0"); a command the agent stopped waiting for counts as running.
- **Add-ons as board A01**: the title, search, legend and tabs of the board, rows with the mark of the publisher where Vader has it (a plug for a server, the agent's own logo), the trust figure with its bar, one white Install; "See all skills / servers / extensions / agents"; a count of updates beside Add-ons in the sidebar when an extension has one (from the real list of what is installed; nothing is shown when there are none).
- **A new chat** says where it is ("New chat in vader-app") and what the mode does there; the box says "Describe the task". Privacy and network lists `.vaderignore` (how many patterns, Open, Create).
- **Edits report the problems they introduced** (`common/lintDelta.ts`) and the agent stops after three in a row it cannot fix; `.vaderignore` keeps files from the agent (`common/agentIgnore.ts`); the Folder chip of a message reveals it in the Explorer. Reviewed against the Agent package (`docs/integrations/agent-package.md`).
- **The gate says what it decided** (`common/gateModel.ts`, `GateCards.tsx`): cards for a command, a file outside the project, a page on a new site, installing a skill, an MCP tool and a rule of the person's own; refusals for a locked rule, an agent's own scope and a read-only mode. New rules: reading outside the project and a new host ask (a site can be allowed for the project), and private keys and stored logins are refused outright and cannot be switched off.
- **A key in a message is not sent** (`common/secretScan.ts`): it is taken out of the text and the card says which kind it looked like.
- **The message box**: one footer row, Thinking as a chip, Mode and Permissions menus with Ctrl 1 to 4, `/plan /review /compact /remember /init` calling the real services, `@` for files and, under Also, the terminal output, the open page and the git changes, text files dropped on the box (images are refused with the reason), the context ring with what the window is made of and Compact now, a chat bigger than the model's window said before it fails.
- **The model picker** has the states of board S04: providers without a key offered with Add, a list being asked for, a list that could not be fetched, nothing found; lists are asked for again when the picker opens if they are ten minutes old.
- **Looking back**: Redo from here under each message, a long command result folded with Show all, and a Checkpoints list with what each step changed (pick one to go back, two to see what changed between them).
- **Failures in words** (boards S07 and S14): an MCP server that did not start says what is wrong, with Edit the command and Try again; a connected agent that needs its sign-in or whose program stopped has its own card; a command says how it ended (exit code and seconds); the agent's browser says when a page stopped, changed or did not load. The real error is always under the words.
- **Parallel runs** (board R05) at the top of All agents: each task with its helper, branch, result and files, and for a conflict the three ways out (an agent merges them, keep the current version, keep the task's version) calling the real service.
- **Back up and restore** (board S11): everything of the person's own in one file without keys, a restore that only adds and says what it will add first, and a delete-all-chats question that says how many.
- **Settings from another editor** (board W02): each editor is looked at first (`inspectEditor`, nothing changed) and what it has is offered as a list to tick (theme and keybindings, the extensions list with its count, snippets), with Import and Not now; nothing is brought over silently.
- **Motion**: pages settle in, popovers and questions rise, hover changes ease and the switch slides, and none of it when less motion is asked for. Searching Settings offers the nearest places when nothing is found.
- **An edit that did not fit** says which part and that nothing was written, with Try again and Rewrite the whole file; the words for a browser failure are shown, not folded away.
- **Images in a message**: dropped, pasted or taken from the clipboard (`@`, Image from the clipboard), kept beside the message as small pictures, made smaller when large, and sent as the model's own image input (Anthropic, Gemini and OpenAI-compatible providers) only to a model that reads images; a model that does not says so by name and nothing is sent. The context counts them, the chat export names them.
- **Fixed**: the `@` menu showed absolute paths on Windows; a click on a row of the `@` menu could choose the row the mark was on; popovers of the message box were cut off by its frame; the answer text was 11 pixels.
- Tests: `chatUiE2E` (178), `pickerUiE2E` (26), `gateModelE2E` (21), `policyGateRulesE2E` (16), `slashCommandsE2E` (12), `contextSourcesE2E` (11), `attachmentRulesE2E` (14), `modelPickerE2E` (32), `runStateModelE2E` (32); the chat is also photographed at the width it has in the window.
- Honest limits: images cannot be attached; the packaged app was not run on this machine; a copy of the project per task, the checkpoint list, the MCP and browser states of boards S07 and S14 and the backup and update dialogs of S11 are not built yet.
- **A task's own copy of the project** (boards S06 and R01): in Agent mode the agent works in a git worktree on its own branch and your folder changes only when you merge it. Questions before it starts (not a git project, uncommitted changes), then Merge into main, Undo the merge, a conflict with three ways out (one of them an agent merging in the copy, shown file by file), a merge git refused because of your own changes (Stash my changes and retry), and Discard with what disappears said. New git operations run in the main process and are tested against real repositories; the conflict code is shared with parallel tasks. Turn it off in Settings, Permissions.
- **Updating Vader** (board S11): a newer release is offered with its notes, its installer is downloaded from GitHub with the progress shown (size and checksum checked, Cancel, a failure that says where it stopped), and Vader restarts into it on a click, now or when no task is working. About and updates shows the result of a check in the page itself. Windows only; nothing is installed without a click.
- **Settings set by an organisation** (board S10): a file an administrator owns (`managed-settings.json` under ProgramData, /Library/Application Support/Vader or /etc/vader) locks settings at the values it names; they show a lock mark with who set them and cannot be changed. Also fixed: a setting added in a newer version took no default for people who already had settings stored, so it was off or empty until they touched it.
- **Skills are used by task** (board S13): a skill is put in front of the model only when the message names it (`@pdf`) or fits what it says it is for; the others are listed by name and purpose. The message says "Used the skill pdf" and why, and that is exactly what was sent.
- **Compare two checkpoints side by side** (board S13): a file of the comparison opens as the two versions in two columns, changed lines marked, unchanged stretches folded.
- **A tool changed** (board S07): a tool an MCP server adds after you set it up is not given to the agent until you answer (Keep it off, Allow it, Remove the server), in the chat or in Settings, MCP servers; a call that names it is refused meanwhile.
- **A command waiting for input** (board S14): a command that goes quiet on a password or a yes/no question is shown as that, with what it asked and that the agent will not type it; the agent is told not to guess. At most six background terminals.
- **A sign-in page** (board S14): the agent's browser never types into a password, one-time code or card field; the chat says the page asks you to sign in.
- **Find code by what it does** (`codebase_search`): an index of the open project, made and kept on this computer (git-aware, Merkle tree of hashes so only what changed is read again, BM25 ranking over names and their parts, saved between starts, never reading files that hold secrets). Settings, Privacy and network shows its state and can turn it off. See docs/integrations/codebase-index.md.
- **Going back undoes files the agent made or deleted**, not only edits: a made file is removed (to the trash), a deleted one is written back with its text, and going forward does it again.
- **A task is blamed only for what it broke**: when a parallel task's checks fail, they are run again on the project as it was and the problems compared; a project that already fails its type check no longer refuses every task's merge.
- **`await_terminal`**: the agent waits for a dev server or a long build to print what it is waiting for (or to go quiet) in one step, instead of reading the terminal again and again.

## Unreleased - The interface of the design canvas, as the app: the Vader window, a first run in three steps, Settings in 14 pages, a chat that says what the run is doing

- **The Vader window** opens first (`vader.window.agentsFirst`, on by default): a sidebar of projects and conversations ("Needs you" first), the conversation with its Review, Browser and Terminal tabs, All agents, search (Ctrl+K), Add-ons, and Settings over everything. Open in editor goes to the editor layout and back. Review accepts and rejects a hunk, a file or all, sends a comment on a line to the agent, runs the checks and the independent check, and commits (`common/reviewModel.ts`, `vaderReviewService.ts`). Details and limits: [`docs/integrations/interface.md`](./docs/integrations/interface.md).
- **First run in three steps**: where the models come from (a key is saved and the provider is really asked for its models, with a message for 401, no network and a rate limit; a connected agent; Ollama and LM Studio found by themselves), the project and how much Vader asks (the real permission mode), a first task. Every step can be skipped; the step is remembered across the reload that choosing a folder causes.
- **Settings in the 14 pages of the boards** (`react/src/vader-settings-tsx/`, the old page is gone): Models (45 providers, Test connection, Refresh models, a switch and the context size for each model, defaults you can override), Model router, Connected agents, Permissions, Usage and cost (a ledger per model for 62 days; every number says whether it is an estimate, billed by the provider, free or unpriced), Saved agents, Skills, MCP servers, Memory and instructions, Editor extensions, Editor, Privacy and network, Data and backup, About and updates. A number that cannot be used is refused in words; a key can be removed; Editor settings can be reset after a question.
- **The chat**: stopped by you (what it was doing, Continue the task), paused, finished with changes, messages that wait their turn (Send now), a conversation getting full (the real thresholds, Summarise now, a new chat with a summary), no model, a long paste folded to one line, offline, a new chat in a project and without one. Looking back: Branch the chat, going back to a checkpoint asks first, rename, export as Markdown, delete after a question.
- Tests (all headless, no window opened): `shellUiE2E` (86), `onboardingUiE2E` (47), `settingsUiE2E` (214), `chatUiE2E` (80, the real chat component), `shellModelE2E` (28), `runStateModelE2E` (25), `chatExportE2E` (12), `settingsInputE2E` (8), `usageAccountingE2E` (46). The real-app suite runs in the editor layout by default and has a group for the window (`test/e2e/scenarios/shell.mjs`).
- Honest limits: the packaged app was not run on this machine (only the Windows build can); a copy of the project per task is used for parallel tasks only; images cannot be attached; the Browser tab cannot take over the page; a queued message is sent after the run, not after the step. See `docs/integrations/interface.md`.

## Unreleased - Add-ons: a page for every item, sections, more sources

- **Every skill, MCP server, extension and agent has its own page**, opened by clicking its row (the Install button on the row still installs without opening it) (`react/src/vader-marketplace-tsx/ItemPage.tsx`). The page is built like boards P01 to P04 of the design canvas: header with logo, name, publisher (and the verified mark), sections and the sources it was found in; tabs; on the right an install card, the trust card with its reasons, and the facts; and "More in this section" at the bottom, which opens the other page in place. Each kind is arranged for what a person needs to decide: a skill shows what its text asks for (terminal, network, files) and the first lines of SKILL.md; an MCP server shows where it runs and what leaves this computer, what it needs first and the exact mcp.json entry; an extension has rating, installs, version and last update up top; an agent has three steps from install to a working chat and says who counts the cost.
- **Sections for each kind** (`common/marketplace/categories.ts`): skills, MCP servers and extensions each have their own list of sections under the tabs (extensions use Open VSX's own categories); an item is placed by what its sources say and by its name and description, in at most two.
- **More live sources**: SkillsMP and Smithery skills for skills, Docker's MCP images for MCP servers, and Open VSX asked directly (with categories) for extensions, besides the sources of the entry below. Every source can be switched off in Settings; a source that does not answer is named on the page while the rest still show.
- **Agents are listed as Add-ons** (`browser/marketplace/providers/connectedAgentsProvider.ts`): all ten connected agents with their vendor's logo, their state and the install or "Set up" button.
- **Fixed**: installing from a row or a page failed because the provider methods were passed on unbound; the list showed the old state for 30 seconds after an install (the provider's cache is now cleared); a partial answer was cached as if complete (now kept 15 seconds); an install error was silent on a row (now shown); the page closed itself after an install changed the item's identity; the install button was transparent in the real theme; "Installed 44418K times" now reads 44M.
- Tests (all headless, no window opened): `addonsProvidersE2E` (the real providers and the real federating service on saved responses, 67 checks), `addonsUiE2E` (the built page in headless Chromium: tabs, sections, each kind's page, install, back, the keyboard, sources that fail or are slow, layout checks on every page, 62 checks); both in CI.
- Honest limits: the packaged app was not run; GitHub allows 60 requests an hour without a key; the MCP registry is sometimes slow (the page says so); an MCP server found only through a GitHub topic shows "Open" because nothing there says how to run it.

## Unreleased - Add-ons: live sources, a score that is computed again, marks and a white Install button

- **Skills and MCP servers come from several live sources at once** (`browser/marketplace/providers`): skills from the GitHub repositories kept as sources (anthropics/skills and openai/skills by default; the hidden .curated folders where openai keeps its skills are now read), skills.sh, GitHub repositories tagged agent-skills, and SkillNet; MCP servers from the official registry, Smithery, npm and GitHub repositories tagged mcp-server. The same skill or server found by two sources is one row. Each source is switched on or off in Settings (Skills > Sources, MCP); one that does not answer is named on the page while the others still show. The Extensions tab also lists the editor tooling (language servers, debuggers, formatters). The tabs show no counts: they would only be the count of whatever answered first.
- **The trust score is computed from live signals, every time** (`common/marketplace/trustScore.ts`, `common/discovery/feedParsers.ts`): last change, archived or deprecated, licence, installs, weekly downloads, CI provenance, a script that runs on install, how many sources list it, a name that copies a well-known one, plus what a skill's own text asks for. Opening an item asks its sources again; `browser/trustMonitor.ts` scores what is installed again a minute after start and every six hours, and says so when a score falls by ten or into red; Settings shows "was 87% the first time".
- **Add-ons look**: new marks for Add-ons (three blocks and a plus) and Settings (a square-toothed cog), a white Install button, "Installed" and "Installing" in words, Open for a repository that says nothing about how to run it.
- **Connected agents checked against what the vendors publish** (`test/agentCatalogE2E.mjs`): Cursor is started as `agent` as its documentation says (`cursor-agent` is still looked for), the registry snapshot moved forward (Grok Build 1.0.55 to 1.0.58, Antigravity 1.3.0 to 1.4.0), and three catalog notes were corrected (Copilot's ACP support is a public preview; the Mistral and Grok plan wording).
- Tests: `liveSourcesE2E` (41, the parsers run on real saved responses, the new score signals, the history rules; `--live` also asks the real services), `agentCatalogE2E` (15, and 16 more with `--live`, which checks the registry versions). `tsc` shows no error in Vader code and the UI bundles. **Not run: the packaged app, and the E2E scenarios.** The MCP Registry did not answer within ten seconds while this was written, GitHub's 60-calls-an-hour limit was reached during testing: both are shown on the page, not hidden.

## Unreleased - Add-ons from the main interface, and a cost that says where its number comes from

- **Add-ons** (new page, `browser/vaderAddonsPane.ts`, `react/src/vader-addons-tsx`): the place to find skills, MCP servers, editor extensions and agents is now a button in the title of the chat (and in the gear menu, and "Vader: Open Add-ons" in the command palette), not a tab inside Settings. One search box, a tab per kind, rows two to a line with a round install button, the details and the reasons for the trust score on the right, an "Installed" switch. The Extensions tab lists the most installed extensions of the gallery before you search (`extensionGalleryProvider.browse`). Nothing was added to the network list: it is the same sources as before.
- **Settings keeps the inventory**: the Skills page lists, switches, updates and removes the skills this computer has (and their sources); the MCP page lists the servers that are set up. Both have a button that opens Add-ons. The store that used to sit inside those two pages is gone from them.
- **The cost line says where its number comes from** (`common/usageAccounting.ts`): when the provider reports what it charged (OpenRouter's `usage.cost`) that amount is used and shown plainly ("billed"); every other amount is a calculation from list prices and is shown with "≈". Tokens are shown first. A model with no price is still "unpriced", never $0. Anthropic cache writes are now priced at the cache-write rate instead of the input rate (a stated limit of the first version). Settings, Spending: links to each provider's own usage page, a percentage taken off list prices (a discount), and your own price for a model Vader has none for. These change the estimate only, never what is charged. The daily limit counts the estimate and says so.
- Tests: `usageAccountingE2E` grew from 23 to 41 checks (billed vs estimate, cache writes, discount, own prices, split between billed and estimated in a task and in a day, the approximate sign, a cost field from a server other than OpenRouter is not taken as a charge). `tsc`: no error in Vader code; the UI type-checks and bundles. **Not run: the packaged app, and the E2E scenarios.** The OpenRouter transport itself (it has a fixed address) is not exercised by a test; its parsing is the same code the simulated server run covers for other providers.

## Unreleased - What the interface already showed, now in the app: cost, projects, pause, project approvals, conflicts

- **Cost of a task and of a day** (`common/usageAccounting.ts`): token counts are read from OpenAI-compatible, Anthropic and Gemini answers (OpenAI-style servers on a short list are asked for them with `stream_options.include_usage`; any other server's counts are read if it sends them). A turn is priced with the model's list price; a local model is free; a cloud model with no known price is counted as "unpriced", never shown as $0. Each thread keeps its total, a ledger keeps the last two months by local day. An optional **daily limit** (Settings > Permissions and saved agents > Spending) pauses a running task before its next request and asks. The chat box shows "$0.31 this chat" and "$2.14 today".
- **Pause and Resume** hold a run at its next request or tool call; Stop or deleting the thread releases it. Going on after the daily limit is the person's decision and holds for the rest of that day.
- **Conversations under their project** (`common/threadProjects.ts`): a thread remembers the folders open when it began, the chat list groups by project (the open one first, older threads under "Chats") and marks conversations that wait for you, work, are paused, stopped by an error, or have changes to read (`common/threadStatus.ts`).
- **Allow in this project** (`common/policy/projectApprovals.ts`): approves a call and stops asking about that exact command (the whole line, spaces collapsed, never a pattern) or MCP tool in that project. It is only consulted when the Policy Engine has no objection, so keys, installs, sudo, force-push and the rest still ask every time; it is listed and revocable in Settings.
- **A comment on a line of the agent's change is sent to the agent** (`common/reviewComment.ts`, `addReviewComment`).
- **A conflicting parallel task** (`gitWorktreeMainService.ts`): the failure now names the files both sides changed (any other merge failure is reported as one, not as a conflict). The person can keep the current version, keep the task's version (lines only one side changed are merged either way), or have an agent merge the two inside the task's worktree first. Found on the way: a task whose agent had committed its own work was reported as "no changes" and never merged; fixed. Branch names are refused when they could be read as a git option.
- **Trust score for extensions** from what the gallery says (verified publisher, installs, ratings), with the same reasons as skills; a skill can now be installed and switched on in one step unless its score is low; a word (High trust, Read first, Risky) sits beside the percentage so colour is never the only signal.
- **Settings:** a search box over the menu, clearer names (Connected agents for the programs of other companies, Permissions and saved agents). **First run** asks how much Vader should ask before it acts (the permission mode).
- Tests: `usageAccountingE2E` (23, the real transport against the local simulated provider), `agentOverviewE2E` (29), `worktreeConflictE2E` (24, real git), `marketplaceTrustE2E` (29); all in CI. `tsc` shows no error in Vader code and the chat/settings UI type-checks and bundles. **Not run: the packaged app and the E2E scenarios** (the first-run and settings scenarios were edited for the new names but not run).
- Honest limits: the cost counts only what the providers report (Anthropic cache writes are priced at the plain input rate); sub-agent and verification threads have their own totals and are not added to the parent's; the pause holds between steps, not in the middle of a model answer.

## Unreleased - A skills store and an MCP store, with a trust score on every card

- **What the owner asked for:** a skills page in Settings that works like an extension store (an icon, a name, the size, a trust percentage in red, yellow or green, an Install button), fed by several repositories, and an MCP page where a server is added from the registry.
- **Skills page (Settings > Skills):** Store, Installed and Sources tabs. The store lists the skills of every GitHub repository kept as a source (default `anthropics/skills`: 19 skills read live in 1.8 s with their real folder sizes) and searches SkillNet when something is typed. A card opens a detail pane: why the score is what it is, what the skill asks for, and its SKILL.md. Installing stores it switched off and `review_required`, as before. Sources can be added (an `owner/repo` or a github.com address) and removed.
- **The score** (`common/marketplace/trustScore.ts`): an explainable heuristic from 0 to 100, 80 and up green, 50 to 79 yellow, under 50 red. It starts at 70 and moves with the publisher (a short list of known organisations), stars, what the instructions ask for (terminal, network, files, MCP) and patterns common in malicious skills (a download piped into a shell, sudo, broad deletes, decoded text, invisible characters, "ignore previous instructions"). Every point has a reason shown to the user. **It is not a security scan**: the Policy Engine still checks everything the agent runs, and an explicit user decision (trusted, blocked) wins over the score.
- **MCP page (Settings > MCP):** below the servers already configured, a store over the official MCP Registry. The registry lists every version of a server and lets anyone publish one named "github"; the main process now keeps only the latest version of each, and the featured list keeps only results published by a known organisation.
- **Same cards in the Extensions view:** the narrow Vader pane there (skills, MCP servers, coding agents, language servers...) uses the same cards and detail pane instead of a plain list. Open VSX extensions stay in the native Extensions view, which is untouched.
- **New plumbing:** `IDiscoveryMainService.listGithubSkills` (GitHub's public API, cached 10 minutes because 60 unauthenticated calls an hour is the limit), `IUnifiedMarketplaceService.browse` (what a store shows before anyone types), `ISkillService.listSources/addSource/removeSource`, and `trustScore`/`sizeBytes` on marketplace items.
- **A bug found while checking it in a browser:** the build that scopes Tailwind to Vader's UI renames the classes it finds inside `className` attributes but not ones kept in a constant, so colours stored in an object would have had no style in the app. The score colours are written inline.
- **A gap in the privacy page, fixed:** Settings > Privacy & Network and docs/integrations/privacy.md never named SkillNet, the MCP Registry or GitHub's API, although the agent's own search tools already used them. They are listed now. SkillNet is reached over plain HTTP, which is how that index is published; the page says so.
- Tests: `test/marketplaceTrustE2E.mjs` (24 checks, in CI): the score, its colours, and how a repository's skill folders, sizes and front matter are read from a real file tree. The store component was also rendered in a browser from the real source against the live `anthropics/skills` listing. **Not seen inside the packaged app yet**, and the install and add buttons were not pressed against a real profile.

## Unreleased - A project's AGENTS.md (and CLAUDE.md) is read like .vaderrules

- **The gap:** Vader read only `.vaderrules`. `AGENTS.md` is the convention shared by Codex, OpenCode, Cursor, Copilot, Cline and others, and `CLAUDE.md` is Claude Code's; a project that already had one of them gave Vader nothing. Now, per workspace folder, the first of `.vaderrules`, `AGENTS.md`, `CLAUDE.md` is used (`common/instructions/workspaceRulesFiles.ts`), cut at 24,000 characters with a note, framed as possibly written by someone else (it guides, it never grants permission), and picked up when created after the folder was opened.
- The policy rule that asks before the agent edits the files that steer later turns now covers `AGENTS.md` and `CLAUDE.md` too (an agent asked to write one will ask for approval, as for `.vaderrules`).
- Tests: `test/workspaceRulesE2E.mjs` (10 checks, in CI).

## Unreleased - Provider gateways checked against the real servers

- **Every gateway probed live (2026-10-13, no key, nothing sent but empty requests):** `GET {endpoint}/models` and `POST {endpoint}/chat/completions` for all 29 vendor providers and the 6 hosted original ones with a fixed address (OpenAI, xAI, DeepSeek, Groq, Mistral, OpenRouter), plus MiniMax, Alibaba, Moonshot, OpenCode Zen, Anthropic's and Gemini's native routes. The data had been recorded from documentation only because the build sandbox could not reach these hosts. Result: every host answers, 401/403 means the route exists and wants a key.
- **Removed Hyperbolic:** its serverless inference API is retired (`api.hyperbolic.xyz` answers "This inference endpoint has been decommissioned", and its docs say so). The provider would have shown a working-looking entry that cannot answer. 48 providers now. Hyperbolic's models are still reachable through the Hugging Face router.
- **Perplexity has no `/models` route** (HTTP 404 on 2026-10-13): this is already handled (the app says it has no list it can ask for and takes a model added by name); kept as it was.
- **Coding agents checked against the live ACP registry** (`cdn.agentclientprotocol.com`, 41 agents, the same file the app reads at runtime): the eight agents Vader offers over ACP all exist in it and their launch arguments match Vader's local-launch settings (`opencode acp`, `cursor-agent acp`, `copilot --acp`, `grok agent stdio`, `kimi acp`, `vibe-acp`). All 28 download archives answer 200; the npm packages exist; Claude Code's installer scripts answer 200. The bundled snapshot was two patch releases behind for Copilot CLI (1.0.95 -> 1.0.97) and Grok Build (1.0.52 -> 1.0.55) and was regenerated. Note: `@xai-official/grok` 1.0.55 is on npm's `alpha` tag (the stable `latest` is 1.0.52); the registry verified it, and the app reads the registry live, so this is the registry's choice, flagged here.
- Cloudflare Workers AI needs the person's account id in the endpoint (`.../accounts/ACCOUNT_ID/ai/v1`): a placeholder answers 404 until it is replaced, by design.

## Unreleased - The model picker in the chat box: providers that open into their models, with logos and search

- **What the owner asked for:** with one provider set up, the picker shows that provider's live list of models; with several, it shows the providers and a click on one opens its models; every provider shows its real logo, in Settings and in the small picker.
- `ProviderModelPicker.tsx` replaces the flat list (it used to print every model with its provider's name at the right): one provider -> its models directly, with a footer naming the provider and the count; several providers -> one row per provider (chevron, logo, name, number of models), the chosen provider open, one open at a time; a search box appears above 8 models and searches model names and provider names across all providers (words in any order, case and `- _ : / .` ignored; the matches stay under their provider); the closed button shows the provider's logo and the model; arrow keys, Escape, rows are real buttons with listbox roles. It is used for every feature that picks a model (chat, autocomplete, apply, commit messages). Logos are the existing real ones (`providerLogoData.ts`, 49 providers, generated from lobe-icons and models.dev, one colour so they follow the theme).
- The arrangement is a pure module (`common/modelPickerGroups.ts`); the component takes plain props, so it was rendered standalone in a browser from the real source and checked by screenshot before anything was built. A saved model choice that is no longer offered still moves to the first model offered (as before).
- Tests: `test/modelPickerE2E.mjs` (25 checks, in CI; 800 models search in well under 16 ms). **Not seen inside the packaged app yet.**

## Unreleased - A map of the repository (tool `repo_map`)

- **The gap:** the Context Engine only knows the files the person mentioned or has open; in a large project the agent had to find its way by searching and reading, which Aider's repo map, Continue and others answer with a ranked overview.
- **New tool `repo_map`** (`common/repoMap.ts`, tool in `browser/toolsService.ts`): definitions are found per line for TypeScript/JavaScript, Python, Go, Rust, Java, Kotlin, C#, Scala, Swift, Dart, Ruby, PHP, C and C++ (no parser, no wasm, no native module); files and the names they define form a graph (a file points at the files that define what it mentions), PageRank orders the files, a word found in more than 12% of the files is ignored as language, not a pointer, and the result is cut to a token budget (default 2,500 tokens, at most 8,000). `focus` (files or folders) moves the task's files up and lists more of their definitions. It is a tool the agent calls when it needs it, not text added to every turn, so a small task pays nothing. Idea from Aider's `repomap.py` (Apache-2.0), reimplemented; no code copied.
- Bounds: 6,000 files listed, files over 300 KB skipped, reading stops after 10 s (the answer says when that happened). Read-only, no approval; offered in Gather and Plan mode too.
- Tests: `test/repoMapE2E.mjs` (44 checks, in CI): every language's patterns, ranking on a small project, budgets, and Vader's own 216 source files (built in under 100 ms; the files the rest depends on come first). Two real-app scenarios (`scenarios/core.mjs`) call `repo_map` and `update_task_list` end to end; **they could not be run here**, the Windows E2E will. The tool count is now 39.
- Honest limits: line patterns are less exact than a parser (a method written over several lines, or a definition behind a macro, can be missed); the ranking was judged by eye and by a test on Vader's own tree only; whether the map makes the agent finish more tasks is not measured.

## Unreleased - A task list for long jobs

- **New tool `update_task_list`** (`common/taskList.ts`): the agent writes its whole list on every call, one task per line marked `[ ]` / `[~]` / `[x]`, keeps one in progress and marks each done when finished and checked; the result is shown in the chat (the generic tool card) and echoed back to the model, with a nudge when two tasks are in progress, none is, or all are done ("check the result, then report"). Plain lines instead of JSON because small models write them reliably; many spellings of the marks are accepted. The idea is the todo tool of opencode (MIT), Roo Code (Apache-2.0) and Codex `update_plan` (Apache-2.0); text and format are Vader's own.
- It needs no approval (it changes nothing but the conversation), is also offered in Gather/Plan mode, and its results are exempt from the pruning of old tool output. The instructions tell the agent when to use it (several steps or files) and when not (a small task).
- Not done: a dedicated progress panel (the list is shown as an ordinary tool card, and the newest one is the current one); a persistent per-thread field would need a format change for saved chats.
- Tests: `test/taskListE2E.mjs` (21 checks, in CI). The tool count is now 38.

## Unreleased - A model name Vader does not know gets native tool calling, with a fallback

- **The defect (from the benchmark):** a model whose name Vader does not recognise (a new release, a fine-tune, a local tag, a gateway alias; common now that model lists are live) was sent its tools as XML written into the prompt. A weak model answers with JSON text and nothing runs; the same model passed under a name Vader knew.
- **Now** (`common/toolSupport.ts`, `common/modelCapabilities.ts`): such a model is offered the provider's native tool calling first (OpenAI format for every provider except Anthropic and Gemini, which have their own). If the server refuses the `tools` field (Ollama "does not support tools", OpenRouter "No endpoints found that support tool use", vLLM "--enable-auto-tool-choice", LiteLLM, ...), `VaderAgentModel` holds the error back, the model is switched to XML (`specialToolFormat: null` in that model's overrides, so it is remembered and survives restarts) and the request is sent again once, with the full tool list in the prompt. Key, credit, rate and context errors are never taken for a refusal; an error after some output is not retried; a model configured by hand is never switched.
- Known side effect: a message that mentions tools and a refusal but is not one would switch a model to XML for good; there is no screen for the override yet (it lives in the settings file under `overridesOfModel`).
- Tests: `test/toolSupportE2E.mjs` (32 checks: what counts as a refusal, what each model is offered), `test/nativeToolFallbackE2E.mjs` (9 checks: the retry with fake services), both in CI; two real-app scenarios replace the old unknown-model one (`test/e2e/scenarios/xml.mjs`; **they could not be run here**, the Windows E2E runs them); `vendorProvidersE2E` now expects native tools for a model the catalog does not list.

## Unreleased - Edits land where the model meant them

- **Two silent defects in how an edit was located** (found by reading `editCodeService.ts` against other editors' edit tools): an exact match was never checked for uniqueness, so a search text that occurs three times edited the *first* one; and the replacement was always whole lines, so ORIGINAL `timeout: 5000` inside `const opts = { timeout: 5000, retries: 3 }` turned the entire line into the new fragment. `common/editMatching.ts` `locateEdit`: an exact match replaces exactly the characters that matched and must be unique ("Not unique" tells the model to add context); when there is no exact match, one tolerant step is tried: the same lines compared without whitespace and with typographic quotes, dashes and non-breaking spaces made plain, in order, unique. No similarity scores and no anchors: opencode dropped its looser cascade because it edits the wrong place.
- **Block markers written a little differently are understood** (`normaliseBlockMarkers`): `SEARCH`/`OLD` for ORIGINAL, `REPLACE`/`FINAL`/`NEW` for UPDATED, another number of `<` or `>`, spaces, Windows line ends. "No Search/Replace blocks were received" was the most frequent edit failure in the benchmark runs. A line of `=====` is left alone (it can be a Markdown heading). Streaming stays monotonic (checked character by character).
- Tests: `test/editMatchingE2E.mjs` (33 checks, in CI). The streaming Ctrl+K/Apply paths keep the old `findTextInCode`.
- Not measured with a real model: whether these edits fail less often in a benchmark run.

## Unreleased - A model that repeats the same text is stopped

- **Text-repetition guard** (`common/loopDetection.ts` `TextRepetitionDetector`, hooked into the agent loop for the answer and for the reasoning): small and local models sometimes chant one sentence until the output limit; they make no tool call, so the call-based guards never saw it. A 50-character window that comes back 12 times at short intervals **and** a text tail that is periodic (the idea is Gemini CLI's "chanting" check, Apache-2.0, reimplemented with the periodic-tail condition added) stops the run with a message that quotes the repeated text.
- Windows made of one or two distinct characters (rules, indentation) never count. The first version, without the periodic-tail condition, flagged 3 of 255 of Vader's own source and doc files (repeated boilerplate), which is the reason for that condition; now none are flagged, and a chant is caught within 15 repeats.
- Tests: 12 more checks in `test/agentRobustnessE2E.mjs` (in CI).

## Unreleased - Long sessions: old tool output is pruned and the summary now comes before the blind cut

- **Found by reading the code against the engine review (`docs/research/agent-engine-assessment.md`):** the three safeguards against a full context window used different yardsticks, and the worst one fired first.
  The blind cut in `convertToLLMMessageService.ts` (it shrinks a message to 120 characters, no way back) started at **half** of the window, because the reserve for the answer was `contextWindow / 2` while the comment said a quarter.
  The careful summary started only at 70% of the window, and measured every tool result as at most 2,000 characters, so a thread full of file reads looked small to it.
  Simulated on a tool-heavy session (600 steps, 32k to 1M windows) the old rules sent a request over the blind-cut line in 71% to 98% of the steps.
- **One yardstick, three steps** (`common/contextBudget.ts`, pure): from 50% of the budget the output of *old* tool calls is replaced by a one-line note (no model call; the newest quarter of the budget and the last 8 messages are kept; only when it frees at least 8%, so the provider's prompt cache is not broken for nothing);
  from 70% (measured after pruning, on what is really sent, system prompt included) the older messages become the structured summary; the blind cut stays as the last resort above 100%, and the reserve is now a quarter of the window as its comment always said.
  The chat keeps showing the full tool result: only what the model is sent changes (`outputPruned`, an optional field on tool messages, so saved chats stay valid). The pruning idea follows opencode's session compaction (MIT), reimplemented.
- Tests: `test/contextBudgetE2E.mjs` (31 checks, in CI), including a 600-step simulation for four window sizes in which the request never exceeds the budget.
- **Not measured with a real model yet:** the effect on task success in long sessions. Run the benchmark before and after (`docs/integrations/agent-benchmark.md`) before calling this an improvement in quality; the mechanism itself is tested.

## Unreleased - Security audit, second pass: path fuzz and the browser's redirects

- **Path spellings at scale.** A seeded fuzz of 4,000 spellings of protected files (case, trailing dots and spaces, `::$DATA`, `./`, `//`, `..` detours, slashes) got 1,264 through on the code before the earlier fixes, among them deletes of a system file the locked rule exists to block; 0 after. `test/policyPathFuzzE2E.mjs` runs it in CI.
- **The agent's browser follows redirects.** The address policy was checked only when the model named a URL: a page that redirected to `http://169.254.169.254/...`, or a link or script the model triggered, ended somewhere the policy does not allow and its text was given to the model. Every snapshot and screenshot now re-checks the page's address and resets the page if it is not allowed (`browserToolMainService.ts`). Not exercised against a live page.
- Examined and found sound (details in `docs/integrations/security-scan.md`): API keys at rest (not plain text in any file of the app's data folder), the external-agent installer, the update checker, the Electron window setup. Accepted: SkillNet answers only on plain http (results are untrusted by design, installs need an approval).

## Unreleased - The agent's instructions rewritten from the published guidance

- **New agent behaviour** (`common/prompt/agentBehavior.ts`, wired into `chat_systemMessage`): nine short tagged sections instead of the flat "Important notes" list inherited from upstream. Built from OpenAI's Codex prompting guide and Codex CLI's prompt, Anthropic's prompting guidance for Claude, Claude Code's published prompt fragments and Anthropic's context-engineering and tool-writing articles (sources and the reasoning for every choice, including where they disagree: `docs/integrations/agent-behavior.md`). Persistence until the task is verified and reported, minimal-change rules, no special-casing to pass a test, a verification loop that stops after the same fix fails twice, git safety on a worktree that may hold the user's own work, no way around a block, outside text is data, an outcome-first honest report. Calm wording: emphatic ALWAYS/NEVER makes current models over-trigger. Removed: "ALWAYS have maximal certainty", "ALWAYS use tools" and similar, which push a model to over-explore.
- **Tool descriptions rewritten where it matters** (edit_file and its block format, rewrite_file, read_file, the two search tools, the terminal): `read_file` no longer tells the model not to use line ranges; `rewrite_file` no longer says "use it to edit a file you just created"; the edit tool says what to do when a block is rejected.
- Gather and Plan modes: the rule that outside text is information, not instructions.
- Tests: `test/agentPromptE2E.mjs` (54 checks, in CI). Measuring: `test/e2e/promptSwap.mjs` runs an installed Vader with the source's instructions (A/B on the same binary, model and exercises); `polyglotBench.mjs` takes `POLY_PROMPT=app|source`. **Not measured yet**: a prompt change can make a model worse; release it on the A/B result, not on the review.

## Unreleased - Agent-specific security audit: the path rules now see terminal commands

- **Found by attacking the real Policy Engine** (rules, request mapping, URI class and resolved-path step bundled from source): the "credential file" and "files that run code later" rules only ever looked at the file tools. A terminal command carried its text and no paths, so `cat ~/.ssh/id_rsa`, `curl -d @.env ...`, `echo x >> .vscode/tasks.json`, `cp evil .husky/pre-commit`, `Set-Content`, `tee`, `sed -i` and `git config core.hooksPath ...` passed every rule, in the autonomous mode where those rules are meant to be the last line of defence. 27 of 27 attempts got through.
- **Fix:** `common/policy/commandPaths.ts` lists the path-like words of a command (home/profile shorthands expanded, quotes and obfuscation normalised as before) and which of them it may write (redirections, cp/mv/tee/sed -i/Set-Content/curl -o, git add...; plain readers excluded). The two rules now also cover `terminal-command`; a new rule `vader.ask.git-program-config` asks before a Git option that names a program to run (hooks path, fsmonitor, ssh command, pager, credential helper...). Still a best effort over a shell string: indirection (`$(echo ~/.ss)h/id_rsa`) and paths built at run time evade it; a sandbox is what closes that.
- **Windows spellings of a protected name** (`tasks.json.`, `tasks.json `, `tasks.json::$DATA`, a trailing dot on a folder) matched no glob, and the real-path step cannot correct a file that does not exist yet. `canonicalWindowsAlias` adds the canonical spelling to the paths the rules see.
- Tests: `test/policyCommandPathsE2E.mjs` (157 checks, in CI), including ordinary commands that must not be stopped. Known side effect: `git log -p .env.example` asks, as reading `.env.example` through the file tool already did.
- **Download-and-run now asks in autonomous mode too, and knows PowerShell.** The rule only matched `curl x | sh`; it now also matches `iwr/irm ... | iex`, `Invoke-Expression (...DownloadString...)`, `bash <(curl ...)`, `sh -c "$(curl ...)"` and `curl ... | powershell`. Behaviour change: `neverBypassAutonomous` is now true for it (it was false, so a prompt-injected model in autonomous mode could run a downloaded script unasked).
- **New rule `vader.ask.dump-environment`:** the terminal inherits the environment Vader started with, where people keep API keys. `printenv`, `env`, `Get-ChildItem Env:`, `echo $OPENROUTER_API_KEY`, a one-liner that prints `process.env` or `os.environ` now ask (harmless variables such as `PATH`, `HOME`, `NODE_ENV` do not).
- **The approval card showed one clipped line of a terminal command** (`Run terminal "echo harmless curl...`): a second line, or a long padded command, hid its dangerous part, and an MCP card showed the empty result instead of the arguments. Shown by driving the real app with a scripted model and screenshotting the card. The card now opens with the whole command in a scrollable block (and the full text as the tooltip); the MCP card opens with its arguments. New E2E scenario `terminal: the approval card shows the WHOLE command`. Not yet seen in a rebuilt app.
- **Planted instructions are framed.** Text from `.vaderrules` (written by whoever authored a cloned repository) and saved memory notes (the model saved them, perhaps after reading a hostile page) entered the system prompt like the user's own words; memory as "established facts". They are now introduced as possibly written by someone else and never a permission to run commands, change settings, read secrets or send data. Wording only; the policy engine still decides what runs.

## Unreleased - Measuring the agent, and three robustness fixes it exposed

- **A public-style benchmark through the real app.** `test/e2e/polyglotBench.mjs` runs Aider's polyglot exercises (225 Exercism exercises in six languages, two attempts, graded by the tests in Docker) through the packaged Vader, with a local cost-guarded proxy (`llmProxy.mjs`) and a grader check against the reference solutions (`polyglotOracle.mjs`). Method, protocol differences from Aider, first results and their limits: `docs/integrations/agent-benchmark.md`. First readings are small-sample and not comparable with Aider's leaderboard yet.
- **A file argument written as `path`/`file_path` is understood** (`common/toolArgAliases.ts`): it failed with "Provided uri must be a string".
- **A call to a tool that does not exist is answered with the real tool names and the one that was probably meant** (`common/toolNameHints.ts`), instead of "Unknown tool: shell".
- **A loop that alternates between a few calls is stopped** (`common/loopDetection.ts`): the "same call 8 times in a row" guard never caught `cd build` / `cmake ..` / `cd ..` going round.
- Tests: `agentRobustnessE2E.mjs` (30 checks, added to CI). The test harness picks a free debugging port (two parallel runs could attach to each other's window).
- Not done, found by the same runs: unknown model names on the OpenAI-compatible provider get XML tool calls in text; `&&` fails in Windows PowerShell 5.1; `Edit file` sometimes receives no Search/Replace blocks.

## Unreleased - Sharper logo and icons, calmer dark interface

- **Logo and icons from a clean source.** The original artwork (1280 px, JPEG) was run through Real-ESRGAN x4, an open-source super-resolution network; the result
  (`brand/source/logo-black-x4.png`, 4864 x 3032 px) is now the source of every generated asset: the app icon (all sizes in the `.ico`), installer images, favicon, the in-app
  logo, and the vector logo (re-traced from the clean master, with about four times more edge points). The app icon is the **whole logo** (ring and both wings) on a black square, as
  before; below 64 px it is drawn 16x oversampled with firmed-up edges, so thin strokes stay visible instead of turning grey. `build/lib/vader/make_brand_assets.py` regenerates everything.
- **Calmer dark interface, same identity.** The editor base's own *Modern UI* layout (floating rounded panels with gaps) is on by default, and `media/vaderPolish.css` refines the dark theme: a dimmer window
  frame, quieter edges, the chat request as a card, soft tool-call rows, checkpoints as a hairline, a larger floating composer, settings cards with a status dot and a divided action row, grouped model list.
  Same greys, same blue, same fonts and logo; the send button is unchanged. Everything is scoped to the dark theme: light and high-contrast themes keep their own look. "Modern UI" can be switched off in Settings.

- **A clean start for the first public release.** Settings (welcome state, model picks, stored model lists, API keys) and chat history moved to new storage keys (`...III`), so an earlier pre-release install no longer decides what the new
  one shows: the welcome screen appears, no old chat comes back, and the old keys are deleted from disk on startup. A chat that was closed while a tool request still waited for approval now opens with that request closed as rejected
  (before, the thread stayed locked on an approval that belonged to a run that no longer existed and a new message could not be sent). The real-app suite covers both on Windows.
- **No model names written into the app.** Every provider starts with an empty list: what can be picked is what the provider itself says the key may use (all vendor providers now ask their own `/models` route, GitHub Models its catalogue route),
  what a local server reports, or a model added by name. A provider with no such route says so (HTTP 404/405/501 -> "no model list that Vader can ask for") instead of showing a built-in catalogue.
- **Extensions install again in the packaged app.** The download step runs in a separate process that never loaded the setting's default (`extensions.verifySignature` = off), so it treated the unset value as "verify" and refused every Open VSX
  extension with "Signature verification was not executed". An unset value now means off in that process too, as it does in the settings page; a person who switches the setting on still gets verification.

## Unreleased - Coding agents you already have an account with

- **Connect, not download.** A program the person already has (OpenCode, Cursor, Copilot, Mistral Vibe, Grok, Kimi) is found, verified with a protocol handshake and used as it is: no download, the sign-in it holds counts. Each agent card has one primary
  action: Install -> **Connect** (the vendor's own sign-in page, or its own login in a terminal) -> Use in the chat, with Test connection / Sign out / Remove under "More". Whether an agent is signed in is asked from the agent itself.
- **Four agents added** (Copilot CLI, Mistral Vibe, Grok Build, Kimi Code, each started and handshaken for real in `externalAgentLiveE2E`) and **Gemini CLI removed** (Google ended its free personal login on 18 June 2026). The terminal logins that Copilot and Kimi describe
  in `_meta["terminal-auth"]` are supported.

- **Settings > Models > Coding Agents** (`docs/integrations/external-agents.md`): use the subscription or free tier you already have with Codex, Cursor,
  OpenCode, Gemini CLI and Antigravity inside Vader's chat (Agent Client Protocol; the vendor's own program does the work and the sign-in, Vader never sees a
  token), and open Claude Code and Freebuff in a Vader terminal exactly as the vendors ship them (Anthropic allows its subscription only in its own unmodified
  program; Freebuff has no integration protocol). One card per agent with its logo (Freebuff's is the organisation's official mark, redrawn as vector); add any other ACP program by hand
  (after a confirmation); pick the agent in the chat box and switch back to your models at any time. The agent keeps its own tools and permission rules: its permission questions are shown in
  Vader, Vader's policy engine does not apply to it (stated on the cards).
- **Built to be reliable, and checked against the real programs.** npm agents are installed once with `--ignore-scripts` and started with `node` (about 0.4 s, offline, pinned; no `npx`, no shell);
  binary agents are downloaded only from each vendor's own release address with the registry's checksum; every install has a manifest; update and remove; "Test connection" per agent;
  one process per chat, stopped as a tree (no orphaned shell commands), idle stop after 30 minutes, at most four at once; the conversation is stored with the thread and picked up again
  after a restart (`session/resume`, else `session/load`); the agent's own models and modes are shown in the chat box; an expired sign-in is repeated mid-conversation; start-up failures show what
  the program printed. `externalAgentLiveE2E` installs and starts the real Gemini CLI, Codex and OpenCode.
- **Fixed by the real-agent test:** Codex lists "API Key" before "ChatGPT"; "use the first sign-in method" would have signed the person into the wrong thing. The method is now chosen by account, never by key.
- **Antigravity is a chat agent**, not a terminal one: Google publishes its own ACP server for editors in the ACP registry.
- **Settings files cannot add programs:** Export leaves the custom agents and the chosen agent out; Import keeps this computer's values whatever the file says.
- Tests: `externalAgentE2E` (95 checks, stand-in agent on the real wire), `externalAgentLiveE2E` (real vendor programs, needs the network), the `external-agents` group of the real-app suite (5 scenarios, 47 checks).

## Unreleased - Settings page sections, update check, inherited-leftover cleanup

- **Settings page, same look, more of it.** The sidebar is grouped (Models / Agent / Workspace) and gained: *Agent & Permissions* (default chat mode,
  tool approvals, policy rules, router, agents), *Context & Instructions* (AI instructions, skills, memory), *Extensions* (marketplace, signature switch,
  Install from VSIX), *Privacy & Network* (what is contacted, and why), *Data & Backup* and *About & Updates*. *Feature Options* is now *Editor Features*.
  The old "Metrics" opt-out switch (it controlled nothing) is gone.
- **Update check that works.** The inherited updater needs an update server Vader does not have. "Check for Updates" now compares the running version with
  the latest GitHub release and offers the download page; a background check exists but is off by default.
- **Inherited leftovers removed:** the two bundled Remote-SSH / Remote-WSL extensions (they could not work with Microsoft's remote server), the
  "Use AI Features with Copilot for free..." palette command, the Accounts icon (starts hidden; Microsoft/GitHub sign-in only), and a crash in
  *One-Click Switch* when the source editor had no extensions folder.

## Earlier unreleased - Every provider native, new Vader identity, repository polish

- **49 model providers, each native in Settings and in the backend** (not only through OpenRouter): 29 vendor providers were added to the
  existing 20 (Together AI, Fireworks, Cerebras, Cohere, Z.AI, Perplexity, NVIDIA NIM, Hugging Face, DeepInfra, Nebius, Cloudflare Workers AI,
  Novita, SiliconFlow, Volcengine Ark, StepFun, Vercel AI Gateway, Requesty, AI21, Upstage, Inception, Meta Llama API, Baseten, Scaleway,
  OVHcloud, Venice, Xiaomi MiMo, SambaNova, Hyperbolic, GitHub Models). One generated table (`common/vendorProviderData.ts` from
  `build/lib/vader/genVendorProviders.py`, models.dev catalog) drives title, gateway, key page, catalogue models and capabilities, so the UI
  needed no per-provider code and the visual design is unchanged. Editable gateway per provider, a bad endpoint is refused before any request,
  the model list is whatever the key can use, fetched live (no names written in; a catalogue only for providers without a list route), XML tool fallback for models without native tools, a search box
  over the provider list. Tested for every provider (`vendorProvidersE2E`, 172 checks; real-app `providers` group). Gateway URLs come from
  vendor documentation and are not live-verified (hosts are unreachable from the build environment); the endpoint field overrides them.
- **Real logo for every provider** (generated by `build/lib/vader/genProviderLogos.py` from lobe-icons, models.dev and the LiteLLM and Requesty
  projects' own icons): one colour, follows the theme, in the provider headers, the models list and the first-run setup; built without innerHTML.
- **Live model lists only.** A provider that can list the models of a key starts with none; the list appears when a working key is typed in.
- **Void leftovers removed.** `contrib/void` is now `contrib/vader` with every file, identifier, CSS class, command id, storage key and URI scheme renamed
  (stored settings and chats of earlier development builds are not migrated); remote SSH/WSL no longer download server builds from another project's
  repository (a download URL must be configured); the remote extensions' publisher is `vader`. Legal notices (licences, copyright headers) are unchanged.
- **Security**: `shell-quote` 1.12.0 in six lockfiles (critical advisory GHSA-pqg4-j6r4-53mv published on 2026-10-06; the zero-advisory gate caught it).
- **Fixed: a model listed twice in Settings.** A built-in default that the provider's live list also returned stayed in the list next to its
  live copy (React reported duplicate keys); a model the user added now also wins over a default or detected one of the same name.
- **New brand identity**: the Vader logo in every icon, installer image, splash/walkthrough asset and the onboarding screen (generated by
  `build/lib/vader/make_brand_assets.py` from `brand/source`), the transparent variant where the old logo sat on a dark background; user-visible
  Void / VS Code wording renamed to Vader outside legal and licence files.
- **Repository**: rewritten README (English and Arabic) with banner, badges and architecture diagram, `CONTRIBUTING`, `CODE_OF_CONDUCT`,
  `SECURITY`, `SUPPORT`, `ROADMAP`, `docs/FAQ.md`, `CITATION.cff`, issue forms, pull request template and release-notes categories.

## Unreleased - Agent quality from the model's side, advisories in build/test tooling

- **Driving the real app as the model** (`test/e2e/agentBridge.mjs`, `docs/AGENT_SESSIONS.md`): an agent answers the requests the packaged app
  sends to its model endpoint, so defects show up as with a keyed model, without a key. Found and fixed: a self-contradicting system prompt
  (never reject / policy rejections; one tool call / parallel execution), tool parameters sent untyped and without a `required` list
  (OpenAI-shaped, Anthropic, Gemini and the Cline adapter), no guidance on verifying work or not repeating a failing call, and a
  `run_command` that hung forever when the terminal host could not start (every start-up step is now bounded at 20 s with a clear error).
  Tool-list size is held to a test-enforced budget (30 KB; 27 KB for 43 tools today).
- **Policy hardening found by attacking the file tools as a model** (`docs/AGENT_SESSIONS.md`, `symlinkPolicyE2E`): paths are resolved through
  symbolic links and `..` before rules and agent scopes are evaluated (a link to `~/.aws` and `src/../../../etc/...` both slipped past);
  new ask rule for files that run code later (`.vscode/tasks.json`, git hooks, `.envrc`, shell profiles, MCP config, `.vaderrules`);
  more credential files and process-environment/history/browser-store paths; installing a skill or marketplace item always asks (it was in the
  auto-approvable `edits` bucket despite being documented as never auto-approved); the agent filesystem scope, which denied every file, now works.
- **Agent robustness** (real-app `robustness` group, fault-injection): invalid-JSON and unknown-tool calls now reach the model as errors,
  an identical call repeated 8 times in a row stops the run, Anthropic prompt caching on tools/system/recent turns.
- **Advisories in VS Code's build and test tooling: all 58 lockfiles, development dependencies included, are at zero.** Where upstream has
  no fix (braces, extract-zip, sprintf-js, decode-uri-component's CJS build) patched copies live in `build/stubs` with `PATCH.md` and tests.
  `shippedAdvisoriesE2E` audits every lockfile and requires zero. The extract-zip stub depends on yauzl 3 directly (npm 11 re-resolved the
  overridden yauzl 2 and rejected the lock). Six lockfiles were missing from the mirrored commit and are now included.

## Unreleased - Whole-project re-scan: privacy, unconnected parts, dependency age

- **Network privacy.** Electron and the agent's Playwright Chromium no longer contact Google on their own (spell-check dictionary,
  autofill crowdsourcing, network-time, component/CT updates, optimisation hints). Measured with Chromium's net-log; two residual
  contacts that need a profile preference are documented with reasons in `docs/integrations/privacy.md`.
  New test `browserPrivacyArgsE2E.mjs` fails if Playwright adds a feature the copied `--disable-features` list lacks.
- **Parts that were not connected.** The reference external-agent adapter registered itself but nothing imported it - now loaded by
  `vader.contribution.ts`. Five dead modules (`_dummyContrib`, `_markerCheckService`, `aiRegexService`, `contextGatheringService`,
  `directoryStrTypes`) and three unreferenced upstream GitHub composite actions were deleted. New test `unconnectedModulesE2E.mjs`
  builds the real module graphs and fails on any registering module nobody loads or any module nobody imports.
- **Dependencies.** `@cline/agents` / `@cline/shared` 0.0.86 -> 0.0.90 (typings shim updated, runtime smoke + browser bundle tests pass);
  unused `posthog-node` removed (telemetry was already hard-disabled); Electron 42.11.10.
- **Scans.** Full-repo Semgrep triaged (Vader-owned findings are style rules or guarded dispatch; upstream ones are not shipped or are
  public client ids), lockfile lint (all `https://registry.npmjs.org` with integrity), install-script inventory, retire.js (only
  build-time `next` bundles, not shipped).

## Unreleased - Final production-readiness pass: cache bounds, timeouts, dependency audit, provider re-validation

See **`FINAL_PRODUCTION_READINESS_REPORT.md`** for the complete, evidence-tagged account of this
pass and the mission it closes out - the current, honest answer to "is this ready for daily use."
Summary: fixed both caches the previous audit (below) had left unbounded
(`contextEngineService.ts`, `unifiedMarketplaceService.ts`, now using VS Code's own `LRUCache`);
found and fixed two real unbounded-hang defects of the same family (no timeout on
`gitWorktreeMainService.ts`'s git subprocess calls or `mcpChannel.ts`'s MCP connect handshake);
investigated the `@cline/llms`/`dify-ai-provider`/`undici` vulnerability's actual reachability
(confirmed unreachable via a real module-load tracer, fixed anyway via a safe `overrides` entry);
corrected two stale provider model-catalog entries (Moonshot's retired `kimi-k2-thinking`,
MiniMax's incomplete M2.x lineup) against live sources. New real, non-mocked test coverage:
`browserE2E.mjs`, `cacheBoundsE2E.mjs`, `soakE2E.mjs`, `timeoutPolicyE2E.mjs`,
`dependencyReachabilityE2E.mjs` - 87/87 passing alongside the full existing suite.

## Unreleased - Production-hardening audit: security fix + resource-lifecycle fixes

A dedicated audit (real code reading, not a generic checklist pass) of resource lifecycle,
error handling, and dead migration code turned up several genuine defects, the most severe
being a **real shell-injection vulnerability**: `gitWorktreeMainService.ts` built git commands
via shell-string interpolation (`exec(\`git ${args}\`)`), and `commitMessage`/`branchName` can
originate from an LLM tool-call argument (`delegate_parallel_tasks`' task text) that could
itself be influenced by untrusted content the agent read - a real prompt-injection-to-RCE path.
Fixed by switching every git invocation to `execFile()` with an argv array (no shell involved at
all), and verified against a real git repository: a commit message containing `` `$(touch
/tmp/PWNED)` `` executed under the old code and does not under the fix.

Also fixed: a stuck-forever promise (and the `AgentRuntime.run()` call awaiting it) when a
thread was deleted while a tool call was still awaiting approval; an MCP server connect failure
that used to leave the Settings UI's "loading" state stuck forever with no error surfaced;
unbounded growth of closed browser-tab entries and parallel-orchestration run history over a
long session (both now capped, oldest evicted first, never evicting anything still in
progress). See the commit for the full list and what was found-but-intentionally-not-changed
(a few lower-severity/higher-risk-to-fix items are documented rather than rushed).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run compile` (0 errors),
`clineRuntimeSmoke.mjs` (14/14), plus a standalone functional test of the shell-injection fix
against a real git repo.

## Unreleased - Provider expansion: MiniMax, Alibaba/Qwen, Moonshot/Kimi, OpenCode Zen

Four new first-class providers, each researched against current (as of this session) official
documentation before implementation - see `docs/integrations/providers/` for the full sourcing,
confidence level, and stated gaps per provider (several official doc domains were unreachable
from this sandbox's egress-restricted network; facts were triangulated via search and
corroborated against directly-fetchable secondary sources like GitHub, and every doc file says
exactly which claims are and aren't independently confirmed).

All four are OpenAI-compatible-mode providers, added through the **existing** shared
`newOpenAICompatibleSDK`/`_sendOpenAICompatibleChat` path (one new `else if` branch + four
one-line dispatch-map entries) rather than new per-provider networking code - see
`docs/integrations/providers/README.md`'s "why this wasn't a bigger architectural rewrite"
section for why the mission's "Provider Registry" restructuring turned out to already exist.
MiniMax/Alibaba/Moonshot each get a real, region-aware, user-editable `endpoint` setting
(international default, China endpoint documented in the in-Settings help text) since all three
have two real regions with non-portable, region-issued API keys. OpenCode Zen's model catalog is
deliberately left empty by default (explicitly beta/volatile per its own docs) - same treatment
as the existing generic `openAICompatible` provider.

`modelCapabilities.ts`'s `modelSupportsVision` (added in the earlier vision-pipeline pass) gained
provider-specific branches for all four (MiniMax-M3/M3.1, Qwen-VL, Kimi K3/K2.5/K2.6/K2.7),
reusing the same pattern-based, best-effort convention as every other provider - a new vision
provider in the Model Router's `resolveVisionModel()` and the `browser_screenshot_analyze` tool
work with these providers automatically, no additional wiring needed.

Also confirmed and documented, not implemented as a fifth provider: **OpenCode Go** is a real
$10/mo subscription tier reusing OpenCode Zen's exact same gateway protocol under a different,
subscription-gated base path - a Go subscriber uses the `openCodeZen` provider with their Go URL
pasted into the endpoint field, rather than Vader building a near-duplicate second provider.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean),
`npm run compile` (0 errors), a direct sanity check against the compiled output confirming
correct default settings/model capabilities/vision detection/client-dispatch resolution for all
four new providers, and `clineRuntimeSmoke.mjs` (14/14, unaffected).

## Unreleased - Legacy Main Agent runtime removed; Cline is now the only runtime

With the Cline migration complete and stable, the original hand-rolled tool-calling loop
(`chatThreadService.ts`'s former `_runChatAgentLegacy`/`_runToolCall`, and the runtime-selection
dispatcher that briefly chose between it and Cline) has been deleted, not just hidden behind a
default. `_runChatAgent` now drives every turn through Cline directly; a Cline failure (a
genuine init/compatibility failure, a provider error, a tool throwing) always surfaces as a
clear per-task error - there is no other runtime to silently substitute. `_evaluateToolCallGate`/
`_executeAndRecordToolCall` (the shared Policy Engine/agent-scope/read-only-mode gate and tool
executor) are preserved unchanged, since `_runToolCallInline` still needs them.

One real behavior had to be re-derived rather than deleted outright: resuming a tool approval
that was still pending when Vader itself restarted (the in-memory `_pendingInlineApprovals` map
doesn't survive a process restart, though the persisted `tool_request` message does).
`approveLatestToolRequest`'s restart-recovery path now runs that one pending tool call directly
(`_resumeToolRequestAfterRestart`) and starts a fresh Cline turn, which correctly picks the
conversation back up since `VaderAgentModel` always rebuilds its request from live thread
messages - there was never anything to "resume" in the old `AgentRuntime` instance either, since
a full process restart destroys its in-memory state regardless of which runtime drives turns.

`IAgentRuntimeRegistryService` dropped the `legacy`/`cline` selection type entirely -
`getSelection(): AgentRuntimeSelection` became `getHealth(): AgentRuntimeHealth`, reporting
Cline's own real status for diagnostics (the Agent Manager UI, and an upfront check in
`_runChatAgentImpl` that fails fast with a clear message instead of a deep construction error)
rather than choosing a runtime. `RuntimeStatusBlock` (`Settings.tsx`) now shows one runtime's
health, not two.

**Typings shim audit**: re-evaluated the `src/tsconfig.json` `paths` redirect to
`src/typings/cline-{agents,shared}.d.ts` (workaround for the real packages' own extensionless
relative imports, invalid under this project's `nodenext` resolution). No cleaner mechanism was
found that doesn't require patching `node_modules` or vendoring a fork - the `paths` redirect
remains the least invasive fix. Added the automated guard the audit asked for:
`test/checkClineTypingsVersion.mjs` reads the installed `@cline/agents`/`@cline/shared` versions
and fails loudly if they've drifted from `CLINE_AGENTS_VERSION`/`CLINE_SHARED_VERSION` in
`clineRuntimeAdapter.ts` - wired into the top of `clineRuntimeSmoke.mjs` so the ordinary smoke
test run catches drift too, instead of a future `npm install` silently invalidating the shim.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean),
`clineRuntimeSmoke.mjs` (14/14 passing against the real installed package, including the
typings-version guard).

## Unreleased - Cline is now genuinely installed, default, and executing + Marketplace completion + Vision

Supersedes the "Cline Main Agent Runtime integration (Milestone 1)" entry below, which reported
`@cline/agents`/`@cline/shared` as declared-but-blocked by the sandbox's install policy. With
that policy's owner explicitly authorizing the install in this session, `npm install
@cline/agents@0.0.86 @cline/shared@0.0.86 --save-exact` was retried and **succeeded**. What
follows is genuinely built and compiling against the real installed package, not the design
doc alone.

**The `tsconfig.json` `paths` fix**: the real installed `@cline/agents`/`@cline/shared` `.d.ts`
files use extensionless relative imports (`from "./agent"`), invalid under this project's
`moduleResolution: "nodenext"` - confirmed a type-checking-only issue (the compiled JS resolves
fine at runtime; `node -e "import('@cline/shared')..."` succeeds) via `src/tsconfig.json`'s
`compilerOptions.paths` redirecting both bare specifiers to two new hand-transcribed local
`.d.ts` shims (`src/typings/cline-{shared,agents}.d.ts`), each documented as needing to stay in
sync with the pinned version.

**Cline is the real, executing default Main Agent runtime**, not merely selectable:
`IAgentRuntimeRegistryService`'s `probeClineRuntime()` does a real `AgentRuntime` construction
check (no more hardcoded status); `chatThreadService.ts`'s `_runChatAgent` dispatches to the new
`_runChatAgentViaCline` whenever the registry's live selection is `'cline'`, falling back to the
unchanged legacy loop only on genuine init/compatibility failure or explicit selection - never
silently on an ordinary task/model/tool error (a Cline-path error surfaces as a normal per-task
stream error instead). `VaderAgentModel` (`browser/agentRuntime/vaderAgentModel.ts`) bridges
Cline's `AgentModel` interface to Vader's *existing* `ILLMMessageService`/provider
infrastructure and `IConvertToLLMMessageService` conversion - Cline never talks to a provider
Vader didn't already route through. `clineToolAdapter.ts` builds Cline `AgentTool`s from the
same `availableTools(chatMode, mcpTools)` the legacy prompt uses, so Gather/Plan/Verification
threads never even see mutating tools under Cline either.

**The mid-batch-approval-resume limitation is fixed and empirically verified, not just
architecturally claimed.** `chatThreadService.ts`'s tool-call gate was refactored into
`_evaluateToolCallGate`/`_executeAndRecordToolCall`, shared by the unchanged legacy
`_runToolCall` and a new `_runToolCallInline` used on the Cline path, which awaits approval
*inside* the single `AgentTool.execute()` call `AgentRuntime`'s own batch executor is awaiting -
so the runtime, not Vader, resumes the rest of the batch once approval resolves. A real,
non-mocked smoke test against the actual installed `@cline/agents`
(`src/vs/workbench/contrib/vader/test/clineRuntimeSmoke.mjs`, 5 tests/14 assertions, all passing)
specifically exercises this: tool A runs, tool B blocks on an external approval promise, tool C
is verified *not* to run while B is pending, then runs and completes once B resolves.

**Open VSX** (previously-documented limitation): `product.json`'s `extensionsGallery` now points
at the real, official Open VSX gallery (`open-vsx.org/vscode/gallery` + `item`/
`resourceUrlTemplate`/`extensionUrlTemplate`, verified against the Eclipse Open VSX project's own
wiki) instead of the Microsoft Marketplace - a pure data change, since `IExtensionsWorkbenchService`
is gallery-endpoint-agnostic.

**MCP one-click configure** (previously "configure" just opened `mcp.json`): `IMCPService` gained
a real `addOrUpdateServer`/`removeServer` API; the MCP marketplace provider now builds an actual
runnable `command`/`args`/`env` from the official MCP Registry's own per-package metadata
(registry type -> npx/uvx/docker runtime convention) and prompts interactively for required
secrets via `IQuickInputService` - never fabricated - falling back to manual file editing only on
cancellation or when no real package/remote metadata exists.

**Tree-sitter re-investigated - a correction, not a new finding.** An earlier pass in this same
overall effort incorrectly stated no tree-sitter runtime exists in this codebase. It does
(`@vscode/tree-sitter-wasm`, a full parser service under `src/vs/editor/common/services/
treeSitter/`) - but reading `treeSitterTokenizationFeature.ts` shows it's Microsoft's own
experimental feature with a hardcoded 4-language allowlist and no runtime extension point (its
own comment: *"for now they are hard coded in core"*). See `docs/integrations/marketplace.md`'s
Tree-sitter row for the full, evidenced finding.

**Real vision/multimodal pipeline** (previously a stated gap - see the Model Router entry
below): a new, isolated image-query capability - `modelCapabilities.ts`'s pattern-based
`modelSupportsVision`, `IModelRouterService.resolveVisionModel()`, `IVisionMainService`
(`common/vision/`, `electron-main/visionMainService.ts`) reusing the existing per-provider
client-construction helpers, and a new `browser_screenshot_analyze` builtin tool that returns a
real text description of a screenshot from a vision-capable configured model - deliberately kept
out of the main chat streaming loop and the persisted `ChatMessage`/`LLMChatMessage` format
(AGENTS.md's "changing this format is a big deal" warning). See
`docs/integrations/model-router.md`'s new Vision section.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors) after every change in this entry.

## Unreleased - Unified Capability Marketplace

New federated marketplace (`common/marketplace/`, `browser/marketplace/`): a normalized
`MarketplaceItem` model, an `IMarketplaceProvider` interface where each provider exposes only
the operations its real lifecycle supports, and `IUnifiedMarketplaceService` doing concurrent
federated search with per-provider timeout/failure isolation, dedup, ranking, and caching.

Six real providers: Extensions (wraps the existing gallery service unmodified), Skills (existing
SkillNet/SkillProvider lifecycle), MCP servers (verified the official MCP Registry is live;
installs map to "configure" since no programmatic add-server API exists), ACP agents (honest
"this is a protocol, not a registry" framing - lists only what's actually registered), Language
Servers and Debug Adapters (classify the same extension gallery by real category/manifest
signals rather than inventing a standalone registry), Prettier and Jupyter kernels (local-only
detection, zero network, zero fabricated data). Tree-sitter grammars are a stated, deliberate
gap - no verified registry exists and this codebase has no runtime to consume a grammar anyway.

Wired into the Capability Bus (`resolve()` now surfaces installed marketplace items and falls
back to the marketplace for ecosystems it had no coverage of) and a new `install_marketplace_capability`
tool the Main Agent can call on a discovered candidate - gated through the exact same Policy
Engine/approval path as any other mutating tool, never a silent install.

UI: one additive `ViewPane` registered into the *existing* Extensions view container (verified
`rejectAddedViews` only affects drag-and-drop, not static registration, before relying on this) -
does not touch the native extensions view files at all. Federates the 8 non-extension ecosystems
via a React pane using the same mounting infrastructure as the Sidebar/Settings panes.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean, new
`vader-marketplace-tsx` bundle).

## Unreleased - Cline Main Agent Runtime integration (Milestone 1) + Unified Marketplace (in progress)

**Verified, not assumed**: independently confirmed (npm registry API directly, plus an actual
`npm install @cline/sdk` in a scratch directory with the real `.d.ts` files read) that Cline's
upstream now publishes a genuinely embeddable, non-VS-Code-extension agent SDK
(`@cline/agents`, Apache-2.0, `0.0.86`) - see `docs/integrations/agent-runtime.md` for the full
evidence trail and the resulting integration design.

**Main Agent Runtime seam** (`common/agentRuntime/`, `browser/agentRuntime/`): a new
`IAgentRuntimeRegistryService` reports which loop drives Main Agent turns (`legacy` today) and
honest per-runtime health, surfaced in the Agent Manager Settings UI (`RuntimeStatusBlock`).
`@cline/agents`/`@cline/shared` are declared in `package.json` but **could not be installed in
this environment** - the sandbox's dependency-install safety policy declined the `npm install`
as "Untrusted Code Integration," which is outside this session's own authority to override.
The full `ClineRuntimeAdapter` design (tool adapter reusing the existing Policy Engine gate
with zero duplication, a `VaderAgentModel` that preserves every existing provider by never
routing through Cline's own provider layer, and the mid-batch-approval-resume fix this
unlocks) is written up in `docs/integrations/agent-runtime.md`, ready to implement the moment
a human runs that install. This is reported as a genuine environment/tooling limitation, not
skipped work - the design is complete and reviewed against the real installed package types.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean).

**Pre-merge worktree verification** (previously-documented limitation #45): `IToolsService.runVerificationChecksAt(root)` factors `run_verification`'s script-detection logic into a reusable, directory-parameterized method; `IVerificationService.gatherEvidence`/`runIndependentVerification`/`runVerifyRepairLoop` now accept an optional `cwd`. `orchestrationService.ts`'s `_runWorktreeTask` runs real build/typecheck/lint/test checks inside the worktree's own isolated checkout before merging - a failure blocks the merge (`mergeOutcome: 'verification_failed'`) and leaves the branch/worktree in place for manual review, exactly like an existing merge conflict. See `docs/integrations/verification.md`.

**Research/browser Model Router categories wired** (previously-documented limitation #46): two new builtin tools, `delegate_research_task` (hard-forced read-only, like a verification thread) and `delegate_browser_task`, give the Main Agent delegation paths distinct from generic `delegate_subagent_task` whose hidden threads resolve through `resolveModel('research')`/`resolveModel('browser')`. Honestly scoped: this wires model *selection*, not vision/multimodal input, which this codebase has no pipeline for at all. See `docs/integrations/model-router.md`.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors).

## Unreleased - Branding re-audit, performance pass, verification model routing fix

**Branding re-audit**: a fresh, read-only pass over every `localize`/`localize2` call,
title/description/label/placeholder literal, `product.json`, and Vader-authored extension
manifests under `src/vs/workbench/contrib/vader/` found the user-visible rebrand already
complete and consistent. One real finding: a dev-only `useAccessor` error message in
`services.tsx` still said "Void" - fixed. Internal identifiers
(`IVaderSettingsService`/`vader-bg-1`/`vader-channel-*`/etc.) and comments citing Void for
historical accuracy are unchanged, per this project's own "no blind global rename" rule.

**Performance**: `IVerificationService.gatherEvidence()` was awaiting the git diff fetch and
the build/lint/test check run one after another despite them being fully independent -
switched to `Promise.all`, matching the concurrency discipline already used in the Context
Engine and Agent Orchestration.

**Bug fix found while writing this pass's own docs**: a verification thread is also flagged
`isSubagentThread` (so it gets checkpoints, etc.), which meant `_currentModelSelectionProps`
was routing it through the Model Router's `'subagent'` category instead of the dedicated
`'verification'` one added back in Phase 4/9. Fixed - `isVerificationThread` is now checked
first.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Memory UI, Agent Manager UI, Model Router per-category picker

New `MemorySection` (Settings): browse project/agent memory records, remove individually,
clear a whole scope - `IMemoryService` had zero UI before this. New `AgentManagerSection`:
live visibility into `IAgentOrchestrationService.runs` (Phase 5's parallel-agent
orchestration) - every run and task's real-time status/agent/worktree/merge-outcome/error,
not a mockup. Both built as Settings sections (same pattern as the existing
Agents/Policy/Model-Router/Skills sections) rather than new standalone workbench views;
a dedicated Agent Manager panel with its own activity-bar presence is further, separately-
scoped workbench plumbing, tracked honestly as not done here rather than half-built.

`ModelRouterSection` gains the per-category manual override picker it was missing - a
dropdown per category (subagent/research/browser/summarization/verification) over every
currently configured model, calling `IModelRouterService.setCategoryOverride` directly
(previously only settable programmatically).

See `docs/integrations/agent-manager-ui.md`.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Independent Verification Agent + checkpoint/orchestration integration

New `common/verification/` (`IVerificationService`) and a new mechanism in
`chatThreadService.ts`: `isVerificationThread`, which hard-forces the exact same read-only
enforcement Plan/Gather mode use (every mutating built-in tool and every MCP tool call
blocked, regardless of the user's actual global chat mode) onto a hidden verification
thread. This is what makes verification genuinely independent - not the same agent
context grading its own work, in a fresh thread that cannot edit anything to make its own
checks pass. New `run_verification_agent` tool: gathers real evidence (git diff, live
`IMarkerService` diagnostics, and `run_verification`'s own build/lint/test results -
explicitly never treating "no checks detected" as a pass), asks the independent verifier
for a structured `<vader_verdict>` (parsed the same tag-extraction way as compaction/Plan
Mode), and runs a bounded verify→repair→re-verify loop (delegates a repair subagent task
for any `blocker` finding, re-verifies, up to 3 rounds by default) - never loops
unboundedly, and reports honestly if it's still failing after the cap.

Checkpoint/orchestration integration: provenance (which agent/worktree produced which
changes) was already tracked by Phase 5's `ParallelTaskState`; verification/repair hidden
threads now checkpoint their edits the same way an interactive turn does; and worktree
merge safety against unrelated user work turns out to already be a property of git itself
(a merge that would conflict with uncommitted changes is refused, not silently overwritten -
this pass's existing conflict handling already covers that). See
`docs/integrations/verification.md` for what's real and the one stated boundary (verifying
a worktree's isolated changes before merge isn't implemented - `IMarkerService` can't see a
separate checkout's files without opening them in this workbench first).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Multi-tab browser automation

Removed the single-page limitation: `IBrowserToolMainService` now manages any number of
pages, each with a stable `pageId` (a uuid, not an index - stable across other pages
opening/closing). New page-lifecycle tools `browser_new_page`/`browser_list_pages`/
`browser_switch_page`/`browser_close_page`; every existing browser tool
(`navigate`/`reload`(new)/`snapshot`/`click`/`type`/`screenshot`/`console_logs`) takes an
optional `page_id`, defaulting to the active page (auto-created if none exists) so existing
single-page usage keeps working unchanged. New `browser_page_errors` (uncaught JS
exceptions, distinct from console.error) and `browser_network_log` (failed requests + 4xx/5xx
responses only - "relevant" network activity, not a full HAR dump).

Session handling: a closed/crashed page gets a clear, specific error instead of a raw
Playwright exception on next use, and stops being "active" automatically; the whole browser
process disconnecting marks every page closed at once; a stale `aria-ref` (from before a
navigation/reload invalidated it) is caught and rewritten into an actionable "call
browser_snapshot again" message instead of a generic locator-timeout stack trace.

See `docs/integrations/browser-backend.md` for the full interface, the
"software-engineering loop" workflow these tools are meant to compose into, and how to
replace the backend.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Skill lifecycle, External Agent Adapter, MCP/Policy Engine fix

**Skills** (`common/skills/`, new `ISkillService`): full install/cache/pin/enable/disable/
update/remove lifecycle - previously only discovery (`search_skillnet`,
`fetch_skill_instructions`) existed; a stale comment referenced a
`skills/skillProviderTypes.ts` that was never actually created. New `install_skill` tool +
`SkillsSection` Settings UI. Trust states (`trusted`/`review_required`/`blocked`, defense in
depth, not a claim of static analysis) gate what's composed into the system prompt; a
content-changed update automatically downgrades a `trusted` skill back to
`review_required` (promotion is always an explicit user action, demotion can happen
automatically) - the concrete mechanism behind "never let a silent external update keep
trusted status." Skill instructions are still subject to the same Policy Engine as
everything else - trust only controls what the model is told, never what executes. New
`installed-skill` Capability Bus source. See `docs/integrations/skills.md`.

**External Agent Adapter** (`common/externalAgent/`): an ACP-inspired boundary
(capabilities/session/streamed events/cancellation), deliberately kept separate from the
Agent Gateway's Vader-internal shape. One real reference adapter
(`VaderNativeExternalAgentAdapter`) wraps Vader's own runtime behind it - streaming is
genuinely live (read off the Agent Gateway's real `onDidChangeExecutionState`/
`getExecutionState`, not simulated), cancellation goes through the same `cancelTask` path
as everywhere else, and `supportsToolRequests` honestly reports `false` since a subagent run
has no live human to approve an interactive request. No third-party ACP-speaking process is
wired up - there's no such binary in this environment to build and verify against, and a
protocol adapter with nothing real to talk to would prove less than wrapping Vader's own
verified backend. See `docs/integrations/external-agent-adapter.md`.

**MCP + Policy Engine bug fix**: audited Void's existing MCP service (discovery,
health-status per server, enable/disable, lazy tool exposure, agent-scoped server
allowlists - all already real, not rebuilt) and found the Policy Engine's MCP integration
was dead code: every `'mcp-tool'`/`'network'` policy rule was unreachable, because the
matcher unconditionally required `pathGlobs`/`commandPatterns` and those two kinds can never
have either. Fixed with a new `serverNamePatterns` field and a kind-aware match guard, plus
a real (previously nonexistent) custom-policy-rule authoring UI in Settings - the backend
methods (`addCustomRule` etc.) had zero UI callers before this. See
`docs/integrations/mcp-and-policy.md`.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Plan Mode, and a real fix for Gather mode's read-only claim

**Audit finding, fixed**: Void's "Gather" mode has always been described in its own UI as
"Reads files, but can't edit" - that was never actually enforced in code, only implied by
not telling the model a mutating tool exists (`availableTools()` in `prompts.ts`). The XML
tool-calling fallback grammar (models without native function-calling) parses whatever tool
tag text it finds, so a model that emitted an edit tag anyway in Gather mode would have had
it executed. `chatThreadService.ts`'s `_runToolCall` now has a hard gate (numbered "1.45",
same enforcement position as the Policy Engine and agent-scope checks) that rejects every
mutating built-in tool and every MCP tool call outright in `gather` mode - independent of
what the model was told or attempted.

**New `plan` ChatMode**: gets the identical hard read-only enforcement, plus a prompt asking
the model to end its response with a structured `<vader_plan>` block
(objective/phases/files-or-subsystems/constraints/validation-requirements/unresolved-
assumptions) once it has enough context - optional, skipped for small/obvious changes.
`_maybeCaptureThreadPlan` parses this into a new `PlanObject` stored on `ThreadType.activePlan`
(additive field, no migration needed). A new "Plan ready" banner in `SidebarChat.tsx` offers
"Approve & Execute" (switches to `agent` mode and hands the agent every field of the
structured plan, not re-parsed prose) and "Discard".

See `docs/integrations/plan-mode.md` for the full audit note and current gaps (no dedicated
plan-editing UI yet, no separate "revise" action distinct from just replying).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Parallel agents with real concurrency + git worktree isolation

New `common/orchestration/` (`IAgentOrchestrationService`) and `common/worktree/` +
`electron-main/gitWorktreeMainService.ts` (`IGitWorktreeMainService`). New
`delegate_parallel_tasks` tool: runs up to 8 subagent tasks with genuine bounded
concurrency (a worker-pool over `Promise.all`, up to 4 at once - not a loop that awaits
each task in turn under a "parallel" label). Read-only tasks run directly against the live
workspace; tasks marked `uses_worktree` get a full isolation lifecycle: `git worktree add`
on a sibling directory (never nested in the main workspace), an explicit working-directory
instruction prepended to the task prompt (works with zero changes to the tool-execution
engine, since every file tool already takes explicit absolute URIs), commit + `git merge
--no-ff` back into the current branch, and cleanup - or, on conflict, `git merge --abort`
plus leaving the worktree and branch in place for manual resolution (never destroys work).
A worktree that fails to create at all stops that task rather than falling back to editing
the live workspace unisolated. `cancelRun` cancels in-flight tasks through the Agent
Gateway's existing `cancelTask`, via a new `onThreadCreated` callback on
`runIsolatedTask`/`runSubagentTask` that exposes a task's hidden thread id before it
finishes.

See `docs/integrations/parallel-agents.md` for the exact lifecycle. Orchestration state
(per-task status/thread/worktree/merge outcome) is fully real and queryable
(`IAgentOrchestrationService.runs`) but has no dedicated UI yet - tracked as later Agent
Manager UI work, not silently skipped.

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Model Router (AUTO/MANUAL) and capability descriptors

New `common/modelRouter/` (`IModelRouterService`): AUTO/MANUAL routing for work that doesn't
have its own Settings dropdown (subagent delegation, research, browser automation,
compaction summarization), sitting on top of - not replacing - Void's original per-feature
model selection (Chat/Ctrl+K/Autocomplete/Apply/SCM keep their own dropdowns and storage
unchanged; MANUAL mode, the default, reproduces exactly the old behavior for anyone
upgrading). AUTO mode ranks only `listConfiguredModels()` - providers with real credentials
entered - so an unconfigured provider is never silently selected however capable its static
info claims it is; ranking uses a `ModelCapabilityDescriptor` built entirely from data this
codebase already tracks (`getModelCapabilities`'s tool-calling format/context
window/reasoning/FIM/cost/cache fields, plus `localProviderNames` for local-vs-cloud) -
vision/multimodal capability is deliberately left out rather than guessed, since this
codebase doesn't track it per-model today.

Wired into two real consumers: subagent delegation (`chatThreadService.ts`'s
`_currentModelSelectionProps`, for subagent threads with no agent-pinned model) and context
compaction's own summarization call. A new `ModelRouterSection` in Settings gives a
functional (if first-pass) Auto/Manual toggle and a live read-out of what each category
resolves to. See `docs/integrations/model-router.md` for exactly what's wired vs. what's
tracked follow-up (research/browser/verification categories exist but have no execution
path calling them yet; no per-category manual-override picker in Settings yet).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), full
`npm run compile` (0 errors).

## Unreleased - Memory layers and structured context compaction

New `common/memory/` (`IMemoryService`): persistent, inspectable, clearable project memory
(keyed by workspace) and agent memory (keyed by agent id), plus a bounded compaction
archive. New `remember` tool lets the Main Agent (or a running permanent agent) write a
durable fact; memory is read back into every turn via two new instruction layers
(`projectMemory`, `agentMemory` in `instructionsService.ts`), composed alongside
`.vaderrules` and agent instructions - real end-to-end, not a tool with nothing reading its
output back.

New structured context compaction (`chatThreadService.ts`'s `_maybeCompactThread`, prompts in
`prompts.ts`): checked every turn, triggers at 70% of the model's usable context window,
replaces older messages (always keeping the most recent 6 in full) with one structured
summary message (objective/constraints/decisions/architecture notes/files
modified/important locations/unresolved problems/test results/next steps) instead of
Void's original blind per-message character truncation - which is untouched and still runs
as the final safety net, since compaction is a best-effort pass that can fail (provider
error) without blocking the turn. The raw messages a compaction pass replaces are archived
to `IMemoryService` (`scope: 'compactionArchive'`, capped at 20 per thread), never deleted
outright. New `ChatMessage` role `compacted_summary` (purely additive - old persisted
threads can't contain it, so no migration) rendered in both the chat UI and the LLM-facing
message conversion.

See `docs/integrations/memory-and-compaction.md` for what's real vs. still open (no Memory
UI yet; compaction uses the Chat feature's model selection, not a dedicated cheaper
category).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors), `npm run buildreact` (clean), and
the full `npm run compile` gulp task (0 errors).

## Unreleased - Context Engine

New `common/context/` + `browser/contextEngineService.ts`: a per-turn dynamic context
section (symbol outlines, live diagnostics, git diff/log) for files the user mentioned or
has open, wired into `convertToLLMMessageService.ts`'s system-message generation - every
chat turn (agent/gather/normal/subagent) gets it, not just a new tool the model has to
remember to call. Built entirely on data sources already real and present in this codebase
(`ILanguageFeaturesService`'s document symbol provider, `IMarkerService`, and
`IVaderSCMService` - the git service that existed fully wired end-to-end but had exactly one
consumer before this, the commit-message generator). Relevance-ranked by a keyword-based
task-type classifier (bug-fixing/architecture/ui/general) that decides section priority
when the token budget (min(6000, 15% of the model's context window), heuristic chars/4)
can't fit everything; truncates the first section that overflows rather than dropping
sections outright. Symbol/diagnostic caches are invalidated by the text model's own
`getVersionId()`/marker-changed events - not a timer, not a full-repo rescan. Bounded to at
most 12 mentioned/open files regardless of repo size - no full-repo symbol indexing.
See `docs/integrations/context-engine.md` for what this does and doesn't cover (no
repo-wide semantic search, no independent LSP client - diagnostics/symbols are only as good
as whatever language service is already active for a file).

Verified: `tsc -p src/tsconfig.json --noEmit` (0 errors) and the full `npm run compile`
gulp task (0 errors) after the change.

## Unreleased - Agent Gateway as the primary execution seam

`IAgentGatewayService` (`common/agentGateway/`) is now the real path the chat UI uses to run a
task, not only `delegate_subagent_task`'s call site. Added `startTask`/`reviseTask`/
`cancelTask`/`approveToolRequest`/`rejectToolRequest`/`dismissError` plus a normalized
`getExecutionState`/`getExecutionMetadata` projection (`AgentExecutionState`/
`AgentExecutionMetadata` - a smaller, runtime-independent vocabulary than
`chatThreadService.ts`'s own `ThreadStreamState`/`ThreadType`). `SidebarChat.tsx`'s
send/edit-message/abort/approve/reject/dismiss-error actions all now call through the
Gateway instead of `IChatThreadService` directly; rendering the conversation itself
(persisted messages, checkpoints, thread list, staging selections, codespan links) still
reads `IChatThreadService` directly in `SidebarThreadSelector.tsx`/`Settings.tsx`/
`ChatMarkdownRender.tsx`/`inputs.tsx` and the read side of `SidebarChat.tsx`, since that's
inherent to displaying history, not to driving execution - see
`docs/integrations/agent-gateway.md` for the exact boundary. Verified with a clean
`npm run buildreact` and a clean `tsc -p src/tsconfig.json --noEmit` (0 errors) after the
change.

## Unreleased - agent runtime hardening, Agent Gateway, Windows CI

**Agent runtime decision**: evaluated replacing the core agent loop with Cline, Kilo Code,
OpenHands, or Zed's runtimes (as a later revision of this project's brief asked for) and
rejected all four as clean transplants - see `docs/integrations/agent-gateway.md` for the
reasoning (extension-host-only, Python-first, and Rust/GPUI-only respectively). Instead,
fixed the actual defect that motivated the ask:

- **Multi-tool-call-per-turn**: the OpenAI-compatible, Anthropic, and Gemini native
  provider paths (`electron-main/llmMessage/sendLLMMessage.impl.ts`) used to silently keep
  only the first tool call a model returned in one turn and drop the rest. All three now
  collect every tool call the provider returns; `chatThreadService.ts`'s agent loop
  executes each one serially (never concurrently, to stay compatible with Void's
  single-edit-at-a-time diff/checkpoint engine and to avoid faking parallelism the
  provider didn't actually provide), each still gated by the Policy Engine and agent
  scope exactly as before. The XML tool-calling fallback (for models without native
  function-calling) remains single-tool-per-turn - its custom incremental parser locks
  onto the first tag it finds by construction, and extending it safely was judged
  higher-risk than the value it would add for what's already the weaker-tool-support path.
- **Agent Gateway** (`common/agentGateway/`): a small, real (not decorative) interface in
  front of the agent loop, used today by `delegate_subagent_task`, so a future runtime
  swap touches one implementation and one call site rather than the UI.

**CSS MIME dev-launch issue, re-investigated with evidence**: the previous report noted a
CSS-module MIME error blocking a fully interactive workbench in this project's Linux build
sandbox and guessed it was upstream/environment-specific. This time it was actually
checked: a second, unmodified Void checkout was built and launched identically, and both
windows were inspected live over Electron's `--remote-debugging-port` (via
`playwright-core`'s CDP client - screenshots and console capture, not just log reading).
Neither reaches a working workbench in this sandbox; Vader's failure surfaces the specific
CSS-MIME/dynamic-import error, the unmodified checkout's does not (it separately hits
missing-native-binding errors for `@vscode/sqlite3`/`@vscode/spdlog`, expected since native
module compilation is skipped in this sandbox for both checkouts). Not fully root-caused,
but no longer an assumption: this is confirmed as a shared, sandbox-level limitation, not a
Vader-introduced regression.

**Windows build CI**: added `.github/workflows/windows-build.yml`, running the full
install → compile → package → installer pipeline on a `windows-latest` GitHub Actions
runner (manual dispatch, or automatically on product-identity-affecting pushes to `main`),
uploading the unpacked app and Inno Setup installer as artifacts. The gulp task names it
calls were confirmed to exist by listing this repo's actual gulp task registry, not
guessed - but the workflow itself has not been run, since no Windows runner is available
in this sandbox.

## Vader 0.1.0 - initial fork from Void

Imported [voideditor/void](https://github.com/voideditor/void) @ `b3166e7` (v1.4.9) as the upstream foundation and built a new agent platform on top of it. See `ARCHITECTURE.md` for the design and `AGENTS.md` for how to extend it.

### Rebranding (Void → Vader)

- Product identity throughout: `product.json`, About dialog, window/application metadata, command palette titles, notification text, undo-history labels, installer text (`build/win32/code.iss`), OpenRouter identification headers, onboarding copy, Settings copy.
- New Windows installer identity: fresh GUIDs for all `win32*AppId` fields (never reusing Void's, to avoid any registry/upgrade collision with a real Void install on the same machine), new bundle identifiers, new data folder (`.vader-editor`), new URL protocol (`vader`).
- The workspace instructions file is `.vaderrules`.
- **Two real bugs fixed, not just renamed**: the update-checker no longer queries `voideditor/binaries` on GitHub and offers to send users to reinstall Void; the "transfer settings from another editor" feature no longer writes into `~/Library/Application Support/Void` (and platform equivalents) instead of Vader's own data folder.
- Anonymous usage telemetry (previously sent to Void's own PostHog project by default) is hard-disabled rather than re-pointed - no telemetry request is made, regardless of the opt-out setting's value.
- Void's own README/codebase guide/contribution guide are kept (marked as inherited, unmodified reference material) rather than deleted, since they still accurately describe the code they document.

### New: Policy Engine (`common/policy/`)

Hard, pre-execution rule evaluation for every built-in tool call, MCP tool call, and terminal command, independent of the model's behavior and the user's auto-approve settings. Locked rules (destructive commands, fork bombs, OS-critical paths) can never be disabled, in any permission mode. Default-on rules (secrets/key files, `sudo`, force-push, piping a download into a shell) force approval unless the mode is Autonomous *and* the rule allows that. Three permission modes: safe, balanced, autonomous.

### New: Layered instructions (`common/instructions/`)

Replaces an ad-hoc string concatenation with named, ordered layers (system invariants, policy summary, global settings, workspace `.vaderrules`, agent, skill, task), each independently inspectable.

### New: Permanent agents (`common/agents/`)

Persistent, named agent definitions with their own instructions, optional model override, and optional tool/MCP-server/filesystem restrictions. A chat thread can run "as" an agent. The main agent can create one itself via a new `create_persistent_agent` tool. A Settings UI section (Agents & Permissions) lists, creates, assigns, and deletes agents, and switches the policy permission mode.

### New: Temporary subagent delegation (`delegate_subagent_task` tool)

Spins up a hidden thread with its own context for a self-contained task, runs it to completion, and returns a structured result (conclusion, changed files, whether it stalled on an approval nothing could grant, whether it errored) rather than merging its transcript into the caller.

### New: External discovery (`common/discovery/`)

Live search against the official MCP Registry (`registry.modelcontextprotocol.io`) and SkillNet (`api-skillnet.openkg.cn`), plus best-effort fetch of a skill's instructions file. New tools: `search_mcp_registry`, `search_skillnet`, `fetch_skill_instructions`. Read-only; does not auto-install anything.

### New: Capability bus (`common/capabilities/`)

Read-only inventory/resolver over native tools, connected MCP tools, and permanent agents, falling back to external discovery only when nothing local matches. New tool: `find_capability`.

### New: Browser automation (`common/browser/`, `electron-main/browserToolMainService.ts`)

Playwright-backed (via `playwright-core`) navigate/snapshot/click/type/screenshot/console-log tools, using Playwright's `ariaSnapshot`/`aria-ref=` mechanism for element targeting. Single page/tab in this version.

### New: Verification pipeline (`run_verification` tool)

Auto-detects and runs a package.json-based project's build/typecheck/lint/test scripts, reports pass/fail with output.

### Known limitations (superseded in part - see the "Unreleased" section above)

Multi-tool-per-turn is now supported for native tool-calling providers (see above); the XML fallback grammar and the browser tool remain single-item-at-a-time. MCP registry/SkillNet results still require the user to manually add them (no automated install, by design). A genuine Windows build still hasn't been produced, but there's now a CI workflow to produce one on a real Windows runner - see `docs/integrations/windows-build.md`.
