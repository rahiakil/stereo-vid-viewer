import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Activity, Sliders, Video, X } from 'lucide-react';
import FaceTracker from './FaceTracker';
import { HeadPose } from '../utils/headPose';
import { DepthMeshScene, DepthMeshStats } from '../utils/depthMeshScene';

/**
 * Mobile-optimized depth-mesh viewer.
 * Phone calibration + tap-to-start + bottom sheets + 100dvh.
 */

// Calibration is computed dynamically from the actual viewport aspect ratio (see useEffect).

const BASE = import.meta.env.BASE_URL;
const FG_VIDEO = `${BASE}media/demo/mobile/rgb.mp4`;
const DEPTH_VIDEO = `${BASE}media/demo/mobile/depth.mp4`;
const MATTE_VIDEO = `${BASE}media/demo/mobile/matte.mp4`;
const BG_VIDEO = `${BASE}media/demo/mobile/bg_clean.mp4`;
const BG_VIDEO_FALLBACK = FG_VIDEO;

type Sheet = 'none' | 'controls' | 'inspector' | 'camera';

export default function MobileDemo() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DepthMeshScene | null>(null);
  const [status, setStatus] = useState('Tap to start');
  const [poseLabel, setPoseLabel] = useState('—');
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState<DepthMeshStats | null>(null);
  const [relief, setRelief] = useState(0.025);
  const [alphaCut, setAlphaCut] = useState(0.35);
  const [started, setStarted] = useState(false);
  const [sheet, setSheet] = useState<Sheet>('none');
  const [logs, setLogs] = useState<string[]>([]);

  // Collect status messages into a ring buffer for the on-screen log panel
  const pushLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-40), `${ts} ${msg}`]);
  }, []);

  // Global error capture — catches uncaught exceptions and unhandled promise rejections
  useEffect(() => {
    const onErr = (e: ErrorEvent) => pushLog(`❌ ${e.message} @ ${e.filename}:${e.lineno}`);
    const onRej = (e: PromiseRejectionEvent) =>
      pushLog(`❌ promise rejected: ${String(e.reason)}`);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, [pushLog]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    const prev = meta?.content;
    if (meta)
      meta.content =
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
    return () => {
      if (meta && prev) meta.content = prev;
    };
  }, []);

  useEffect(() => {
    if (!started || !mountRef.current) return;
    let scene: DepthMeshScene | null = null;
    // Create scene synchronously (no await) so video.play() stays within the user gesture.
    const mount = mountRef.current;
    if (!mount) return;
    // Compute screen dimensions from actual viewport aspect so the frustum matches the phone.
    const w = mount.clientWidth || window.innerWidth;
    const h = mount.clientHeight || window.innerHeight;
    const aspect = w / h;
    const screenWidthCm = 7;
    const screenHeightCm = screenWidthCm / aspect;
    const cal = { screenWidthCm, screenHeightCm, viewingDistanceCm: 45, movementScale: 0.3 };
    scene = new DepthMeshScene(mount, FG_VIDEO, DEPTH_VIDEO, MATTE_VIDEO, BG_VIDEO, cal, (s) => { setStatus(s); pushLog(s); }, setStats, 360, 640, 0.85, 4);
    sceneRef.current = scene;
    scene.start();
    const onResize = () => sceneRef.current?.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [started]);

  useEffect(() => {
    if (stats && stats.streamsReady >= stats.streamsTotal && !ready) setReady(true);
  }, [stats, ready]);

  const onHeadPose = useCallback((pose: HeadPose | null) => {
    sceneRef.current?.setHeadPose(pose);
    if (pose) setPoseLabel(`x ${pose.x.toFixed(2)}  y ${pose.y.toFixed(2)}  z ${pose.z.toFixed(2)}`);
    else setPoseLabel('no face — move into view');
  }, []);

  const togglePlay = () => {
    const s = sceneRef.current;
    if (!s) return;
    s.togglePlay();
    setPlaying(!s.isPaused());
  };

  const streamsPct =
    stats && stats.streamsTotal > 0 ? Math.round((100 * stats.streamsReady) / stats.streamsTotal) : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, height: '100dvh' as string, background: '#0a0e14', overflow: 'hidden', touchAction: 'none' }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {!started && (
        <button
          type="button"
          onClick={() => {
            // Prime video playback within the user gesture (iOS Safari requires this
            // — any await between the tap and video.play() can lose the gesture).
            const primer = document.createElement('video');
            primer.src = FG_VIDEO;
            primer.muted = true;
            primer.playsInline = true;
            primer.preload = 'auto';
            primer.style.display = 'none';
            document.body.appendChild(primer);
            primer.play().then(() => { primer.pause(); primer.remove(); }).catch(() => {});
            setStarted(true);
          }}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none',
            background: 'rgba(8,12,18,0.92)', color: '#fff', fontSize: 18, fontWeight: 600,
            cursor: 'pointer', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 20,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ fontSize: 48 }}>👀</div>
          <div>Tap to start</div>
          <div style={{ fontSize: 13, fontWeight: 400, color: '#8fa3b8', maxWidth: 280, textAlign: 'center' }}>
            Loads 4 video streams, turns on your front camera for head tracking, and builds the 3D
            mesh in your browser. Move your head to look around.
          </div>
        </button>
      )}

      {started && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: 'env(safe-area-inset-top, 8px) 12px 8px',
          background: 'linear-gradient(to bottom, rgba(8,12,18,0.85), transparent)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          zIndex: 8, pointerEvents: 'none',
        }}>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>Labubu 3D</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', pointerEvents: 'auto' }}>
            <span style={{ color: ready ? '#3ecf8e' : '#8fa3b8', fontSize: 11 }}>
              {ready ? '● live' : 'loading…'}
            </span>
            <button
              type="button"
              onClick={() => {
                // Bypass cache by appending a cache-buster query param
                const url = new URL(window.location.href);
                url.searchParams.set('v', String(Date.now()));
                window.location.href = url.toString();
              }}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid #2a3848',
                background: '#1c2836',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      )}

      {/* Debug readout — top-left, shows raw pose so we can diagnose jumps */}
      {started && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 8px) + 28px)',
            left: 8,
            fontSize: 10,
            color: '#3ecf8e',
            background: 'rgba(0,0,0,0.6)',
            padding: '4px 8px',
            borderRadius: 6,
            zIndex: 8,
            fontFamily: 'ui-monospace, monospace',
            pointerEvents: 'none',
            maxWidth: '60vw',
            lineHeight: 1.4,
          }}
        >
          {poseLabel}
        </div>
      )}

      {started && (
        <div style={{
          position: 'absolute', right: 12,
          bottom: 'calc(env(safe-area-inset-bottom, 12px) + 12px)',
          display: 'flex', flexDirection: 'column', gap: 10, zIndex: 9,
        }}>
          <Fab icon={<Sliders size={20} />} active={sheet === 'controls'} onClick={() => setSheet(sheet === 'controls' ? 'none' : 'controls')} label="Controls" />
          <Fab icon={<Activity size={20} />} active={sheet === 'inspector'} onClick={() => setSheet(sheet === 'inspector' ? 'none' : 'inspector')} label="Streams" />
          <Fab icon={<Video size={20} />} active={sheet === 'camera'} onClick={() => setSheet(sheet === 'camera' ? 'none' : 'camera')} label="Camera" />
        </div>
      )}

      {started && (
        <BottomSheet open={sheet === 'controls'} onClose={() => setSheet('none')} title="Depth-mesh demo">
          <div style={{ color: '#8fa3b8', marginBottom: 8, fontSize: 12 }}>{status}</div>
          <div style={{ color: '#8fa3b8', marginBottom: 12, fontSize: 12 }}>{poseLabel}</div>
          <button type="button" onClick={togglePlay} disabled={!ready} style={mobileBtn(ready)}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <label style={sliderLabel}>
            Pop-out {relief.toFixed(3)}
            <input type="range" min={0} max={0.08} step={0.003} value={relief}
              onChange={(e) => { setRelief(+e.target.value); sceneRef.current?.setRelief(+e.target.value); }}
              style={{ width: '100%' }} />
          </label>
          <label style={sliderLabel}>
            Cut {alphaCut.toFixed(2)}
            <input type="range" min={0.1} max={0.9} step={0.01} value={alphaCut}
              onChange={(e) => { setAlphaCut(+e.target.value); sceneRef.current?.setAlphaCut(+e.target.value); }}
              style={{ width: '100%' }} />
          </label>
          <p style={{ margin: '10px 0 0', color: '#8fa3b8', fontSize: 12 }}>
            Move your head to look around. Sliders adjust pop-out and edge cut live.
          </p>
        </BottomSheet>
      )}

      {started && (
        <BottomSheet open={sheet === 'inspector'} onClose={() => setSheet('none')} title="Stream inspector">
          {!stats ? (
            <div style={{ color: '#8fa3b8' }}>Waiting…</div>
          ) : (
            <>
              <div style={{ marginBottom: 8, fontSize: 12 }}>
                <span style={{ color: '#8fa3b8' }}>phase </span>
                <span style={{ color: '#fff' }}>{stats.phase}</span>
              </div>
              <div style={{ marginBottom: 10, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>video streams</span>
                  <span>{stats.streamsReady}/{stats.streamsTotal} ({streamsPct}%)</span>
                </div>
                <div style={barTrack}>
                  <div style={{ ...barFill, width: `${streamsPct}%`, background: streamsPct >= 100 ? '#3ecf8e' : '#5b9fd4' }} />
                </div>
              </div>
              <Row label="elapsed" value={fmtMs(stats.elapsedMs)} />
              <Row label="BG stream" value={stats.bgBytes != null ? `${stats.bgLabel} · ${fmtMB(stats.bgBytes)}` : stats.bgLabel} />
              <div style={divider} />
              <div style={{ color: '#8fa3b8', marginBottom: 4, fontSize: 12 }}>what the browser assembles</div>
              <div style={{ fontSize: 12, marginBottom: 2 }}>RGB → foreground texture</div>
              <div style={{ fontSize: 12, marginBottom: 2 }}>depth → displaces grid mesh</div>
              <div style={{ fontSize: 12, marginBottom: 2 }}>matte → clean FG cutout</div>
              <div style={{ fontSize: 12, marginBottom: 2 }}>bg_clean → aisle on screen plane</div>
            </>
          )}
        </BottomSheet>
      )}

      {started && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top, 8px) + 32px)',
            right: 8,
            width: 80,
            height: 60,
            borderRadius: 8,
            overflow: 'hidden',
            border: '2px solid #2a3848',
            background: '#000',
            zIndex: 10,
          }}
        >
          <FaceTracker onHeadPose={onHeadPose} smoothingFactor={0.08} autoCalibrate />
        </div>
      )}

      {/* On-screen log overlay — always visible, shows last 6 log lines */}
      {started && (
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 'calc(env(safe-area-inset-bottom, 12px) + 190px)',
            maxWidth: '55vw',
            maxHeight: 140,
            overflow: 'hidden',
            fontSize: 9,
            lineHeight: 1.3,
            color: '#ffcc66',
            background: 'rgba(0,0,0,0.7)',
            padding: '4px 6px',
            borderRadius: 6,
            zIndex: 8,
            fontFamily: 'ui-monospace, monospace',
            pointerEvents: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {logs.slice(-6).join('\n')}
        </div>
      )}
    </div>
  );
}

