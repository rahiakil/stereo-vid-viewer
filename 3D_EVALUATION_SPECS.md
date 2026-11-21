# 3D Autostereoscopic Pipeline: Evaluation Specs & Algorithmic Self-Evaluation Report

This document outlines the architectural specifications, mathematical evaluation criteria, and strategic progress checkpoints of our **2D-to-3D Monocular Autostereoscopic Processing Pipeline**. It is designed as a master reference for other agents and developers to evaluate the integrity and effectiveness of our system.

---

## 1. Core Architectural Pipeline

The system processes standard, monocular 2D video feeds (e.g., `.mp4` / `.mkv`) and converts them into an interactive Glasses-Free 3D Portal View. The background conversion follows four isolated steps executed by `scripts/harness_daemon.py`:

```
┌─────────────────┐     ┌───────────────────────┐     ┌─────────────────────┐     ┌────────────────────────┐
│  Monocular 2D   │ ──> │   Depth-Anything-V2   │ ──> │   u2net Seg-Matte   │ ──> │  LaMa Inpaint Plate &  │
│  Video Stream   │     │ (Geometric Depth Map) │     │ (Foreground Isolation)│   │  WebGL 3D Mesh Render  │
└─────────────────┘     └───────────────────────┘     └─────────────────────┘     └────────────────────────┘
```

1. **Monocular Extraction:** Extracts a clean, unsqueezed monocular stream (`640x360` landscape 16:9 aspect ratio) representing the left-eye view of the world.
2. **Depth Field Generation:** Executes a dense transformer-based depth estimation model (`Depth-Anything-V2`) to assign real-world distance values to every pixel, exported as a grayscale depth map video stream (`{name}_depth.mp4`).
3. **Foreground Isolation:** Runs `u2net` to create alpha mattes of moving foreground elements, segmenting the subject from its surroundings.
4. **Occlusion-Free Boundary Inpainting:** Uses `LaMa` (Resolution-Weighted Inpainting) to erase segmented subjects and fill the background plate, resolving empty occlusion boundaries when the camera viewpoint shifts off-axis.

---

## 2. Programmatic Evaluation Criteria (3D Index Score)

To evaluate the quality of a 3D conversion without human visual inspection, the background harness runs a **Closed-Loop Computer Vision Feedback Audit** inside a headless Chromium browser using Playwright.

### A. The Disparity Shift Mathematical Formula
We measure the structural horizontal parallax shift by placing the virtual head coordinates at extreme left and right coordinates and computing the Mean Absolute Difference (disparity shift) of the rendered WebGL viewports:

$$\mathcal{V} = \frac{1}{w \cdot h} \sum_{x=1}^{w} \sum_{y=1}^{h} \left| I_{\text{left}}(x,y) - I_{\text{right}}(x,y) \right|$$

Where:
* $I_{\text{left}}(x,y)$ represents the pixel luminance at coordinates $(x,y)$ during a simulated left-eye head pose position ($\text{pose.x} = 0.15$).
* $I_{\text{right}}(x,y)$ represents the pixel luminance during a simulated right-eye head pose position ($\text{pose.x} = 0.85$).
* $w, h$ are the width and height of the captured audit frames ($1280 \times 720$).

### B. Rating Scale & Grading Tiers
* **🌟 Spectacular (Score $\ge 4.0$):** Outstanding foreground pop-out, sharp contour boundaries, and a distinct, deep horizontal volume change under perspective sweeps.
* **📂 Standard (Score $1.5 \to 3.9$):** Solid 3D relief, but may show minor edge halos, flat perspective planes, or lower contrast depth maps.
* **❌ Minimal/Flat (Score $< 1.5$):** Flat monocular projection, indicative of empty depth estimation or failed WebGL loading.

### C. The Warp-Tolerant Clipping Safeguard
* **The Danger:** Setting the 3D relief factor too high forces excessive mesh displacement, causing severe geometric tearing, pixel ripping, and "webbing" visual artifacts. This artificially drives up the OpenCV difference score (often $> 12.0$).
* **The Fix:** The optimization loop tests multiple relief values (`[0.08, 0.16, 0.26]`) and selects the relief that maximizes the 3D Index score **strictly keeping it below a warp tolerance ceiling of $10.0$**. This prevents tearing and guarantees a crisp, physically plausible look-around.

