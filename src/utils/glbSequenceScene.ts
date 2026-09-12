import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OffAxisCamera, Calibration } from './offAxisCamera';
import type { HeadPose } from './headPose';

export type SequenceMeta = {
  fps: number;
  files: string[];
  every?: number;
};

/**
 * Sneaker-parity player: real GLB meshes + wireframe room + off-axis head camera.
 * Streams a small ring of frames (does not keep all 440 in GPU memory).
 * Optional background video sits on the screen plane so the aisle returns while
 * matted characters pop forward.
 */
export class GlbSequenceScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private offAxis: OffAxisCamera;
  private loader = new GLTFLoader();
  private files: string[] = [];
  private cache = new Map<number, THREE.Object3D>();
  private inflight = new Map<number, Promise<THREE.Object3D | null>>();
  private currentIdx = -1;
  private currentObj: THREE.Object3D | null = null;
  private animId = 0;
  private running = false;
  private pose: HeadPose = { x: 0.5, y: 0.5, z: 1 };
  private roomObjects: THREE.Object3D[] = [];
  private playing = true;
  private startMs = 0;
  private pauseAccumMs = 0;
  private pauseAtMs = 0;
  private fps = 30;
  private modelRoot = new THREE.Group();
  private status: (msg: string) => void;
  private prefetchAhead = 10;
  private maxCache = 24;
  private base = '';
  private bgVideo: HTMLVideoElement | null = null;
  private bgTexture: THREE.VideoTexture | null = null;
  private bgMesh: THREE.Mesh | null = null;

  constructor(
    private container: HTMLElement,
    private baseUrl: string,
    cal: Calibration,
    onStatus?: (msg: string) => void,
    bgVideoSrc?: string | null,
  ) {
    this.status = onStatus ?? (() => undefined);
    this.base = baseUrl.replace(/\/$/, '');
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 450;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x1a1a1a, 1);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.05, 1000);
    this.offAxis = new OffAxisCamera(cal);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.85);
    d1.position.set(1, 1, 1);
    this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.45);
    d2.position.set(-1, -0.5, 0.6);
    this.scene.add(d2);

    if (bgVideoSrc) this.setupBackgroundVideo(bgVideoSrc);

    // Characters slightly in front of the screen plane / BG
    this.modelRoot.position.set(0, -0.02, 0.04);
    this.scene.add(this.modelRoot);
    this.createWireframeRoom();
  }

  private setupBackgroundVideo(src: string) {
    const v = document.createElement('video');
    v.src = src;
    v.crossOrigin = 'anonymous';
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    this.bgVideo = v;

    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    this.bgTexture = tex;

    const screenW = this.offAxis.screenW;
    const screenH = this.offAxis.screenH;
    // Placeholder size; corrected on metadata
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(screenW * 0.98, screenH * 0.98),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    mesh.position.z = -0.01; // locked on/behind screen plane
    mesh.renderOrder = 0;
    this.bgMesh = mesh;
    this.scene.add(mesh);

    v.addEventListener('loadedmetadata', () => {
      const aspect = (v.videoWidth || 9) / (v.videoHeight || 16);
      const screenAspect = screenW / screenH;
      let cw: number;
      let ch: number;
      if (aspect > screenAspect) {
        cw = screenW * 0.98;
        ch = cw / aspect;
      } else {
        ch = screenH * 0.98;
        cw = ch * aspect;
      }
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(cw, ch);
    });
    void v.play().catch(() => undefined);
  }

  async loadSequence(): Promise<void> {
    this.status('Loading sequence…');
    const meta = (await fetch(`${this.base}/sequence.json`).then((r) => r.json())) as SequenceMeta;
    this.fps = meta.fps || 30;
    this.files = meta.files || [];
    if (!this.files.length) throw new Error('No frames in sequence.json');

    this.status(`Warming first frames… 0/${Math.min(20, this.files.length)}`);
    for (let i = 0; i < Math.min(20, this.files.length); i++) {
      await this.ensureFrame(i);
      if (i % 4 === 0) this.status(`Warming first frames… ${i + 1}/20`);
    }
    this.status(`Ready · ${this.files.length} frames @ ${this.fps.toFixed(0)}fps (streaming)`);
    this.showFrame(0);
    this.startMs = performance.now();
    if (this.bgVideo) {
      this.bgVideo.currentTime = 0;
      void this.bgVideo.play().catch(() => undefined);
    }
  }

  private frameUrl(i: number) {
    return `${this.base}/${this.files[i]}`;
  }

  private disposeObject(obj: THREE.Object3D) {
    obj.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else (m as THREE.Material)?.dispose();
      }
    });
  }

  private async ensureFrame(i: number): Promise<THREE.Object3D | null> {
    if (this.cache.has(i)) return this.cache.get(i)!;
    if (this.inflight.has(i)) return this.inflight.get(i)!;

    const p = (async () => {
      try {
        const gltf = await this.loader.loadAsync(this.frameUrl(i));
        gltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            const prev = mesh.material as THREE.MeshStandardMaterial;
            const map = prev?.map ?? null;
            if (map) {
              map.colorSpace = THREE.SRGBColorSpace;
              map.needsUpdate = true;
            }
            // Basic + texture = crisp (no muddy lighting on video bake)
            mesh.material = new THREE.MeshBasicMaterial({
              map,
              vertexColors: !map,
              transparent: true,
              alphaTest: 0.35,
              side: THREE.DoubleSide,
            });
            mesh.frustumCulled = false;
          }
        });
        gltf.scene.visible = false;
        this.modelRoot.add(gltf.scene);
        this.cache.set(i, gltf.scene);
        this.trimCache(i);
        return gltf.scene;
      } catch (e) {
        console.warn('GLB load failed', this.frameUrl(i), e);
        return null;
      } finally {
        this.inflight.delete(i);
      }
    })();

    this.inflight.set(i, p);
    return p;
  }

  private trimCache(keepAround: number) {
    if (this.cache.size <= this.maxCache) return;
    const keys = [...this.cache.keys()].sort(
      (a, b) => Math.abs(a - keepAround) - Math.abs(b - keepAround),
    );
    for (let i = this.maxCache; i < keys.length; i++) {
      const k = keys[i];
      if (k === this.currentIdx) continue;
      const obj = this.cache.get(k);
      if (!obj) continue;
      this.modelRoot.remove(obj);
      this.disposeObject(obj);
      this.cache.delete(k);
    }
  }

  private prefetchAround(idx: number) {
    for (let d = 1; d <= this.prefetchAhead; d++) {
      const n = this.files.length;
      void this.ensureFrame((idx + d) % n);
    }
  }

  private createWireframeRoom() {
    for (const obj of this.roomObjects) {
      this.scene.remove(obj);
      if (obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    }
    this.roomObjects = [];

    const roomWidth = this.offAxis.screenW;
    const roomHeight = this.offAxis.screenH;
    const roomDepth = 0.35;
    const gridDivisions = 8;
    const wallMaterial = new THREE.LineBasicMaterial({
      color: 0xff8c00,
      transparent: true,
      opacity: 0.8,
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

    const floor = createGridWall(roomWidth, roomDepth);
    floor.rotation.x = Math.PI / 2;
    floor.position.set(0, -roomHeight / 2, -roomDepth / 2);
    this.scene.add(floor);
    this.roomObjects.push(floor);

    const ceiling = createGridWall(roomWidth, roomDepth);
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.set(0, roomHeight / 2, -roomDepth / 2);
    this.scene.add(ceiling);
    this.roomObjects.push(ceiling);

    const screenFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(roomWidth, roomHeight)),
      new THREE.LineBasicMaterial({ color: 0xff3333 }),
    );
    screenFrame.position.z = 0.001;
    this.scene.add(screenFrame);
    this.roomObjects.push(screenFrame);
  }

  private showFrame(idx: number) {
    if (idx === this.currentIdx) return;
    const next = this.cache.get(idx);
    if (!next) {
      void this.ensureFrame(idx);
      return;
    }
    if (this.currentObj) this.currentObj.visible = false;
    this.currentIdx = idx;
    this.currentObj = next;
    next.visible = true;
    this.prefetchAround(idx);
  }

  setHeadPose(pose: HeadPose | null) {
    if (pose) this.pose = pose;
  }

  togglePlay() {
    if (this.playing) {
      this.playing = false;
      this.pauseAtMs = performance.now();
      this.bgVideo?.pause();
    } else {
      this.playing = true;
      this.pauseAccumMs += performance.now() - this.pauseAtMs;
      void this.bgVideo?.play().catch(() => undefined);
    }
  }

  isPaused() {
    return !this.playing;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.animId = requestAnimationFrame(tick);
      this.render();
    };
    tick();
  }

  private elapsedSec() {
    // Prefer background video clock so aisle + characters stay locked
    if (this.bgVideo && this.bgVideo.readyState >= 2 && this.bgVideo.duration) {
      return this.bgVideo.currentTime;
    }
    const now = this.playing ? performance.now() : this.pauseAtMs;
    return Math.max(0, (now - this.startMs - this.pauseAccumMs) / 1000);
  }

  private render() {
    const n = this.files.length;
    const t = this.elapsedSec();
    if (n > 0) {
      const idx = Math.floor(t * this.fps) % n;
      this.showFrame(idx);
    }

    if (this.playing && this.bgVideo?.paused) void this.bgVideo.play().catch(() => undefined);

    const eye = this.offAxis.headPoseToWorld(this.pose, 0);
    this.offAxis.applyToCamera(this.camera, eye);
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
    for (const obj of this.cache.values()) {
      this.modelRoot.remove(obj);
      this.disposeObject(obj);
    }
    this.cache.clear();
    if (this.bgMesh) {
      this.scene.remove(this.bgMesh);
      this.bgMesh.geometry.dispose();
      (this.bgMesh.material as THREE.Material).dispose();
      this.bgMesh = null;
    }
    this.bgTexture?.dispose();
    this.bgTexture = null;
    if (this.bgVideo) {
      this.bgVideo.pause();
      this.bgVideo.src = '';
      this.bgVideo = null;
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
