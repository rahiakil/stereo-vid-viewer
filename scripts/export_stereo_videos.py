#!/usr/bin/env python3
"""Prebake simple 3D-looking videos from RGB + depth (one-time, then just play).

Outputs (same FPS/length as source):
  *_sbs.mp4       — side-by-side stereo (VR / cross-eyed / SBS player)
  *_anaglyph.mp4  — red-cyan 3D glasses
  *_wiggle.mp4    — viewpoint oscillates to show depth without head tracking

This is the practical "sneaker-like depth" deliverable for video. True sneaker
quality every frame needs a real 3D asset (GLB / Gaussians), not a flat clip.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import cv2
import numpy as np


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rgb", type=Path, required=True)
    ap.add_argument("--depth", type=Path, required=True)
    ap.add_argument("--out-prefix", type=Path, required=True, help="e.g. public/media/vid-labu1")
    ap.add_argument("--shift", type=float, default=28.0, help="max parallax px at nearest")
    ap.add_argument("--scale", type=float, default=0.5, help="process scale (speed)")
    ap.add_argument("--wiggle-amp", type=float, default=0.85, help="wiggle strength 0-1")
    ap.add_argument("--wiggle-hz", type=float, default=0.7, help="wiggle cycles per second")
    return ap.parse_args()


def depth01(depth_u8: np.ndarray) -> np.ndarray:
    d = depth_u8.astype(np.float32) / 255.0
    return 0.2 + 0.8 * d  # bright=near


def warp(rgb: np.ndarray, d01: np.ndarray, sx: float, sy: float, max_shift: float) -> np.ndarray:
    h, w = d01.shape
    xs = np.arange(w, dtype=np.float32)
    ys = np.arange(h, dtype=np.float32)
    gx, gy = np.meshgrid(xs, ys)
    map_x = (gx - sx * max_shift * d01).astype(np.float32)
    map_y = (gy - sy * max_shift * d01).astype(np.float32)
    return cv2.remap(rgb, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def anaglyph(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    out = np.zeros_like(left)
    out[:, :, 2] = left[:, :, 2]  # R from left (BGR)
    out[:, :, 1] = right[:, :, 1]
    out[:, :, 0] = right[:, :, 0]
    return out


def open_writer(path: Path, fps: float, size: tuple[int, int], is_color: bool = True):
    path.parent.mkdir(parents=True, exist_ok=True)
    for codec in ("mp4v", "avc1", "XVID"):
        fourcc = cv2.VideoWriter_fourcc(*codec)
        w = cv2.VideoWriter(str(path), fourcc, fps, size, is_color)
        if w.isOpened():
            return w
    raise RuntimeError(f"cannot open VideoWriter for {path}")


def main() -> int:
    args = parse_args()
    if not args.rgb.is_file() or not args.depth.is_file():
        print("missing rgb/depth", file=sys.stderr)
        return 1

    cap_r = cv2.VideoCapture(str(args.rgb))
    cap_d = cv2.VideoCapture(str(args.depth))
    fps = cap_r.get(cv2.CAP_PROP_FPS) or 30.0
    n = int(cap_r.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    # Probe first frame for sizes
    ok1, fr0 = cap_r.read()
    ok2, fd0 = cap_d.read()
    if not ok1 or not ok2:
        print("empty video", file=sys.stderr)
        return 1
    cap_r.set(cv2.CAP_PROP_POS_FRAMES, 0)
    cap_d.set(cv2.CAP_PROP_POS_FRAMES, 0)

    if args.scale != 1.0:
        fr0 = cv2.resize(fr0, None, fx=args.scale, fy=args.scale, interpolation=cv2.INTER_AREA)
    h, w = fr0.shape[:2]
    sbs_size = (w * 2, h)

    out_sbs = Path(str(args.out_prefix) + "_sbs.mp4")
    out_ana = Path(str(args.out_prefix) + "_anaglyph.mp4")
    out_wig = Path(str(args.out_prefix) + "_wiggle.mp4")

    wr_sbs = open_writer(out_sbs, fps, sbs_size)
    wr_ana = open_writer(out_ana, fps, (w, h))
    wr_wig = open_writer(out_wig, fps, (w, h))

    i = 0
    while True:
        ok1, fr = cap_r.read()
        ok2, fd = cap_d.read()
        if not ok1 or not ok2:
            break
        if fd.ndim == 3:
            fd = cv2.cvtColor(fd, cv2.COLOR_BGR2GRAY)
        if args.scale != 1.0:
            fr = cv2.resize(fr, (w, h), interpolation=cv2.INTER_AREA)
            fd = cv2.resize(fd, (w, h), interpolation=cv2.INTER_AREA)

        d = depth01(fd)
        left = warp(fr, d, -0.55, 0.0, args.shift)
        right = warp(fr, d, +0.55, 0.0, args.shift)
        sbs = np.concatenate([left, right], axis=1)
        ana = anaglyph(left, right)

        t = i / fps
        sx = args.wiggle_amp * math.sin(2 * math.pi * args.wiggle_hz * t)
        sy = 0.35 * args.wiggle_amp * math.sin(2 * math.pi * args.wiggle_hz * t + 0.7)
        wig = warp(fr, d, sx, sy, args.shift)

        wr_sbs.write(sbs)
        wr_ana.write(ana)
        wr_wig.write(wig)

        if i % 30 == 0:
            print(f"stereo bake {i}/{n}", flush=True)
        i += 1

    cap_r.release()
    cap_d.release()
    wr_sbs.release()
    wr_ana.release()
    wr_wig.release()
    print(f"wrote\n  {out_sbs}\n  {out_ana}\n  {out_wig}\n({i} frames)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
