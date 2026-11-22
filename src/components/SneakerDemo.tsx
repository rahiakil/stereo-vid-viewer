import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, ChevronLeft, ChevronRight, Activity, Sliders, Video, AlertCircle, RefreshCw } from 'lucide-react';
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

interface SneakerDemoProps {
  defaultVideo?: 'labubu' | 'custom' | 'fuarukee' | 'office_demo' | string;
}

/** Browser-assembled depth-mesh demo (no per-frame GLB warm). */
export default function SneakerDemo({ defaultVideo }: SneakerDemoProps = {}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DepthMeshScene | null>(null);
  const [status, setStatus] = useState('Starting…');
  const [poseLabel, setPoseLabel] = useState('—');
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState<DepthMeshStats | null>(null);
  const [relief, setRelief] = useState(0.14);
  const [alphaCut, setAlphaCut] = useState(0.35);
  const [zoom, setZoom] = useState(1.0);

  // Panel visibility — collapsed by default on small screens
  const [showInspector, setShowInspector] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showCamera, setShowCamera] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<'labubu' | 'custom' | 'fuarukee' | 'office_demo' | 'cows_demo' | string>(defaultVideo || 'fuarukee');
  const [useMatte, setUseMatte] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<'All' | 'Class A' | 'Class B' | 'Class D'>('All');

  useEffect(() => {
    if (defaultVideo) {
      setSelectedVideo(defaultVideo);
    }
  }, [defaultVideo]);

  useEffect(() => {
    const matteBypassVideos = ['fuarukee', 'seal_demo', 'cows_demo'];
    setUseMatte(!matteBypassVideos.includes(selectedVideo));
  }, [selectedVideo]);

  useEffect(() => {
    sceneRef.current?.setUseMatte(useMatte);
  }, [useMatte]);

  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    let scene: DepthMeshScene | null = null;

    let fg = `${BASE}media/${selectedVideo}_rgb.mp4?v=20261121`;
    let depth = `${BASE}media/${selectedVideo}_depth.mp4?v=20261121`;
    let matte = `${BASE}media/${selectedVideo}_matte.mp4?v=20261121`;
    let bg_target = `${BASE}media/${selectedVideo}_bg_clean.mp4?v=20261121`;

    if (selectedVideo === 'labubu') {
      fg = `${BASE}media/vid-labu1.mp4?v=20261121`;
      depth = `${BASE}media/vid-labu1_depth.mp4?v=20261121`;
      matte = `${BASE}media/vid-labu1_matte.mp4?v=20261121`;
      bg_target = `${BASE}media/vid-labu1_bg_clean.mp4?v=20261121`;
    }
    const bg_default = fg;

    void (async () => {
      const mount = mountRef.current;
      if (!mount) return;
      let bg = bg_default;
      try {
        const head = await fetch(bg_target, { method: 'HEAD' });
        if (head.ok) bg = bg_target;
      } catch {
        /* fall back to original */
      }
      if (cancelled) return;
      scene = new DepthMeshScene(
        mount,
        fg,
        depth,
        matte,
        bg,
        DEFAULT_CAL,
        setStatus,
        setStats,
      );
      sceneRef.current = scene;
      scene.setUseMatte(useMatte);
      scene.setZoom(zoom);
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
  }, [selectedVideo]);

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

  useEffect(() => {
    if (!isSweeping) return;
    let frameId: number;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = (Date.now() - startTime) / 1000;
      // Smooth sinusoidal horizontal head sweep between 0.15 and 0.85
      const x = 0.5 + 0.35 * Math.sin(elapsed * Math.PI * 0.5);
      onHeadPose({ x, y: 0.5, z: 0.8 });
      frameId = requestAnimationFrame(animate);
    };
    
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [isSweeping, onHeadPose]);

  useEffect(() => {
    (window as any).setPoseValue = (pose: HeadPose) => {
      onHeadPose(pose);
    };
    (window as any).setReliefValue = (val: number) => {
      setRelief(val);
      sceneRef.current?.setRelief(val);
    };
    return () => {
      delete (window as any).setPoseValue;
      delete (window as any).setReliefValue;
    };
  }, [onHeadPose]);

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
            {playing ? ' ' + (playing ? 'Pause' : 'Play') : ''}
          </button>
          <button
            type="button"
            onClick={() => setIsSweeping(!isSweeping)}
            disabled={!ready}
            style={{
              ...btnStyle(ready),
              background: isSweeping ? '#3ecf8e' : '#1c2836',
              color: isSweeping ? '#000' : '#fff',
              borderColor: isSweeping ? '#3ecf8e' : '#2a3848',
              fontWeight: 'bold',
            }}
          >
            <RefreshCw size={14} className={isSweeping ? 'animate-spin' : ''} />
            {isSweeping ? ' Stop Sweep' : ' Simulate Head Sweep'}
          </button>
        </div>

        {/* Investor Tip / Showcase Highlight */}
        <div style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: 8,
          padding: '10px 12px',
          marginBottom: 12,
          fontSize: 11,
          lineHeight: 1.4,
          color: '#cbd5e1'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f59e0b', fontWeight: 'bold', marginBottom: 4 }}>
            <span>💎</span>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Investor Showcase Guide</span>
          </div>
          Select the <strong style={{ color: '#fff' }}>"Fuarukee POV"</strong> video below (real dual-lens stereoscopic capture) and click <strong style={{ color: '#38bdf8' }}>"Simulate Head Sweep"</strong> above. This demonstrates the physical "window portal" look-around illusion with zero synthetic estimation noise.
        </div>

        <div style={{ color: '#8fa3b8', fontSize: 10, marginBottom: 8 }}>PROCESSED VIDEO LIBRARY (BY PIPELINE CLASS)</div>
        
        {/* Category Filters */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {[
            { id: 'All', label: 'All' },
            { id: 'Class A', label: 'Class A (Mono)' },
            { id: 'Class B', label: 'Class B (Stereo)' },
            { id: 'Class D', label: 'Class D (Splat)' }
          ].map((tab) => {
            const isTabSelected = categoryFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id as any)}
                style={{
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  border: isTabSelected ? '1px solid #38bdf8' : '1px solid #2a3848',
                  background: isTabSelected ? '#38bdf8' : '#1c2836',
                  color: isTabSelected ? '#000' : '#8fa3b8',
                  transition: 'all 0.1s ease',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {[
            {
              id: 'fuarukee',
              title: '⭐ Fuarukee POV',
              class: 'Class B',
              desc: 'Premium dual-lens physical stereoscopic capture. Exhibits zero depth estimation noise. Flawless window-look-around.',
              badge: '💎 INVESTOR FAV',
              badgeColor: '#f59e0b',
            },
            {
              id: 'svd_0001',
              title: 'SVD Spatial Video',
              class: 'Class B',
              desc: 'Premium iPhone 16 Pro spatial video (MV-HEVC) demuxed and processed into beautiful depth-mesh Look-around.',
              badge: 'iPhone 16 Pro',
              badgeColor: '#ec4899',
            },
            {
              id: 'cows_demo',
              title: 'Cows Demo',
              class: 'Class A',
              desc: 'Scrape benchmark showing grazing cows. Reconstructed into 3D mesh sequence with matte-bypass continuous relief.',
              badge: 'Auto Scraped',
              badgeColor: '#f59e0b',
            },
            {
              id: 'dancing_demo',
              title: 'Dancing Demo',
              class: 'Class A',
              desc: 'Dynamic foreground dancers reconstructed with high-fidelity depth-mesh and empty background plate.',
              badge: 'Auto Scraped',
              badgeColor: '#10b981',
            },
            {
              id: 'seal_demo',
              title: 'Seal Demo',
              class: 'Class A',
              desc: 'Underwater seal swimming. Reconstructed into continuous, flowing autostereoscopic mesh.',
              badge: 'Auto Scraped',
              badgeColor: '#3b82f6',
            },
            {
              id: 'bbb_sunflower',
              title: 'Bunny Sunflower (2D)',
              class: 'Class B',
              desc: 'Processed 2D monocular video. Depth estimated and reconstructed into 3D look-around mesh with empty in-painted background.',
              badge: 'Monocular 2D',
              badgeColor: '#ec4899',
            },
            {
              id: 'office_demo',
              title: 'Office Demo',
              class: 'Class B',
              desc: 'Processed stereoscopic video "office_demo". Left eye view reconstructed into 3D mesh with empty in-painted background.',
              badge: 'Auto Processed',
              badgeColor: '#a78bfa',
            },
            {
              id: 'custom',
              title: 'First Custom Video',
              class: 'Class B',
              desc: 'Your first processed stereoscopic video. Left eye view reconstructed into a 3D mesh with AI-inpainted background.',
              badge: 'Custom SBS',
              badgeColor: '#5b9fd4',
            },
            {
              id: 'labubu',
              title: 'Labubu Toy Walk',
              class: 'Class D',
              desc: 'Original demo featuring a Labubu toy walking down a high-detail store aisle.',
              badge: 'Demo',
              badgeColor: '#3ecf8e',
            },
          ].filter((item) => categoryFilter === 'All' || item.class === categoryFilter)
           .map((item) => {
            const isSelected = selectedVideo === item.id;
            return (
              <div
                key={item.id}
                onClick={() => setSelectedVideo(item.id)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: isSelected ? `2px solid ${item.badgeColor}` : '1px solid #2a3848',
                  background: isSelected ? `${item.badgeColor}25` : '#1c2836',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: '#fff', fontSize: 12 }}>{item.title}</span>
                  <span style={{
                    fontSize: 9,
                    padding: '2px 6px',
                    borderRadius: 10,
                    background: item.badgeColor,
                    color: '#000',
                    fontWeight: 'bold'
                  }}>
                    {item.badge}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: '#8fa3b8', lineHeight: 1.3 }}>{item.desc}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginBottom: 12 }}>
          {selectedVideo !== 'fuarukee' ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: '#fff' }}>
              <input
                type="checkbox"
                checked={useMatte}
                onChange={(e) => {
                  setUseMatte(e.target.checked);
                  sceneRef.current?.setUseMatte(e.target.checked);
                }}
                style={{ cursor: 'pointer' }}
              />
              Use Foreground Matte Cutout
            </label>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8fa3b8', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', padding: '6px 10px', borderRadius: 6 }}>
              <AlertCircle size={14} style={{ color: '#f59e0b' }} />
              <span>Matte cutout unavailable for landscapes</span>
            </div>
          )}
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
        <label style={sliderLabel}>
          Zoom/Fit {zoom.toFixed(2)}x
          <input
            type="range"
            min={0.5}
            max={2.5}
            step={0.05}
            value={zoom}
            onChange={(e) => {
              setZoom(+e.target.value);
              sceneRef.current?.setZoom(+e.target.value);
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
