# Stereo Video Viewer

Head-coupled stereoscopic viewer for `~/Downloads/vid1.mp4`, using the same
webcam → MediaPipe face mesh → off-axis camera logic as `off-axis-sneaker`.

## Run

```bash
cd ~/Repos/stereo-vid-viewer
npm install
npm run dev
```

Open http://localhost:5177 — allow webcam.

## Modes

- **Window (mono)** — single off-axis view; move head for parallax
- **Side-by-side** — left/right eyes with IPD offset (cross-eyed or VR)
- **Anaglyph** — red/cyan glasses

Video defaults to `public/media/vid1.mp4` (symlink to `~/Downloads/vid1.mp4`).
Use the Upload button for another file.

## Note on RDP

If you RDP from Windows into Debian, Cheese/this site only see cameras on the
*Debian* machine unless you redirect/stream the Windows webcam.
