# Changelog

## Vader 0.1.0 - initial fork from Void

Imported [voideditor/void](https://github.com/voideditor/void) @ `b3166e7` (v1.4.9) as the upstream foundation and built a new agent platform on top of it. See `ARCHITECTURE.md` for the design and `AGENTS.md` for how to extend it.

### Rebranding (Void → Vader)

- Product identity throughout: `product.json`, About dialog, window/application metadata, command palette titles, notification text, undo-history labels, installer text (`build/win32/code.iss`), OpenRouter identification headers, onboarding copy, Settings copy.
- New Windows installer identity: fresh GUIDs for all `win32*AppId` fields (never reusing Void's, to avoid any registry/upgrade collision with a real Void install on the same machine), new bundle identifiers, new data folder (`.vader-editor`), new URL protocol (`vader`).
- `.voidrules` renamed to `.vaderrules` (workspace instructions file), with `.voidrules` still read as a fallback for repos migrating from Void.
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

### Known limitations

See the final report delivered with this change for the complete, current list. In short: multi-tool-per-turn isn't supported (a Void-layer limitation, present across every provider), the browser tool is single-tab, MCP registry/SkillNet results require the user to manually add them (no automated install), and a genuine Windows build was not produced in the sandbox this was built in - see `docs/integrations/windows-build.md` for exactly why and what to do on a real Windows machine.
