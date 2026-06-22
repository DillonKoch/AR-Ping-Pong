#!/usr/bin/env python3
"""Export table segmentation predictions for the browser labeler."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import cv2
from ultralytics import YOLO


def main() -> None:
    args = parse_args()
    model = YOLO(args.model)
    video = cv2.VideoCapture(str(args.video))
    if not video.isOpened():
        raise SystemExit(f"Could not open video: {args.video}")

    fps = video.get(cv2.CAP_PROP_FPS) or args.fps
    width = int(video.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(video.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    frame_count = int(video.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    predictions: list[dict[str, Any]] = []
    frame_index = 0
    predicted_frames = 0

    while True:
        ok, frame = video.read()
        if not ok:
            break

        if frame_index % args.stride == 0:
            predicted_frames += 1
            result = model.predict(
                frame,
                imgsz=args.imgsz,
                conf=args.conf,
                verbose=False,
            )[0]
            table = best_table_prediction(result)
            if table:
                predictions.append(
                    {
                        "frame": frame_index,
                        "timeMs": round((frame_index / fps) * 1000) if fps else 0,
                        "objects": [table],
                    }
                )

        frame_index += 1
        if args.limit and frame_index >= args.limit:
            break
        if frame_index % args.progress_every == 0:
            print_progress(frame_index, frame_count, len(predictions), predicted_frames)

    video.release()
    print_progress(frame_index, frame_count, len(predictions), predicted_frames)
    print()

    payload = {
        "schemaVersion": 1,
        "video": {
            "filename": args.video.name,
            "fps": fps,
            "width": width,
            "height": height,
        },
        "frames": predictions,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {len(predictions)} table predictions to {args.out}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True, help="Path to YOLO segmentation .pt file")
    parser.add_argument("--video", type=Path, required=True, help="Video to run predictions on")
    parser.add_argument("--out", type=Path, required=True, help="Output prediction JSON for the labeler")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--stride", type=int, default=1, help="Predict every Nth frame")
    parser.add_argument("--limit", type=int, default=0, help="Optional max frames to process")
    parser.add_argument("--fps", type=float, default=30.0, help="Fallback FPS if the video has no FPS metadata")
    parser.add_argument("--progress-every", type=int, default=10, help="Update progress every N decoded frames")
    return parser.parse_args()


def best_table_prediction(result: Any) -> dict[str, Any] | None:
    if result.masks is None or result.boxes is None:
        return None

    polygons = result.masks.xy or []
    if not polygons:
        return None

    confidences = result.boxes.conf.tolist() if result.boxes.conf is not None else []
    best_index = max(
        range(len(polygons)),
        key=lambda index: confidences[index] if index < len(confidences) else 0.0,
    )
    polygon = [
        [round(float(x)), round(float(y))]
        for x, y in polygons[best_index]
    ]
    if len(polygon) < 3:
        return None

    confidence = confidences[best_index] if best_index < len(confidences) else None
    return {
        "type": "table",
        "polygon": polygon,
        "confidence": confidence,
    }


def print_progress(frame_index: int, frame_count: int, prediction_count: int, predicted_frames: int) -> None:
    if frame_count <= 0:
        sys.stdout.write(
            f"\rprocessed {frame_index} frames | predicted {predicted_frames} | detections {prediction_count}"
        )
        sys.stdout.flush()
        return

    fraction = min(1.0, frame_index / frame_count)
    width = 28
    filled = round(fraction * width)
    bar = "#" * filled + "-" * (width - filled)
    percent = round(fraction * 100, 1)
    sys.stdout.write(
        f"\r[{bar}] {percent:5.1f}% | {frame_index}/{frame_count} frames | detections {prediction_count}"
    )
    sys.stdout.flush()


if __name__ == "__main__":
    main()
