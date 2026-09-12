import * as THREE from 'three';
import { OffAxisCamera, Calibration } from './offAxisCamera';
import type { HeadPose } from './headPose';

export type StereoMode = 'window' | 'sbs' | 'anaglyph';

/**
 * Sneaker-style portal:
 * - Screen rectangle fixed at z=0 (reference does not slide)
 * - Background video glued to the screen plane
 * - Foreground (near depth) displaced toward the eye → pops OUT of the screen
 *
 * AI that enables the cutout: monocular depth (Depth Anything) or video matting
 * (Robust Video Matting / SAM2). We use depth threshold as the matte.
 */

function makeVideoEl(src: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.src = src;
  v.crossOrigin = 'anonymous';
  v.loop = true;
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  return v;
}

const BG_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Flat on the screen plane — no depth slide
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BG_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform sampler2D depthMap;
  uniform float useDepth;
  uniform float fgThreshold;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(map, vUv);
    // Optional: slightly dim regions that are covered by FG (near)
    float d = texture2D(depthMap, vUv).r;
    float near = useDepth * smoothstep(fgThreshold - 0.05, fgThreshold + 0.05, d);
    color.rgb *= mix(1.0, 0.85, near);
    gl_FragColor = color;
  }
`;

const FG_VERT = /* glsl */ `
  uniform sampler2D depthMap;
  uniform float useDepth;
  uniform float relief;
  uniform float fgThreshold;
  uniform float fgSoftness;
  varying vec2 vUv;
  varying float vMask;
  void main() {
    vUv = uv;
    float d = texture2D(depthMap, uv).r;
    float mask = useDepth * smoothstep(fgThreshold - fgSoftness, fgThreshold + fgSoftness, d);
    vMask = mask;
    vec3 pos = position;
    // Toward camera (+Z): between eye and screen → out-of-screen pop
    pos.z += mask * relief;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FG_FRAG = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying float vMask;
  void main() {
    if (vMask < 0.02) discard;
    vec4 color = texture2D(map, vUv);
    color.a *= vMask;
    gl_FragColor = color;
  }
`;

export class StereoVideoScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraL: THREE.PerspectiveCamera;
  private cameraR: THREE.PerspectiveCamera;
  private offAxis: OffAxisCamera;
  private video: HTMLVideoElement;
  private depthVideo: HTMLVideoElement | null = null;
  private texture: THREE.VideoTexture;
  private depthTexture: THREE.Texture;
  private bgMesh: THREE.Mesh;
  private fgMesh: THREE.Mesh;
  private bgMat: THREE.ShaderMaterial;
  private fgMat: THREE.ShaderMaterial;
  private frameMesh: THREE.Mesh;
  private screenW = 0.34;
  private screenH = 0.19;
  private animId = 0;
  private running = false;
  private pose: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private mode: StereoMode = 'window';
  private ipdCm = 6.5;
  private relief = 0.12; // pop-out distance in meters (toward eye)
  private useDepth = 0;
  private fgThreshold = 0.55;
  private fgSoftness = 0.08;
  private rtL: THREE.WebGLRenderTarget | null = null;
  private rtR: THREE.WebGLRenderTarget | null = null;
  private anaglyphScene: THREE.Scene | null = null;
  private anaglyphCam: THREE.OrthographicCamera | null = null;
  private anaglyphMat: THREE.ShaderMaterial | null = null;
  private cal: Calibration;

  constructor(
    private container: HTMLElement,
    videoSrc: string,
    cal: Calibration,
    depthSrc?: string | null,
  ) {
    this.cal = cal;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 450;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x101820, 1);
    this.renderer.autoClear = false;
    this.renderer.sortObjects = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.cameraL = new THREE.PerspectiveCamera(50, w / h, 0.05, 1000);
    this.cameraR = new THREE.PerspectiveCamera(50, w / h, 0.05, 1000);
    this.offAxis = new OffAxisCamera(cal);

    // Physical screen size in world meters (sneaker calibration)
    this.screenW = cal.screenWidthCm * 0.01;
    this.screenH = cal.screenHeightCm * 0.01;

    this.video = makeVideoEl(videoSrc);
    this.texture = new THREE.VideoTexture(this.video);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const placeholder = new THREE.DataTexture(new Uint8Array([128, 128, 128]), 1, 1);
    placeholder.needsUpdate = true;
    this.depthTexture = placeholder;

    // Content sized to fit inside screen, letterboxed
    const { contentW, contentH } = this.contentSize(16 / 9);

    this.bgMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.texture },
        depthMap: { value: this.depthTexture },
        useDepth: { value: 0 },
        fgThreshold: { value: this.fgThreshold },
      },
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      depthWrite: true,
    });
    this.bgMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(contentW, contentH, 1, 1),
      this.bgMat,
    );
    // Exactly on the screen plane → locked reference (like sneaker portal)
    this.bgMesh.position.z = 0;
    this.bgMesh.renderOrder = 0;
    this.scene.add(this.bgMesh);

    this.fgMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.texture },
        depthMap: { value: this.depthTexture },
        useDepth: { value: 0 },
        relief: { value: this.relief },
        fgThreshold: { value: this.fgThreshold },
        fgSoftness: { value: this.fgSoftness },
      },
      vertexShader: FG_VERT,
      fragmentShader: FG_FRAG,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.fgMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(contentW, contentH, 280, 400),
      this.fgMat,
    );
    this.fgMesh.position.z = 0.001; // tiny bias so it sorts above BG
    this.fgMesh.renderOrder = 2;
    this.scene.add(this.fgMesh);

    // Bezel / screen frame in front of content edges
    this.frameMesh = this.makeBezel(this.screenW, this.screenH);
    this.frameMesh.position.z = 0.002;
    this.frameMesh.renderOrder = 3;
    this.scene.add(this.frameMesh);

    // Dim room behind the portal (sneaker-style depth cue)
    const room = new THREE.Mesh(
      new THREE.PlaneGeometry(this.screenW * 3, this.screenH * 3),
      new THREE.MeshBasicMaterial({ color: 0x0a1018 }),
    );
    room.position.z = -0.4;
    this.scene.add(room);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1));
    this.setupAnaglyph(w, h);

    this.video.addEventListener('loadedmetadata', () => {
      const vw = this.video.videoWidth || 1;
      const vh = this.video.videoHeight || 1;
      const { contentW: cw, contentH: ch } = this.contentSize(vw / vh);
      this.bgMesh.geometry.dispose();
      this.bgMesh.geometry = new THREE.PlaneGeometry(cw, ch, 1, 1);
      this.fgMesh.geometry.dispose();
      this.fgMesh.geometry = new THREE.PlaneGeometry(cw, ch, 280, 400);
    });

    if (depthSrc) void this.loadDepthVideo(depthSrc);
  }

  private contentSize(aspect: number): { contentW: number; contentH: number } {
    // Fit video inside physical screen rectangle
    const screenAspect = this.screenW / this.screenH;
    if (aspect > screenAspect) {
      return { contentW: this.screenW * 0.98, contentH: (this.screenW * 0.98) / aspect };
    }
    return { contentH: this.screenH * 0.98, contentW: this.screenH * 0.98 * aspect };
  }

  private makeBezel(w: number, h: number): THREE.Mesh {
    const shape = new THREE.Shape();
    const outer = 1.0;
    const inner = 0.96;
    shape.moveTo((-w / 2) * outer, (-h / 2) * outer);
    shape.lineTo((w / 2) * outer, (-h / 2) * outer);
    shape.lineTo((w / 2) * outer, (h / 2) * outer);
    shape.lineTo((-w / 2) * outer, (h / 2) * outer);
    shape.lineTo((-w / 2) * outer, (-h / 2) * outer);
    const hole = new THREE.Path();
    hole.moveTo((-w / 2) * inner, (-h / 2) * inner);
    hole.lineTo((-w / 2) * inner, (h / 2) * inner);
    hole.lineTo((w / 2) * inner, (h / 2) * inner);
    hole.lineTo((w / 2) * inner, (-h / 2) * inner);
    hole.lineTo((-w / 2) * inner, (-h / 2) * inner);
    shape.holes.push(hole);
    const geo = new THREE.ShapeGeometry(shape);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a222c, side: THREE.DoubleSide }));
  }

  async loadDepthVideo(src: string): Promise<boolean> {
    try {
      const res = await fetch(src, { method: 'HEAD' });
      if (!res.ok) return false;
    } catch {
      return false;
    }

    if (this.depthVideo) {
      this.depthVideo.pause();
      this.depthVideo.src = '';
    }

    this.depthVideo = makeVideoEl(src);
    const dt = new THREE.VideoTexture(this.depthVideo);
    dt.minFilter = THREE.LinearFilter;
    dt.magFilter = THREE.LinearFilter;
    this.depthTexture = dt;
    this.bgMat.uniforms.depthMap.value = dt;
    this.fgMat.uniforms.depthMap.value = dt;
    this.useDepth = 1;
    this.bgMat.uniforms.useDepth.value = 1;
    this.fgMat.uniforms.useDepth.value = 1;

    this.depthVideo.addEventListener('loadedmetadata', () => {
      if (this.depthVideo && !this.video.paused) {
        this.depthVideo.currentTime = this.video.currentTime;
        void this.depthVideo.play().catch(() => undefined);
      }
    });
    return true;
  }

  private setupAnaglyph(w: number, h: number) {
    this.rtL = new THREE.WebGLRenderTarget(w, h);
    this.rtR = new THREE.WebGLRenderTarget(w, h);
    this.anaglyphMat = new THREE.ShaderMaterial({
      uniforms: { mapL: { value: null }, mapR: { value: null } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D mapL;
        uniform sampler2D mapR;
        varying vec2 vUv;
        void main() {
          vec4 left = texture2D(mapL, vUv);
          vec4 right = texture2D(mapR, vUv);
          gl_FragColor = vec4(left.r, right.g, right.b, 1.0);
        }`,
    });
    this.anaglyphScene = new THREE.Scene();
    this.anaglyphCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.anaglyphScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.anaglyphMat));
  }

  private syncDepthClock() {
    if (!this.depthVideo || !this.useDepth) return;
    if (Math.abs(this.depthVideo.currentTime - this.video.currentTime) > 0.08) {
      this.depthVideo.currentTime = this.video.currentTime;
    }
    if (this.video.paused && !this.depthVideo.paused) this.depthVideo.pause();
    if (!this.video.paused && this.depthVideo.paused) {
      void this.depthVideo.play().catch(() => undefined);
    }
  }

  async play() {
    try {
      await this.video.play();
      if (this.depthVideo) {
        this.depthVideo.currentTime = this.video.currentTime;
        await this.depthVideo.play();
      }
    } catch (e) {
      console.warn('Autoplay blocked; click Play', e);
    }
  }

  pause() {
    this.video.pause();
    this.depthVideo?.pause();
  }

  togglePlay() {
    if (this.video.paused) void this.play();
    else this.pause();
  }

  isPaused() {
    return this.video.paused;
  }

  hasDepth() {
    return this.useDepth > 0;
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

  /** Kept for UI compat — portal locks content to screen; this is unused for slide. */
  setDepth(_meters: number) {
    /* no-op: sneaker portal keeps BG at z=0 */
  }

  setRelief(meters: number) {
    this.relief = meters;
    this.fgMat.uniforms.relief.value = meters;
  }

  setFgThreshold(t: number) {
    this.fgThreshold = t;
    this.fgMat.uniforms.fgThreshold.value = t;
    this.bgMat.uniforms.fgThreshold.value = t;
  }

  setFgSoftness(s: number) {
    this.fgSoftness = s;
    this.fgMat.uniforms.fgSoftness.value = s;
  }

  updateCalibration(cal: Calibration) {
    this.cal = cal;
    this.offAxis.updateCalibration(cal);
    this.screenW = cal.screenWidthCm * 0.01;
    this.screenH = cal.screenHeightCm * 0.01;
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
      this.syncDepthClock();
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
    this.depthVideo?.pause();
    if (this.depthVideo) this.depthVideo.src = '';
    this.texture.dispose();
    this.bgMat.dispose();
    this.fgMat.dispose();
    this.rtL?.dispose();
    this.rtR?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.parentElement?.removeChild(this.renderer.domElement);
  }
}
