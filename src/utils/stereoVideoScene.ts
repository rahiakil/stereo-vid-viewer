import * as THREE from 'three';
import { OffAxisCamera, Calibration } from './offAxisCamera';
import type { HeadPose } from './headPose';

export type StereoMode = 'window' | 'sbs' | 'anaglyph';

export class StereoVideoScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraL: THREE.PerspectiveCamera;
  private cameraR: THREE.PerspectiveCamera;
  private offAxis: OffAxisCamera;
  private video: HTMLVideoElement;
  private texture: THREE.VideoTexture;
  private plane: THREE.Mesh;
  private animId = 0;
  private running = false;
  private pose: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private mode: StereoMode = 'sbs';
  private ipdCm = 6.5;
  private depthBehindScreen = 0.35;
  private rtL: THREE.WebGLRenderTarget | null = null;
  private rtR: THREE.WebGLRenderTarget | null = null;
  private anaglyphScene: THREE.Scene | null = null;
  private anaglyphCam: THREE.OrthographicCamera | null = null;
  private anaglyphMat: THREE.ShaderMaterial | null = null;

  constructor(
    private container: HTMLElement,
    videoSrc: string,
    cal: Calibration,
  ) {
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 450;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x0a0e14, 1);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.cameraL = new THREE.PerspectiveCamera(50, w / h, 0.05, 1000);
    this.cameraR = new THREE.PerspectiveCamera(50, w / h, 0.05, 1000);
    this.offAxis = new OffAxisCamera(cal);

    this.video = document.createElement('video');
    this.video.src = videoSrc;
    this.video.crossOrigin = 'anonymous';
    this.video.loop = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';

    this.texture = new THREE.VideoTexture(this.video);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const aspect = 1920 / 824;
    const planeH = cal.screenHeightCm * 0.01 * 0.92;
    const planeW = planeH * aspect;
    const geo = new THREE.PlaneGeometry(planeW, planeH);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture });
    this.plane = new THREE.Mesh(geo, mat);
    this.plane.position.z = -this.depthBehindScreen;
    this.scene.add(this.plane);

    // subtle frame / room cues so parallax is visible
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW * 1.06, planeH * 1.08),
      new THREE.MeshBasicMaterial({ color: 0x1a222c, side: THREE.DoubleSide }),
    );
    frame.position.z = -this.depthBehindScreen - 0.01;
    this.scene.add(frame);

    const light = new THREE.AmbientLight(0xffffff, 1);
    this.scene.add(light);

    this.setupAnaglyph(w, h);
  }

  private setupAnaglyph(w: number, h: number) {
    this.rtL = new THREE.WebGLRenderTarget(w, h);
    this.rtR = new THREE.WebGLRenderTarget(w, h);
    const vs = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
    const fs = `
      uniform sampler2D mapL;
      uniform sampler2D mapR;
      varying vec2 vUv;
      void main() {
        vec4 left = texture2D(mapL, vUv);
        vec4 right = texture2D(mapR, vUv);
        gl_FragColor = vec4(left.r, right.g, right.b, 1.0);
      }
    `;
    this.anaglyphMat = new THREE.ShaderMaterial({
      uniforms: {
        mapL: { value: null },
        mapR: { value: null },
      },
      vertexShader: vs,
      fragmentShader: fs,
    });
    this.anaglyphScene = new THREE.Scene();
    this.anaglyphCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.anaglyphMat);
    this.anaglyphScene.add(quad);
  }

  async play() {
    try {
      await this.video.play();
    } catch (e) {
      console.warn('Autoplay blocked; click Play', e);
    }
  }

  pause() {
    this.video.pause();
  }

  togglePlay() {
    if (this.video.paused) void this.play();
    else this.pause();
  }

  isPaused() {
    return this.video.paused;
  }

  setMode(mode: StereoMode) {
    this.mode = mode;
  }

  setHeadPose(pose: HeadPose | null) {
    if (pose) this.pose = pose;
  }

  setIpdCm(cm: number) {
    this.ipdCm = cm;
  }

  setDepth(meters: number) {
    this.depthBehindScreen = meters;
    this.plane.position.z = -meters;
  }

  updateCalibration(cal: Calibration) {
    this.offAxis.updateCalibration(cal);
  }

  setVideoSrc(src: string) {
    this.video.src = src;
    this.video.load();
    void this.play();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      this.animId = requestAnimationFrame(loop);
      this.renderFrame();
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animId);
  }

  resize() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 450;
    this.renderer.setSize(w, h);
    this.cameraL.aspect = w / h;
    this.cameraR.aspect = w / h;
    this.rtL?.setSize(w, h);
    this.rtR?.setSize(w, h);
  }

  private renderFrame() {
    const ipd = (this.ipdCm * 0.01) / 2;
    const eyeL = this.offAxis.headPoseToWorld(this.pose, -ipd);
    const eyeR = this.offAxis.headPoseToWorld(this.pose, +ipd);
    const eyeC = this.offAxis.headPoseToWorld(this.pose, 0);

    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 450;

    this.renderer.clear();

    if (this.mode === 'window') {
      this.offAxis.applyToCamera(this.cameraL, eyeC);
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.setScissorTest(false);
      this.renderer.render(this.scene, this.cameraL);
      return;
    }

    if (this.mode === 'sbs') {
      this.offAxis.applyToCamera(this.cameraL, eyeL);
      this.offAxis.applyToCamera(this.cameraR, eyeR);
      this.renderer.setScissorTest(true);

      this.renderer.setViewport(0, 0, w / 2, h);
      this.renderer.setScissor(0, 0, w / 2, h);
      this.renderer.render(this.scene, this.cameraL);

      this.renderer.setViewport(w / 2, 0, w / 2, h);
      this.renderer.setScissor(w / 2, 0, w / 2, h);
      this.renderer.render(this.scene, this.cameraR);

      this.renderer.setScissorTest(false);
      return;
    }

    if (!this.rtL || !this.rtR || !this.anaglyphMat || !this.anaglyphScene || !this.anaglyphCam) {
      return;
    }

    this.offAxis.applyToCamera(this.cameraL, eyeL);
    this.offAxis.applyToCamera(this.cameraR, eyeR);

    this.renderer.setRenderTarget(this.rtL);
    this.renderer.clear();
    this.renderer.render(this.scene, this.cameraL);

    this.renderer.setRenderTarget(this.rtR);
    this.renderer.clear();
    this.renderer.render(this.scene, this.cameraR);

    this.anaglyphMat.uniforms.mapL.value = this.rtL.texture;
    this.anaglyphMat.uniforms.mapR.value = this.rtR.texture;

    this.renderer.setRenderTarget(null);
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.render(this.anaglyphScene, this.anaglyphCam);
  }

  dispose() {
    this.stop();
    this.video.pause();
    this.video.src = '';
    this.texture.dispose();
    this.rtL?.dispose();
    this.rtR?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
