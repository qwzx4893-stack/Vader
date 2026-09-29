#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// Vader addition. A real MCP stdio server process that accepts the connection but never
// responds to any request (including the "initialize" handshake) - test fixture for
// timeoutPolicyE2E.mjs's MCP-connect-hang scenario. Deliberately does NOT use the
// @modelcontextprotocol/sdk server helpers, which would answer "initialize" automatically -
// this needs a real process that stays alive and silent so MCPChannel's own connect-timeout
// (not the SDK's per-request timeout, which only starts once a connection exists) is what
// actually has to fire.

process.stdin.resume(); // keep the event loop alive; never write anything to stdout
