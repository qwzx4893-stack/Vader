#!/usr/bin/env python3
"""Generates src/vs/workbench/contrib/vader/common/providerLogoData.ts: the real logo of every model provider, as plain data.

Sources (all open source icon sets; the marks themselves remain the property of their owners and are used here only to identify
the provider, nominative use):
  - lobe-icons    https://github.com/lobehub/lobe-icons   (MIT)   packages/static-svg/icons/<name>.svg, the single-colour variants
  - models.dev    https://github.com/sst/models.dev       (MIT)   providers/<id>/logo.svg
  - LiteLLM       https://github.com/BerriAI/litellm      (MIT)   the official monogram shipped in its admin UI
  - Requesty      https://github.com/requestyai/n8n-requesty (MIT) icons/requesty.svg, the official icon
  - OpenAI-Compatible has no brand: a neutral "< >" glyph drawn here.

Every logo becomes ONE colour (currentColor), so it follows the theme and never clashes with the interface's visual identity. The SVG
is converted to a small element tree (tag, attributes, children) instead of markup, so the renderer builds it with React.createElement and
no innerHTML is involved (the workbench enforces Trusted Types). Only a fixed set of tags and attributes survives.

  git clone --depth 1 https://github.com/lobehub/lobe-icons /tmp/lobe          # packages/static-svg/icons is enough
  git clone --depth 1 https://github.com/sst/models.dev /tmp/modelsdev
  python3 build/lib/vader/genProviderLogos.py --lobe /tmp/lobe/packages/static-svg/icons --modelsdev /tmp/modelsdev \
      --litellm <litellm_monogram.svg> --requesty <requesty.svg>
"""
import argparse, json, os, re, sys
import xml.etree.ElementTree as ET

ap = argparse.ArgumentParser()
ap.add_argument('--lobe', default='/tmp/lobe/packages/static-svg/icons')
ap.add_argument('--modelsdev', default='/tmp/modelsdev')
ap.add_argument('--litellm', default='/home/user/berriai/litellm/litellm/proxy/_experimental/out/assets/logos/litellm_monogram.svg')
ap.add_argument('--requesty', default='/tmp/rq/n8n-requesty/icons/requesty.svg')
ap.add_argument('--sheet', default='')
args = ap.parse_args()
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'src/vs/workbench/contrib/vader/common/providerLogoData.ts')

# ProviderName -> source
SRC = {
  'openAI': ('lobe', 'openai'), 'anthropic': ('lobe', 'anthropic'), 'xAI': ('lobe', 'xai'), 'gemini': ('lobe', 'gemini'),
  'deepseek': ('lobe', 'deepseek'), 'ollama': ('lobe', 'ollama'), 'vLLM': ('lobe', 'vllm'), 'lmStudio': ('lobe', 'lmstudio'),
  'openRouter': ('lobe', 'openrouter'), 'groq': ('lobe', 'groq'), 'mistral': ('lobe', 'mistral'), 'openAICompatible': ('generic', ''),
  'googleVertex': ('lobe', 'vertexai'), 'microsoftAzure': ('lobe', 'azure'), 'awsBedrock': ('lobe', 'bedrock'), 'liteLLM': ('litellm', ''),
  'minimax': ('lobe', 'minimax'), 'alibaba': ('lobe', 'qwen'), 'moonshot': ('lobe', 'moonshot'), 'openCodeZen': ('lobe', 'opencode'),
  'together': ('lobe', 'together'), 'fireworks': ('lobe', 'fireworks'), 'cerebras': ('lobe', 'cerebras'), 'cohere': ('lobe', 'cohere'),
  'zai': ('lobe', 'zai'), 'perplexity': ('lobe', 'perplexity'), 'nvidia': ('lobe', 'nvidia'), 'huggingface': ('lobe', 'huggingface'),
  'deepinfra': ('lobe', 'deepinfra'), 'nebius': ('lobe', 'nebius'), 'cloudflare': ('lobe', 'workersai'), 'novita': ('lobe', 'novita'),
  'siliconflow': ('lobe', 'siliconcloud'), 'volcengine': ('lobe', 'volcengine'), 'stepfun': ('lobe', 'stepfun'), 'vercel': ('lobe', 'vercel'),
  'requesty': ('requesty', ''), 'ai21': ('lobe', 'ai21'), 'upstage': ('lobe', 'upstage'), 'inception': ('lobe', 'inception'),
  'llama': ('lobe', 'meta'), 'baseten': ('lobe', 'baseten'), 'scaleway': ('modelsdev', 'scaleway'), 'ovhcloud': ('modelsdev', 'ovhcloud'),
  'venice': ('lobe', 'venice'), 'xiaomi': ('lobe', 'xiaomimimo'), 'sambanova': ('lobe', 'sambanova'), 'hyperbolic': ('lobe', 'hyperbolic'),
  'githubModels': ('lobe', 'github'),
}