---

## 3. Remote Desktop Operating Mode (Webcam-Free Simulator)

Because development often occurs over remote desktop protocol (RDP) sessions that lack direct physical webcam hardware access, the Webapp Dashboard implements a **Local Progress, Process & Parallax Control Simulator**:

* **Auto-Detection:** When the webpage detects it is running locally (`localhost` / `127.0.0.1`), it automatically activates the **Remote Desktop Parallax Simulator** panel.
* **Manual Coordinate Control:** The console renders a high-precision horizontal pose slider ($0.15$ to $0.85$). Dragging this slider commands the WebGL player’s head-coordinates live via `window.setPoseValue()`, allowing webcam-free manual perspective testing.
* **Auto-Sweep Loop:** Includes an oscillating loop toggle that continuously sweeps coordinates using a sinusoidal function ($x = 0.5 + 0.35 \sin(\text{time})$) to test mesh boundaries dynamically.

---

## 4. Current Run Evaluation & Log Summary

The current system has processed and audited **6 benchmark runs** with the following CV feedback telemetry:

| Video ID | Title | 3D Index Score | Optimal Relief | Quality Grade | Evaluation Statement |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `custom` | First Custom Video | **6.14** | `0.16` | **🌟 Best** | Outstanding foreground segment separation; deep, comfortable horizontal look-around volume. |
| `fuarukee` | Fuarukee POV | **5.82** | `0.08` | **🌟 Best** | Pristine landscape depth map gradient with realistic focal scaling. |
| `labubu` | Labubu Toy Walk | **4.95** | `0.16` | **🌟 Best** | Solid high-contrast depth-mesh; minor edge haloing in extreme sweeps. |
| `seal_demo` | Seal Demo | **4.51** | `0.08` | **🌟 Best** | Continuous flowing depth field; excellent organic shape reconstruction. |
| `cows_demo` | Cows Demo | **0.47** | `0.08` | **📂 Archive** | Minimal depth variance; flat field with low-contrast background boundary. |
| `dancing_demo` | Dancing Demo | **0.00** | `0.16` | **📂 Archive** | Flat fallback; failed perspective displacement under extreme pose shifts. |

---

## 5. Strategic Next Steps (How We Are Iterating to Be Better)

To elevate the autostereoscopic pipeline to professional, cinematic-grade fidelity, the following evolutionary upgrades are recommended:

1. **Temporal Depth MAP Smoothing:** Integrate Lucas-Kanade optical flow on the depth generator output. This locks depth boundaries between consecutive frames, eliminating edge-flicker during high-speed action.
2. **Focus-Weighted Background Inpainting:** Apply camera lens focal parameters to the background inpainting plate (`LaMa`), ensuring that background perspective shifts perfectly scale with foreground depth lines.
3. **Adaptive Mesh Tessellation:** Subdivide WebGL geometry dynamically based on depth boundaries, allocating dense polygons to high-gradient boundaries (e.g. subject contours) while maintaining simple low-poly structures elsewhere.

---

## 6. Formalized Autostereoscopic Pipeline Categorizations

To scale our engineering efforts and provide clear technological tracks for various formats, our processing pipelines are categorized into four distinct classes:

### 📁 Class A: Monocular Video to Glasses-Free 3D (Depth-Mesh Portal)
* **Input Format:** Standard 2D single-perspective video stream.
* **Algorithmic Path:** Monocular stream $\to$ Depth-Anything-V2 $\to$ `u2net`/`BiRefNet` foreground segmentation matte $\to$ `LaMa` resolution-weighted background plate inpainting $\to$ Dynamic WebGL off-axis vertex displacement.
* **Ideal Use Case:** Enhancing flat web movies, archive video assets, or single-camera actor pans.

