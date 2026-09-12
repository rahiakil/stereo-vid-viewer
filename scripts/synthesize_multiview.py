#!/usr/bin/env python3
"""Depth-Image-Based Rendering (DIBR): synthesize extra eye viewpoints per frame.

For each source frame + depth map, warps the image to a grid of virtual camera
positions (like sampling a light field). The sneaker demo gets free viewpoints
because it has a *real 3D mesh*; this approximates that for video using depth.

Output:
  out_dir/meta.json
  out_dir/fXXXX/vx_y.jpg   # view grid for that frame

Example:
  python scripts/synthesize_multiview.py \\
    --rgb public/media/vid-labu1.mp4 \\
    --depth public/media/vid-labu1_depth.mp4 \\
    --out-dir public/media/vid-labu1_mv \\
    --nx 5 --ny 3 --every 8 --scale 0.5
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rgb", type=Path, required=True)
    ap.add_argument("--depth", type=Path, required=True)
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--nx", type=int, default=5, help="horizontal views")
    ap.add_argument("--ny", type=int, default=3, help="vertical views")
    ap.add_argument("--every", type=int, default=8, help="take every Nth video frame")
    ap.add_argument("--scale", type=float, default=0.5, help="resize before warp")
    ap.add_argument("--max-shift", type=float, default=40.0, help="px shift at nearest depth")
    ap.add_argument("--max-frames", type=int, default=0)
    return ap.parse_args()


def depth_to_metric01(depth_u8: np.ndarray) -> np.ndarray:
    """Bright=near in our depth videos → disparity weight in [0.15, 1]."""
    d = depth_u8.astype(np.float32) / 255.0
    return 0.15 + 0.85 * d


def warp_view(rgb: np.ndarray, depth01: np.ndarray, sx: float, sy: float, max_shift: float) -> np.ndarray:
    """Inverse warp: sample source so virtual camera moved by (sx,sy) in [-1,1]."""
    h, w = depth01.shape
    xs = np.arange(w, dtype=np.float32)
    ys = np.arange(h, dtype=np.float32)
    grid_x, grid_y = np.meshgrid(xs, ys)

    # Parallax: nearer (higher depth01) shifts more, opposite to eye move
    shift_x = -sx * max_shift * depth01
    shift_y = -sy * max_shift * depth01

    map_x = (grid_x + shift_x).astype(np.float32)
    map_y = (grid_y + shift_y).astype(np.float32)
    return cv2.remap(
        rgb,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


def make_contact_sheet(views: list[np.ndarray], nx: int, ny: int) -> np.ndarray:
    assert len(views) == nx * ny
    h, w = views[0].shape[:2]
    sheet = np.zeros((ny * h, nx * w, 3), dtype=np.uint8)
    for j in range(ny):
        for i in range(nx):
            sheet[j * h : (j + 1) * h, i * w : (i + 1) * w] = views[j * nx + i]
    return sheet


def main() -> int:
    args = parse_args()
    if not args.rgb.is_file() or not args.depth.is_file():
        print("missing rgb/depth", file=sys.stderr)
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)
    cap_r = cv2.VideoCapture(str(args.rgb))
    cap_d = cv2.VideoCapture(str(args.depth))
    fps = cap_r.get(cv2.CAP_PROP_FPS) or 30.0
    n = int(cap_r.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    # View offsets in [-1,1]
    xs = np.linspace(-1.0, 1.0, args.nx)
    ys = np.linspace(-1.0, 1.0, args.ny)

    frames_meta = []
    i = 0
    kept = 0
    while True:
        ok1, fr = cap_r.read()
        ok2, fd = cap_d.read()
        if not ok1 or not ok2:
            break
        if args.max_frames and kept >= args.max_frames:
            break

        if i % args.every != 0:
            i += 1
            continue

        if fd.ndim == 3:
            fd = cv2.cvtColor(fd, cv2.COLOR_BGR2GRAY)
        if args.scale != 1.0:
            fr = cv2.resize(fr, None, fx=args.scale, fy=args.scale, interpolation=cv2.INTER_AREA)
            fd = cv2.resize(fd, (fr.shape[1], fr.shape[0]), interpolation=cv2.INTER_AREA)

        depth01 = depth_to_metric01(fd)
        folder = args.out_dir / f"f{kept:04d}"
        folder.mkdir(parents=True, exist_ok=True)

        views = []
        files = []
        for j, sy in enumerate(ys):
            for ii, sx in enumerate(xs):
                view = warp_view(fr, depth01, float(sx), float(sy), args.max_shift)
                name = f"v{ii}_{j}.jpg"
                cv2.imwrite(str(folder / name), view, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                views.append(view)
                files.append(name)

        sheet = make_contact_sheet(views, args.nx, args.ny)
        cv2.imwrite(str(folder / "sheet.jpg"), sheet, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        # Also copy center view large
        cx, cy = args.nx // 2, args.ny // 2
        cv2.imwrite(str(folder / "center.jpg"), views[cy * args.nx + cx], [int(cv2.IMWRITE_JPEG_QUALITY), 90])

        frames_meta.append(
            {
                "index": kept,
                "source_frame": i,
                "dir": folder.name,
                "files": files,
                "sheet": "sheet.jpg",
            }
        )
        print(f"multiview frame {kept} (src {i}/{n}) → {folder}", flush=True)
        kept += 1
        i += 1

    cap_r.release()
    cap_d.release()

    meta = {
        "fps_source": fps,
        "every": args.every,
        "nx": args.nx,
        "ny": args.ny,
        "xs": xs.tolist(),
        "ys": ys.tolist(),
        "max_shift": args.max_shift,
        "scale": args.scale,
        "frames": frames_meta,
        "note": (
            "Sneaker uses a real 3D GLB. These JPEGs are depth-warped novel views. "
            "At runtime, head (x,y) picks/blends the nearest view — approximating free viewpoint."
        ),
    }
    (args.out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    # Convenience: first sheet at root for quick open
    if frames_meta:
        first = args.out_dir / frames_meta[0]["dir"] / "sheet.jpg"
        (args.out_dir / "preview_sheet.jpg").write_bytes(first.read_bytes())
    print(f"wrote {kept} multiview frames → {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
