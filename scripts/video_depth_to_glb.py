#!/usr/bin/env python3
"""Convert RGB + depth (+ optional matte) into crisp per-frame textured GLBs.

Fixes dust/trails:
  - Prefer rembg/BiRefNet matte over raw depth threshold
  - Morphology + largest blobs
  - Edge-aware depth smoothing
  - UV JPEG textures (not muddy vertex colors)

Example:
  python scripts/video_depth_to_glb.py \\
    --rgb public/media/vid-labu1.mp4 \\
    --depth public/media/vid-labu1_depth.mp4 \\
    --matte public/media/vid-labu1_matte.mp4 \\
    --out-dir public/media/vid-labu1_glbs \\
    --tex-max-side 768
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import trimesh
from PIL import Image


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rgb", type=Path, required=True)
    ap.add_argument("--depth", type=Path, required=True)
    ap.add_argument("--matte", type=Path, default=None, help="optional alpha video from rembg")
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--cols", type=int, default=160)
    ap.add_argument("--rows", type=int, default=280)
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--height-m", type=float, default=0.28)
    ap.add_argument("--relief-m", type=float, default=0.16)
    ap.add_argument("--base-z", type=float, default=0.02, help="push subject through screen")
    ap.add_argument("--fg-threshold", type=float, default=0.55, help="used only if no matte")
    ap.add_argument("--alpha-cut", type=float, default=0.45, help="matte keep threshold")
    ap.add_argument("--tex-max-side", type=int, default=768)
    ap.add_argument("--max-frames", type=int, default=0)
    return ap.parse_args()


def smooth_depth(depth: np.ndarray, guide: np.ndarray) -> np.ndarray:
    """Edge-aware cleanup to reduce speckles that become dust clouds."""
    d = depth.astype(np.float32)
    # bilateral on depth guided by luma
    guide_u8 = cv2.cvtColor(guide, cv2.COLOR_RGB2GRAY) if guide.ndim == 3 else guide
    d_u8 = np.clip(d * 255.0, 0, 255).astype(np.uint8)
    sm = cv2.bilateralFilter(d_u8, d=7, sigmaColor=40, sigmaSpace=7)
    # joint bilateral-ish: mix with guide edges
    edges = cv2.Canny(guide_u8, 60, 140)
    edges = cv2.dilate(edges, np.ones((2, 2), np.uint8), iterations=1)
    sm_f = sm.astype(np.float32) / 255.0
    d = np.where(edges > 0, d * 0.35 + sm_f * 0.65, sm_f)
    return d


def clean_mask(mask: np.ndarray) -> np.ndarray:
    m = (mask > 0).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if nlab <= 1:
        return m > 0
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep_idx = 1 + np.argsort(areas)[::-1][:2]
    keep = np.isin(labels, keep_idx)
    # kill tiny islands
    keep &= areas.max() >= 500 if len(areas) else keep
    return keep


def build_mesh(
    rgb: np.ndarray,
    depth01: np.ndarray,
    mask: np.ndarray,
    cols: int,
    rows: int,
    height_m: float,
    relief_m: float,
    base_z: float,
    tex_max_side: int,
) -> trimesh.Trimesh | None:
    h, w = depth01.shape[:2]
    aspect = w / float(h)
    width_m = height_m * aspect

    xs = np.linspace(0, w - 1, cols)
    ys = np.linspace(0, h - 1, rows)
    grid_x, grid_y = np.meshgrid(xs, ys)
    gi = np.round(grid_x).astype(np.int32)
    gj = np.round(grid_y).astype(np.int32)

    d = depth01[gj, gi]
    m = mask[gj, gi]
    if m.sum() < 32:
        return None

    # Local depth remap inside subject so relief is crisp (not shelf-relative)
    d_fg = d[m]
    d0, d1 = float(np.percentile(d_fg, 5)), float(np.percentile(d_fg, 95))
    if d1 - d0 < 1e-3:
        d_n = np.ones_like(d)
    else:
        d_n = np.clip((d - d0) / (d1 - d0), 0, 1)

    u = np.linspace(-0.5, 0.5, cols)
    v = np.linspace(0.5, -0.5, rows)
    uu, vv = np.meshgrid(u, v)
    px = uu * width_m
    py = vv * height_m
    # Near parts of subject → toward camera (+Z)
    pz = base_z + d_n * relief_m

    verts = np.stack([px, py, pz], axis=-1).reshape(-1, 3)
    m_flat = m.reshape(-1)

    faces = []
    for r in range(rows - 1):
        for c in range(cols - 1):
            i0 = r * cols + c
            i1 = i0 + 1
            i2 = i0 + cols
            i3 = i2 + 1
            if m_flat[[i0, i1, i2, i3]].sum() < 3:
                continue
            # Drop quads with crazy depth jumps (trails / sheets)
            zs = pz.reshape(-1)[[i0, i1, i2, i3]]
            if zs.max() - zs.min() > relief_m * 0.55:
                continue
            faces.append([i0, i2, i1])
            faces.append([i1, i2, i3])
    if not faces:
        return None
    faces = np.asarray(faces, dtype=np.int64)

    # UV for full-frame texture
    uu_uv = np.linspace(0, 1, cols)
    vv_uv = np.linspace(0, 1, rows)  # image top = v0
    uuv, vvv = np.meshgrid(uu_uv, vv_uv)
    uvs = np.stack([uuv, 1.0 - vvv], axis=-1).reshape(-1, 2)

    # Crisp texture (JPEG), not vertex colors
    tex = rgb
    th, tw = tex.shape[:2]
    scale = tex_max_side / max(th, tw)
    if scale < 1.0:
        tex = cv2.resize(tex, (int(tw * scale), int(th * scale)), interpolation=cv2.INTER_AREA)
    # Apply matte into texture alpha for cleaner edges in viewer
    mask_u8 = (mask.astype(np.uint8) * 255)
    if mask_u8.shape[:2] != tex.shape[:2]:
        mask_u8 = cv2.resize(mask_u8, (tex.shape[1], tex.shape[0]), interpolation=cv2.INTER_LINEAR)
    rgba = np.dstack([tex, mask_u8])
    pil = Image.fromarray(rgba, mode="RGBA")

    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uvs, image=pil)
    mesh.remove_unreferenced_vertices()
    return mesh


def main() -> int:
    args = parse_args()
    if not args.rgb.is_file() or not args.depth.is_file():
        print("missing rgb or depth", file=sys.stderr)
        return 1
    use_matte = args.matte is not None and args.matte.is_file()
    if args.matte and not use_matte:
        print(f"warning: matte not found {args.matte}, falling back to depth", file=sys.stderr)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for old in args.out_dir.glob("frame_*.glb"):
        old.unlink()

    cap_rgb = cv2.VideoCapture(str(args.rgb))
    cap_d = cv2.VideoCapture(str(args.depth))
    cap_m = cv2.VideoCapture(str(args.matte)) if use_matte else None
    if not cap_rgb.isOpened() or not cap_d.isOpened():
        print("failed to open videos", file=sys.stderr)
        return 1
    if use_matte and (cap_m is None or not cap_m.isOpened()):
        print("failed to open matte", file=sys.stderr)
        return 1

    fps = cap_rgb.get(cv2.CAP_PROP_FPS) or 30.0
    n_rgb = int(cap_rgb.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    exported: list[str] = []
    i = 0
    prev_depth = None

    while True:
        ok1, fr = cap_rgb.read()
        ok2, fd = cap_d.read()
        if not ok1 or not ok2:
            break
        ok3, fm = (True, None)
        if use_matte:
            ok3, fm = cap_m.read()
            if not ok3:
                break
        if args.max_frames and i >= args.max_frames:
            break

        if i % args.every == 0:
            rgb = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
            depth_u8 = cv2.cvtColor(fd, cv2.COLOR_BGR2GRAY) if fd.ndim == 3 else fd
            if depth_u8.shape[:2] != rgb.shape[:2]:
                depth_u8 = cv2.resize(depth_u8, (rgb.shape[1], rgb.shape[0]))
            depth01 = depth_u8.astype(np.float32) / 255.0
            depth01 = smooth_depth(depth01, rgb)
            if prev_depth is not None:
                depth01 = 0.7 * depth01 + 0.3 * prev_depth
            prev_depth = depth01

            if use_matte:
                alpha = cv2.cvtColor(fm, cv2.COLOR_BGR2GRAY) if fm.ndim == 3 else fm
                if alpha.shape[:2] != rgb.shape[:2]:
                    alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]))
                mask = alpha.astype(np.float32) / 255.0 >= args.alpha_cut
            else:
                mask = depth01 >= args.fg_threshold
            mask = clean_mask(mask)

            mesh = build_mesh(
                rgb,
                depth01,
                mask,
                args.cols,
                args.rows,
                args.height_m,
                args.relief_m,
                args.base_z,
                args.tex_max_side,
            )
            if mesh is None:
                print(f"skip {i}: empty mask", flush=True)
            else:
                name = f"frame_{i:05d}.glb"
                mesh.export(args.out_dir / name, file_type="glb")
                exported.append(name)
                print(f"glb {i}/{n_rgb} -> {name} faces={len(mesh.faces)}", flush=True)

        i += 1

    cap_rgb.release()
    cap_d.release()
    if cap_m:
        cap_m.release()

    meta = {
        "fps": fps,
        "frame_count_source": i,
        "every": args.every,
        "files": exported,
        "matte": str(args.matte) if use_matte else None,
        "tex_max_side": args.tex_max_side,
        "note": "Textured FG meshes with rembg matte + bilateral depth; eye pose at runtime.",
    }
    (args.out_dir / "sequence.json").write_text(json.dumps(meta, indent=2))
    print(f"wrote {len(exported)} glbs in {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
