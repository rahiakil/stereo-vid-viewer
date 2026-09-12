import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FaceTracker from './FaceTracker';
import { HeadPose } from '../utils/headPose';

interface MvMeta {
  nx: number;
  ny: number;
  xs: number[];
  ys: number[];
  every: number;
  fps_source: number;
  frames: { index: number; dir: string; sheet: string }[];
  note?: string;
}

const META_URL = '/media/vid-labu1_mv/meta.json';
const WIGGLE = '/media/vid-labu1_wiggle.mp4';
const SBS = '/media/vid-labu1_sbs.mp4';
const ANA = '/media/vid-labu1_anaglyph.mp4';

type Tab = 'simple' | 'head';

/** Fast path: prebaked videos. Optional: tiny head-tracked multiview. */
export default function MultiViewPlayer() {
  const [tab, setTab] = useState<Tab>('simple');
  const [meta, setMeta] = useState<MvMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [vx, setVx] = useState(0);
  const [vy, setVy] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [showSheet, setShowSheet] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [simpleSrc, setSimpleSrc] = useState(WIGGLE);

  useEffect(() => {
    fetch(META_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no multiview meta'))))
      .then((m: MvMeta) => setMeta(m))
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  useEffect(() => {
    if (!meta || !playing || tab !== 'head') return;
    const dt = (1000 * (meta.every || 8)) / (meta.fps_source || 30);
    const id = window.setInterval(() => {
      setFrameIdx((i) => (i + 1) % meta.frames.length);
    }, dt);
    return () => clearInterval(id);
  }, [meta, playing, tab]);

  const onHead = useCallback(
    (pose: HeadPose | null) => {
      if (!pose || !meta) return;
      const gx = (1 - pose.x) * (meta.nx - 1);
      const gy = pose.y * (meta.ny - 1);
      setVx(Math.max(0, Math.min(meta.nx - 1, Math.round(gx))));
      setVy(Math.max(0, Math.min(meta.ny - 1, Math.round(gy))));
    },
    [meta],
  );

  const frame = meta?.frames[frameIdx];
  const viewUrl = useMemo(() => {
    if (!meta || !frame) return null;
    return `/media/vid-labu1_mv/${frame.dir}/v${vx}_${vy}.jpg`;
  }, [meta, frame, vx, vy]);

  const sheetUrl = frame
    ? `/media/vid-labu1_mv/${frame.dir}/sheet.jpg`
    : '/media/vid-labu1_mv/preview_sheet.jpg';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0e14', color: '#e8eef4' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a3848', fontSize: 13 }}>
        <strong>Prebaked 3D video</strong> — depth was computed once; these files play like normal video.
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" style={tab === 'simple' ? tabOn : tabOff} onClick={() => setTab('simple')}>
            Simple videos (fast)
          </button>
          <button type="button" style={tab === 'head' ? tabOn : tabOff} onClick={() => setTab('head')}>
            Head-tracked views
          </button>
        </div>
      </div>

      {tab === 'simple' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 12, gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                [WIGGLE, 'Wiggle (no glasses)'],
                [SBS, 'Side-by-side stereo'],
                [ANA, 'Anaglyph (red-cyan)'],
              ] as [string, string][]
            ).map(([src, label]) => (
              <button
                key={src}
                type="button"
                onClick={() => {
                  setSimpleSrc(src);
                  if (videoRef.current) {
                    videoRef.current.src = src;
                    void videoRef.current.play();
                  }
                }}
                style={simpleSrc === src ? tabOn : tabOff}
              >
                {label}
              </button>
            ))}
          </div>
          <video
            ref={videoRef}
            src={simpleSrc}
            controls
            autoPlay
            loop
            muted
            playsInline
            style={{
              flex: 1,
              width: '100%',
              maxHeight: '70vh',
              objectFit: 'contain',
              background: '#000',
              borderRadius: 8,
            }}
          />
          <p style={{ margin: 0, fontSize: 12, color: '#8fa3b8', lineHeight: 1.45 }}>
            <strong style={{ color: '#ccc' }}>Wiggle</strong> = viewpoint rocks so depth reads without a headset.
            <strong style={{ color: '#ccc' }}> SBS</strong> = VR / cross-eye.
            <strong style={{ color: '#ccc' }}> Anaglyph</strong> = red-cyan glasses.
            This is the practical “sneaker-like depth” path for a <em>video</em>. The real sneaker uses a 3D mesh, not pixels.
          </p>
        </div>
      )}

      {tab === 'head' && (
        <>
          {err && !meta && (
            <div style={{ padding: 16, color: '#f0a0a0' }}>Head-tracked grid missing: {err}</div>
          )}
          {meta && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ flex: 1, position: 'relative', background: '#000', margin: 8, borderRadius: 8, overflow: 'hidden' }}>
                {viewUrl && (
                  <img src={viewUrl} alt="view" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                )}
                <div style={badge}>view v{vx}_{vy} · frame {frameIdx + 1}/{meta.frames.length}</div>
              </div>

              {showSheet && (
                <div style={{ height: 110, margin: '0 8px 8px', borderRadius: 6, overflow: 'hidden', background: '#111' }}>
                  <img src={sheetUrl} alt="sheet" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 10, borderTop: '1px solid #2a3848', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setPlaying((p) => !p)} style={tabOff}>
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button type="button" onClick={() => setShowSheet((s) => !s)} style={tabOff}>
                  {showSheet ? 'Hide tiny sheet' : 'Show tiny sheet'}
                </button>
                <label style={{ fontSize: 12 }}>
                  Frame
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, meta.frames.length - 1)}
                    value={frameIdx}
                    onChange={(e) => setFrameIdx(+e.target.value)}
                    style={{ width: 140, marginLeft: 8 }}
                  />
                </label>
                <div style={{ width: 140, height: 105, borderRadius: 8, overflow: 'hidden', border: '1px solid #fff', marginLeft: 'auto' }}>
                  <FaceTracker onHeadPose={onHead} />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const tabOn: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #5b9fd4',
  background: '#5b9fd4',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};
const tabOff: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #2a3848',
  background: '#1c2836',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12,
};
const badge: React.CSSProperties = {
  position: 'absolute',
  left: 8,
  top: 8,
  background: 'rgba(0,0,0,0.6)',
  padding: '4px 8px',
  borderRadius: 6,
  fontSize: 12,
};
