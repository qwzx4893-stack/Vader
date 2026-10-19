# The interface: the Vader window, Settings, the chat and the first run

The app opens on **the Vader window**: a page over the editor (below the title bar) with a sidebar of projects and conversations, the conversation, All agents,
search, Add-ons, and Settings above all of it. It is the interface agreed on the design canvas (boards R01 to R30, S01 to S14, W02), built as real components on
the app's own services, not pictures. "Open in editor" goes to the editor layout, and the button in the chat title brings the window back. The setting
`vader.window.agentsFirst` (default on) chooses which one the app opens on.

## Where things are

| Part | Code | What it uses |
|---|---|---|
| The window, sidebar, search | `browser/vaderShellService.ts`, `vaderShellPane.ts`, `react/src/vader-shell-tsx/` | `IChatThreadService` (conversations, projects, status), commands |
| All agents (groups, tabs, filter, detail) | `AgentsPage.tsx`, `common/shellModel.ts` | thread status from `common/threadStatus.ts` |
| A conversation: chat, Review, Browser, Terminal | `ConversationPage.tsx`, `ReviewView.tsx`, `BrowserView.tsx`, `TerminalView.tsx` | the edit service (accept/reject), `IVerificationService`, the browser and terminal tool services |
| First run in three steps | `react/src/vader-onboarding/VaderOnboarding.tsx` | `IVaderSettingsService`, `IRefreshModelService` (the key is really tested), `IPolicyService`, `IWorkspaceContextService`, `IAgentGatewayService` |
| Settings, 14 pages | `react/src/vader-settings-tsx/` (`SettingsApp.tsx` and one file per page) | the same services as the rest of the app |
| The chat | `react/src/sidebar-tsx/SidebarChat.tsx`, `RunStateCards.tsx` | `IChatThreadService` |
| Rules without the editor | `common/shellModel.ts`, `reviewModel.ts`, `runStateModel.ts`, `chatExport.ts`, `settingsInput.ts` | none (pure, tested on their own) |

## What the chat says about a run (`RunStateCards.tsx`, `common/runStateModel.ts`)

