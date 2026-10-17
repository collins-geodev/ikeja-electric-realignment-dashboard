"""Build a tight transparent Ikeja Electric logo PNG (no white/black frames)."""
from __future__ import annotations

import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JPG = os.path.join(ROOT, "assets", "ikeja-electric-logo.jpg")
OUT = os.path.join(ROOT, "assets", "ikeja-electric-logo.png")
FAV = os.path.join(ROOT, "assets", "favicon.png")


def process(src: Image.Image, *, on_dark: bool = True) -> Image.Image:
    arr = np.array(src.convert("RGBA")).astype(np.int16)
    rgb = arr[:, :, :3]
    white = (rgb[:, :, 0] >= 240) & (rgb[:, :, 1] >= 240) & (rgb[:, :, 2] >= 240)
    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    chroma = rgb.max(2) - rgb.min(2)

    out = arr.copy().astype(np.uint8)
    out[white, 3] = 0

    if on_dark:
        # Dark glyphs → light gray so the mark stays readable on the dashboard
        dark = (lum < 90) & (chroma <= 45) & (~white)
        mid = (lum < 140) & (lum >= 90) & (chroma <= 35) & (~white)
        out[dark, 0] = 220
        out[dark, 1] = 226
        out[dark, 2] = 232
        out[dark, 3] = 255
        out[mid, 0] = 180
        out[mid, 1] = 188
        out[mid, 2] = 196
        out[mid, 3] = 200

    result = Image.fromarray(out, "RGBA")
    bbox = result.split()[-1].getbbox()
    if not bbox:
        raise SystemExit("Logo content not found")
    pad = 4
    x0, y0, x1, y1 = bbox
    return result.crop(
        (max(0, x0 - pad), max(0, y0 - pad), min(result.width, x1 + pad), min(result.height, y1 + pad))
    )


def main() -> None:
    if not os.path.exists(JPG):
        raise SystemExit(f"Missing source logo: {JPG}")
    cleaned = process(Image.open(JPG), on_dark=True)
    cleaned.save(OUT)
    fav = cleaned.copy()
    fav.thumbnail((64, 64), Image.Resampling.LANCZOS)
    fav.save(FAV)
    print("wrote", OUT, cleaned.size, "favicon", fav.size)


if __name__ == "__main__":
    main()
