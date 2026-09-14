import * as THREE from 'three';
import { OffAxisCamera, Calibration } from './offAxisCamera';
import type { HeadPose } from './headPose';

export type DepthMeshStats = {
  phase: string;
  detail: string;
  streamsReady: number;
  streamsTotal: number;
  bgLabel: string;
  bgBytes: number | null;
  elapsedMs: number;
};

/**
 * Browser-assembled depth-mesh player.
 *
 * Instead of downloading one GLB per frame (~414 MB), the browser receives four
 * synchronized video streams and assembles the 3D surface at runtime:
 *
 *   RGB video   → foreground texture
 *   depth video  → displaces a reusable grid mesh
 *   matte video  → clean FG/BG cutout (no depth-threshold dust)
 *   bg_clean MP4 → AI-inpainted aisle on the screen plane (no duplicate characters)
 *
 * Head tracking via MediaPipe drives an off-axis camera, like the sneaker.
 */
export class DepthMeshScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private offAxis: OffAxisCamera;
  private fgVideo: HTMLVideoElement;
  private depthVideo: HTMLVideoElement;
  private matteVideo: HTMLVideoElement;
  private bgVideo: HTMLVideoElement | null = null;
  private fgTexture: THREE.VideoTexture;
  private depthTexture: THREE.VideoTexture;
  private matteTexture: THREE.VideoTexture;
  private bgTexture: THREE.VideoTexture | null = null;
  private fgMesh: THREE.Mesh;
  private bgMesh: THREE.Mesh;
  private fgMat: THREE.ShaderMaterial;
  private bgMat: THREE.MeshBasicMaterial;
  private roomObjects: THREE.Object3D[] = [];
  private animId = 0;
  private running = false;
  private pose: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private playing = true;
  private relief = 0.14;
  private alphaCut = 0.35;
  private status: (msg: string) => void;
  private onStats: ((s: DepthMeshStats) => void) | null;
  private screenW: number;
  private screenH: number;
  private streamsReady = 0;
  private streamsTotal = 4;
  private loadStartedMs = 0;
  private phase = 'idle';
  private bgLabel = 'none';
  private bgBytes: number | null = null;

  constructor(
    private container: HTMLElement,
    fgSrc: string,
    depthSrc: string,
    matteSrc: string,
    bgSrc: string | null,
    cal: Calibration,
    onStatus?: (msg: string) => void,
    onStats?: (s: DepthMeshStats) => void,
    private gridCols = 200,
    private gridRows = 320,
  ) {
    this.status = onStatus ?? (() => undefined);
    this.onStats = onStats ?? null;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 450;

    this.screenW = cal.screenWidthCm * 0.01;
    this.screenH = cal.screenHeightCm * 0.01;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x1a1a1a, 1);
    container.appendChild(this.renderer.domElement);

    // Capture WebGL context loss (phones kill contexts under memory pressure)
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.running = false;
      this.status('⚠ WebGL context lost — GPU memory pressure or too many streams');
      this.onStats?.({ phase: 'context-lost', detail: 'webglcontextlost', streamsReady: this.streamsReady, streamsTotal: this.streamsTotal, bgLabel: this.bgLabel, bgBytes: this.bgBytes, elapsedMs: performance.now() - this.loadStartedMs });
    }, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.05, 1000);
    this.offAxis = new OffAxisCamera(cal);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1));

    // Four synchronized video elements
    this.fgVideo = makeVideoEl(fgSrc);
    this.depthVideo = makeVideoEl(depthSrc);
    this.matteVideo = makeVideoEl(matteSrc);
    if (bgSrc) this.bgVideo = makeVideoEl(bgSrc);

    // Log video errors (decode failures, 404s, format issues)
    const onVidErr = (label: string, v: HTMLVideoElement) => {
      v.addEventListener('error', () => {
        const code = v.error?.code;
        const msg = v.error?.message ?? '';
        this.status(`⚠ ${label} video error: code=${code} ${msg}`);
      }, false);
      v.addEventListener('stalled', () => {
        this.status(`⚠ ${label} video stalled (network slow?)`);
      }, false);
      v.addEventListener('abort', () => {
        this.status(`⚠ ${label} video aborted`);
      }, false);
    };
    onVidErr('RGB', this.fgVideo);
    onVidErr('depth', this.depthVideo);
    onVidErr('matte', this.matteVideo);
    if (this.bgVideo) onVidErr('bg_clean', this.bgVideo);

    // Log when videos actually start playing or pause
    const onVidPlay = (label: string, v: HTMLVideoElement) => {
      v.addEventListener('playing', () => this.status(`▶ ${label} playing`), { once: true });
      v.addEventListener('pause', () => this.status(`⏸ ${label} paused`));
    };
    onVidPlay('RGB', this.fgVideo);
    onVidPlay('depth', this.depthVideo);
    onVidPlay('matte', this.matteVideo);
    if (this.bgVideo) onVidPlay('bg_clean', this.bgVideo);

    this.fgTexture = new THREE.VideoTexture(this.fgVideo);
    this.fgTexture.colorSpace = THREE.SRGBColorSpace;
    this.fgTexture.minFilter = THREE.LinearFilter;
    this.fgTexture.magFilter = THREE.LinearFilter;

    this.depthTexture = new THREE.VideoTexture(this.depthVideo);
    this.depthTexture.minFilter = THREE.LinearFilter;
    this.depthTexture.magFilter = THREE.LinearFilter;

    this.matteTexture = new THREE.VideoTexture(this.matteVideo);
    this.matteTexture.minFilter = THREE.LinearFilter;
    this.matteTexture.magFilter = THREE.LinearFilter;

    if (this.bgVideo) {
      this.bgTexture = new THREE.VideoTexture(this.bgVideo);
      this.bgTexture.colorSpace = THREE.SRGBColorSpace;
      this.bgTexture.minFilter = THREE.LinearFilter;
      this.bgTexture.magFilter = THREE.LinearFilter;
    }

    // Reusable grid mesh — ONE geometry for the whole clip, displaced per-frame in shader
    const { contentW, contentH } = this.contentSize(9 / 16);

    // Foreground: depth-displaced, matte-cut, RGB-textured
    this.fgMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.fgTexture },
        depthMap: { value: this.depthTexture },
        matteMap: { value: this.matteTexture },
        relief: { value: this.relief },
        alphaCut: { value: this.alphaCut },
        cameraZ: { value: 0.25 },
        nearPlane: { value: 0.05 },
      },
      vertexShader: FG_VERT,
      fragmentShader: FG_FRAG,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.fgMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(contentW, contentH, gridCols, gridRows),
      this.fgMat,
    );
    this.fgMesh.position.z = 0.04; // pop forward of screen plane
    this.fgMesh.renderOrder = 2;
    this.scene.add(this.fgMesh);

    // Background: AI-cleaned aisle locked on the screen plane
    this.bgMat = new THREE.MeshBasicMaterial({
      map: this.bgTexture ?? this.fgTexture,
    });
    this.bgMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(contentW, contentH),
      this.bgMat,
    );
    this.bgMesh.position.z = -0.01;
    this.bgMesh.renderOrder = 0;
    this.scene.add(this.bgMesh);

    this.createWireframeRoom();

    // Correct content size once metadata arrives
    const onMeta = (v: HTMLVideoElement) => {
      if (v.videoWidth && v.videoHeight) {
        const aspect = v.videoWidth / v.videoHeight;
        const { contentW: cw, contentH: ch } = this.contentSize(aspect);
        this.fgMesh.geometry.dispose();
        this.fgMesh.geometry = new THREE.PlaneGeometry(cw, ch, gridCols, gridRows);
        this.bgMesh.geometry.dispose();
        this.bgMesh.geometry = new THREE.PlaneGeometry(cw, ch);
      }
    };
    this.fgVideo.addEventListener('loadedmetadata', () => onMeta(this.fgVideo));

    // Stream readiness
    const markReady = () => {
      this.streamsReady++;
      this.emitStats(`stream ready (${this.streamsReady}/${this.streamsTotal})`);
      if (this.streamsReady >= this.streamsTotal) {
        this.phase = 'ready';
        this.status(`Ready · browser-assembled mesh · ${this.streamsReady} streams`);
        this.emitStats('all streams ready — playing');
        void this.playAll();
      }
    };
    this.fgVideo.addEventListener('canplaythrough', markReady, { once: true });
    this.depthVideo.addEventListener('canplaythrough', markReady, { once: true });
    this.matteVideo.addEventListener('canplaythrough', markReady, { once: true });
    if (this.bgVideo) {
      this.bgVideo.addEventListener('canplaythrough', markReady, { once: true });
    } else {
      // No BG stream — still count it as "ready" (uses FG texture as fallback)
      this.streamsTotal = 3;
    }

    // BG label + size
    if (bgSrc) {
      this.bgLabel = bgSrc.includes('bg_clean') ? 'AI-cleaned aisle MP4' : 'original RGB MP4';
      void fetch(bgSrc, { method: 'HEAD' })
        .then((r) => {
          const len = r.headers.get('content-length');
          if (len) this.bgBytes = Number(len);
          this.emitStats('BG HEAD');
        })
        .catch(() => undefined);
    }

    void this.playAll();
  }

  private emitStats(detail: string) {
    this.onStats?.({
      phase: this.phase,
      detail,
      streamsReady: this.streamsReady,
      streamsTotal: this.streamsTotal,
      bgLabel: this.bgLabel,
      bgBytes: this.bgBytes,
      elapsedMs: this.loadStartedMs ? performance.now() - this.loadStartedMs : 0,
    });
  }

  private contentSize(aspect: number) {
    const screenAspect = this.screenW / this.screenH;
    if (aspect > screenAspect) {
      return { contentW: this.screenW * 0.98, contentH: (this.screenW * 0.98) / aspect };
    }
    return { contentH: this.screenH * 0.98, contentW: this.screenH * 0.98 * aspect };
  }

  private createWireframeRoom() {
    const roomWidth = this.screenW;
    const roomHeight = this.screenH;
    const roomDepth = 0.35;
    const gridDivisions = 8;
    const wallMaterial = new THREE.LineBasicMaterial({
      color: 0xff8c00,
      transparent: true,
      opacity: 0.7,
    });

    const createGridWall = (width: number, height: number): THREE.LineSegments => {
      const vertices: number[] = [];
      for (let i = 0; i <= gridDivisions; i++) {
        const t = i / gridDivisions;
        vertices.push(-width / 2 + t * width, -height / 2, 0, -width / 2 + t * width, height / 2, 0);
        vertices.push(-width / 2, -height / 2 + t * height, 0, width / 2, -height / 2 + t * height, 0);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      return new THREE.LineSegments(geometry, wallMaterial);
    };

    const backWall = createGridWall(roomWidth, roomHeight);
    backWall.position.z = -roomDepth;
    this.scene.add(backWall);
    this.roomObjects.push(backWall);

    const leftWall = createGridWall(roomDepth, roomHeight);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-roomWidth / 2, 0, -roomDepth / 2);
    this.scene.add(leftWall);
    this.roomObjects.push(leftWall);

    const rightWall = createGridWall(roomDepth, roomHeight);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(roomWidth / 2, 0, -roomDepth / 2);
    this.scene.add(rightWall);
    this.roomObjects.push(rightWall);

    const screenFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(roomWidth, roomHeight)),
      new THREE.LineBasicMaterial({ color: 0xff3333 }),
    );
    screenFrame.position.z = 0.001;
    this.scene.add(screenFrame);
    this.roomObjects.push(screenFrame);
  }

  setHeadPose(pose: HeadPose | null) {
    if (pose && Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.z)) {
      this.pose = pose;
    }
  }

  setRelief(r: number) {
    this.relief = r;
    this.fgMat.uniforms.relief.value = r;
  }

  setAlphaCut(a: number) {
    this.alphaCut = a;
    this.fgMat.uniforms.alphaCut.value = a;
  }

  togglePlay() {
    this.playing = !this.playing;
    this.syncPlay();
  }

  isPaused() {
    return !this.playing;
  }

  private async playAll() {
    try {
      await Promise.all([
        this.fgVideo.play(),
        this.depthVideo.play(),
        this.matteVideo.play(),
        this.bgVideo?.play(),
      ]);
      this.status('▶ all videos playing');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status(`⚠ video play() rejected: ${msg}`);
    }
  }

  private syncPlay() {
    if (this.playing) {
      void this.fgVideo.play();
      void this.depthVideo.play();
      void this.matteVideo.play();
      void this.bgVideo?.play();
    } else {
      this.fgVideo.pause();
      this.depthVideo.pause();
      this.matteVideo.pause();
      this.bgVideo?.pause();
    }
  }

  start() {
    if (this.running) return;
    this.loadStartedMs = performance.now();
    this.phase = 'loading streams';
    this.status('Loading streams…');
    this.emitStats('fetching 4 video streams');
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.animId = requestAnimationFrame(tick);
      this.render();
    };
    tick();
  }

  private render() {
    // Keep streams synchronized to FG clock
    const t = this.fgVideo.currentTime;
    if (Math.abs(this.depthVideo.currentTime - t) > 0.05) this.depthVideo.currentTime = t;
    if (Math.abs(this.matteVideo.currentTime - t) > 0.05) this.matteVideo.currentTime = t;
    if (this.bgVideo && Math.abs(this.bgVideo.currentTime - t) > 0.05) this.bgVideo.currentTime = t;

    const eye = this.offAxis.headPoseToWorld(this.pose, 0);
    this.offAxis.applyToCamera(this.camera, eye);
    // Update the shader's camera distance so vertex displacement can be clamped
    this.fgMat.uniforms.cameraZ.value = eye.z;
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 450;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.animId);
    for (const obj of this.roomObjects) {
      this.scene.remove(obj);
      if (obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    }
    this.fgMesh.geometry.dispose();
    this.fgMat.dispose();
    this.bgMesh.geometry.dispose();
    this.bgMat.dispose();
    this.fgTexture.dispose();
    this.depthTexture.dispose();
    this.matteTexture.dispose();
    this.bgTexture?.dispose();
    for (const v of [this.fgVideo, this.depthVideo, this.matteVideo, this.bgVideo]) {
      v?.pause();
      if (v) v.src = '';
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

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

const FG_VERT = /* glsl */ `
  uniform sampler2D depthMap;
  uniform float relief;
  uniform float cameraZ;
  uniform float nearPlane;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    float d = texture2D(depthMap, uv).r;
    vDepth = d;
    vec3 pos = position;
    // Bright = near → toward camera (+Z).
    // Clamp so the vertex never passes the near plane (would be clipped → scene vanishes).
    float maxDisp = cameraZ - nearPlane - 0.01;
    pos.z += min(d * relief, maxDisp);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FG_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform sampler2D matteMap;
  uniform float alphaCut;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    float matte = texture2D(matteMap, vUv).r;
    if (matte < alphaCut) discard;
    vec4 color = texture2D(map, vUv);
    color.a = smoothstep(alphaCut - 0.08, alphaCut + 0.08, matte);
    gl_FragColor = color;
  }
`;
