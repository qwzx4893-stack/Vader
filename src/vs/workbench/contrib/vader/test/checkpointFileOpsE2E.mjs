#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Going back past a file the agent made or deleted (common/checkpointFileOps.ts): the plan, in the order the operations happened.
// Run: node src/vs/workbench/contrib/vader/test/checkpointFileOpsE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-ops-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/checkpointFileOps.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'm.mjs'), logLevel: 'silent' });
const O = await import(pathToFileURL(path.join(tmp, 'm.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${!ok && detail ? ` - ${detail}` : ''}`); };
const ops = (o) => ({ created: [], createdFolders: [], deleted: [], ...o });
const J = (x) => JSON.stringify(x);

check('going back past a file that was made deletes it', J(O.undoActions([ops({ created: ['/p/new.ts'] })])) === J([{ kind: 'delete', fsPath: '/p/new.ts' }]));
check('going back past a file that was deleted writes it again, with its text', J(O.undoActions([ops({ deleted: [{ fsPath: '/p/old.ts', content: 'x = 1' }] })])) === J([{ kind: 'write', fsPath: '/p/old.ts', content: 'x = 1' }]));
check('a file made and then deleted again was never there before: it ends up not there', J(O.undoActions([ops({ created: ['/p/t.ts'] }), ops({ deleted: [{ fsPath: '/p/t.ts', content: 'tmp' }] })])) === J([{ kind: 'delete', fsPath: '/p/t.ts' }]), J(O.undoActions([ops({ created: ['/p/t.ts'] }), ops({ deleted: [{ fsPath: '/p/t.ts', content: 'tmp' }] })])));
check('a file deleted and then made again with other text goes back to what it was first', J(O.undoActions([ops({ deleted: [{ fsPath: '/p/a.ts', content: 'first' }] }), ops({ created: ['/p/a.ts'] })])) === J([{ kind: 'write', fsPath: '/p/a.ts', content: 'first' }]), J(O.undoActions([ops({ deleted: [{ fsPath: '/p/a.ts', content: 'first' }] }), ops({ created: ['/p/a.ts'] })])));
{
	const plan = O.undoActions([ops({ createdFolders: ['/p/src/deep', '/p/src'], created: ['/p/src/deep/a.ts'] })]);
	check('a folder that was made is removed when empty, the deepest first, after the files in it', plan[0].kind === 'delete' && plan[1].fsPath === '/p/src/deep' && plan[2].fsPath === '/p/src' && plan[1].kind === 'remove-folder-if-empty', J(plan));
}
check('a folder that was deleted comes back through its files', O.undoActions([ops({ deleted: [{ fsPath: '/p/d/a.ts', content: 'a' }, { fsPath: '/p/d/b.ts', content: 'b' }] })]).length === 2);
check('nothing to undo is nothing to do', O.undoActions([]).length === 0 && O.undoActions([ops({})]).length === 0 && O.redoActions([]).length === 0);

check('going forward again makes the file again, empty, and the edit checkpoints put its text back', J(O.redoActions([ops({ created: ['/p/new.ts'] })])) === J([{ kind: 'write', fsPath: '/p/new.ts', content: '' }]));
check('going forward again deletes a file again', J(O.redoActions([ops({ deleted: [{ fsPath: '/p/old.ts', content: 'x' }] })])) === J([{ kind: 'delete', fsPath: '/p/old.ts' }]));
check('going forward past a file made and deleted ends with it deleted; folders are made before their files', J(O.redoActions([ops({ created: ['/p/t.ts'] }), ops({ deleted: [{ fsPath: '/p/t.ts', content: 't' }] })])) === J([{ kind: 'delete', fsPath: '/p/t.ts' }]) && O.redoActions([ops({ createdFolders: ['/p/f'], created: ['/p/f/a.ts'] })])[0].kind === 'make-folder');
check('paths are the same paths whatever the slashes or the case on a drive letter', J(O.undoActions([ops({ created: ['C:\\p\\a.ts'] }), ops({ deleted: [{ fsPath: 'c:/p/A.ts', content: 'x' }] })])) === J([{ kind: 'delete', fsPath: 'C:\\p\\a.ts' }]) || O.undoActions([ops({ created: ['C:\\p\\a.ts'] }), ops({ deleted: [{ fsPath: 'c:/p/A.ts', content: 'x' }] })]).length === 1);
check('the step is labelled by what happened', O.opsLabel('create_file_or_folder', '/p/src/limiter.ts') === 'Created limiter.ts' && O.opsLabel('delete_file_or_folder', 'C:\\p\\old\\') === 'Deleted old' && O.opsLabel('delete_file_or_folder', undefined) === 'Deleted a file');
check('what is kept of a deleted file has limits', O.MAX_KEPT_FILE_BYTES === 1_000_000 && O.MAX_KEPT_FOLDER_FILES === 60);

console.log(`\n${passed} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
