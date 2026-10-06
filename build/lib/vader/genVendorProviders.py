#!/usr/bin/env python3
"""Generates src/vs/workbench/contrib/vader/common/vendorProviderData.ts: first-class providers for the major model vendors and inference
platforms (gateway URL, key page, default models with context window / tool / vision / reasoning / price facts).

Source of the model facts and gateway URLs: the models.dev catalog (github.com/sst/models.dev), the community registry that OpenCode uses; vendors
absent from it are filled from the vendor's public documentation as recorded in LiteLLM's provider list and are marked `source: 'docs'`.
Provider documentation hosts are not reachable from the build environment, so none of the endpoints could be exercised live; a wrong
default is corrected by editing the Endpoint field, and every vendor with an OpenAI-style /models route also lists its real models once a key works.

  git clone --depth 1 https://github.com/sst/models.dev /tmp/modelsdev
  python3 build/lib/vader/genVendorProviders.py /tmp/modelsdev
"""
import os, sys, tomllib, subprocess, json

SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '/tmp/modelsdev')
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'src/vs/workbench/contrib/vader/common/vendorProviderData.ts')
commit = subprocess.check_output(['git', '-C', SRC, 'rev-parse', '--short=9', 'HEAD']).decode().strip()
date = subprocess.check_output(['git', '-C', SRC, 'log', '-1', '--format=%cs']).decode().strip()

