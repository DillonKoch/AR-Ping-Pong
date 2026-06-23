# Geometry Segmenter Models

Put trained table+net YOLO segmentation checkpoints here.

After running `notebooks/train_geometry_segmenter_colab.ipynb`, download:

```txt
/content/runs/ar_ping_pong/geometry_yolo26n_seg_img640/weights/best.pt
```

Save it in this directory as:

```txt
geometry_yolo26n_seg_img640.pt
```

This model predicts two segmentation classes:

- `0`: table
- `1`: net