function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '70dvh',
      transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 0.3s ease',
      zIndex: 15, background: 'rgba(8,12,18,0.96)', borderTop: '1px solid #2a3848',
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
      padding: '14px 16px calc(env(safe-area-inset-bottom, 12px) + 16px)',
      boxShadow: '0 -8px 32px rgba(0,0,0,0.5)', overflow: 'auto', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ width: 36, height: 4, borderRadius: 2, background: '#2a3848', margin: '0 auto 10px' }} />
      <button type="button" onClick={onClose} aria-label="Close"
        style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: '#8fa3b8', padding: 6, display: 'flex' }}>
        <X size={20} />
      </button>
      <div style={{ fontWeight: 700, color: '#fff', fontSize: 14, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Fab({ icon, active, onClick, label }: { icon: React.ReactNode; active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick}
      style={{
        width: 52, height: 52, borderRadius: 14, border: '1px solid #2a3848',
        background: active ? '#5b9fd4' : 'rgba(8,12,18,0.88)', color: '#fff', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}>
      {icon}
    </button>
  );
}

const sliderLabel: React.CSSProperties = { display: 'block', marginBottom: 12, color: '#a8b8c8', fontSize: 14 };
const divider: React.CSSProperties = { borderTop: '1px solid #2a3848', margin: '10px 0' };
const barTrack: React.CSSProperties = { marginTop: 4, height: 6, borderRadius: 3, background: '#1c2836', overflow: 'hidden' };
const barFill: React.CSSProperties = { height: '100%', borderRadius: 3 };

function mobileBtn(ready: boolean): React.CSSProperties {
  return {
    padding: '12px 16px', borderRadius: 10, border: '1px solid #2a3848',
    background: ready ? '#5b9fd4' : '#1c2836', color: '#fff', cursor: ready ? 'pointer' : 'default',
    display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15,
    width: '100%', justifyContent: 'center',
  };
}

function fmtMB(bytes: number) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function fmtMs(ms: number) { return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`; }

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2, fontSize: 12 }}>
      <span style={{ color: '#8fa3b8' }}>{label}</span>
      <span style={{ color: '#e8eef4', textAlign: 'right' }}>{value}</span>
    </div>
  );
}
