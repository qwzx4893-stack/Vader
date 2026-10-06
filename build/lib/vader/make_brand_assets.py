#!/usr/bin/env python3
"""Generates every Vader brand asset from the two source images in brand/source/.

  brand/source/logo-black.jpg   the logo, white on a black background (the app icon)
  brand/source/banner.jpg       the wide banner (README / social preview)

Run from the repository root:   python3 build/lib/vader/make_brand_assets.py
Needs:  pip install pillow numpy potracer

The transparent logo is derived from the black one (brightness becomes opacity), so the white logo can sit on any dark or grey surface.
Light-theme surfaces get a dark variant of the same shape (a white logo on white would vanish).
"""
import io
import os
import sys
import numpy as np
from PIL import Image, ImageDraw
import potrace

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
P = lambda *a: os.path.join(ROOT, *a)

src = Image.open(P('brand/source/logo-black.jpg')).convert('L')
a = np.asarray(src, dtype=np.float32)
alpha = np.clip((a - 40) / (215 - 40), 0, 1)          # JPEG noise below 40 is background, above 215 is solid logo
mask = Image.fromarray((alpha * 255).astype(np.uint8), 'L')
bbox = mask.point(lambda v: 255 if v > 24 else 0).getbbox()


def logo_rgba(color=(255, 255, 255)):
    im = Image.new('RGBA', mask.size, color + (0,))
    im.putalpha(mask)
    return im


