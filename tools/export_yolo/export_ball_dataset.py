#!/usr/bin/env python3
"""Export AR Ping Pong labeler JSON to an Ultralytics YOLO ball dataset."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import cv2


@dataclass(frozen=True)
class BallLabel:
    annotation_path: Path
    video_path: Path
    video_id: str
    frame: int
    x: float
    y: float
    width: float
    height: float
    occluded: bool
    blurred: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--annotations",
        required=True,
        type=Path,
        help="Annotation JSON file or directory containing *.json files.",
    )
    parser.add_argument(
        "--videos",
        required=True,
        type=Path,
        help="Directory containing source videos referenced by label JSON.",
    )
    parser.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Output YOLO dataset directory.",
    )
    parser.add_argument(
        "--val-ratio",
        type=float,
        default=0.2,
        help="Validation split ratio when --split-mode=frame. Default: 0.2.",
    )
    parser.add_argument(
        "--split-mode",
        choices=("frame", "video"),
        default="frame",
        help="Split by individual labeled frame or by whole video. Default: frame.",
    )
    parser.add_argument(
        "--img-format",
        choices=("jpg", "png"),
        default="jpg",
        help="Exported frame image format. Default: jpg.",
    )
    parser.add_argument(
        "--jpeg-quality",
        type=int,
        default=95,
        help="JPEG quality for exported frames. Default: 95.",
    )
    parser.add_argument(
        "--include-occluded",
        action="store_true",
        help="Include labels marked occluded. Default: skip occluded balls.",
    )
    parser.add_argument(
        "--exclude-blurred",
        action="store_true",
        help="Skip labels marked blurred. Default: include blurred balls.",
    )
    parser.add_argument(
        "--min-radius",
        type=float,
        default=2.0,
        help="Minimum half-size of the larger ball box dimension to export. Default: 2.",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete the output directory before exporting.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    validate_args(args)

    if args.clean and args.out.exists():
        shutil.rmtree(args.out)

    make_dataset_dirs(args.out)

    annotation_paths = collect_annotation_paths(args.annotations)
    labels = collect_ball_labels(
        annotation_paths=annotation_paths,
        videos_dir=args.videos,
        include_occluded=args.include_occluded,
        include_blurred=not args.exclude_blurred,
        min_radius=args.min_radius,
    )

    if not labels:
        raise SystemExit("No exportable ball labels found.")

    manifest = export_labels(labels, args)
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


def make_dataset_dirs(out_dir: Path) -> None:
    for split in ("train", "val"):
        (out_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (out_dir / "labels" / split).mkdir(parents=True, exist_ok=True)


def collect_annotation_paths(path: Path) -> list[Path]:
    if path.is_file():
        return [path]

    label_paths = sorted(item for item in path.glob("*.labels.json") if item.is_file())
    if label_paths:
        return label_paths

    return sorted(item for item in path.glob("*.json") if item.is_file())


def collect_ball_labels(
    annotation_paths: Iterable[Path],
    videos_dir: Path,
    include_occluded: bool,
    include_blurred: bool,
    min_radius: float,
) -> list[BallLabel]:
    labels: list[BallLabel] = []

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

            ball = next(
                (item for item in frame_label.get("objects", []) if item.get("type") == "ball"),
                None,
            )
            if not ball:
                continue

            if ball.get("occluded") and not include_occluded:
                continue
            if ball.get("blurred") and not include_blurred:
                continue

            parsed = parse_ball(ball, min_radius)
            if not parsed:
                continue

            x, y, width, height = parsed
            labels.append(
                BallLabel(
                    annotation_path=annotation_path,
                    video_path=video_path,
                    video_id=video_id,
                    frame=frame,
                    x=x,
                    y=y,
                    width=width,
                    height=height,
                    occluded=bool(ball.get("occluded")),
                    blurred=bool(ball.get("blurred")),
                )
            )

    return labels


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


def parse_ball(ball: dict[str, Any], min_radius: float) -> tuple[float, float, float, float] | None:
    if "bbox" in ball:
        x, y, width, height = [float(value) for value in ball["bbox"]]
        radius = max(width, height) / 2
        if radius < min_radius:
            return None
        return x, y, width, height

    if "center" in ball and "radius" in ball:
        center = ball["center"]
        radius = float(ball["radius"])
        if radius < min_radius:
            return None
        return float(center[0]) - radius, float(center[1]) - radius, radius * 2, radius * 2

    return None


def export_labels(labels: list[BallLabel], args: argparse.Namespace) -> dict[str, Any]:
    manifest: dict[str, Any] = {
        "class_names": ["ball"],
        "source_annotations": sorted({str(label.annotation_path) for label in labels}),
        "items": [],
    }

    captures: dict[Path, cv2.VideoCapture] = {}
    frame_sizes: dict[Path, tuple[int, int]] = {}

    try:
        for label in labels:
            capture = captures.get(label.video_path)
            if capture is None:
                capture = cv2.VideoCapture(str(label.video_path))
                if not capture.isOpened():
                    print(f"Could not open video: {label.video_path}")
                    continue
                captures[label.video_path] = capture

            frame = read_video_frame(capture, label.frame)
            if frame is None:
                print(f"Could not read frame {label.frame} from {label.video_path}")
                continue

            height, width = frame.shape[:2]
            frame_sizes[label.video_path] = (width, height)
            split = choose_split(label, args)
            stem = f"{safe_stem(label.video_id)}_frame_{label.frame:06d}"
            image_path = args.out / "images" / split / f"{stem}.{args.img_format}"
            label_path = args.out / "labels" / split / f"{stem}.txt"

            write_image(image_path, frame, args)
            write_yolo_label(label_path, label, width, height)

            manifest["items"].append(
                {
                    "split": split,
                    "image": str(image_path),
                    "label": str(label_path),
                    "video": str(label.video_path),
                    "frame": label.frame,
                    "occluded": label.occluded,
                    "blurred": label.blurred,
                }
            )
    finally:
        for capture in captures.values():
            capture.release()

    manifest["frame_sizes"] = {
        str(path): {"width": size[0], "height": size[1]} for path, size in frame_sizes.items()
    }
    return manifest


def read_video_frame(capture: cv2.VideoCapture, frame_index: int) -> Any | None:
    capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = capture.read()
    return frame if ok else None


def choose_split(label: BallLabel, args: argparse.Namespace) -> str:
    if args.val_ratio == 0:
        return "train"

    key = label.video_id if args.split_mode == "video" else f"{label.video_id}:{label.frame}"
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


def write_yolo_label(path: Path, label: BallLabel, width: int, height: int) -> None:
    x1 = max(0.0, label.x)
    y1 = max(0.0, label.y)
    x2 = min(float(width), label.x + label.width)
    y2 = min(float(height), label.y + label.height)

    box_width = max(1.0, x2 - x1)
    box_height = max(1.0, y2 - y1)
    x_center = x1 + box_width / 2
    y_center = y1 + box_height / 2

    values = [
        0,
        x_center / width,
        y_center / height,
        box_width / width,
        box_height / height,
    ]
    path.write_text(
        "{} {:.8f} {:.8f} {:.8f} {:.8f}\n".format(*values),
        encoding="utf-8",
    )


def write_dataset_yaml(out_dir: Path) -> None:
    yaml = """path: .
train: images/train
val: images/val
names:
  0: ball
"""
    (out_dir / "dataset.yaml").write_text(yaml, encoding="utf-8")


def write_manifest(out_dir: Path, manifest: dict[str, Any]) -> None:
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
