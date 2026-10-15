#!/usr/bin/env python3
"""Render the README demo (docs/demo.gif, docs/demo.mp4) from five stills.

Usage: python3 dev/demo/render.py STILLS_DIR [--out docs] [--work DIR] [--jobs N] [--only-frames 0,90,...]

Needs ffmpeg and ImageMagick 7 (magick) on the PATH. The timeline, click
targets and output sizes live in dev/demo/storyboard.json.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))


def run(cmd, **kw):
    subprocess.run(cmd, check=True, **kw)


def ease(p):
    """Ease in-out cubic."""
    p = min(1.0, max(0.0, p))
    return 4 * p * p * p if p < 0.5 else 1 - (-2 * p + 2) ** 3 / 2


def ease_out(p):
    p = min(1.0, max(0.0, p))
    return 1 - (1 - p) ** 3


def keyed(keys, t):
    """Return (a, b, eased progress) for the key segment that contains t."""
    if t <= keys[0]["t"]:
        return keys[0], keys[0], 0.0
    for a, b in zip(keys, keys[1:]):
        if t <= b["t"]:
            span = b["t"] - a["t"]
            return a, b, ease((t - a["t"]) / span) if span > 0 else 1.0
    return keys[-1], keys[-1], 0.0


class Demo:
    def __init__(self, sb, stills_dir, work):
        self.sb = sb
        self.stills_dir = stills_dir
        self.work = work
        self.d = sb["dpr"]
        self.crop = sb["crop_top_css"] * self.d
        out = sb["output"]
        self.W, self.H, self.fps = out["width"], out["height"], out["fps"]
        win = out["window"]
        self.wx, self.wy, self.ww = win["x"], win["y"], win["width"]
        self.radius = win["radius"]
        self.src_w = self.src_h = None

    # ---- coordinates -------------------------------------------------
    def img(self, x, y):
        """Original CSS px -> cropped image px."""
        return x * self.d, y * self.d - self.crop

    def clamp_cam(self, cx, cy, z):
        hw, hh = self.src_w / z / 2, self.src_h / z / 2
        return min(max(cx, hw), self.src_w - hw), min(max(cy, hh), self.src_h - hh)

    def camera(self, t):
        a, b, p = keyed(self.sb["camera"], t)
        za, zb = a["zoom"], b["zoom"]
        ca = self.clamp_cam(*self.img(*a["at"]), za)
        cb = self.clamp_cam(*self.img(*b["at"]), zb)
        # Interpolate zoom in log space so zooming in and out feel even.
        z = math.exp(math.log(za) + (math.log(zb) - math.log(za)) * p)
        cx = ca[0] + (cb[0] - ca[0]) * p
        cy = ca[1] + (cb[1] - ca[1]) * p
        cx, cy = self.clamp_cam(cx, cy, z)
        return cx, cy, z

    def to_screen(self, wx, wy, cam):
        cx, cy, z = cam
        k = self.ww / self.src_w * z
        return (self.wx + self.ww / 2 + (wx - cx) * k,
                self.wy + self.wh / 2 + (wy - cy) * k, k)

    def cursor_world(self, t):
        a, b, p = keyed(self.sb["cursor_path"], t)
        ax, ay = self.img(*a["at"])
        bx, by = self.img(*b["at"])
        x, y = ax + (bx - ax) * p, ay + (by - ay) * p
        # A gentle arc, like a hand moving a mouse.
        dx, dy = bx - ax, by - ay
        bow = math.sin(math.pi * p) * 0.08
        return x - dy * bow, y + dx * bow

    # ---- assets ------------------------------------------------------
    def prepare(self):
        os.makedirs(self.work, exist_ok=True)
        for key, name in self.sb["stills"].items():
            src = os.path.join(self.stills_dir, name)
            run(["magick", src, "-crop", f"+0+{self.crop}", "+repage",
                 os.path.join(self.work, f"{key}.mpc")])
        out = subprocess.run(["magick", os.path.join(self.work, "epic.mpc"), "-format", "%w %h", "info:"],
                             check=True, capture_output=True, text=True).stdout.split()
        self.src_w, self.src_h = int(out[0]), int(out[1])
        self.wh = round(self.ww * self.src_h / self.src_w)

        ty = self.sb["typing"]
        ex, ey = self.img(ty["erase"][0], ty["erase"][1])
        ew, eh = ty["erase"][2] * self.d, ty["erase"][3] * self.d
        # Composer with the placeholder and caret removed, then the typed text without its caret.
        run(["magick", os.path.join(self.work, "typed.mpc"), "-fill", ty["erase_color"],
             "-draw", f"rectangle {ex},{ey} {ex + ew - 1},{ey + eh - 1}",
             os.path.join(self.work, "empty.mpc")])
        tx, tyy = self.img(ty["text"][0], ty["text"][1])
        tw, th = round(ty["text"][2] * self.d), round(ty["text"][3] * self.d)
        self.text_box = (round(tx), round(tyy), tw, th)
        run(["magick", os.path.join(self.work, "typed.mpc"), "-crop", f"{tw}x{th}+{round(tx)}+{round(tyy)}",
             "+repage", os.path.join(self.work, "text.mpc")])
        self.stops = self.glyph_stops()

        W, H, x, y, w, h, r = self.W, self.H, self.wx, self.wy, self.ww, self.wh, self.radius
        run(["magick", "-size", f"{W}x{H}", "-define", "gradient:angle=135", "gradient:#2b2e37-#0f1014",
             "(", "-size", f"{W}x{H}", "xc:none", "-fill", "rgba(214,190,96,0.10)",
             "-draw", f"ellipse {W * 0.18},{H * 0.12} {W * 0.45},{H * 0.4} 0,360", "-blur", "0x120", ")",
             "-compose", "over", "-composite",
             "(", "-size", f"{W}x{H}", "xc:none", "-fill", "rgba(0,0,0,0.70)",
             "-draw", f"roundrectangle {x},{y + 22} {x + w - 1},{y + h + 10} {r},{r}", "-blur", "0x26", ")",
             "-compose", "over", "-composite", os.path.join(self.work, "bg.png")])
        run(["magick", "-size", f"{w}x{h}", "xc:black", "-fill", "white",
             "-draw", f"roundrectangle 0,0 {w - 1},{h - 1} {r},{r}", os.path.join(self.work, "mask.png")])
        run(["magick", "-size", f"{W}x{H}", "xc:none", "-fill", "none", "-stroke", "rgba(255,255,255,0.13)",
             "-strokewidth", "1.5", "-draw", f"roundrectangle {x + 0.5},{y + 0.5} {x + w - 1.5},{y + h - 1.5} {r},{r}",
             os.path.join(self.work, "rim.png")])
        # macOS-style arrow, drawn at 8 px per CSS px and scaled down per frame.
        s, pad = 8, 40
        pts = [(0, 0), (0, 17.2), (4.1, 13.4), (6.8, 19.6), (9.6, 18.4), (7.0, 12.4), (12.4, 12.4)]
        poly = " ".join(f"{pad + px * s},{pad + py * s}" for px, py in pts)
        size = f"{pad * 2 + 14 * s}x{pad * 2 + 22 * s}"
        run(["magick", "-size", size, "xc:none",
             "(", "-size", size, "xc:none", "-fill", "rgba(0,0,0,0.55)", "-draw", f"polygon {poly}",
             "-blur", "0x14", "-geometry", f"+{s // 2}+{s}", ")", "-compose", "over", "-composite",
             "-fill", "black", "-stroke", "white", "-strokewidth", str(1.5 * s), "-draw", f"polygon {poly}",
             os.path.join(self.work, "cursor.png")])
        self.cursor_scale, self.cursor_pad = s, pad

    def glyph_stops(self):
        """Right edges of the glyphs in the typed text, used as typing stops."""
        out = subprocess.run(["magick", os.path.join(self.work, "text.mpc"), "-colorspace", "gray",
                              "-depth", "8", "txt:-"], check=True, capture_output=True, text=True).stdout
        ink = [False] * self.text_box[2]
        for line in out.splitlines()[1:]:
            x = int(line.split(",")[0])
            val = int(line.split("(")[1].split(")")[0].split(",")[0])
            ink[x] = ink[x] or val > 90
        stops = [i + 1 for i in range(len(ink) - 1) if ink[i] and not ink[i + 1]]
        # Merge glyphs that end very close together (kerned pairs) into one keystroke.
        merged = []
        for s in stops:
            if not merged or s - merged[-1] >= 9:
                merged.append(s)
            else:
                merged[-1] = s
        merged[-1] = len(ink)
        return merged

    # ---- per frame ---------------------------------------------------
    def scene_layers(self, t):
        scenes = self.sb["scenes"]
        cur = [s for s in scenes if s["t"] <= t]
        now = cur[-1]
        prev = cur[-2] if len(cur) > 1 else None
        if prev and now["fade"] > 0 and t < now["t"] + now["fade"]:
            p = ease((t - now["t"]) / now["fade"])
            return [(prev["still"], 1.0), (now["still"], p)]
        return [(now["still"], 1.0)]

    def caret_on(self, t):
        ty = self.sb["typing"]
        if t < ty["caret_from"]:
            return False
        if ty["start"] <= t <= ty["end"] + 0.4:
            return True
        return ((t - ty["caret_from"]) % 1.0) < 0.55

    def still_args(self, key, t):
        w = self.work
        ty = self.sb["typing"]
        if key not in ("chip", "composer"):
            return [os.path.join(w, f"{key}.mpc")]
        if key == "chip":
            args = [os.path.join(w, "chip.mpc")]
            cx, cy = self.img(ty["text"][0] - 1.5, ty["caret"][1])
        else:
            p = (t - ty["start"]) / (ty["end"] - ty["start"])
            n = len(self.stops)
            # Slightly uneven keystrokes read as typing, not a wipe.
            idx = min(n, int(n * min(1.0, max(0.0, p + 0.025 * math.sin(p * 37)))))
            reveal = self.stops[idx - 1] if idx > 0 else 0
            x0, y0, _, th = self.text_box
            args = [os.path.join(w, "empty.mpc")]
            if reveal > 0:
                args += ["(", os.path.join(w, "text.mpc"), "-crop", f"{reveal}x{th}+0+0", "+repage", ")",
                         "-geometry", f"+{x0}+{y0}", "-compose", "over", "-composite"]
            cx, cy = x0 + reveal + 3, self.img(0, ty["caret"][1])[1]
        if self.caret_on(t):
            cw, ch = ty["caret"][2] * self.d, ty["caret"][3] * self.d
            args += ["-fill", ty["caret_color"], "-stroke", "none",
                     "-draw", f"rectangle {cx},{cy} {cx + cw - 1},{cy + ch - 1}"]
        return ["(", *args, ")"]

    def frame_cmd(self, i, path):
        t = i / self.fps
        cam = self.camera(t)
        cx, cy, z = cam
        k = self.ww / self.src_w * z
        layers = self.scene_layers(t)

        cmd = ["magick", os.path.join(self.work, "bg.png"), "("]
        cmd += self.still_args(layers[0][0], t)
        if len(layers) > 1:
            cmd += self.still_args(layers[1][0], t)
            cmd += ["-compose", "dissolve", "-define", f"compose:args={layers[1][1] * 100:.2f}", "-composite"]
        cmd += ["-virtual-pixel", "edge", "-define", f"distort:viewport={self.ww}x{self.wh}+0+0",
                "-distort", "SRT", f"{cx:.3f},{cy:.3f} {k:.5f} 0 {self.ww / 2:.3f},{self.wh / 2:.3f}", "+repage",
                os.path.join(self.work, "mask.png"), "-alpha", "off", "-compose", "CopyOpacity", "-composite", ")",
                "-geometry", f"+{self.wx}+{self.wy}", "-compose", "over", "-composite",
                os.path.join(self.work, "rim.png"), "-compose", "over", "-composite"]

        # Click ripple and cursor press.
        press = 1.0
        for c in self.sb["clicks"]:
            dt = t - c["t"]
            if -0.09 <= dt <= 0.12:
                press = min(press, 1 - 0.16 * (1 - abs(dt + 0.0) / 0.12))
            if 0 <= dt <= 0.55:
                e = ease_out(dt / 0.55)
                sx, sy, _ = self.to_screen(*self.img(*c["at"]), cam)
                r = (5 + 24 * e) * self.d * k
                a = 0.75 * (1 - e)
                cmd += ["-fill", f"rgba(255,255,255,{0.22 * (1 - e):.3f})",
                        "-stroke", f"rgba(255,255,255,{a:.3f})", "-strokewidth", f"{max(1.5, 2.2 * self.d * k * (1 - 0.5 * e)):.2f}",
                        "-draw", f"circle {sx:.2f},{sy:.2f} {sx + r:.2f},{sy:.2f}"]

        wx_, wy_ = self.cursor_world(t)
        sx, sy, _ = self.to_screen(wx_, wy_, cam)
        unit = self.d * k * press  # screen px per CSS px
        f = unit / self.cursor_scale
        cmd += ["(", os.path.join(self.work, "cursor.png"), "-resize", f"{f * 100:.3f}%", ")",
                "-geometry", f"+{round(sx - self.cursor_pad * f)}+{round(sy - self.cursor_pad * f)}",
                "-compose", "over", "-composite", "-alpha", "off", path]
        return cmd


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stills")
    ap.add_argument("--storyboard", default=os.path.join(HERE, "storyboard.json"))
    ap.add_argument("--out", default=os.path.join(HERE, "..", "..", "docs"))
    ap.add_argument("--work", default=None)
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--only-frames", default=None, help="comma-separated frame numbers; renders PNGs only")
    args = ap.parse_args()

    with open(args.storyboard) as fh:
        sb = json.load(fh)
    work = args.work or tempfile.mkdtemp(prefix="abacus-demo-")
    demo = Demo(sb, os.path.abspath(args.stills), work)
    demo.prepare()

    total = round(sb["end"] * demo.fps)
    frames_dir = os.path.join(work, "frames")
    shutil.rmtree(frames_dir, ignore_errors=True)
    os.makedirs(frames_dir)
    wanted = [int(x) for x in args.only_frames.split(",")] if args.only_frames else range(total)
    env = dict(os.environ, MAGICK_THREAD_LIMIT="1")

    def render(i):
        run(demo.frame_cmd(i, os.path.join(frames_dir, f"{i:05d}.png")), env=env)

    with ThreadPoolExecutor(args.jobs) as pool:
        list(pool.map(render, wanted))
    print(f"{len(wanted)} frames in {frames_dir} ({total / demo.fps:.2f} s at {demo.fps} fps)")
    if args.only_frames:
        return

    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    seq = os.path.join(frames_dir, "%05d.png")
    mp4 = os.path.join(out, "demo.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(demo.fps), "-i", seq,
         "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-tune", "animation",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4])
    o = sb["output"]
    gif = os.path.join(out, "demo.gif")
    vf = (f"fps={o['gif_fps']},scale={o['gif_width']}:-1:flags=lanczos,split[a][b];"
          "[a]palettegen=max_colors=256:stats_mode=diff[p];"
          "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle")
    run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(demo.fps), "-i", seq, "-vf", vf, "-loop", "0", gif])
    for p in (mp4, gif):
        print(f"{p}: {os.path.getsize(p) / 1e6:.2f} MB")


if __name__ == "__main__":
    sys.exit(main())
