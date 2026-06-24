# AR Ping Pong

A Meta Ray-Ban Display glasses prototype for ping pong assistance.

The long-term product is a glasses-first ping pong companion: manual scorekeeping,
AI referee support, ball/table tracking, event detection, rally history, shot charts,
and lightweight coaching overlays. This repo starts with the lowest-risk useful
feature: a display-friendly manual scorekeeper that can run as a Web App.

## Why Start With A Web App

Meta's Display Glasses developer preview supports two paths:

- **Web Apps**: standard HTML, CSS, and JavaScript, deployed through a public HTTPS
  URL. This is the fastest path for prototyping HUDs, scoring flows, menus, local
  state, and Neural Band/D-pad interactions.
- **Device Access Toolkit**: native iOS/Android integration for deeper hardware
  access such as camera, audio, and display. This is likely the right path for
  ball tracking, table detection, bounce detection, net-hit detection, and a full
  AI referee.

This repo uses the Web App path first so we can validate the UX on the 600x600
display before investing in the native perception stack.

## Current Prototype

- 600x600 glasses-style viewport
- Manual scorekeeping for two players
- Arrow-key/D-pad navigation
- Serve indicator and basic win-by-two game-point status
- Match log stored in browser local storage
- Reset controls for the current game and the whole match

Open `index.html` in a browser and use arrow keys plus `Enter`.

## Data Labeling Tool

The repo includes a local browser labeler at `tools/labeler/index.html` for
preparing POV ping pong datasets before the display glasses are available.

Use it to:

- Load a local video from `data/videos/` or anywhere on disk.
- Step through frames and label ball boxes, table polygon, and net line.
- Mark referee events such as point start, bounce, paddle contact, net hit, point
  end, and uncertain frames.
- Save/load annotation JSON sidecars.
- Export the current frame as a PNG for model-training experiments.

When `Auto-follow ball` is enabled, paused frame changes center and zoom around
the current ball label. On an unlabeled frame, the labeler extrapolates from the
two most recent visible ball labels and scales the view using recent box size.
Manual zoom temporarily pauses auto-follow; drawing or accepting the next ball
label resumes it for subsequent frames.

Suggested data layout:

```txt
data/
  videos/       # source POV videos, ignored by git except .gitkeep
  annotations/  # saved *.labels.json files
  exports/      # exported frames or converted training datasets
```

Name new videos using the permanent-ID convention in
`docs/video-naming.md`, for example `002_screen_recording_20260623_01.mov`.

Labeler shortcuts:

- `W`: jump one frame past the furthest active ball, table, or net label
- `Space`: play/pause
- `A` / `D`: previous/next frame
- `S`: clear the active ball, table, or net label on the current frame
- `Q` / `E`: zoom out/in
- `,` / `.`: previous/next frame
- `Left` / `Right`: previous/next frame
- `Up` / `Down`: zoom in/out
- `+` / `-`: zoom in/out
- `0`: reset zoom and pan
- `Shift` + arrows: pan while zoomed
- Drag on the video: draw the current ball bounding box
- `Enter`: finish a table polygon with three or more points
- `F`: flip a cropped table's fill to the opposite frame-edge closure
- `Escape`: cancel pending table/net points
- Drag table/net vertices: correct saved or pending table/net points
- `B`: ball tool
- `T`: table tool
- `N`: net tool
- `V`: select/no-draw tool
- `1`-`9`: add event labels
- `U`: undo
- `Delete`: clear current frame
- `Cmd/Ctrl+S`: save annotation JSON

In Chrome, click `Save Folder` and choose `data/annotations/` before labeling.
After that, `Save JSON` or `Cmd/Ctrl+S` writes the current `.labels.json` file
directly into that folder. If direct folder saving is unavailable, the labeler
falls back to downloading the JSON file.

The labeler names sidecars as `<video-id>.labels.json`, where `<video-id>` is
the video filename without its extension. For example,
`001_instagram_20260621_01.mov` saves to
`data/annotations/001_instagram_20260621_01.labels.json`. Once Chrome has access to
`data/annotations/`, loading a video will auto-load the matching labels if that
file exists. If you pick the video before choosing the save folder, choosing the
folder will retry the auto-load.

## Ball Detection Training Pipeline

After labeling ball positions, export the labels into an Ultralytics YOLO
dataset:

```bash
python3 -m pip install -r tools/export_yolo/requirements.txt
python3 tools/export_yolo/export_ball_dataset.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/ball_yolo
```

The exporter reads labeler JSON files, extracts the labeled video frames, writes
YOLO label text files, and creates `data/exports/ball_yolo/dataset.yaml`.

Train a first detector locally or in Colab:

```bash
yolo detect train \
  model=yolo26n.pt \
  data=data/exports/ball_yolo/dataset.yaml \
  epochs=100 \
  imgsz=960
```

After training, export ball predictions for labeler review:

```bash
python3 tools/export_yolo/predict_ball_labels.py \
  --model models/ball_detector/ball_yolo26n_img960.pt \
  --video data/videos/match_001.mp4 \
  --out data/annotations/match_001.ball_predictions.json
```

Notebooks:

- `notebooks/colab_hello_world.ipynb`: quick VS Code/Colab runtime smoke test.
- `notebooks/train_ball_detector_colab.ipynb`: baseline YOLO training notebook.
- `notebooks/train_table_segmenter_colab.ipynb`: baseline YOLO segmentation
  notebook for table polygons.
- `notebooks/train_geometry_segmenter_colab.ipynb`: baseline YOLO segmentation
  notebook for combined table and net geometry.
- `notebooks/train_net_pose_colab.ipynb`: baseline YOLO pose/keypoint notebook
  for direct net-line prediction.