TAGS = {'g', 'path', 'circle', 'rect', 'ellipse', 'polygon', 'polyline', 'line', 'mask', 'defs', 'clipPath'}
ATTRS = {  # svg name -> react name
  'd': 'd', 'cx': 'cx', 'cy': 'cy', 'r': 'r', 'rx': 'rx', 'ry': 'ry', 'x': 'x', 'y': 'y', 'width': 'width', 'height': 'height', 'points': 'points',
  'x1': 'x1', 'y1': 'y1', 'x2': 'x2', 'y2': 'y2', 'transform': 'transform', 'fill-rule': 'fillRule', 'clip-rule': 'clipRule', 'opacity': 'opacity',
  'fill-opacity': 'fillOpacity', 'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin',
  'id': 'id', 'mask': 'mask', 'clip-path': 'clipPath', 'maskUnits': 'maskUnits',
}
SAFE_VALUE = re.compile(r'^[A-Za-z0-9 .,\-+()#:%/_]*$')
WHITE = {'#fff', '#ffffff', 'white', '#fbfcff', '#fcfdff'}

def local(tag): return tag.split('}')[-1]

def convert(el, white_to_hole=False):
    tag = local(el.tag)
    if tag not in TAGS:
        return None
    attrs = {}
    for k, v in el.attrib.items():
        k = local(k)
        if k in ATTRS:
            if not SAFE_VALUE.match(v) and k != 'd' and k != 'points':
                raise SystemExit(f'unsafe attribute {k}={v!r}')
            attrs[ATTRS[k]] = v
        elif k == 'fill':
            attrs['_fill'] = v.strip().lower()
        elif k == 'stroke':
            attrs['stroke'] = 'currentColor' if v.strip().lower() not in ('none', 'transparent') else 'none'
        elif k == 'stroke-width':
            attrs['strokeWidth'] = v
    fill = attrs.pop('_fill', None)
    if fill == 'none':
        attrs['fill'] = 'none'
    kids = [c for c in (convert(c) for c in el) if c is not None]
    return {'t': tag, 'a': attrs, 'k': kids, '_fill': fill}

def strip(node):
    node.pop('_fill', None)
    for c in node['k']: strip(c)
    return node

def parse(path):
    root = ET.parse(path).getroot()
    vb = root.attrib.get('viewBox')
    if not vb:
        w = float(re.sub('[^0-9.]', '', root.attrib.get('width', '24'))); h = float(re.sub('[^0-9.]', '', root.attrib.get('height', '24')))
        vb = f'0 0 {w:g} {h:g}'
    kids = [c for c in (convert(c) for c in root) if c is not None]
    return vb, kids

def paths_of(nodes):
    for n in nodes:
        yield n
        yield from paths_of(n['k'])

def flatten_colours(kids):
    """one colour: everything keeps/gets currentColor; light fills (white) become holes only when asked for by the caller"""
    for n in paths_of(kids):
        n.pop('_fill', None)

def requesty():
    # blue speech bubble with a white ">_" prompt -> the bubble in the text colour, the prompt cut out with a mask
    root = ET.parse(args.requesty).getroot()
    vb = root.attrib['viewBox']
    nodes = [convert(c) for c in root]
    nodes = [n for n in nodes if n]
    bubble = [n for n in nodes if n['_fill'] and n['_fill'] not in WHITE]
    prompt = [n for n in nodes if n['_fill'] in WHITE]
    if not bubble or not prompt: raise SystemExit('requesty: unexpected structure')
    x0, y0, w, h = [float(v) for v in vb.split()]
    mask_children = [{'t': 'rect', 'a': {'x': f'{x0:g}', 'y': f'{y0:g}', 'width': f'{w:g}', 'height': f'{h:g}', 'fill': '#fff'}, 'k': []}]
    for n in prompt:
        n['a']['fill'] = '#000'
        mask_children.append(n)
    mask = {'t': 'mask', 'a': {'id': 'vader-logo-requesty', 'maskUnits': 'userSpaceOnUse'}, 'k': mask_children}
    group = {'t': 'g', 'a': {'mask': 'url(#vader-logo-requesty)'}, 'k': bubble}
    return vb, [mask, group]

