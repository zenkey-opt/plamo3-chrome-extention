"""Background pixels of three captures of the same frame (used by glow_test.mjs).
A: glass with the light, B: the light hidden, C: no glass. Flat = pixels whose 21x21 neighbourhood in C is one
colour (background away from text). Prints JSON: the largest change on flat pixels from the glass (B vs C) and
from the light (A vs B), and how many pixels off the flat area the light changed by more than 12 levels.
python glow_pixels.py <dir with A.png B.png C.png>
"""
import json
import sys

from PIL import Image, ImageChops, ImageFilter

d = sys.argv[1]
a, b, c = (Image.open(f'{d}/{k}.png').convert('RGB') for k in 'ABC')


def maxdiff(x, y):
    r, g, bl = ImageChops.difference(x, y).split()
    return ImageChops.lighter(ImageChops.lighter(r, g), bl)


flat = Image.new('L', c.size, 255)
for ch in c.split():
    same = ImageChops.difference(ch.filter(ImageFilter.MaxFilter(21)), ch.filter(ImageFilter.MinFilter(21))).point(lambda v: 255 if v == 0 else 0)
    flat = ImageChops.multiply(flat, same)
off = ImageChops.invert(flat)


def stats(diff, mask):
    hist = ImageChops.multiply(diff, mask).histogram()  # 0/255 masks: multiply divides by 255
    return max((i for i, n in enumerate(hist) if n), default=0), sum(hist[2:]), hist


g_max, g_over, _ = stats(maxdiff(b, c), flat)
l_max, l_over, _ = stats(maxdiff(a, b), flat)
_, _, t_hist = stats(maxdiff(a, b), off)
print(json.dumps({'flatPx': flat.histogram()[255], 'glassMax': g_max, 'glassOver1': g_over,
                  'lightMax': l_max, 'lightOver1': l_over, 'textChanged': sum(t_hist[13:])}))
