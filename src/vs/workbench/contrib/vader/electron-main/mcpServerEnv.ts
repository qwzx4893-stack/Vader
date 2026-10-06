/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

// Environment for a spawned MCP server. It used to be `{ ...server.env, ...process.env }`, which handed
// the whole Vader process environment (API keys, tokens) to every third-party server, and let process
// variables override what the user configured. Now: the SDK's safe baseline (PATH, HOME, ...), network
// settings servers commonly need behind a proxy, and then the user's own `env` from mcp.json, last so it wins.
const PASSTHROUGH = [
	'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
	'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'PATHEXT', 'COMSPEC',
];

export function buildMcpServerEnv(serverEnv: Record<string, string> | undefined, processEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
	const env: Record<string, string> = { ...getDefaultEnvironment() };
	for (const key of PASSTHROUGH) {
		const value = processEnv[key];
		if (value !== undefined && !value.startsWith('()')) { env[key] = value; }
	}
	return { ...env, ...(serverEnv ?? {}) };
}
