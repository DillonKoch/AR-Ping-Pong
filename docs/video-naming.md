# Video Naming

Use this format for source videos:

```text
<sequence>_<source>_<date>_<take>.<extension>
```

Example:

```text
002_screen_recording_20260623_01.mov
```

Rules:

- `sequence`: three digits, assigned once and never reused.
- `source`: short lowercase identifier such as `glasses`, `iphone`,
  `screen_recording`, `instagram`, or `youtube`.
- `date`: capture or import date in `YYYYMMDD` format.
- `take`: two digits for multiple videos from the same source and date.
- Use lowercase letters, numbers, and underscores. Avoid spaces and punctuation.

The filename stem is the permanent video ID. The labeler uses it for annotation
and prediction sidecars:

```text
002_screen_recording_20260623_01.mov
002_screen_recording_20260623_01.labels.json
002_screen_recording_20260623_01.ball_predictions.json
002_screen_recording_20260623_01.table_predictions.json
```

Do not rename a video after labeling begins unless every matching sidecar and
the `video.id` and `video.filename` fields inside the label JSON are migrated
together.

Existing source files and sidecars have been migrated to this convention.
