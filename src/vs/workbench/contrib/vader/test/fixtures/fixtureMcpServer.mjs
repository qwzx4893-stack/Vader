#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition. A minimal, real MCP stdio server (using the same `@modelcontextprotocol/sdk`
// Vader's own MCPChannel depends on) with a single trivial tool - test fixture for
// soakE2E.mjs's MCP soak scenario, spawned as a real child process over real stdio, not a mock
// of the protocol.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'vader-fixture-mcp', version: '0.1.0' });

server.tool('echo', { text: z.string() }, async ({ text }) => ({
	content: [{ type: 'text', text: `echo: ${text}` }],
}));

await server.connect(new StdioServerTransport());
