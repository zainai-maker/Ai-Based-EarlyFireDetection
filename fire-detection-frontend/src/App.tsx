import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  Database,
  FileImage,
  Film,
  Flame,
  Info,
  LayoutDashboard,
  RefreshCw,
  ShieldAlert,
  UploadCloud,
  Video,
  Wind,
} from 'lucide-react';

type Page = 'overview' | 'analyze' | 'incidents';
type MediaMode = 'image' | 'video';
type ApiStatus = 'checking' | 'online' | 'offline';

type Incident = {
  id: number;
  video_id: string;
  filename: string;
  alert_type: string;
  video_time_seconds: number;
  confidence: number;
  created_at: string;
  video_url: string;
};

type Detection = {
  class: string;
  confidence: number;
  bbox: number[];
};

type ImageResult = {
  filename: string;
  fire_detected: boolean;
  smoke_detected: boolean;
  detections: Detection[];
};

type VideoAlert = {
  type: string;
  timestamp_seconds: number;
  confidence: number;
};

type VideoResult = {
  video_id: string;
  frames_processed: number;
  fire_detected: boolean;
  smoke_detected: boolean;
  fire_frames: number;
  smoke_frames: number;
  fire_alert: boolean;
  smoke_alert: boolean;
  alert_count: number;
  saved_incidents: number;
  alerts: VideoAlert[];
  download_url: string;
};

type AnalysisResult =
  | { mode: 'image'; data: ImageResult }
  | { mode: 'video'; data: VideoResult };

const NAV_ITEMS = [
  { id: 'overview' as Page, label: 'Overview', Icon: LayoutDashboard },
  { id: 'analyze' as Page, label: 'Analyze media', Icon: Activity },
  { id: 'incidents' as Page, label: 'Incident history', Icon: Database },
];

function pageFromHash(): Page {
  const name = window.location.hash.replace('#', '');
  return name === 'analyze' || name === 'incidents' ? name : 'overview';
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formattedDate(utcDate: string): string {
  const iso = utcDate.includes('T') ? utcDate : utcDate.replace(' ', 'T');
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? utcDate : date.toLocaleString();
}

function resultLink(path: string): string | null {
  return /^\/videos\/[0-9a-f-]{36}$/.test(path) ? `/api${path}` : null;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === 'string') return body.detail;
  } catch {
    // The backend may return plain text or an empty error body.
  }
  return `Request failed (${response.status})`;
}

