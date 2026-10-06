#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// MCP servers are third-party processes: they must not inherit Vader's secrets, and the user's own
// `env` from mcp.json must win. Bundles the real electron-main/mcpServerEnv.ts.
// Run: node src/vs/workbench/contrib/vader/test/mcpServerEnvE2E.mjs

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vader-mcpenv-'));
await esbuild.build({ entryPoints: [path.join(here, '../electron-main/mcpServerEnv.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(tmp, 'm.cjs'), logLevel: 'silent' });
const { buildMcpServerEnv } = require(path.join(tmp, 'm.cjs'));

let passed = 0, failed = 0;
const check = (name, ok) => { ok ? passed++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };

const fake = { PATH: '/usr/bin', HOME: '/home/u', OPENAI_API_KEY: 'sk-secret', GITHUB_TOKEN: 'ghp_secret', AWS_SECRET_ACCESS_KEY: 'x', HTTPS_PROXY: 'http://proxy:8080', NODE_EXTRA_CA_CERTS: '/ca.pem', API_TOKEN: 'from-process' };
const env = buildMcpServerEnv({ API_TOKEN: 'from-config', CUSTOM: '1' }, fake);
check('process secrets are not passed to the server', !('OPENAI_API_KEY' in env) && !('GITHUB_TOKEN' in env) && !('AWS_SECRET_ACCESS_KEY' in env));
check('user env from mcp.json wins over the process environment', env.API_TOKEN === 'from-config');
check('user-only variables are passed', env.CUSTOM === '1');
check('PATH is still available so npx/uvx can start', !!env.PATH);
check('proxy and certificate settings are kept', env.HTTPS_PROXY === 'http://proxy:8080' && env.NODE_EXTRA_CA_CERTS === '/ca.pem');
check('works with no server env', typeof buildMcpServerEnv(undefined, fake).PATH === 'string');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
