# Stereo Video Viewer

Head-coupled viewer inspired by off-axis-sneaker: **MediaPipe** head pose +
**Three.js** off-axis camera. Video becomes 3D via depth + optional rembg matte
and per-frame textured GLBs.

## Pipeline

| Step | Library | Role |
|---|---|---|
| Depth | **Depth Anything V2** | per-frame depth from RGB |
| Matte | **rembg** (U2-Net / BiRefNet) | clean character cutout (kills dust) |
| Mesh → GLB | **trimesh** | FG textured meshes per frame |
| Display | **Three.js** + **MediaPipe** | aisle video on screen + FG pop-out |

Eye pose is applied **at runtime**. Large media (`*.mp4`, `*_glbs/`) are gitignored — bake locally.

## Run

```bash
cd ~/Repos/stereo-vid-viewer
npm run dev
# https://localhost:5177/  (or https://papa-debian:5177/)
```

Default tab: **Sneaker demo** (BG video + matted GLB characters).

## Bake depth / matte / GLBs

```bash
PY=/home/papa/Repos/hrr-basic-one/.venv/bin/python

$PY scripts/estimate_depth_video.py \
  --input ~/Downloads/vid-labu1.mp4 \
  --output public/media/vid-labu1_depth.mp4 --max-side 640

$PY scripts/matte_video_rembg.py \
  --input public/media/vid-labu1.mp4 \
  --output public/media/vid-labu1_matte.mp4 \
  --model u2net --max-side 640

$PY scripts/video_depth_to_glb.py \
  --rgb public/media/vid-labu1.mp4 \
  --depth public/media/vid-labu1_depth.mp4 \
  --matte public/media/vid-labu1_matte.mp4 \
  --out-dir public/media/vid-labu1_glbs \
  --tex-max-side 768
```