# key -> (models.dev provider dir or None, title, endpoint, key page, key placeholder, live /models list?, note)
V = [
  ('together',    'togetherai',            'Together AI',               'https://api.together.xyz/v1',                         'https://api.together.ai/settings/api-keys',            'key...',      True,  ''),
  ('fireworks',   'fireworks-ai',          'Fireworks AI',              'https://api.fireworks.ai/inference/v1',               'https://app.fireworks.ai/settings/users/api-keys',     'fw_...',      True,  ''),
  ('cerebras',    'cerebras',              'Cerebras',                  'https://api.cerebras.ai/v1',                          'https://cloud.cerebras.ai/platform',                   'csk-...',     True,  ''),
  ('cohere',      'cohere',                'Cohere',                    'https://api.cohere.ai/compatibility/v1',              'https://dashboard.cohere.com/api-keys',                'key...',      True,  'Uses Cohere\'s OpenAI-compatibility endpoint.'),
  ('zai',         'zai',                   'Z.AI (GLM)',                'https://api.z.ai/api/paas/v4',                        'https://z.ai/manage-apikey/apikey-list',               'key...',      False, 'Mainland China accounts should change the Endpoint above to `https://open.bigmodel.cn/api/paas/v4`.'),
  ('perplexity',  'perplexity',            'Perplexity',                'https://api.perplexity.ai',                           'https://www.perplexity.ai/settings/api',               'pplx-...',    False, 'Sonar models search the web and do not call tools, so they answer in chat but cannot drive the agent.'),
  ('nvidia',      'nvidia',                'NVIDIA NIM',                'https://integrate.api.nvidia.com/v1',                 'https://build.nvidia.com/settings/api-keys',           'nvapi-...',   True,  ''),
  ('huggingface', 'huggingface',           'Hugging Face',              'https://router.huggingface.co/v1',                    'https://huggingface.co/settings/tokens',               'hf_...',      True,  'Inference Providers router: use a token with the "Make calls to Inference Providers" permission.'),
  ('deepinfra',   'deepinfra',             'DeepInfra',                 'https://api.deepinfra.com/v1/openai',                 'https://deepinfra.com/dash/api_keys',                  'key...',      True,  ''),
  ('nebius',      'nebius',                'Nebius Token Factory',      'https://api.tokenfactory.nebius.com/v1',              'https://tokenfactory.nebius.com',                      'key...',      True,  ''),
  ('cloudflare',  'cloudflare-workers-ai', 'Cloudflare Workers AI',     'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1', 'https://dash.cloudflare.com/profile/api-tokens', 'key...',      False, 'Replace `ACCOUNT_ID` in the Endpoint above with your Cloudflare account id.'),
  ('novita',      'novita-ai',             'Novita AI',                 'https://api.novita.ai/openai',                        'https://novita.ai/settings/key-management',            'sk_...',      False, ''),
  ('siliconflow', 'siliconflow',           'SiliconFlow',               'https://api.siliconflow.com/v1',                      'https://cloud.siliconflow.com/account/ak',             'sk-...',      True,  'Mainland China accounts should change the Endpoint above to `https://api.siliconflow.cn/v1`.'),
  ('volcengine',  'volcengine',            'Volcengine Ark (Doubao)',   'https://ark.cn-beijing.volces.com/api/v3',            'https://console.volcengine.com/ark',                   'key...',      False, 'Models are addressed by your endpoint id (`ep-...`) or model id from the Ark console: add it with "Add model".'),
  ('stepfun',     'stepfun',               'StepFun',                   'https://api.stepfun.com/v1',                          'https://platform.stepfun.com/interface-key',           'key...',      True,  ''),
  ('vercel',      'vercel',                'Vercel AI Gateway',         'https://ai-gateway.vercel.sh/v1',                     'https://vercel.com/~/ai-gateway/api-keys',             'vck_...',     True,  'A gateway to many vendors; model ids look like `anthropic/claude-sonnet-5.5`.'),
  ('requesty',    'requesty',              'Requesty',                  'https://router.requesty.ai/v1',                       'https://app.requesty.ai/api-keys',                     'key...',      True,  'A gateway to many vendors.'),
  ('ai21',        'ai21',                  'AI21 Labs (Jamba)',         'https://api.ai21.com/studio/v1',                      'https://studio.ai21.com/account/api-key',              'key...',      False, ''),
  ('upstage',     'upstage',               'Upstage (Solar)',           'https://api.upstage.ai/v1/solar',                     'https://console.upstage.ai/api-keys',                  'up_...',      False, ''),
  ('inception',   'inception',             'Inception (Mercury)',       'https://api.inceptionlabs.ai/v1',                     'https://platform.inceptionlabs.ai/dashboard/api-keys', 'sk_...',      True,  ''),
  ('llama',       'llama',                 'Meta Llama API',            'https://api.llama.com/compat/v1',                     'https://llama.developer.meta.com',                     'LLM|...',     True,  'Uses Meta\'s OpenAI-compatibility endpoint.'),
  ('baseten',     'baseten',               'Baseten',                   'https://inference.baseten.co/v1',                     'https://app.baseten.co/settings/api_keys',             'key...',      True,  ''),
  ('scaleway',    'scaleway',              'Scaleway',                  'https://api.scaleway.ai/v1',                          'https://console.scaleway.com/iam/api-keys',            'key...',      True,  ''),
  ('ovhcloud',    'ovhcloud',              'OVHcloud AI Endpoints',     'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',    'https://endpoints.ai.cloud.ovh.net',                   'key...',      True,  ''),
  ('venice',      'venice',                'Venice',                    'https://api.venice.ai/api/v1',                        'https://venice.ai/settings/api',                       'key...',      True,  ''),
  ('xiaomi',      'xiaomi',                'Xiaomi MiMo',               'https://api.xiaomimimo.com/v1',                       'https://platform.xiaomimimo.com',                      'sk-...',      False, ''),
  # not in models.dev: endpoints from the vendors' documentation (see LiteLLM's provider list); the model list comes from the live /models call
  ('sambanova',   None,                    'SambaNova',                 'https://api.sambanova.ai/v1',                         'https://cloud.sambanova.ai/apis',                      'key...',      True,  'No built-in model list: enter the key and pick from the live list.'),
  ('hyperbolic',  None,                    'Hyperbolic',                'https://api.hyperbolic.xyz/v1',                       'https://app.hyperbolic.xyz/settings',                  'key...',      True,  'No built-in model list: enter the key and pick from the live list.'),
  ('githubModels', None,                   'GitHub Models',             'https://models.github.ai/inference',                  'https://github.com/settings/personal-access-tokens',   'github_pat_...', False, 'Use a fine-grained token with the `models:read` permission. Model ids are `publisher/name`.'),
]
MANUAL = {  # vendors without a catalog entry that cannot list models live
  'githubModels': [('openai/gpt-4.1', 1048576, 32768, True, True, False, 0, 0), ('openai/gpt-4.1-mini', 1048576, 32768, True, True, False, 0, 0),
                   ('meta/Llama-3.3-70B-Instruct', 131072, 4096, True, False, False, 0, 0), ('deepseek/DeepSeek-R1', 131072, 8192, False, False, True, 0, 0)],
}
PER_VENDOR = 8
AGGREGATORS = {'vercel': 12, 'requesty': 12}

def load(path):
    try:
        with open(path, 'rb') as f: return tomllib.load(f)
    except Exception: return None

