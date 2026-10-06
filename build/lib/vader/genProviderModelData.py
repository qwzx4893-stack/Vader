import json, subprocess, datetime
SRC='/home/user/berriai/litellm/litellm/model_prices_and_context_window_backup.json'
commit=subprocess.check_output(['git','-C','/home/user/berriai/litellm','rev-parse','--short=9','HEAD']).decode().strip()
d=json.load(open(SRC))
# provider key -> (catalog prefix, [curated ids in display order])
SEL={
 'openAI':('',['gpt-6.1-sol','gpt-6-astra','gpt-6-luna','gpt-5.5','gpt-5.4','gpt-5.4-mini','gpt-4.1','gpt-4.1-mini','o3']),
 'anthropic':('',['claude-fable-5-1','claude-opus-5-5','claude-sonnet-5-5','claude-opus-4-8','claude-sonnet-4-6','claude-haiku-4-5']),
 'gemini':('gemini/',['gemini-pro-latest','gemini-flash-latest','gemini-3.1-pro-preview','gemini-3.8-flash','gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite']),
 'xAI':('xai/',['grok-4.7','grok-4.6','grok-4.5','grok-4.3','grok-code-fast-1']),
 'groq':('groq/',['openai/gpt-oss-120b','openai/gpt-oss-20b','qwen/qwen3.8-27b']),
 'mistral':('mistral/',['mistral-large-latest','mistral-medium-latest','mistral-small-latest','codestral-latest','devstral-latest','magistral-medium-latest','ministral-8b-latest']),
 'deepseek':('deepseek/',['deepseek-v4-pro','deepseek-v4-flash']),
 'moonshot':('moonshot/',['kimi-k3','kimi-k2.7-code','kimi-k2.6']),
 'minimax':('minimax/',['MiniMax-M3']),
 'alibaba':('dashscope/',['qwen3.8-max','qwen3.8-flash','qwen3.7-max','qwen3-coder-plus','qwen-plus','qwq-plus']),
 'openRouter':('openrouter/',['anthropic/claude-opus-5.5','anthropic/claude-sonnet-5.5','anthropic/claude-fable-5.1','anthropic/claude-haiku-4.5','openai/gpt-6.1-sol','openai/gpt-5.5','google/gemini-3.1-pro-preview','google/gemini-3.8-flash','deepseek/deepseek-v4-pro','x-ai/grok-4.7','qwen/qwen3.8-max','moonshotai/kimi-k3']),
}
out=[]
out.append("""/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// GENERATED - do not edit by hand. Regenerate with build/lib/vader/genProviderModelData.py - see docs/integrations/providers/README.md.
//
// Per-model facts for the models Vader offers by default, taken from the LiteLLM project's model catalog
// (BerriAI/litellm, litellm/model_prices_and_context_window_backup.json, commit %s, %s), the most widely used open-source
// registry of provider models. Provider documentation hosts are not reachable from the build environment, so this is the
// single source of these numbers, and a model Vader does not list here still works: once a working API key is entered the
// provider's own /models endpoint is queried (see electron-main/llmMessage/modelListing.ts) and name-family fallbacks in
// modelCapabilities.ts supply sane capabilities.
//
// ctx / out are tokens; cost is USD per million tokens. `reasoning` is the catalog's supports_reasoning flag.
// `adaptive` marks Anthropic models that only support adaptive thinking (no legacy budget_tokens parameter).

export type CuratedModelFacts = {
	ctx: number; out: number; tools: boolean; vision: boolean; reasoning: boolean; adaptive?: boolean;
	cost: { input: number; output: number; cache_read?: number };
}

export const curatedModelFacts: { [provider in string]: { [model: string]: CuratedModelFacts } } = {""" % (commit, datetime.date.today().isoformat()))
missing=[]
for prov,(prefix,ids) in SEL.items():
    out.append(f"\t{prov}: {{")
    for i in ids:
        v=d.get(prefix+i)
        if not v: missing.append(prefix+i); continue
        dep=v.get('deprecation_date')
        if dep and dep <= (datetime.date.today()+datetime.timedelta(days=30)).isoformat():
            raise SystemExit(f"{prefix+i} is deprecated on {dep} - pick another model")
        ctx=v.get('max_input_tokens') or v.get('max_tokens') or 32000
        o=v.get('max_output_tokens') or v.get('max_tokens') or 8192
        c=lambda k: round((v.get(k) or 0)*1e6,4)
        cost={'input':c('input_cost_per_token'),'output':c('output_cost_per_token')}
        cr=c('cache_read_input_token_cost')
        if cr: cost['cache_read']=cr
        cs=', '.join(f"{k}: {x}" for k,x in cost.items())
        ad=', adaptive: true' if v.get('supports_adaptive_thinking') and not v.get('supports_legacy_thinking') else ''
        out.append(f"\t\t'{i}': {{ ctx: {ctx}, out: {o}, tools: {str(bool(v.get('supports_function_calling'))).lower()}, vision: {str(bool(v.get('supports_vision'))).lower()}, reasoning: {str(bool(v.get('supports_reasoning'))).lower()}{ad}, cost: {{ {cs} }} }},")
    out.append("\t},")
out.append("}\n")
out.append("export const curatedModelNames = {\n"+''.join(f"\t{p}: {json.dumps([i for i in ids if (pf+i) in d])},\n" for p,(pf,ids) in SEL.items())+"} as const\n")
open('/home/user/vader-upgrade/src/vs/workbench/contrib/vader/common/providerModelData.ts','w').write('\n'.join(out))
print('missing:',missing)
