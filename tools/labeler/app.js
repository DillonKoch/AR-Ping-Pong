const state = {
  videoObjectUrl: null,
  tool: "ball",
  fps: 30,
  zoom: 1,
  panX: 0,
  panY: 0,
  annotationDirectoryHandle: null,
  activeTablePoints: [],
  activeTableFrame: null,
  activeTablePointDrag: null,
  activeNetPoints: [],
  activeNetFrame: null,
  activeBallDrag: null,
  predictions: createEmptyPredictions(),
  showPredictions: true,
  history: [],
  annotations: createEmptyAnnotations(),
};

const eventHotkeys = {
  "1": "point_start",
  "2": "serve_contact",
  "3": "paddle_contact",
  "4": "bounce_near",
  "5": "bounce_far",
  "6": "net_hit",
  "7": "point_end",
  "8": "ball_lost",
  "9": "uncertain",
};

const elements = {
  videoInput: document.querySelector("#videoInput"),
  annotationInput: document.querySelector("#annotationInput"),
  predictionInput: document.querySelector("#predictionInput"),
  chooseSaveFolderButton: document.querySelector("#chooseSaveFolderButton"),
  downloadButton: document.querySelector("#downloadButton"),
  viewport: document.querySelector("#viewport"),
  video: document.querySelector("#video"),
  canvas: document.querySelector("#overlay"),
  playButton: document.querySelector("#playButton"),
  prevFrameButton: document.querySelector("#prevFrameButton"),
  nextFrameButton: document.querySelector("#nextFrameButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  resetViewButton: document.querySelector("#resetViewButton"),
  fpsInput: document.querySelector("#fpsInput"),
  frameInput: document.querySelector("#frameInput"),
  jumpButton: document.querySelector("#jumpButton"),
  exportFrameButton: document.querySelector("#exportFrameButton"),
  timeline: document.querySelector("#timeline"),
  videoName: document.querySelector("#videoName"),
  timeReadout: document.querySelector("#timeReadout"),
  saveStatus: document.querySelector("#saveStatus"),
  frameSummary: document.querySelector("#frameSummary"),
  eventList: document.querySelector("#eventList"),
  occludedInput: document.querySelector("#occludedInput"),
  blurredInput: document.querySelector("#blurredInput"),
  undoButton: document.querySelector("#undoButton"),
  finishTableButton: document.querySelector("#finishTableButton"),
  closeTableEdgeButton: document.querySelector("#closeTableEdgeButton"),
  clearFrameButton: document.querySelector("#clearFrameButton"),
  newSessionButton: document.querySelector("#newSessionButton"),
  predictionStatus: document.querySelector("#predictionStatus"),
  acceptPredictionButton: document.querySelector("#acceptPredictionButton"),
  togglePredictionsButton: document.querySelector("#togglePredictionsButton"),
};

const ctx = elements.canvas.getContext("2d");
const ANNOTATION_DIRECTORY_DB = "ar-ping-pong-labeler";
const ANNOTATION_DIRECTORY_STORE = "handles";
const ANNOTATION_DIRECTORY_KEY = "annotation-directory";

elements.videoInput.addEventListener("change", handleVideoInput);
elements.annotationInput.addEventListener("change", handleAnnotationInput);
elements.predictionInput.addEventListener("change", handlePredictionInput);
elements.chooseSaveFolderButton.addEventListener("click", chooseAnnotationSaveFolder);
elements.downloadButton.addEventListener("click", downloadAnnotations);
elements.playButton.addEventListener("click", togglePlayback);
elements.prevFrameButton.addEventListener("click", () => stepFrames(-1));
elements.nextFrameButton.addEventListener("click", () => stepFrames(1));
elements.zoomOutButton.addEventListener("click", () => adjustZoom(1 / 1.25));
elements.zoomInButton.addEventListener("click", () => adjustZoom(1.25));
elements.resetViewButton.addEventListener("click", resetView);
elements.fpsInput.addEventListener("change", updateFps);
elements.frameInput.addEventListener("change", jumpToFrameInput);
elements.jumpButton.addEventListener("click", jumpToFrameInput);
elements.exportFrameButton.addEventListener("click", exportCurrentFrame);
elements.timeline.addEventListener("input", handleTimelineInput);
elements.canvas.addEventListener("pointerdown", handleCanvasPointerDown);
elements.canvas.addEventListener("pointermove", handleCanvasPointerMove);
elements.canvas.addEventListener("pointerup", handleCanvasPointerUp);
elements.canvas.addEventListener("pointercancel", cancelBallDrag);
elements.video.addEventListener("loadedmetadata", handleLoadedMetadata);
elements.video.addEventListener("timeupdate", render);
elements.video.addEventListener("seeked", render);
elements.video.addEventListener("play", render);
elements.video.addEventListener("pause", render);
elements.undoButton.addEventListener("click", undo);
elements.finishTableButton.addEventListener("click", finishTablePolygon);
elements.closeTableEdgeButton.addEventListener("click", closeCurrentTableAlongFrameEdge);
elements.clearFrameButton.addEventListener("click", clearCurrentFrame);
elements.newSessionButton.addEventListener("click", newSession);
elements.acceptPredictionButton.addEventListener("click", acceptCurrentTablePrediction);
elements.togglePredictionsButton.addEventListener("click", togglePredictions);

document.querySelectorAll("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => setTool(button.dataset.tool));
});

document.querySelectorAll("[data-event]").forEach((button) => {
  button.addEventListener("click", () => addEvent(button.dataset.event));
});

document.addEventListener("keydown", handleKeydown);
window.addEventListener("resize", render);

render();
restoreAnnotationDirectoryHandle();

function createEmptyAnnotations() {
  return {
    schemaVersion: 1,
    video: {
      id: "",
      filename: "",
      fps: 30,
      width: 0,
      height: 0,
      durationMs: 0,
    },
    frames: [],
    events: [],
  };
}

function createEmptyPredictions() {
  return {
    frames: [],
    sourceFilename: "",
  };
}

async function handleVideoInput(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
  state.videoObjectUrl = URL.createObjectURL(file);
  elements.video.src = state.videoObjectUrl;
  elements.videoName.textContent = file.name;

  const videoId = getVideoId(file.name);
  if (state.annotations.video.id && state.annotations.video.id !== videoId) {
    state.annotations = createEmptyAnnotations();
    state.history = [];
  }
  state.annotations.video.filename = file.name;
  state.annotations.video.id = videoId;
  pushHistory("load-video");

  await tryLoadMatchingAssets(file.name);
}

