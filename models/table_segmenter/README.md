# Table Segmenter Models

`table_yolo26n_seg_img640.pt` is the YOLO segmentation model trained from
`data/exports/table_yolo_seg.zip` in the Colab table segmenter notebook.

Use this model to generate table prediction JSON for the browser labeler:

```bash
python3 tools/export_yolo/predict_table_labels.py \
  --model models/table_segmenter/table_yolo26n_seg_img640.pt \
  --video data/videos/example.mp4 \
  --out data/annotations/example.table_predictions.json
```

The labeler can load the resulting JSON with the Predictions button.
