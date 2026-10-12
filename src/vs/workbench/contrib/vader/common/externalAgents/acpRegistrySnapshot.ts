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
	},
	"github-copilot-cli": {
		"version": "1.0.95",
		"distribution": {
			"npx": {
				"package": "@github/copilot@1.0.95",
				"args": [
					"--acp"
				]
			}
		}
	},
	"mistral-vibe": {
		"version": "2.26.1",
		"distribution": {
			"binary": {
				"darwin-aarch64": {
					"archive": "https://github.com/mistralai/mistral-vibe/releases/download/v2.26.1/vibe-acp-darwin-aarch64-2.26.1.tar.gz",
					"cmd": "./vibe-acp",
					"sha256": "4035a97f3bf99d91589ae4b5399438fb417f6b72511a995c7c363ec4b468f10a"
				},
				"darwin-x86_64": {
					"archive": "https://github.com/mistralai/mistral-vibe/releases/download/v2.26.1/vibe-acp-darwin-x86_64-2.26.1.tar.gz",
					"cmd": "./vibe-acp",
					"sha256": "3acfc454ffc248826a05333e1cb2467c465308639bbba6725b47384dc9e8f757"
				},
				"linux-aarch64": {
					"archive": "https://github.com/mistralai/mistral-vibe/releases/download/v2.26.1/vibe-acp-linux-aarch64-2.26.1.tar.gz",
					"cmd": "./vibe-acp",
					"sha256": "147ce53d0d185148ac269e23ff285eb087167077ba00d7c9ff41492c647ad2c6"
				},
				"linux-x86_64": {
					"archive": "https://github.com/mistralai/mistral-vibe/releases/download/v2.26.1/vibe-acp-linux-x86_64-2.26.1.tar.gz",
					"cmd": "./vibe-acp",
					"sha256": "c8a018ca7d02eed5cebf291f6bcce1744e44323ff774b1c3fceac13794a95634"
				},
				"windows-x86_64": {
					"archive": "https://github.com/mistralai/mistral-vibe/releases/download/v2.26.1/vibe-acp-windows-x86_64-2.26.1.zip",
					"cmd": "./vibe-acp.exe",
					"sha256": "fd192698e396470f478adda5ce57cd8fd58927a2cd5e35ec1055c7c55089d370"
				}
			}
		}
	},
	"grok-build": {
		"version": "1.0.52",
		"distribution": {
			"npx": {
				"package": "@xai-official/grok@1.0.52",
				"args": [
					"agent",
					"stdio"
				]
			}
		}
	},
	"kimi": {
		"version": "1.52.0",
		"distribution": {
			"binary": {
				"darwin-aarch64": {
					"archive": "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-aarch64-apple-darwin.tar.gz",
					"cmd": "./kimi",
					"args": [
						"acp"
					],
					"sha256": "43fe091f70bbf8860974200f9021a05689a020857cc9926d56f1505f0d0d5cb8"
				},
				"linux-aarch64": {
					"archive": "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-aarch64-unknown-linux-gnu.tar.gz",
					"cmd": "./kimi",
					"args": [
						"acp"
					],
					"sha256": "9e06eea96273600aed485b1f0bedda95b7084db4f22cf28614fe20138933507a"
				},
				"linux-x86_64": {
					"archive": "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-x86_64-unknown-linux-gnu.tar.gz",
					"cmd": "./kimi",
					"args": [
						"acp"
					],
					"sha256": "a676204f7804ed5dae87652a9d66f578e0718d5026c9cb1bfa32b9a5eace4208"
				},
				"windows-aarch64": {
					"archive": "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-aarch64-pc-windows-msvc.zip",
					"cmd": "./kimi.exe",
					"args": [
						"acp"
					],
					"sha256": "7c77cd413e7a3a59416c171a45ee4ff50534869b331469138aad84b9e3acb6c0"
				},
				"windows-x86_64": {
					"archive": "https://github.com/MoonshotAI/kimi-cli/releases/download/1.52.0/kimi-1.52.0-x86_64-pc-windows-msvc.zip",
					"cmd": "./kimi.exe",
					"args": [
						"acp"
					],
					"sha256": "2c269e15e152b9f28ac1556795280f90a2c9860ff44c60c628c3fce4dd4c58a7"
				}
			}
		}
	}
}