### 📁 Class B: Stereoscopic Video to Glasses-Free 3D (Disparity-Interpolated Portal)
* **Input Format:** Side-by-Side (SBS), Above-Below (ABL), or Apple Vision Pro MV-HEVC streams.
* **Algorithmic Path:** Multi-view layer demuxing $\to$ Optical flow horizontal disparity estimation $\to$ Focal-length perspective scaling $\to$ Horizontal look-around viewpoint interpolation.
* **Ideal Use Case:** Converting 3D movies, stereoscopic camera captures, or spatial videos into flat glassless screens.

### 📁 Class C: Multi-View & Light-Field to Glasses-Free 3D (Viewport Blending)
* **Input Format:** Calibrated 5x3 (15-camera) grid files, SVD spatial layers, or Google DeepView hemispherical maps.
* **Algorithmic Path:** Grid frame ingestion $\to$ Depth-Image-Based Rendering (DIBR) interpolation $\to$ Webcam head-pose coordinate mapping $\to$ Viewport blend-shading.
* **Ideal Use Case:** High-fidelity physical look-around environments with zero geometric stretch artifacts.

### 📁 Class D: NeRF & Dynamic 3D Gaussian Splatting to Glasses-Free 3D (Neural Splat Portal)
* **Input Format:** Monocular orbital sweeps, multi-angle object photos, or dynamic physical captures.
* **Algorithmic Path:** Structure-from-Motion (COLMAP) path tracking $\to$ Gaussian Splatting / Neural Radiance Fields volumetric optimization $\to$ Real-time WebGL/WebGPU Splat rasterization $\to$ Off-axis matrix mapping.
* **Ideal Use Case:** Ultra-photoreal, interactive product previews (e.g. sneakers or luxury items) containing dynamic view-dependent light reflections.

---

## 7. NeRF & 3D Gaussian Splatting for Monocular Sneaker Previews

We can directly leverage monocular videos of physical products (such as a sneaker) to construct highly immersive, glasses-free interactive product previews using Neural Radiance Fields (NeRF) or 3D Gaussian Splatting (3DGS).

### Technical Integration Workflow
1. **The Orbital Capture:** The user records a 10-20 second monocular video doing a complete circular pan (orbital sweep) around the sneaker under consistent lighting.
2. **Camera Pose Estimation:** We run Structure-from-Motion (SfM) via COLMAP to resolve the high-precision $[R|t]$ extrinsic and intrinsic camera pose matrices for each video frame.
3. **Volumetric Training:** We train a 3D Gaussian Splat model. This optimizes the spatial coordinates, scale, rotation, opacity, and spherical harmonics (view-dependent colors) of millions of tiny ellipsoids to represent the product.
4. **Holographic Presentation Paths:**
   * **Baking into Class C**: Render the finished 3DGS sneaker model from a 15-view (5x3) camera trajectory and output a Light-field Grid format for immediate lightweight display.
   * **Direct WebGL Splat Rasterization**: Embed a real-time web splat engine (e.g. `gsplat.js` or Luma WebGL Splat SDK) within our React application. Map the webcam's head-tracking coordinates live to the rasterizer's projection camera matrix. As the user moves, the actual 3D splat cloud renders in real-time, delivering a physical look-around experience complete with glossy leather/mesh reflections.

---

## 8. Critical Deployment Safeguards & Regression Testing

To prevent feature regression when upgrading or deploying the autostereoscopic pipeline to production platforms (such as GitHub Pages), any automated agent or engineer must adhere to the following checklist:

1. **Verify Complete Navigability:** Before shipping, execute `npm run build` locally and verify that all dashboard control buttons and navigation tabs are active. Ensure that the sidebar layout does not compress or drop any UI elements.
2. **Prevent "Single-Asset Locks" (Labubu Bug):** A critical bug previously caused the production environment to default to only displaying the `labubu` target video card, stripping out all selection buttons, sliders, and alternative media datasets. Ensure that all standard asset IDs are fully registered across components and rendered under the video selection catalog.
3. **Responsive Visual Testing:** Test the page on standard mobile dimensions in the browser's responsive design mode. No control buttons, sliders, or tab selectors should be clipped or hidden by overflow parameters. Ensure all features are available across standard viewport sizes.
