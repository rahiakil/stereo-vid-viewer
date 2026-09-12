import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import FaceTracker from './FaceTracker';
import { HeadPose } from '../utils/headPose';
import { DepthMeshScene, DepthMeshStats } from '../utils/depthMeshScene';

const DEFAULT_CAL = {
  screenWidthCm: 34,
  screenHeightCm: 19,
  viewingDistanceCm: 60,
};

const FG_VIDEO = '/media/demo/rgb.mp4';
const DEPTH_VIDEO = '/media/demo/depth.mp4';
const MATTE_VIDEO = '/media/demo/matte.mp4';
const BG_VIDEO = '/media/demo/bg_clean.mp4';
const BG_VIDEO_FALLBACK = FG_VIDEO;

function fmtMB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** Browser-assembled depth-mesh demo (no per-frame GLB warm). */
export default function SneakerDemo() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DepthMeshScene | null>(null);
  const [status, setStatus] = useState('Starting…');
  const [poseLabel, setPoseLabel] = useState('—');
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState<DepthMeshStats | null>(null);
  const [relief, setRelief] = useState(0.14);
  const [alphaCut, setAlphaCut] = useState(0.35);

  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    let scene: DepthMeshScene | null = null;

    void (async () => {
      const mount = mountRef.current;
      if (!mount) return;
      let bg = BG_VIDEO_FALLBACK;
      try {
        const head = await fetch(BG_VIDEO, { method: 'HEAD' });
        if (head.ok) bg = BG_VIDEO;
      } catch {
        /* fall back to original */
      }
      if (cancelled) return;
      scene = new DepthMeshScene(
        mount,
        FG_VIDEO,
        DEPTH_VIDEO,
        MATTE_VIDEO,
        bg,
        DEFAULT_CAL,
        setStatus,
        setStats,
      );
      sceneRef.current = scene;
      scene.start();
    })();

    const onResize = () => sceneRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Mark ready when stats say all streams are loaded
  useEffect(() => {
    if (stats && stats.streamsReady >= stats.streamsTotal && !ready) {
      setReady(true);
    }
  }, [stats, ready]);

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

  const streamsPct =
    stats && stats.streamsTotal > 0
      ? Math.round((100 * stats.streamsReady) / stats.streamsTotal)
      : 0;

  return (
    <div style={{ flex: 1, position: 'relative', minHeight: '70vh' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Load / stream inspector */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 6,
          width: 290,
          background: 'rgba(8,12,18,0.88)',
          border: '1px solid #2a3848',
          borderRadius: 10,
          padding: 12,
          fontSize: 11,
          lineHeight: 1.5,
          color: '#c5d0dc',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <div style={{ fontWeight: 700, color: '#fff', marginBottom: 6, fontSize: 12 }}>
          Stream inspector
        </div>
        {!stats ? (
          <div>Waiting…</div>
        ) : (
          <>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: '#8fa3b8' }}>phase </span>
              <span style={{ color: '#fff' }}>{stats.phase}</span>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>video streams</span>
                <span>
                  {stats.streamsReady}/{stats.streamsTotal} ({streamsPct}%)
                </span>
              </div>
              <div
                style={{
                  marginTop: 4,
                  height: 6,
                  borderRadius: 3,
                  background: '#1c2836',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${streamsPct}%`,
                    height: '100%',
                    background: streamsPct >= 100 ? '#3ecf8e' : '#5b9fd4',
                  }}
                />
              </div>
            </div>
            <Row label="elapsed" value={fmtMs(stats.elapsedMs)} />
            <Row
              label="BG stream"
              value={
                stats.bgBytes != null
                  ? `${stats.bgLabel} · ${fmtMB(stats.bgBytes)}`
                  : stats.bgLabel
              }
            />
            <div style={{ borderTop: '1px solid #2a3848', margin: '8px 0' }} />
            <div style={{ color: '#8fa3b8', marginBottom: 4 }}>what the browser assembles</div>
            <div style={{ marginBottom: 2 }}>RGB video → foreground texture</div>
            <div style={{ marginBottom: 2 }}>depth video → displaces one grid mesh</div>
            <div style={{ marginBottom: 2 }}>matte video → clean FG cutout</div>
            <div style={{ marginBottom: 2 }}>bg_clean → aisle on screen plane</div>
            <div style={{ borderTop: '1px solid #2a3848', margin: '8px 0' }} />
            <div style={{ color: '#8fa3b8' }}>no per-frame GLB downloads</div>
            <div style={{ color: '#3ecf8e' }}>
              {ready ? '✓ playing from streams' : 'loading…'}
            </div>
          </>
        )}
      </div>

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
          width: 280,
          fontSize: 12,
          border: '1px solid #2a3848',
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontWeight: 700, color: '#fff', marginBottom: 4 }}>Depth-mesh demo</div>
        <div style={{ color: '#8fa3b8', marginBottom: 8 }}>{status}</div>
        <div style={{ color: '#8fa3b8', marginBottom: 8 }}>{poseLabel}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button
            type="button"
            onClick={togglePlay}
            disabled={!ready}
            style={btnStyle(ready)}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? 'Pause' : 'Play'}
          </button>
        </div>
        <label style={{ display: 'block', marginBottom: 6, color: '#a8b8c8' }}>
          Pop-out {relief.toFixed(2)}
          <input
            type="range"
            min={0}
            max={0.3}
            step={0.01}
            value={relief}
            onChange={(e) => {
              setRelief(+e.target.value);
              sceneRef.current?.setRelief(+e.target.value);
            }}
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ display: 'block', color: '#a8b8c8' }}>
          Cut {alphaCut.toFixed(2)}
          <input
            type="range"
            min={0.1}
            max={0.9}
            step={0.01}
            value={alphaCut}
            onChange={(e) => {
              setAlphaCut(+e.target.value);
              sceneRef.current?.setAlphaCut(+e.target.value);
            }}
            style={{ width: '100%' }}
          />
        </label>
        <p style={{ margin: '8px 0 0', color: '#8fa3b8' }}>
          Browser builds the mesh from 4 video streams. Sliders are instant — no re-bake.
        </p>
      </div>
    </div>
  );
}

function btnStyle(ready: boolean): React.CSSProperties {
  return {
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
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
      <span style={{ color: '#8fa3b8' }}>{label}</span>
      <span style={{ color: '#e8eef4', textAlign: 'right' }}>{value}</span>
    </div>
  );
}
