# Fire Detection FYP - React Frontend

A practical frontend starter for the existing FastAPI API.
This is an academic prototype, not an operational fire-safety system.

## Requirements

- Node.js 20.19+ or 22.12+ (or a newer compatible release)
- Existing backend running at http://127.0.0.1:8000

## Run

Terminal 1: In the existing backend/ folder:

    uv run uvicorn backend.main:app --reload --app-dir src

Terminal 2: In this frontend/ folder:

    npm install
    npm run dev

Open http://localhost:5173 in a browser.

## API wiring

The Vite development proxy maps REST API and live WebSocket traffic to the
FastAPI backend without enabling a broad CORS policy.

- GET /api/ -> GET /
- GET /api/incidents?limit=50 -> GET /incidents?limit=50
- POST /api/predict/image -> POST /predict/image
- POST /api/predict/video -> POST /predict/video
- GET /api/videos/{uuid} -> GET /videos/{uuid}
- WS /ws/live -> WS /ws/live

Make sure FastAPI is running before opening the frontend. The proxy works
only in Vite development. Production deployment needs an equivalent proxy
or an explicitly configured API URL and CORS policy.

## Features

- Dashboard with API connectivity and counts from actual saved incidents
- Image prediction upload; bounding boxes overlaid on original image
- Video upload; alert summary and processed-video download link
- Incident history; filter by alert type and refresh
- Live Camera route (`#live`); manual webcam start/stop, local WebSocket
  inference, bounding boxes, confidence labels, connection status, and errors
- Honest safety labels: recorded-media prototype, not live surveillance

## Known MVP limitations

- Backend currently limits images to 10 MB, video files to 100 MB and
  video duration to about 60 seconds.
- Image results are single-frame detections; video alerts use your existing
  multi-frame confirmation logic.
- MP4 files generated with OpenCV's mp4v codec may not play natively in
  all browsers; downloaded results can be opened in a player like VLC.
- Incident list only loads up to 50 most recent records, so displayed
  counts are for the loaded history, not the full database.
- Live Camera is intended for local development at `http://localhost:5173` or
  `http://127.0.0.1:5173`. It requires browser camera permission and a running
  backend. The browser sends JPEG frames to the FastAPI WebSocket; frames are
  not saved and live detections do not create SQLite incidents.
- No authentication, remote CCTV capture, or safety-certified controls.
