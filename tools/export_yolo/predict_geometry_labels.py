#!/usr/bin/env python3
"""Export table+net segmentation predictions for the browser labeler."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from ultralytics import YOLO


CLASS_TABLE = 0
CLASS_NET = 1


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
            objects = best_geometry_predictions(result)
            if objects:
                predictions.append(
                    {
                        "frame": frame_index,
                        "timeMs": round((frame_index / fps) * 1000) if fps else 0,
                        "objects": objects,
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
    print(f"wrote {len(predictions)} geometry predictions to {args.out}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
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


def best_geometry_predictions(result: Any) -> list[dict[str, Any]]:
    if result.masks is None or result.boxes is None:
        return []

    polygons = result.masks.xy or []
    if not polygons:
        return []

    confidences = result.boxes.conf.tolist() if result.boxes.conf is not None else []
    classes = result.boxes.cls.tolist() if result.boxes.cls is not None else []
    predictions = []

    table = best_prediction_for_class(polygons, confidences, classes, CLASS_TABLE)
    if table:
        predictions.append(table)

    net = best_prediction_for_class(polygons, confidences, classes, CLASS_NET)
    if net:
        predictions.append(net)

    return predictions


def best_prediction_for_class(
    polygons: list[Any],
    confidences: list[float],
    classes: list[float],
    class_id: int,
) -> dict[str, Any] | None:
    indices = [
        index for index in range(len(polygons))
        if index < len(classes) and int(classes[index]) == class_id
    ]
    if not indices:
        return None

    best_index = max(indices, key=lambda index: confidences[index] if index < len(confidences) else 0.0)
    confidence = confidences[best_index] if best_index < len(confidences) else None
    polygon = [
        [round(float(x)), round(float(y))]
        for x, y in polygons[best_index]
    ]
    if len(polygon) < 3:
        return None

    if class_id == CLASS_TABLE:
        return {
            "type": "table",
            "polygon": polygon,
            "confidence": confidence,
        }

    line = net_polygon_to_centerline(polygon)
    if not line:
        return None

    return {
        "type": "net",
        "line": line,
        "confidence": confidence,
    }


def net_polygon_to_centerline(polygon: list[list[int]]) -> list[list[int]] | None:
    points = np.array(polygon, dtype=np.float32)
    if points.shape[0] < 3:
        return None

    center = points.mean(axis=0)
    centered = points - center
    _, _, vh = np.linalg.svd(centered, full_matrices=False)
    axis = vh[0]
    normal = np.array([-axis[1], axis[0]], dtype=np.float32)
    projections = centered @ axis
    offsets = centered @ normal

    if float(projections.max() - projections.min()) < 1:
        return None

    line = []
    for quantile in (0.05, 0.5, 0.95):
        projected = float(np.quantile(projections, quantile))
        window = max(6.0, float(projections.max() - projections.min()) * 0.12)
        nearby = np.abs(projections - projected) <= window
        if nearby.any():
            offset = float(np.median(offsets[nearby]))
            projected = float(np.median(projections[nearby]))
        else:
            offset = 0.0

        point = center + axis * projected + normal * offset
        line.append([round(float(point[0])), round(float(point[1]))])

    if point_distance(line[0], line[-1]) < 8:
        return None
    return line


def point_distance(first: list[int], second: list[int]) -> float:
    return math.hypot(second[0] - first[0], second[1] - first[1])


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
