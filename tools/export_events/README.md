# Event Clip Dataset Exporter

Converts event labels from `tools/labeler` JSON files into fixed-length video
clips for temporal event classification.

This is meant for labels such as:

- `point_start`
- `serve_contact`
- `paddle_contact`
- `bounce_near`
- `bounce_far`
- `net_hit`
- `point_end`
- `ball_lost`
- `uncertain`

## Install

```bash
python3 -m pip install -r tools/export_events/requirements.txt
```

## Export

```bash
python3 tools/export_events/export_event_clips.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/events
```

The exporter creates:

```txt
data/exports/events/
  class_names.json
  metadata.csv
  clips/
    train/
      bounce_near/
      bounce_far/
      ...
    val/
      bounce_near/
      bounce_far/
      ...
```

Each clip is centered on the labeled event frame where possible. The default
window is 16 frames total, with 8 frames before and 7 frames after the event.

## Background Clips

You can add negative/background examples from regions away from labeled events:

```bash
python3 tools/export_events/export_event_clips.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/events \
  --background-per-video 20
```

Background clips are useful once you have enough video; they teach the model not
to hallucinate bounce/net/contact events during ordinary flight.

## Net-Hit Candidate Heuristic

Before training a temporal model, you can draft candidate `net_hit` events from
existing ball and net labels:

```bash
python3 tools/export_events/detect_net_hit_candidates.py \
  --annotations data/annotations \
  --out data/exports/net_hit_candidates.json
```

The heuristic looks for frames where the labeled ball center is close to the
labeled net line and either crosses the net line or changes trajectory sharply.
The output is review data, not ground truth. Tune the thresholds if it is too
strict or too noisy:

```bash
python3 tools/export_events/detect_net_hit_candidates.py \
  --annotations data/annotations \
  --out data/exports/net_hit_candidates.json \
  --max-distance-px 24 \
  --min-angle-change-deg 18
```

## Validation

Use `--split-mode video` once you have several labeled videos. This keeps whole
source videos in either train or validation, which is much more honest than
mixing nearby frames from the same video into both splits.
