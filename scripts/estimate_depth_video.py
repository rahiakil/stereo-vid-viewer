#!/usr/bin/env python3
"""Estimate per-frame depth for a video (Depth Anything V2 Small).

Writes a grayscale depth video (same FPS/length) for the stereo-vid viewer.
Brighter = closer (inverted metric depth, per-frame normalized).

Example:
  /home/papa/Repos/hrr-basic-one/.venv/bin/python \\
    scripts/estimate_depth_video.py \\
    --input ~/Downloads/vid1.mp4 \\
    --output public/media/vid1_depth.mp4
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import pipeline


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument(
        "--model",
        default="depth-anything/Depth-Anything-V2-Small-hf",
        help="HF depth model id",
    )
    ap.add_argument("--max-side", type=int, default=768, help="Long side for inference")
    ap.add_argument("--device", default=None, help="cuda / cpu / cuda:0")
    ap.add_argument("--every", type=int, default=1, help="Process every Nth frame")
    return ap.parse_args()


def resize_max(img: np.ndarray, max_side: int) -> np.ndarray:
    h, w = img.shape[:2]
    m = max(h, w)
    if m <= max_side:
        return img
    scale = max_side / m
    return cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def depth_to_u8(depth: np.ndarray) -> np.ndarray:
    """Normalize one frame; bright = near."""
    d = depth.astype(np.float32)
    lo, hi = np.percentile(d, 1), np.percentile(d, 99)
    if hi <= lo:
        hi = lo + 1e-6
    d = np.clip((d - lo) / (hi - lo), 0, 1)
    # Depth Anything: larger usually farther → invert so bright=near
    d = 1.0 - d
    return (d * 255.0).astype(np.uint8)


def main() -> int:
    args = parse_args()
    if not args.input.is_file():
        print(f"missing input: {args.input}", file=sys.stderr)
        return 1

    device = args.device
    if device is None:
        device = 0 if torch.cuda.is_available() else -1

    print(f"model={args.model} device={device}")
    pipe = pipeline(
        task="depth-estimation",
        model=args.model,
        device=device,
    )

    cap = cv2.VideoCapture(str(args.input))
    if not cap.isOpened():
        print("failed to open video", file=sys.stderr)
        return 1

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    print(f"input {w}x{h} @ {fps:.3f} fps frames≈{n}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Prefer mp4v then fall back
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(args.output), fourcc, fps, (w, h), False)
    if not writer.isOpened():
        print("VideoWriter failed; trying avc1", file=sys.stderr)
        fourcc = cv2.VideoWriter_fourcc(*"avc1")
        writer = cv2.VideoWriter(str(args.output), fourcc, fps, (w, h), False)
    if not writer.isOpened():
        print("could not open VideoWriter", file=sys.stderr)
        return 1

    last_depth_u8: np.ndarray | None = None
    i = 0
    while True:
        ok, frame_bgr = cap.read()
        if not ok:
            break

        if i % args.every == 0 or last_depth_u8 is None:
            small = resize_max(frame_bgr, args.max_side)
            rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
            pil = Image.fromarray(rgb)
            out = pipe(pil)
            depth = np.array(out["depth"], dtype=np.float32)
            if depth.shape[:2] != (h, w):
                depth = cv2.resize(depth, (w, h), interpolation=cv2.INTER_CUBIC)
            last_depth_u8 = depth_to_u8(depth)
            print(f"frame {i}/{n}", flush=True)

        assert last_depth_u8 is not None
        writer.write(last_depth_u8)
        i += 1

    cap.release()
    writer.release()
    print(f"wrote {args.output} ({i} frames)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
