#!/usr/bin/env python3
"""
Branding asset generator for the Bulk Mockup Photoshop plugin.

Owns the single source of truth for the project mark geometry and derives every
branding asset from it, so the SVG and the PNGs can never drift apart.

Generated files (all committed to the repo):
    assets/logo.png         512 x 512  square, dark mark, transparent bg  (panel UI chip + README)
    assets/logo-light.png   512 x 512  square, white mark, transparent bg (dark surfaces)
    assets/icon.png         256 x 256  square, white mark, transparent bg (host panel icon)
    assets/logo.svg         vector, uses currentColor so it themes itself
    assets/banner.png      1280 x 360  GitHub README banner

The mark is a placeholder rendition of the project logo. To ship the official
artwork, drop it in as assets/logo.png (and logo-light.png) and stop running
this script -- nothing else in the plugin hard-codes the artwork.

Usage:
    python tools/make_logo.py

Requires Pillow:  python -m pip install pillow
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    raise SystemExit("Pillow is required: python -m pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# --------------------------------------------------------------------------
# Mark geometry
# --------------------------------------------------------------------------
# Authored in a local coordinate space of ART_W x ART_H, then scaled into each
# output canvas. Deliberately built from round numbers so it stays easy to
# hand-tune. Values were derived from the reference artwork: a wide, heavy
# monogram "M" with a narrow inner notch and a square pedestal at its foot.

ART_W = 560
ART_H = 400

LEG_W = 96           # width of the outer vertical legs
BAR_H = 96           # height of the top bar
GAP = 10             # breather between a leg and the inner diagonal
STEM_W = 108         # width of the central pedestal / foot
NOTCH_TOP = 148      # horizontal width of a diagonal band at the top bar
STEM_TOP = 195       # where the two diagonals converge and the notch closes

LEG_R = ART_W - LEG_W
CENTER = ART_W // 2
PED_L = CENTER - STEM_W // 2
PED_R = PED_L + STEM_W
BAND_L_OUT = LEG_W + GAP
BAND_L_IN = BAND_L_OUT + NOTCH_TOP
BAND_R_OUT = LEG_R - GAP
BAND_R_IN = BAND_R_OUT - NOTCH_TOP

# Every shape is a closed polygon in art space. Fill `1` paints ink, fill `0`
# punches a hole back out again (used to carve the thin engraved slits).
SHAPES: list[tuple[list[tuple[int, int]], int]] = [
    # top bar
    ([(0, 0), (ART_W, 0), (ART_W, BAR_H), (0, BAR_H)], 1),
    # left leg
    ([(0, 0), (LEG_W, 0), (LEG_W, ART_H), (0, ART_H)], 1),
    # right leg
    ([(LEG_R, 0), (ART_W, 0), (ART_W, ART_H), (LEG_R, ART_H)], 1),
    # inner diagonal band, left, tapering into the central pedestal
    ([(BAND_L_OUT, BAR_H), (BAND_L_IN, BAR_H), (PED_R, ART_H), (PED_L, ART_H)], 1),
    # inner diagonal band, right
    ([(BAND_R_IN, BAR_H), (BAND_R_OUT, BAR_H), (PED_L, ART_H), (PED_R, ART_H)], 1),
    # the narrow notch carved between the two diagonals
    ([(BAND_L_IN, BAR_H - 2), (BAND_R_IN, BAR_H - 2), (CENTER, STEM_TOP + 6)], 0),
]


def _scale_shapes(box: tuple[int, int, int, int]) -> list[tuple[list[tuple[float, float]], int]]:
    """Scale art-space shapes to fit `box` = (x, y, w, h), preserving aspect."""
    bx, by, bw, bh = box
    scale = min(bw / ART_W, bh / ART_H)
    ox = bx + (bw - ART_W * scale) / 2.0
    oy = by + (bh - ART_H * scale) / 2.0
    return [([(ox + x * scale, oy + y * scale) for x, y in pts], fill) for pts, fill in SHAPES]


def render_mask(size: int, pad_ratio: float = 0.10, ss: int = 4) -> Image.Image:
    """Render the mark into an 8-bit alpha mask at `size` x `size`."""
    big = size * ss
    pad = int(big * pad_ratio)
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    for pts, fill in _scale_shapes((pad, pad, big - 2 * pad, big - 2 * pad)):
        draw.polygon(pts, fill=255 if fill else 0)
    return mask.resize((size, size), Image.LANCZOS)


def render(size: int, color: tuple[int, int, int], pad_ratio: float = 0.10) -> Image.Image:
    """Render the mark as an RGBA image in a single flat colour."""
    img = Image.new("RGBA", (size, size), color + (0,))
    img.putalpha(render_mask(size, pad_ratio))
    return img


def paste_mark(canvas: Image.Image, box: tuple[int, int, int, int], color: tuple[int, int, int]) -> None:
    """Stamp the mark onto `canvas` inside `box`, as a flat colour."""
    bw, bh = box[2], box[3]
    mask = Image.new("L", (bw, bh), 0)
    draw = ImageDraw.Draw(mask)
    for pts, fill in _scale_shapes(box):
        draw.polygon(pts, fill=255 if fill else 0)
    layer = Image.new("RGBA", (bw, bh), color + (0,))
    layer.putalpha(mask)
    canvas.alpha_composite(layer, (box[0], box[1]))


def svg_path_data() -> str:
    """All ink shapes as one SVG `d` string, using even-odd to keep the slits."""
    parts = []
    for pts, _fill in SHAPES:
        head, *tail = pts
        parts.append(f"M{head[0]} {head[1]}" + "".join(f"L{x} {y}" for x, y in tail) + "Z")
    return "".join(parts)


def load_font(candidates: list[str], size: int):
    for name in candidates:
        path = Path("C:/Windows/Fonts") / name
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except OSError:  # pragma: no cover
                continue
    try:
        return ImageFont.load_default(size)
    except TypeError:  # Pillow < 10
        return ImageFont.load_default()


def write_svg() -> None:
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ART_W} {ART_H}" '
        f'width="{ART_W}" height="{ART_H}" role="img" aria-label="Bulk Mockup">\n'
        "  <title>Bulk Mockup</title>\n"
        '  <desc>Placeholder brand mark for the Bulk Mockup Photoshop plugin.</desc>\n'
        f'  <path fill="currentColor" fill-rule="evenodd" d="{svg_path_data()}" />\n'
        "</svg>\n"
    )
    (ASSETS / "logo.svg").write_text(svg, encoding="utf-8")


def write_banner() -> None:
    W, H = 1280, 360
    banner = Image.new("RGBA", (W, H), (13, 17, 23, 255))
    draw = ImageDraw.Draw(banner)

    # top accent rail
    for x in range(W):
        t = x / (W - 1)
        draw.line([(x, 0), (x, 3)], fill=(int(58 + 140 * t), int(122 + 60 * t), 246, 255))

    # faint dot grid for texture
    for gx in range(0, W, 32):
        for gy in range(0, H, 32):
            draw.point((gx, gy), fill=(255, 255, 255, 20))

    paste_mark(banner, (68, 46, 268, 268), (255, 255, 255))

    title_font = load_font(["segoeuib.ttf", "arialbd.ttf", "calibrib.ttf"], 84)
    sub_font = load_font(["segoeui.ttf", "arial.ttf", "calibri.ttf"], 30)
    tag_font = load_font(["segoeuib.ttf", "arialbd.ttf", "calibrib.ttf"], 22)

    draw.text((372, 96), "Bulk Mockup", font=title_font, fill=(255, 255, 255, 255))
    draw.text((376, 196), "Batch-replace Smart Objects with live progress", font=sub_font, fill=(154, 164, 178, 255))
    draw.text((376, 246), "Photoshop CEP Panel  \u00b7  ExtendScript Engine", font=tag_font, fill=(125, 163, 246, 255))

    banner.convert("RGB").save(ASSETS / "banner.png", optimize=True)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)

    render(512, (17, 17, 17), pad_ratio=0.09).save(ASSETS / "logo.png", optimize=True)
    render(512, (255, 255, 255), pad_ratio=0.09).save(ASSETS / "logo-light.png", optimize=True)
    render(256, (255, 255, 255), pad_ratio=0.11).save(ASSETS / "icon.png", optimize=True)

    write_svg()
    write_banner()

    for name in sorted(os.listdir(ASSETS)):
        p = ASSETS / name
        print(f"  wrote assets/{name}  ({p.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
