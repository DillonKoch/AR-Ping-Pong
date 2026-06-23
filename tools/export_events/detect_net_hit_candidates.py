#!/usr/bin/env python3
"""Detect candidate net-hit events from labeled ball centers and net lines."""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


@dataclass(frozen=True)
class FrameGeometry:
    frame: int
    time_ms: int
    ball_center: tuple[float, float]
    net_line: list[tuple[float, float]]


@dataclass(frozen=True)
class NetHitCandidate:
    annotation_path: Path
    video_id: str
    frame: int
    time_ms: int
    confidence: float
    distance_px: float
    crossing: bool
    angle_change_deg: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", required=True, type=Path, help="Annotation JSON file or directory.")
    parser.add_argument("--out", required=True, type=Path, help="Output candidate JSON.")
    parser.add_argument("--max-distance-px", type=float, default=18, help="Max ball-center distance to net.")
    parser.add_argument("--min-angle-change-deg", type=float, default=22, help="Min trajectory bend near net.")
    parser.add_argument("--min-gap-frames", type=int, default=8, help="Suppress candidates this many frames apart.")
    parser.add_argument("--window-frames", type=int, default=3, help="Candidate uncertainty window radius.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.annotations.exists():
        raise SystemExit(f"Annotations path does not exist: {args.annotations}")

    annotation_paths = collect_annotation_paths(args.annotations)
    candidates: list[NetHitCandidate] = []
    for annotation_path in annotation_paths:
        candidates.extend(detect_candidates(annotation_path, args))

    payload = {
        "schemaVersion": 1,
        "type": "net_hit_candidates",
        "parameters": {
            "maxDistancePx": args.max_distance_px,
            "minAngleChangeDeg": args.min_angle_change_deg,
            "minGapFrames": args.min_gap_frames,
            "windowFrames": args.window_frames,
        },
        "events": [candidate_to_event(candidate, args.window_frames) for candidate in candidates],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {len(candidates)} net-hit candidates to {args.out}")


def collect_annotation_paths(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted(item for item in path.glob("*.json") if item.is_file())


def detect_candidates(annotation_path: Path, args: argparse.Namespace) -> list[NetHitCandidate]:
    data = read_json(annotation_path)
    video = data.get("video", {})
    video_id = video.get("id") or Path(video.get("filename", annotation_path.stem)).stem
    fps = float(video.get("fps") or 30)
    frames = collect_frame_geometry(data, fps)
    if len(frames) < 3:
        return []

    raw_candidates: list[NetHitCandidate] = []
    for index in range(1, len(frames) - 1):
        previous = frames[index - 1]
        current = frames[index]
        next_frame = frames[index + 1]
        if current.frame - previous.frame > 1 or next_frame.frame - current.frame > 1:
            continue

        distance = distance_to_polyline(current.ball_center, current.net_line)
        if distance > args.max_distance_px:
            continue

        crossing = crosses_net(previous.ball_center, next_frame.ball_center, current.net_line)
        angle_change = trajectory_angle_change(previous.ball_center, current.ball_center, next_frame.ball_center)
        if not crossing and angle_change < args.min_angle_change_deg:
            continue

        confidence = score_candidate(distance, args.max_distance_px, crossing, angle_change)
        raw_candidates.append(
            NetHitCandidate(
                annotation_path=annotation_path,
                video_id=video_id,
                frame=current.frame,
                time_ms=current.time_ms,
                confidence=confidence,
                distance_px=distance,
                crossing=crossing,
                angle_change_deg=angle_change,
            )
        )

    return suppress_nearby_candidates(raw_candidates, args.min_gap_frames)


def collect_frame_geometry(data: dict[str, Any], fps: float) -> list[FrameGeometry]:
    frames: list[FrameGeometry] = []

    for frame_label in data.get("frames", []):
        frame = int(frame_label.get("frame", -1))
        if frame < 0:
            continue

        ball = next(
            (
                item
                for item in frame_label.get("objects", [])
                if item.get("type") == "ball" and not item.get("absent") and not item.get("occluded")
            ),
            None,
        )
        net = next(
            (
                item
                for item in frame_label.get("objects", [])
                if item.get("type") == "net" and not item.get("absent")
            ),
            None,
        )
        if not ball or not net:
            continue

        center = parse_ball_center(ball)
        line = parse_line(net.get("line"))
        if center is None or line is None:
            continue

        frames.append(
            FrameGeometry(
                frame=frame,
                time_ms=int(frame_label.get("timeMs", round((frame / fps) * 1000))),
                ball_center=center,
                net_line=line,
            )
        )

    return sorted(frames, key=lambda item: item.frame)


def parse_ball_center(ball: dict[str, Any]) -> tuple[float, float] | None:
    center = ball.get("center")
    if isinstance(center, list) and len(center) >= 2:
        return float(center[0]), float(center[1])

    bbox = ball.get("bbox")
    if isinstance(bbox, list) and len(bbox) >= 4:
        x, y, width, height = [float(value) for value in bbox[:4]]
        return x + width / 2, y + height / 2

    return None


def parse_line(raw_line: Any) -> list[tuple[float, float]] | None:
    if not isinstance(raw_line, list) or len(raw_line) < 2:
        return None

    line: list[tuple[float, float]] = []
    for point in raw_line:
        if not isinstance(point, list) or len(point) < 2:
            return None
        line.append((float(point[0]), float(point[1])))

    return line


def distance_to_polyline(point: tuple[float, float], line: list[tuple[float, float]]) -> float:
    return min(distance_to_segment(point, start, end) for start, end in pairwise(line))


def distance_to_segment(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    px, py = point
    sx, sy = start
    ex, ey = end
    dx = ex - sx
    dy = ey - sy
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return math.hypot(px - sx, py - sy)

    t = max(0.0, min(1.0, ((px - sx) * dx + (py - sy) * dy) / length_squared))
    closest = (sx + t * dx, sy + t * dy)
    return math.hypot(px - closest[0], py - closest[1])


def crosses_net(
    before: tuple[float, float],
    after: tuple[float, float],
    line: list[tuple[float, float]],
) -> bool:
    segment = nearest_segment(midpoint(before, after), line)
    before_side = signed_distance_to_line(before, segment[0], segment[1])
    after_side = signed_distance_to_line(after, segment[0], segment[1])
    return before_side * after_side < 0


def nearest_segment(
    point: tuple[float, float],
    line: list[tuple[float, float]],
) -> tuple[tuple[float, float], tuple[float, float]]:
    return min(pairwise(line), key=lambda segment: distance_to_segment(point, segment[0], segment[1]))


def signed_distance_to_line(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    px, py = point
    sx, sy = start
    ex, ey = end
    dx = ex - sx
    dy = ey - sy
    length = math.hypot(dx, dy)
    if length == 0:
        return 0
    return ((px - sx) * dy - (py - sy) * dx) / length


def trajectory_angle_change(
    before: tuple[float, float],
    current: tuple[float, float],
    after: tuple[float, float],
) -> float:
    v1 = (current[0] - before[0], current[1] - before[1])
    v2 = (after[0] - current[0], after[1] - current[1])
    mag1 = math.hypot(v1[0], v1[1])
    mag2 = math.hypot(v2[0], v2[1])
    if mag1 == 0 or mag2 == 0:
        return 0

    cosine = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (mag1 * mag2)))
    return math.degrees(math.acos(cosine))


def score_candidate(distance: float, max_distance: float, crossing: bool, angle_change: float) -> float:
    distance_score = max(0.0, 1.0 - distance / max_distance)
    crossing_score = 0.35 if crossing else 0.0
    angle_score = min(0.35, angle_change / 90 * 0.35)
    return round(min(0.99, 0.25 + distance_score * 0.35 + crossing_score + angle_score), 3)


def suppress_nearby_candidates(candidates: list[NetHitCandidate], min_gap_frames: int) -> list[NetHitCandidate]:
    kept: list[NetHitCandidate] = []
    for candidate in sorted(candidates, key=lambda item: item.confidence, reverse=True):
        if any(
            item.annotation_path == candidate.annotation_path
            and abs(item.frame - candidate.frame) < min_gap_frames
            for item in kept
        ):
            continue
        kept.append(candidate)
    return sorted(kept, key=lambda item: (str(item.annotation_path), item.frame))


def candidate_to_event(candidate: NetHitCandidate, window_frames: int) -> dict[str, Any]:
    return {
        "type": "net_hit",
        "frame": candidate.frame,
        "timeMs": candidate.time_ms,
        "windowFrames": [max(0, candidate.frame - window_frames), candidate.frame + window_frames],
        "confidence": candidate.confidence,
        "source": "net_hit_heuristic_v1",
        "annotation": str(candidate.annotation_path),
        "videoId": candidate.video_id,
        "notes": (
            f"distance={candidate.distance_px:.1f}px "
            f"crossing={str(candidate.crossing).lower()} "
            f"angle={candidate.angle_change_deg:.1f}deg"
        ),
        "features": {
            "distancePx": round(candidate.distance_px, 2),
            "crossing": candidate.crossing,
            "angleChangeDeg": round(candidate.angle_change_deg, 2),
        },
    }


def pairwise(items: list[tuple[float, float]]) -> Iterable[tuple[tuple[float, float], tuple[float, float]]]:
    for index in range(len(items) - 1):
        yield items[index], items[index + 1]


def midpoint(first: tuple[float, float], second: tuple[float, float]) -> tuple[float, float]:
    return (first[0] + second[0]) / 2, (first[1] + second[1]) / 2


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


if __name__ == "__main__":
    main()
