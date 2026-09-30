#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Tests the URL policy of the agent browser tool (common/browser/browserUrlPolicy.ts), bundled from source.
// Run: node src/vs/workbench/contrib/void/test/browserUrlPolicyE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-url-'));
await esbuild.build({ entryPoints: [path.join(here, '../common/browser/browserUrlPolicy.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'p.mjs'), logLevel: 'silent' });
const { assertNavigableUrl } = await import(pathToFileURL(path.join(tmp, 'p.mjs')).href);

let passed = 0, failed = 0;
const check = (name, ok) => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const blocked = (u) => { try { assertNavigableUrl(u); return false; } catch { return true; } };
const allowed = (u) => { try { assertNavigableUrl(u); return true; } catch { return false; } };

for (const u of ['file:///etc/passwd', 'file:///C:/Users/me/.ssh/id_rsa', 'FILE:///x', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'chrome://settings', 'view-source:https://example.com', 'ftp://example.com/x', 'blob:https://example.com/abc', 'not a url', '//example.com'])
	check(`blocks ${u}`, blocked(u));
for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://2852039166/', 'http://0xA9FEA9FE/', 'http://metadata.google.internal/computeMetadata/v1/', 'http://[fe80::1]/'])
	check(`blocks metadata/link-local ${u}`, blocked(u));
for (const u of ['https://example.com', 'http://localhost:3000/app', 'http://127.0.0.1:8080', 'http://192.168.1.10/', 'about:blank'])
	check(`allows ${u}`, allowed(u));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
