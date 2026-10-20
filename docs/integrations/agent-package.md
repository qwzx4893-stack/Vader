# The "Agent" package: what was taken, what was already there, what was left

A folder of seven chapters and eight small JavaScript files (`README.md`, `docs/`, `src/`, `runtimes/`) that describes how a commercial coding agent works and gives "clean-room" reimplementations.
It was read in full and each idea was compared with what Vader already does. Nothing was copied: the code in it is a sketch (see below), and the chapters say it comes from decompiling a
commercial product (`index.js`, `workbench.desktop.main.js`, "decompiled `cft`"). Whoever releases Vader commercially should not paste text or code from that package into the product; the
ideas used here are common techniques, written again from the description.

## Taken (new in Vader)

| Idea of the package | What Vader does now |
|---|---|
| Delta of diagnostics after an edit: only what the edit introduced (chapter 5, `shadow_validator.js`) | `common/lintDelta.ts`. After `edit_file` and `rewrite_file` the agent used to get every error and warning of the file (up to 100) after a fixed 2 s, with "you might want to fix it". It now gets only the problems the edit introduced, how many were already there (not shown) and how many the edit fixed. The wait ends when the editor's list has changed and been still for 0.4 s (usually well under a second), else after the same 2 s, at most 4 s. |
| Bounded self-correction (`LOOP_ON_LINTS`: three tries, then surface it) | `LintStreak`: on the third edit in a row to the same file that leaves new problems the tool result tells the agent to stop trying variations, read the file again and reconsider or tell the user. Vader's instructions already said "if the same fix fails twice, stop"; now the tool result says it at the moment it matters. |
| Path blocklist (`.agentignore`, chapter 1 gate 1) | `common/agentIgnore.ts`: files listed in `.vaderignore` (gitignore syntax) are not read, listed, searched or changed by the agent's file tools, and are not indexed. The policy engine already asks before touching files that commonly hold credentials; this refuses, because the person has said no. A shell command is not inspected (documented limit). |

## Already in Vader, and better

- **Two-pass matching with Unicode normalisation (chapter 2)**: `common/editMatching.ts` already does exact-and-unique first, then one tolerant step (same lines, whitespace and typography ignored, unique), refuses overlaps and applies from the bottom. The package's second pass maps the normalised position back with a loop that goes out of step on the very characters it normalises. Re-typed and run on three small files, it replaced the right text and then **deleted the rest of the file** when the file had smart quotes or non-breaking spaces (the two cases it exists for), and worked only for trailing spaces.
- **Bottom-up splicing, overlap check, CRLF**: present (`editCodeService._instantlyApplySRBlocks`); the editor's text model keeps the file's line ends and encoding.
- **Checkpoints and rollback (chapter 6)**: Vader has them per step with file creation and deletion undone (`common/checkpointModel.ts`, `checkpointFileOps.ts`). The package keeps whole file copies in a JSON per turn and its "inverse diff" is computed but never used for the rollback.
- **Merkle synchronisation and indexing (chapter 3, pillar 7)**: `common/codebaseIndex/` (done earlier, with search by meaning added).
- **Reflection after a failure (`reflect_tool`)**: the instructions already say to read the error and change the call, never repeat it, and to think again after the same fix fails twice (`common/prompt/agentBehavior.ts`); loop detection exists. A tool that only echoes what the model writes adds a turn, not information, so it was not added.
- **Myers diff in worker threads with a geometric prefix scan (chapter 4)**: the editor's own diff engine already runs off the main thread and handles large files.
- **Approval levels**: the policy engine (`common/policy`) has them with more cases.

## Not taken, and why

- **File descriptor 5 for commands and `agentsandbox.exe` (chapter 3)**: Vader runs commands in the editor's own terminal (a pseudo-terminal), where there is no command-line length limit to get around and the shell is the person's; the sandbox executable is a component of the commercial product and is not in the package.
- **Headless shadow window with a synthetic syntax error to wake the language server (chapter 5)**: the package's own `shadow_validator.js` does not do this (it runs `node --check` and `py_compile`, and the probe string is built and never used). Vader reads the markers of the real editor, which are already live for open files; the "warm-up" problem is met by waiting for the list to settle, as above.
- **Connect-RPC cloud protocol, context bank, server-side sessions (chapters 1 and 7)**: they belong to the vendor's cloud; Vader talks to the model providers the person chooses.
- **Claims of "100% empirical verification"** in the README: the test scripts check each toy file against its own examples; they say nothing about an agent.

## Tests

`test/lintDeltaE2E.mjs` (22 checks), `test/agentIgnoreE2E.mjs` (13). The tool wiring (`browser/toolsService.ts`) is type-checked and not run: it needs the packaged app.