def generic():
    # OpenAI-compatible endpoint: no brand, a neutral "< / >" glyph
    stroke = {'stroke': 'currentColor', 'strokeWidth': '2', 'strokeLinecap': 'round', 'strokeLinejoin': 'round', 'fill': 'none'}
    return '0 0 24 24', [
        {'t': 'path', 'a': {**stroke, 'd': 'M8 7 3 12l5 5'}, 'k': []},
        {'t': 'path', 'a': {**stroke, 'd': 'm16 7 5 5-5 5'}, 'k': []},
        {'t': 'path', 'a': {**stroke, 'd': 'M13.5 5 10.5 19'}, 'k': []},
    ]

logos = {}
for key, (kind, name) in SRC.items():
    if kind == 'lobe': vb, kids = parse(os.path.join(args.lobe, name + '.svg'))
    elif kind == 'modelsdev': vb, kids = parse(os.path.join(args.modelsdev, 'providers', name, 'logo.svg'))
    elif kind == 'litellm': vb, kids = parse(args.litellm)
    elif kind == 'requesty': vb, kids = requesty()
    else: vb, kids = generic()
    if kind not in ('requesty', 'generic'): flatten_colours(kids)
    if not kids: raise SystemExit(f'{key}: empty logo')
    for n in kids: strip(n)
    logos[key] = {'vb': vb, 'els': kids}

def ts_node(n):
    attrs = ', '.join(f'{k}: {json.dumps(v)}' for k, v in n['a'].items())
    kids = ', '.join(ts_node(c) for c in n['k'])
    return f'[{json.dumps(n["t"])}, {{ {attrs} }}, [{kids}]]'

lines = []
for key, lg in logos.items():
    lines.append(f'\t{key}: {{ vb: {json.dumps(lg["vb"])}, els: [' + ', '.join(ts_node(n) for n in lg['els']) + '] },')
body = '\n'.join(lines)
out = f'''/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *--------------------------------------------------------------------------------------*/

// GENERATED - do not edit by hand. Regenerate with build/lib/vader/genProviderLogos.py (see that file for the sources and licences).
//
// The real logo of every model provider, as one-colour (currentColor) element trees. The marks remain the property of their owners and are
// shown only to identify the provider. Rendered by react/src/util/ProviderLogo.tsx with React.createElement (no innerHTML).

export type LogoNode = readonly [tag: string, attrs: {{ readonly [name: string]: string }}, children: readonly LogoNode[]]
export type ProviderLogoData = {{ readonly vb: string; readonly els: readonly LogoNode[] }}

export const providerLogos = {{
{body}
}} as const satisfies {{ readonly [providerName: string]: ProviderLogoData }}

export type ProviderLogoName = keyof typeof providerLogos
'''
open(OUT, 'w').write(out)
print('wrote', OUT, len(logos), 'logos', len(out) // 1024, 'KB')

if args.sheet:  # contact sheet for eyeballing
    cells = ''.join(f'<div style="display:inline-block;width:110px;text-align:center;margin:8px;font:11px sans-serif"><svg viewBox="{lg["vb"]}" width="48" height="48" fill="currentColor">' + ''.join(
        (lambda f: f(f, n))(lambda f, n: f'<{n["t"]} ' + ' '.join(f'{re.sub("([A-Z])", lambda m: "-" + m.group(1).lower(), k)}="{v}"' for k, v in n['a'].items()) + '>' + ''.join(f(f, c) for c in n['k']) + f'</{n["t"]}>') for n in lg['els']) + f'</svg><br>{k}</div>' for k, lg in logos.items())
    open(args.sheet, 'w').write(f'<body style="margin:0"><div style="background:#1e1e1e;color:#e8e8e8;padding:10px">{cells}</div><div style="background:#fff;color:#111;padding:10px">{cells}</div></body>')
