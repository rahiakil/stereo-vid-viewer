#!/usr/bin/env python3
"""Remove foreground characters from the video and AI-fill the holes (LaMa).

Uses the rembg matte as a removal mask, dilates it so edges/fur are covered,
then runs LaMa inpainting so the aisle continues behind the pop-out meshes.

Example:
  python scripts/inpaint_background_lama.py \\
    --rgb public/media/vid-labu1.mp4 \\
    --matte public/media/vid-labu1_matte.mp4 \\
    --output public/media/vid-labu1_bg_clean.mp4 \\
    --max-side 960 --dilate 28
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rgb", type=Path, required=True)
    ap.add_argument("--matte", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--max-side", type=int, default=960, help="inpaint resolution")
    ap.add_argument("--dilate", type=int, default=28, help="expand matte to cover fur/halo")
    ap.add_argument("--alpha-cut", type=int, default=40, help="matte threshold 0-255")
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--max-frames", type=int, default=0)
    ap.add_argument("--temporal", type=float, default=0.25, help="blend with prev inpaint")
    return ap.parse_args()


def main() -> int:
    args = parse_args()
    if not args.rgb.is_file() or not args.matte.is_file():
        print("missing rgb or matte", file=sys.stderr)
        return 1

    print("loading LaMa…", flush=True)
    from simple_lama_inpainting import SimpleLama

    lama = SimpleLama()

    cap_rgb = cv2.VideoCapture(str(args.rgb))
    cap_m = cv2.VideoCapture(str(args.matte))
    if not cap_rgb.isOpened() or not cap_m.isOpened():
        print("cannot open videos", file=sys.stderr)
        return 1

    fps = cap_rgb.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap_rgb.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap_rgb.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n = int(cap_rgb.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(args.output),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (w, h),
        isColor=True,
    )

    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (max(3, args.dilate | 1), max(3, args.dilate | 1))
    )
    prev_out = None
    i = 0
    while True:
        ok1, bgr = cap_rgb.read()
        ok2, mfr = cap_m.read()
        if not ok1 or not ok2:
            break
        if args.max_frames and i >= args.max_frames:
            break

        if i % args.every != 0:
            # reuse previous for skipped (should not happen with every=1)
            if prev_out is not None:
                writer.write(prev_out)
            i += 1
            continue

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        alpha = cv2.cvtColor(mfr, cv2.COLOR_BGR2GRAY) if mfr.ndim == 3 else mfr
        if alpha.shape[:2] != (h, w):
            alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_LINEAR)

        mask = (alpha >= args.alpha_cut).astype(np.uint8) * 255
        mask = cv2.dilate(mask, kernel, iterations=1)
        # Soft edge in mask helps LaMa
        mask = cv2.GaussianBlur(mask, (5, 5), 0)
        _, mask = cv2.threshold(mask, 20, 255, cv2.THRESH_BINARY)

        # Downscale for speed / VRAM, then upscale result
        scale = args.max_side / max(h, w)
        if scale < 1.0:
            sw, sh = int(w * scale), int(h * scale)
            rgb_s = cv2.resize(rgb, (sw, sh), interpolation=cv2.INTER_AREA)
            mask_s = cv2.resize(mask, (sw, sh), interpolation=cv2.INTER_NEAREST)
        else:
            rgb_s, mask_s = rgb, mask
            sw, sh = w, h

        pil_img = Image.fromarray(rgb_s)
        pil_mask = Image.fromarray(mask_s).convert("L")
        out_pil = lama(pil_img, pil_mask)
        out = np.array(out_pil.convert("RGB"))
        if out.shape[:2] != (h, w):
            out = cv2.resize(out, (w, h), interpolation=cv2.INTER_LINEAR)

        # Only replace masked region at full res (preserve crisp aisle elsewhere)
        m3 = (mask > 0)[..., None]
        composed = np.where(m3, out, rgb)

        if prev_out is not None and args.temporal > 0:
            prev_rgb = cv2.cvtColor(prev_out, cv2.COLOR_BGR2RGB)
            composed = (
                (1.0 - args.temporal) * composed.astype(np.float32)
                + args.temporal * prev_rgb.astype(np.float32)
            ).astype(np.uint8)
            # Keep unmasked pixels exact from current frame (no smear on shelves)
            composed = np.where(m3, composed, rgb)

        out_bgr = cv2.cvtColor(composed, cv2.COLOR_RGB2BGR)
        writer.write(out_bgr)
        prev_out = out_bgr
        print(f"inpaint {i}/{n} mask={mask.mean()/255:.3f}", flush=True)
        i += 1

    cap_rgb.release()
    cap_m.release()
    writer.release()
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
