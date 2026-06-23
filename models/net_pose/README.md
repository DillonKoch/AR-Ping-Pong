# Net Pose Models

Put trained net-line YOLO pose checkpoints here.

The first draft predicts one object class, `net`, with three keypoints:

- `left`
- `middle`
- `right`

The middle point is the net sag/dip point. For labels that only have two points,
the exporter synthesizes a midpoint for training.

After running a net pose training job, save the best checkpoint here as:

```txt
net_yolo26n_pose_img640.pt
```