function getVideoId(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

function handleLoadedMetadata() {
  const video = elements.video;
  const fps = Number(elements.fpsInput.value) || 30;

  state.fps = fps;
  state.annotations.video.fps = fps;
  state.annotations.video.width = video.videoWidth;
  state.annotations.video.height = video.videoHeight;
  state.annotations.video.durationMs = Math.round(video.duration * 1000);

  elements.timeline.max = String(video.duration || 0);
  resizeCanvasToVideo();
  render();
}

function handleAnnotationInput(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      applyAnnotations(parsed);
      updateSaveStatus(`Loaded ${file.name}`);
    } catch (error) {
      window.alert(`Could not load annotation JSON: ${error.message}`);
    }
  });
  reader.readAsText(file);
}

function handlePredictionInput(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      state.predictions = normalizePredictions(parsed, file.name);
      state.showPredictions = true;
      updatePredictionStatus();
      render();
    } catch (error) {
      window.alert(`Could not load prediction JSON: ${error.message}`);
    }
  });
  reader.readAsText(file);
}

function normalizePredictions(input, sourceFilename = "") {
  const frames = Array.isArray(input.frames)
    ? input.frames
    : Array.isArray(input.predictions)
      ? input.predictions
      : [];

  return {
    sourceFilename,
    frames: frames
      .map(normalizePredictionFrame)
      .filter((frame) => frame && frame.objects.length > 0)
      .sort((a, b) => a.frame - b.frame),
  };
}

function normalizePredictionFrame(frameInput) {
  const frame = Number(frameInput.frame);
  if (!Number.isFinite(frame)) return null;

  const rawObjects = Array.isArray(frameInput.objects)
    ? frameInput.objects
    : frameInput.polygon
      ? [{ type: "table", polygon: frameInput.polygon, confidence: frameInput.confidence }]
      : [];

  const objects = rawObjects
    .map((object) => {
      if (object.type !== "table" || !Array.isArray(object.polygon)) return null;
      const polygon = object.polygon
        .map((point) => Array.isArray(point) && point.length >= 2 ? [round(Number(point[0])), round(Number(point[1]))] : null)
        .filter(Boolean);
      if (polygon.length < 3) return null;
      return {
        type: "table",
        polygon,
        confidence: Number.isFinite(Number(object.confidence)) ? Number(object.confidence) : null,
        predicted: true,
      };
    })
    .filter(Boolean);

  return { frame, objects };
}

async function tryLoadMatchingAnnotations(videoFilename) {
  const directoryHandle = await getAnnotationDirectoryHandle({ requestPermission: true });
  if (!directoryHandle) {
    updateSaveStatus("Choose Save Folder to auto-load labels and predictions");
    return;
  }

  await tryLoadMatchingAssetsFromDirectory(videoFilename, directoryHandle);
}

async function tryLoadMatchingAssets(videoFilename) {
  const directoryHandle = await getAnnotationDirectoryHandle({ requestPermission: true });
  if (!directoryHandle) {
    updateSaveStatus("Choose Save Folder to auto-load labels and predictions");
    return;
  }

  await tryLoadMatchingAssetsFromDirectory(videoFilename, directoryHandle);
}

async function tryLoadMatchingAssetsFromDirectory(videoFilename, directoryHandle) {
  const loaded = [];
  const missing = [];
  const annotationFilename = `${getVideoId(videoFilename)}.labels.json`;
  const predictionFilename = `${getVideoId(videoFilename)}.table_predictions.json`;

  try {
    const fileHandle = await directoryHandle.getFileHandle(annotationFilename);
    const file = await fileHandle.getFile();
    const parsed = JSON.parse(await file.text());
    applyAnnotations(parsed);
    loaded.push("labels");
  } catch (error) {
    if (error.name === "NotFoundError") {
      missing.push("labels");
    } else {
      window.alert(`Could not auto-load labels: ${error.message}`);
    }
  }

  try {
    const fileHandle = await directoryHandle.getFileHandle(predictionFilename);
    const file = await fileHandle.getFile();
    const parsed = JSON.parse(await file.text());
    state.predictions = normalizePredictions(parsed, predictionFilename);
    state.showPredictions = true;
    loaded.push("predictions");
  } catch (error) {
    if (error.name === "NotFoundError") {
      state.predictions = createEmptyPredictions();
      missing.push("predictions");
    } else {
      window.alert(`Could not auto-load predictions: ${error.message}`);
    }
  }

  updatePredictionStatus();
  render();

  if (loaded.length > 0) {
    updateSaveStatus(`Loaded ${loaded.join(" and ")}`);
  } else {
    updateSaveStatus(`No saved ${missing.join(" or ")} for ${videoFilename}`);
  }
}

function applyAnnotations(parsed) {
  state.annotations = normalizeAnnotations(parsed);
  state.fps = state.annotations.video.fps || state.fps;
  elements.fpsInput.value = String(state.fps);
  elements.videoName.textContent = state.annotations.video.filename || "Labels loaded";
  state.activeTablePoints = [];
  state.activeTableFrame = null;
  state.activeTablePointDrag = null;
  state.activeNetPoints = [];
  state.activeNetFrame = null;
  state.history = [];
  interpolateBallLabels();
  interpolateTableLabels();
  interpolateNetLabels();
  render();
}

function normalizeAnnotations(input) {
  const empty = createEmptyAnnotations();
  const normalized = {
    ...empty,
    ...input,
    video: { ...empty.video, ...(input.video || {}) },
    frames: Array.isArray(input.frames) ? input.frames : [],
    events: Array.isArray(input.events) ? input.events : [],
  };
  normalized.events = uniqueEvents(normalized.events);
  return normalized;
}

function uniqueEvents(events) {
  const byFrameAndType = new Map();

  events.forEach((event) => {
    byFrameAndType.set(`${event.frame}:${event.type}`, event);
  });

  return Array.from(byFrameAndType.values()).sort((a, b) => a.frame - b.frame || a.type.localeCompare(b.type));
}

function updateFps() {
  state.fps = Number(elements.fpsInput.value) || 30;
  state.annotations.video.fps = state.fps;
  render();
}

function togglePlayback() {
  if (!elements.video.src) return;
  if (elements.video.paused) {
    elements.video.play();
  } else {
    elements.video.pause();
  }
}

function stepFrames(count) {
  if (!elements.video.src) return;
  elements.video.pause();
  elements.video.currentTime = clampTime(elements.video.currentTime + count / state.fps);
  render();
}

function jumpToFrameInput() {
  const frame = Number(elements.frameInput.value) || 0;
  elements.video.pause();
  elements.video.currentTime = clampTime(frame / state.fps);
  render();
}

