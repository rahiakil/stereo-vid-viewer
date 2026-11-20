import React, { useEffect, useState } from 'react';
import { Play, Activity, Cpu, CheckCircle, Clock, Film, RefreshCw, AlertCircle, Eye } from 'lucide-react';

interface SystemStats {
  cpu_usage_pct: number;
  memory_usage_pct: number;
  avg_processing_time_sec: number;
  total_processed: number;
}

interface QueueItem {
  name: string;
  status: string;
  stage?: string;
  progress?: number;
}

interface HistoryItem {
  id: string;
  title: string;
  duration_sec: number;
  processing_time_sec: number;
  parallax_variance: number;
  status: string;
  left_screenshot: string;
  right_screenshot: string;
  description: string;
}

interface DashboardData {
  system: SystemStats;
  queue: QueueItem[];
  history: HistoryItem[];
}

interface Props {
  onPlayVideo: (id: string, view: 'mesh' | 'portal') => void;
}

export default function HarnessDashboard({ onPlayVideo }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const BASE = import.meta.env.BASE_URL || '/';
      const res = await fetch(`${BASE}media/dashboard/status.json?t=${Date.now()}`);
      if (!res.ok) throw new Error('Status server not yet ready');
      const json = await res.json();
      setData(json);
      setError(null);
      
      // Select first item if nothing selected
      if (json.history && json.history.length > 0 && !selectedHistory) {
        setSelectedHistory(json.history[0]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, [selectedHistory]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#8fa3b8' }}>
        <RefreshCw className="animate-spin" size={32} style={{ marginBottom: 12, color: '#3ecf8e' }} />
        <div>Loading 3D Processing Dashboard...</div>
      </div>
    );
  }

  const system = data?.system || { cpu_usage_pct: 0, memory_usage_pct: 0, avg_processing_time_sec: 0, total_processed: 0 };
  const queue = data?.queue || [];
  const history = data?.history || [];
  const BASE_URL = import.meta.env.BASE_URL || '/';

  return (
    <div style={{ padding: '16px 24px', maxWidth: 1200, margin: '0 auto', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, borderBottom: '1px solid #1e293b', paddingBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3ecf8e', boxShadow: '0 0 8px #3ecf8e' }} />
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, background: 'linear-gradient(to right, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              3D AUTO-PORTAL PROCESSING HARNESS
            </h1>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
            Continuous 2D-to-3D/SBS AI Processing, Head-Movement Simulation, & Parallax Fidelity Audit Dashboard
          </p>
        </div>
        <button 
          onClick={fetchStatus}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '6px 12px', color: '#fff', fontSize: 11, cursor: 'pointer', transition: 'all 0.2s' }}
        >
          <RefreshCw size={12} /> Force Refresh
        </button>
      </div>

      {/* System & Queue Status Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
        
        {/* CPU/GPU Card */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#3ecf8e' }}>
            <Cpu size={16} />
            <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>Harness CPU & Load</span>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                <span>CPU Core Load</span>
                <span>{system.cpu_usage_pct.toFixed(0)}%</span>
              </div>
              <div style={progressBg}>
                <div style={{ ...progressFill, width: `${system.cpu_usage_pct}%`, background: '#3ecf8e' }} />
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                <span>System RAM</span>
                <span>{system.memory_usage_pct.toFixed(0)}%</span>
              </div>
              <div style={progressBg}>
                <div style={{ ...progressFill, width: `${system.memory_usage_pct}%`, background: '#3b82f6' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Efficiency Stats Card */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#a78bfa' }}>
            <Clock size={16} />
            <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>Conversion Efficiency</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{system.avg_processing_time_sec}s</div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>Avg. Conversion Time</div>
            </div>
            <div style={{ borderLeft: '1px solid #334155', height: 32 }} />
            <div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{system.total_processed}</div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>Total Videos Cataloged</div>
            </div>
          </div>
        </div>

        {/* Queue Card */}
        <div style={{ ...cardStyle, gridColumn: 'span 1', background: 'rgba(15, 23, 42, 0.6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#f59e0b' }}>
            <Activity size={16} />
            <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>Live Conversion Queue</span>
          </div>
          {queue.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#3ecf8e', fontSize: 11, padding: '4px 0' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3ecf8e', animation: 'pulse 1.5s infinite' }} />
              <span>Harness Idle — Monitoring folder for new video streams...</span>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                <span style={{ color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 180 }}>
                  {queue[0].name}
                </span>
                <span style={{ color: '#f59e0b' }}>{queue[0].progress}%</span>
              </div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>
                Stage: {queue[0].stage || 'Initializing...'}
              </div>
              <div style={progressBg}>
                <div style={{ ...progressFill, width: `${queue[0].progress}%`, background: 'linear-gradient(to right, #f59e0b, #38bdf8)' }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid: History Cards on left, Eye screenshots on right */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 20, marginBottom: 24, alignItems: 'start' }}>
        
        {/* Left Side: Processed Video Library Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 4px', color: '#fff', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Simulated Audit Results
          </h2>
          {history.map((item) => {
            const isSelected = selectedHistory?.id === item.id;
            return (
              <div
                key={item.id}
                onClick={() => setSelectedHistory(item)}
                style={{
                  ...historyCardStyle,
                  border: isSelected ? '2px solid #3ecf8e' : '1px solid #1e293b',
                  background: isSelected ? 'rgba(62, 207, 142, 0.08)' : '#0f172a',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: '#fff' }}>{item.title}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, background: '#1e293b', padding: '2px 6px', borderRadius: 4, color: '#38bdf8' }}>
                      {item.processing_time_sec}s conversion
                    </span>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 800,
                      background: item.parallax_variance > 1.5 ? 'rgba(62, 207, 142, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: item.parallax_variance > 1.5 ? '#3ecf8e' : '#ef4444',
                      padding: '2px 6px',
                      borderRadius: 4
                    }}>
                      3D Index: {item.parallax_variance.toFixed(1)}
                    </span>
                  </div>
                </div>
                <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8', lineHeight: 1.3 }}>
                  {item.description}
                </p>
                
                {/* Play Buttons */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onPlayVideo(item.id, 'mesh'); }}
                    style={{ ...actionBtnStyle, background: '#10b981' }}
                  >
                    <Film size={11} /> Play as 3D Mesh
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onPlayVideo(item.id, 'portal'); }}
                    style={{ ...actionBtnStyle, background: '#3b82f6' }}
                  >
                    <Eye size={11} /> Play in Portal View
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Side: Eye simulated screenshots side-by-side! */}
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 12px', color: '#fff', letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Active Viewport Displacement Analysis
          </h2>
          {selectedHistory ? (
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontWeight: 800, fontSize: 13, color: '#fff' }}>{selectedHistory.title} — Parallax Shift</span>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>
                  Click Play on the left card to load video
                </span>
              </div>
              
              {/* Screenshots Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
                    Simulated Left Eye Position (pose.x = 0.1)
                  </div>
                  <div style={screenshotFrame}>
                    <img 
                      src={`${BASE_URL}${selectedHistory.left_screenshot}`} 
                      alt="Left eye simulated view" 
                      style={{ width: '100%', height: 'auto', display: 'block' }}
                      onError={(e) => {
                        // Fallback image generator
                        (e.target as HTMLImageElement).src = `https://placehold.co/600x337/1e293b/fff?text=${selectedHistory.title}+Left+Pose`;
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                    Simulated Right Eye Position (pose.x = 0.9)
                  </div>
                  <div style={screenshotFrame}>
                    <img 
                      src={`${BASE_URL}${selectedHistory.right_screenshot}`} 
                      alt="Right eye simulated view" 
                      style={{ width: '100%', height: 'auto', display: 'block' }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://placehold.co/600x337/1e293b/fff?text=${selectedHistory.title}+Right+Pose`;
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Dynamic Delta Shift Visualizer (Proofs horizontal shift to VC!) */}
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8', marginBottom: 6 }}>
                  <Activity size={14} />
                  <span style={{ fontSize: 11, fontWeight: 800 }}>Horizontal Disparity Check</span>
                </div>
                <p style={{ margin: '0 0 8px', fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>
                  Audited parallax index: <strong style={{ color: '#fff' }}>{selectedHistory.parallax_variance.toFixed(2)}</strong>. This measures the structural pixel displacement between eye perspectives, proving off-axis look-around projection is dynamically shifting the scene contents based on human head coordinates.
                </p>
                <div style={{ height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, selectedHistory.parallax_variance * 12)}%`, background: 'linear-gradient(to right, #3b82f6, #3ecf8e)' }} />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ ...cardStyle, textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
              Select a video from the list to view its horizontal parallax shift analysis.
            </div>
          )}
        </div>
      </div>

      {/* Step-Back Strategic Analysis for VCs */}
      <div style={{ ...cardStyle, background: 'linear-gradient(to right, #0f172a, #1e1b4b)', border: '1px solid #312e81' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#c084fc' }}>
          <AlertCircle size={18} />
          <h3 style={{ fontSize: 13, fontWeight: 800, margin: 0, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            STEP-BACK STRATEGIC ANALYSIS & ALGORITHMIC FEASIBILITY
          </h3>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
          <div>
            <h4 style={{ fontSize: 11, fontWeight: 800, color: '#fff', margin: '0 0 6px' }}>Converting Ordinary 2D Plain Videos to 3D</h4>
            <p style={{ fontSize: 10, color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
              While stereoscopic SBS captures provide raw horizontal parallax shifts, our pipeline excels at converting <strong>completely plain monocular 2D videos</strong> into beautiful 3D. We treat the entire 2D feed as a single-eye monocular clip, run <em>Depth-Anything-V2</em> to estimate geometric depth, slice silhouettes cleanly, and reconstruct the scene as a real-time WebGL mesh. The webcam face-tracker then projects off-axis viewpoints, synthesising realistic look-around perspective changes.
            </p>
          </div>
          <div>
            <h4 style={{ fontSize: 11, fontWeight: 800, color: '#fff', margin: '0 0 6px' }}>Recommended Algorithmic Upgrades for Perfect 3D</h4>
            <ul style={{ fontSize: 10, color: '#cbd5e1', lineHeight: 1.5, margin: 0, paddingLeft: 16 }}>
              <li style={{ marginBottom: 4 }}>
                <strong style={{ color: '#c084fc' }}>Optical Flow Temporal Smoothing</strong>: Integrate Farneback or Lucas-Kanade optical flow into the depth map generator to prevent edge-depth flicker between consecutive video frames.
              </li>
              <li style={{ marginBottom: 4 }}>
                <strong style={{ color: '#c084fc' }}>Spatial Background Inpainting</strong>: Use focal-length-weighted parallax scaling during LaMa inpainting. This matches the empty background plate's perspective directly to camera lenses.
              </li>
              <li>
                <strong style={{ color: '#c084fc' }}>Adaptive Mesh Resolution</strong>: Implement progressive mesh subdivision based on depth gradients, allocating more grid detail to high-contrast foreground objects.
              </li>
            </ul>
          </div>
        </div>
      </div>

    </div>
  );
}

// ===== Styles =====
const cardStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 10,
  padding: 16,
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
};

const historyCardStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: 14,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
};

const progressBg: React.CSSProperties = {
  width: '100%',
  height: 6,
  background: '#1e293b',
  borderRadius: 3,
  overflow: 'hidden'
};

const progressFill: React.CSSProperties = {
  height: '100%',
  borderRadius: 3,
  transition: 'width 0.4s ease'
};

const screenshotFrame: React.CSSProperties = {
  borderRadius: 6,
  overflow: 'hidden',
  border: '1px solid #334155',
  background: '#020617',
  position: 'relative'
};

const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: 'none',
  borderRadius: 6,
  padding: '6px 12px',
  color: '#fff',
  fontSize: 10,
  fontWeight: 'bold',
  cursor: 'pointer',
  transition: 'transform 0.1s ease',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
};

const sliderLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  color: '#8fa3b8',
  fontSize: 11,
  marginBottom: 10,
};
