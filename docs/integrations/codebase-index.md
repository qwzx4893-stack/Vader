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

The word index finds code by its words. Embedding models find it by what it means ("where do we stop too many requests" finds the rate limiter even when no word matches). There are
two tiers, because the model that is good at code is slow and the model that is fast is only a little better than words:

- **Quick tier**: `potion-code-16M-v2` (MIT, 31 MB), a static model distilled from the code model: tokens are looked up in a table and averaged, no neural network runs. About 0.4 ms a piece, so
  every piece of a project has a vector within a second or two of being indexed, and a question costs well under a millisecond. Joined with the words it makes the "cheap ranking".
- **Code model**: CodeRankEmbed (MIT, 132 MB int8), a transformer trained on code, in a worker thread. About a quarter to half a second a piece, so it works in the background, and the pieces
  that searches find among the best cheap candidates are embedded first. Its vectors lead the final ranking where there are any.

Files: `common/codebaseIndex/semantic.ts` (rules), `staticModel.ts` (the table), `electron-main/semanticLayer.ts` (the two tiers on disk), `staticEmbedder.ts` (loads the quick tier),
`localEmbedder.ts` and `embedWorker.ts` (the code model). Either model may be missing: with neither, search is the word search as before.

### How the models were chosen (measured, not assumed)

The first choice was Snowflake arctic-embed-xs because it is small. It is an English text model, and on code it was no better than the word index. A benchmark picked the models instead.

Benchmark: 189 queries made from real JSDoc descriptions (93 from Vader's code, 96 from VS Code's own `base`, `platform` and `editor/common/core`), each looking for the chunk that holds the declaration,
with every comment removed from the code; 1,146 chunks. "Pure meaning" queries have every word that also appears in the target code removed. "Names" queries are the declaration's own name split into words.
The corpus is small (about 570 chunks each); real projects are harder. The numbers are single-shot retrieval, not agent success.

| model (licence, size) | pieces/s | peak RAM | as written: top-1 / top-5 | pure meaning: top-1 / top-5 | names: top-1 / top-5 |
|---|---|---|---|---|---|
| the word index alone | - | - | 18% / 43% | 6% / 16% | 7% / 39% |
| arctic-embed-xs (Apache, 23 MB) | about 13 | 160 MB | 16% / 43% | 8% / 25% | - |
| all-MiniLM-L6-v2 (Apache, 22 MB) | 22 | 231 MB | 21% / 47% | 8% / 30% | 21% / 53% |
| **potion-code-16M-v2, static (MIT, 31 MB)** | **about 2,600** | **about 32 MB (the table)** | 16% / 45% | 6% / 25% | 14% / 44% |
| potion + words (equal-weight fusion) | - | - | 21% / 47% | 6% / 23% | 12% / 42% |
| jina-embeddings-v2-base-code (Apache, 154 MB) | 4.3 | 407 MB | 29% / 58% | 20% / 40% | 26% / 69% |
| **CodeRankEmbed (MIT, 132 MB)** | 3.5 to 4.2 | 326 MB | **36% / 67%** | **24% / 51%** | **31% / 79%** |

(arctic numbers are from the first run, with five models sharing the CPU, so its speed is rough; the others were measured one at a time. Models under non-commercial licences, jina-code-embeddings and
SFR-Embedding-Code, were not considered.) The static model's own publishers report the same picture on CoIR: 39 for it, 42 for BM25, 59 for CodeRankEmbed. Their Semble project reports quality on par
with CodeRankEmbed for a static model plus BM25 plus code-aware ranking signals on a benchmark of its own (about 1,250 queries over 63 repositories); on the fine-grained piece-level benchmark above the
gap was large, so that claim was not reproduced here (their benchmark and ranking signals are not the same).

Training or tuning a small model ourselves was considered and not done: the static model is exactly that (distilled from the code model, tuned on 1.2 million pairs by specialists) and reaches about a
third of the code model's gain here; conventional contrastive fine-tuning is reported to often hurt strong models unless a stronger teacher is distilled; per-project training is not possible on a
person's processor.

### Joining the rankings

- Equal-weight reciprocal rank fusion of the words and a strong code model made it clearly worse (pure meaning, top-1: 24% alone, 10% fused). What works is meaning first plus a small word bonus
  (`blend()`): 24% alone, 21% with the bonus, and it keeps the exact-name matches that only words find.
- The words and the quick tier are fused as equals (that is the cheap ranking: 21% / 47% as written), and the cheap ranking takes the place of the word ranking in the blend. A piece with no code-model
  vector is ranked near the tenth meaning match plus a larger bonus; a piece that has a vector but is not among the nearest goes after them.
- Measured with 0% to 100% of the pieces embedded by the code model (the three kinds of query pooled), top-1 / top-5:

| pieces with a code-model vector | words alone | words + code model | **cheap ranking + code model (shipped)** |
|---|---|---|---|
| 0% | 10% / 33% | 10% / 33% | **13% / 37%** |
| 25% | 10% / 33% | 13% / 35% | **14% / 40%** |
| 50% | 10% / 33% | 17% / 44% | **20% / 49%** |
| 100% | 10% / 33% | 28% / 65% | **31% / 67%** |