Start with `yolo26n.pt` at `imgsz=960`, then compare `yolo26s.pt` once the
export/training loop works. For honest validation, collect several videos and
export with `--split-mode video` so train and validation frames come from
different source videos.

## Table Segmentation Training Pipeline

After labeling table polygons, export them into an Ultralytics YOLO segmentation
dataset:

```bash
python3 tools/export_yolo/export_table_dataset.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/table_yolo_seg \
  --clean
```

For early smoke tests, the exporter includes interpolated table labels. Use
`--manual-only` later when you want to train only on human-corrected polygons.

Train a first table segmenter locally or in Colab:

```bash
yolo segment train \
  model=yolo26n-seg.pt \
  data=data/exports/table_yolo_seg/dataset.yaml \
  epochs=30 \
  imgsz=960
```

## Combined Table + Net Geometry Pipeline

We currently have a standalone table segmenter, not a trained net detector. The
first net-model draft is a combined YOLO segmentation model with two classes:
`table` and `net`. Net line labels are converted into thin segmentation bands.

```bash
python3 tools/export_yolo/export_geometry_dataset.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/geometry_yolo_seg \
  --clean
```

Then train:

```bash
yolo segment train \
  model=yolo26n-seg.pt \
  data=data/exports/geometry_yolo_seg/dataset.yaml \
  epochs=30 \
  imgsz=960
```

After training, export geometry predictions for labeler review:

```bash
python3 tools/export_yolo/predict_geometry_labels.py \
  --model models/geometry_segmenter/geometry_yolo26n_seg_img640.pt \
  --video data/videos/match_001.mp4 \
  --out data/annotations/match_001.geometry_predictions.json
```

If the net band is too skinny or too wide, rerun the exporter with
`--net-thickness-px`. If segmentation is not precise enough for the sagging net
line, the next model should be a dedicated three-keypoint net detector.

See `docs/model-training-notes.md` for experiment results and lessons learned
from model runs.

## Net Line Keypoint Pipeline

The net line can also be trained directly as a pose/keypoint task. This predicts
three editable points instead of a segmentation mask: left endpoint, middle/dip,
and right endpoint.

```bash
python3 tools/export_yolo/export_net_pose_dataset.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/net_yolo_pose \
  --clean
```

Train:

```bash
yolo pose train \
  model=yolo26n-pose.pt \
  data=data/exports/net_yolo_pose/dataset.yaml \
  epochs=30 \
  imgsz=640
```

After training, export net-line predictions:

```bash
python3 tools/export_yolo/predict_net_pose_labels.py \
  --model models/net_pose/net_yolo26n_pose_img640.pt \
  --video data/videos/match_001.mp4 \
  --out data/annotations/match_001.net_predictions.json
```

## Event Detection Training Pipeline

After labeling events, export short video clips centered on those events:

```bash
python3 -m pip install -r tools/export_events/requirements.txt
python3 tools/export_events/export_event_clips.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/events
```

The exporter creates class folders of clips plus `metadata.csv` and
`class_names.json`. Use background clips once you have longer videos:

```bash
python3 tools/export_events/export_event_clips.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/events \
  --background-per-video 20 \
  --split-mode video
```

Train a first temporal classifier with
`notebooks/train_event_classifier_colab.ipynb`. This is intentionally a baseline:
short clips around event labels, a torchvision video model, and simple train/val
metrics. The likely long-term referee will combine ball tracking, table geometry,
rules, and a temporal classifier rather than relying on event classification
alone.

You can also generate first-pass `net_hit` candidates from ball and net labels:

```bash
python3 tools/export_events/detect_net_hit_candidates.py \
  --annotations data/annotations \
  --out data/exports/net_hit_candidates.json
```

This is a review heuristic, not ground truth. It scores frames where the ball is
near the net and either crosses it or changes trajectory sharply.

## Controls

- `Left` / `Right`: move focus between controls
- `Enter` / `Space`: activate selected control
- `A`: add point for player A
- `L`: add point for player B
- `U`: undo the last point
- `R`: reset the current game

For cropped tables, start the table polygon at one point where the table leaves
the video frame and end at the other frame-edge exit point. When both endpoints
are near the frame boundary, the labeler closes the polygon along the video edge
and inserts any needed frame corners automatically. Because the camera user is
on the near side of the table, cropped-table closure always prefers the bottom
portion of the frame. If that shades the outside instead, use `F` or
`Flip Table Fill` to switch to the opposite frame-edge route.

Table labels auto-interpolate between manual keyframes when both table polygons
have the same number of points. If the point counts differ, that gap is skipped
so the labeler does not guess the wrong vertex correspondence.

## Product Roadmap

1. **Manual scorekeeping MVP**
   - Fast scoring with Neural Band-friendly gestures.
   - Clear score, server, game point, and match history overlays.
2. **Match tools**
   - Game/match formats, side switching, doubles support, exportable match logs.
3. **Assisted referee**
   - Point start/stop detection, bounce/net-hit event candidates, confidence UI,
     and human confirmation.
4. **Computer vision**
   - Table detection, ball tracking, paddle/player context, bounce localization.
5. **Analytics**
   - Rally lengths, serve success, shot placement, heatmaps, and shot charts.

## Implementation Notes

The Web App prototype intentionally keeps logic in plain JavaScript. The later
native perception work should be isolated behind an event stream contract, for
example:

```ts
type RefereeEvent =
  | { type: "point_started"; at: number }
  | { type: "bounce"; side: "near" | "far"; x: number; y: number; confidence: number }
  | { type: "net_hit"; confidence: number }
  | { type: "point_ended"; winner: "a" | "b"; confidence: number };
```

That lets the HUD stay stable while the sensing implementation evolves.