function handleTimelineInput() {
  if (!elements.video.src) return;
  elements.video.currentTime = Number(elements.timeline.value);
  render();
}

function handleKeydown(event) {
  const target = event.target;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  const key = event.key.toLowerCase();

  if ((event.metaKey || event.ctrlKey) && key === "s") {
    event.preventDefault();
    downloadAnnotations();
    return;
  }

  if (isTyping) return;

  if (key === " ") {
    event.preventDefault();
    togglePlayback();
  }

  if (key === "arrowleft" && event.shiftKey) {
    event.preventDefault();
    panView(40, 0);
  } else if (key === "arrowright" && event.shiftKey) {
    event.preventDefault();
    panView(-40, 0);
  } else if (key === "arrowup" && event.shiftKey) {
    event.preventDefault();
    panView(0, 40);
  } else if (key === "arrowdown" && event.shiftKey) {
    event.preventDefault();
    panView(0, -40);
  } else if (key === "arrowleft" || key === ",") {
    event.preventDefault();
    stepFrames(-1);
  } else if (key === "arrowright" || key === ".") {
    event.preventDefault();
    stepFrames(1);
  } else if (key === "arrowup" || key === "=" || key === "+") {
    event.preventDefault();
    adjustZoom(1.25);
  } else if (key === "arrowdown" || key === "-") {
    event.preventDefault();
    adjustZoom(1 / 1.25);
  } else if (key === "0") {
    event.preventDefault();
    resetView();
  } else if (key === "enter") {
    event.preventDefault();
    finishTablePolygon();
  } else if (key === "escape") {
    event.preventDefault();
    cancelPendingPoints();
  }

  if (key === "b") setTool("ball");
  if (key === "t") setTool("table");
  if (key === "n") setTool("net");
  if (key === "v") setTool("select");
  if (key === "c") closeCurrentTableAlongFrameEdge();
  if (key === "u") undo();
  if (key === "backspace" || key === "delete") clearCurrentFrame();
  if (eventHotkeys[key]) addEvent(eventHotkeys[key]);
}

function setTool(tool) {
  state.tool = tool;
  state.activeTablePoints = [];
  state.activeTableFrame = null;
  state.activeTablePointDrag = null;
  state.activeNetPoints = [];
  state.activeNetFrame = null;
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  render();
}

function adjustZoom(multiplier) {
  const nextZoom = Math.min(8, Math.max(1, state.zoom * multiplier));
  if (nextZoom === 1) {
    state.panX = 0;
    state.panY = 0;
  }
  state.zoom = nextZoom;
  render();
}

function panView(deltaX, deltaY) {
  if (state.zoom === 1) return;

  state.panX += deltaX;
  state.panY += deltaY;
  render();
}

function resetView() {
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  render();
}

function handleCanvasPointerDown(event) {
  if (!elements.video.src || state.tool === "select") return;

  const localPoint = getCanvasLocalPoint(event);
  const point = canvasPointToVideoPoint(localPoint.x, localPoint.y);
  const frame = getCurrentFrame();

  if (state.tool === "ball") {
    elements.canvas.setPointerCapture(event.pointerId);
    state.activeBallDrag = {
      pointerId: event.pointerId,
      frame,
      start: point,
      current: point,
    };
    render();
    return;
  }

  if (state.tool === "table") {
    const tablePoint = findNearestTablePoint(frame, localPoint.x, localPoint.y);
    if (tablePoint) {
      pushHistory("drag-table-point");
      tablePoint.table.interpolated = false;
      state.activeTablePointDrag = {
        pointerId: event.pointerId,
        table: tablePoint.table,
        pointIndex: tablePoint.pointIndex,
      };
      elements.canvas.setPointerCapture(event.pointerId);
      render();
      return;
    }

    if (state.activeTablePoints.length > 0 && state.activeTableFrame !== frame) {
      state.activeTablePoints = [];
    }
    state.activeTableFrame = frame;
    state.activeTablePoints.push(snapTablePoint([round(point.x), round(point.y)]));
    render();
    return;
  }

  if (state.tool === "net") {
    if (state.activeNetPoints.length > 0 && state.activeNetFrame !== frame) {
      state.activeNetPoints = [];
    }
    state.activeNetFrame = frame;
    state.activeNetPoints.push([round(point.x), round(point.y)]);
    if (state.activeNetPoints.length === 2) {
      pushHistory("draw-net");
      const frameLabel = getOrCreateFrameLabel(frame);
      upsertObject(frameLabel, {
        type: "net",
        line: state.activeNetPoints,
        interpolated: false,
      });
      state.activeNetPoints = [];
      state.activeNetFrame = null;
      interpolateNetLabels();
      cleanupEmptyFrames();
    }
    render();
    return;
  }

  cleanupEmptyFrames();
  render();
}

function findNearestTablePoint(frame, canvasX, canvasY) {
  const frameLabel = getFrameLabel(frame);
  const table = frameLabel?.objects.find((object) => object.type === "table");
  if (!table) return null;

  let nearest = null;
  table.polygon.forEach(([x, y], pointIndex) => {
    const point = videoPointToCanvasPoint(x, y);
    const distance = Math.hypot(point.x - canvasX, point.y - canvasY);
    if (distance <= 14 && (!nearest || distance < nearest.distance)) {
      nearest = { table, pointIndex, distance };
    }
  });

  return nearest;
}

function finishTablePolygon() {
  if (state.activeTablePoints.length < 3) return;

  pushHistory("draw-table");
  const frameLabel = getOrCreateFrameLabel(state.activeTableFrame ?? getCurrentFrame());
  upsertObject(frameLabel, {
    type: "table",
    ...completeTablePolygon(state.activeTablePoints),
    interpolated: false,
  });
  state.activeTablePoints = [];
  state.activeTableFrame = null;
  interpolateTableLabels();
  cleanupEmptyFrames();
  render();
}

function closeCurrentTableAlongFrameEdge() {
  const frameLabel = getFrameLabel(getCurrentFrame());
  const table = frameLabel?.objects.find((object) => object.type === "table");
  if (!table) return;

  const sourcePoints = table.boundaryClose?.sourcePoints || table.polygon;
  const completed = completeTablePolygon(sourcePoints, { forceBoundaryClose: true, marginRatio: 0.08 });
  if (!completed.boundaryClose) {
    window.alert("The first and last table points need to be near the video edge before Close Edge can follow the frame boundary.");
    return;
  }

  pushHistory("close-table-edge");
  Object.assign(table, {
    ...completed,
    interpolated: false,
  });
  interpolateTableLabels();
  cleanupEmptyFrames();
  render();
}

