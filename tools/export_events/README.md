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

## Validation

Use `--split-mode video` once you have several labeled videos. This keeps whole
source videos in either train or validation, which is much more honest than
mixing nearby frames from the same video into both splits.
