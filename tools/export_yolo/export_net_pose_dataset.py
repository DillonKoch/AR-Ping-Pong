#!/usr/bin/env python3
"""Export net polylines to an Ultralytics YOLO pose dataset."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import cv2


KEYPOINT_NAMES = ["left", "middle", "right"]


@dataclass(frozen=True)
class NetPoseLabel:
    annotation_path: Path
    video_path: Path
    video_id: str
    frame: int
    points: list[tuple[float, float]]
    interpolated: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", required=True, type=Path, help="Annotation JSON file or directory.")
    parser.add_argument("--videos", required=True, type=Path, help="Directory containing source videos.")
    parser.add_argument("--out", required=True, type=Path, help="Output YOLO pose dataset directory.")
    parser.add_argument("--val-ratio", type=float, default=0.2, help="Validation split ratio. Default: 0.2.")
    parser.add_argument(
        "--split-mode",
        choices=("frame", "video"),
        default="frame",
        help="Split by individual frame or whole video. Default: frame.",
    )
    parser.add_argument("--img-format", choices=("jpg", "png"), default="jpg", help="Frame format. Default: jpg.")
    parser.add_argument("--jpeg-quality", type=int, default=95, help="JPEG quality. Default: 95.")
    parser.add_argument("--manual-only", action="store_true", help="Skip interpolated net labels.")
    parser.add_argument(
        "--bbox-padding-px",
        type=int,
        default=32,
        help="Padding around net keypoints for the YOLO object box. Default: 32.",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=25,
        help="Print export progress every N frames. Use 0 to disable. Default: 25.",
    )
    parser.add_argument("--clean", action="store_true", help="Delete the output directory before exporting.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    validate_args(args)

    if args.clean and args.out.exists():
        shutil.rmtree(args.out)

    make_dataset_dirs(args.out)
    labels = collect_net_pose_labels(
        annotation_paths=collect_annotation_paths(args.annotations),
        videos_dir=args.videos,
        include_interpolated=not args.manual_only,
    )
    if not labels:
        raise SystemExit("No exportable net labels found.")

    manifest = export_labels(labels, args)
    write_dataset_yaml(args.out)
    write_manifest(args.out, manifest)

    train_count = sum(1 for item in manifest["items"] if item["split"] == "train")
    val_count = sum(1 for item in manifest["items"] if item["split"] == "val")
    print(f"Exported {len(manifest['items'])} net pose frames.")
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
    if args.bbox_padding_px < 1:
        raise SystemExit("--bbox-padding-px must be at least 1")


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


def collect_net_pose_labels(
    annotation_paths: Iterable[Path],
    videos_dir: Path,
    include_interpolated: bool,
) -> list[NetPoseLabel]:
    labels: list[NetPoseLabel] = []

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

            net = next(
                (
                    item for item in frame_label.get("objects", [])
                    if item.get("type") == "net"
                    and not item.get("absent")
                    and (include_interpolated or not item.get("interpolated"))
                ),
                None,
            )
            if not net:
                continue

            points = normalize_net_points(parse_points(net.get("line"), min_points=2))
            if not points:
                continue

            labels.append(
                NetPoseLabel(
                    annotation_path=annotation_path,
                    video_path=video_path,
                    video_id=video_id,
                    frame=frame,
                    points=points,
                    interpolated=bool(net.get("interpolated")),
                )
            )

    return labels


def parse_points(raw_points: Any, min_points: int) -> list[tuple[float, float]] | None:
    if not isinstance(raw_points, list) or len(raw_points) < min_points:
        return None

    points: list[tuple[float, float]] = []
    for point in raw_points:
        if not isinstance(point, list) or len(point) != 2:
            return None
        points.append((float(point[0]), float(point[1])))

    return points


def normalize_net_points(points: list[tuple[float, float]] | None) -> list[tuple[float, float]] | None:
    if not points or len(points) not in (2, 3):
        return None
    if len(points) == 3:
        return points

    start, end = points
    midpoint = ((start[0] + end[0]) / 2, (start[1] + end[1]) / 2)
    return [start, midpoint, end]


def export_labels(labels: list[NetPoseLabel], args: argparse.Namespace) -> dict[str, Any]:
    manifest: dict[str, Any] = {
        "class_names": ["net"],
        "keypoint_names": KEYPOINT_NAMES,
        "bbox_padding_px": args.bbox_padding_px,
        "source_annotations": sorted({str(label.annotation_path) for label in labels}),
        "items": [],
    }
    captures: dict[Path, cv2.VideoCapture] = {}
    frame_sizes: dict[Path, tuple[int, int]] = {}

    try:
        ordered_labels = sorted(labels, key=lambda item: (str(item.video_path), item.frame))
        total = len(ordered_labels)

        for index, label in enumerate(ordered_labels, start=1):
            if args.progress_every and (index == 1 or index % args.progress_every == 0 or index == total):
                print(f"exporting net pose frame {index}/{total}: {label.video_id} frame {label.frame}", flush=True)

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
            yolo_line = format_yolo_pose_label(label.points, width, height, args.bbox_padding_px)
            if not yolo_line:
                continue

            frame_sizes[label.video_path] = (width, height)
            split = choose_split(label, args)
            stem = f"{safe_stem(label.video_id)}_frame_{label.frame:06d}"
            image_path = args.out / "images" / split / f"{stem}.{args.img_format}"
            label_path = args.out / "labels" / split / f"{stem}.txt"

            write_image(image_path, frame, args)
            label_path.write_text(yolo_line + "\n", encoding="utf-8")
            manifest["items"].append(
                {
                    "split": split,
                    "image": str(image_path),
                    "label": str(label_path),
                    "video": str(label.video_path),
                    "frame": label.frame,
                    "interpolated": label.interpolated,
                }
            )
    finally:
        for capture in captures.values():
            capture.release()

    manifest["frame_sizes"] = {
        str(path): {"width": size[0], "height": size[1]} for path, size in frame_sizes.items()
    }
    return manifest


def format_yolo_pose_label(
    points: list[tuple[float, float]],
    width: int,
    height: int,
    bbox_padding_px: int,
) -> str | None:
    x_values = [point[0] for point in points]
    y_values = [point[1] for point in points]
    x_min = clamp(min(x_values) - bbox_padding_px, 0, width - 1)
    y_min = clamp(min(y_values) - bbox_padding_px, 0, height - 1)
    x_max = clamp(max(x_values) + bbox_padding_px, 0, width - 1)
    y_max = clamp(max(y_values) + bbox_padding_px, 0, height - 1)

    box_width = x_max - x_min
    box_height = y_max - y_min
    if box_width < 2 or box_height < 2:
        return None

    values: list[float | int] = [
        0,
        ((x_min + x_max) / 2) / width,
        ((y_min + y_max) / 2) / height,
        box_width / width,
        box_height / height,
    ]
    for x, y in points:
        values.extend([
            clamp(x / width, 0.0, 1.0),
            clamp(y / height, 0.0, 1.0),
            2,
        ])

    return " ".join(str(value) if isinstance(value, int) else f"{value:.8f}" for value in values)


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


def read_video_frame(capture: cv2.VideoCapture, frame_index: int) -> Any | None:
    capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = capture.read()
    return frame if ok else None


def choose_split(label: NetPoseLabel, args: argparse.Namespace) -> str:
    if args.val_ratio == 0:
        return "train"

    key = label.video_id if args.split_mode == "video" else f"{label.video_id}:{label.frame}"
    return "val" if stable_bucket(key) < args.val_ratio else "train"


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


def write_dataset_yaml(out_dir: Path) -> None:
    yaml = """path: .
train: images/train
val: images/val
kpt_shape: [3, 3]
flip_idx: [2, 1, 0]
names:
  0: net
"""
    (out_dir / "dataset.yaml").write_text(yaml, encoding="utf-8")


def write_manifest(out_dir: Path, manifest: dict[str, Any]) -> None:
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )


def clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


if __name__ == "__main__":
    main()
