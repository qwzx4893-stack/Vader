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
- **`@` menu**: files and folders as paths, and under Also the terminal output, the open page of the agent's browser and the git changes (`common/contextSources.ts`), each offered only when it has something, read when chosen, kept beside the message as one line with Show and Remove, and sent in full under its heading. Image from the clipboard is not offered (see the limits).
- **Files dropped on the box** (`common/attachmentRules.ts`): up to 10 text files of 5 MB each; images and other binary files are refused with the reason.
- **The context ring** opens what the window is made of (system and tools, files and tool output, the conversation, a summary) with the real thresholds and Compact now. A chat that is already bigger than a smaller model's window says so before the request fails (Choose a larger model, Summarise first, Go on and cut).
- **The model picker** (`vader-settings-tsx/ProviderModelPicker.tsx`): search across providers, providers without a key offered with Add, a list being asked for keeps the saved one (marked "saved list"), a list that could not be fetched says so with Try again, a search that finds nothing says where it looked. Lists are asked for again when the picker opens if they are older than ten minutes.

## Settings (boards R08 to R30)

Models (features, local servers, 45 cloud providers with live lists and Test connection), Model router, Connected agents, Permissions (mode, commands allowed in this project, the locked rules and the rules that ask, your own rules), Usage and cost (per model, per day, "estimate" or "billed by provider" for every number; `common/usageAccounting.ts` keeps a per-model ledger for 62 days), Saved agents, Skills (trust computed from live facts, with the reasons), MCP servers, Memory and instructions, Editor extensions, Editor, Privacy and network, Data and backup, About and updates.
A number that cannot be used (`five`, `250%`) is refused in words and the text stays (`common/settingsInput.ts`).

## How it is tested

| Test | What it drives | Checks |
|---|---|---|
| `shellUiE2E` | the window in headless Chromium: sidebar, All agents, search, Review, Browser, Terminal, rename/export/delete | 86 |
| `onboardingUiE2E` | the three steps, a key that works / is refused (401) / cannot be reached, a local model, the folder, permissions, the first task | 47 |
| `settingsUiE2E` | every Settings page against objects of the page | 214 |
| `chatUiE2E` | the **real** chat component (markdown, apply buttons and the model picker stubbed): each state above, the gate cards, the menus, `/` and `@`, the drop zone, and the chat at the width it has in the window (screenshots go to the temp folder) | 178 |
| `pickerUiE2E` | the real model picker in each state of board S04 | 26 |
| `shellModelE2E`, `runStateModelE2E`, `chatExportE2E`, `settingsInputE2E`, `usageAccountingE2E` | the pure rules | 28, 32, 12, 8, 46 |
| `gateModelE2E`, `policyGateRulesE2E`, `slashCommandsE2E`, `contextSourcesE2E`, `attachmentRulesE2E`, `modelPickerE2E` | the words and rules of the gate, the commands, the sources and the drop | 21, 16, 12, 11, 14, 32 |
| `test/e2e/scenarios/shell.mjs` | the **packaged app** (CI only): first run, a conversation, All agents, search, Add-ons, Settings, to the editor and back, with screenshots | runs in `windows-e2e.yml` |

All of these run without opening a window. The packaged app itself can only be run on the Windows build (`windows-build.yml`, `windows-smoke.yml`, `windows-e2e.yml`).

## Honest limits

- A task edits the project in place. **A copy of the project per task (the branch names in boards R01 and S06) is only used for parallel tasks** (`orchestrationService`), not for the main agent.
- **Images cannot be attached to a message** (no provider path carries them yet), so the boards' image states (the model cannot read images, an image from the clipboard) are not built; a dropped image is refused with that reason. Text files can be dropped, and files and sources are mentioned with `@`.
- The window screenshots of the test show the chat at 780 pixels (its width in the window) beside a stand-in model button; the packaged app itself has not been run on this machine.
- The Browser tab shows a picture of the agent's page every second and a half; **taking over the page** is not possible because the agent's browser has no window of its own (Open in my browser opens the same address in yours).
- Skills that were used in a task are not announced in the chat ("Used the skill pdf"); an MCP server that asks for a sign-in is shown as failed with its real error, with no Sign in button.
- Checkpoints list ("Compare 1 and 3") and the per-step change counts of board S13 are not built; Restore (with its question) is.
