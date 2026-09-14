import * as THREE from 'three';
import type { HeadPose } from './headPose';

export interface Calibration {
  screenWidthCm: number;
  screenHeightCm: number;
  viewingDistanceCm: number;
  /** Amplifies head-pose → eye movement. Desktop ~1.5, phone ~0.6. */
  movementScale?: number;
}

export interface WorldEye {
  x: number;
  y: number;
  z: number;
}

const WORLD_SCALE = 0.01;

export class OffAxisCamera {
  screenW: number;
  screenH: number;
  viewingDistanceCm: number;
  movementScale: number;
  near = 0.05;
  far = 1000;

  constructor(cal: Calibration) {
    this.screenW = cal.screenWidthCm * WORLD_SCALE;
    this.screenH = cal.screenHeightCm * WORLD_SCALE;
    this.viewingDistanceCm = cal.viewingDistanceCm;
    this.movementScale = cal.movementScale ?? 1.5;
  }

  updateCalibration(cal: Calibration) {
    this.screenW = cal.screenWidthCm * WORLD_SCALE;
    this.screenH = cal.screenHeightCm * WORLD_SCALE;
    this.viewingDistanceCm = cal.viewingDistanceCm;
    this.movementScale = cal.movementScale ?? 1.5;
  }

  /** Map normalized face pose → world eye position (screen at z=0) */
  headPoseToWorld(pose: HeadPose, eyeOffsetX = 0): WorldEye {
    const ms = this.movementScale;
    // Clamp pose so the eye can never wander beyond ±40% of the screen half-extent.
    // This prevents the scene from sliding off-screen on phones where the face
    // detection is noisy or the face isn't centered in the front camera.
    const cx = Math.max(-0.4, Math.min(0.4, pose.x - 0.5));
    const cy = Math.max(-0.4, Math.min(0.4, pose.y - 0.5));
    const cz = Math.max(0.6, Math.min(1.8, pose.z));
    const x = -cx * this.screenW * ms + eyeOffsetX;
    const y = -cy * this.screenH * ms;
    const base = this.viewingDistanceCm * WORLD_SCALE;
    const z = base / Math.max(0.4, cz);
    return { x, y, z };
  }

  applyToCamera(camera: THREE.PerspectiveCamera, eye: WorldEye) {
    camera.position.set(eye.x, eye.y, eye.z);
    camera.lookAt(eye.x, eye.y, 0);

    const near = this.near;
    const far = this.far;
    const d = eye.z;
    if (d <= 0) return;

    const scale = near / d;
    const left = (-this.screenW / 2 - eye.x) * scale;
    const right = (this.screenW / 2 - eye.x) * scale;
    const bottom = (-this.screenH / 2 - eye.y) * scale;
    const top = (this.screenH / 2 - eye.y) * scale;

    camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
}