def square_logo(size, pad=0.0, color=(255, 255, 255)):
    """The logo, tightly cropped, centred on a transparent square canvas, `pad` = margin as a fraction of the canvas."""
    tight = logo_rgba(color).crop(bbox)
    inner = int(size * (1 - 2 * pad))
    scale = inner / max(tight.size)
    t = tight.resize((max(1, round(tight.width * scale)), max(1, round(tight.height * scale))), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), color + (0,))
    out.paste(t, ((size - t.width) // 2, (size - t.height) // 2), t)
    return out


def on_black(size, pad=0.06, rounded=0.0, margin=0.0):
    """The logo on a solid black square (the app icon). `rounded` = corner radius fraction, `margin` = transparent margin (macOS)."""
    inner = int(size * (1 - 2 * margin))
    base = Image.new('RGBA', (inner, inner), (0, 0, 0, 255))
    base.alpha_composite(square_logo(inner, pad))
    if rounded:
        m = Image.new('L', (inner * 4, inner * 4), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, inner * 4 - 1, inner * 4 - 1], radius=int(inner * 4 * rounded), fill=255)
        base.putalpha(m.resize((inner, inner), Image.LANCZOS))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(base, ((size - inner) // 2, (size - inner) // 2), base)
    return out


def save_png(im, *path):
    p = P(*path); os.makedirs(os.path.dirname(p), exist_ok=True); im.save(p, optimize=True); print('wrote', os.path.relpath(p, ROOT), im.size)


# ---- brand/ (source of truth for docs and the website)
save_png(on_black(1024, pad=0.04), 'brand/logo-black-1024.png')
save_png(square_logo(1024, pad=0.02), 'brand/logo-transparent.png')
save_png(square_logo(1024, pad=0.02, color=(24, 24, 24)), 'brand/logo-transparent-dark.png')
banner = Image.open(P('brand/source/banner.jpg')).convert('RGB')
save_png(banner, 'docs/assets/banner.png') if False else None
os.makedirs(P('docs/assets'), exist_ok=True)
banner.save(P('docs/assets/banner.jpg'), quality=92, optimize=True); print('wrote docs/assets/banner.jpg', banner.size)
# GitHub social preview: 1280x640 (2:1), cropped around the logo
w, h = banner.size
social = banner.crop((0, (h - w // 2) // 2 if h > w // 2 else 0, w, ((h - w // 2) // 2 if h > w // 2 else 0) + min(h, w // 2))).resize((1280, 640), Image.LANCZOS)
social.save(P('docs/assets/social-preview.png'), optimize=True); print('wrote docs/assets/social-preview.png', social.size)
save_png(on_black(512, pad=0.05), 'docs/assets/logo.png')
save_png(square_logo(512, pad=0.02), 'docs/assets/logo-transparent.png')

# ---- Windows
ico = on_black(256, pad=0.05)
os.makedirs(P('resources/win32'), exist_ok=True)
ico.save(P('resources/win32/code.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (72, 72), (96, 96), (128, 128), (256, 256)]); print('wrote resources/win32/code.ico')
save_png(on_black(150, pad=0.08).convert('RGB'), 'resources/win32/code_150x150.png')
save_png(on_black(70, pad=0.08).convert('RGB'), 'resources/win32/code_70x70.png')
# installer: left panel (164x314 at 100%) and the small header image (55x55 at 100%), every DPI step
for scale, (bw, bh), (sw, sh) in [(100, (164, 314), (55, 55)), (125, (192, 386), (64, 68)), (150, (246, 459), (83, 80)), (175, (273, 556), (92, 97)),
                                  (200, (328, 604), (110, 106)), (225, (355, 700), (119, 123)), (250, (410, 797), (138, 140))]:
    big = Image.new('RGB', (bw, bh), (0, 0, 0))
    lg = square_logo(int(bw * 0.92), pad=0.0)
    big.paste(lg, ((bw - lg.width) // 2, int(bh * 0.30)), lg)
    big.save(P(f'resources/win32/inno-big-{scale}.bmp'))
    small = Image.new('RGB', (sw, sh), (0, 0, 0))
    ls = square_logo(min(sw, sh), pad=0.04)
    small.paste(ls, ((sw - ls.width) // 2, (sh - ls.height) // 2), ls)
    small.save(P(f'resources/win32/inno-small-{scale}.bmp'))
print('wrote installer images')

# ---- Linux / server / web
save_png(on_black(1024, pad=0.04), 'resources/linux/code.png')
save_png(on_black(192, pad=0.05), 'resources/server/code-192.png')
save_png(on_black(512, pad=0.05), 'resources/server/code-512.png')
on_black(256, pad=0.05).save(P('resources/server/favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)]); print('wrote resources/server/favicon.ico')
save_png(on_black(256, pad=0.05), 'scripts/appimage/vader.png')

# ---- macOS: a rounded black square with the usual margin
mac = on_black(1024, pad=0.07, rounded=0.225, margin=0.098)
os.makedirs(P('resources/darwin'), exist_ok=True)
mac.save(P('resources/darwin/code.icns')); print('wrote resources/darwin/code.icns')

# ---- in-app: the logo without a background for grey/black surfaces (banner part, getting started, walkthrough file icons)
save_png(square_logo(128, pad=0.0), 'src/vs/workbench/browser/media/vader-icon-sm.png')


# ---- vector logo (traced from the mask) for the editor watermark and the other SVG logo slots
def trace_path():
    tight = mask.crop(bbox)
    bm = potrace.Bitmap(np.asarray(tight) <= 110)  # potracer traces the "false" pixels of its input: invert so the logo is what gets traced
    plist = bm.trace(turdsize=20, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.0, opticurve=True, opttolerance=0.2)
    parts = []
    for curve in plist:
        s = curve.start_point
        parts.append(f'M{s.x:.1f},{s.y:.1f}')
        for seg in curve.segments:
            if seg.is_corner:
                parts.append(f'L{seg.c.x:.1f},{seg.c.y:.1f}L{seg.end_point.x:.1f},{seg.end_point.y:.1f}')
            else:
                parts.append(f'C{seg.c1.x:.1f},{seg.c1.y:.1f} {seg.c2.x:.1f},{seg.c2.y:.1f} {seg.end_point.x:.1f},{seg.end_point.y:.1f}')
        parts.append('Z')
    return ''.join(parts), tight.size


d, (tw, th) = trace_path()
side = max(tw, th)
ox, oy = (side - tw) / 2, (side - th) / 2


def svg(fill, opacity=1.0):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{side}" height="{side}" viewBox="0 0 {side} {side}">'
            f'<path fill="{fill}" fill-opacity="{opacity}" fill-rule="evenodd" transform="translate({ox:.1f} {oy:.1f})" d="{d}"/></svg>\n')


def write(path, text):
    os.makedirs(os.path.dirname(P(path)), exist_ok=True)
    open(P(path), 'w').write(text); print('wrote', path)


write('brand/logo-white.svg', svg('#ffffff'))
write('brand/logo-dark.svg', svg('#1b1b1b'))
wm = 'src/vs/workbench/browser/parts/editor/media/'
write(wm + 'letterpress-dark.svg', svg('#ffffff', 0.32))     # dark theme: grey/black editor background
write(wm + 'letterpress-light.svg', svg('#1b1b1b', 0.22))    # light theme: a white logo would vanish, so the same shape in dark
write(wm + 'letterpress-hcDark.svg', svg('#ffffff', 0.7))
write(wm + 'letterpress-hcLight.svg', svg('#1b1b1b', 0.6))
def badge():
    # black rounded square with the white logo: readable on dark AND light surfaces (title bar icon, "open in" buttons)
    k = 0.86
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{side}" height="{side}" viewBox="0 0 {side} {side}">'
            f'<rect width="{side}" height="{side}" rx="{side * 0.22:.0f}" fill="#000"/>'
            f'<path fill="#fff" fill-rule="evenodd" transform="translate({side * (1 - k) / 2 + ox * k:.1f} {side * (1 - k) / 2 + oy * k:.1f}) scale({k})" d="{d}"/></svg>\n')


write('src/vs/workbench/browser/media/code-icon.svg', badge())
# the other SVG logo slots of the (inherited) sessions window
for name, fill, op in [('sessions-logo-dark.svg', '#ffffff', 1.0), ('sessions-logo-light.svg', '#1b1b1b', 1.0), ('vscode-icon.svg', '#ffffff', 1.0)]:
    write('src/vs/sessions/browser/media/' + name, badge() if name == 'vscode-icon.svg' else svg(fill, op))
for name, fill, op in [('letterpress-sessions-dark.svg', '#ffffff', 0.32), ('letterpress-sessions-light.svg', '#1b1b1b', 0.22)]:
    write('src/vs/sessions/contrib/chat/browser/media/' + name, svg(fill, op))

# the React UI (first-run setup, ...) draws the logo inline so it follows the theme colour (currentColor) and needs no asset URL
tsx = f'''/*--------------------------------------------------------------------------------------
 *  Vader addition. Licensed under the Apache License, Version 2.0. See LICENSE.txt.
 *  Generated by build/lib/vader/make_brand_assets.py - do not edit by hand.
 *--------------------------------------------------------------------------------------*/

import React from 'react'

/** The Vader logo without a background. Draws in the current text colour: light on dark themes, dark on light themes. */
export const VaderLogo = ({{ className, style }}: {{ className?: string, style?: React.CSSProperties }}) => (
	<svg className={{className}} style={{style}} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" role="img" aria-label="Vader">
		<path fill="currentColor" fillRule="evenodd" transform="translate({ox:.1f} {oy:.1f})" d="{d}" />
	</svg>
)
'''
write('src/vs/workbench/contrib/vader/browser/react/src/util/VaderLogo.tsx', tsx)