function IncidentTable({ incidents }: { incidents: Incident[] }) {
  if (incidents.length === 0) {
    return (
      <div className="empty-state">
        <Database size={28} aria-hidden="true" />
        <strong>No incident alerts in this view</strong>
        <p>Confirmed alerts from processed videos will appear here.</p>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Source video</th>
            <th scope="col">Detected at</th>
            <th scope="col">Confidence</th>
            <th scope="col">Saved</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((item) => {
            const href = resultLink(item.video_url);
            const isFire = item.alert_type.toLowerCase() === 'fire';
            return (
              <tr key={item.id}>
                <td>
                  <span className={`event-type ${isFire ? 'event-fire' : 'event-smoke'}`}>
                    {isFire ? <Flame size={14} aria-hidden="true" /> : <Wind size={14} aria-hidden="true" />}
                    {item.alert_type}
                  </span>
                </td>
                <td className="source-cell" title={item.filename}>{item.filename}</td>
                <td>{item.video_time_seconds.toFixed(1)}s into video</td>
                <td className="number-cell">{percent(item.confidence)}</td>
                <td className="muted-cell">{formattedDate(item.created_at)}</td>
                <td>
                  {href ? (
                    <a className="table-link" href={href} download>
                      Download <ArrowDownToLine size={14} aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="muted-cell">Unavailable</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [filter, setFilter] = useState<'all' | 'fire' | 'smoke'>('all');
  const [mediaMode, setMediaMode] = useState<MediaMode>('image');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);

  const loadIncidents = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await fetch('/api/incidents?limit=50');
      if (!response.ok) throw new Error(await readError(response));
      const data: { incidents?: Incident[] } = await response.json();
      setIncidents(Array.isArray(data.incidents) ? data.incidents : []);
      setApiStatus('online');
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Unable to load incident history.');
      setApiStatus('offline');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  useEffect(() => {
    const sync = () => setPage(pageFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    setImageDimensions(null);
    if (mediaMode !== 'image' || !selectedFile) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile, mediaMode]);

  function navigate(nextPage: Page) {
    setPage(nextPage);
    window.location.hash = nextPage;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function switchMode(mode: MediaMode) {
    setMediaMode(mode);
    setSelectedFile(null);
    setUploadError('');
    setAnalysis(null);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setUploadError('');
    setAnalysis(null);

    if (!file) return;
    const extension = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    const validImage = mediaMode === 'image' && ['.jpg', '.jpeg', '.png'].includes(extension);
    const validVideo = mediaMode === 'video' && ['.mp4', '.mov', '.mkv', '.avi'].includes(extension);
    const maxSize = mediaMode === 'image' ? 10 * 1024 * 1024 : 100 * 1024 * 1024;

    if (!validImage && !validVideo) {
      setUploadError(`Unsupported file. Select ${mediaMode === 'image' ? 'JPG or PNG' : 'MP4, MOV, AVI, or MKV'}.`);
      setSelectedFile(null);
    } else if (file.size > maxSize) {
      setUploadError(`File is too large. Maximum ${mediaMode === 'image' ? '10' : '100'} MB.`);
      setSelectedFile(null);
    }
  }

  async function analyzeFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || busy) return;

    setBusy(true);
    setUploadError('');
    setAnalysis(null);

    const body = new FormData();
    body.append('file', selectedFile);

    try {
      const response = await fetch(`/api/predict/${mediaMode}`, {
        method: 'POST',
        body,
      });
      if (!response.ok) throw new Error(await readError(response));

      if (mediaMode === 'image') {
        const data: ImageResult = await response.json();
        setAnalysis({ mode: 'image', data });
      } else {
        const data: VideoResult = await response.json();
        setAnalysis({ mode: 'video', data });
        void loadIncidents();
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not process this file.');
    } finally {
      setBusy(false);
    }
  }

  const fireIncidents = incidents.filter((item) => item.alert_type.toLowerCase() === 'fire');
  const smokeIncidents = incidents.filter((item) => item.alert_type.toLowerCase() === 'smoke');
  const filteredIncidents = filter === 'all' ? incidents : incidents.filter((item) => item.alert_type.toLowerCase() === filter);
  const lastIncident = incidents[0];

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark"><ShieldAlert size={23} aria-hidden="true" /></div>
          <div>
            <div className="brand-name">Fire Detection</div>
            <div className="brand-subtitle">Safety research console</div>
          </div>
        </div>
        <div className="sidebar-caption">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main pages">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button key={id} className={`nav-link ${page === id ? 'active' : ''}`} type="button" onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}>
              <Icon size={19} aria-hidden="true" /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="prototype-note">
          <Info size={18} aria-hidden="true" />
          <div><strong>Research prototype</strong><span>AI predictions are experimental and must not replace certified fire or gas protection.</span></div>
        </div>
        <div className="sidebar-footer">FINAL YEAR PROJECT <span>v0.1</span></div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="breadcrumb-sep">/</span><strong>{NAV_ITEMS.find((item) => item.id === page)?.label}</strong></div>
          <div className="topbar-statuses">
            <span className="pill muted-pill">Uploaded media only</span>
            <span className={`pill api-pill ${apiStatus}`} role="status">
              <span className="status-dot" />
              {apiStatus === 'online' ? 'API connected' : apiStatus === 'checking' ? 'Connecting...' : 'API unavailable'}
            </span>
          </div>
        </header>

        <main className="content-area">
          {page === 'overview' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MONITORING OVERVIEW</div>
                  <h1>Fire & Smoke Detection</h1>
                  <p>Review AI-assisted predictions and confirmed alerts from recorded media.</p>
                </div>
                <button className="button button-primary" type="button" onClick={() => navigate('analyze')}>
                  <UploadCloud size={18} aria-hidden="true" /> Analyze media
                </button>
              </div>

              <div className="notice" role="note">
                <AlertCircle size={20} aria-hidden="true" />
                <div><strong>Academic prototype - not live monitoring</strong><span>The dashboard reflects uploaded video analyses. No live camera or gas-leak sensing is connected.</span></div>
              </div>

              <div className="metric-grid">
                <div className="metric-card">
                  <div className="metric-icon slate"><Database size={20} aria-hidden="true" /></div>
                  <span className="metric-label">Loaded incidents</span><strong className="metric-value">{incidents.length}</strong><span className="metric-detail">Latest 50 database records</span>
                </div>
                <div className="metric-card">
                  <div className="metric-icon danger"><Flame size={20} aria-hidden="true" /></div>
                  <span className="metric-label">Fire alerts</span><strong className="metric-value">{fireIncidents.length}</strong><span className="metric-detail">In loaded history</span>
                </div>
                <div className="metric-card">
                  <div className="metric-icon amber"><Wind size={20} aria-hidden="true" /></div>
                  <span className="metric-label">Smoke alerts</span><strong className="metric-value">{smokeIncidents.length}</strong><span className="metric-detail">In loaded history</span>
                </div>
                <div className="metric-card">
                  <div className="metric-icon slate"><Clock3 size={20} aria-hidden="true" /></div>
                  <span className="metric-label">Latest saved alert</span><strong className="metric-value metric-date">{lastIncident ? formattedDate(lastIncident.created_at) : 'None yet'}</strong><span className="metric-detail">Date shown in your local time</span>
                </div>
              </div>

              <div className="overview-grid">
                <section className="panel recent-panel">
                  <div className="panel-header"><div><h2>Recent incidents</h2><p>AI-confirmed events from processed videos</p></div><button className="text-button" type="button" onClick={() => navigate('incidents')}>View all <ArrowRight size={16} aria-hidden="true" /></button></div>
                  {historyError ? <p className="inline-error" role="alert">{historyError}</p> : <IncidentTable incidents={incidents.slice(0, 5)} />}
                </section>
                <aside className="panel getting-started">
                  <div className="side-panel-icon"><Video size={24} aria-hidden="true" /></div>
                  <h2>Analyze a new recording</h2>
                  <p>Upload an image or a short recorded CCTV clip. The backend will detect visible fire and smoke using your fine-tuned YOLO model.</p>
                  <button className="button button-secondary full-button" type="button" onClick={() => navigate('analyze')}>Open analysis workspace <ArrowRight size={16} aria-hidden="true" /></button>
                  <div className="panel-footnote"><Info size={16} aria-hidden="true" /> Lack of a detection does not mean the scene is safe.</div>
                </aside>
              </div>
            </>
          )}

          {page === 'analyze' && (
            <>
              <div className="page-heading"><div><div className="eyebrow">AI INFERENCE WORKSPACE</div><h1>Analyze media</h1><p>Run your trained YOLO model on an image or recorded video.</p></div></div>
              <div className="notice" role="note"><Info size={20} aria-hidden="true" /><div><strong>Model-assisted detection</strong><span>Predictions may contain false positives and missed fire or smoke. Video alerts are based on your existing multi-frame rule.</span></div></div>
              <section className="panel upload-panel">
                <div className="mode-tabs" role="group" aria-label="Analysis media type">
                  <button type="button" aria-pressed={mediaMode === 'image'} className={mediaMode === 'image' ? 'selected' : ''} onClick={() => switchMode('image')} disabled={busy}><FileImage size={18} aria-hidden="true" /> Image analysis</button>
                  <button type="button" aria-pressed={mediaMode === 'video'} className={mediaMode === 'video' ? 'selected' : ''} onClick={() => switchMode('video')} disabled={busy}><Film size={18} aria-hidden="true" /> Video analysis</button>
                </div>
                <form className="upload-form" onSubmit={analyzeFile}>
                  <label className="upload-area">
                    <UploadCloud size={32} aria-hidden="true" />
                    <strong>{selectedFile ? selectedFile.name : `Select ${mediaMode === 'image' ? 'an image' : 'a recorded video'}`}</strong>
                    <span>{mediaMode === 'image' ? 'JPG or PNG, up to 10 MB' : 'MP4, MOV, AVI or MKV, up to 100 MB and approximately 60 seconds'}</span>
                    <span className="choose-label">Browse files</span>
                    <input key={mediaMode} type="file" accept={mediaMode === 'image' ? '.jpg,.jpeg,.png,image/jpeg,image/png' : '.mp4,.mov,.mkv,.avi'} onChange={chooseFile} disabled={busy} aria-label={`Choose ${mediaMode} file`} />
                  </label>
                  {uploadError && <div className="inline-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{uploadError}</div>}
                  <div className="upload-actions">
                    <span>{selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB selected` : 'Choose a file to enable analysis'}</span>
                    <button className="button button-primary" disabled={!selectedFile || busy} type="submit">
                      {busy ? <RefreshCw size={17} className="spinning" aria-hidden="true" /> : <Activity size={17} aria-hidden="true" />}
                      {busy ? 'Processing media...' : 'Run AI analysis'}
                    </button>
                  </div>
                  {busy && <p className="processing-message" role="status">Processing on your local backend. Video analysis can take longer than image analysis.</p>}
                </form>
              </section>

              {analysis?.mode === 'image' && (
                <section className="panel results-panel" aria-live="polite">
                  <div className="panel-header"><div><h2>Image prediction results</h2><p>{analysis.data.filename}</p></div><span className="tag">{analysis.data.detections.length} objects detected</span></div>
                  <div className="result-grid">
                    <div className="image-preview-panel">
                      {previewUrl && <div className="image-preview">
                        <img src={previewUrl} alt="Your uploaded image with optional AI bounding-box overlay" onLoad={(event) => setImageDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
                        {imageDimensions && (
                          <svg aria-hidden="true" viewBox={`0 0 ${imageDimensions.width} ${imageDimensions.height}`} preserveAspectRatio="xMidYMid meet" className="bbox-layer">
                            {analysis.data.detections.filter((d) => d.bbox.length === 4).map((d, index) => (
                              <rect key={index} className={d.class === 'fire' ? 'bbox-fire' : 'bbox-smoke'} x={d.bbox[0]} y={d.bbox[1]} width={Math.max(0, d.bbox[2] - d.bbox[0])} height={Math.max(0, d.bbox[3] - d.bbox[1])} />
                            ))}
                          </svg>
                        )}
                      </div>}
                      <span className="preview-caption">Model bounding boxes drawn over your original image</span>
                    </div>
                    <div className="result-summary">
                      <h3>Prediction summary</h3>
                      <div className="summary-row"><span>Fire detected</span><strong className={analysis.data.fire_detected ? 'text-danger' : ''}>{analysis.data.fire_detected ? 'Yes' : 'Not detected'}</strong></div>
                      <div className="summary-row"><span>Smoke detected</span><strong className={analysis.data.smoke_detected ? 'text-amber' : ''}>{analysis.data.smoke_detected ? 'Yes' : 'Not detected'}</strong></div>
                      <h4>Detected objects</h4>
                      {analysis.data.detections.length === 0 ? <p className="result-empty">No objects detected above the configured confidence threshold.</p> : (
                        <ul className="detection-list">{analysis.data.detections.map((d, index) => <li key={index}><span className={`event-type ${d.class === 'fire' ? 'event-fire' : 'event-smoke'}`}>{d.class}</span><strong>{percent(d.confidence)}</strong></li>)}</ul>
                      )}
                      <p className="disclaimer">Not detecting fire does not certify that an image is safe.</p>
                    </div>
                  </div>
                </section>
              )}

              {analysis?.mode === 'video' && (
                <section className="panel results-panel" aria-live="polite">
                  <div className="panel-header"><div><h2>Video analysis complete</h2><p>{analysis.data.frames_processed} frames processed</p></div><span className="tag">{analysis.data.alert_count} confirmed AI alerts</span></div>
                  <div className="video-summary-grid">
                    <div className="mini-stat"><span>Fire prediction frames</span><strong>{analysis.data.fire_frames}</strong></div>
                    <div className="mini-stat"><span>Smoke prediction frames</span><strong>{analysis.data.smoke_frames}</strong></div>
                    <div className="mini-stat"><span>Fire alert</span><strong>{analysis.data.fire_alert ? 'Confirmed by rule' : 'Not confirmed'}</strong></div>
                    <div className="mini-stat"><span>Smoke alert</span><strong>{analysis.data.smoke_alert ? 'Confirmed by rule' : 'Not confirmed'}</strong></div>
                  </div>
                  {analysis.data.alerts.length > 0 ? (
                    <div className="alert-list"><h3>Alert events</h3>{analysis.data.alerts.map((alert, index) => <div className="alert-item" key={index}><BellRing size={17} aria-hidden="true" /><span><strong>{alert.type.toUpperCase()} detected</strong><small>At {alert.timestamp_seconds.toFixed(1)}s into the video</small></span><strong>{percent(alert.confidence)}</strong></div>)}</div>
                  ) : <div className="soft-message"><CheckCircle2 size={19} aria-hidden="true" /> No multi-frame alert was confirmed. This is not an all-clear safety assessment.</div>}
                  {resultLink(analysis.data.download_url) && <a className="button button-primary download-button" href={resultLink(analysis.data.download_url)!} download><ArrowDownToLine size={18} aria-hidden="true" /> Download annotated video</a>}
                  <p className="disclaimer">Some browser video players cannot play OpenCV MP4V files directly. Use a desktop video player if needed.</p>
                </section>
              )}
            </>
          )}

          {page === 'incidents' && (
            <>
              <div className="page-heading"><div><div className="eyebrow">DETECTION EVIDENCE</div><h1>Incident history</h1><p>Saved AI-confirmed video alerts from the local SQLite database.</p></div><button type="button" className="button button-secondary" onClick={() => void loadIncidents()} disabled={historyLoading}><RefreshCw size={17} className={historyLoading ? 'spinning' : ''} aria-hidden="true" /> Refresh</button></div>
              <section className="panel history-panel">
                <div className="panel-header history-header"><div><h2>Saved alerts</h2><p>Showing up to 50 most recent records; not a full database count.</p></div><div className="filter-control"><label htmlFor="incident-filter">Type</label><select id="incident-filter" value={filter} onChange={(event) => setFilter(event.target.value as 'all' | 'fire' | 'smoke')}><option value="all">All alerts</option><option value="fire">Fire</option><option value="smoke">Smoke</option></select></div></div>
                {historyLoading && <p className="loading-label" role="status">Loading incident history...</p>}
                {historyError && <p className="inline-error" role="alert"><AlertCircle size={17} aria-hidden="true" />{historyError}</p>}
                {!historyLoading && !historyError && <IncidentTable incidents={filteredIncidents} />}
              </section>
            </>
          )}

          <footer className="main-footer">AI-assisted fire & smoke detection <span>Experimental FYP prototype - not a certified safety system</span></footer>
        </main>
      </div>
    </div>
  );
}
