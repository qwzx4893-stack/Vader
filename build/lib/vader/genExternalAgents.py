#!/usr/bin/env python3
"""Generates src/vs/workbench/contrib/vader/common/externalAgents/acpRegistrySnapshot.ts from the public ACP Agent Registry
(https://github.com/agentclientprotocol/registry, Apache-2.0): for the agents Vader offers, the exact versions and download
locations that the registry's CI has verified (the agent starts and offers a sign-in method). Run it to move the snapshot forward:

  python3 build/lib/vader/genExternalAgents.py

Vader can also read the live registry at runtime ("Check for newer versions" in Settings), so a stale snapshot is only a fallback.
"""
import json, os, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'src/vs/workbench/contrib/vader/common/externalAgents/acpRegistrySnapshot.ts')
IDS = ['codex-acp', 'opencode', 'cursor', 'gemini', 'antigravity-acp']
BASE = 'https://raw.githubusercontent.com/agentclientprotocol/registry/main/%s/agent.json'

snap = {}
for i in IDS:
    with urllib.request.urlopen(BASE % i, timeout=30) as r:
        d = json.load(r)
    snap[i] = {'version': d['version'], 'distribution': d['distribution']}

body = json.dumps(snap, indent='\t')
open(OUT, 'w').write(f"""/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// GENERATED - do not edit by hand. Regenerate with build/lib/vader/genExternalAgents.py (source: the ACP Agent Registry, Apache-2.0).

export type RegistryBinaryTarget = {{ readonly archive: string, readonly sha256?: string, readonly cmd: string, readonly args?: readonly string[], readonly env?: {{ readonly [k: string]: string }} }}
export type RegistryDistribution = {{
	readonly npx?: {{ readonly package: string, readonly args?: readonly string[] }}
	readonly uvx?: {{ readonly package: string, readonly args?: readonly string[] }}
	readonly binary?: {{ readonly [platform: string]: RegistryBinaryTarget }}
}}

export const acpRegistrySnapshot: {{ readonly [id: string]: {{ readonly version: string, readonly distribution: RegistryDistribution }} }} = {body}
""")
print('wrote', OUT, list(snap))