def model_facts(provider_dir, rel):
    m = load(os.path.join(SRC, 'providers', provider_dir, 'models', rel + '.toml')) or {}
    base = m.get('base_model')
    b = load(os.path.join(SRC, 'models', base + '.toml')) if base else {}
    b = b or {}
    g = lambda k, d=None: m.get(k, b.get(k, d))
    limit = {**(b.get('limit') or {}), **(m.get('limit') or {})}
    cost = {**(b.get('cost') or {}), **(m.get('cost') or {})}
    mods = {**(b.get('modalities') or {}), **(m.get('modalities') or {})}
    return dict(tool=bool(g('tool_call', False)), reasoning=bool(g('reasoning', False)), vision='image' in (mods.get('input') or []),
                ctx=int(limit.get('context') or 0), out=int(limit.get('output') or 0), release=str(g('release_date', '') or g('last_updated', '') or ''),
                status=str(g('status', '') or ''), cin=float(cost.get('input') or 0), cout=float(cost.get('output') or 0),
                text_out='text' in (mods.get('output') or ['text']), name=str(g('name', rel)))

def models_of(provider_dir, limit):
    base = os.path.join(SRC, 'providers', provider_dir, 'models')
    found = []
    for root, _, files in os.walk(base):
        for f in files:
            if f.endswith('.toml'):
                rel = os.path.relpath(os.path.join(root, f), base)[:-5].replace(os.sep, '/')
                fa = model_facts(provider_dir, rel)
                if fa['status'] in ('deprecated', 'retired') or not fa['text_out'] or fa['ctx'] <= 0: continue
                if any(w in rel.lower() for w in ('embed', 'rerank', 'whisper', 'tts', 'image', 'guard', 'moderation', 'transcribe', 'speech')): continue
                found.append((rel, fa))
    tools = [x for x in found if x[1]['tool']]
    pool = tools if len(tools) >= 3 else found
    pool.sort(key=lambda x: (x[1]['release'], x[1]['ctx']), reverse=True)
    return pool[:limit]

def q(s): return json.dumps(s, ensure_ascii=False)

out = ["""/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// GENERATED - do not edit by hand. Regenerate with build/lib/vader/genVendorProviders.py (see that file for the sources).
//
// First-class providers for model vendors and inference platforms that are reached through an OpenAI-compatible gateway: the gateway
// URL, where to get a key, and the newest tool-calling models with their context window, price and capabilities, taken from the models.dev
// catalog (commit %s, %s). A model that is not listed here still works: with a key, the vendor's own /models route is queried where it
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

export const vendorProviders = {""" % (commit, date)]
live = []
for key, d, title, endpoint, keyurl, ph, liveflag, note in V:
    models = []
    if d: models = [(rel, fa['ctx'], fa['out'], fa['tool'], fa['vision'], fa['reasoning'], fa['cin'], fa['cout']) for rel, fa in models_of(d, AGGREGATORS.get(key, PER_VENDOR))]
    elif key in MANUAL: models = MANUAL[key]
    if liveflag: live.append(key)
    out.append(f"\t{key}: {{ title: {q(title)}, endpoint: {q(endpoint)}, keyUrl: {q(keyurl)}, keyPlaceholder: {q(ph)}, liveList: {str(liveflag).lower()}, note: {q(note)}, models: {{")
    for rel, ctx, o, tool, vis, rea, cin, cout in models:
        out.append(f"\t\t{q(rel)}: {{ ctx: {ctx}, out: {o}, tools: {str(tool).lower()}, vision: {str(vis).lower()}, reasoning: {str(rea).lower()}, cost: {{ input: {cin:g}, output: {cout:g} }} }},")
    out.append("\t} },")
out.append("} as const satisfies { [name: string]: VendorInfo }\n")
out.append("export type VendorProviderName = keyof typeof vendorProviders")
out.append("export const vendorProviderNames = Object.keys(vendorProviders) as VendorProviderName[]")
out.append("export const isVendorProviderName = (p: string): p is VendorProviderName => Object.prototype.hasOwnProperty.call(vendorProviders, p)")
out.append("export const vendorLiveListedNames = [" + ", ".join(q(k) for k in live) + "] as const satisfies readonly VendorProviderName[]")
open(OUT, 'w').write("\n".join(out) + "\n")
print('wrote', os.path.relpath(OUT, ROOT), len(V), 'vendors')
