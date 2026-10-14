# Coding agents you already have an account with

**Settings > Models > Coding Agents** lets a person use the subscription or free tier they already have with Codex, Cursor, OpenCode, GitHub Copilot, Mistral Vibe,
Grok Build, Kimi, Antigravity, Claude Code or Freebuff inside Vader, or add any other program that speaks the Agent Client Protocol. One card per agent, with its logo.

Code: `common/externalAgents/` (catalog, types, protocol rules, the registry snapshot, logos), `electron-main/externalAgentMainService.ts` (install, start,
protocol), `browser/externalAgents/externalAgentsService.ts` (status, install / test / remove actions, per-chat settings), `browser/chatThreadService.ts`
(`_runExternalAgentTurn`), `browser/react/src/vader-settings-tsx/ExternalAgents.tsx` (cards and the chat picker).
Tests: `test/externalAgentE2E.mjs` (120 checks against `test/fixtures/fakeAcpAgent.cjs`), `test/externalAgentLiveE2E.mjs` (46 checks against the **real** vendor programs),
`test/e2e/scenarios/externalAgents.mjs` (the real app).

## Two ways in, chosen by what each vendor officially supports

| Agent | Way | Why this way (checked, see the audit below) |
|---|---|---|
| **Codex** | ACP, `@agentclientprotocol/codex-acp` (npm) | The Agent Client Protocol (the one Zed and JetBrains use) is the standard way an editor drives a coding agent; the adapter is in the public ACP registry. |
| **GitHub Copilot** | ACP, `@github/copilot` (npm, `--acp`) | GitHub's own CLI speaks ACP (listed in the registry). Its login is a terminal command (`copilot login`) that the agent describes in `_meta["terminal-auth"]`. |
| **Mistral Vibe** | ACP, `vibe-acp` (GitHub release binary) | Mistral's own ACP build; browser sign-in; the registry publishes a checksum for every platform. |
| **Grok Build** | ACP, `@xai-official/grok` (npm, `agent stdio`) | xAI's own CLI; "Sign in with Grok" through the agent's own page; paid SuperGrok or X Premium+ only. |
| **Kimi** | ACP, `kimi acp` (GitHub release binary) | Moonshot's own CLI; terminal login (`kimi login`); checksum published. |
| **OpenCode** | ACP, `opencode acp` (GitHub release binary) | Native ACP mode; the registry publishes a checksum. |
| **Cursor** | ACP, `agent acp` (Cursor's documentation; the download from downloads.cursor.com holds it as `cursor-agent`, which is also looked for) | Cursor's own CLI speaks ACP and advertises the sign-in method `cursor_login`. The registry publishes no checksum for it. |
| **Antigravity** | ACP, `agy_acp_server` (binary from dl.google.com) | Google ships an agent server for editors and lists it in the ACP registry (authors: Google LLC). The `agy` terminal CLI has no protocol mode. |
| **Claude Code** | the unmodified official program in a Vader terminal | Anthropic restricts its consumer subscriptions to its own products (see the audit below). Hosting the official binary, with Anthropic's own sign-in, is the allowed shape. |
| **Freebuff** | the official `freebuff` CLI in a Vader terminal | It has no integration protocol (checked: no ACP mode, not in the registry). |
| Anything else | ACP, "Your own agent" | Name, program, arguments, entered by the person after a confirmation. |

## Detect, install, connect: what a card does

1. **Detect.** Before a card offers anything to download, Vader looks for the program on this computer (the PATH and the vendor's usual folder). A program that is found is started once for the protocol handshake: only
   one that answers is used (`source: 'local'`, "Found on this computer: nothing is downloaded", the sign-in it already holds counts). The answer is remembered for ten minutes. This starts a few well-known program names
   from the person's own PATH when the Coding Agents page opens, and nothing else; a program with the right name that does not speak the protocol (an old version, another tool) is not used and the card offers "Install".
   Terminal agents (Claude Code, Freebuff) are only looked for, never started by the page.
2. **Install** (only when nothing usable was found): shows what will be downloaded and from where, asks, installs into Vader's own folder. A copy installed by Vader is the only one Vader updates or removes.
3. **Connect.** The page asks every ready agent whether it can start a conversation without a sign-in (`session/new` in an empty folder; nothing is sent to a model). "Not connected" shows the **Connect** button: the agent's own
   sign-in is started (the vendor's page opens, or the vendor's own login runs in a terminal); the card turns to **Connected** when it is done. Terminal logins are watched for up to five minutes. **Sign out** (under "More") calls the agent's
   own `logout` when it has one.
4. **Use in the chat.**

Buttons per card, one primary at a time: `Install` → `Connect` → `Use in the chat` (or `Use my models instead` when it is in use), plus `Website`, plus `More` (Test connection, Sign out, Remove) for installed chat agents and `Update to X`
when Vader's own copy is behind. Terminal agents have one button: `Connect` (it opens the vendor's program in a terminal, where its first run signs in) which says `Open in a terminal` afterwards.

## Who does what

- **Sign-in is the vendor's.** An ACP agent that needs an account answers "authentication required"; Vader then asks the agent to sign the person in, which opens
  the vendor's own page in the browser, or (for agents that ask for it) runs the vendor's login command in a Vader terminal. Vader never receives, stores or
  forwards a password or token, and has no code that reads the vendor's credential files.
- **Which sign-in.** Agents list their sign-in methods in their own order, and the first is often a key: the real Codex lists "API Key" before "ChatGPT".
  Vader uses the ids the catalog names for that agent (`authPreference`), otherwise any method that signs in with an account and never one that needs a key, a
  cloud project or a gateway (`chooseAuthMethod`, tested with the verbatim answers of Gemini CLI and Codex). When only key-based methods exist it says so instead of guessing.
- **The agent keeps its own tools and its own rules.** Vader offers the agent no file or terminal services (`clientCapabilities`: `fs` off, `terminal` off); the agent
  reads and edits files itself, with its own permission model. Whenever it asks for permission (`session/request_permission`), Vader shows the question with the
  agent's own options in a dialog and passes the answer back. **Vader's policy engine, agent scopes, approval switches and checkpoints do not apply to these agents**:
  they cannot, because the tool calls never pass through Vader. This is stated on the cards.
- **Usage is counted by the vendor**, on the person's account.

## How an agent runs (and why this is the fast, safe way)

- **npm agents (Codex, Gemini CLI)** are installed once into `~/.vader-editor/agents/<id>/<version>/` with `npm install --ignore-scripts` (no package gets to run code at
  install time) and started with `node <the package's own script>`. Measured against the real programs: the handshake takes about **0.4 s**, it works offline, it runs exactly the
  pinned version, and no shell is involved, so there is nothing to quote on Windows. The first design used `npx -y`, which asks the registry on every start and can take a minute the first time.
- **Binary agents (OpenCode, Cursor, Antigravity)** are downloaded from the vendor's release location. Rules, all tested: https only; a fixed host list **and** a per-agent
  address prefix (OpenCode only from OpenCode's own GitHub releases, Cursor only from `downloads.cursor.com`, Antigravity only from `dl.google.com/agy-extensions/`);
  no credentials in the address; the archive's SHA-256 must match the registry's when the registry gives one (tested with a wrong checksum: refused, nothing left behind);
  the program path must be relative with no `..`; the download is deleted on any failure.
- **Every install is described by a `manifest.json`** (the exact command, written at install time), so an older install keeps working when Vader's own list of versions moves on, and a
  half-finished install (no manifest, a manifest pointing outside its folder, a program that is gone) is never shown as ready. An update replaces the old version only after the new one is complete.
- **Before anything is downloaded the person is asked**, with the package or the host named, whether a checksum protects it, and where it goes. Terminal agents show the vendor's install
  command and then run it in a visible terminal. "Remove" deletes what was installed.
- **One process per chat.** It is started in its own process group and stopped as a tree (`taskkill /T` on Windows), so the shell commands and language servers the agent started do not outlive it
  (tested). A chat that is quiet for 30 minutes gives its process back; at most four run at once (the longest idle one makes room). Closing a chat closes its agent.
- **A conversation outlives the process.** The agent's own conversation id is stored with the chat thread (`externalSession`, an optional field). When the process has to be started again
  (idle stop, a crash, an app restart) Vader asks the agent to continue it: `session/resume`, else `session/load` (whose replay of the old conversation is not shown a second time), else a new
  conversation, with a visible note that the earlier context could not be restored. The real Gemini CLI and Codex both advertise resume.
- **The agent's own settings.** Models, modes and "how hard to think" are offered by the agent per conversation (ACP session config options, or the older modes); the chat shows them as drop-downs
  and changes them with `session/set_config_option`. The models therefore are the ones the account offers, not a list written into Vader.
- **"Test connection"** starts the program, does the protocol handshake and stops it: it shows that the install works, which sign-in methods it offers and whether it can resume, without signing in or sending a message.
- **An expired sign-in** in the middle of a conversation is handled: the agent answers "authentication required", Vader signs in again and repeats that one message.
- **Start-up errors are explained**: when the connection drops, the reason is the program's exit with what it printed to stderr, not "connection closed".
- **Versions.** `acpRegistrySnapshot.ts` (generated by `build/lib/vader/genExternalAgents.py` from the registry) is what ships; "Check for newer agent versions" reads the live registry
  (`cdn.agentclientprotocol.com`) and keeps only entries that pass the same rules as the snapshot (`acceptRegistryDocument`). A card shows the installed version and "X is available".

## In the chat

When an agent is chosen ("Use in the chat" on its card, or the picker next to the chat box), chat turns go to it instead of a Vader model; no model needs to be configured. Its replies, thoughts,
tool calls (a quoted line with the file names it touches) and plan are streamed into the thread; Stop sends the protocol's cancel and keeps what was shown. Vader's hidden helper threads (sub-agents,
verification, research) keep using the configured models. Choosing "My models" in the picker goes back at any time.

## Settings files cannot add programs

The commands a person added by hand and which agent is in use are this computer's own choice. **Export Settings** leaves them out and **Import Settings** keeps this computer's values whatever the file
says (`common/helpers/settingsPortability.ts`, tested in `settingsPortabilityE2E`): a file that came from anyone cannot plant "run this program" and select it for the next chat message.

## Audit of the method per agent (what was checked, 12 October 2026)

- **The ACP registry** (`github.com/agentclientprotocol/registry`) lists 42 agents, every one verified by CI to answer the handshake with working `authMethods`. Entries for Codex, Gemini, OpenCode, Cursor and
  Antigravity are used as published.
- **Verified against the real programs** (`externalAgentLiveE2E.mjs`, needs the network, runs in a throw-away home folder): Gemini CLI 0.63.0 and Codex 2.2.2 install through npm, start in under a second and answer
  the handshake; OpenCode 1.19.0 downloads from GitHub, passes its checksum, unpacks and answers. Codex's real first message starts the ChatGPT sign-in. **Not verified here**: Cursor and Antigravity (their
  download hosts are not reachable from the build machine), and any complete conversation (that needs a signed-in account).
- **Codex.** The adapter's real handshake lists `API Key` before `ChatGPT`; choosing "the first method" would have signed the person into the wrong thing. Fixed, and tested with the verbatim answer.
- **Gemini CLI was removed from the page.** Google ended free Gemini CLI access for personal Google accounts and AI Pro/Ultra on 18 June 2026 (announced at I/O on 19 May; Antigravity CLI replaces it; the package itself ships a migration skill to Antigravity CLI). It still starts, but the account route that made it worth listing is gone; the Antigravity card is the Google-account one.
- **Claude Code (Anthropic's current text, `code.claude.com/docs/en/legal-and-compliance`).** Preinstalling or running Claude Code *in a product* needs Anthropic's Commercial Terms and an unmodified binary, and each end user must use their own
  plan or key; and, verbatim, the rules "do not prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code". Developers on the Agent SDK are told to use API keys,
  and "may not collect, store, or intermediate Claude.ai credentials or session tokens". Vader's shape is the clearly allowed one: the person installs Anthropic's own program with Anthropic's own installer, Vader only opens a terminal for it,
  nothing is bundled, modified or intercepted. The Claude Code name may be used in plain text; Anthropic's text says its names and logos may not be used beyond that without written permission. The card shows Claude Code's mark to identify the program (the owner of this project chose to keep it; Anthropic's trademark page says use is limited to what they permit and approve in advance, and names marketing@anthropic.com for written permission); if Anthropic objects, swapping it for a neutral glyph is one line in `build/lib/vader/genProviderLogos.py`.
  Install needs no administrator rights; Git for Windows is optional; the free claude.ai plan does not include Claude Code (the card says so). The earlier text of this paragraph (February 2026) says OAuth tokens of Free, Pro and Max plans are only for Claude Code and claude.ai, and that using them in other products, including the Agent SDK,
  is not allowed; later statements softened the billing side (June 2026) but not the rule, and the situation has changed more than once. An ACP adapter for Claude exists in the registry (`claude-acp`, authors
  Anthropic, Zed Industries, JetBrains) and uses the Agent SDK. Vader therefore keeps the conservative shape: the unmodified `claude` program in a terminal. Switching to the adapter is a catalog entry
  if the terms are confirmed to allow it.
- **Freebuff.** No ACP mode and no registry entry; its published npm package is a launcher for a hosted backend. Terminal is the only integration. Its logo is the organisation's official mark (the GitHub
  avatar of CodebuffAI: a terminal frame with a sparkle and a cursor), redrawn as vector by `build/lib/vader/genProviderLogos.py` because no vector file is published.
- **Antigravity.** The first version of this feature treated it as terminal-only because the `agy` CLI has no protocol mode. The registry shows Google's own ACP server for editors, so it is now a chat agent. Community ACP
  bridges around `agy` exist but their authors warn that they may violate Google's terms; Vader uses none of them.

## Agents considered for the page, with what the real programs answered (12 October 2026)

Each one was installed the way Vader installs agents and started; the handshake answers below are real (`/tmp` research probe, same rules as `externalAgentLiveE2E`).

| Agent | Account it uses | Sign-in as the real agent offers it | Resume | Download | Verdict |
|---|---|---|---|---|---|
| GitHub Copilot CLI (`@github/copilot`) | GitHub Copilot (a Free plan exists, Pro, Pro+) | `terminal-auth`: runs `copilot login` | no (load only) | npm, official | **add** (needs the `_meta["terminal-auth"]` convention) |
| Mistral Vibe | Le Chat Pro (about $15/month) | `browser-auth` (the agent's own page) | no (load only) | GitHub release, checksum for every platform | **add** (works with today's sign-in code) |
| Grok Build (`@xai-official/grok`) | SuperGrok / X Premium+ | "Sign in with Grok" (the agent's own page) | yes | npm, official | **add** (works with today's sign-in code; paid only) |
| Kimi CLI | Kimi membership (a free tier exists) | `terminal-auth`: runs `kimi login` | yes | GitHub release, checksum | **add** (needs the `terminal-auth` convention) |
| Cline | Cline account / ClinePass, and ChatGPT through Codex | `cline`, `cline-pass`, `openai-codex` | no | npm | good second wave |
| Junie | JetBrains AI plans (a free quota exists) | `jetbrains-account` (agent) and a terminal login | yes | GitHub release, **no checksum** | second wave, for JetBrains subscribers |
| Factory Droid | Factory plan | `device-pairing` (browser) | yes | npm | niche, paid |
| Kilo | Kilo account, rotating free models | "Run `kilo auth login`" (text only, no machine-readable command) | yes | GitHub release, checksum | needs a manual terminal step |
| Goose | none: "run `goose configure`", provider and API key | key only | no | GitHub release, checksum | not for this page (Vader already takes API keys) |
| Qwen Code | none: the free OAuth tier closed on 15 April 2026; API key only | key only | yes | npm | no |
| Auggie | Augment plan | none offered in the handshake (login happens outside) | no | npm | no |
| Claude Agent (ACP adapter) | Claude plan | `claude /login` in a terminal | yes | npm | not by default: see the Anthropic paragraph above |
| Devin, Poolside, Cortex Code | their own plans | not testable here (download hosts not reachable) | | | unverified |

Real agents do not all use the sign-in fields the protocol's newer versions define: Copilot and Kimi describe their terminal login in `_meta["terminal-auth"]` (a command, arguments and environment), Qwen in `_meta.type`, and Kilo only in
the description text. Supporting `_meta["terminal-auth"]` is a small change in `chooseAuthMethod`; it is needed before Copilot CLI and Kimi can be added.

## Honest limits

- The agents need what they need: Codex and Gemini CLI need Node.js (with npm) to be installed; OpenCode, Cursor and Antigravity are downloaded.
- Free tiers, limits, ads (Freebuff) and data use are the vendors' and can change; the cards say who is responsible instead of promising anything.
- An agent that needs a post-install script to work would not start after `--ignore-scripts`; none of the five does.
- An edit of an earlier message in a thread does not rewrite the agent's own memory of the conversation.
- Windows-specific paths (the `npm.cmd` fallback, `taskkill`) are written but were exercised only on Linux in this repository's tests; the Windows E2E workflow covers them on the next build.
