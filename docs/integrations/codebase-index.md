# The project index (`codebase_search`)

The agent can find code by what it does, not only by exact text. Vader keeps an index of the open project on this computer; the agent's `codebase_search` tool asks it. This is the part of "semantic search" that needs no server: nothing is sent anywhere, no account, no embedding provider.

## What it is

- **Which files** (`electron-main/codebaseIndexer.ts`). In a git project, git says: `git ls-files --cached --others --exclude-standard`, so tracked and new files are in and ignored files (nested `.gitignore`, the person's global excludes) are out. Without git, the folder is walked with the usual exclusions (`node_modules`, `dist`, `.git`, caches) and the project's `.gitignore`. `.vaderignore`, in the same form, keeps anything else out. Binary files, files over 512 KB, files with a NUL byte, minified or generated text (very long lines) and files that commonly hold secrets (`.env`, private keys, `.npmrc`, credentials) are never read: no search can show their text. At most 20,000 files.
- **Pieces** (`common/codebaseIndex/chunker.ts`). Each file is cut into pieces of up to 60 lines that start where a definition starts or a blank line ends a thought, sharing four lines with their neighbours. A piece knows the definition it sits in.
- **Words** (`tokenize.ts`). A name is kept whole and as its parts (`getUserName` -> `getusername`, `get`, `user`, `name`); words every file has are dropped. The path of the file and the name of the definition count in the words of the piece.
- **Ranking** (`bm25Index.ts`). BM25: a word few pieces have counts for more, long pieces are not favoured, a piece that answers more of the question's words ranks above one that repeats one word, and a name written whole in the question counts double. A file that changed is taken out and put in again by itself.
- **Merkle tree** (`merkle.ts`). Every file has the hash of its text, every folder the hash of its children. On each start and each look, the new tree is compared with the saved one from the top: a folder whose hash is the same is not opened. Only files whose size or time moved are read again, and only the ones the comparison names are cut and indexed again.
- **Saved** in the app's data folder (`vader-index/index-<hash of the project path>.json`), written whole or not at all, read back on the next start.
- **Kept current**: a watcher (`fs.watch`, recursive) re-indexes the files that change within a second or so; where the system cannot watch a tree, a search that finds the index older than 20 seconds brings it up to date first.

## What the agent sees

`codebase_search(query, search_in_folder?)` returns up to eight stretches of the project, best first, each as `path:first-last (in Definition)` with its lines as they are on disk now, and says how many files were indexed and whether the index is still catching up. The agent's rules say when to use it (to find where something is done when the file is not known), and when to use `search_for_files` (exact text, regex) or `repo_map` (the layout) instead.

## What the person sees

Settings, Privacy and network, "Search in the project": a switch (on by default; an organisation can lock it), what the index holds and how old it is, and Rebuild.

## Measured (Windows, this machine)

3,000 small files: first build 2.7 s, a second look at the unchanged project 0.3 s (nothing read again), a search 3 ms; 3,000 files put into the index in 0.4 s once read. See `test/codebaseIndexE2E.mjs` (the parts, 65 checks) and `test/codebaseIndexerE2E.mjs` (real folders and a real git project, saved index, the watcher, secrets, 21 checks).

## Honest limits

- **It is lexical, not neural.** A question with none of the words the code uses ("make the app faster") finds little; the agent is told to ask in names and in what the code does. Dense embeddings (a model's vectors, with the question and the pieces compared by meaning) are the next step; they would need a model that makes embeddings (a local one, or the person's provider), and would be opt-in because code would go to it.
- No symbol-level index of references (who calls this): `repo_map` and the editor's own language features cover that.
- The index lives in the main process; a project of hundreds of thousands of files is cut at 20,000 files (the settings page says so).
- The packaged app has not been run on this machine; the index is tested against real folders and a real git repository, the tool and the settings page against their test pages.

## Rules inside folders

A rules file (`.vaderrules`, `AGENTS.md`, `CLAUDE.md`) at the project root is in the agent's instructions from the start. One inside a folder
(`packages/api/AGENTS.md`) is added to the result when the agent reads a file under that folder (`common/instructions/nestedRules.ts`):
the nearest three, framed as text that may have been written by someone else, cut at 3000 characters each, and not repeated for ten minutes.
The ten-minute rule approximates "once per task", because the tool does not know which chat is asking.
