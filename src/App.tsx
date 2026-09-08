import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Play, Pause, Upload } from 'lucide-react';
import FaceTracker from './components/FaceTracker';
import { HeadPose } from './utils/headPose';
import { StereoVideoScene, StereoMode } from './utils/stereoVideoScene';

const DEFAULT_VIDEO = '/media/vid1.mp4';

const DEFAULT_CAL = {
  screenWidthCm: 34,
  screenHeightCm: 19,
  viewingDistanceCm: 60,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<StereoVideoScene | null>(null);
  const [mode, setMode] = useState<StereoMode>('sbs');
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [ipd, setIpd] = useState(6.5);
  const [depth, setDepth] = useState(0.35);
  const [poseLabel, setPoseLabel] = useState('—');
  const [videoLabel, setVideoLabel] = useState('vid1.mp4');

  useEffect(() => {
    if (!mountRef.current) return;
    const scene = new StereoVideoScene(mountRef.current, DEFAULT_VIDEO, DEFAULT_CAL);
    sceneRef.current = scene;
    scene.setMode(mode);
    scene.start();
    void scene.play().then(() => setPlaying(!scene.isPaused()));

    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    sceneRef.current?.setIpdCm(ipd);
  }, [ipd]);

  useEffect(() => {
    sceneRef.current?.setDepth(depth);
  }, [depth]);

  const onHeadPose = useCallback((pose: HeadPose | null) => {
    sceneRef.current?.setHeadPose(pose);
    if (pose) {
      setPoseLabel(`x ${(pose.x).toFixed(2)}  y ${(pose.y).toFixed(2)}  z ${(pose.z).toFixed(2)}`);
    } else {
      setPoseLabel('no face');
    }
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
    const url = URL.createObjectURL(file);
    sceneRef.current?.setVideoSrc(url);
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
          <div style={{ fontWeight: 650, fontSize: 16 }}>Stereo Video Viewer</div>
          <div style={{ fontSize: 12, color: '#8fa3b8' }}>
            Head-coupled off-axis (same logic as off-axis-sneaker) · {videoLabel}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['window', 'sbs', 'anaglyph'] as StereoMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #2a3848',
                background: mode === m ? '#5b9fd4' : '#1c2836',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {m === 'window' ? 'Window (mono)' : m === 'sbs' ? 'Side-by-side' : 'Anaglyph'}
            </button>
          ))}
          <button
            onClick={togglePlay}
            style={btnStyle}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <label style={{ ...btnStyle, cursor: 'pointer', display: 'inline-flex', gap: 4 }}>
            <Upload size={14} />
            <span style={{ fontSize: 12 }}>Video</span>
            <input type="file" accept="video/*" onChange={onUpload} style={{ display: 'none' }} />
          </label>
          <button onClick={toggleFs} style={btnStyle}>
            {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
          </button>
        </div>
      </header>

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
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
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
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(6px)',
            borderRadius: 10,
            padding: 12,
            width: 260,
            fontSize: 12,
            border: '1px solid #2a3848',
          }}
        >
          <div style={{ marginBottom: 8, color: '#8fa3b8' }}>Pose: {poseLabel}</div>
          <label style={{ display: 'block', marginBottom: 8 }}>
            IPD {ipd.toFixed(1)} cm
            <input
              type="range"
              min={4}
              max={8}
              step={0.1}
              value={ipd}
              onChange={(e) => setIpd(+e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ display: 'block' }}>
            Depth {depth.toFixed(2)} m
            <input
              type="range"
              min={0.05}
              max={1.2}
              step={0.01}
              value={depth}
              onChange={(e) => setDepth(+e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <p style={{ margin: '8px 0 0', color: '#8fa3b8', lineHeight: 1.4 }}>
            Move your head — left/right eyes get separate off-axis frustums (Johnny Lee style).
            SBS: cross-eyed or VR headset. Anaglyph: red-cyan glasses.
          </p>
        </div>
      </div>
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
};
