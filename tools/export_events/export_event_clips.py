#!/usr/bin/env python3
"""Export AR Ping Pong event labels to fixed-length video clips."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import cv2


DEFAULT_EVENT_TYPES = (
    "point_start",
    "serve_contact",
    "paddle_contact",
    "bounce_near",
    "bounce_far",
    "net_hit",
    "point_end",
    "ball_lost",
    "uncertain",
)


@dataclass(frozen=True)
class EventLabel:
    annotation_path: Path
    video_path: Path
    video_id: str
    event_type: str
    frame: int
    time_ms: int
    confidence: float
    is_background: bool = False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", required=True, type=Path)
    parser.add_argument("--videos", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument(
        "--event-types",
        nargs="+",
        default=list(DEFAULT_EVENT_TYPES),
        help="Event types to export. Default: all labeler event types.",
    )
    parser.add_argument(
        "--background-per-video",
        type=int,
        default=0,
        help="Number of background clips to sample per video. Default: 0.",
    )
    parser.add_argument(
        "--pre-frames",
        type=int,
        default=8,
        help="Frames before the event frame in each clip. Default: 8.",
    )
    parser.add_argument(
        "--post-frames",
        type=int,
        default=7,
        help="Frames after the event frame in each clip. Default: 7.",
    )
    parser.add_argument(
        "--clip-fps",
        type=float,
        default=30.0,
        help="Output clip FPS. Default: 30.",
    )
    parser.add_argument(
        "--val-ratio",
        type=float,
        default=0.2,
        help="Validation split ratio. Default: 0.2.",
    )
    parser.add_argument(
        "--split-mode",
        choices=("event", "video"),
        default="event",
        help="Split by event or whole video. Default: event.",
    )
    parser.add_argument(
        "--codec",
        default="mp4v",
        help="FourCC codec for exported clips. Default: mp4v.",
    )
    parser.add_argument("--clean", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    validate_args(args)

    if args.clean and args.out.exists():
        shutil.rmtree(args.out)

    annotation_paths = collect_annotation_paths(args.annotations)
    event_types = tuple(args.event_types)
    events = collect_events(annotation_paths, args.videos, event_types)
    events.extend(sample_background_events(annotation_paths, args.videos, args.background_per_video, args))

    if not events:
        raise SystemExit("No exportable event labels found.")

    class_names = make_class_names(event_types, include_background=args.background_per_video > 0)
    make_dataset_dirs(args.out, class_names)
    rows = export_event_clips(events, class_names, args)
    write_class_names(args.out, class_names)
    write_metadata(args.out, rows)

    train_count = sum(1 for row in rows if row["split"] == "train")
    val_count = sum(1 for row in rows if row["split"] == "val")
    print(f"Exported {len(rows)} event clips.")
    print(f"Train: {train_count}  Val: {val_count}")
    print(f"Metadata: {args.out / 'metadata.csv'}")


def validate_args(args: argparse.Namespace) -> None:
    if not args.annotations.exists():
        raise SystemExit(f"Annotations path does not exist: {args.annotations}")
    if not args.videos.exists():
        raise SystemExit(f"Videos directory does not exist: {args.videos}")
    if args.pre_frames < 0 or args.post_frames < 0:
        raise SystemExit("--pre-frames and --post-frames must be non-negative")
    if args.background_per_video < 0:
        raise SystemExit("--background-per-video must be non-negative")
    if not 0 <= args.val_ratio < 1:
        raise SystemExit("--val-ratio must be >= 0 and < 1")


def collect_annotation_paths(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted(item for item in path.glob("*.json") if item.is_file())


def collect_events(
    annotation_paths: Iterable[Path],
    videos_dir: Path,
    event_types: tuple[str, ...],
) -> list[EventLabel]:
    labels: list[EventLabel] = []
    allowed = set(event_types)

    for annotation_path in annotation_paths:
        data = read_json(annotation_path)
        video_path = find_video_path(data, videos_dir, annotation_path)
        if not video_path:
            continue

        video = data.get("video", {})
        video_id = video.get("id") or Path(video.get("filename", annotation_path.stem)).stem
        for event in data.get("events", []):
            event_type = event.get("type")
            if event_type not in allowed:
                continue

            frame = int(event.get("frame", -1))
            if frame < 0:
                continue

            labels.append(
                EventLabel(
                    annotation_path=annotation_path,
                    video_path=video_path,
                    video_id=video_id,
                    event_type=event_type,
                    frame=frame,
                    time_ms=int(event.get("timeMs", 0)),
                    confidence=float(event.get("confidence", 1)),
                )
            )

    return labels


def sample_background_events(
    annotation_paths: Iterable[Path],
    videos_dir: Path,
    count_per_video: int,
    args: argparse.Namespace,
) -> list[EventLabel]:
    if count_per_video == 0:
        return []

    labels: list[EventLabel] = []
    margin = args.pre_frames + args.post_frames + 1

    for annotation_path in annotation_paths:
        data = read_json(annotation_path)
        video_path = find_video_path(data, videos_dir, annotation_path)
        if not video_path:
            continue

        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            continue
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        source_fps = capture.get(cv2.CAP_PROP_FPS) or 30
        capture.release()

        if frame_count <= margin * 2:
            continue

        event_frames = [int(event.get("frame", -1)) for event in data.get("events", [])]
        video = data.get("video", {})
        video_id = video.get("id") or Path(video.get("filename", annotation_path.stem)).stem

        sampled = 0
        cursor = margin
        stride = max(1, (frame_count - margin * 2) // max(1, count_per_video * 3))
        while cursor < frame_count - margin and sampled < count_per_video:
            if all(abs(cursor - event_frame) > margin * 2 for event_frame in event_frames):
                labels.append(
                    EventLabel(
                        annotation_path=annotation_path,
                        video_path=video_path,
                        video_id=video_id,
                        event_type="background",
                        frame=cursor,
                        time_ms=int((cursor / source_fps) * 1000),
                        confidence=1,
                        is_background=True,
                    )
                )
                sampled += 1
            cursor += stride

    return labels


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def find_video_path(data: dict[str, Any], videos_dir: Path, annotation_path: Path) -> Path | None:
    video_filename = data.get("video", {}).get("filename")
    if not video_filename:
        print(f"Skipping {annotation_path}: missing video.filename")
        return None

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

    print(f"Skipping {annotation_path}: could not find video {video_filename}")
    return None


def make_class_names(event_types: tuple[str, ...], include_background: bool) -> list[str]:
    class_names = list(dict.fromkeys(event_types))
    if include_background and "background" not in class_names:
        class_names.append("background")
    return class_names


def make_dataset_dirs(out_dir: Path, class_names: list[str]) -> None:
    for split in ("train", "val"):
        for class_name in class_names:
            (out_dir / "clips" / split / class_name).mkdir(parents=True, exist_ok=True)


def export_event_clips(
    events: list[EventLabel],
    class_names: list[str],
    args: argparse.Namespace,
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []

    for event in events:
        split = choose_split(event, args)
        stem = f"{safe_stem(event.video_id)}_{event.event_type}_frame_{event.frame:06d}"
        clip_path = args.out / "clips" / split / event.event_type / f"{stem}.mp4"

        ok, start_frame, end_frame, source_width, source_height = write_clip(event, clip_path, args)
        if not ok:
            continue

        rows.append(
            {
                "clip_path": str(clip_path.relative_to(args.out)),
                "split": split,
                "label": event.event_type,
                "class_id": str(class_names.index(event.event_type)),
                "video_id": event.video_id,
                "video_path": str(event.video_path),
                "event_frame": str(event.frame),
                "start_frame": str(start_frame),
                "end_frame": str(end_frame),
                "time_ms": str(event.time_ms),
                "confidence": str(event.confidence),
                "source_width": str(source_width),
                "source_height": str(source_height),
            }
        )

    return rows


def write_clip(
    event: EventLabel,
    clip_path: Path,
    args: argparse.Namespace,
) -> tuple[bool, int, int, int, int]:
    capture = cv2.VideoCapture(str(event.video_path))
    if not capture.isOpened():
        print(f"Could not open video: {event.video_path}")
        return False, 0, 0, 0, 0

    source_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    source_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    start_frame = max(0, event.frame - args.pre_frames)
    end_frame = min(frame_count - 1, event.frame + args.post_frames)

    fourcc = cv2.VideoWriter_fourcc(*args.codec)
    writer = cv2.VideoWriter(
        str(clip_path),
        fourcc,
        args.clip_fps,
        (source_width, source_height),
    )
    if not writer.isOpened():
        capture.release()
        print(f"Could not create clip: {clip_path}")
        return False, start_frame, end_frame, source_width, source_height

    capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
    written = 0
    for _frame_index in range(start_frame, end_frame + 1):
        ok, frame = capture.read()
        if not ok:
            break
        writer.write(frame)
        written += 1

    capture.release()
    writer.release()

    if written == 0:
        clip_path.unlink(missing_ok=True)
        print(f"Could not read frames for {event.video_path} around frame {event.frame}")
        return False, start_frame, end_frame, source_width, source_height

    return True, start_frame, start_frame + written - 1, source_width, source_height


def choose_split(event: EventLabel, args: argparse.Namespace) -> str:
    if args.val_ratio == 0:
        return "train"

    key = event.video_id if args.split_mode == "video" else f"{event.video_id}:{event.event_type}:{event.frame}"
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


def write_class_names(out_dir: Path, class_names: list[str]) -> None:
    payload = {str(index): name for index, name in enumerate(class_names)}
    (out_dir / "class_names.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def write_metadata(out_dir: Path, rows: list[dict[str, str]]) -> None:
    fieldnames = [
        "clip_path",
        "split",
        "label",
        "class_id",
        "video_id",
        "video_path",
        "event_frame",
        "start_frame",
        "end_frame",
        "time_ms",
        "confidence",
        "source_width",
        "source_height",
    ]
    with (out_dir / "metadata.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    main()
