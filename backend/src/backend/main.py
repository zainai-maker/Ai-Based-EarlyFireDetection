from fastapi import FastAPI, UploadFile, File, HTTPException

from .detector import detect_image
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID, uuid4

from fastapi.responses import FileResponse

from .detector import detect_video

from contextlib import asynccontextmanager
from fastapi import Query

from .database import (
    init_db,
    save_alerts,
    get_incidents,
)

from .live import router as live_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="AI Fire Detection API",
    lifespan=lifespan,
)
MAX_IMAGE_BYTES = 10 * 1024 * 1024

app.include_router(live_router)

@app.get("/")
def home():
    return {"message": "Fire Detection API is running!"}


@app.post("/predict/image")
def predict_image(file: UploadFile = File(...)):

    # Accept only JPG and PNG uploads
    if file.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(
            status_code=400,
            detail="Only JPG and PNG images are supported",
        )

    # Limit uploads to 10 MB
    contents = file.file.read(MAX_IMAGE_BYTES + 1)

    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Image exceeds 10 MB limit",
        )

    try:
        prediction = detect_image(contents)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    return {
        "filename": file.filename,
        **prediction,
    }

# video
OUTPUT_DIR = (
    Path(__file__).resolve().parents[2] / "outputs"
)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MAX_VIDEO_SIZE = 100 * 1024 * 1024


@app.post("/predict/video")
def predict_video(file: UploadFile = File(...)):

    extension = Path(file.filename or "").suffix.lower()

    if extension not in {".mp4", ".avi", ".mov", ".mkv"}:
        raise HTTPException(
            status_code=400,
            detail="Unsupported video format"
        )

    video_id = uuid4()
    output_path = OUTPUT_DIR / f"{video_id}.mp4"

    try:
        with TemporaryDirectory() as temp_dir:
            input_path = (
                Path(temp_dir) / f"input{extension}"
            )

            # Save uploaded video in chunks
            total_size = 0

            with input_path.open("wb") as dest:
                while chunk := file.file.read(1024 * 1024):
                    total_size += len(chunk)

                    if total_size > MAX_VIDEO_SIZE:
                        raise HTTPException(
                            status_code=413,
                            detail="Video exceeds 100 MB"
                        )

                    dest.write(chunk)

            result = detect_video(
                input_path,
                output_path
            )

    except ValueError as exc:
        output_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=str(exc)
        )
    except Exception:
        output_path.unlink(missing_ok=True)
        raise
    finally:
        file.file.close()

        saved_count = save_alerts(
        video_id=str(video_id),
        filename=file.filename or "uploaded_video",
        alerts=result["alerts"],
    )

    return {
        "video_id": str(video_id),
        **result,
        "saved_incidents": saved_count,
        "download_url": f"/videos/{video_id}",
    }


@app.get("/videos/{video_id}")
def download_video(video_id: UUID):

    video_path = OUTPUT_DIR / f"{video_id}.mp4"

    if not video_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Video not found"
        )

    return FileResponse(
        video_path,
        media_type="video/mp4",
        filename="fire_detection_result.mp4"
    )



@app.get("/incidents")
def list_incidents(
    limit: int = Query(default=50, ge=1, le=100)
):
    incidents = get_incidents(limit=limit)

    return {
        "count": len(incidents),
        "incidents": incidents,
    }
