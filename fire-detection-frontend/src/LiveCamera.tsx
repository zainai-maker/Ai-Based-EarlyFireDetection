import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, CircleStop, Info, Play, Radio, WifiOff } from 'lucide-react';
import './live-camera.css';

type CameraStatus = 'idle' | 'starting' | 'connecting' | 'monitoring' | 'interrupted';
type Detection = {
  class: string;
  confidence: number;
  bbox: number[];
};
type PredictionMessage = {
  type: 'prediction';
  fire_detected: boolean;
  smoke_detected: boolean;
  detections: Detection[];
};

const TARGET_WIDTH = 640;
const SEND_INTERVAL_MS = 500; // up to 2 frames per second, one in flight
const RESPONSE_TIMEOUT_MS = 12_000;

function cameraError(error: unknown): string {
  if (!(error instanceof DOMException)) return 'Unable to start the camera.';
  if (error.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in browser settings.';
  if (error.name === 'NotFoundError') return 'No usable camera was found on this device.';
  if (error.name === 'NotReadableError') return 'Your camera may already be in use by another application.';
  return `Could not open camera: ${error.message}`;
}

export default function LiveCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const requestSentAtRef = useRef(0);
  const sessionRef = useRef(0);
  const activeRef = useRef(false);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [errorText, setErrorText] = useState('');
  const [detections, setDetections] = useState<Detection[]>([]);
  const [frameSize, setFrameSize] = useState({ width: TARGET_WIDTH, height: 360 });
  const [processedFrames, setProcessedFrames] = useState(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastResultAt, setLastResultAt] = useState<string | null>(null);

  const releaseResources = useCallback(() => {
    activeRef.current = false;
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
    inFlightRef.current = false;

    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'Camera session stopped');
      }
    }

    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const interrupt = useCallback((message: string) => {
    sessionRef.current += 1;
    releaseResources();
    setDetections([]);
    setStatus('interrupted');
    setErrorText(message);
  }, [releaseResources]);

  const stopCamera = useCallback(() => {
    sessionRef.current += 1;
    releaseResources();
    setStatus('idle');
    setErrorText('');
    setDetections([]);
    setLatencyMs(null);
    setLastResultAt(null);
  }, [releaseResources]);

  // No camera processing continues after leaving this page or hiding the browser tab.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && activeRef.current) {
        interrupt('Camera stopped because this tab is no longer visible. Restart to monitor again.');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      sessionRef.current += 1;
      releaseResources();
    };
  }, [interrupt, releaseResources]);

  const sendFrame = useCallback((session: number) => {
    const video = videoRef.current;
    const socket = socketRef.current;
    if (
      session !== sessionRef.current || document.hidden || inFlightRef.current ||
      !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !socket || socket.readyState !== WebSocket.OPEN
    ) return;

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (sourceWidth <= 0 || sourceHeight <= 0) return;

    const width = Math.min(TARGET_WIDTH, sourceWidth);
    const height = Math.round(width * sourceHeight / sourceWidth);
    const canvas = canvasRef.current ?? document.createElement('canvas');
    canvasRef.current = canvas;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      interrupt('Unable to capture camera frames on this browser.');
      return;
    }
    context.drawImage(video, 0, 0, width, height);
    setFrameSize((old) => old.width === width && old.height === height ? old : { width, height });

    // Wait for each model result before sending another frame.
    inFlightRef.current = true;
    canvas.toBlob(async (blob) => {
      if (session !== sessionRef.current) return;
      if (!blob) {
        inFlightRef.current = false;
        return;
      }
      try {
        const bytes = await blob.arrayBuffer();
        if (session !== sessionRef.current || socket.readyState !== WebSocket.OPEN) return;
        requestSentAtRef.current = performance.now();
        socket.send(bytes);
        timeoutRef.current = window.setTimeout(() => {
          if (session === sessionRef.current && inFlightRef.current) {
            interrupt('The AI backend did not respond in time. Monitoring stopped.');
          }
        }, RESPONSE_TIMEOUT_MS);
      } catch {
        if (session === sessionRef.current) interrupt('Failed to send a camera frame to the AI backend.');
      }
    }, 'image/jpeg', 0.72);
  }, [interrupt]);

  const startCamera = useCallback(async () => {
    if (activeRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('interrupted');
      setErrorText('Camera access requires localhost or a secure HTTPS address.');
      return;
    }

    releaseResources();
    const session = ++sessionRef.current;
    activeRef.current = true;
    setStatus('starting');
    setErrorText('');
    setDetections([]);
    setProcessedFrames(0);
    setLatencyMs(null);
    setLastResultAt(null);

    try {
      // Permission is requested only after clicking Start Camera.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } },
      });
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Video preview is unavailable.');
      video.srcObject = stream;
      await video.play();
      if (session !== sessionRef.current) return;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setFrameSize({ width: video.videoWidth, height: video.videoHeight });
      }

      const track = stream.getVideoTracks()[0];
      if (track) track.onended = () => {
        if (session === sessionRef.current) interrupt('Camera disconnected. Monitoring has stopped.');
      };

      setStatus('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
      socketRef.current = socket;

      socket.onopen = () => {
        if (session !== sessionRef.current) return;
        setStatus('monitoring');
        intervalRef.current = window.setInterval(() => sendFrame(session), SEND_INTERVAL_MS);
        sendFrame(session);
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        if (session !== sessionRef.current) return;
        if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        inFlightRef.current = false;

        try {
          const message: PredictionMessage | { type: 'error'; message: string } = JSON.parse(event.data);
          if (message.type === 'error') {
            setErrorText(message.message);
            setDetections([]);
            return;
          }
          if (!Array.isArray(message.detections)) return;
          setErrorText('');
          setDetections(message.detections);
          setProcessedFrames((total) => total + 1);
          setLatencyMs(Math.round(performance.now() - requestSentAtRef.current));
          setLastResultAt(new Date().toLocaleTimeString());
        } catch {
          interrupt('The AI backend sent an invalid response.');
        }
      };

      socket.onerror = () => {
        // onclose provides the actionable message.
      };
      socket.onclose = () => {
        if (session === sessionRef.current) {
          interrupt('Connection to the AI backend was lost. Monitoring stopped.');
        }
      };
    } catch (error) {
      if (session === sessionRef.current) interrupt(cameraError(error));
    }
  }, [interrupt, releaseResources, sendFrame]);

  const fireCount = detections.filter((d) => d.class === 'fire').length;
  const smokeCount = detections.filter((d) => d.class === 'smoke').length;
  const isRunning = status === 'starting' || status === 'connecting' || status === 'monitoring';
  const statusLabel: Record<CameraStatus, string> = {
    idle: 'Not monitoring',
    starting: 'Waiting for camera',
    connecting: 'Connecting to AI',
    monitoring: 'AI analyzing camera',
    interrupted: 'Monitoring interrupted',
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">EXPERIMENTAL LIVE INFERENCE</div>
          <h1>Live camera</h1>
          <p>Use your laptop webcam to test fire and smoke detection in real time.</p>
        </div>
      </div>
      <div className="notice" role="note">
        <Info size={20} aria-hidden="true" />
        <div>
          <strong>Academic demo - not a safety monitoring service</strong>
          <span>Frames are analyzed by your local FastAPI server. No verified alarm or incident is generated in this stage. A missing detection is not proof of safety.</span>
        </div>
      </div>
      <section className="panel live-panel" aria-label="Live camera workspace">
        <div className="panel-header">
          <div><h2>Camera preview</h2><p>Start manually. Camera access ends when you leave this page.</p></div>
          <div className={`live-state live-state-${status}`} role="status" aria-live="polite">
            <span className="live-state-dot" /> {statusLabel[status]}
          </div>
        </div>

        <div className="live-camera-frame" style={isRunning ? { aspectRatio: `${frameSize.width} / ${frameSize.height}` } : undefined}>
          <video ref={videoRef} autoPlay playsInline muted className="live-video" aria-label="Live laptop camera preview" />
          {status === 'monitoring' && detections.length > 0 && (
            <svg className="live-overlay" viewBox={`0 0 ${frameSize.width} ${frameSize.height}`} preserveAspectRatio="none" aria-hidden="true">
              {detections.filter((d) => d.bbox.length === 4).map((d, index) => {
                const x = Math.max(0, d.bbox[0]);
                const y = Math.max(0, d.bbox[1]);
                const width = Math.max(0, d.bbox[2] - d.bbox[0]);
                const height = Math.max(0, d.bbox[3] - d.bbox[1]);
                return (
                  <g key={index} className={d.class === 'fire' ? 'live-fire-box' : 'live-smoke-box'}>
                    <rect x={x} y={y} width={width} height={height} />
                    <text x={x + 3} y={Math.max(16, y - 7)}>{d.class} {Math.round(d.confidence * 100)}%</text>
                  </g>
                );
              })}
            </svg>
          )}
          {!isRunning && <div className="live-camera-placeholder"><Camera size={36} aria-hidden="true" /><strong>Camera is off</strong><span>Click Start Camera to begin a local AI test.</span></div>}
          {status === 'connecting' && <div className="live-camera-connecting">Connecting to inference backend...</div>}
        </div>

        <div className="live-controls">
          <div className="live-control-actions">
            <button type="button" className="button button-primary" onClick={() => void startCamera()} disabled={isRunning}>
              <Play size={17} aria-hidden="true" /> Start Camera
            </button>
            <button type="button" className="button button-secondary" onClick={stopCamera} disabled={!isRunning}>
              <CircleStop size={17} aria-hidden="true" /> Stop Camera
            </button>
          </div>
          <span className="live-privacy-note"><Radio size={15} aria-hidden="true" /> No audio or video recording in this stage</span>
        </div>
        {errorText && <div className="inline-error live-error" role="alert"><AlertCircle size={18} aria-hidden="true" />{errorText}</div>}
      </section>

      <div className="live-stats" aria-label="Current AI predictions">
        <div className="panel live-stat"><span>Fire objects in latest frame</span><strong className={fireCount > 0 ? 'text-danger' : ''}>{status === 'monitoring' ? fireCount : '--'}</strong><small>Prediction, not a verified incident</small></div>
        <div className="panel live-stat"><span>Smoke objects in latest frame</span><strong className={smokeCount > 0 ? 'text-amber' : ''}>{status === 'monitoring' ? smokeCount : '--'}</strong><small>Prediction, not a verified incident</small></div>
        <div className="panel live-stat"><span>Frames analyzed</span><strong>{processedFrames}</strong><small>Since the camera was started</small></div>
        <div className="panel live-stat"><span>Last inference latency</span><strong>{latencyMs === null ? '--' : `${latencyMs} ms`}</strong><small>{lastResultAt ? `Updated ${lastResultAt}` : 'No result received yet'}</small></div>
      </div>
      {status === 'interrupted' && <p className="live-interruption"><WifiOff size={16} aria-hidden="true" /> Monitoring has stopped. Correct the problem and click Start Camera.</p>}
    </>
  );
}
