# 3D Autostereoscopic Look-Around Video Portal: Workspace State & Strategic Analysis

This document summarizes the current technical state, system architecture, completed milestones, and immediate strategic engineering opportunities of the glasses-free 3D portal project. Use this text as a handoff prompt for other AI agents to solicit architectural audits or collaborate on next-stage upgrades.

---

## 1. Core Architectural Pillars

### A. WebGL Off-Axis Look-Around Projection Camera (`src/utils/offAxisCamera.ts`, `depthMeshScene.ts`)
* **How it works**: Instead of using a static camera, the virtual camera adjusts its viewing frustum asymmetrical off-axis parameters based on the physical position of the user's eyes relative to the screen plane ($z = 0$). This creates the physical illusion of "looking through a window" (or a portal) at a 3D volume.
* **SBS look-around portal**: For Side-by-Side (SBS) videos, the horizontal coordinate of the user's head position (`1.0 - pose.x`) dynamically interpolates the eye value between `0.0` (Left eye texture) and `1.0` (Right eye texture) in the shader, morphing the viewport in real-time to generate natural depth on a completely flat screen.

### B. Webcam-Driven Head Pose Estimation (`src/utils/headPose.ts`, `FaceTracker.tsx`)
* **How it works**: Uses MediaPipe FaceMesh to track facial landmarks. Computes the normalized face center ($x$, $y$) and estimate depth proxy ($z$). 
* **Calibration**: Anchors the baseline coordinate when tracking stabilizes, isolating head movements and eliminating static position offsets on mobile front-facing cameras.

### C. Automated AI Stream Processing Daemon (`scripts/harness_daemon.py`)
* Runs continuously as a systemd user service (`3d-harness.service`). Monitors `/home/papa/Downloads/queue/` for dropped `.mp4` video files.
* **Pipeline steps**:
  1. **Slice**: Trims the first 10 seconds of SBS video (`_stereo.mp4`).
  2. **Unsqueeze**: Crops the left-eye view and rescales it to a standard 16:9 monocular format (`_rgb.mp4`).
  3. **Depth estimation**: Generates a bilateral disparity map using *Depth-Anything-V2-Small* (`_depth.mp4`).
  4. **Foreground matting**: Extracts a high-contrast subject mask using *rembg u2net* (`_matte.mp4`).
  5. **Background inpainting**: Inpaints empty background textures using *LaMa AI* (`_bg_clean.mp4`), completely eliminating character ghosting artifacts behind the mesh.
  6. **UI integration**: Injects card metadata and button links directly into the React source files (`App.tsx` and `SneakerDemo.tsx`).

### D. Automated Playwright Tester & Parallax Auditor (`scripts/harness_daemon.py`)
* Launches a headless Chromium browser via Playwright.
* Navigates to the local Vite preview, triggers simulated eye-coordinate sweeps from far-left ($x=0.1$) to far-right ($x=0.9$), captures viewpoint screenshots, and calculates the **absolute pixel difference (3D Parallax Fidelity Index)** to audit and verify that off-axis projection is physically active.

---

## 2. Completed Milestones

1. **Continuous Daemonization**: Configured a systemd user-level service that monitors, processes, integrates, and tests videos in the background with zero root/sudo credential friction.
2. **Double-Eye Look-Around Portal**: Spliced, unsqueezed, and integrated the "Office Demo" benchmark video with pre-seeded simulated parallax screenshots.
3. **Matte-Bypass Shader Upgrade**: Enhanced the fragment shaders to support a `useMatte` uniform, letting users toggle between clean foreground cutouts (e.g., Labubu walkthrough) and full landscape mesh rendering (e.g., Fuarukee POV scenery).
4. **Vite UI Upgrade & Clean Compilation**: Added a beautiful cards library list, a dedicated Harness Dashboard view with system performance logs, and verified a 100% clean TypeScript compile.

---

## 3. Clutter Clearance Utility
An automated clutter clearance function runs every time the daemon boots and once every 24 hours of uptime to keep the disk footprint lightweight:
* Purges python `__pycache__` files.
* Unlinks broken, non-mp4, or unfinished temporary files from the queue directory.
* Cleans up stale logs, maintaining a healthy, fast-moving system environment.

---

## 4. Strategic Collaboration Prompt (Copy for other agents)

> "You are an expert Graphics Engineer and Deep Learning Researcher. I am developing a glasses-free 3D video portal utilizing WebGL off-axis projection, webcam-driven head tracking, and monocular 2D-to-3D depth-mesh sequence reconstruction (using Depth-Anything-V2, rembg matting, and LaMa inpainting background plates).
> 
> Here is our current workspace state:
> - The ThreeJS off-axis projection engine successfully shifts viewing frustums based on head coordinates.
> - A systemd user daemon continuously processes 2D/SBS videos, updates React states, runs Playwright head-sweep simulations, and records parallax variance metrics.
> 
> Review this architecture and provide specific solutions for the following next-stage challenges:
> 
> 1. **Temporal Depth Smoothing**: How do we integrate Optical Flow (e.g. Farneback or Lucas-Kanade) into our Python depth extraction pipeline to link depth frames temporally and completely eliminate depth-mesh flicker?
> 2. **Client-side WebGPU Acceleration**: What is the optimal architecture to compile monocular depth models (like Depth-Anything-V2-Small) into ONNX Runtime Web using WebGPU, enabling instantaneous client-side 2D-to-3D conversion directly in the mobile browser?
> 3. **Cinema-scale Lenticular Interleaving**: How do we extend our fragment shader to support multi-view lenticular or parallax-barrier autostereoscopic displays, spatially interleaving multiple horizontal perspectives across screen subpixels so that multiple users can look around the scene simultaneously without glasses?"

---

## 5. Critical Deployment Safeguards & Regression Testing

Whenever deploying a new build (via `npm run build` or pushing to `main` for GitHub Pages deployment), future agents/developers must verify that **no core interactive features or navigation assets are regressed or removed**.

### ⚠️ Known Regression Warning
* **The Issue**: During previous automated script rewrites, a bug caused the live site to load with only the `labubu` video card and no functional UI tabs, side navigation elements, or interactive options visible.
* **The Rule**: Never commit changes that result in a blank slate, missing tabs, or a locked-down interface that only displays a single video container. 
* **The Test**: 
  1. Always compile and test the build locally first (`npm run build` followed by a local preview check).
  2. Verify that all dashboard navigation tabs (`'audits'`, `'evaluation'`, `'research'`, `'resolution'`) are present, active, and fully clickable.
  3. Verify that the video selection list contains all integrated video assets (`fuarukee`, `labubu`, `cows_demo`, `office_demo`, `svd_0001`, etc.) rather than defaulting to showing just one isolated video without selection controls.
  4. Ensure that the mobile-responsive flex/grid rules adapt perfectly and do not clip these buttons out of reach on smaller viewports.