function completeTablePolygon(points, options = {}) {
  if (points.length < 3) return { polygon: [...points] };

  const width = state.annotations.video.width || elements.video.videoWidth;
  const height = state.annotations.video.height || elements.video.videoHeight;
  if (!width || !height) return { polygon: [...points] };

  const marginRatio = options.marginRatio ?? 0.03;
  const margin = Math.max(12, Math.min(width, height) * marginRatio);
  if (!options.forceBoundaryClose && countFrameBoundaryPoints(points, width, height, margin) >= 3) {
    return { polygon: [...points] };
  }
  const first = snapPointToFrameEdge(points[0], width, height, margin);
  const last = snapPointToFrameEdge(points[points.length - 1], width, height, margin);

  if (!first || !last) return { polygon: [...points] };

  const direction = chooseBottomFrameBoundaryDirection(last, first, width, height);
  const boundaryPoints = frameBoundaryCornersBetween(last.position, first.position, width, height, direction);
  return {
    polygon: [first.point, ...points.slice(1, -1), last.point, ...boundaryPoints],
    boundaryClose: {
      inferred: true,
      direction,
      sourcePoints: points,
    },
  };
}

function snapTablePoint(point) {
  const width = state.annotations.video.width || elements.video.videoWidth;
  const height = state.annotations.video.height || elements.video.videoHeight;
  if (!width || !height) return point;

  const cornerMargin = Math.max(18, Math.min(width, height) * 0.035);
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const nearestCorner = corners
    .map((corner) => ({ corner, distance: Math.hypot(point[0] - corner[0], point[1] - corner[1]) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearestCorner.distance <= cornerMargin) {
    return nearestCorner.corner.map(round);
  }

  const edgeMargin = Math.max(12, Math.min(width, height) * 0.025);
  const edge = snapPointToFrameEdge(point, width, height, edgeMargin);
  return edge ? edge.point : point;
}

function countFrameBoundaryPoints(points, width, height, margin) {
  return points.filter((point) => snapPointToFrameEdge(point, width, height, margin)).length;
}

function snapPointToFrameEdge(point, width, height, margin) {
  const distances = [
    { edge: "left", distance: point[0], point: [0, point[1]] },
    { edge: "right", distance: width - point[0], point: [width, point[1]] },
    { edge: "top", distance: point[1], point: [point[0], 0] },
    { edge: "bottom", distance: height - point[1], point: [point[0], height] },
  ].sort((a, b) => a.distance - b.distance);

  if (distances[0].distance > margin) return null;

  const snapped = distances[0];
  const clamped = [
    round(Math.max(0, Math.min(width, snapped.point[0]))),
    round(Math.max(0, Math.min(height, snapped.point[1]))),
  ];
  return {
    edge: snapped.edge,
    point: clamped,
    position: frameBoundaryPosition(clamped, width, height),
  };
}

function chooseBottomFrameBoundaryDirection(start, end, width, height) {
  const perimeter = 2 * (width + height);
  const bottomCenter = frameBoundaryPosition([width / 2, height], width, height);
  const clockwiseIncludesBottom = isBoundaryPositionBetween(bottomCenter, start.position, end.position, perimeter, 1);
  return clockwiseIncludesBottom ? 1 : -1;
}

function frameBoundaryCornersBetween(startPosition, endPosition, width, height, direction) {
  const perimeter = 2 * (width + height);
  const corners = [
    { position: 0, point: [0, 0] },
    { position: width, point: [width, 0] },
    { position: width + height, point: [width, height] },
    { position: width + height + width, point: [0, height] },
  ];

  return corners
    .filter((corner) => isBoundaryPositionBetween(corner.position, startPosition, endPosition, perimeter, direction))
    .sort((a, b) => boundaryDistanceFromStart(a.position, startPosition, perimeter, direction) - boundaryDistanceFromStart(b.position, startPosition, perimeter, direction))
    .map((corner) => corner.point);
}

function isBoundaryPositionBetween(position, start, end, perimeter, direction) {
  const total = boundaryDistanceFromStart(end, start, perimeter, direction);
  const distance = boundaryDistanceFromStart(position, start, perimeter, direction);
  return distance > 0 && distance < total;
}

function boundaryDistanceFromStart(position, start, perimeter, direction) {
  if (direction === 1) return (position - start + perimeter) % perimeter;
  return (start - position + perimeter) % perimeter;
}

function frameBoundaryPosition(point, width, height) {
  const [x, y] = point;
  if (y === 0) return x;
  if (x === width) return width + y;
  if (y === height) return width + height + (width - x);
  return width + height + width + (height - y);
}

function cancelPendingPoints() {
  state.activeTablePoints = [];
  state.activeTableFrame = null;
  state.activeNetPoints = [];
  state.activeNetFrame = null;
  state.activeBallDrag = null;
  render();
}

function handleCanvasPointerMove(event) {
  const localPoint = getCanvasLocalPoint(event);
  const point = canvasPointToVideoPoint(localPoint.x, localPoint.y);

  if (state.activeBallDrag && state.activeBallDrag.pointerId === event.pointerId) {
    state.activeBallDrag.current = point;
    render();
    return;
  }

  if (state.activeTablePointDrag && state.activeTablePointDrag.pointerId === event.pointerId) {
    state.activeTablePointDrag.table.polygon[state.activeTablePointDrag.pointIndex] = snapTablePoint([
      round(point.x),
      round(point.y),
    ]);
    render();
    return;
  }
}

function handleCanvasPointerUp(event) {
  if (state.activeTablePointDrag && state.activeTablePointDrag.pointerId === event.pointerId) {
    state.activeTablePointDrag = null;
    elements.canvas.releasePointerCapture(event.pointerId);
    interpolateTableLabels();
    cleanupEmptyFrames();
    render();
    return;
  }

  if (!state.activeBallDrag || state.activeBallDrag.pointerId !== event.pointerId) return;

  const drag = state.activeBallDrag;
  state.activeBallDrag = null;
  elements.canvas.releasePointerCapture(event.pointerId);

  const ball = ballFromDrag(drag.start, drag.current);
  if (!ball) {
    render();
    return;
  }

  pushHistory("draw-ball");
  const frameLabel = getOrCreateFrameLabel(drag.frame);
  upsertObject(frameLabel, {
    type: "ball",
    center: ball.center,
    bbox: ball.bbox,
    occluded: elements.occludedInput.checked,
    blurred: elements.blurredInput.checked,
    interpolated: false,
  });
  interpolateBallLabels();
  cleanupEmptyFrames();
  render();
}

function cancelBallDrag(event) {
  if (state.activeBallDrag && state.activeBallDrag.pointerId === event.pointerId) {
    state.activeBallDrag = null;
    render();
  }
  if (state.activeTablePointDrag && state.activeTablePointDrag.pointerId === event.pointerId) {
    state.activeTablePointDrag = null;
    render();
  }
}

function ballFromDrag(start, end) {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const width = right - left;
  const height = bottom - top;

  if (width < 2 || height < 2) return null;

  return {
    center: [round(left + width / 2), round(top + height / 2)],
    bbox: [round(left), round(top), round(width), round(height)],
  };
}

function addEvent(type) {
  if (!elements.video.src) return;

  pushHistory(`event-${type}`);
  const frame = getCurrentFrame();
  const timeMs = getCurrentTimeMs();
  const existing = state.annotations.events.find((event) => event.frame === frame && event.type === type);
  const eventLabel = {
    type,
    frame,
    timeMs,
    windowFrames: [Math.max(0, frame - 2), frame + 2],
    confidence: 1,
    notes: "",
  };

  if (existing) {
    Object.assign(existing, eventLabel);
  } else {
    state.annotations.events.push(eventLabel);
  }

  state.annotations.events.sort((a, b) => a.frame - b.frame || a.type.localeCompare(b.type));
  render();
}

function clearCurrentFrame() {
  const frame = getCurrentFrame();
  const existingFrameLabel = getFrameLabel(frame);
  const removedManualObject = existingFrameLabel?.objects.some((object) => !object.interpolated);
  pushHistory("clear-frame");
  state.annotations.frames = state.annotations.frames.filter((item) => item.frame !== frame);
  state.annotations.events = state.annotations.events.filter((item) => item.frame !== frame);
  state.activeTablePoints = [];
  state.activeTableFrame = null;
  state.activeTablePointDrag = null;
  state.activeNetPoints = [];
  state.activeNetFrame = null;
  if (removedManualObject) {
    interpolateBallLabels();
    interpolateTableLabels();
    interpolateNetLabels();
  }
  cleanupEmptyFrames();
  render();
}

function acceptCurrentTablePrediction() {
  const prediction = getCurrentTablePrediction();
  if (!prediction) return;

  pushHistory("accept-table-prediction");
  const frame = getCurrentFrame();
  const frameLabel = getOrCreateFrameLabel(frame);
  upsertObject(frameLabel, {
    type: "table",
    polygon: prediction.polygon.map((point) => [...point]),
    confidence: prediction.confidence,
    predictedFromModel: true,
    interpolated: false,
  });
  interpolateTableLabels();
  cleanupEmptyFrames();
  setTool("table");
  render();
}

function togglePredictions() {
  state.showPredictions = !state.showPredictions;
  render();
}

function getCurrentTablePrediction() {
  if (!state.showPredictions) return null;
  const framePrediction = state.predictions.frames.find((item) => item.frame === getCurrentFrame());
  return framePrediction?.objects.find((object) => object.type === "table") || null;
}

function interpolateBallLabels() {
  removeInterpolatedBallLabels();

  const keyedFrames = state.annotations.frames
    .map((frameLabel) => ({
      frameLabel,
      ball: frameLabel.objects.find((object) => object.type === "ball" && !object.interpolated),
    }))
    .filter((item) => item.ball)
    .sort((a, b) => a.frameLabel.frame - b.frameLabel.frame);

  if (keyedFrames.length < 2) {
    return;
  }

  for (let index = 0; index < keyedFrames.length - 1; index += 1) {
    const start = keyedFrames[index];
    const end = keyedFrames[index + 1];
    const startFrame = start.frameLabel.frame;
    const endFrame = end.frameLabel.frame;
    const gap = endFrame - startFrame;

    if (gap <= 1) continue;

    for (let frame = startFrame + 1; frame < endFrame; frame += 1) {
      const frameLabel = getOrCreateFrameLabel(frame);
      const hasBall = frameLabel.objects.some((object) => object.type === "ball");
      if (hasBall) continue;

      const ratio = (frame - startFrame) / gap;
      const center = [
        round(lerp(start.ball.center[0], end.ball.center[0], ratio)),
        round(lerp(start.ball.center[1], end.ball.center[1], ratio)),
      ];
      const startBox = getBallBbox(start.ball);
      const endBox = getBallBbox(end.ball);
      const bbox = [
        round(lerp(startBox[0], endBox[0], ratio)),
        round(lerp(startBox[1], endBox[1], ratio)),
        round(lerp(startBox[2], endBox[2], ratio)),
        round(lerp(startBox[3], endBox[3], ratio)),
      ];

      frameLabel.objects.push({
        type: "ball",
        center,
        bbox,
        occluded: Boolean(start.ball.occluded && end.ball.occluded),
        blurred: Boolean(start.ball.blurred || end.ball.blurred),
        interpolated: true,
      });
      frameLabel.timeMs = Math.round((frame / state.fps) * 1000);
    }
  }

  cleanupEmptyFrames();
}

function interpolateTableLabels() {
  removeInterpolatedTableLabels();

  const keyedFrames = state.annotations.frames
    .map((frameLabel) => ({
      frameLabel,
      table: frameLabel.objects.find((object) => object.type === "table" && !object.interpolated),
    }))
    .filter((item) => item.table)
    .sort((a, b) => a.frameLabel.frame - b.frameLabel.frame);

  if (keyedFrames.length < 2) return;

  for (let index = 0; index < keyedFrames.length - 1; index += 1) {
    const start = keyedFrames[index];
    const end = keyedFrames[index + 1];
    if (start.table.polygon.length !== end.table.polygon.length) continue;

    const startFrame = start.frameLabel.frame;
    const endFrame = end.frameLabel.frame;
    const gap = endFrame - startFrame;
    if (gap <= 1) continue;

    for (let frame = startFrame + 1; frame < endFrame; frame += 1) {
      const frameLabel = getOrCreateFrameLabel(frame);
      const hasTable = frameLabel.objects.some((object) => object.type === "table");
      if (hasTable) continue;

      const ratio = (frame - startFrame) / gap;
      frameLabel.objects.push({
        type: "table",
        polygon: start.table.polygon.map((point, pointIndex) => [
          round(lerp(point[0], end.table.polygon[pointIndex][0], ratio)),
          round(lerp(point[1], end.table.polygon[pointIndex][1], ratio)),
        ]),
        interpolated: true,
      });
      frameLabel.timeMs = Math.round((frame / state.fps) * 1000);
    }
  }

  cleanupEmptyFrames();
}

function interpolateNetLabels() {
  removeInterpolatedNetLabels();

  const keyedFrames = state.annotations.frames
    .map((frameLabel) => ({
      frameLabel,
      net: frameLabel.objects.find((object) => object.type === "net" && !object.interpolated),
    }))
    .filter((item) => item.net && Array.isArray(item.net.line) && item.net.line.length === 2)
    .sort((a, b) => a.frameLabel.frame - b.frameLabel.frame);

  if (keyedFrames.length < 2) return;

  for (let index = 0; index < keyedFrames.length - 1; index += 1) {
    const start = keyedFrames[index];
    const end = keyedFrames[index + 1];
    const startFrame = start.frameLabel.frame;
    const endFrame = end.frameLabel.frame;
    const gap = endFrame - startFrame;
    if (gap <= 1) continue;

    for (let frame = startFrame + 1; frame < endFrame; frame += 1) {
      const frameLabel = getOrCreateFrameLabel(frame);
      const hasNet = frameLabel.objects.some((object) => object.type === "net");
      if (hasNet) continue;

      const ratio = (frame - startFrame) / gap;
      frameLabel.objects.push({
        type: "net",
        line: start.net.line.map((point, pointIndex) => [
          round(lerp(point[0], end.net.line[pointIndex][0], ratio)),
          round(lerp(point[1], end.net.line[pointIndex][1], ratio)),
        ]),
        interpolated: true,
      });
      frameLabel.timeMs = Math.round((frame / state.fps) * 1000);
    }
  }

  cleanupEmptyFrames();
}

function removeInterpolatedBallLabels() {
  state.annotations.frames.forEach((frameLabel) => {
    frameLabel.objects = frameLabel.objects.filter(
      (object) => object.type !== "ball" || !object.interpolated,
    );
  });
}

function removeInterpolatedTableLabels() {
  state.annotations.frames.forEach((frameLabel) => {
    frameLabel.objects = frameLabel.objects.filter(
      (object) => object.type !== "table" || !object.interpolated,
    );
  });
}

function removeInterpolatedNetLabels() {
  state.annotations.frames.forEach((frameLabel) => {
    frameLabel.objects = frameLabel.objects.filter(
      (object) => object.type !== "net" || !object.interpolated,
    );
  });
}

function lerp(start, end, ratio) {
  return start + (end - start) * ratio;
}

function newSession() {
  if (!window.confirm("Clear all labels for this session?")) return;

  pushHistory("new-session");
  const video = state.annotations.video;
  state.annotations = createEmptyAnnotations();
  state.annotations.video = { ...state.annotations.video, ...video };
  state.activeTablePoints = [];
  state.activeTableFrame = null;
  state.activeTablePointDrag = null;
  state.activeNetPoints = [];
  state.activeNetFrame = null;
  render();
}

function undo() {
  const snapshot = state.history.pop();
  if (!snapshot) return;

  state.annotations = JSON.parse(snapshot);
  state.activeTablePoints = [];
  state.activeTableFrame = null;
  state.activeTablePointDrag = null;
  state.activeNetPoints = [];
  state.activeNetFrame = null;
  render();
}

function pushHistory() {
  state.history.push(JSON.stringify(state.annotations));
  if (state.history.length > 100) state.history.shift();
}

function getOrCreateFrameLabel(frame) {
  let frameLabel = state.annotations.frames.find((item) => item.frame === frame);
  if (!frameLabel) {
    frameLabel = {
      frame,
      timeMs: getCurrentTimeMs(),
      objects: [],
    };
    state.annotations.frames.push(frameLabel);
    state.annotations.frames.sort((a, b) => a.frame - b.frame);
  }
  return frameLabel;
}

function upsertObject(frameLabel, object) {
  frameLabel.timeMs = getCurrentTimeMs();
  const index = frameLabel.objects.findIndex((item) => item.type === object.type);
  if (index >= 0) {
    frameLabel.objects[index] = object;
  } else {
    frameLabel.objects.push(object);
  }
}

function cleanupEmptyFrames() {
  state.annotations.frames = state.annotations.frames.filter((frame) => frame.objects.length > 0);
}

async function chooseAnnotationSaveFolder() {
  if (!window.showDirectoryPicker) {
    window.alert("This browser cannot save directly to a project folder. Chrome supports this feature.");
    return;
  }

  try {
    state.annotationDirectoryHandle = await window.showDirectoryPicker({
      id: "ar-ping-pong-annotations",
      mode: "readwrite",
    });
    rememberAnnotationDirectoryHandle(state.annotationDirectoryHandle);
    updateSaveStatus(`Saving to ${state.annotationDirectoryHandle.name}/`);
    if (state.annotations.video.filename) {
      await tryLoadMatchingAssets(state.annotations.video.filename);
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      window.alert(`Could not choose save folder: ${error.message}`);
    }
  }
}

async function downloadAnnotations() {
  const filename = `${state.annotations.video.id || "annotations"}.labels.json`;
  const blob = new Blob([JSON.stringify(state.annotations, null, 2)], {
    type: "application/json",
  });

  const directoryHandle = await getAnnotationDirectoryHandle({ requestPermission: true });
  if (directoryHandle) {
    try {
      const fileHandle = await directoryHandle.getFileHandle(filename, {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      updateSaveStatus(`Saved ${filename}`);
      return;
    } catch (error) {
      updateSaveStatus("Folder save failed; downloaded instead");
      window.alert(`Could not save to selected folder, using download fallback: ${error.message}`);
    }
  }

  downloadBlob(blob, filename);
  updateSaveStatus(`Downloaded ${filename}`);
}

async function restoreAnnotationDirectoryHandle() {
  const directoryHandle = await readAnnotationDirectoryHandle().catch(() => null);
  if (!directoryHandle) return;

  state.annotationDirectoryHandle = directoryHandle;
  let hasPermission = false;
  try {
    hasPermission = await hasDirectoryPermission(directoryHandle, { mode: "readwrite" });
  } catch {
    hasPermission = false;
  }
  updateSaveStatus(
    hasPermission
      ? `Saving to ${directoryHandle.name}/`
      : `Click Save JSON or load a video to reconnect ${directoryHandle.name}/`,
  );
}

async function getAnnotationDirectoryHandle({ requestPermission = false } = {}) {
  if (!state.annotationDirectoryHandle) return null;

  try {
    const hasPermission = await hasDirectoryPermission(state.annotationDirectoryHandle, {
      mode: "readwrite",
      request: requestPermission,
    });
    return hasPermission ? state.annotationDirectoryHandle : null;
  } catch {
    return null;
  }
}

async function hasDirectoryPermission(directoryHandle, { mode = "read", request = false } = {}) {
  if (!directoryHandle.queryPermission) return true;

  const options = { mode };
  if ((await directoryHandle.queryPermission(options)) === "granted") return true;
  if (!request || !directoryHandle.requestPermission) return false;
  return (await directoryHandle.requestPermission(options)) === "granted";
}

function rememberAnnotationDirectoryHandle(directoryHandle) {
  writeAnnotationDirectoryHandle(directoryHandle).catch(() => {});
}

async function writeAnnotationDirectoryHandle(directoryHandle) {
  const db = await openAnnotationHandleDb();
  if (!db) return;

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(ANNOTATION_DIRECTORY_STORE, "readwrite");
    transaction.objectStore(ANNOTATION_DIRECTORY_STORE).put(directoryHandle, ANNOTATION_DIRECTORY_KEY);
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  db.close();
}

async function readAnnotationDirectoryHandle() {
  const db = await openAnnotationHandleDb();
  if (!db) return null;

  const handle = await new Promise((resolve, reject) => {
    const transaction = db.transaction(ANNOTATION_DIRECTORY_STORE, "readonly");
    const request = transaction.objectStore(ANNOTATION_DIRECTORY_STORE).get(ANNOTATION_DIRECTORY_KEY);
    request.addEventListener("success", () => resolve(request.result || null));
    request.addEventListener("error", () => reject(request.error));
  });
  db.close();
  return handle;
}

async function openAnnotationHandleDb() {
  if (!window.indexedDB) return null;

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(ANNOTATION_DIRECTORY_DB, 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(ANNOTATION_DIRECTORY_STORE);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function updateSaveStatus(message) {
  elements.saveStatus.textContent = message;
}

function exportCurrentFrame() {
  if (!elements.video.src) return;

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = elements.video.videoWidth;
  exportCanvas.height = elements.video.videoHeight;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.drawImage(elements.video, 0, 0, exportCanvas.width, exportCanvas.height);

  exportCanvas.toBlob((blob) => {
    if (!blob) return;
    const frame = String(getCurrentFrame()).padStart(6, "0");
    const id = state.annotations.video.id || "frame";
    downloadBlob(blob, `${id}_frame_${frame}.png`);
  }, "image/png");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function render() {
  renderViewportTransform();
  resizeCanvasToVideo();
  drawOverlay();
  renderReadout();
  renderEventButtons();
  updatePredictionStatus();
  renderFrameSummary();
  renderEventList();
}

function renderViewportTransform() {
  elements.viewport.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  elements.zoomOutButton.disabled = state.zoom <= 1;
  elements.resetViewButton.disabled = state.zoom === 1 && state.panX === 0 && state.panY === 0;
  elements.finishTableButton.disabled = state.activeTablePoints.length < 3;
  elements.closeTableEdgeButton.disabled = !getFrameLabel(getCurrentFrame())?.objects.some((object) => object.type === "table");
}

function resizeCanvasToVideo() {
  const video = elements.video;
  if (!video.videoWidth || !video.videoHeight) return;

  const maxHeight = Math.min(window.innerHeight * 0.78, elements.video.videoHeight);
  const aspect = video.videoWidth / video.videoHeight;
  const targetWidth = Math.min(elements.video.videoWidth, maxHeight * aspect);
  elements.viewport.style.width = `${Math.round(targetWidth)}px`;
  elements.viewport.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;

  const width = video.clientWidth;
  const height = video.clientHeight;
  elements.canvas.width = Math.round(width);
  elements.canvas.height = Math.round(height);
  elements.canvas.style.width = `${width}px`;
  elements.canvas.style.height = `${height}px`;
}

function drawOverlay() {
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);

  const prediction = getCurrentTablePrediction();
  if (prediction) {
    drawPredictionTable(prediction);
  }

  const frameLabel = getFrameLabel(getCurrentFrame());
  if (frameLabel) {
    frameLabel.objects.forEach(drawObject);
  }

  drawPendingPolygon(state.activeTablePoints, "#34d399");
  drawPendingPoints(state.activeNetPoints, "#f8fafc");
  drawActiveBallDrag();
}

function drawObject(object) {
  if (object.type === "ball") drawBall(object);
  if (object.type === "table") drawTable(object);
  if (object.type === "net") drawLine(object.line, "#f8fafc");
}

function drawTable(table) {
  drawPolygon(table.polygon, "#34d399");
  table.polygon.forEach(([x, y]) => {
    const point = videoPointToCanvasPoint(x, y);
    ctx.save();
    ctx.fillStyle = table.interpolated ? "rgba(52, 211, 153, 0.5)" : "#34d399";
    ctx.beginPath();
    ctx.arc(point.x, point.y, table.interpolated ? 3 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawPredictionTable(table) {
  drawPolygon(table.polygon, "#ffc857", true, {
    fillStyle: "rgba(255, 200, 87, 0.10)",
    lineDash: [8, 6],
    lineWidth: 2,
  });
  table.polygon.forEach(([x, y]) => {
    const point = videoPointToCanvasPoint(x, y);
    ctx.save();
    ctx.fillStyle = "#ffc857";
    ctx.strokeStyle = "#0b0f14";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}

function drawBall(ball) {
  const bbox = getBallBbox(ball);
  const start = videoPointToCanvasPoint(bbox[0], bbox[1]);
  const end = videoPointToCanvasPoint(bbox[0] + bbox[2], bbox[1] + bbox[3]);
  const width = end.x - start.x;
  const height = end.y - start.y;

  ctx.save();
  ctx.strokeStyle = ball.occluded ? "rgba(255, 200, 87, 0.28)" : "rgba(255, 107, 107, 0.24)";
  ctx.fillStyle = ball.occluded ? "rgba(255, 200, 87, 0.14)" : "rgba(255, 107, 107, 0.12)";
  ctx.lineWidth = 0.75;
  ctx.fillRect(start.x, start.y, width, height);
  ctx.strokeRect(start.x, start.y, width, height);
  ctx.restore();
}

function drawPolygon(points, color, closed = true, options = {}) {
  if (!points || points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = options.fillStyle || "rgba(52, 211, 153, 0.12)";
  ctx.lineWidth = options.lineWidth || 3;
  if (options.lineDash) ctx.setLineDash(options.lineDash);
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    const point = videoPointToCanvasPoint(x, y);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (closed && points.length >= 3) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

function drawLine(points, color) {
  if (!points || points.length < 2) return;

  const start = videoPointToCanvasPoint(points[0][0], points[0][1]);
  const end = videoPointToCanvasPoint(points[1][0], points[1][1]);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

function drawPendingPoints(points, color) {
  points.forEach(([x, y]) => {
    const point = videoPointToCanvasPoint(x, y);
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawPendingPolygon(points, color) {
  if (points.length > 1) {
    drawPolygon(points, color, false);
  }
  drawPendingPoints(points, color);
}

function drawActiveBallDrag() {
  if (!state.activeBallDrag) return;

  const ball = ballFromDrag(state.activeBallDrag.start, state.activeBallDrag.current);
  if (!ball) return;

  drawBall({
    type: "ball",
    center: ball.center,
    bbox: ball.bbox,
    occluded: elements.occludedInput.checked,
  });
}

function renderReadout() {
  const frame = getCurrentFrame();
  const timeMs = getCurrentTimeMs();
  const durationMs = Math.round((elements.video.duration || 0) * 1000);

  elements.playButton.textContent = elements.video.paused ? "Play" : "Pause";
  elements.frameInput.value = String(frame);
  elements.timeline.value = String(elements.video.currentTime || 0);
  elements.timeline.max = String(elements.video.duration || 0);
  elements.timeReadout.textContent = `${formatTime(timeMs)} / ${formatTime(durationMs)} / frame ${frame} / ${state.zoom.toFixed(2)}x`;
}

function renderEventButtons() {
  const frame = getCurrentFrame();
  const activeEvents = new Set(
    state.annotations.events
      .filter((event) => event.frame === frame)
      .map((event) => event.type),
  );

  document.querySelectorAll("[data-event]").forEach((button) => {
    const isActive = activeEvents.has(button.dataset.event);
    button.classList.toggle("frame-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderFrameSummary() {
  const frameLabel = getFrameLabel(getCurrentFrame());
  const prediction = getCurrentTablePrediction();
  elements.frameSummary.innerHTML = "";

  if (!frameLabel || frameLabel.objects.length === 0) {
    elements.frameSummary.append(createSummaryItem("Objects", "None"));
  } else {
    frameLabel.objects.forEach((object) => {
      elements.frameSummary.append(createSummaryItem(object.type, summarizeObject(object)));
    });
  }

  if (prediction) {
    const confidence = prediction.confidence === null ? "" : ` ${(prediction.confidence * 100).toFixed(0)}%`;
    elements.frameSummary.append(createSummaryItem("Prediction", `${prediction.polygon.length} pts${confidence}`));
  }

  const events = state.annotations.events.filter((event) => event.frame === getCurrentFrame());
  if (events.length === 0) {
    elements.frameSummary.append(createSummaryItem("Events", "None"));
  } else {
    events.forEach((event) => {
      elements.frameSummary.append(createSummaryItem("Event", event.type));
    });
  }
}

function updatePredictionStatus() {
  const predictionCount = state.predictions.frames.length;
  const currentPrediction = getCurrentTablePrediction();
  const label = predictionCount === 0
    ? "No predictions loaded"
    : `${predictionCount} predicted frames${currentPrediction ? " / current frame" : ""}`;
  elements.predictionStatus.textContent = label;
  elements.acceptPredictionButton.disabled = !currentPrediction;
  elements.togglePredictionsButton.disabled = predictionCount === 0;
  elements.togglePredictionsButton.textContent = state.showPredictions ? "Hide Predictions" : "Show Predictions";
}


function createSummaryItem(label, value) {
  const item = document.createElement("div");
  const labelNode = document.createElement("span");
  const valueNode = document.createElement("span");
  item.className = "summary-item";
  labelNode.textContent = label;
  valueNode.textContent = value;
  item.append(labelNode, valueNode);
  return item;
}

function renderEventList() {
  const recentEvents = state.annotations.events.slice(-8).reverse();
  elements.eventList.innerHTML = "";

  if (recentEvents.length === 0) {
    const empty = document.createElement("li");
    empty.append("No events yet");
    elements.eventList.append(empty);
    return;
  }

  recentEvents.forEach((event) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const frame = document.createElement("span");
    label.textContent = event.type;
    frame.textContent = `f${event.frame}`;
    item.append(label, frame);
    elements.eventList.append(item);
  });
}

function summarizeObject(object) {
  if (object.type === "ball") {
    const suffix = object.interpolated ? " interp" : "";
    const bbox = getBallBbox(object);
    return `${bbox[0]}, ${bbox[1]} ${bbox[2]}x${bbox[3]}${suffix}`;
  }
  if (object.type === "table") return `${object.polygon.length} pts${object.interpolated ? " interp" : ""}`;
  if (object.type === "net") return `2 pts${object.interpolated ? " interp" : ""}`;
  return "";
}

function getFrameLabel(frame) {
  return state.annotations.frames.find((item) => item.frame === frame);
}

function getCurrentFrame() {
  return Math.round((elements.video.currentTime || 0) * state.fps);
}

function getCurrentTimeMs() {
  return Math.round((elements.video.currentTime || 0) * 1000);
}

function estimateBallRadius() {
  const width = state.annotations.video.width || elements.video.videoWidth || 1920;
  return Math.max(4, Math.round(width * 0.006));
}

function getBallBbox(ball) {
  if (ball.bbox) return ball.bbox;

  const radius = ball.radius || estimateBallRadius();
  return [
    round(ball.center[0] - radius),
    round(ball.center[1] - radius),
    round(radius * 2),
    round(radius * 2),
  ];
}

function canvasPointToVideoPoint(x, y) {
  const video = elements.video;
  return {
    x: x * (video.videoWidth / elements.canvas.width),
    y: y * (video.videoHeight / elements.canvas.height),
  };
}

function getCanvasLocalPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * elements.canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * elements.canvas.height,
  };
}

function videoPointToCanvasPoint(x, y) {
  const video = elements.video;
  return {
    x: x * (elements.canvas.width / video.videoWidth),
    y: y * (elements.canvas.height / video.videoHeight),
  };
}

function videoLengthToCanvasLength(length) {
  const video = elements.video;
  if (!video.videoWidth) return length;
  return length * (elements.canvas.width / video.videoWidth);
}

function clampTime(time) {
  const duration = elements.video.duration || 0;
  return Math.max(0, Math.min(duration, time));
}

function formatTime(ms) {
  const safeMs = Number.isFinite(ms) ? ms : 0;
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const millis = safeMs % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function round(value) {
  return Math.round(value);
}
