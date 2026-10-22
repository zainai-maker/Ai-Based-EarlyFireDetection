"""Local-only WebSocket for experimental webcam inference.

Client sends one JPEG image at a time; server returns prediction JSON.
Frames are not saved. This endpoint does not generate verified alerts.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from .detector import detect_image

router = APIRouter()
ALLOWED_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}
MAX_FRAME_BYTES = 1_000_000


@router.websocket("/ws/live")
async def live_inference(websocket: WebSocket):
    # Reject pages from other origins. This endpoint is for local development.
    if websocket.headers.get("origin") not in ALLOWED_ORIGINS:
        await websocket.close(code=1008)
        return

    await websocket.accept()

    try:
        while True:
            frame = await websocket.receive_bytes()

            if len(frame) > MAX_FRAME_BYTES:
                await websocket.close(code=1009)
                return

            if not frame.startswith(b"\xff\xd8"):
                await websocket.send_json({
                    "type": "error",
                    "message": "Expected a JPEG frame.",
                })
                continue

            try:
                # YOLO inference runs off the async event loop.
                # detect_image() already uses the shared model lock.
                prediction = await run_in_threadpool(detect_image, frame)
            except ValueError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Could not decode the camera frame.",
                })
                continue

            await websocket.send_json({
                "type": "prediction",
                **prediction,
            })

    except WebSocketDisconnect:
        pass
