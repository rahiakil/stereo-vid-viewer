import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, ChevronLeft, ChevronRight, Activity, Sliders, Video } from 'lucide-react';
import FaceTracker from './FaceTracker';
import { HeadPose } from '../utils/headPose';
import { DepthMeshScene, DepthMeshStats } from '../utils/depthMeshScene';

const DEFAULT_CAL = {
  screenWidthCm: 34,
  screenHeightCm: 19,
  viewingDistanceCm: 60,
};

const BASE = import.meta.env.BASE_URL;
const FG_VIDEO = `${BASE}media/demo/rgb.mp4`;
const DEPTH_VIDEO = `${BASE}media/demo/depth.mp4`;
const MATTE_VIDEO = `${BASE}media/demo/matte.mp4`;
const BG_VIDEO = `${BASE}media/demo/bg_clean.mp4`;
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

  // Panel visibility — collapsed by default on small screens
  const [showInspector, setShowInspector] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

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
    <div style={{ flex: 1, position: 'relative', minHeight: '70vh', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {/* ===== Right edge: toggle buttons ===== */}
      <div style={edgeToggleStyle('right')}>
        <EdgeButton
          icon={<Activity size={16} />}
          active={showInspector}
          onClick={() => setShowInspector(!showInspector)}
          title="Stream inspector"
        />
        <EdgeButton
          icon={<Video size={16} />}
          active={showCamera}
          onClick={() => setShowCamera(!showCamera)}
          title="Webcam"
        />
      </div>

      {/* ===== Left edge: toggle button ===== */}
      <div style={edgeToggleStyle('left')}>
        <EdgeButton
          icon={<Sliders size={16} />}
          active={showControls}
          onClick={() => setShowControls(!showControls)}
          title="Controls"
        />
      </div>

      {/* ===== Slideable: Stream inspector (right) ===== */}
      <div
        style={{
          ...panelBase,
          top: 48,
          right: showInspector ? 12 : -320,
          transition: 'right 0.3s ease',
        }}
      >
        <div style={panelHeader}>
          <span style={{ fontWeight: 700, color: '#fff', fontSize: 12 }}>Stream inspector</span>
          <button style={closeBtn} onClick={() => setShowInspector(false)}>
            <ChevronRight size={16} />
          </button>
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
              <div style={barTrack}>
                <div style={{ ...barFill, width: `${streamsPct}%`, background: streamsPct >= 100 ? '#3ecf8e' : '#5b9fd4' }} />
              </div>
            </div>
            <Row label="elapsed" value={fmtMs(stats.elapsedMs)} />
            <Row
              label="BG stream"
              value={stats.bgBytes != null ? `${stats.bgLabel} · ${fmtMB(stats.bgBytes)}` : stats.bgLabel}
            />
            <div style={divider} />
            <div style={{ color: '#8fa3b8', marginBottom: 4 }}>what the browser assembles</div>
            <div style={{ marginBottom: 2 }}>RGB video → foreground texture</div>
            <div style={{ marginBottom: 2 }}>depth video → displaces one grid mesh</div>
            <div style={{ marginBottom: 2 }}>matte video → clean FG cutout</div>
            <div style={{ marginBottom: 2 }}>bg_clean → aisle on screen plane</div>
            <div style={divider} />
            <div style={{ color: ready ? '#3ecf8e' : '#8fa3b8' }}>
              {ready ? '✓ playing from streams' : 'loading…'}
            </div>
          </>
        )}
      </div>

      {/* ===== Slideable: Controls (left) ===== */}
      <div
        style={{
          ...panelBase,
          bottom: 12,
          left: showControls ? 12 : -320,
          transition: 'left 0.3s ease',
        }}
      >
        <div style={panelHeader}>
          <span style={{ fontWeight: 700, color: '#fff', fontSize: 12 }}>Depth-mesh demo</span>
          <button style={closeBtn} onClick={() => setShowControls(false)}>
            <ChevronLeft size={16} />
          </button>
        </div>
        <div style={{ color: '#8fa3b8', marginBottom: 6 }}>{status}</div>
        <div style={{ color: '#8fa3b8', marginBottom: 8 }}>{poseLabel}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button type="button" onClick={togglePlay} disabled={!ready} style={btnStyle(ready)}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? 'Pause' : 'Play'}
          </button>
        </div>
        <label style={sliderLabel}>
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
        <label style={sliderLabel}>
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
          Browser builds the mesh from 4 video streams. Sliders are instant.
        </p>
      </div>

      {/* ===== Slideable: Face tracker (right-bottom) ===== */}
      <div
        style={{
          position: 'absolute',
          right: showCamera ? 12 : -260,
          bottom: 12,
          width: 240,
          height: 180,
          borderRadius: 10,
          overflow: 'hidden',
          border: '2px solid #fff',
          zIndex: 5,
          transition: 'right 0.3s ease',
        }}
      >
        <FaceTracker onHeadPose={onHeadPose} />
      </div>
    </div>
  );
}

// ===== Styles =====
const panelBase: React.CSSProperties = {
  position: 'absolute',
  zIndex: 6,
  width: 290,
  maxHeight: 'calc(100% - 60px)',
  overflow: 'auto',
  background: 'rgba(8,12,18,0.92)',
  border: '1px solid #2a3848',
  borderRadius: 10,
  padding: 12,
  fontSize: 11,
  lineHeight: 1.5,
  color: '#c5d0dc',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const panelHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
};

const closeBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#8fa3b8',
  cursor: 'pointer',
  padding: 2,
  display: 'flex',
  alignItems: 'center',
};

const divider: React.CSSProperties = {
  borderTop: '1px solid #2a3848',
  margin: '8px 0',
};

const barTrack: React.CSSProperties = {
  marginTop: 4,
  height: 6,
  borderRadius: 3,
  background: '#1c2836',
  overflow: 'hidden',
};

const barFill: React.CSSProperties = {
  height: '100%',
  borderRadius: 3,
};

const sliderLabel: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  color: '#a8b8c8',
  fontSize: 12,
};

function edgeToggleStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    top: 12,
    [side]: 4,
    zIndex: 7,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  };
}

function EdgeButton({
  icon,
  active,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        padding: 8,
        borderRadius: 8,
        border: '1px solid #2a3848',
        background: active ? '#5b9fd4' : 'rgba(8,12,18,0.88)',
        color: '#fff',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {icon}
    </button>
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
    fontSize: 12,
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
