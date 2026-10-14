import math
from pathlib import Path

from PIL import Image, ImageDraw

ICON_DIR = Path(__file__).parent / "public" / "icons"
SIZES = [16, 32, 48, 96, 128]
SUPERSAMPLE = 16
VIEWBOX = 128

RED = "#FF0000"
WHITE = "#FFFFFF"

PAD = 0.08
CORNER = 0.22
RING_OUTER = 0.19
RING_INNER = 0.11
RING_CENTERS = (0.36, 0.64)
GAP_ANGLE = 0.8


def ring_geometry(scale):
    outer = RING_OUTER * scale
    inner = RING_INNER * scale
    return (outer + inner) / 2, outer - inner


def build_svg():
    s = VIEWBOX
    pad = PAD * s
    radius, width = ring_geometry(s)
    cy = 0.5 * s
    paths = []
    for c in RING_CENTERS:
        cx = c * s
        x1 = cx + radius * math.cos(-GAP_ANGLE)
        y1 = cy + radius * math.sin(-GAP_ANGLE)
        x2 = cx + radius * math.cos(GAP_ANGLE)
        y2 = cy + radius * math.sin(GAP_ANGLE)
        paths.append(
            f'<path d="M{x1:.2f} {y1:.2f}A{radius:.2f} {radius:.2f} 0 1 0 {x2:.2f} {y2:.2f}"/>'
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}">'
        f'<rect x="{pad:.2f}" y="{pad:.2f}" width="{s - 2 * pad:.2f}" height="{s - 2 * pad:.2f}" '
        f'rx="{CORNER * s:.2f}" fill="{RED}"/>'
        f'<g fill="none" stroke="{WHITE}" stroke-width="{width:.2f}">{"".join(paths)}</g>'
        "</svg>\n"
    )


def render_png(size):
    s = size * SUPERSAMPLE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = PAD * s
    draw.rounded_rectangle((pad, pad, s - pad, s - pad), radius=CORNER * s, fill=RED)

    radius, width = ring_geometry(s)
    outer = radius + width / 2
    cy = 0.5 * s
    gap = math.degrees(GAP_ANGLE)
    for c in RING_CENTERS:
        cx = c * s
        box = (cx - outer, cy - outer, cx + outer, cy + outer)
        draw.arc(box, start=gap, end=360 - gap, fill=WHITE, width=round(width))

    return img.resize((size, size), Image.LANCZOS)


def main():
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    (ICON_DIR / "icon.svg").write_text(build_svg())
    for size in SIZES:
        render_png(size).save(ICON_DIR / f"icon-{size}.png", optimize=True)
    print(f"Wrote icon.svg and {len(SIZES)} PNGs to {ICON_DIR}")


if __name__ == "__main__":
    main()
