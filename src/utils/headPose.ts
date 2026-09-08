export interface HeadPose {
  x: number;
  y: number;
  z: number;
}

/** Same landmark → pose logic as off-axis-sneaker */
export class HeadPoseTracker {
  private smoothed: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private smoothingFactor: number;
  private baseInterOcular = 0.1;

  constructor(smoothingFactor = 0.3) {
    this.smoothingFactor = Math.max(0.1, Math.min(0.9, smoothingFactor));
  }

  updateFromLandmarks(landmarks: Array<{ x: number; y: number; z?: number }>): HeadPose | null {
    if (!landmarks || landmarks.length < 468) return null;

    const leftEyeInner = landmarks[133];
    const rightEyeInner = landmarks[362];
    const noseTip = landmarks[1];
    const leftEyeOuter = landmarks[33];
    const rightEyeOuter = landmarks[263];

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

    const target = {
      x: Math.max(0.2, Math.min(0.8, faceX)),
      y: Math.max(0.2, Math.min(0.8, faceY)),
      z: Math.max(0.5, Math.min(2.0, depthProxy)),
    };

    const s = this.smoothingFactor;
    this.smoothed.x += s * (target.x - this.smoothed.x);
    this.smoothed.y += s * (target.y - this.smoothed.y);
    this.smoothed.z += s * (target.z - this.smoothed.z);
    return { ...this.smoothed };
  }

  get(): HeadPose {
    return { ...this.smoothed };
  }

  reset() {
    this.smoothed = { x: 0.5, y: 0.5, z: 1 };
  }
}
