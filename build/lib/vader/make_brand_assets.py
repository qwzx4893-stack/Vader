#!/usr/bin/env python3
"""Generates every Vader brand asset from the two source images in brand/source/.

  brand/source/logo-black.jpg   the logo, white on a black background (the app icon)
  brand/source/banner.jpg       the wide banner (README / social preview)

Run from the repository root:   python3 build/lib/vader/make_brand_assets.py
Needs:  pip install pillow numpy scipy potracer

The transparent logo is derived from the black one (brightness becomes opacity), so the white logo can sit on any dark or grey surface.
Light-theme surfaces get a dark variant of the same shape (a white logo on white would vanish).
"""
import io
import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
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


# ---- small sizes: the logo is much wider than tall (a black hole with long wings), so fitting it by width leaves a small mark in a
# square tile. Square icons crop the ORIGINAL artwork around the ring instead (the part that carries the identity), scaled to fill the
# tile by height; nothing is simplified, redrawn or thickened. The ring (shadow disc centre and outer radius) was measured on the source.
RING_CX, RING_CY, RING_R = 642, 644, 338


def ring_box(pad=1.12):
    half = RING_R * pad
    return (RING_CX - half, RING_CY - half, RING_CX + half, RING_CY + half)


def ring_mark(size, pad=1.12, ss=1):
    """The ring crop of the original logo, white on black ('L' image) at size x size."""
    return mask.resize((size * ss, size * ss), Image.LANCZOS, box=ring_box(pad))


def icon_image(size):
    """App icon at `size` (RGBA, opaque black background, white original logo cropped around the ring)."""
    m = ring_mark(size)
    return Image.merge('RGBA', (m, m, m, Image.new('L', (size, size), 255)))


def stars(w, h, count, seed):
    """Deterministic star field (RGB image, near black) for the installer panel."""
    rng = np.random.default_rng(seed)
    im = Image.new('RGB', (w, h), (4, 5, 9))
    d = ImageDraw.Draw(im)
    for _ in range(count):
        x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
        v = int(rng.integers(70, 200))
        d.point((x, y), fill=(v, v, min(255, v + 25)))
    return im


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
ico_sizes = [16, 24, 32, 48, 64, 72, 96, 128, 256]
imgs = [icon_image(sz) for sz in ico_sizes]
os.makedirs(P('resources/win32'), exist_ok=True)
imgs[-1].save(P('resources/win32/code.ico'), format='ICO', sizes=[(sz, sz) for sz in ico_sizes], append_images=imgs[:-1]); print('wrote resources/win32/code.ico')
save_png(icon_image(150).convert('RGB'), 'resources/win32/code_150x150.png')
save_png(icon_image(70).convert('RGB'), 'resources/win32/code_70x70.png')
# installer: left panel (164x314 at 100%) and the small header image (55x55 at 100%), every DPI step.
# Both keep a generous margin so nothing touches the edge of the wizard window.
FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_REG = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
for scale, (bw, bh), (sw, sh) in [(100, (164, 314), (55, 55)), (125, (192, 386), (64, 68)), (150, (246, 459), (83, 80)), (175, (273, 556), (92, 97)),
                                  (200, (328, 604), (110, 106)), (225, (355, 700), (119, 123)), (250, (410, 797), (138, 140))]:
    big = stars(bw, bh, count=int(bw * bh / 380), seed=7)
    logo_w = int(bw * 0.62)                                   # 19% free on each side
    mk = ring_mark(logo_w, pad=1.10)
    lg = Image.merge('RGBA', (mk, mk, mk, mk))
    ly = int(bh * 0.24)
    big.paste(lg, ((bw - logo_w) // 2, ly), lg)
    d = ImageDraw.Draw(big)
    f1 = ImageFont.truetype(FONT_BOLD, max(12, int(bw * 0.17)))
    f2 = ImageFont.truetype(FONT_REG, max(8, int(bw * 0.065)))
    ty = ly + logo_w + int(bh * 0.05)
    d.text((bw / 2, ty), 'Vader', font=f1, fill=(255, 255, 255), anchor='ma')
    d.text((bw / 2, ty + f1.size + int(bh * 0.012)), 'AI-native IDE', font=f2, fill=(150, 154, 170), anchor='ma')
    big.save(P(f'resources/win32/inno-big-{scale}.bmp'))
    small = Image.new('RGB', (sw, sh), (0, 0, 0))
    side = int(min(sw, sh) * 0.76)                            # 12% margin all round
    ms = ring_mark(side, pad=1.10)
    ls = Image.merge('RGBA', (ms, ms, ms, ms))
    small.paste(ls, ((sw - side) // 2, (sh - side) // 2), ls)
    small.save(P(f'resources/win32/inno-small-{scale}.bmp'))
print('wrote installer images')

# ---- Linux / server / web
save_png(on_black(1024, pad=0.04), 'resources/linux/code.png')
save_png(on_black(192, pad=0.05), 'resources/server/code-192.png')
save_png(on_black(512, pad=0.05), 'resources/server/code-512.png')
fav = [16, 32, 48, 64, 256]; fimgs = [icon_image(sz) for sz in fav]
fimgs[-1].save(P('resources/server/favicon.ico'), format='ICO', sizes=[(sz, sz) for sz in fav], append_images=fimgs[:-1]); print('wrote resources/server/favicon.ico')
save_png(icon_image(256), 'scripts/appimage/vader.png')

# ---- macOS: a rounded black square with the usual margin
mac = on_black(1024, pad=0.07, rounded=0.225, margin=0.098)
os.makedirs(P('resources/darwin'), exist_ok=True)
mac.save(P('resources/darwin/code.icns')); print('wrote resources/darwin/code.icns')

# ---- in-app: the logo without a background for grey/black surfaces (banner part, getting started, walkthrough file icons)
_b = ring_mark(128, pad=1.08)   # shown at 16-48 px in the UI: the original logo cropped around the ring, white on transparent
save_png(Image.merge('RGBA', (Image.new('L', (128, 128), 255),) * 3 + (_b,)), 'src/vs/workbench/browser/media/vader-icon-sm.png')


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
    # black rounded square with the ORIGINAL logo cropped around the ring (the traced path is clipped by the viewBox):
    # readable on dark AND light surfaces at 16-22 px (title bar icon, "open in" buttons)
    half = RING_R * 1.10
    vx, vy = RING_CX - bbox[0] - half, RING_CY - bbox[1] - half     # ring square in the traced path's coordinates
    side2 = 2 * half
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="{vx:.1f} {vy:.1f} {side2:.1f} {side2:.1f}">'
            f'<rect x="{vx:.1f}" y="{vy:.1f}" width="{side2:.1f}" height="{side2:.1f}" rx="{side2 * 0.22:.0f}" fill="#000"/>'
            f'<path fill="#fff" fill-rule="evenodd" d="{d}"/></svg>\n')


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
