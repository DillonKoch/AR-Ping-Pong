#!/usr/bin/env python3
"""Export table polygons and net polylines to a YOLO segmentation dataset."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np


CLASS_NAMES = ["table", "net"]


@dataclass(frozen=True)
class GeometryObject:
    class_id: int
    class_name: str
    points: list[tuple[float, float]]
    interpolated: bool


@dataclass(frozen=True)
class GeometryFrame:
    annotation_path: Path
    video_path: Path
    video_id: str
    frame: int
    objects: list[GeometryObject]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", required=True, type=Path, help="Annotation JSON file or directory.")
    parser.add_argument("--videos", required=True, type=Path, help="Directory containing source videos.")
    parser.add_argument("--out", required=True, type=Path, help="Output YOLO segmentation dataset directory.")
    parser.add_argument("--val-ratio", type=float, default=0.2, help="Validation split ratio. Default: 0.2.")
    parser.add_argument(
        "--split-mode",
        choices=("frame", "video"),
        default="frame",
        help="Split by individual frame or whole video. Default: frame.",
    )
    parser.add_argument("--img-format", choices=("jpg", "png"), default="jpg", help="Frame format. Default: jpg.")
    parser.add_argument("--jpeg-quality", type=int, default=95, help="JPEG quality. Default: 95.")
    parser.add_argument("--manual-only", action="store_true", help="Skip interpolated table/net labels.")
    parser.add_argument(
        "--net-thickness-px",
        type=int,
        default=14,
        help="Pixel thickness used to convert net polylines into segmentation masks. Default: 14.",
    )
    parser.add_argument("--clean", action="store_true", help="Delete the output directory before exporting.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    validate_args(args)

    if args.clean and args.out.exists():
        shutil.rmtree(args.out)

    make_dataset_dirs(args.out)

    frames = collect_geometry_frames(
        annotation_paths=collect_annotation_paths(args.annotations),
        videos_dir=args.videos,
        include_interpolated=not args.manual_only,
    )
    if not frames:
        raise SystemExit("No exportable table/net labels found.")

    manifest = export_frames(frames, args)
    write_dataset_yaml(args.out)
    write_manifest(args.out, manifest)

    train_count = sum(1 for item in manifest["items"] if item["split"] == "train")
    val_count = sum(1 for item in manifest["items"] if item["split"] == "val")
    print(f"Exported {len(manifest['items'])} labeled frames.")
    print(f"Train: {train_count}  Val: {val_count}")
    print(f"Dataset YAML: {args.out / 'dataset.yaml'}")


def validate_args(args: argparse.Namespace) -> None:
    if not args.annotations.exists():
        raise SystemExit(f"Annotations path does not exist: {args.annotations}")
    if not args.videos.exists():
        raise SystemExit(f"Videos directory does not exist: {args.videos}")
    if not 0 <= args.val_ratio < 1:
        raise SystemExit("--val-ratio must be >= 0 and < 1")
    if not 1 <= args.jpeg_quality <= 100:
        raise SystemExit("--jpeg-quality must be between 1 and 100")
    if args.net_thickness_px < 2:
        raise SystemExit("--net-thickness-px must be at least 2")


def make_dataset_dirs(out_dir: Path) -> None:
    for split in ("train", "val"):
        (out_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / split).mkdir(parents=True, exist_ok=True)


def collect_annotation_paths(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted(item for item in path.glob("*.json") if item.is_file())


def collect_geometry_frames(
    annotation_paths: Iterable[Path],
    videos_dir: Path,
    include_interpolated: bool,
) -> list[GeometryFrame]:
    frames: list[GeometryFrame] = []

    for annotation_path in annotation_paths:
        data = read_json(annotation_path)
        video = data.get("video", {})
        video_filename = video.get("filename")
        if not video_filename:
            print(f"Skipping {annotation_path}: missing video.filename")
            continue

        video_path = find_video_path(video_filename, videos_dir, annotation_path)
        if not video_path:
            print(f"Skipping {annotation_path}: could not find video {video_filename}")
            continue

        video_id = video.get("id") or Path(video_filename).stem
        for frame_label in data.get("frames", []):
            frame = int(frame_label.get("frame", -1))
            if frame < 0:
                continue

            objects = parse_geometry_objects(
                frame_label.get("objects", []),
                include_interpolated=include_interpolated,
            )
            if not objects:
                continue

            frames.append(
                GeometryFrame(
                    annotation_path=annotation_path,
                    video_path=video_path,
                    video_id=video_id,
                    frame=frame,
                    objects=objects,
                )
            )

    return frames


def parse_geometry_objects(raw_objects: list[dict[str, Any]], include_interpolated: bool) -> list[GeometryObject]:
    objects: list[GeometryObject] = []

    for item in raw_objects:
        if item.get("absent"):
            continue
        if item.get("interpolated") and not include_interpolated:
            continue

        if item.get("type") == "table":
            polygon = parse_points(item.get("polygon"), min_points=3)
            if polygon:
                objects.append(
                    GeometryObject(
                        class_id=0,
                        class_name="table",
                        points=polygon,
                        interpolated=bool(item.get("interpolated")),
                    )
                )
        elif item.get("type") == "net":
            line = parse_points(item.get("line"), min_points=2)
            if line and len(line) <= 3:
                objects.append(
                    GeometryObject(
                        class_id=1,
                        class_name="net",
                        points=line,
                        interpolated=bool(item.get("interpolated")),
                    )
                )

    return objects


def parse_points(raw_points: Any, min_points: int) -> list[tuple[float, float]] | None:
    if not isinstance(raw_points, list) or len(raw_points) < min_points:
        return None

    points: list[tuple[float, float]] = []
    for point in raw_points:
        if not isinstance(point, list) or len(point) != 2:
            return None
        points.append((float(point[0]), float(point[1])))

    return points


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def find_video_path(video_filename: str, videos_dir: Path, annotation_path: Path) -> Path | None:
    candidates = [
        Path(video_filename),
        videos_dir / video_filename,
        annotation_path.parent / video_filename,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()

    matches = list(videos_dir.rglob(Path(video_filename).name))
    if matches:
        return matches[0].resolve()

    return None


def export_frames(frames: list[GeometryFrame], args: argparse.Namespace) -> dict[str, Any]:
    manifest: dict[str, Any] = {
        "class_names": CLASS_NAMES,
        "net_thickness_px": args.net_thickness_px,
        "source_annotations": sorted({str(frame.annotation_path) for frame in frames}),
        "items": [],
    }

    captures: dict[Path, cv2.VideoCapture] = {}
    frame_sizes: dict[Path, tuple[int, int]] = {}

    try:
        for frame_label in frames:
            capture = captures.get(frame_label.video_path)
            if capture is None:
                capture = cv2.VideoCapture(str(frame_label.video_path))
                if not capture.isOpened():
                    print(f"Could not open video: {frame_label.video_path}")
                    continue
                captures[frame_label.video_path] = capture

            frame = read_video_frame(capture, frame_label.frame)
            if frame is None:
                print(f"Could not read frame {frame_label.frame} from {frame_label.video_path}")
                continue

            height, width = frame.shape[:2]
            yolo_lines = build_yolo_lines(frame_label.objects, width, height, args.net_thickness_px)
            if not yolo_lines:
                continue

            frame_sizes[frame_label.video_path] = (width, height)
            split = choose_split(frame_label, args)
            stem = f"{safe_stem(frame_label.video_id)}_frame_{frame_label.frame:06d}"
            image_path = args.out / "images" / split / f"{stem}.{args.img_format}"
            label_path = args.out / "labels" / split / f"{stem}.txt"

            write_image(image_path, frame, args)
            label_path.write_text("\n".join(yolo_lines) + "\n", encoding="utf-8")

            manifest["items"].append(
                {
                    "split": split,
                    "image": str(image_path),
                    "label": str(label_path),
                    "video": str(frame_label.video_path),
                    "frame": frame_label.frame,
                    "objects": [
                        {
                            "class": item.class_name,
                            "points": len(item.points),
                            "interpolated": item.interpolated,
                        }
                        for item in frame_label.objects
                    ],
                }
            )
    finally:
        for capture in captures.values():
            capture.release()

    manifest["frame_sizes"] = {
        str(path): {"width": size[0], "height": size[1]} for path, size in frame_sizes.items()
    }
    return manifest


def build_yolo_lines(
    objects: list[GeometryObject],
    width: int,
    height: int,
    net_thickness_px: int,
) -> list[str]:
    lines: list[str] = []

    for item in objects:
        if item.class_name == "table":
            polygon = item.points
        else:
            polygon = net_line_to_polygon(item.points, width, height, net_thickness_px)

        if len(polygon) < 3:
            continue

        lines.append(format_yolo_segmentation(item.class_id, polygon, width, height))

    return lines


def net_line_to_polygon(
    line: list[tuple[float, float]],
    width: int,
    height: int,
    thickness_px: int,
) -> list[tuple[float, float]]:
    mask = np.zeros((height, width), dtype=np.uint8)
    points = np.array(
        [[round(clamp(x, 0, width - 1)), round(clamp(y, 0, height - 1))] for x, y in line],
        dtype=np.int32,
    )
    cv2.polylines(mask, [points], isClosed=False, color=255, thickness=thickness_px, lineType=cv2.LINE_AA)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []

    contour = max(contours, key=cv2.contourArea)
    epsilon = max(1.0, thickness_px * 0.25)
    approx = cv2.approxPolyDP(contour, epsilon, closed=True)
    polygon = [(float(point[0][0]), float(point[0][1])) for point in approx]
    return polygon if len(polygon) >= 3 else []


def read_video_frame(capture: cv2.VideoCapture, frame_index: int) -> Any | None:
    capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = capture.read()
    return frame if ok else None


def choose_split(frame: GeometryFrame, args: argparse.Namespace) -> str:
    if args.val_ratio == 0:
        return "train"

    key = frame.video_id if args.split_mode == "video" else f"{frame.video_id}:{frame.frame}"
    bucket = stable_bucket(key)
    return "val" if bucket < args.val_ratio else "train"


def stable_bucket(value: str) -> float:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()
    integer = int(digest[:12], 16)
    return integer / float(0xFFFFFFFFFFFF)


def safe_stem(value: str) -> str:
    safe = []
    for char in value:
        safe.append(char if char.isalnum() or char in ("-", "_") else "_")
    return "".join(safe).strip("_") or "video"


def write_image(path: Path, frame: Any, args: argparse.Namespace) -> None:
    if args.img_format == "jpg":
        cv2.imwrite(str(path), frame, [cv2.IMWRITE_JPEG_QUALITY, args.jpeg_quality])
    else:
        cv2.imwrite(str(path), frame)


def format_yolo_segmentation(
    class_id: int,
    polygon: list[tuple[float, float]],
    width: int,
    height: int,
) -> str:
    values: list[float | int] = [class_id]
    for x, y in polygon:
        values.append(clamp(x / width, 0.0, 1.0))
        values.append(clamp(y / height, 0.0, 1.0))

    return " ".join(str(value) if isinstance(value, int) else f"{value:.8f}" for value in values)


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def write_dataset_yaml(out_dir: Path) -> None:
    yaml = """path: .
train: images/train
val: images/val
names:
  0: table
  1: net
"""
    (out_dir / "dataset.yaml").write_text(yaml, encoding="utf-8")


def write_manifest(out_dir: Path, manifest: dict[str, Any]) -> None:
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
