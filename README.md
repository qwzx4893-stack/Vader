# Vader

Vader is a modular, AI-native IDE built on the [Void](https://github.com/voideditor/void) / [VS Code](https://github.com/microsoft/vscode) foundation.

Void started as an open-source, privacy-respecting AI code editor and was later deprecated by its original maintainers (see [Void's own README](https://github.com/voideditor/void#readme)). Vader takes that codebase as its upstream technical and UI foundation — the editor shell, workbench, chat/inline-edit UX, and diff/review experience are all inherited from Void largely as-is — and builds a substantially stronger agent platform on top of it: policy-gated tool execution, permanent and temporary agents, layered instructions, MCP, skill discovery, browser automation, and checkpointed/verifiable edits.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for how the new agent platform is put together, [`PROVIDERS.md`](./PROVIDERS.md) for supported model providers, and [`docs/integrations/`](./docs/integrations/) for how to add or replace a subsystem.

## What's here vs. what's inherited

- **Inherited from Void (mostly unchanged):** the editor shell and VS Code workbench, the chat/agent UI, inline Ctrl+K edits, the streaming diff/apply engine, checkpoints, the terminal tool, and the original multi-provider LLM abstraction (Anthropic, OpenAI, Gemini, and OpenAI-compatible endpoints including Ollama, LM Studio, vLLM, OpenRouter, and more).
- **New in Vader:** a hard policy engine that gates tool/terminal execution before it runs (not just model-obedience), permanent/persistent agents with their own instructions and permissions, temporary subagent delegation, a layered instruction system, MCP registry discovery with lazy tool exposure, a SkillNet-backed skill provider, a Playwright-based browser automation tool, and a capability bus that unifies all of the above behind one interface.
- **Rebranded, not redesigned:** the visual identity (name, icons where practical, window/application metadata, About dialog, settings copy) says "Vader," but the original Void interaction design is intentionally preserved rather than reworked.

## Building and running

This is a VS Code-family Electron application. From a clean checkout:

```bash
npm install
npm run buildreact   # builds the React chat/settings UI bundle
npm run compile      # compiles the TypeScript workbench/extensions
./scripts/code.sh    # launch a dev build (macOS/Linux)
```

On Windows, use `scripts\code.bat`. See [`HOW_TO_CONTRIBUTE.md`](./HOW_TO_CONTRIBUTE.md) for the full development setup this project inherited from Void, and the build pipeline under `build/` (including `build/gulpfile.vscode.win32.js` and `build/win32/code.iss`) for producing an installable Windows build.

## License and attribution

Vader is licensed under the MIT license (see [`LICENSE.txt`](./LICENSE.txt)), the same as the underlying VS Code and Void code it builds on (see [`LICENSE-VS-Code.txt`](./LICENSE-VS-Code.txt) and [`ThirdPartyNotices.txt`](./ThirdPartyNotices.txt)). Void's own additions were originally released under the Apache License 2.0 by Glass Devtools, Inc.; those notices are preserved in the relevant source files rather than removed.

## Support

This project is maintained on GitHub at [qwzx4893-stack/Vader](https://github.com/qwzx4893-stack/Vader). Please open an issue there for bugs or questions.
