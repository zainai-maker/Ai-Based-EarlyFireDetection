from pathlib import Path
from threading import Lock


from collections import deque
import cv2
import numpy as np
from ultralytics import YOLO

# Locate the fine-tuned model
MODEL_PATH = (
    Path(__file__).resolve().parents[2]
    / "models"
    / "best.pt"
)

# Load the model once
model = YOLO(str(MODEL_PATH))
model_lock = Lock()


def detect_image(image_bytes: bytes):
    # Convert uploaded bytes into an OpenCV image
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)

    if image is None:
        raise ValueError("Invalid image file")

    # Run inference
    with model_lock:
        result = model.predict(
            source=image,
            conf=0.25,
            imgsz=640,
            verbose=False,
        )[0]

    detections = []

    for box in result.boxes:
        class_id = int(box.cls.item())
        confidence = float(box.conf.item())

        detections.append({
            "class": model.names[class_id],
            "confidence": round(confidence, 4),
            "bbox": [
                round(float(v), 2)
                for v in box.xyxy[0].tolist()
            ],
        })

    classes = {d["class"] for d in detections}

    return {
        "fire_detected": "fire" in classes,
        "smoke_detected": "smoke" in classes,
        "detections": detections,
    }

# video prediction
def detect_video(input_path: Path, output_path: Path):
    cap = cv2.VideoCapture(str(input_path))

    if not cap.isOpened():
        raise ValueError("Cannot open video")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not 1 <= fps <= 120:
        fps = 25.0

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if width <= 0 or height <= 0:
        cap.release()
        raise ValueError("Invalid video dimensions")

    writer = cv2.VideoWriter(
        str(output_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    )

    if not writer.isOpened():
        cap.release()
        raise ValueError("Cannot create output video")

    frames = 0
    fire_frames = 0
    smoke_frames = 0

    # Keep detection history for the last 10 frames
    history = {
        "fire": deque(maxlen=10),
        "smoke": deque(maxlen=10),
    }

    alerts = []
    confirmed_classes = set()

    try:
        while True:
            success, frame = cap.read()

            if not success:
                break

            if frames >= int(fps * 60):
                raise ValueError("Video exceeds 60-second limit")

            with model_lock:
                result = model.predict(
                    source=frame,
                    conf=0.25,
                    imgsz=640,
                    verbose=False,
                )[0]

            # Highest confidence for each class in this frame
            frame_scores = {
                "fire": 0.0,
                "smoke": 0.0,
            }

            for box in result.boxes:
                class_name = model.names[int(box.cls.item())]

                if class_name in frame_scores:
                    frame_scores[class_name] = max(
                        frame_scores[class_name],
                        float(box.conf.item()),
                    )

            if frame_scores["fire"] > 0:
                fire_frames += 1

            if frame_scores["smoke"] > 0:
                smoke_frames += 1

            # Confirm alerts using multiple frames
            for class_name in ("fire", "smoke"):
                history[class_name].append(
                    frame_scores[class_name]
                )

                positive_frames = sum(
                    score > 0 for score in history[class_name]
                )

                if (
                    class_name not in confirmed_classes
                    and len(history[class_name]) == 10
                    and positive_frames >= 7
                ):
                    confirmed_classes.add(class_name)

                    alerts.append({
                        "type": class_name,
                        "timestamp_seconds": round(
                            (frames + 1) / fps, 2
                        ),
                        "confidence": round(
                            max(history[class_name]), 3
                        ),
                    })

            # Annotate the video
            annotated = result.plot()

            if confirmed_classes:
                alert_text = "ALERT: " + ", ".join(
                    sorted(confirmed_classes)
                ).upper()

                cv2.putText(
                    annotated,
                    alert_text,
                    (20, 45),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.9,
                    (0, 0, 255),
                    2,
                )

            writer.write(annotated)
            frames += 1

    finally:
        cap.release()
        writer.release()

    if frames == 0:
        raise ValueError("Video has no readable frames")

    return {
        "frames_processed": frames,
        "fire_detected": fire_frames > 0,
        "smoke_detected": smoke_frames > 0,
        "fire_frames": fire_frames,
        "smoke_frames": smoke_frames,
        "fire_alert": "fire" in confirmed_classes,
        "smoke_alert": "smoke" in confirmed_classes,
        "alert_count": len(alerts),
        "alerts": alerts,
    }