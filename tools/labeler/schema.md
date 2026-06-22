# Annotation Schema

The labeler stores one JSON annotation file per source video. The video remains
the source media; frame images are exported only when needed for training jobs.

## Top-level Shape

```json
{
  "schemaVersion": 1,
  "video": {
    "id": "match_001",
    "filename": "match_001.mp4",
    "fps": 30,
    "width": 1920,
    "height": 1080,
    "durationMs": 73422
  },
  "frames": [],
  "events": []
}
```

## Frame Labels

Frame labels are sparse. Only frames with labels are present.

```json
{
  "frame": 1842,
  "timeMs": 61400,
  "objects": [
    {
      "type": "ball",
      "center": [921, 451],
      "bbox": [912, 442, 18, 18],
      "occluded": false,
      "blurred": true
    },
    {
      "type": "table",
      "polygon": [[410, 690], [1470, 675], [1260, 438], [610, 448]]
    },
    {
      "type": "net",
      "line": [[598, 456], [1267, 446]]
    }
  ]
}
```

Coordinates are stored in source video pixels, not canvas pixels. Ball labels
store both `bbox` and `center` when possible: `bbox` is the training label for
object detection, while `center` remains useful for tracking and event logic.
Table labels are polygons with three or more points; include image-edge points
when the physical table is cropped by the camera frame. The labeler can infer
frame-corner points when the first and last table polygon points are near the
video boundary. Interpolated table labels are generated only between manual
table polygons with matching point counts.

## Event Labels

Events are frame-anchored and can include an uncertainty window.

```json
{
  "type": "bounce_far",
  "frame": 1842,
  "timeMs": 61400,
  "windowFrames": [1839, 1846],
  "confidence": 1,
  "notes": ""
}
```

Supported event types:

- `point_start`
- `serve_contact`
- `paddle_contact`
- `bounce_near`
- `bounce_far`
- `net_hit`
- `point_end`
- `ball_lost`
- `uncertain`

## Export Strategy

Keep annotation JSON as the source of truth. Export scripts can later convert it
to COCO, YOLO, tracking CSVs, or model-specific event windows.
