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
