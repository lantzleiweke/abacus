#!/usr/bin/env python3
"""Build the Abacus logo files: icon.svg and everything in docs/logo/.

Usage: python3 dev/logo/build.py [--root DIR] [--font TTF]

Needs ImageMagick 7 (magick) on the PATH for the PNGs. The SVGs are written
from the geometry below, so a change here and a rerun updates every file.
The SVGs use plain fills with coordinates written out in full: the SVG
renderer built into ImageMagick 7.1 crashes on transform attributes and does
not draw strokes.
"""
import argparse
import math
import os
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

ACCENT = "#DA4B36"     # vermilion: 4.2:1 on #fff, 4.0:1 on #1e1e1e, 4.5:1 on #0d1117
INK_LIGHT = "#1C1B1A"  # mark and wordmark on light pages
INK_DARK = "#F2EFE9"   # mark and wordmark on dark pages
TILE = "#1A1918"       # app tile behind the 512 logo
PAPER = "#F4F1EC"      # social preview background
MUTED = "#6B665F"      # social preview tagline
TAGLINE = "Your beads in the OpenChamber right rail"

# The tagline font. JetBrains Mono is OFL; any TTF works.
FONTS = [
    "~/Library/Fonts/JetBrainsMono-Medium.ttf",
    "~/Library/Fonts/JetBrainsMonoNLNerdFontMono-Medium.ttf",
    "/Library/Fonts/JetBrainsMono-Medium.ttf",
    "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Medium.ttf",
]


def num(v):
    return f"{v:.3f}".rstrip("0").rstrip(".")


# ------------------------------------------------------------------ mark
# Drawn on an 18 px grid, the size of the OpenChamber rail icon, so posts,
# rails and the gaps between beads land on whole pixels at 18 px. Two beads
# rest together on the top rail; the moved bead sits alone at the far end of
# the bottom rail. The content spans grid units 1 to 17.

def mark(ink, accent, k, ox=0.0, oy=0.0):
    """The mark with one grid unit = k, and grid point (0, 0) at (ox, oy)."""
    X = lambda v: num(ox + v * k)
    Y = lambda v: num(oy + v * k)
    S = lambda v: num(v * k)
    out = []
    for x, y, w, h, r in ((1, 1, 2, 16, 1), (15, 1, 2, 16, 1),   # posts
                          (3, 5, 12, 1, 0), (3, 12, 12, 1, 0)):  # rails
        rx = f' rx="{S(r)}"' if r else ""
        out.append(f'<rect x="{X(x)}" y="{Y(y)}" width="{S(w)}" height="{S(h)}"{rx} fill="{ink}"/>')
    for cx, cy, fill in ((6, 5.5, ink), (10, 5.5, ink), (12, 12.5, accent)):
        out.append(f'<circle cx="{X(cx)}" cy="{Y(cy)}" r="{S(2)}" fill="{fill}"/>')
    return "".join(out)


def icon_svg():
    body = mark("currentColor", "currentColor", 24 / 18).replace(' fill="currentColor"', "")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" '
            f'fill="currentColor">{body}</svg>\n')


# ------------------------------------------------------------------ wordmark
# A monoline geometric construction, so no font is needed. Glyph units:
# stroke 5, x-height 22, cap and ascender 31, baseline at y=0. Each stroke is
# written as its filled outline (round caps and joins included), because the
# SVG renderer built into ImageMagick 7.1 draws fills but not strokes.
SW, R, CY = 5, 8.5, -11
TOP, BASE, ASC = -19.5, -2.5, -28.5
GAP = 3.5


def arc(cx, cy, rx, ry, a0, a1):
    """Points along an ellipse from angle a0 to a1 in degrees (y points down)."""
    steps = max(8, int(abs(a1 - a0) / 3))
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / steps)),
             cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / steps))) for i in range(steps + 1)]


def g_A(x):
    t = 8 / 26
    apex = (x + 13, ASC + 0.5)
    return [[(x + 3, BASE), apex], [apex, (x + 23, BASE)],
            [(x + 3 + 10 * t, -10.5), (x + 23 - 10 * t, -10.5)]], [], 26


def g_b(x):
    return [[(x + 2.5, ASC), (x + 2.5, BASE)]], [x + 11], 22


def g_a(x):
    return [[(x + 19.5, TOP), (x + 19.5, BASE)]], [x + 11], 22


def g_c(x):
    return [arc(x + 11, CY, R, R, -45, -315)], [], 20


def g_u(x):
    return [[(x + 2.5, TOP)] + arc(x + 11, CY, R, R, 180, 0),
            [(x + 19.5, TOP), (x + 19.5, BASE)]], [], 22


def g_s(x):
    cx, rx, ry = x + 9, 6.5, 4.25
    return [arc(cx, -15.25, rx, ry, -30, -270) + arc(cx, -6.75, rx, ry, -90, 150)[1:]], [], 18


def outline(points, h):
    """The filled outline of a polyline stroked with half-width h."""
    left, right = [], []
    for i, (px, py) in enumerate(points):
        ax, ay = points[max(i - 1, 0)]
        bx, by = points[min(i + 1, len(points) - 1)]
        tx, ty = bx - ax, by - ay
        length = math.hypot(tx, ty)
        nx, ny = -ty / length * h, tx / length * h
        left.append((px + nx, py + ny))
        right.append((px - nx, py - ny))
    return left + right[::-1]


