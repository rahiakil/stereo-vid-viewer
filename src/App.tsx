import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Play, Pause, Upload } from 'lucide-react';
import FaceTracker from './components/FaceTracker';
import MultiViewPlayer from './components/MultiViewPlayer';
import SneakerDemo from './components/SneakerDemo';
import { HeadPose } from './utils/headPose';
import { StereoVideoScene, StereoMode } from './utils/stereoVideoScene';

const DEFAULT_VIDEO = '/media/vid-labu1.mp4';
const DEFAULT_DEPTH = '/media/vid-labu1_depth.mp4';

const DEFAULT_CAL = {
  screenWidthCm: 34,
  screenHeightCm: 19,
  viewingDistanceCm: 60,
};

type AppMode = 'sneaker' | 'explain' | 'multiview' | 'portal';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('sneaker');
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<StereoVideoScene | null>(null);
  const [mode, setMode] = useState<StereoMode>('window');
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [ipd, setIpd] = useState(6.5);
  const [relief, setRelief] = useState(0.14);
  const [fgThreshold, setFgThreshold] = useState(0.55);
  const [poseLabel, setPoseLabel] = useState('—');
  const [videoLabel, setVideoLabel] = useState('vid-labu1.mp4');
  const [depthStatus, setDepthStatus] = useState('checking depth…');

  useEffect(() => {
    if (appMode !== 'portal' || !mountRef.current) return;
    const scene = new StereoVideoScene(mountRef.current, DEFAULT_VIDEO, DEFAULT_CAL, null);
    sceneRef.current = scene;
    scene.setMode(mode);
    scene.setRelief(relief);
    scene.setFgThreshold(fgThreshold);
    scene.start();
    void scene.play().then(() => setPlaying(!scene.isPaused()));
    void (async () => {
      const ok = await scene.loadDepthVideo(DEFAULT_DEPTH);
      setDepthStatus(ok ? 'depth loaded' : 'no depth');
    })();
    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode]);

  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);
  useEffect(() => {
    sceneRef.current?.setIpdCm(ipd);
  }, [ipd]);
  useEffect(() => {
    sceneRef.current?.setRelief(relief);
  }, [relief]);
  useEffect(() => {
    sceneRef.current?.setFgThreshold(fgThreshold);
  }, [fgThreshold]);

  const onHeadPose = useCallback((pose: HeadPose | null) => {
    sceneRef.current?.setHeadPose(pose);
    if (pose) setPoseLabel(`x ${pose.x.toFixed(2)}  y ${pose.y.toFixed(2)}  z ${pose.z.toFixed(2)}`);
    else setPoseLabel('no face');
  }, []);

  const togglePlay = () => {
    const s = sceneRef.current;
    if (!s) return;
    s.togglePlay();
    setPlaying(!s.isPaused());
  };

  const toggleFs = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      setFullscreen(true);
    } else {
      await document.exitFullscreen();
      setFullscreen(false);
    }
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    sceneRef.current?.setVideoSrc(URL.createObjectURL(file));
    setVideoLabel(file.name);
    setPlaying(true);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0e14',
        color: '#e8eef4',
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #2a3848',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontWeight: 650, fontSize: 16 }}>Labubu · Free viewpoint</div>
          <div style={{ fontSize: 12, color: '#8fa3b8' }}>{videoLabel}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(
            [
              ['sneaker', 'Sneaker demo'],
              ['explain', 'What sneaker does'],
              ['multiview', 'Extra viewpoints'],
              ['portal', 'Portal (old)'],
            ] as [AppMode, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAppMode(id)}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #2a3848',
                background: appMode === id ? '#5b9fd4' : '#1c2836',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {label}
            </button>
          ))}
          <button type="button" onClick={toggleFs} style={btnStyle}>
            {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </div>
      </header>

      {appMode === 'sneaker' && (
        <div style={{ flex: 1, minHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
          <SneakerDemo />
        </div>
      )}

      {appMode === 'explain' && (
        <div style={{ padding: 24, maxWidth: 720, lineHeight: 1.55, color: '#c5d0dc' }}>
          <h2 style={{ color: '#fff', marginTop: 0 }}>What the sneaker demo actually does</h2>
          <p>
            <strong style={{ color: '#fff' }}>Not a flat video.</strong> The original sneaker loads a
            real 3D model (<code>shoe.glb</code>). Your webcam tracks your head; an{' '}
            <strong style={{ color: '#fff' }}>off-axis camera</strong> shows different sides — like
            looking through a window at a physical object.
          </p>
          <h3 style={{ color: '#fff' }}>This Labubu demo</h3>
          <p>
            Open <strong style={{ color: '#fff' }}>Sneaker demo</strong>: we turn every frame into a
            real textured mesh (depth → GLB), drop the background, and play that mesh sequence in the
            same wireframe room + head tracking as the shoe. First load preloads frames into memory;
            then move your head.
          </p>
          <p>
            Still not a full 4D Gaussian reconstruction (hours of training / multi-view capture). For
            impressing people with monocular video, this is the honest sneaker-equivalent path.
          </p>
        </div>
      )}

      {appMode === 'multiview' && (
        <div style={{ flex: 1, minHeight: '70vh' }}>
          <MultiViewPlayer />
        </div>
      )}

      {appMode === 'portal' && (
        <div style={{ flex: 1, position: 'relative', minHeight: '60vh' }}>
          <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
          <div
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              width: 240,
              height: 180,
              borderRadius: 10,
              overflow: 'hidden',
              border: '2px solid #fff',
              zIndex: 5,
            }}
          >
            <FaceTracker onHeadPose={onHeadPose} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: 12,
              bottom: 12,
              zIndex: 5,
              background: 'rgba(0,0,0,0.65)',
              borderRadius: 10,
              padding: 12,
              width: 280,
              fontSize: 12,
              border: '1px solid #2a3848',
            }}
          >
            <div style={{ marginBottom: 6, color: '#8fa3b8' }}>
              {depthStatus} · {poseLabel}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['window', 'sbs', 'anaglyph'] as StereoMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} style={btnStyle}>
                  {m}
                </button>
              ))}
              <button type="button" onClick={togglePlay} style={btnStyle}>
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <label style={{ ...btnStyle, cursor: 'pointer' }}>
                <Upload size={14} />
                <input type="file" accept="video/*" onChange={onUpload} style={{ display: 'none' }} />
              </label>
            </div>
            <label style={{ display: 'block', marginBottom: 6 }}>
              Cut {fgThreshold.toFixed(2)}
              <input
                type="range"
                min={0.2}
                max={0.9}
                step={0.01}
                value={fgThreshold}
                onChange={(e) => setFgThreshold(+e.target.value)}
                style={{ width: '100%' }}
              />
            </label>
            <label style={{ display: 'block' }}>
              Pop-out {relief.toFixed(2)}
              <input
                type="range"
                min={0}
                max={0.35}
                step={0.01}
                value={relief}
                onChange={(e) => setRelief(+e.target.value)}
                style={{ width: '100%' }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: 8,
  borderRadius: 6,
  border: '1px solid #2a3848',
  background: '#1c2836',
  color: '#fff',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: 12,
};
