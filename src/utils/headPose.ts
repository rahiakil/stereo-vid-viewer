export interface HeadPose {
  x: number;
  y: number;
  z: number;
}

/**
 * Same landmark → pose logic as off-axis-sneaker, with optional calibration.
 *
 * On phones the front camera is at the top of the device, so the face is rarely
 * centered in frame. `calibrate()` records the first stable pose as the "center"
 * baseline; subsequent poses are reported relative to that baseline so the scene
 * stays put and head movement only produces parallax (not a static offset).
 */
export class HeadPoseTracker {
  private smoothed: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private smoothingFactor: number;
  private baseInterOcular = 0.1;
  private baseline: HeadPose | null = null;
  private calibrating = false;
  private calibSamples: HeadPose[] = [];
  private calibTarget = 20;

  constructor(smoothingFactor = 0.3) {
    this.smoothingFactor = Math.max(0.1, Math.min(0.9, smoothingFactor));
  }

  /** Start collecting samples for a new baseline. Call when tracking first engages. */
  startCalibration(samples = 20) {
    this.calibrating = true;
    this.calibSamples = [];
    this.calibTarget = samples;
    this.baseline = null;
  }

  isCalibrating() {
    return this.calibrating;
  }

  hasBaseline() {
    return this.baseline != null;
  }

  updateFromLandmarks(landmarks: Array<{ x: number; y: number; z?: number }>): HeadPose | null {
    if (!landmarks || landmarks.length < 468) return null;

    const leftEyeInner = landmarks[133];
    const rightEyeInner = landmarks[362];
    const noseTip = landmarks[1];
    const leftEyeOuter = landmarks[33];
    const rightEyeOuter = landmarks[263];

    // Guard against NaN landmarks (MediaPipe can return garbage on mobile).
    if (
      !leftEyeInner || !rightEyeInner || !noseTip || !leftEyeOuter || !rightEyeOuter ||
      !Number.isFinite(leftEyeInner.x) || !Number.isFinite(rightEyeInner.x) ||
      !Number.isFinite(noseTip.x) || !Number.isFinite(leftEyeInner.y) ||
      !Number.isFinite(rightEyeInner.y) || !Number.isFinite(noseTip.y)
    ) {
      return this.baseline ? { ...this.smoothed } : { ...this.smoothed };
    }

    const faceX = (leftEyeInner.x + rightEyeInner.x + noseTip.x) / 3;
    const faceY = (leftEyeInner.y + rightEyeInner.y + noseTip.y) / 3;

    const interOcularDist = Math.hypot(
      rightEyeInner.x - leftEyeInner.x,
      rightEyeInner.y - leftEyeInner.y,
    );
    const eyeWidth = Math.hypot(
      rightEyeOuter.x - leftEyeOuter.x,
      rightEyeOuter.y - leftEyeOuter.y,
    );
    const depthProxy = (interOcularDist + eyeWidth * 0.5) / (this.baseInterOcular * 1.5);

    // Reject this frame entirely if any value is non-finite.
    if (!Number.isFinite(faceX) || !Number.isFinite(faceY) || !Number.isFinite(depthProxy)) {
      return { ...this.smoothed };
    }

    const target = {
      x: Math.max(0.2, Math.min(0.8, faceX)),
      y: Math.max(0.2, Math.min(0.8, faceY)),
      z: Math.max(0.5, Math.min(2.0, depthProxy)),
    };

    const s = this.smoothingFactor;
    this.smoothed.x += s * (target.x - this.smoothed.x);
    this.smoothed.y += s * (target.y - this.smoothed.y);
    this.smoothed.z += s * (target.z - this.smoothed.z);

    // Safety: if NaN somehow got into smoothed, reset to center.
    if (!Number.isFinite(this.smoothed.x) || !Number.isFinite(this.smoothed.y) || !Number.isFinite(this.smoothed.z)) {
      this.smoothed = { x: 0.5, y: 0.5, z: 1 };
      this.baseline = null;
      this.calibrating = false;
      this.calibSamples = [];
      return { ...this.smoothed };
    }

    // Collect calibration samples, then freeze a baseline.
    if (this.calibrating) {
      this.calibSamples.push({ ...this.smoothed });
      if (this.calibSamples.length >= this.calibTarget) {
        const valid = this.calibSamples.filter(
          (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
        );
        if (valid.length === 0) {
          // All samples were bad — try again
          this.calibrating = false;
          this.calibSamples = [];
          return { ...this.smoothed };
        }
        const avg = valid.reduce(
          (a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }),
          { x: 0, y: 0, z: 0 },
        );
        const n = valid.length;
        this.baseline = { x: avg.x / n, y: avg.y / n, z: avg.z / n };
        this.calibrating = false;
      }
    }

    // Report relative to baseline so the scene stays centered.
    if (this.baseline) {
      return {
        x: 0.5 + (this.smoothed.x - this.baseline.x),
        y: 0.5 + (this.smoothed.y - this.baseline.y),
        z: 1 + (this.smoothed.z - this.baseline.z) * 0.5,
      };
    }
    return { ...this.smoothed };
  }

  get(): HeadPose {
    return { ...this.smoothed };
  }

  reset() {
    this.smoothed = { x: 0.5, y: 0.5, z: 1 };
    this.baseline = null;
    this.calibrating = false;
    this.calibSamples = [];
  }
}