- Candidates then code-model re-ranking was also measured: re-ranking the cheap top 30 with the code model gives the same top-1 as the code model on everything (33%, 20%, 33% against 33%, 19%, 34%), but the
  top 30 holds the right piece only in 84% of ordinary queries, 59% of pure-meaning ones and 75% of name ones, so top-5 falls on those (43% against 47% and 69% against 80%). The shipped design keeps
  the code model embedding the whole project in the background, and uses this finding only to decide the order: candidates of searches first.

### What ships and how

`build/embedding/prepare.mjs` makes the folder `resources/embedding`: runtime 33.7 MB + code model 132.9 MB + quick tier 32.0 MB = about 199 MB added to the install and to each update.
transformers.js 4.3.1 and onnxruntime-node for one platform (installed on its own from `build/embedding/package-lock.json`, scripts off, so the editor's own install is unchanged), a stand-in for `sharp`
(image handling, never used here), and the model files checked byte for byte against `build/embedding/model.lock.json`. Which models, their pooling and the question prefix are in `manifest.json`, so a
model can be changed without touching the code. The Windows workflow runs the script between packaging and the installer. The app looks in `<resources>/embedding` (or `VADER_EMBEDDING_DIR`).

Provenance: the code model's int8 ONNX file is a third-party conversion (`mrsladoje/CodeRankEmbed-onnx-int8`, revision e74f446d...) of `nomic-ai/CodeRankEmbed` (MIT), documented as dynamic int8 with
`reduce_range`; the quick tier (`minishlab/potion-code-16M-v2`, revision e9d2a44c..., licence MIT per its model card, no LICENSE file in the repository) is by the authors of Model2Vec. Vader made neither.
An ONNX file is a graph of operations and a static model is a table of numbers; neither is a program. That they behave as published is shown by the benchmark above (the original authors report CoIR 60.1 for
the full-precision code model). Making the conversion in the build from the original weights would remove the third party; it needs PyTorch and was not done. My JavaScript reading of the static model was
checked against the official Python library: cosine 1.0000 on four texts.

### How it stays light (the rules are tested without a model, `test/semanticE2E.mjs`)

- Only source code is embedded (not data, text, tests, generated files). The code model embeds at most 12,000 pieces, the files changed most lately first, and a piece once per content (the vector is kept
  under the hash of its text); the quick tier has no practical limit (a piece is 256 bytes).
- The code model sees 600 characters of a piece, so no piece costs more than another. It works in 3-second slices of 4 pieces at a time with a duty cycle of 40%, in a worker thread with one or two threads;
  nothing is embedded while the computer is on battery power. The worker is stopped after 90 seconds without a question and started again by the next one.
- A search puts its best 30 cheap candidates first in the code model's queue, and does not wait for the code model for more than 0.7 s: past that the cheap ranking answers.
- A model that is missing, fails or is slow leaves the cheap ranking (or the word results) as the answer; a failing code model is tried again later, five times at most.
- Vectors are bytes, saved next to the index: 768 per piece for the code model (about 11 MB for 12,000) and 256 for the quick tier.

### Cost, measured on a Core i7-12700H (20 threads), with the real models over this repository's `common/` folder (141 files, about 1,225 pieces)

- Quick tier: 1,146 pieces in 0.44 s; a question in well under a millisecond; the table is about 32 MB in memory.
- Code model: starting it 1 to 2 s; a piece 240 to 520 ms of model time across the runs (the machine was not otherwise idle in the slower ones), which is 0.7 to 1.2 pieces a second at a 40% duty cycle.
  This folder therefore takes about 17 to 30 minutes of background time to be fully embedded, a project of 3,000 pieces about 40 to 70 minutes, and the cap of 12,000 several hours. Memory while embedding:
  about 340 to 560 MB (the higher figure while the model starts), none once the worker has stopped.
- A search: 1.8 s for the first one after the models start, 33 to 713 ms while the background work runs, 53 to 83 ms when it is idle. Only about 7% to 18% of the pieces had a code-model vector at the end
  of those runs; the results then come mostly from the cheap ranking, which is the point of having it.

### Honest limits

- Never run inside a packaged, installed Vader: the workflow step, the asar layout and the worker start from the installed app are untested until a Windows build is made. The install grows by about 199 MB.
- The benchmark is single-shot retrieval over about 570 chunks on two TypeScript codebases. It does not show how much more often the agent finishes tasks; the agent can also search again, grep and read
  files. Cursor reports 12.5% higher answer accuracy from semantic search over grep alone (its own model, its own evaluation).
- Looking at six real questions over this repository by eye, the results with both tiers were about as good as the words' and found a relevant file (`awaitOutput.ts`) that the words missed, and lost
  another relevant one (`gitWorktreeTypes.ts`); that is an impression, not a measurement.
- Only Windows x64 has been prepared on this machine. Using the graphics processor (DirectML) for the code model could make it much faster; it was not tried.
- The tests of the rules, the indexer with stand-in models, the worker protocol with a stand-in worker and the loader with a stand-in folder do not use the real models; the real models were exercised by hand.
