import React, { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { HeadPose, HeadPoseTracker } from '../utils/headPose';

declare global {
  interface Window {
    FaceMesh: any;
    Camera: any;
    drawConnectors: any;
    drawLandmarks: any;
    FACEMESH_TESSELATION: any;
    FACEMESH_RIGHT_EYE: any;
    FACEMESH_LEFT_EYE: any;
  }
}

interface Props {
  onHeadPose: (pose: HeadPose | null) => void;
  smoothingFactor?: number;
  autoCalibrate?: boolean;
}

const FaceTracker: React.FC<Props> = ({ onHeadPose, smoothingFactor = 0.3, autoCalibrate = false }) => {
  const webcamRef = useRef<Webcam | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tracker = useRef(new HeadPoseTracker(smoothingFactor));
  const cameraRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const calibStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      const waitForMp = async () => {
        for (let i = 0; i < 50; i++) {
          if (window.FaceMesh && window.Camera) return true;
          await new Promise((r) => setTimeout(r, 100));
        }
        return false;
      };
      if (!(await waitForMp())) {
        setError('MediaPipe failed to load (need internet for CDN)');
        return;
      }
      if (cancelled || !webcamRef.current?.video) return;

      const video = webcamRef.current.video;
      const faceMesh = new window.FaceMesh({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults((results: any) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

        if (results.multiFaceLandmarks?.[0]) {
          const lm = results.multiFaceLandmarks[0];
          if (window.drawConnectors && window.FACEMESH_TESSELATION) {
            window.drawConnectors(ctx, lm, window.FACEMESH_TESSELATION, {
              color: '#5b9fd488',
              lineWidth: 0.5,
            });
          }
          // mirrored x for pose (webcam is mirrored)
          const mirrored = lm.map((p: { x: number; y: number; z: number }) => ({
            x: 1 - p.x,
            y: p.y,
            z: p.z,
          }));
          const pose = tracker.current.updateFromLandmarks(mirrored);
          if (autoCalibrate && !calibStarted.current && pose) {
            calibStarted.current = true;
            tracker.current.startCalibration(20);
          }
          onHeadPose(pose);
          setTracking(true);
        } else {
          onHeadPose(null);
          setTracking(false);
        }
        ctx.restore();
      });

      cameraRef.current = new window.Camera(video, {
        onFrame: async () => {
          await faceMesh.send({ image: video });
        },
        width: 640,
        height: 480,
      });
      await cameraRef.current.start();
      setReady(true);
    };

    const t = setTimeout(() => void start(), 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
      cameraRef.current?.stop?.();
    };
  }, [onHeadPose]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      <Webcam
        ref={webcamRef}
        mirrored
        audio={false}
        videoConstraints={{ facingMode: 'user', width: 640, height: 480 }}
        onUserMedia={() => setReady(true)}
        onUserMediaError={(e) =>
          setError(typeof e === 'string' ? e : e.message || 'Camera denied')
        }
        style={{ display: 'none' }}
      />
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div
        style={{
          position: 'absolute',
          left: 6,
          bottom: 6,
          fontSize: 11,
          color: '#e8eef4',
          background: 'rgba(0,0,0,0.55)',
          padding: '2px 6px',
          borderRadius: 4,
        }}
      >
        {error ? error : tracking ? 'tracking' : ready ? 'looking for face…' : 'starting…'}
      </div>
    </div>
  );
};

export default FaceTracker;
