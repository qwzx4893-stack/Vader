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

## Settings (boards R08 to R30)

Models (features, local servers, 45 cloud providers with live lists and Test connection), Model router, Connected agents, Permissions (mode, commands allowed in this project, the locked rules and the rules that ask, your own rules), Usage and cost (per model, per day, "estimate" or "billed by provider" for every number; `common/usageAccounting.ts` keeps a per-model ledger for 62 days), Saved agents, Skills (trust computed from live facts, with the reasons), MCP servers, Memory and instructions, Editor extensions, Editor, Privacy and network, Data and backup, About and updates.
A number that cannot be used (`five`, `250%`) is refused in words and the text stays (`common/settingsInput.ts`).

## How it is tested

| Test | What it drives | Checks |
|---|---|---|
| `shellUiE2E` | the window in headless Chromium: sidebar, All agents, search, Review, Browser, Terminal, rename/export/delete | 86 |
| `onboardingUiE2E` | the three steps, a key that works / is refused (401) / cannot be reached, a local model, the folder, permissions, the first task | 47 |
| `settingsUiE2E` | every Settings page against objects of the page | 214 |
| `chatUiE2E` | the **real** chat component (markdown and apply buttons stubbed): each state above | 80 |
| `shellModelE2E`, `runStateModelE2E`, `chatExportE2E`, `settingsInputE2E`, `usageAccountingE2E` | the pure rules | 28, 25, 12, 8, 46 |
| `test/e2e/scenarios/shell.mjs` | the **packaged app** (CI only): first run, a conversation, All agents, search, Add-ons, Settings, to the editor and back, with screenshots | runs in `windows-e2e.yml` |

All of these run without opening a window. The packaged app itself can only be run on the Windows build (`windows-build.yml`, `windows-smoke.yml`, `windows-e2e.yml`).

## Honest limits

- A task edits the project in place. **A copy of the project per task (the branch names in boards R01 and S06) is only used for parallel tasks** (`orchestrationService`), not for the main agent.
- **Images cannot be attached to a message** (no provider path carries them yet), so the boards' image states (the model cannot read images, a file dropped on the box) are not built. Text and files are mentioned with `@`.
- The Browser tab shows a picture of the agent's page every second and a half; **taking over the page** is not possible because the agent's browser has no window of its own (Open in my browser opens the same address in yours).
- Skills that were used in a task are not announced in the chat ("Used the skill pdf"); an MCP server that asks for a sign-in is shown as failed with its real error, with no Sign in button.
- Checkpoints list ("Compare 1 and 3") and the per-step change counts of board S13 are not built; Restore (with its question) is.
