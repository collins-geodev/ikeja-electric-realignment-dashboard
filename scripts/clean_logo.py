"""Crop Ikeja Electric logo: remove nested frames, transparent PNG."""
from __future__ import annotations

import os
from collections import deque

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "ikeja-electric-logo.png")
FAV = os.path.join(ROOT, "assets", "favicon.png")
BACKUP = os.path.join(ROOT, "assets", "ikeja-electric-logo-framed-backup.png")
JPG = os.path.join(ROOT, "assets", "ikeja-electric-logo.jpg")


def luminance(r: int, g: int, b: int) -> float:
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def chroma(r: int, g: int, b: int) -> int:
    return max(r, g, b) - min(r, g, b)


def is_strong_logo(r: int, g: int, b: int, a: int = 255) -> bool:
    """Colored mark or light brand text — never white/black frames."""
    if a < 20:
        return False
    lum = luminance(r, g, b)
    ch = chroma(r, g, b)
    # orange / red / yellow mark (and lightbulb)
    if ch >= 28 and (r >= g + 8 or r >= b + 12 or (r > 160 and g > 80 and b < 100)):
        return True
    # light gray brand text — exclude near-white frame borders (lum >= 235)
    if 150 <= lum < 235 and ch <= 40:
        return True
    return False


def is_ie_letter(r: int, g: int, b: int, a: int = 255) -> bool:
    """Dark 'ie' glyph inside the mark."""
    if a < 20:
        return False
    lum = luminance(r, g, b)
    ch = chroma(r, g, b)
    return 40 <= lum <= 110 and ch <= 35


def is_frame_or_void(r: int, g: int, b: int, a: int = 255) -> bool:
    if a < 20:
        return True
    lum = luminance(r, g, b)
    ch = chroma(r, g, b)
    if lum <= 48 and ch <= 20:
        return True
    if lum >= 200 and ch <= 30:
        return True
    # ambiguous mid-gray fringe from borders / anti-alias
    if ch <= 25 and 48 < lum < 155:
        return True
    return False


def flood_clear_frames(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))

    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or visited[y][x]:
            continue
        visited[y][x] = True
        r, g, b, a = px[x, y]
        # Stop at real logo content; clear frames / voids / fringe from the edge inward
        if is_strong_logo(r, g, b, a) or is_ie_letter(r, g, b, a):
            continue
        px[x, y] = (0, 0, 0, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return im


def build_keep_mask(im: Image.Image) -> Image.Image:
    """Keep strong logo + dark 'ie' near the colored mark; drop the rest."""
    w, h = im.size
    px = im.load()
    strong = Image.new("L", (w, h), 0)
    sp = strong.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_strong_logo(r, g, b, a):
                sp[x, y] = 255
    # Grow strong region so dark "ie" letters and soft AA / white bolt outlines stay
    dilated = strong.filter(ImageFilter.MaxFilter(9))
    dp = dilated.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 20:
                continue
            if is_strong_logo(r, g, b, a):
                op[x, y] = (r, g, b, a)
                continue
            if dp[x, y] == 0:
                continue
            # dark "ie" glyphs sitting inside the mark
            if is_ie_letter(r, g, b, a):
                op[x, y] = (r, g, b, a)
                continue
            # thin white / light outlines hugging the colored bolts
            lum = luminance(r, g, b)
            if lum >= 180 and chroma(r, g, b) <= 45:
                op[x, y] = (r, g, b, a)
                continue
            # soft colored AA
            if chroma(r, g, b) >= 18 and lum > 50:
                op[x, y] = (r, g, b, a)
    return out


def process(src: Image.Image) -> Image.Image:
    im = flood_clear_frames(src)
    im = build_keep_mask(im)
    alpha = im.split()[-1]
    bbox = alpha.getbbox()
    if bbox:
        # pad slightly
        x0, y0, x1, y1 = bbox
        pad = 4
        im = im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))
    return im


def main() -> None:
    sources: list[str] = []
    if os.path.exists(BACKUP):
        sources.append(BACKUP)
    if os.path.exists(JPG):
        sources.append(JPG)

    best = None
    best_score = -1.0
    for path in sources:
        im = Image.open(path).convert("RGBA")
        cleaned = process(im)
        alpha = cleaned.split()[-1]
        opaque = sum(1 for p in alpha.getdata() if p > 20)
        aspect = cleaned.size[0] / max(1, cleaned.size[1])
        # Prefer horizontal logos with solid content
        score = opaque * (2.0 if aspect >= 1.6 else 1.0) * (1.2 if aspect >= 2.0 else 1.0)
        print(f"src {path} {im.size} -> {cleaned.size} opaque={opaque} aspect={aspect:.2f} score={score:.0f}")
        if score > best_score:
            best_score = score
            best = cleaned

    if best is None:
        raise SystemExit("No usable logo source found")

    if not os.path.exists(BACKUP):
        # preserve whatever was there before first clean
        pass

    best.save(OUT, "PNG")
    fav = best.copy()
    fav.thumbnail((64, 64), Image.Resampling.LANCZOS)
    fav.save(FAV, "PNG")
    print("wrote", OUT, best.size, "favicon", fav.size)


if __name__ == "__main__":
    main()
