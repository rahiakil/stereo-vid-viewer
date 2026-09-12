#!/usr/bin/env python3
"""Bake a clean alpha matte video with rembg (U2-Net / BiRefNet).

This is the main fix for dust/trails: depth threshold alone cannot separate
characters from a busy grocery aisle. A matting network predicts per-pixel
opacity; we then only build 3D where alpha is solid.

Example (fast, good):
  python scripts/matte_video_rembg.py \\
    --input public/media/vid-labu1.mp4 \\
    --output public/media/vid-labu1_matte.mp4 \\
    --model u2net --max-side 640

Crisper (slower): --model birefnet-general
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument(
        "--model",
        default="u2net",
        choices=["u2net", "u2net_human_seg", "birefnet-general", "isnet-general-use"],
    )
    ap.add_argument("--max-side", type=int, default=640, help="matte inference size")
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--max-frames", type=int, default=0)
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    if not args.input.is_file():
        print("missing input", file=sys.stderr)
        return 1

    cap = cv2.VideoCapture(str(args.input))
    if not cap.isOpened():
        print("cannot open", args.input, file=sys.stderr)
        return 1

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Grayscale alpha as H.264 (viewer/exporter reads as single channel)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(args.output), fourcc, fps, (w, h), isColor=True)

    print(f"loading rembg model={args.model} …", flush=True)
    session = new_session(args.model)

    i = 0
    last_alpha = None
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        if args.max_frames and i >= args.max_frames:
            break

        if i % args.every == 0:
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            pil = Image.fromarray(rgb)
            # Speed: run matte at max-side, upsample alpha
            scale = args.max_side / max(pil.size)
            if scale < 1.0:
                small = pil.resize(
                    (max(1, int(pil.width * scale)), max(1, int(pil.height * scale))),
                    Image.Resampling.BILINEAR,
                )
            else:
                small = pil
            out = remove(small, session=session)
            alpha = np.array(out.split()[-1])
            if alpha.shape[:2] != (h, w):
                alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_LINEAR)
            # Light temporal EMA to kill flicker/trails between frames
            if last_alpha is None:
                last_alpha = alpha.astype(np.float32)
            else:
                last_alpha = 0.65 * alpha.astype(np.float32) + 0.35 * last_alpha
            alpha_u8 = np.clip(last_alpha, 0, 255).astype(np.uint8)
            # Harden: kill soft dust fringe
            _, hard = cv2.threshold(alpha_u8, 140, 255, cv2.THRESH_BINARY)
            hard = cv2.morphologyEx(hard, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
            hard = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
            # Keep largest 2 blobs (bunny + girl)
            nlab, labels, stats, _ = cv2.connectedComponentsWithStats(hard, 8)
            if nlab > 1:
                areas = stats[1:, cv2.CC_STAT_AREA]
                keep_idx = 1 + np.argsort(areas)[::-1][:2]
                keep = np.isin(labels, keep_idx).astype(np.uint8) * 255
            else:
                keep = hard
            # Slight erode to remove halo, then feather 1px
            keep = cv2.erode(keep, np.ones((2, 2), np.uint8), iterations=1)
            keep = cv2.GaussianBlur(keep, (3, 3), 0)
            writer.write(cv2.cvtColor(keep, cv2.COLOR_GRAY2BGR))
            print(f"matte {i}/{n}", flush=True)
        else:
            # duplicate last for skipped frames
            if last_alpha is not None:
                a = np.clip(last_alpha, 0, 255).astype(np.uint8)
                writer.write(cv2.cvtColor(a, cv2.COLOR_GRAY2BGR))

        i += 1

    cap.release()
    writer.release()
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
