# Model Training Notes

## 2026-06-22 Geometry Segmenter Smoke Test

Goal: train a first combined YOLO segmentation model for table and net geometry.

Dataset:

- Exporter: `tools/export_yolo/export_geometry_dataset.py`
- Dataset path: `data/exports/geometry_yolo_seg`
- Source labels: `data/annotations/1_ig_reel.labels.json`
- Source video: `data/videos/1_ig_reel.MOV`
- Exported frames: 366
- Train/val split: 293 train, 73 val
- Exported objects: 178 table masks, 348 net masks
- Background-only frames: 0
- Net label representation: thin segmentation band generated from 2- or 3-point net line
- Model: `yolo26n-seg.pt`
- Training notebook: `notebooks/train_geometry_segmenter_colab.ipynb`
- Training config: 30 epochs, image size 640, batch 2
- Runtime: Colab Tesla T4 GPU

Final validation from `best.pt`:

| Class | Box P | Box R | Box mAP50 | Box mAP50-95 | Mask P | Mask R | Mask mAP50 | Mask mAP50-95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| all | 0.982 | 0.381 | 0.523 | 0.386 | 0.982 | 0.381 | 0.452 | 0.327 |
| table | 0.965 | 0.763 | 0.880 | 0.710 | 0.965 | 0.763 | 0.878 | 0.644 |
| net | 1.000 | 0.000 | 0.166 | 0.063 | 1.000 | 0.000 | 0.025 | 0.010 |

Takeaways:

- The table class learned surprisingly well for a small first dataset.
- The net class effectively did not learn. The combined overall score is mostly
  carried by table performance.
- YOLO segmentation is struggling with the net as a very thin, low-area object.
- The combined model lets the large obvious table dominate the training signal.
- Because there are no background-only frames, this experiment does not teach the
  model when to predict nothing.

Save the trained checkpoint from Colab:

```txt
/content/runs/ar_ping_pong/geometry_yolo26n_seg_img640/weights/best.pt
```

Store it locally as:

```txt
models/geometry_segmenter/geometry_yolo26n_seg_img640.pt
```

Next things to try:

- Still run `predict_geometry_labels.py` with this checkpoint to inspect table
  prediction quality in the labeler.
- Do not expect useful net predictions from this checkpoint.
- Try a net-focused export with thicker net masks, for example
  `--net-thickness-px 24` or `--net-thickness-px 32`.
- Consider a net-only segmentation model so the table cannot dominate loss and
  metrics.
- Add background frames where table/net are absent to reduce hallucinated
  predictions.
- If segmentation remains poor for the net, move to a dedicated keypoint/pose
  formulation: left endpoint, midpoint/dip, right endpoint.
- Add more manually corrected net labels from varied viewpoints before trusting
  net metrics.

## Draft Net Line Pose Experiment

Hypothesis: the net is a better keypoint/pose problem than a segmentation
problem. The labeler already stores the desired output as a 2- or 3-point line,
so the exporter can train a model to predict left endpoint, middle/dip, and
right endpoint directly.

Drafted tooling:

- `tools/export_yolo/export_net_pose_dataset.py`
- `tools/export_yolo/predict_net_pose_labels.py`
- `notebooks/train_net_pose_colab.ipynb`
- `models/net_pose/README.md`

Current export from `1_ig_reel.labels.json`:

- Exported net pose frames: 425
- Train/val split: 340 train, 85 val
- Dataset path: `data/exports/net_yolo_pose`
- Zip path for Colab: `data/exports/net_yolo_pose.zip`
- YOLO pose keypoints: `left`, `middle`, `right`
- Dataset YAML uses `kpt_shape: [3, 3]` and `flip_idx: [2, 1, 0]`

Success criteria for this experiment:

- Keypoint predictions produce an editable net line in the labeler.
- Recall should be meaningfully above zero, unlike the net segmentation result.
- Visual predictions should place endpoints near the visible net posts/edges and
  the middle point near the sag/dip.