def wordmark(ink, ox, baseline, k=1.0):
    """The wordmark with its left edge at ox and its baseline at y = baseline."""
    P = lambda x, y: f"{num(ox + x * k)} {num(baseline + y * k)}"
    h = SW / 2
    shapes, x = [], 0.0
    for glyph in (g_A, g_b, g_a, g_c, g_u, g_s):
        strokes, rings, advance = glyph(x)
        for pts in strokes:
            poly = outline(pts, h)
            shapes.append(f'<path d="M{"L".join(P(*q) for q in poly)}Z" fill="{ink}"/>')
            for q in (pts[0], pts[-1]):  # round caps and joins
                shapes.append(f'<circle cx="{num(ox + q[0] * k)}" cy="{num(baseline + q[1] * k)}" '
                              f'r="{num(h * k)}" fill="{ink}"/>')
        for cx in rings:
            # Sampled rather than written as arcs: ImageMagick draws arcs as coarse polygons.
            ring = "".join(f'M{"L".join(P(*q) for q in arc(cx, CY, r, r, 0, 360)[:-1])}Z'
                           for r in (R + h, R - h))
            shapes.append(f'<path d="{ring}" fill="{ink}" fill-rule="evenodd"/>')
        x += advance + GAP
    return "".join(shapes), (x - GAP) * k


# ------------------------------------------------------------------ compositions
# Lockup units: the mark is 40 tall, the wordmark cap height is 31, and the
# wordmark is centered on the mark.
MARK_H, MARK_GAP = 40, 14


def lockup_body(ink, k=1.0, ox=0.0, oy=0.0):
    g = MARK_H / 16 * k
    body = mark(ink, ACCENT, g, ox - g, oy - g)
    word, width = wordmark(ink, ox + (MARK_H + MARK_GAP) * k, oy + (MARK_H / 2 + 15.5) * k, k)
    return body + word, (MARK_H + MARK_GAP) * k + width


def lockup_svg(ink):
    body, width = lockup_body(ink)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 {num(width + 4)} {MARK_H + 4}">'
            f'<title>Abacus</title>{body}</svg>\n')


def logo_svg():
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
            f'<title>Abacus</title><rect width="512" height="512" rx="112" fill="{TILE}"/>'
            f'{mark(INK_DARK, ACCENT, 20, 76, 76)}</svg>\n')


# Social preview: 1280 by 640. Everything sits inside the central 1000 by 500.
SOCIAL_LOCKUP_W, TAGLINE_GAP, TAGLINE_PT = 600, 64, 30


def social_svg():
    _, width = lockup_body(INK_LIGHT)
    k = SOCIAL_LOCKUP_W / width
    block = MARK_H * k + TAGLINE_GAP + TAGLINE_PT
    body, _ = lockup_body(INK_LIGHT, k, 640 - SOCIAL_LOCKUP_W / 2, 320 - block / 2)
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">'
            f'<rect width="1280" height="640" fill="{PAPER}"/>{body}</svg>\n'), 320 + block / 2


# ------------------------------------------------------------------ output

def raster(svg_text, out, size, extra=()):
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(svg_text)
    try:
        subprocess.run(["magick", "-background", "none", "-density", "384", f.name,
                        "-resize", size, *extra, "-depth", "8", "-strip", out], check=True)
    finally:
        os.unlink(f.name)


def tagline_font(given):
    for path in ([given] if given else FONTS):
        path = os.path.expanduser(path)
        if os.path.exists(path):
            return ["-font", path]
    print("tagline font not found; using the ImageMagick default")
    return []


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=os.path.normpath(os.path.join(HERE, "..", "..")))
    ap.add_argument("--font", help="TTF for the social preview tagline")
    args = ap.parse_args()
    logo = os.path.join(args.root, "docs", "logo")
    os.makedirs(logo, exist_ok=True)

    svgs = {
        os.path.join(args.root, "icon.svg"): icon_svg(),
        os.path.join(logo, "mark.svg"): icon_svg(),
        os.path.join(logo, "logo-512.svg"): logo_svg(),
        os.path.join(logo, "lockup-light.svg"): lockup_svg(INK_LIGHT),
        os.path.join(logo, "lockup-dark.svg"): lockup_svg(INK_DARK),
    }
    for path, text in svgs.items():
        with open(path, "w") as f:
            f.write(text)

    raster(logo_svg(), os.path.join(logo, "logo-512.png"), "512x512")
    raster(lockup_svg(INK_LIGHT), os.path.join(logo, "lockup-light.png"), "x128")
    raster(lockup_svg(INK_DARK), os.path.join(logo, "lockup-dark.png"), "x128")
    svg, baseline = social_svg()
    raster(svg, os.path.join(logo, "social-preview.png"), "1280x640!",
           ["-density", "72", *tagline_font(args.font), "-fill", MUTED, "-pointsize", str(TAGLINE_PT),
            "-gravity", "north", "-annotate", f"+0+{baseline - TAGLINE_PT * 0.8:.0f}", TAGLINE,
            "-background", PAPER, "-flatten"])
    print(f"wrote icon.svg and docs/logo/ under {args.root}")


if __name__ == "__main__":
    main()
