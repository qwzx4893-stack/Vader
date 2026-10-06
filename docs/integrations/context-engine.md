# The Context Engine

**Contract:** `IContextEngineService` in `common/context/contextEngineTypes.ts`. **Implementation:** `browser/contextEngineService.ts`. **Wired into:** `convertToLLMMessageService.ts`'s `_generateChatMessagesSystemMessage`, which is the one place every chat turn's system message gets built (agent, gather, and normal modes, and the subagent path - all go through `prepareLLMChatMessages`).

## What it adds, and what it deliberately doesn't replace

The original code already sends two static pieces of context on every turn, unchanged by this: the repo file tree (`IDirectoryStrService`, character-budget-aware, unrelated to this service) and the layered instructions (`IInstructionsService` - system invariants, policy summary, global/workspace/agent instructions). Neither knows anything about *this specific message* - they're the same regardless of what the user typed.

The Context Engine adds a third, dynamic section: symbol outlines, live diagnostics, and git diff/log for the files the user actually mentioned or has open right now, ranked and truncated by a rough classification of what kind of task the message looks like. It sits in `chat_systemMessage`'s new `<dynamic_context>` block, included only when there's something to say.

## Where the data comes from - all real, already-present VS Code/Vader services, nothing invented

- **Symbol outlines**: `ILanguageFeaturesService.documentSymbolProvider.ordered(model)` - the same document-symbol provider registry that backs "Go to Symbol" and the same one `chatThreadService.ts`'s codespan-link resolution already calls. Flattened two levels deep (top-level declarations + their direct members), capped at 40 symbols/file.
- **Diagnostics**: `IMarkerService.read({ resource, severities: Warning|Error })` - the same marker service that feeds the Problems panel. No LSP client of our own; whatever language service (built-in or extension) already populates markers for a file is what shows up here.
- **Git diff/log**: `IVaderSCMService` (`gitStat`/`gitSampledDiffs`/`gitBranch`/`gitLog`) - this already existed, fully wired end-to-end (electron-main `child_process` git commands behind the `vader-channel-scm` IPC channel), but had exactly one consumer before this (`vaderSCMService.ts`'s commit-message generator). The Context Engine is its second real consumer, not a new git integration.

## Relevance ranking, token budget, and the "Context Router"

`classifyTaskType(userMessage)` is a keyword heuristic returning `bug_fixing | architecture | ui | general` - not a model call, since this has to run on every turn cheaply. `SECTION_ORDER` in `contextEngineService.ts` is the Context Router: a fixed priority ordering per task type (e.g. `bug_fixing` puts diagnostics and git diff first; `architecture` puts symbol outlines and git log first). All sections are always computed (they're cheap relative to the LLM call itself); the router only decides which ones survive when the budget is tight.

The token budget itself is `min(6000, 15% of the model's contextWindow)` tokens (`_generateContextEngineBlock` in `convertToLLMMessageService.ts`), estimated via a chars/4 heuristic (`estimateTokens` in `contextEngineService.ts`) - this project has no real tokenizer dependency, and a heuristic is stated as exactly that in the code, never reported as an exact count. Sections are included in router-priority order until the budget runs out; the section that first doesn't fully fit is truncated (with a `...(truncated to fit context budget)...` marker) rather than dropped, unless what would be left is under 80 characters (not worth including at all).

## Incremental caching

Symbol outlines are cached per-URI, keyed by the text model's own `getVersionId()` - VS Code already increments this on every edit, including unsaved ones, so this is a correctness-preserving cache with no separate file-watcher plumbing: an untouched file's symbols are never recomputed, and an edited one's are recomputed on its very next request, not on a timer or a full-repo rescan. Diagnostics are cached the same way, keyed by a per-URI counter bumped from `IMarkerService.onMarkerChanged`.

## Bounded behavior for large repos

Only files the user mentioned (via `@file`/selections) or has open are considered - never a full-repo symbol scan. That set is capped at 12 files (`MAX_FILES_FOR_SYMBOLS`) regardless of how many are open. Combined with the token budget above, a turn's Context Engine cost is bounded independent of repo size.

## Explainability

`buildContext()` returns every section it computed, not just the ones that made it into the final text - each tagged `includedInBudget`/`truncated`. Nothing surfaces this in the UI yet (that's Agent Manager UI work, still open); the data is there for when it does.

## What this doesn't do (yet)

- No repo-wide symbol index or "find everything relevant across the whole codebase" - relevance is currently scoped to explicitly mentioned/open files, not a full semantic search. Doing better than that would mean either indexing the whole repo up front (a real cost this version chose not to pay unconditionally) or embedding-based retrieval (a new dependency this version didn't add).
- No LSP client of Vader's own - diagnostics/symbols are only as good as whatever language service is already active for a file in the workbench (built-in TypeScript/JS support, or an installed language extension). A file with no such service active contributes nothing to those two sections, which is a real, honest gap for languages without editor-side language support configured, not a bug in this code.
