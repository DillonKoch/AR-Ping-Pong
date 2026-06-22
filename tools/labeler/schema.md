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
video boundary, preferring the bottom portion of the frame for near-side cropped
tables. Interpolated table labels are generated only between manual table
polygons with matching point counts.

If a cropped table closes with a bad diagonal across the frame, use the labeler's
`Close Edge` action on that frame. It snaps the first and last table polygon
points to nearby video edges and inserts any frame-corner points needed to close
the table along the image boundary.

When drawing table polygons, points clicked near the image edge snap to the
exact edge, and points clicked near an image corner snap to the exact corner.
This makes it reasonable to label offscreen table regions by tracing the visible
table boundary and then continuing around the video frame boundary.

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

## Shot Chart Projection

The labeler can project labeled bounce events onto a normalized top-down table
chart. A bounce point is projected when the bounce event frame, or a nearby
frame inside `windowFrames`, has both:

- a `ball` object with `center`
- a `table` object with a polygon of at least four points

The projection estimates four table corners from the polygon and solves a
homography from image pixels into normalized table coordinates:

```text
u = 0.0 left edge, 1.0 right edge
v = 0.0 far edge, 1.0 near edge
```

This works best when table labels use the four visible table corners in a
consistent order. Extra inferred frame-boundary points are tolerated, but a
future dedicated table-corner label will be more precise.

## Export Strategy

Keep annotation JSON as the source of truth. Export scripts can later convert it
to COCO, YOLO, tracking CSVs, or model-specific event windows.

## Prediction Overlay JSON

The labeler can load model predictions as a separate JSON file. Predictions are
displayed as an overlay and are not saved as labels unless accepted in the UI.
Accepted table predictions become normal editable table labels.

```json
{
  "frames": [
    {
      "frame": 1842,
      "objects": [
        {
          "type": "table",
          "polygon": [[410, 690], [1470, 675], [1260, 438], [610, 448]],
          "confidence": 0.91
        }
      ]
    }
  ]
}
```

For quick scripts, each frame may also use a top-level `polygon` field instead
of an `objects` array.
