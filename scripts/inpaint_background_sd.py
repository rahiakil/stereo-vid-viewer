#!/usr/bin/env python3
"""AI-complete the background: remove matted characters and fill the hole.

Uses Stable Diffusion inpainting (runwayml/stable-diffusion-inpainting).
Characters are erased from the RGB input before generation so the model cannot
copy them through. Output is an aisle-only video for the sneaker demo BG plane.

Example:
  python scripts/inpaint_background_sd.py \\
    --rgb public/media/vid-labu1.mp4 \\
    --matte public/media/vid-labu1_matte.mp4 \\
    --output public/media/vid-labu1_bg_clean.mp4
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rgb", type=Path, required=True)
    ap.add_argument("--matte", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--height", type=int, default=768)
    ap.add_argument("--dilate", type=int, default=48)
    ap.add_argument("--alpha-cut", type=int, default=25)
    ap.add_argument("--steps", type=int, default=28)
    ap.add_argument("--guidance", type=float, default=8.5)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--max-frames", type=int, default=0)
    ap.add_argument("--temporal", type=float, default=0.35)
    return ap.parse_args()


PROMPT = (
    "empty supermarket candy aisle looking down the center, "
    "shiny reflective tiled floor continuing into the distance, "
    "shelves full of snacks and candy jars on both sides, "
    "bright ceiling lights, no people no toys no carts no characters"
)
NEG = (
    "person, human, girl, child, bunny, rabbit, labubu, cartoon, character, "
    "plush, toy, shopping cart, ghost, silhouette, watermark, logo, smear"
)


def expand_mask(alpha: np.ndarray, dilate: int, cut: int) -> np.ndarray:
    mask = (alpha >= cut).astype(np.uint8) * 255
    k = max(3, dilate | 1)
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)), 1)
    # stretch downward to catch shiny-floor reflections
    down = np.zeros((max(3, dilate + 20), max(3, dilate // 2)), np.uint8)
    down[down.shape[0] // 2 :, :] = 1
    mask = cv2.dilate(mask, down, 1)
    return mask


def main() -> int:
    args = parse_args()
    if not args.rgb.is_file() or not args.matte.is_file():
        print("missing rgb or matte", file=sys.stderr)
        return 1

    from diffusers import StableDiffusionInpaintPipeline

    print("loading Stable Diffusion inpaint…", flush=True)
    pipe = StableDiffusionInpaintPipeline.from_pretrained(
        "runwayml/stable-diffusion-inpainting",
        dtype=torch.float16,
        safety_checker=None,
    )
    pipe = pipe.to("cuda")
    pipe.enable_attention_slicing()

    cap_rgb = cv2.VideoCapture(str(args.rgb))
    cap_m = cv2.VideoCapture(str(args.matte))
    fps = cap_rgb.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap_rgb.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap_rgb.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n = int(cap_rgb.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(args.output), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h), True
    )

    prev_fill = None
    i = 0
    gen = torch.Generator(device="cuda").manual_seed(args.seed)

    while True:
        ok1, bgr = cap_rgb.read()
        ok2, mfr = cap_m.read()
        if not ok1 or not ok2:
            break
        if args.max_frames and i >= args.max_frames:
            break

        if i % args.every != 0:
            i += 1
            continue

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        alpha = cv2.cvtColor(mfr, cv2.COLOR_BGR2GRAY) if mfr.ndim == 3 else mfr
        if alpha.shape[:2] != (h, w):
            alpha = cv2.resize(alpha, (w, h))
        mask = expand_mask(alpha, args.dilate, args.alpha_cut)

        img_s = cv2.resize(rgb, (args.width, args.height), interpolation=cv2.INTER_AREA)
        mask_s = cv2.resize(mask, (args.width, args.height), interpolation=cv2.INTER_NEAREST)
        erased = img_s.copy()
        erased[mask_s > 0] = (175, 170, 165)
        noise = np.random.randint(0, 18, erased.shape, dtype=np.uint8)
        erased = np.where(
            mask_s[..., None] > 0,
            np.clip(erased.astype(np.int16) + noise, 0, 255).astype(np.uint8),
            erased,
        )

        out = pipe(
            prompt=PROMPT,
            negative_prompt=NEG,
            image=Image.fromarray(erased),
            mask_image=Image.fromarray(mask_s).convert("L"),
            num_inference_steps=args.steps,
            guidance_scale=args.guidance,
            generator=gen,
        ).images[0]

        fill = np.array(out.resize((w, h), Image.Resampling.LANCZOS))
        if prev_fill is not None and args.temporal > 0:
            fill = (
                (1.0 - args.temporal) * fill.astype(np.float32)
                + args.temporal * prev_fill.astype(np.float32)
            ).astype(np.uint8)
        prev_fill = fill

        composed = np.where(mask[..., None] > 0, fill, rgb)
        writer.write(cv2.cvtColor(composed, cv2.COLOR_RGB2BGR))
        print(f"inpaint {i}/{n}", flush=True)
        i += 1

    cap_rgb.release()
    cap_m.release()
    writer.release()
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