- **Stopped by you**: the chat service remembers what the run was doing (`ThreadType.stopped`), and the next message clears it. Continue the task sends "Continue the task from where you stopped." (one message, as the person would write it).
- **Messages that wait** (`ThreadType.queued`, at most five): Enter during a run queues the message; it is sent, in order, when the run **finishes on its own**. After a stop or an error the queue stays in the list. **Send now** stops the run and sends that message. (The boards show a message going out after the current *step*; the app sends it after the current *run*, because injecting a message into a step that is running would change what the model sees mid-turn.)
- **The conversation is getting full**: shown from 60% of the room a request may use (the model's window less what is kept for the answer). The thresholds in the words are the real ones from `common/contextBudget.ts`: old tool output is dropped from 50%, older messages are summarised from 70%. **Summarise now** runs the same summary on demand; **Start a new chat with a summary** starts a chat whose first entry is that summary.
- **Paused**, **finished with changes** (in the window, with Review changes), **no model** (with the way to Settings, Models), **a long paste** (folded to one line above the box above 12 lines or 1,500 characters, sent in full inside a code block with the message), **offline** (what still works).
- **Looking back**: Branch the chat (a new chat with everything before a message; the original is unchanged), going back to a checkpoint asks first, a chat can be renamed, exported as Markdown (`common/chatExport.ts`, no keys, no settings) or deleted after a question.

## What the safety gate says (`GateCards.tsx`, `common/gateModel.ts`; boards S02 and R07)

The gate keeps what it decided with each tool message (`ToolMessage.gate`: the rule, the agent's scope, or the read-only mode), and the chat says it in words made from that, never from a guess:

- **It asks**: a command (the exact line, where, "It can write files"), a file outside the project (new rule `vader.ask.outside-project-read`), a page on a site that is new to the project (`vader.ask.network-new-host`; localhost and private networks are never new; "Allow this host here" keeps the host, not the page, in the project's list and shows on the Permissions page as a Site), installing a skill (it is stored switched off; Read it first shows the instructions), a tool of an MCP server, a rule of the person's own (named, "asks in every mode", Change the rule goes to Permissions).
- **It refuses**: a private key or stored login (`vader.deny.credential-files`, locked: SSH private keys, AWS credentials, GPG private keys, git credentials), a command outside an agent's own folders, a mode that is read-only (Switch to Agent), and every other locked rule.
- **A key in a message is never sent** (`common/secretScan.ts`): the text is looked at before it leaves, the key is replaced by its first five and last four characters, and the card says which kind it looked like.

## The message box (boards R06, S03, R01)

- **One footer row**: Mode, model, Permissions, Add context on the left; Thinking (a chip with a small panel), the context ring and Send on the right. The empty box says what the mode is for ("Tell the agent what to change, or press / for commands").
- **Mode and Permissions menus** (`ComposerMenus.tsx`): a line of what each does, Ctrl 1 to 4 for the modes (in the message box), and under Permissions the line that locked rules apply in every mode.
- **`/` commands** (`common/slashCommands.ts`): `/plan` switches mode, `/compact` summarises now, `/review` runs the independent check (`IVerificationService`), `/remember <note>` saves a project note as the person's own (Settings, Memory), `/init` asks the agent for an AGENTS.md.
- **`@` menu**: files and folders as paths, and under Also the terminal output, the open page of the agent's browser and the git changes (`common/contextSources.ts`), each offered only when it has something, read when chosen, kept beside the message as one line with Show and Remove, and sent in full under its heading. Image from the clipboard is offered too, saying whether the chosen model reads images.
- **Files and images dropped, pasted or taken from the clipboard** (`common/attachmentRules.ts`, `common/imageRules.ts`): up to 10 text files of 5 MB each and up to 4 images (PNG, JPEG, WebP, GIF) per message; an image shows as a small picture with its name and size, can be removed, and goes to the chosen model only. A model that cannot read images says so by name before anything is sent, and Send waits (Choose another model, Remove the image). Other binary files are refused with the reason.
- **The context ring** opens what the window is made of (system and tools, files and tool output, the conversation, a summary) with the real thresholds and Compact now. A chat that is already bigger than a smaller model's window says so before the request fails (Choose a larger model, Summarise first, Go on and cut).
- **The model picker** (`vader-settings-tsx/ProviderModelPicker.tsx`): search across providers, providers without a key offered with Add, a list being asked for keeps the saved one (marked "saved list"), a list that could not be fetched says so with Try again, a search that finds nothing says where it looked. Lists are asked for again when the picker opens if they are older than ten minutes.

## Looking back through a chat (board S13)

Under each message: Copy, **Redo from here** (the same message sent again from its place, what came after is replaced) and Branch the chat. A long command result is folded to its head with "… 406 more lines" and Show all (`common/outputFold.ts`; the agent always got all of it). **Checkpoints** (under the message box once a chat has two) lists every checkpoint newest first with what its step changed (`common/checkpointModel.ts`): pick one to Go back to it (after the question), pick two to see the files that changed between them.

## What the agent can reach, and how it can fail (boards S07 and S14)

The words are made from the messages the app really raises, the real error is always shown under them, and an error that is not recognised gets no invented words.

- **MCP servers** (Settings, MCP servers; `common/mcpStateWords.ts`): "starting" says that the first start can take a moment only for programs that download (`npx`, `uvx`, `docker`); a server that did not start says what is wrong (a program that is not found is named, with what to install; a timeout; a refused key; no permission; an address that cannot be reached), with Edit the command (opens the config) and Try again (off and on); a running server says how many tools it has and that each use goes through the safety gate.
- **Connected agents in the chat** (`common/externalAgentWords.ts`): a sign-in that is needed (I signed in sends the message again), and a program that stopped by itself (how it ended, that the chat is kept, Start it again).
- **A command's header** says how it ended, "exit 0, 41 s" (green) or "exit 1, 3 s" (red), and a long result says its lines (`ToolMessage.durationMs` is kept with the result).
- **An edit that could not be applied** (`common/editErrorWords.ts`, board S08): the part that did not fit (text no longer in the file, text that appears more than once, two changes on the same lines), that nothing was written, and Try again / Rewrite the whole file, which ask the agent in words. The ghost-text suggestions, the Ctrl K bar and the in-file accept and reject of that board are the editor's own widgets and keep their own look.
- **The agent's browser** (`common/browserErrorWords.ts`): a page that stopped responding, a page that changed under the agent, a page that did not load in 30 seconds.

## Parallel runs (board R05)

The tasks an agent splits a job into (`IAgentOrchestrationService`, one copy of the project and one branch for each task that edits files) are listed at the top of All agents (`vader-shell-tsx/ParallelRuns.tsx`, `common/parallelRunModel.ts`): the task and how long it took, its helper, its branch, where it stands (Merged cleanly, No changes, Conflict in N files, Working, Could not merge, Checks failed, Failed) and how many files. A conflict names the file and offers the three ways out the service really has: **Let an agent merge them** (in the task's own folder first), **Keep the current version**, **Keep this task's version**, and Open the file; when the service cannot do it, its reason is shown. Stop all cancels the run.

## A task's own copy of the project (boards S06 and R01)

In Agent mode the agent works in a copy of the project made with git (`taskCopyService.ts`, `common/taskCopyModel.ts`): a worktree on its own branch (`agent/rate-limiter-a1b2`) next to the folder, never inside it. It is made before the agent's first step; if the task changes nothing it is removed again.

- **Before it starts**: a folder that is not a git project asks "Start git here" (a first commit of what is there) or "Use Chat"; uncommitted changes ask "Start anyway", "Commit them first" or "Cancel" (once for a chat, not before every message); a copy that could not be made offers "Work in the folder instead".
- **While it works**: the agent is told the copy's folder is its workspace; every file path and every command folder it uses is moved from your folder to the copy when the call runs (`remapToolParams`). The Review page shows the copy's files, relative to the copy. The card says the branch, where it came from and how many files changed.
- **Merge into main**: commits the copy and merges it into the branch you are on. Cards: "Merged into main" (Undo the merge, Done), "This task conflicts with main" (Keep my version, Keep the task's version, Ask an agent to merge, which shows each file as Resolving or Resolved while the agent works in the copy), "Could not merge" (git's own words; when it stopped on your uncommitted changes it says that this is not a conflict between tasks and offers "Stash my changes and retry", which puts them back afterwards or keeps them in git's stash and says so), and "Discard this task?", which says exactly what disappears.
- The conflict code (`common/worktree/conflictResolution.ts`) is the one parallel tasks use.
- **All agents** lists the branch of each task (its copy's branch, the branch it merged into, or "in place" for a task with no copy), the lines it added and removed, and in the detail the copy's folder and how many files differ from the branch it came from.

## Motion

A page settles in when it opens (the Vader window, each Settings page), popovers and questions rise, hover changes ease and the switch slides, all in 120 to 180 ms (`vader-shell-tsx/shell.css`; the chat's cards and menus use `animate-card-in`, `react/tailwind.config.js`). With the system setting "reduce motion" none of it moves (`prefers-reduced-motion`); `shellUiE2E` and `pickerUiE2E` check both. Searching Settings for something that is not there offers the nearest places (`common/settingsSearch.ts`).

## Settings (boards R08 to R30)

Models (features, local servers, 45 cloud providers with live lists and Test connection), Model router, Connected agents, Permissions (mode, commands allowed in this project, the locked rules and the rules that ask, your own rules), Usage and cost (per model, per day, "estimate" or "billed by provider" for every number; `common/usageAccounting.ts` keeps a per-model ledger for 62 days), Saved agents, Skills (trust computed from live facts, with the reasons), MCP servers, Memory and instructions, Editor extensions, Editor, Privacy and network, Data and backup, About and updates.
A number that cannot be used (`five`, `250%`) is refused in words and the text stays (`common/settingsInput.ts`).

**Data and backup** (`common/backupModel.ts`): one file (`vader-backup-<day>.json`) with the chats, the saved agents, the rules the person wrote and the settings, without API keys and without the contents of projects. Restoring only **adds**: chats and agents that are already here are kept as they are, nothing is overwritten, and the question says how many will be added before it does anything. Deleting all chats says how many, that it cannot be undone and what stays.

**Updating Vader** (`common/updateModel.ts`, `electron-main/updateDownloader.ts`, `vaderUpdateMainService.ts`, `UpdateCards.tsx`; board S11): a check (About and updates, or the automatic one when it is on) compares the newest GitHub release with the running version. A newer one is offered as "Vader 1.4.0 is ready" with a line from its notes, Download, Read what changed and Later. Download fetches `Vader-Setup-<arch>-<version>.exe` from GitHub only (every redirect must stay on GitHub's hosts), shows MB of MB, checks the size and the checksum GitHub states, and keeps nothing half done; Cancel stops it. A failure says where it stopped and that the running version is fine. When it is downloaded, "Restart now" starts the installer (`/SILENT /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS`) and closes Vader, and "Restart when tasks finish" waits until no task is working (kept by `vaderUpdateCoordinator.ts`, so it also happens with Settings closed). Nothing is installed without a click. Only Windows has an installer; elsewhere the offer opens the release page. The installer is unsigned unless the repository has a certificate, so Windows may ask before running it.

## How it is tested

| Test | What it drives | Checks |
|---|---|---|
| `shellUiE2E` | the window in headless Chromium: sidebar, All agents, search, Review, Browser, Terminal, rename/export/delete | 86 |
| `onboardingUiE2E` | the three steps, a key that works / is refused (401) / cannot be reached, a local model, the folder, permissions, the first task | 47 |
| `settingsUiE2E` | every Settings page against objects of the page | 232 |
| `chatUiE2E` | the **real** chat component (markdown, apply buttons and the model picker stubbed): each state above, the gate cards, the menus, `/` and `@`, the drop zone, images, the task's own copy, and the chat at the width it has in the window (screenshots go to the temp folder) | 257 |
| `pickerUiE2E` | the real model picker in each state of board S04 | 26 |
| `shellModelE2E`, `runStateModelE2E`, `chatExportE2E`, `settingsInputE2E`, `usageAccountingE2E` | the pure rules | 28, 32, 12, 8, 46 |
| `gateModelE2E`, `policyGateRulesE2E`, `slashCommandsE2E`, `contextSourcesE2E`, `attachmentRulesE2E`, `modelPickerE2E` | the words and rules of the gate, the commands, the sources and the drop | 21, 16, 12, 11, 14, 32 |
| `updateE2E` | the update words and rules, and the download run for real against a local web server: whole file, progress, redirect, a host that is not GitHub, a 404, a dropped connection, a wrong size or checksum, Cancel | 23 |
| `taskCopyModelE2E`, `gitWorktreeCopyE2E` | the branch names, path moves and words of a task's own copy; the git work behind it (copy, merge, undo, conflict, stash) **run for real** against throw-away repositories | 29, 25 |
| `test/e2e/scenarios/shell.mjs` | the **packaged app** (CI only): first run, a conversation, All agents, search, Add-ons, Settings, to the editor and back, with screenshots | runs in `windows-e2e.yml` |

All of these run without opening a window. The packaged app itself can only be run on the Windows build (`windows-build.yml`, `windows-smoke.yml`, `windows-e2e.yml`).

## Honest limits

- **The task's own copy is only as good as git and the open editors.** It needs a git project (Vader offers to start git in a folder that is not one, with a first commit of what is there). Files the agent changes in an open editor are written to disk before a command runs and before the merge; the agent's searches by file name still look at your folder, but every path it then reads, edits or runs a command in is moved to the copy (`taskCopyService.remapToolParams`, applied after the safety gate, which judges the paths as the agent wrote them). MCP tools and the agent's browser know nothing of the copy. Undo the merge makes a new commit that reverses the merge (history is never rewritten), so it is refused by git while your own uncommitted changes touch the same files. Turn the whole thing off in Settings, Permissions, Work in a copy of the project: the agent then edits the folder directly, as before. The packaged app has not been run on this machine; the git work is tested against real repositories (`gitWorktreeCopyE2E`).
- **Images are sent as the model's own image input only when the model reads images** (`modelSupportsVision`, a list by model family: a model it does not know is treated as not reading them, so it is told so rather than sent one). The latest three messages that carry images keep them in every request; an older one is named, not repeated. An image is made smaller (longest side 1568) before it is kept with the chat. A connected agent (Codex and the others) is not offered images, because Vader cannot know what its own model reads.
- The window screenshots of the test show the chat at 780 pixels (its width in the window) beside a stand-in model button; the packaged app itself has not been run on this machine.
- The Browser tab shows a picture of the agent's page every second and a half; **taking over the page** is not possible because the agent's browser has no window of its own (Open in my browser opens the same address in yours).
- **"Used the skill pdf" (board S13) is not shown, on purpose**: Vader puts every enabled skill into the instructions of every request, it does not pick a skill per task, so the chat cannot truthfully say that one was used for this task. An MCP server that asks for a sign-in is shown as failed with its real error, with no Sign in button.
- **Compare 1 and 3** lists the files that changed between two checkpoints and how many lines; it does not open a side-by-side diff. The counts come from the file copies the checkpoints keep, so they are exact for those files only.
