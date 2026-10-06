/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// GENERATED - do not edit by hand. Regenerate with build/lib/vader/genVendorProviders.py (see that file for the sources).
//
// First-class providers for model vendors and inference platforms that are reached through an OpenAI-compatible gateway: the gateway
// URL, where to get a key, and the newest tool-calling models with their context window, price and capabilities, taken from the models.dev
// catalog (commit 3f2f7e204, 2026-10-06). A model that is not listed here still works: with a key, the vendor's own /models route is queried where it
// has one (electron-main/llmMessage/modelListing.ts), and "Add model" accepts any id. Provider hosts are not reachable from the build
// environment, so these endpoints are recorded from vendor documentation, not exercised live.

export type VendorModelFacts = { ctx: number; out: number; tools: boolean; vision: boolean; reasoning: boolean; cost: { input: number; output: number } }
export type VendorInfo = {
	readonly title: string
	/** OpenAI-compatible base URL (without /chat/completions); editable in settings */
	readonly endpoint: string
	readonly keyUrl: string
	readonly keyPlaceholder: string
	/** the vendor exposes an OpenAI-style GET {endpoint}/models, so the real model list is fetched once a key works */
	readonly liveList: boolean
	readonly note: string
	readonly models: { readonly [id: string]: VendorModelFacts }
}

