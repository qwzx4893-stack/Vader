/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// GENERATED - do not edit by hand. Regenerate with build/lib/vader/genExternalAgents.py (source: the ACP Agent Registry, Apache-2.0).

export type RegistryBinaryTarget = { readonly archive: string, readonly sha256?: string, readonly cmd: string, readonly args?: readonly string[], readonly env?: { readonly [k: string]: string } }
export type RegistryDistribution = {
	readonly npx?: { readonly package: string, readonly args?: readonly string[] }
	readonly uvx?: { readonly package: string, readonly args?: readonly string[] }
	readonly binary?: { readonly [platform: string]: RegistryBinaryTarget }
}

export const acpRegistrySnapshot: { readonly [id: string]: { readonly version: string, readonly distribution: RegistryDistribution } } = {
	"codex-acp": {
		"version": "2.2.2",
		"distribution": {
			"npx": {
				"package": "@agentclientprotocol/codex-acp@2.2.2"
			}
		}
	},
	"opencode": {
		"version": "1.19.0",
		"distribution": {
			"binary": {
				"darwin-aarch64": {
					"archive": "https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-darwin-arm64.zip",
					"cmd": "./opencode",
					"args": [
						"acp"
					],
					"sha256": "0d5f511948d6fbfedf9bb16753c0ac42613dcc8de75d9deb7e8d0cf584c8fba6"
				},
				"darwin-x86_64": {
					"archive": "https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-darwin-x64.zip",
					"cmd": "./opencode",
					"args": [
						"acp"
					],
					"sha256": "515380b03f3410f2178c8c1c7ba6d1e9556a3bdee2a01d114e7b1681952131a0"
				},
				"linux-aarch64": {
					"archive": "https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-linux-arm64.tar.gz",
					"cmd": "./opencode",
					"args": [
						"acp"
					],
					"sha256": "e9841d43d3e1a8f36ed2691592d3b8b4fb097e606c8b559a277a1b845840e26b"
				},
				"linux-x86_64": {
					"archive": "https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-linux-x64.tar.gz",
					"cmd": "./opencode",
					"args": [
						"acp"
					],
					"sha256": "7bb9e61ad6feacf2e89c10a6a2c1840e3de4220bb50ba1fc7110f31806076aec"
				},
				"windows-aarch64": {
					"archive": "https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-windows-arm64.zip",
					"cmd": "./opencode",
					"args": [
						"acp"
					],
					"sha256": "cfb6f1d40c4596613d2d40e34c48500da7b873f98f7458d3d4ea11136bf174f6"
				},
				"windows-x86_64": {
					"archive": "https://github.com/anomalyco/opencode/releases/download/v1.19.0/opencode-windows-x64.zip",
					"cmd": "./opencode.exe",
					"args": [
						"acp"
					],
					"sha256": "17108e9448c4fdad48eb8714c4ed6f5dfc9cf86c2eb8f2ce5d02043fef806eb5"
				}
			}
		}
	},
	"cursor": {
		"version": "2026.10.01",
		"distribution": {
			"binary": {
				"darwin-aarch64": {
					"archive": "https://downloads.cursor.com/lab/2026.10.01-14929f9/darwin/arm64/agent-cli-package.tar.gz",
					"cmd": "./dist-package/cursor-agent",
					"args": [
						"acp"
					]
				},
				"darwin-x86_64": {
					"archive": "https://downloads.cursor.com/lab/2026.10.01-14929f9/darwin/x64/agent-cli-package.tar.gz",
					"cmd": "./dist-package/cursor-agent",
					"args": [
						"acp"
					]
				},
				"linux-aarch64": {
					"archive": "https://downloads.cursor.com/lab/2026.10.01-14929f9/linux/arm64/agent-cli-package.tar.gz",
					"cmd": "./dist-package/cursor-agent",
					"args": [
						"acp"
					]
				},
				"linux-x86_64": {
					"archive": "https://downloads.cursor.com/lab/2026.10.01-14929f9/linux/x64/agent-cli-package.tar.gz",
					"cmd": "./dist-package/cursor-agent",
					"args": [
						"acp"
					]
				},
				"windows-aarch64": {
					"archive": "https://downloads.cursor.com/lab/2026.10.01-14929f9/windows/arm64/agent-cli-package.zip",
					"cmd": "./dist-package\\cursor-agent.cmd",
					"args": [
						"acp"
					]
				},
				"windows-x86_64": {
					"archive": "https://downloads.cursor.com/lab/2026.10.01-14929f9/windows/x64/agent-cli-package.zip",
					"cmd": "./dist-package\\cursor-agent.cmd",
					"args": [
						"acp"
					]
				}
			}
		}
	},
	"gemini": {
		"version": "0.63.0",
		"distribution": {
			"npx": {
				"package": "@google/gemini-cli@0.63.0",
				"args": [
					"--acp"
				]
			}
		}
	},
	"antigravity-acp": {
		"version": "1.3.0",
		"distribution": {
			"binary": {
				"darwin-aarch64": {
					"archive": "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.3.0-darwin-arm64.zip",
					"cmd": "./agy_acp_server.par"
				},
				"darwin-x86_64": {
					"archive": "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.3.0-darwin-x86_64.zip",
					"cmd": "./agy_acp_server.par"
				},
				"linux-x86_64": {
					"archive": "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.3.0-linux-x86_64.zip",
					"cmd": "./agy_acp_server.par",
					"args": [
						"--uid="
					]
				},
				"linux-aarch64": {
					"archive": "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.3.0-linux-arm64.zip",
					"cmd": "./agy_acp_server.par",
					"args": [
						"--uid="
					]
				},
				"windows-x86_64": {
					"archive": "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.3.0-windows-x86_64.zip",
					"cmd": "./agy_acp_server.exe"
				},
				"windows-aarch64": {
					"archive": "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-1.3.0-windows-arm64.zip",
					"cmd": "./agy_acp_server.exe"
				}
			}
		}
	}
}
