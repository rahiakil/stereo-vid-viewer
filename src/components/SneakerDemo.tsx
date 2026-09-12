import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import FaceTracker from './FaceTracker';
import { HeadPose } from '../utils/headPose';
import { GlbSequenceScene } from '../utils/glbSequenceScene';

const DEFAULT_CAL = {
  screenWidthCm: 34,
  screenHeightCm: 19,
  viewingDistanceCm: 60,
};

const SEQ = '/media/vid-labu1_glbs';
const BG_VIDEO = '/media/vid-labu1.mp4';

/** Head-coupled GLB sequence — same presentation as off-axis-sneaker. */
export default function SneakerDemo() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlbSequenceScene | null>(null);
  const [status, setStatus] = useState('Starting…');
  const [poseLabel, setPoseLabel] = useState('—');
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!mountRef.current) return;
    const scene = new GlbSequenceScene(
      mountRef.current,
      SEQ,
      DEFAULT_CAL,
      setStatus,
      BG_VIDEO,
    );
    sceneRef.current = scene;
    scene.start();
    let cancelled = false;
    void (async () => {
      try {
        await scene.loadSequence();
        if (!cancelled) setReady(true);
      } catch (e) {
        setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  const onHeadPose = useCallback((pose: HeadPose | null) => {
    sceneRef.current?.setHeadPose(pose);
    if (pose) setPoseLabel(`x ${pose.x.toFixed(2)}  y ${pose.y.toFixed(2)}  z ${pose.z.toFixed(2)}`);
    else setPoseLabel('no face — move into webcam');
  }, []);

  const togglePlay = () => {
    const s = sceneRef.current;
    if (!s) return;
    s.togglePlay();
    setPlaying(!s.isPaused());
  };

  return (
    <div style={{ flex: 1, position: 'relative', minHeight: '70vh' }}>
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
          background: 'rgba(0,0,0,0.72)',
          borderRadius: 10,
          padding: 12,
          width: 300,
          fontSize: 12,
          border: '1px solid #2a3848',
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontWeight: 700, color: '#fff', marginBottom: 4 }}>Sneaker-mode demo</div>
        <div style={{ color: '#8fa3b8', marginBottom: 8 }}>{status}</div>
        <div style={{ color: '#8fa3b8', marginBottom: 8 }}>{poseLabel}</div>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!ready}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid #2a3848',
            background: ready ? '#5b9fd4' : '#1c2836',
            color: '#fff',
            cursor: ready ? 'pointer' : 'default',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: 600,
          }}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <p style={{ margin: '10px 0 0', color: '#a8b8c8' }}>
          Full aisle video stays on the screen plane; matted characters pop forward. Move your head.
        </p>
      </div>
    </div>
  );
}
