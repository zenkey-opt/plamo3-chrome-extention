#!/usr/bin/env python3
"""Draw the extension icons: the 訳 mark in white on a flat 藍 (#165e83) rounded square.

The glyph comes from Noto Sans JP (SIL Open Font License 1.1); the PNGs hold rendered pixels only.
usage: python tools/make-icons.py [--font PATH]   (default: NotoSansJP-VF.ttf in the system font dir)
Needs Pillow."""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

AI = (0x16, 0x5E, 0x83)  # 藍色, the accent of the UI (ui/base.css --accent)
GLYPH = '訳'
# size: (margin around the tile, glyph height as a share of the tile)
SPEC = {16: (0, 0.74), 32: (1, 0.64), 48: (2, 0.6), 128: (5, 0.58)}
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'extension', 'icons'))


def default_font():
    names = ['NotoSansJP-VF.ttf', 'NotoSansJP-Medium.otf', 'NotoSansCJKjp-Medium.otf']
    dirs = [os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts'),
            os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'Windows', 'Fonts'),
            '/usr/share/fonts/opentype/noto', '/usr/share/fonts/truetype/noto', os.path.expanduser('~/Library/Fonts')]
    for d in dirs:
        for n in names:
            p = os.path.join(d, n)
            if os.path.isfile(p):
                return p
    sys.exit('Noto Sans JP not found: pass --font')


def load_font(path, px):
    f = ImageFont.truetype(path, px)
    try:
        axes = f.get_variation_axes()
        f.set_variation_by_axes([600.0 if a.get('name') in (b'Weight', 'Weight') else float(a.get('default') or 0) for a in axes])
    except OSError:
        pass  # a static font
    return f


def icon(size, font_path):
    margin, share = SPEC[size]
    ss = 8  # supersample the tile for smooth corners
    tile = size - 2 * margin
    big = Image.new('RGBA', (size * ss, size * ss), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle(
        [margin * ss, margin * ss, (margin + tile) * ss - 1, (margin + tile) * ss - 1],
        radius=round(tile * 0.23 * ss), fill=AI + (255,))
    im = big.resize((size, size), Image.Resampling.LANCZOS)
    # the glyph is drawn at the final size, so FreeType hints it for that size
    px = max(8, round(tile * share))
    f = load_font(font_path, px)
    x0, y0, x1, y1 = f.getbbox(GLYPH)
    d = ImageDraw.Draw(im)
    d.text(((size - (x1 - x0)) / 2 - x0, (size - (y1 - y0)) / 2 - y0), GLYPH, font=f, fill=(255, 255, 255, 255))
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--font', default=None)
    a = ap.parse_args()
    font = a.font or default_font()
    for size in SPEC:
        p = os.path.join(OUT, f'icon{size}.png')
        icon(size, font).save(p, optimize=True)
        print('wrote', os.path.relpath(p))


if __name__ == '__main__':
    main()
