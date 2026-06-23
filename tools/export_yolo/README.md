# YOLO Dataset Exporters

Converts labeler JSON files from `tools/labeler` into Ultralytics-compatible
YOLO datasets.

## Install

```bash
python3 -m pip install -r tools/export_yolo/requirements.txt
```

## Export Ball Detection

Place source videos in `data/videos/` and saved label JSON files in
`data/annotations/`, then run:

```bash
python3 tools/export_yolo/export_ball_dataset.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/ball_yolo
```

The exporter creates:

```txt
data/exports/ball_yolo/
  dataset.yaml
  manifest.json
  images/
    train/
    val/
  labels/
    train/
    val/
```

Each YOLO label line is:

```txt
0 x_center y_center width height
```

Coordinates are normalized to `[0, 1]`.

Ball labels with `bbox` are exported as rectangular boxes. Older `center` plus
`radius` labels are still supported and exported as square boxes.

## Train

```bash
yolo detect train \
  model=yolo26n.pt \
  data=data/exports/ball_yolo/dataset.yaml \
  epochs=100 \
  imgsz=960
```

For serious validation, use `--split-mode video` once you have several labeled
videos. That keeps entire videos in either train or validation and gives a more
honest read on generalization.

By default, blurred ball labels are included and occluded ball labels are
skipped. Use `--exclude-blurred` for a cleaner first dataset or
`--include-occluded` if you want the detector to learn harder examples.

Export model ball predictions for review in the browser labeler:

```bash
python3 tools/export_yolo/predict_ball_labels.py \
  --model models/ball_detector/ball_yolo26n_img960.pt \
  --video data/videos/match_001.mp4 \
  --out data/annotations/match_001.ball_predictions.json
```

If the labeler's Save Folder is set, a matching `*.ball_predictions.json` file
auto-loads when you choose the video. Ball predictions are overlays until you
accept them with `Accept Ball`.

## Export Table Segmentation

Table labels are polygons, so the table exporter creates a YOLO segmentation
dataset:

```bash
python3 tools/export_yolo/export_table_dataset.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/table_yolo_seg \
  --clean
```

The table exporter includes interpolated labels by default. That is useful for a
quick smoke test because it turns a few manual table keyframes into more labeled
training frames. Use `--manual-only` once you want a cleaner dataset with only
human-clicked polygons.

Train a quick segmentation model:

```bash
yolo segment train \
  model=yolo26n-seg.pt \
  data=data/exports/table_yolo_seg/dataset.yaml \
  epochs=30 \
  imgsz=960
```

Export model table predictions for review in the browser labeler:

```bash
python3 tools/export_yolo/predict_table_labels.py \
  --model models/table_segmenter/table_yolo26n_seg_img640.pt \
  --video data/videos/match_001.mp4 \
  --out data/annotations/match_001.table_predictions.json
```

Load the resulting JSON with the labeler's Predictions button. Predictions are
only overlays until accepted into a frame label.

## Export Combined Table + Net Segmentation

There is not a trained net model yet. The first draft is a combined geometry
segmenter with two classes:

- `0`: table
- `1`: net

The exporter writes table polygons directly and converts each labeled net line
into a thin segmentation band.

```bash
python3 tools/export_yolo/export_geometry_dataset.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/geometry_yolo_seg \
  --clean
```

Tune the net mask thickness if the training labels look too skinny or too wide:

```bash
python3 tools/export_yolo/export_geometry_dataset.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/geometry_yolo_seg \
  --net-thickness-px 18 \
  --clean
```

Train it with the same Ultralytics segmentation command:

```bash
yolo segment train \
  model=yolo26n-seg.pt \
  data=data/exports/geometry_yolo_seg/dataset.yaml \
  epochs=30 \
  imgsz=960
```

This combined model is the quickest path because it predicts the table and net
in one pass. If the net masks are too imprecise, the next version should be a
dedicated keypoint/pose model for left endpoint, midpoint/dip, and right
endpoint.

Export combined geometry predictions for review in the browser labeler:

```bash
python3 tools/export_yolo/predict_geometry_labels.py \
  --model models/geometry_segmenter/geometry_yolo26n_seg_img640.pt \
  --video data/videos/match_001.mp4 \
  --out data/annotations/match_001.geometry_predictions.json
```

The predictor keeps the best table mask as a polygon and converts the best net
mask into a three-point editable net line. If the labeler's Save Folder is set,
a matching `*.geometry_predictions.json` file auto-loads when you choose the
video.

## Export Net Line Pose Dataset

The net can also be trained as a direct keypoint/pose problem instead of a thin
segmentation mask. This matches the labeler format more closely: left endpoint,
middle/dip, right endpoint.

```bash
python3 tools/export_yolo/export_net_pose_dataset.py \
  --annotations data/annotations \
  --videos data/videos \
  --out data/exports/net_yolo_pose \
  --clean
```

Train a first net keypoint model:

```bash
yolo pose train \
  model=yolo26n-pose.pt \
  data=data/exports/net_yolo_pose/dataset.yaml \
  epochs=30 \
  imgsz=640
```

Export net-line predictions for labeler review:

```bash
python3 tools/export_yolo/predict_net_pose_labels.py \
  --model models/net_pose/net_yolo26n_pose_img640.pt \
  --video data/videos/match_001.mp4 \
  --out data/annotations/match_001.net_predictions.json
```

The labeler can load these predictions with the Predictions picker. If Save
Folder auto-load is enabled, use the filename pattern
`<video-id>.net_predictions.json`.