export const vendorProviders = {
	together: { title: "Together AI", endpoint: "https://api.together.xyz/v1", keyUrl: "https://api.together.ai/settings/api-keys", keyPlaceholder: "key...", liveList: true, note: "", models: {
		"deepseek-ai/DeepSeek-V4.1-Flash": { ctx: 1048576, out: 384000, tools: true, vision: true, reasoning: true, cost: { input: 0.3, output: 1.2 } },
		"zai-org/GLM-5.3-Flash": { ctx: 1048575, out: 400000, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.5 } },
		"zai-org/GLM-5.3": { ctx: 1048576, out: 262144, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"deepseek-ai/DeepSeek-V4-Pro-0813": { ctx: 1048576, out: 384000, tools: true, vision: false, reasoning: true, cost: { input: 1.32, output: 3.96 } },
		"deepseek-ai/DeepSeek-V4-Flash-0731": { ctx: 1048576, out: 384000, tools: true, vision: false, reasoning: true, cost: { input: 0.14, output: 0.28 } },
		"moonshotai/Kimi-K3": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 3, output: 15 } },
		"thinkingmachines/Inkling": { ctx: 524288, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 1, output: 4.05 } },
		"zai-org/GLM-5.2": { ctx: 1048575, out: 164000, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
	} },
	fireworks: { title: "Fireworks AI", endpoint: "https://api.fireworks.ai/inference/v1", keyUrl: "https://app.fireworks.ai/settings/users/api-keys", keyPlaceholder: "fw_...", liveList: true, note: "", models: {
		"accounts/fireworks/models/ember-1": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 3, output: 15 } },
		"accounts/fireworks/routers/deepseek-flash-latest": { ctx: 1000000, out: 384000, tools: true, vision: true, reasoning: true, cost: { input: 0.3, output: 1.2 } },
		"accounts/fireworks/models/deepseek-v4p1-flash": { ctx: 1000000, out: 384000, tools: true, vision: true, reasoning: true, cost: { input: 0.3, output: 1.2 } },
		"accounts/fireworks/routers/glm-5p3-fast": { ctx: 1048572, out: 262144, tools: true, vision: false, reasoning: true, cost: { input: 2.1, output: 6.6 } },
		"accounts/fireworks/routers/glm-fast-latest": { ctx: 1048572, out: 262144, tools: true, vision: false, reasoning: true, cost: { input: 2.1, output: 6.6 } },
		"accounts/fireworks/routers/glm-flash-latest": { ctx: 1048573, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.5 } },
		"accounts/fireworks/models/glm-5p3-flash": { ctx: 1048573, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.5 } },
		"accounts/fireworks/routers/glm-latest": { ctx: 1048573, out: 262144, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
	} },
	cerebras: { title: "Cerebras", endpoint: "https://api.cerebras.ai/v1", keyUrl: "https://cloud.cerebras.ai/platform", keyPlaceholder: "csk-...", liveList: true, note: "", models: {
		"qwen-3.8-27b": { ctx: 131072, out: 40960, tools: true, vision: true, reasoning: true, cost: { input: 0.99, output: 1.49 } },
		"gpt-oss-120b": { ctx: 131072, out: 40960, tools: true, vision: false, reasoning: true, cost: { input: 0.35, output: 0.75 } },
	} },
	cohere: { title: "Cohere", endpoint: "https://api.cohere.ai/compatibility/v1", keyUrl: "https://dashboard.cohere.com/api-keys", keyPlaceholder: "key...", liveList: true, note: "Uses Cohere's OpenAI-compatibility endpoint.", models: {
		"north-mini-code-1-0": { ctx: 256000, out: 64000, tools: true, vision: false, reasoning: true, cost: { input: 0, output: 0 } },
		"command-a-plus-05-2026": { ctx: 128000, out: 64000, tools: true, vision: true, reasoning: true, cost: { input: 2.5, output: 10 } },
		"tiny-aya-fire": { ctx: 8000, out: 8000, tools: true, vision: false, reasoning: false, cost: { input: 0, output: 0 } },
		"tiny-aya-earth": { ctx: 8000, out: 8000, tools: true, vision: false, reasoning: false, cost: { input: 0, output: 0 } },
		"tiny-aya-water": { ctx: 8000, out: 8000, tools: true, vision: false, reasoning: false, cost: { input: 0, output: 0 } },
		"tiny-aya-global": { ctx: 8000, out: 8000, tools: true, vision: false, reasoning: false, cost: { input: 0, output: 0 } },
		"command-a-translate-08-2025": { ctx: 8000, out: 8000, tools: true, vision: false, reasoning: false, cost: { input: 2.5, output: 10 } },
		"command-a-reasoning-08-2025": { ctx: 256000, out: 32000, tools: true, vision: false, reasoning: true, cost: { input: 2.5, output: 10 } },
	} },
	zai: { title: "Z.AI (GLM)", endpoint: "https://api.z.ai/api/paas/v4", keyUrl: "https://z.ai/manage-apikey/apikey-list", keyPlaceholder: "key...", liveList: false, note: "Mainland China accounts should change the Endpoint above to `https://open.bigmodel.cn/api/paas/v4`.", models: {
		"glm-5.3-flashx": { ctx: 1000000, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.37, output: 1.25 } },
		"glm-5.3-flash": { ctx: 1000000, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.5 } },
		"glm-5.3": { ctx: 1000000, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"glm-5.2": { ctx: 1000000, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"glm-5.1": { ctx: 200000, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"glm-5v-turbo": { ctx: 200000, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 1.2, output: 4 } },
		"glm-5-turbo": { ctx: 200000, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 1.2, output: 4 } },
		"glm-5": { ctx: 204800, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 1, output: 3.2 } },
	} },
	perplexity: { title: "Perplexity", endpoint: "https://api.perplexity.ai", keyUrl: "https://www.perplexity.ai/settings/api", keyPlaceholder: "pplx-...", liveList: false, note: "Sonar models search the web and do not call tools, so they answer in chat but cannot drive the agent.", models: {
		"sonar-deep-research": { ctx: 128000, out: 32768, tools: false, vision: false, reasoning: true, cost: { input: 2, output: 8 } },
		"sonar-pro": { ctx: 200000, out: 8192, tools: false, vision: true, reasoning: false, cost: { input: 3, output: 15 } },
		"sonar": { ctx: 128000, out: 4096, tools: false, vision: false, reasoning: false, cost: { input: 1, output: 1 } },
		"sonar-reasoning-pro": { ctx: 128000, out: 4096, tools: false, vision: true, reasoning: true, cost: { input: 2, output: 8 } },
	} },
	nvidia: { title: "NVIDIA NIM", endpoint: "https://integrate.api.nvidia.com/v1", keyUrl: "https://build.nvidia.com/settings/api-keys", keyPlaceholder: "nvapi-...", liveList: true, note: "", models: {
		"deepseek-ai/deepseek-v4.1-flash": { ctx: 1000000, out: 384000, tools: true, vision: true, reasoning: true, cost: { input: 0, output: 0 } },
		"z-ai/glm-5.3-flash": { ctx: 1000000, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0, output: 0 } },
		"z-ai/glm-5.3": { ctx: 1000000, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 0, output: 0 } },
		"nvidia/nemotron-3.5-lightning-30b-a3b": { ctx: 262144, out: 262144, tools: true, vision: false, reasoning: true, cost: { input: 0, output: 0 } },
		"meta/muse-glimmer-30b": { ctx: 131072, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0, output: 0 } },
		"moonshotai/kimi-k3": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0, output: 0 } },
		"poolside/laguna-xs-2.1": { ctx: 262144, out: 16384, tools: true, vision: false, reasoning: true, cost: { input: 0, output: 0 } },
		"google/diffusiongemma-26b-a4b-it": { ctx: 250000, out: 32768, tools: true, vision: true, reasoning: true, cost: { input: 0, output: 0 } },
	} },
	huggingface: { title: "Hugging Face", endpoint: "https://router.huggingface.co/v1", keyUrl: "https://huggingface.co/settings/tokens", keyPlaceholder: "hf_...", liveList: true, note: "Inference Providers router: use a token with the \"Make calls to Inference Providers\" permission.", models: {
		"deepseek-ai/DeepSeek-V4.1-Flash": { ctx: 1048576, out: 384000, tools: true, vision: true, reasoning: true, cost: { input: 0.3, output: 1.2 } },
		"tencent/Hy4-preview": { ctx: 1000000, out: 64000, tools: true, vision: false, reasoning: true, cost: { input: 0.834, output: 2.501 } },
		"zai-org/GLM-5.3-Flash": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.5 } },
		"deepseek-ai/DeepSeek-V4-Flash-Vision-Exp": { ctx: 1048576, out: 384000, tools: true, vision: true, reasoning: true, cost: { input: 0.44, output: 1.32 } },
		"zai-org/GLM-5.3": { ctx: 1048576, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"Qwen/Qwen3.8-27B": { ctx: 262144, out: 32768, tools: true, vision: true, reasoning: true, cost: { input: 0.4, output: 3 } },
		"deepseek-ai/DeepSeek-V4-Pro-0813": { ctx: 1000000, out: 384000, tools: true, vision: false, reasoning: true, cost: { input: 1.32, output: 3.96 } },
		"Qwen/Qwen3.8-2.4T-A95B": { ctx: 262144, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 2.5, output: 6.25 } },
	} },
	deepinfra: { title: "DeepInfra", endpoint: "https://api.deepinfra.com/v1/openai", keyUrl: "https://deepinfra.com/dash/api_keys", keyPlaceholder: "key...", liveList: true, note: "", models: {
		"XiaomiMiMo/MiMo-V2.6-Flash": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.14, output: 0.28 } },
		"XiaomiMiMo/MiMo-V2.6-Pro": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.43, output: 0.87 } },
		"deepseek-ai/DeepSeek-V4.1-Flash": { ctx: 1048576, out: 384000, tools: true, vision: true, reasoning: true, cost: { input: 0.2, output: 0.6 } },
		"tencent/Hy4-preview": { ctx: 1048576, out: 64000, tools: true, vision: false, reasoning: true, cost: { input: 0.834, output: 2.501 } },
		"zai-org/GLM-5.3-Flash": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.5 } },
		"Qwen/Qwen3.8-Flash": { ctx: 1000000, out: 131072, tools: true, vision: true, reasoning: false, cost: { input: 0.113, output: 0.382 } },
		"deepseek-ai/DeepSeek-V4-Flash-Vision-Exp": { ctx: 1048576, out: 384000, tools: true, vision: true, reasoning: true, cost: { input: 0.44, output: 1.32 } },
		"zai-org/GLM-5.3": { ctx: 1048576, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 0.9, output: 4 } },
	} },
	nebius: { title: "Nebius Token Factory", endpoint: "https://api.tokenfactory.nebius.com/v1", keyUrl: "https://tokenfactory.nebius.com", keyPlaceholder: "key...", liveList: true, note: "", models: {
		"deepseek-ai/DeepSeek-V4.1-Flash": { ctx: 1048000, out: 1048000, tools: true, vision: true, reasoning: true, cost: { input: 0.3, output: 1.2 } },
		"zai-org/GLM-5.3-Flash": { ctx: 1024000, out: 1024000, tools: true, vision: false, reasoning: true, cost: { input: 0.15, output: 0.5 } },
		"zai-org/GLM-5.3": { ctx: 1024000, out: 1024000, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"Qwen/Qwen3.8-27B": { ctx: 262144, out: 262144, tools: true, vision: false, reasoning: true, cost: { input: 0.45, output: 3 } },
		"deepseek-ai/DeepSeek-V4-Pro-0813": { ctx: 979000, out: 979000, tools: true, vision: false, reasoning: true, cost: { input: 1.32, output: 3.96 } },
		"nvidia/Nemotron-3_5-Lightning": { ctx: 1048576, out: 1048576, tools: true, vision: false, reasoning: true, cost: { input: 0.06, output: 0.24 } },
		"deepseek-ai/DeepSeek-V4-Flash-0731": { ctx: 1024000, out: 1024000, tools: true, vision: false, reasoning: true, cost: { input: 0.14, output: 0.28 } },
		"moonshotai/Kimi-K3": { ctx: 1048576, out: 8000, tools: true, vision: false, reasoning: true, cost: { input: 3, output: 15 } },
	} },
	cloudflare: { title: "Cloudflare Workers AI", endpoint: "https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1", keyUrl: "https://dash.cloudflare.com/profile/api-tokens", keyPlaceholder: "key...", liveList: false, note: "Replace `ACCOUNT_ID` in the Endpoint above with your Cloudflare account id.", models: {
		"@cf/zai-org/glm-5.3-flash": { ctx: 1048576, out: 1048576, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.5 } },
		"@cf/zai-org/glm-5.3": { ctx: 1048576, out: 1048576, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"@cf/qwen/qwen3.8-27b": { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 0.45, output: 3.2 } },
		"@cf/deepseek-ai/deepseek-v4-pro-0813": { ctx: 1048576, out: 1048576, tools: true, vision: false, reasoning: true, cost: { input: 1.32, output: 3.96 } },
		"@cf/deepseek-ai/deepseek-v4-flash-0731": { ctx: 1048576, out: 1048576, tools: true, vision: false, reasoning: true, cost: { input: 0.44, output: 1.32 } },
		"@cf/zai-org/glm-5.2": { ctx: 262144, out: 256000, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"@cf/moonshotai/kimi-k2.7-code": { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 0.95, output: 4 } },
		"@cf/moonshotai/kimi-k2.6": { ctx: 262144, out: 256000, tools: true, vision: true, reasoning: true, cost: { input: 0.95, output: 4 } },
	} },
	novita: { title: "Novita AI", endpoint: "https://api.novita.ai/openai", keyUrl: "https://novita.ai/settings/key-management", keyPlaceholder: "sk_...", liveList: false, note: "", models: {
		"moonshotai/kimi-k3": { ctx: 1048576, out: 1048576, tools: true, vision: true, reasoning: true, cost: { input: 3, output: 15 } },
		"zai-org/glm-5.2": { ctx: 1048576, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"moonshotai/kimi-k2.7-code": { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 0.95, output: 4 } },
		"qwen/qwen3.7-max": { ctx: 1000000, out: 65536, tools: true, vision: false, reasoning: true, cost: { input: 1.25, output: 3.75 } },
		"inclusionai/ring-2.6-1t": { ctx: 262144, out: 65536, tools: true, vision: false, reasoning: true, cost: { input: 0.3, output: 2.5 } },
		"deepseek/deepseek-v4-pro": { ctx: 1048576, out: 393216, tools: true, vision: false, reasoning: true, cost: { input: 1.6, output: 3.2 } },
		"deepseek/deepseek-v4-flash": { ctx: 1048576, out: 393216, tools: true, vision: false, reasoning: true, cost: { input: 0.14, output: 0.28 } },
		"inclusionai/ling-2.6-flash": { ctx: 262144, out: 32768, tools: true, vision: false, reasoning: false, cost: { input: 0.1, output: 0.3 } },
	} },
	siliconflow: { title: "SiliconFlow", endpoint: "https://api.siliconflow.com/v1", keyUrl: "https://cloud.siliconflow.com/account/ak", keyPlaceholder: "sk-...", liveList: true, note: "Mainland China accounts should change the Endpoint above to `https://api.siliconflow.cn/v1`.", models: {
		"zai-org/GLM-5.3-Flash": { ctx: 1049000, out: 262000, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.5 } },
		"deepseek-ai/DeepSeek-V4-Flash-Vision-Exp": { ctx: 1000000, out: 384000, tools: true, vision: true, reasoning: true, cost: { input: 0.44, output: 1.32 } },
		"zai-org/GLM-5.3": { ctx: 1049000, out: 262000, tools: true, vision: false, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"Qwen/Qwen3.8-2.4T-A95B": { ctx: 1049000, out: 131000, tools: true, vision: false, reasoning: true, cost: { input: 2, output: 6 } },
		"deepseek-ai/DeepSeek-V4-Pro-0813": { ctx: 1000000, out: 384000, tools: true, vision: false, reasoning: true, cost: { input: 1.32, output: 3.96 } },
		"deepseek-ai/DeepSeek-V4-Flash-0731": { ctx: 1000000, out: 384000, tools: true, vision: false, reasoning: true, cost: { input: 0.22, output: 0.66 } },
		"moonshotai/Kimi-K3": { ctx: 1048576, out: 262000, tools: true, vision: true, reasoning: true, cost: { input: 2.7, output: 13.5 } },
		"tencent/Hy3": { ctx: 262144, out: 262144, tools: true, vision: false, reasoning: true, cost: { input: 0.132, output: 0.528 } },
	} },
	volcengine: { title: "Volcengine Ark (Doubao)", endpoint: "https://ark.cn-beijing.volces.com/api/v3", keyUrl: "https://console.volcengine.com/ark", keyPlaceholder: "key...", liveList: false, note: "Models are addressed by your endpoint id (`ep-...`) or model id from the Ark console: add it with \"Add model\".", models: {
		"glm-5-3-flash-260828": { ctx: 1000000, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.11875, output: 0.41563 } },
		"deepseek-v4-pro-ga-260813": { ctx: 1000000, out: 384000, tools: true, vision: false, reasoning: true, cost: { input: 1.3359, output: 4.00771 } },
		"deepseek-v4-flash-ga-260731": { ctx: 1000000, out: 384000, tools: true, vision: false, reasoning: true, cost: { input: 0.4453, output: 1.3359 } },
		"doubao-seed-character-260628": { ctx: 256000, out: 256000, tools: true, vision: true, reasoning: true, cost: { input: 0.11875, output: 0.29687 } },
		"doubao-seed-evolving": { ctx: 256000, out: 256000, tools: true, vision: true, reasoning: true, cost: { input: 0.8906, output: 4.45301 } },
		"doubao-seed-2-1-pro-260628": { ctx: 256000, out: 256000, tools: true, vision: true, reasoning: true, cost: { input: 0.8906, output: 4.45301 } },
		"doubao-seed-2-1-turbo-260628": { ctx: 256000, out: 256000, tools: true, vision: true, reasoning: true, cost: { input: 0.4453, output: 2.22651 } },
		"glm-5-2-260617": { ctx: 1000000, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 1.18747, output: 4.15615 } },
	} },
	stepfun: { title: "StepFun", endpoint: "https://api.stepfun.com/v1", keyUrl: "https://platform.stepfun.com/interface-key", keyPlaceholder: "key...", liveList: true, note: "", models: {
		"step-5-preview": { ctx: 1000000, out: 65536, tools: true, vision: true, reasoning: true, cost: { input: 0.959, output: 2.741 } },
		"step-3.7-flash": { ctx: 256000, out: 256000, tools: true, vision: true, reasoning: true, cost: { input: 0.185, output: 1.11 } },
		"step-3.5-flash-2603": { ctx: 256000, out: 256000, tools: true, vision: false, reasoning: true, cost: { input: 0.1, output: 0.3 } },
		"step-3.5-flash": { ctx: 256000, out: 256000, tools: true, vision: false, reasoning: true, cost: { input: 0.1, output: 0.3 } },
		"step-1-32k": { ctx: 32768, out: 32768, tools: true, vision: false, reasoning: false, cost: { input: 2.05, output: 9.59 } },
		"step-2-16k": { ctx: 16384, out: 8192, tools: true, vision: false, reasoning: false, cost: { input: 5.21, output: 16.44 } },
	} },
	vercel: { title: "Vercel AI Gateway", endpoint: "https://ai-gateway.vercel.sh/v1", keyUrl: "https://vercel.com/~/ai-gateway/api-keys", keyPlaceholder: "vck_...", liveList: true, note: "A gateway to many vendors; model ids look like `anthropic/claude-sonnet-5.5`.", models: {
		"openai/gpt-6.1-sol": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2, output: 10 } },
		"openai/gpt-6.1-sol-fast": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 4, output: 20 } },
		"inclusionai/ling-3.1-flash": { ctx: 262144, out: 32768, tools: true, vision: false, reasoning: true, cost: { input: 0, output: 0 } },
		"inclusionai/ling-3.1-flash-free": { ctx: 262144, out: 32768, tools: true, vision: false, reasoning: true, cost: { input: 0, output: 0 } },
		"anthropic/claude-sonnet-5.5": { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2, output: 10 } },
		"meituan/longcat-2.5-preview": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.3, output: 1.2 } },
		"fireworks/ember-1": { ctx: 1048576, out: 1048576, tools: true, vision: true, reasoning: true, cost: { input: 3, output: 15 } },
		"alibaba/qwen3.8-max-prime": { ctx: 1000000, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 4, output: 12 } },
		"openai/gpt-6-luna": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 0.1, output: 0.5 } },
		"openai/gpt-6-luna-fast": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 0.2, output: 1 } },
		"openai/gpt-6-sol-fast": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 4, output: 20 } },
		"openai/gpt-6-sol": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2, output: 10 } },
	} },
	requesty: { title: "Requesty", endpoint: "https://router.requesty.ai/v1", keyUrl: "https://app.requesty.ai/api-keys", keyPlaceholder: "key...", liveList: true, note: "A gateway to many vendors.", models: {
		"mistral-large-4": { ctx: 1000000, out: 1000000, tools: true, vision: true, reasoning: false, cost: { input: 0.68, output: 2.09 } },
		"mistral-large-4@eu": { ctx: 1000000, out: 1000000, tools: true, vision: true, reasoning: false, cost: { input: 0.68, output: 2.09 } },
		"gpt-6.1-sol@eu": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2.4, output: 12 } },
		"gpt-6.1-sol": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2, output: 10 } },
		"claude-sonnet-5-5": { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2, output: 10 } },
		"claude-sonnet-5-5@eu": { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2.2, output: 11 } },
		"gpt-6-luna@eu": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 0.12, output: 0.6 } },
		"gpt-6-luna": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 0.1, output: 0.5 } },
		"gpt-6-sol@eu": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2.4, output: 12 } },
		"gpt-6-sol": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2, output: 10 } },
		"mimo-v2.6-flash": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.14, output: 0.28 } },
		"mimo-v2.6-pro": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.43, output: 0.87 } },
	} },
	ai21: { title: "AI21 Labs (Jamba)", endpoint: "https://api.ai21.com/studio/v1", keyUrl: "https://studio.ai21.com/account/api-key", keyPlaceholder: "key...", liveList: false, note: "", models: {
		"jamba-mini": { ctx: 256000, out: 4096, tools: true, vision: false, reasoning: false, cost: { input: 0.2, output: 0.4 } },
		"jamba-large": { ctx: 256000, out: 4096, tools: true, vision: false, reasoning: false, cost: { input: 2, output: 8 } },
	} },
	upstage: { title: "Upstage (Solar)", endpoint: "https://api.upstage.ai/v1/solar", keyUrl: "https://console.upstage.ai/api-keys", keyPlaceholder: "up_...", liveList: false, note: "", models: {
		"solar-pro4": { ctx: 524288, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 0.3, output: 1.2 } },
		"solar-pro3": { ctx: 131072, out: 8192, tools: true, vision: false, reasoning: true, cost: { input: 0.25, output: 0.25 } },
		"solar-pro2": { ctx: 65536, out: 8192, tools: true, vision: false, reasoning: true, cost: { input: 0.25, output: 0.25 } },
		"solar-mini": { ctx: 32768, out: 4096, tools: true, vision: false, reasoning: false, cost: { input: 0.15, output: 0.15 } },
	} },
	inception: { title: "Inception (Mercury)", endpoint: "https://api.inceptionlabs.ai/v1", keyUrl: "https://platform.inceptionlabs.ai/dashboard/api-keys", keyPlaceholder: "sk_...", liveList: true, note: "", models: {
		"mercury-2.5": { ctx: 260000, out: 65536, tools: true, vision: false, reasoning: true, cost: { input: 0.04, output: 0.15 } },
		"mercury-edit-2": { ctx: 32000, out: 8192, tools: false, vision: false, reasoning: false, cost: { input: 0.25, output: 0.75 } },
		"mercury-2": { ctx: 128000, out: 50000, tools: true, vision: false, reasoning: true, cost: { input: 0.25, output: 0.75 } },
	} },
	llama: { title: "Meta Llama API", endpoint: "https://api.llama.com/compat/v1", keyUrl: "https://llama.developer.meta.com", keyPlaceholder: "LLM|...", liveList: true, note: "Uses Meta's OpenAI-compatibility endpoint.", models: {
		"groq-llama-4-maverick-17b-128e-instruct": { ctx: 128000, out: 4096, tools: true, vision: false, reasoning: false, cost: { input: 0, output: 0 } },
		"cerebras-llama-4-maverick-17b-128e-instruct": { ctx: 128000, out: 4096, tools: true, vision: false, reasoning: false, cost: { input: 0, output: 0 } },
		"llama-4-scout-17b-16e-instruct-fp8": { ctx: 128000, out: 4096, tools: true, vision: true, reasoning: false, cost: { input: 0, output: 0 } },
		"llama-4-maverick-17b-128e-instruct-fp8": { ctx: 128000, out: 4096, tools: true, vision: true, reasoning: false, cost: { input: 0, output: 0 } },
		"cerebras-llama-4-scout-17b-16e-instruct": { ctx: 128000, out: 4096, tools: true, vision: false, reasoning: false, cost: { input: 0, output: 0 } },
		"llama-3.3-70b-instruct": { ctx: 128000, out: 4096, tools: true, vision: false, reasoning: false, cost: { input: 0, output: 0 } },
		"llama-3.3-8b-instruct": { ctx: 128000, out: 4096, tools: true, vision: false, reasoning: false, cost: { input: 0, output: 0 } },
	} },
	baseten: { title: "Baseten", endpoint: "https://inference.baseten.co/v1", keyUrl: "https://app.baseten.co/settings/api_keys", keyPlaceholder: "key...", liveList: true, note: "", models: {
		"deepseek-ai/DeepSeek-V4.1-Flash-Fast": { ctx: 1048576, out: 32768, tools: true, vision: true, reasoning: true, cost: { input: 0.6, output: 2.4 } },
		"deepseek-ai/DeepSeek-V4.1-Flash": { ctx: 1048576, out: 32768, tools: true, vision: true, reasoning: true, cost: { input: 0.3, output: 1.2 } },
		"zai-org/GLM-5.3-Flash": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.15, output: 0.5 } },
		"zai-org/GLM-5.3": { ctx: 1048576, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 1.4, output: 4.4 } },
		"zai-org/GLM-5.3-Fast": { ctx: 1048576, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 2.1, output: 6.6 } },
		"deepseek-ai/DeepSeek-V4-Pro-0813": { ctx: 1048576, out: 262144, tools: true, vision: false, reasoning: true, cost: { input: 1.32, output: 3.96 } },
		"deepseek-ai/DeepSeek-V4-Flash-0731": { ctx: 1048576, out: 384000, tools: true, vision: false, reasoning: true, cost: { input: 0.13, output: 0.26 } },
		"thinkingmachines/inkling-small": { ctx: 1048576, out: 32768, tools: true, vision: true, reasoning: true, cost: { input: 0.5, output: 1.2 } },
	} },
	scaleway: { title: "Scaleway", endpoint: "https://api.scaleway.ai/v1", keyUrl: "https://console.scaleway.com/iam/api-keys", keyPlaceholder: "key...", liveList: true, note: "", models: {
		"qwen3.8-27b": { ctx: 262144, out: 32768, tools: true, vision: true, reasoning: true, cost: { input: 0.684, output: 3.762 } },
		"deepseek-v4-flash-0731": { ctx: 256000, out: 32768, tools: true, vision: false, reasoning: true, cost: { input: 0.468, output: 0.936 } },
		"glm-5.2": { ctx: 256000, out: 16384, tools: true, vision: false, reasoning: true, cost: { input: 1.8, output: 5.5 } },
		"qwen3.6-35b-a3b": { ctx: 128000, out: 16384, tools: true, vision: true, reasoning: true, cost: { input: 0.25, output: 1.5 } },
		"mistral-medium-3.5-128b": { ctx: 256000, out: 16384, tools: true, vision: true, reasoning: true, cost: { input: 1.5, output: 7.5 } },
		"gemma-4-26b-a4b-it": { ctx: 256000, out: 16384, tools: true, vision: true, reasoning: true, cost: { input: 0.25, output: 0.5 } },
		"qwen3.5-397b-a17b": { ctx: 256000, out: 16384, tools: true, vision: true, reasoning: true, cost: { input: 0.6, output: 3.6 } },
		"qwen3-235b-a22b-instruct-2507": { ctx: 260000, out: 16384, tools: true, vision: false, reasoning: true, cost: { input: 0.75, output: 2.25 } },
	} },
	ovhcloud: { title: "OVHcloud AI Endpoints", endpoint: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1", keyUrl: "https://endpoints.ai.cloud.ovh.net", keyPlaceholder: "key...", liveList: true, note: "", models: {
		"qwen3.8-27b": { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 0.47, output: 3.19 } },
		"qwen3.6-27b": { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 0.47, output: 3.19 } },
		"qwen3.5-397b-a17b": { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 0.71, output: 4.25 } },
		"qwen3.5-9b": { ctx: 262144, out: 262144, tools: true, vision: true, reasoning: true, cost: { input: 0.12, output: 0.18 } },
		"qwen3-coder-30b-a3b-instruct": { ctx: 262144, out: 262144, tools: true, vision: false, reasoning: false, cost: { input: 0.07, output: 0.26 } },
		"gpt-oss-20b": { ctx: 131072, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 0.05, output: 0.18 } },
		"gpt-oss-120b": { ctx: 131072, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 0.09, output: 0.47 } },
		"mistral-small-3.2-24b-instruct-2506": { ctx: 131072, out: 131072, tools: true, vision: true, reasoning: false, cost: { input: 0.1, output: 0.31 } },
	} },
	venice: { title: "Venice", endpoint: "https://api.venice.ai/api/v1", keyUrl: "https://venice.ai/settings/api", keyPlaceholder: "key...", liveList: true, note: "", models: {
		"abliteration-abliterated-model-large-v2": { ctx: 1000000, out: 32768, tools: true, vision: false, reasoning: true, cost: { input: 3, output: 5 } },
		"openai-gpt-61-sol": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2.5, output: 12.5 } },
		"xiaomi-mimo-v2-6-flash": { ctx: 1000000, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.175, output: 0.35 } },
		"claude-opus-5-5-fast": { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 9.6, output: 48 } },
		"claude-sonnet-5-5": { ctx: 1000000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 2.5, output: 12.5 } },
		"aion-labs-aion-3-5-mini": { ctx: 262144, out: 32768, tools: true, vision: false, reasoning: true, cost: { input: 0.875, output: 1.75 } },
		"aion-labs-aion-3-5": { ctx: 262144, out: 32768, tools: true, vision: false, reasoning: true, cost: { input: 3.75, output: 7.5 } },
		"openai-gpt-6-luna": { ctx: 1050000, out: 128000, tools: true, vision: true, reasoning: true, cost: { input: 0.125, output: 0.625 } },
	} },
	xiaomi: { title: "Xiaomi MiMo", endpoint: "https://api.xiaomimimo.com/v1", keyUrl: "https://platform.xiaomimimo.com", keyPlaceholder: "sk-...", liveList: false, note: "", models: {
		"mimo-v2.6-flash": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.14, output: 0.28 } },
		"mimo-v2.6-pro": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.435, output: 0.87 } },
		"mimo-v2.6-pro-ultraspeed": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 4.35, output: 8.7 } },
		"mimo-v2.5-pro-ultraspeed": { ctx: 1048576, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 1.305, output: 2.61 } },
		"mimo-v2.5-pro": { ctx: 1048576, out: 131072, tools: true, vision: false, reasoning: true, cost: { input: 0.435, output: 0.87 } },
		"mimo-v2.5": { ctx: 1048576, out: 131072, tools: true, vision: true, reasoning: true, cost: { input: 0.14, output: 0.28 } },
	} },
	sambanova: { title: "SambaNova", endpoint: "https://api.sambanova.ai/v1", keyUrl: "https://cloud.sambanova.ai/apis", keyPlaceholder: "key...", liveList: true, note: "No built-in model list: enter the key and pick from the live list.", models: {
	} },
	hyperbolic: { title: "Hyperbolic", endpoint: "https://api.hyperbolic.xyz/v1", keyUrl: "https://app.hyperbolic.xyz/settings", keyPlaceholder: "key...", liveList: true, note: "No built-in model list: enter the key and pick from the live list.", models: {
	} },
	githubModels: { title: "GitHub Models", endpoint: "https://models.github.ai/inference", keyUrl: "https://github.com/settings/personal-access-tokens", keyPlaceholder: "github_pat_...", liveList: false, note: "Use a fine-grained token with the `models:read` permission. Model ids are `publisher/name`.", models: {
		"openai/gpt-4.1": { ctx: 1048576, out: 32768, tools: true, vision: true, reasoning: false, cost: { input: 0, output: 0 } },
		"openai/gpt-4.1-mini": { ctx: 1048576, out: 32768, tools: true, vision: true, reasoning: false, cost: { input: 0, output: 0 } },
		"meta/Llama-3.3-70B-Instruct": { ctx: 131072, out: 4096, tools: true, vision: false, reasoning: false, cost: { input: 0, output: 0 } },
		"deepseek/DeepSeek-R1": { ctx: 131072, out: 8192, tools: false, vision: false, reasoning: true, cost: { input: 0, output: 0 } },
	} },
} as const satisfies { [name: string]: VendorInfo }

export type VendorProviderName = keyof typeof vendorProviders
export const vendorProviderNames = Object.keys(vendorProviders) as VendorProviderName[]
export const isVendorProviderName = (p: string): p is VendorProviderName => Object.prototype.hasOwnProperty.call(vendorProviders, p)
export const vendorLiveListedNames = ["together", "fireworks", "cerebras", "cohere", "nvidia", "huggingface", "deepinfra", "nebius", "siliconflow", "stepfun", "vercel", "requesty", "inception", "llama", "baseten", "scaleway", "ovhcloud", "venice", "sambanova", "hyperbolic"] as const satisfies readonly VendorProviderName[]
