# Security

## Reporting a vulnerability

Open an issue at [qwzx4893-stack/Vader](https://github.com/qwzx4893-stack/Vader/issues). For a vulnerability in the underlying VS Code or Void code this project builds on, consider also checking whether it's already known upstream (Void is deprecated and no longer accepting reports; VS Code's own security process is at microsoft/vscode).

## What the Policy Engine does and doesn't protect against

`src/vs/workbench/contrib/void/common/policy/` gates every built-in tool call, MCP tool call, and terminal command an agent makes, before it runs - independent of the model's own behavior and of the user's auto-approve settings. A small set of `locked` rules (destructive filesystem commands, fork bombs, writes to OS-critical paths) cannot be disabled from configuration, even in Autonomous permission mode. A larger set of default-on rules (credential/key files, `sudo`, force-push, piping a download into a shell) force an approval prompt unless the user has both switched to Autonomous mode *and* the specific rule allows that (`neverBypassAutonomous: false`).

This is a **hard, code-level gate**, not a suggestion in the system prompt - a model that ignores its instructions still can't get a locked rule to allow something. It is not a sandbox: a terminal command the policy allows (or the user approves) still runs with the same OS-level permissions as the rest of the application. Vader does not run agent-initiated commands in a container or VM by default.

## Untrusted external content

Two sources bring content into a conversation that Vader did not generate and the user did not write: **MCP tool results** and **fetched skill instructions** (`fetch_skill_instructions`, from SkillNet or a linked GitHub repository). Both are treated as ordinary tool output added to the conversation, not elevated into the system/instructions layer - see `common/instructions/instructionsService.ts`'s doc comment for why that distinction matters (an instructions-layer injection is a much stronger prompt-injection vector than tool output the model is expected to weigh like any other evidence). `fetch_skill_instructions`'s result is explicitly labeled `[UNTRUSTED external content ...]` for this reason.

MCP servers themselves are configured by the user (`mcp.json`) and are not sandboxed beyond the Policy Engine's `mcp-tool` rule kind - an MCP server that runs local commands (stdio transport) has whatever access the user gave it in that config. `search_mcp_registry` returns discovery results only; it does not write to `mcp.json` or auto-connect to anything.

## Secrets

Provider API keys are encrypted at rest via the OS keychain (`IEncryptionService`), inherited from Void unchanged. `mcp.json` (including any credentials an MCP server needs, e.g. in `env`/`headers`) is stored in plaintext, also inherited from Void - be mindful of what you put there directly versus having the server read it from its own environment. Anonymous usage telemetry, which upstream Void sent to its own analytics service by default, is hard-disabled in this fork (see `electron-main/metricsMainService.ts`) - no telemetry request is made regardless of the local opt-out flag's value.

## Browser automation

The browser tool (`common/browser/`) drives a real Chromium instance that can navigate to arbitrary URLs, fill in forms, and click things, subject to the same `terminal`-tier Policy Engine gate as running a shell command. It has no separate site allowlist/denylist of its own; add a policy rule (`pathGlobs`/`commandPatterns` don't apply to URLs, so this would need a small extension - see `common/policy/policyServiceTypes.ts`) if you need to restrict which sites it can reach.
