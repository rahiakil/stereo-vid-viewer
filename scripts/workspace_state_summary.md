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

## 5. Formalized Autostereoscopic Pipeline Categorizations

To systematically scale our conversion and integration workflows, all active project streams are grouped into four standardized technological categories:

### 📁 Class A: Monocular Video to Glasses-Free 3D (Depth-Mesh Portal)
* **Description:** Generates interactive 3D structures from flat, single-perspective 2D videos (e.g. YouTube uploads or flat media).
* **Stack:** Monocular 2D Source $\to$ Depth-Anything-V2 Disparity Map $\to$ `u2net`/`BiRefNet` Foreground Matting $\to$ `LaMa` Background Plate Inpainting $\to$ WebGL vertex-displacement matrix shearing.

### 📁 Class B: Stereoscopic Video to Glasses-Free 3D (Disparity-Interpolated Portal)
* **Description:** Transforms stereoscopic dual-camera streams (e.g., SBS, TAB, or modern Apple Spatial formats) into glasses-free 3D window volumes.
* **Stack:** View-layer Demuxing $\to$ Optical Flow horizontal disparity indexing $\to$ Focal-length perspective tracking $\to$ Head-pose horizontal viewport viewpoint morphing.

### 📁 Class C: Multi-View & Light-Field to Glasses-Free 3D (Viewport Blending)
* **Description:** Supports real-time multi-angle physical perspectives (e.g. 15-view 5x3 grids or calibrated multi-camera directories) with zero stretching artifacts.
* **Stack:** Calibrated Grid Ingestion $\to$ Depth-Image-Based Rendering (DIBR) virtual viewpoint generation $\to$ Face-tracker linear interpolation blending.

### 📁 Class D: NeRF & Dynamic 3D Gaussian Splatting to Glasses-Free 3D (Neural Splat Portal)
* **Description:** Produces ultra-photorealistic volumetric assets of complex physical products (like sneakers or toys) featuring physical, view-dependent gloss, specular reflections, and perfect shapes.
* **Stack:** Circular camera orbit sweeps $\to$ COLMAP Structure-from-Motion $\to$ 3DGS ellipsoid / NeRF coordinate field training $\to$ Live WebGL/WebGPU Splat rendering coupled with head-tracking off-axis projection.

---

## 6. NeRF & 3D Gaussian Splatting for Monocular Sneaker Previews

We can directly utilize standard, monocular circular sweeping videos (orbital pans) to construct pristine, interactive 3D product previews (e.g., our sneaker demo) using Neural Radiance Fields (NeRF) or 3D Gaussian Splatting (3DGS).

### Technical Integration Workflow
1. **Orbital Capture:** Record a short 10-20 second monocular video doing a slow, continuous circular orbit around the physical product (e.g., a sneaker).
2. **Camera Coordinate Solving:** Run COLMAP Structure-from-Motion (SfM) to resolve the high-precision $[R|t]$ camera matrices (intrinsics and extrinsics) for each video frame.
3. **Volumetric Representation Optimization (3DGS):** Optimize the spatial position, scale, rotation, opacity, and view-dependent color harmonics of millions of 3D Gaussian ellipsoids to represent the object.
4. **Holographic Presentation Paths:**
   * **Baking into Class C (Lightfield)**: Render the finished 3DGS model from a 15-view (5x3) camera trajectory, bake into a multi-view grid layout, and load it directly into our fast-caching MultiViewPlayer component.
   * **Real-time WebGL/WebGPU Splat Rasterizer**: Embed a live web-based Splat renderer (e.g., `gsplat.js` or Luma Splat SDK) directly within our React application. Map the webcam head-tracking coordinates in real-time to the rasterizer's viewpoint projection matrix. As the user sweeps their head, they will see the actual 3D splat cloud move, displaying true view-dependent leather gloss and mesh specular reflections under a glasses-free autostereoscopic portal!

---

## 7. Critical Deployment Safeguards & Regression Testing

Whenever deploying a new build (via `npm run build` or pushing to `main` for GitHub Pages deployment), future agents/developers must verify that **no core interactive features or navigation assets are regressed or removed**.

### ⚠️ Known Regression Warning
* **The Issue**: During previous automated script rewrites, a bug caused the live site to load with only the `labubu` video card and no functional UI tabs, side navigation elements, or interactive options visible.
* **The Rule**: Never commit changes that result in a blank slate, missing tabs, or a locked-down interface that only displays a single video container. 
* **The Test**: 
  1. Always compile and test the build locally first (`npm run build` followed by a local preview check).
  2. Verify that all dashboard navigation tabs (`'audits'`, `'evaluation'`, `'research'`, `'resolution'`) are present, active, and fully clickable.
  3. Verify that the video selection list contains all integrated video assets (`fuarukee`, `labubu`, `cows_demo`, `office_demo`, `svd_0001`, etc.) rather than defaulting to showing just one isolated video without selection controls.
  4. Ensure that the mobile-responsive flex/grid rules adapt perfectly and do not clip these buttons out of reach on smaller viewports.
