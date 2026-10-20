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

## Search by meaning

The word index finds code by its words. An embedding model finds it by what it means ("where do we stop too many requests" finds the rate limiter even when no word
matches). `common/codebaseIndex/semantic.ts` holds the rules, `electron-main/semanticLayer.ts` the part that touches the disk, `localEmbedder.ts` and `embedWorker.ts` the model.

**Which model, and why (measured, not assumed).** The first choice was Snowflake arctic-embed-xs because it is small. It is an English text model, and on code it was no better than
the word index. The benchmark below picked a code model instead.

Benchmark: 189 queries made from real JSDoc descriptions (93 from Vader's code, 96 from VS Code's own `base`, `platform` and `editor/common/core`), each looking for the chunk that holds
the declaration, with every comment removed from the code; 1,146 chunks. "Pure meaning" queries have every word that also appears in the target code removed. The corpus is small
(about 570 chunks each), real projects are harder. The numbers are single-shot retrieval, not agent success.

| model (licence, int8 size) | pieces/s, 2 threads | peak RAM | as written: top-1 / top-5 | pure meaning: top-1 / top-5 | names only: top-1 / top-5 |
|---|---|---|---|---|---|
| the word index alone | - | - | 18% / 43% | 6% / 16% | 7% / 39% |
| arctic-embed-xs (Apache, 23 MB) | about 13 | 160 MB | 16% / 43% | 8% / 25% | n/a |
| all-MiniLM-L6-v2 (Apache, 22 MB) | 22 | 231 MB | 21% / 47% | 8% / 30% | 21% / 53% |
| jina-embeddings-v2-base-code (Apache, 154 MB) | 4.3 | 407 MB | 29% / 58% | 20% / 40% | 26% / 69% |
| **CodeRankEmbed (MIT, 132 MB)** | 3.5 (4.2 at 600 characters) | 326 MB | **36% / 67%** | **24% / 51%** | **31% / 79%** |

(arctic numbers are from the first run, with five models sharing the CPU, so its speed is a rough figure; the others were measured one at a time.)
CodeRankEmbed at 600 characters per piece loses about 3 points of top-1 and runs 15% faster, so 600 is what ships. Models under non-commercial licences (jina-code-embeddings, SFR-Embedding-Code) were not considered.

**Joining the two rankings.** Equal-weight reciprocal rank fusion, the first design, made a strong code model clearly worse (CodeRankEmbed, pure meaning, top-1: 24% alone, 10% fused). What
works is meaning first plus a small word bonus (`blend()`): 24% alone, 21% with the bonus, and it keeps the exact-name matches that only words find. A piece with no vector yet is ranked
near the tenth meaning match plus a larger word bonus; a word match that has a vector but is not among the nearest goes after them. Measured with 10% to 100% of the pieces embedded
(all three kinds of query): never worse than the words alone at any coverage, and at 100% the same as meaning alone (top-1 28%, top-5 65%, against 10% and 33% for words alone). The first
version of the blend, which put those embedded-but-not-near matches near the top, fell to 24% / 50% at full coverage.

**What ships and how:** `build/embedding/prepare.mjs` makes the folder `resources/embedding` (runtime 33.7 MB + model 132.9 MB = about 167 MB added to the install and to each update):
transformers.js 4.3.1 and onnxruntime-node for one platform (installed on its own from `build/embedding/package-lock.json`, scripts off, so the editor's own install is unchanged), a
stand-in for `sharp` (image handling, never used here), and the model files checked byte for byte against `build/embedding/model.lock.json`. Which model, its pooling, and the question
prefix are written to `manifest.json`, so the model can be changed without touching the code. The Windows workflow runs the script between packaging and the installer. The app looks in
`<resources>/embedding` (or `VADER_EMBEDDING_DIR`); without it Settings says "Search by meaning is not available in this install" and search stays on words.

Provenance: the int8 ONNX file is a third-party conversion (`mrsladoje/CodeRankEmbed-onnx-int8`, revision e74f446d...) of `nomic-ai/CodeRankEmbed` (MIT), documented as dynamic int8
with `reduce_range`. Vader did not make it. An ONNX file is a graph of operations, not a program; that it behaves like the original is shown by the benchmark above (the original authors report
CoIR 60.1 for the full-precision model). Making the conversion in the build from the original weights would remove the third party; it needs PyTorch and was not done.

**How it stays light** (the rules are tested without a model, `test/semanticE2E.mjs`):
- Only source code is embedded (not data, text, tests, generated files), at most 12,000 pieces, the files changed most lately first, and a piece once per content (the vector is kept under the hash of its text).
- The text sent to the model is cut to 600 characters, so no piece costs more than another.
- Work is done in 3-second slices with a duty cycle of 40% in a worker thread with one or two threads; nothing is embedded while the computer is on battery power.
- The worker is stopped after 90 seconds without a question and started again by the next one, so an editor that is not being searched holds none of the model's memory.
- At search time only the best 4 word matches that have no vector yet (1.5 s at most) are embedded on the spot, and the background work embeds 4 pieces at a time so a question never waits for more than one small batch.
- Vectors are bytes (768 per piece, about 11 MB for 12,000), saved next to the index.
- A model that is missing, fails or is slow (2.5 s) leaves the word results exactly as they were; a failing model is tried again later, five times at most.

**Cost, measured on a Core i7-12700H (20 threads)**, real worker, real model, over this repository's `common/` folder (141 files, 1,225 pieces): starting the model about 1 to 2 s; a question about
40 ms of model time; a piece about 240 to 350 ms of model time. At a 40% duty cycle the pieces come at about 1.2 a second, so this folder takes about 17 minutes of background time, a project of
3,000 pieces about 40 minutes, and the cap of 12,000 about 2.8 hours. Memory of the process while embedding: about 300 to 350 MB, none when the worker has stopped. Until everything is ready,
search is answered by the pieces that are ready plus the words (and 4 embedded on the spot); **while the background work is running, a search takes about 1 to 3 seconds** (it waits for the batch in flight
and embeds those 4), and about 50 ms once everything is embedded. For an agent calling the tool that is acceptable; it would be slow for typing-time search.

**Honest limits:**
- Never run inside a packaged, installed Vader: the workflow step, the asar layout and the worker start from the installed app are untested until a Windows build is made.
- The benchmark is single-shot retrieval over about 570 chunks on two TypeScript codebases. It does not show how much the agent finishes more tasks; the agent can also search again, grep and read files. Cursor reports 12.5% higher answer accuracy from semantic search over grep alone (its own model, its own evaluation).
- Only Windows x64 has been prepared on this machine.
- The tests of the rules, the indexer with a stand-in model, and the worker protocol with a stand-in worker do not use the real model; the real model was exercised by hand.
