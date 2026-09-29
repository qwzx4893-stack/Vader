# Vader

**A real agent platform for your editor — not a chat sidebar bolted onto one.**

Vader is a policy-governed, multi-agent coding environment built on the mature, battle-tested
[VS Code](https://github.com/microsoft/vscode) / [Void](https://github.com/voideditor/void)
foundation. It keeps the editor experience millions of developers already know — the workbench,
the terminal, the diff/review flow — and replaces what sits behind the chat panel with a platform
built for agents that actually execute: gated tool calls, isolated parallel work, independent
verification, and a provider layer that speaks to a dozen+ model vendors out of the box.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE.txt)

---

## Why Vader

Most "AI editors" are a chat window that happens to live next to your code. Vader treats an agent
the way you'd treat a new engineer with real filesystem and terminal access: **never trust,
always gate.**

- 🛡️ **A hard policy engine, not a suggestion.** Every tool call and terminal command is checked
  against allow/ask/deny rules *before* it runs - independent of what the model decides to do, and
  independent of the approval UI. `locked` rules can never be disabled from settings, by design.
- 🧠 **Real multi-agent orchestration.** Permanent, named agents with their own instructions and
  tool restrictions; one-off subagent delegation; bounded-concurrency parallel task execution with
  real git-worktree isolation so parallel agents can never step on each other's changes.
- ✅ **An agent that checks its own work.** An independent Verification Agent - hard-enforced
  read-only, with no memory of *how* the change was made - judges whether a task actually
  succeeded, with a bounded verify → repair → re-verify loop.
- 🔌 **Broad, real provider support.** Anthropic, OpenAI, Gemini, OpenRouter, Mistral, MiniMax,
  Alibaba/Qwen, Moonshot/Kimi, OpenCode, Ollama, LM Studio, vLLM, and any OpenAI-compatible
  endpoint - through one normalized transport layer with real cancellation, timeouts, and error
  classification, not per-provider special cases bolted on over time.
- 🌐 **Tools that go beyond the editor.** A full Playwright-backed browser automation tool
  (navigate, click, screenshot, read console/network logs), MCP server support with one-click
  configuration, and a federated marketplace across extensions, skills, and MCP servers.
- 🧩 **Context that's actually relevant.** A per-turn Context Engine ranks and budgets symbol
  outlines, diagnostics, and git history instead of dumping the whole repo at the model; memory
  and structured compaction keep long sessions coherent instead of silently truncating.
- 🔍 **Built to be inspected, not just trusted.** Every major claim about this platform's behavior
  is backed by real, non-mocked tests you can run yourself - see
  [`FINAL_PRODUCTION_READINESS_REPORT.md`](./FINAL_PRODUCTION_READINESS_REPORT.md) for an
  evidence-tagged account of exactly what's verified and how.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how the platform is put together,
[`PROVIDERS.md`](./PROVIDERS.md) for the full provider matrix, and
[`docs/integrations/`](./docs/integrations/) for how to add or replace any subsystem.

## Download

Prebuilt Windows installers are published on the
[**Releases**](https://github.com/qwzx4893-stack/Vader/releases) page. macOS and Linux builds are
produced from the same pipeline (see [Building and running](#building-and-running) below to build
one yourself in the meantime).

## What's here vs. what's inherited

- **Inherited from Void (mostly unchanged):** the editor shell and VS Code workbench, the
  chat/agent UI, inline Ctrl+K edits, the streaming diff/apply engine, checkpoints, and the
  terminal tool.
- **New in Vader:** the hard policy engine; permanent/persistent agents; temporary subagent
  delegation; parallel agent orchestration with git-worktree isolation; the independent
  Verification Agent; a layered instruction system; MCP registry discovery with lazy tool
  exposure; a SkillNet-backed skill provider; Playwright-based browser automation; a per-turn
  Context Engine; persistent memory and compaction; a Unified Capability Marketplace; and a
  capability bus that unifies all of the above behind one interface.
- **Rebranded, not redesigned:** the visual identity (name, icons where practical, window/
  application metadata, About dialog, settings copy) says "Vader," but the original Void
  interaction design is intentionally preserved rather than reworked.

## Building and running

This is a VS Code-family Electron application. From a clean checkout:

```bash
npm install
npm run buildreact   # builds the React chat/settings UI bundle
npm run compile      # compiles the TypeScript workbench/extensions
./scripts/code.sh    # launch a dev build (macOS/Linux)
```

On Windows, use `scripts\code.bat`. See [`HOW_TO_CONTRIBUTE.md`](./HOW_TO_CONTRIBUTE.md) for the
full development setup this project inherited from Void, and the build pipeline under `build/`
(including `build/gulpfile.vscode.win32.js`, `build/win32/code.iss`, and
[`.github/workflows/windows-build.yml`](./.github/workflows/windows-build.yml)) for producing an
installable Windows build - the same pipeline that produces the Releases page builds above.

## License and attribution

Vader is licensed under the MIT license (see [`LICENSE.txt`](./LICENSE.txt)), the same as the
underlying VS Code and Void code it builds on (see
[`LICENSE-VS-Code.txt`](./LICENSE-VS-Code.txt) and
[`ThirdPartyNotices.txt`](./ThirdPartyNotices.txt)). Void's own additions were originally released
under the Apache License 2.0 by Glass Devtools, Inc.; those notices are preserved in the relevant
source files rather than removed.

## Support

This project is maintained on GitHub at
[qwzx4893-stack/Vader](https://github.com/qwzx4893-stack/Vader). Please open an issue there for
bugs or questions.
