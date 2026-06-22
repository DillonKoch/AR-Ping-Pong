const state = {
  videoObjectUrl: null,
  tool: "ball",
  fps: 30,
  activeTablePoints: [],
  activeNetPoints: [],
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
  downloadButton: document.querySelector("#downloadButton"),
  video: document.querySelector("#video"),
  canvas: document.querySelector("#overlay"),
  playButton: document.querySelector("#playButton"),
  prevFrameButton: document.querySelector("#prevFrameButton"),
  nextFrameButton: document.querySelector("#nextFrameButton"),
  fpsInput: document.querySelector("#fpsInput"),
  frameInput: document.querySelector("#frameInput"),
  jumpButton: document.querySelector("#jumpButton"),
  exportFrameButton: document.querySelector("#exportFrameButton"),
  timeline: document.querySelector("#timeline"),
  videoName: document.querySelector("#videoName"),
  timeReadout: document.querySelector("#timeReadout"),
  frameSummary: document.querySelector("#frameSummary"),
  eventList: document.querySelector("#eventList"),
  occludedInput: document.querySelector("#occludedInput"),
  blurredInput: document.querySelector("#blurredInput"),
  undoButton: document.querySelector("#undoButton"),
  clearFrameButton: document.querySelector("#clearFrameButton"),
  newSessionButton: document.querySelector("#newSessionButton"),
};

const ctx = elements.canvas.getContext("2d");

elements.videoInput.addEventListener("change", handleVideoInput);
elements.annotationInput.addEventListener("change", handleAnnotationInput);
elements.downloadButton.addEventListener("click", downloadAnnotations);
elements.playButton.addEventListener("click", togglePlayback);
elements.prevFrameButton.addEventListener("click", () => stepFrames(-1));
elements.nextFrameButton.addEventListener("click", () => stepFrames(1));
elements.fpsInput.addEventListener("change", updateFps);
elements.frameInput.addEventListener("change", jumpToFrameInput);
elements.jumpButton.addEventListener("click", jumpToFrameInput);
elements.exportFrameButton.addEventListener("click", exportCurrentFrame);
elements.timeline.addEventListener("input", handleTimelineInput);
elements.canvas.addEventListener("click", handleCanvasClick);
elements.video.addEventListener("loadedmetadata", handleLoadedMetadata);
elements.video.addEventListener("timeupdate", render);
elements.video.addEventListener("seeked", render);
elements.video.addEventListener("play", render);
elements.video.addEventListener("pause", render);
elements.undoButton.addEventListener("click", undo);
elements.clearFrameButton.addEventListener("click", clearCurrentFrame);
elements.newSessionButton.addEventListener("click", newSession);

document.querySelectorAll("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => setTool(button.dataset.tool));
});

document.querySelectorAll("[data-event]").forEach((button) => {
  button.addEventListener("click", () => addEvent(button.dataset.event));
});

document.addEventListener("keydown", handleKeydown);
window.addEventListener("resize", render);

render();

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

function handleVideoInput(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
  state.videoObjectUrl = URL.createObjectURL(file);
  elements.video.src = state.videoObjectUrl;
  elements.videoName.textContent = file.name;

  state.annotations.video.filename = file.name;
  state.annotations.video.id = file.name.replace(/\.[^.]+$/, "");
  pushHistory("load-video");
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
      state.annotations = normalizeAnnotations(parsed);
      state.fps = state.annotations.video.fps || state.fps;
      elements.fpsInput.value = String(state.fps);
      elements.videoName.textContent = state.annotations.video.filename || "Labels loaded";
      state.activeTablePoints = [];
      state.activeNetPoints = [];
      state.history = [];
      render();
    } catch (error) {
      window.alert(`Could not load annotation JSON: ${error.message}`);
    }
  });
  reader.readAsText(file);
}

function normalizeAnnotations(input) {
  const empty = createEmptyAnnotations();
  return {
    ...empty,
    ...input,
    video: { ...empty.video, ...(input.video || {}) },
    frames: Array.isArray(input.frames) ? input.frames : [],
    events: Array.isArray(input.events) ? input.events : [],
  };
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

  if (key === ",") stepFrames(-1);
  if (key === ".") stepFrames(1);
  if (key === "b") setTool("ball");
  if (key === "t") setTool("table");
  if (key === "n") setTool("net");
  if (key === "v") setTool("select");
  if (key === "u") undo();
  if (key === "backspace" || key === "delete") clearCurrentFrame();
  if (eventHotkeys[key]) addEvent(eventHotkeys[key]);
}

function setTool(tool) {
  state.tool = tool;
  state.activeTablePoints = [];
  state.activeNetPoints = [];
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  render();
}

function handleCanvasClick(event) {
  if (!elements.video.src || state.tool === "select") return;

  const point = canvasPointToVideoPoint(event.offsetX, event.offsetY);
  const frame = getCurrentFrame();

  pushHistory(`draw-${state.tool}`);
  const frameLabel = getOrCreateFrameLabel(frame);

  if (state.tool === "ball") {
    upsertObject(frameLabel, {
      type: "ball",
      center: [round(point.x), round(point.y)],
      radius: estimateBallRadius(),
      occluded: elements.occludedInput.checked,
      blurred: elements.blurredInput.checked,
    });
  }

  if (state.tool === "table") {
    state.activeTablePoints.push([round(point.x), round(point.y)]);
    if (state.activeTablePoints.length === 4) {
      upsertObject(frameLabel, {
        type: "table",
        polygon: state.activeTablePoints,
      });
      state.activeTablePoints = [];
    }
  }

  if (state.tool === "net") {
    state.activeNetPoints.push([round(point.x), round(point.y)]);
    if (state.activeNetPoints.length === 2) {
      upsertObject(frameLabel, {
        type: "net",
        line: state.activeNetPoints,
      });
      state.activeNetPoints = [];
    }
  }

  cleanupEmptyFrames();
  render();
}

function addEvent(type) {
  if (!elements.video.src) return;

  pushHistory(`event-${type}`);
  const frame = getCurrentFrame();
  const timeMs = getCurrentTimeMs();
  state.annotations.events.push({
    type,
    frame,
    timeMs,
    windowFrames: [Math.max(0, frame - 2), frame + 2],
    confidence: 1,
    notes: "",
  });
  state.annotations.events.sort((a, b) => a.frame - b.frame || a.type.localeCompare(b.type));
  render();
}

function clearCurrentFrame() {
  const frame = getCurrentFrame();
  pushHistory("clear-frame");
  state.annotations.frames = state.annotations.frames.filter((item) => item.frame !== frame);
  state.annotations.events = state.annotations.events.filter((item) => item.frame !== frame);
  state.activeTablePoints = [];
  state.activeNetPoints = [];
  render();
}

function newSession() {
  if (!window.confirm("Clear all labels for this session?")) return;

  pushHistory("new-session");
  const video = state.annotations.video;
  state.annotations = createEmptyAnnotations();
  state.annotations.video = { ...state.annotations.video, ...video };
  state.activeTablePoints = [];
  state.activeNetPoints = [];
  render();
}

function undo() {
  const snapshot = state.history.pop();
  if (!snapshot) return;

  state.annotations = JSON.parse(snapshot);
  state.activeTablePoints = [];
  state.activeNetPoints = [];
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

function downloadAnnotations() {
  const filename = `${state.annotations.video.id || "annotations"}.labels.json`;
  const blob = new Blob([JSON.stringify(state.annotations, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, filename);
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
  resizeCanvasToVideo();
  drawOverlay();
  renderReadout();
  renderFrameSummary();
  renderEventList();
}

function resizeCanvasToVideo() {
  const video = elements.video;
  if (!video.videoWidth || !video.videoHeight) return;

  const rect = video.getBoundingClientRect();
  elements.canvas.width = Math.round(rect.width);
  elements.canvas.height = Math.round(rect.height);
  elements.canvas.style.width = `${rect.width}px`;
  elements.canvas.style.height = `${rect.height}px`;
}

function drawOverlay() {
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);

  const frameLabel = getFrameLabel(getCurrentFrame());
  if (frameLabel) {
    frameLabel.objects.forEach(drawObject);
  }

  drawPendingPoints(state.activeTablePoints, "#34d399");
  drawPendingPoints(state.activeNetPoints, "#f8fafc");
}

function drawObject(object) {
  if (object.type === "ball") drawBall(object);
  if (object.type === "table") drawPolygon(object.polygon, "#34d399");
  if (object.type === "net") drawLine(object.line, "#f8fafc");
}

function drawBall(ball) {
  const point = videoPointToCanvasPoint(ball.center[0], ball.center[1]);
  const radius = videoLengthToCanvasLength(ball.radius || estimateBallRadius());

  ctx.save();
  ctx.strokeStyle = ball.occluded ? "#ffc857" : "#ff6b6b";
  ctx.fillStyle = "rgba(255, 107, 107, 0.18)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPolygon(points, color) {
  if (!points || points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = "rgba(52, 211, 153, 0.12)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    const point = videoPointToCanvasPoint(x, y);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  if (points.length >= 3) ctx.closePath();
  ctx.fill();
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

function renderReadout() {
  const frame = getCurrentFrame();
  const timeMs = getCurrentTimeMs();
  const durationMs = Math.round((elements.video.duration || 0) * 1000);

  elements.playButton.textContent = elements.video.paused ? "Play" : "Pause";
  elements.frameInput.value = String(frame);
  elements.timeline.value = String(elements.video.currentTime || 0);
  elements.timeline.max = String(elements.video.duration || 0);
  elements.timeReadout.textContent = `${formatTime(timeMs)} / ${formatTime(durationMs)} / frame ${frame}`;
}

function renderFrameSummary() {
  const frameLabel = getFrameLabel(getCurrentFrame());
  elements.frameSummary.innerHTML = "";

  if (!frameLabel || frameLabel.objects.length === 0) {
    elements.frameSummary.append(createSummaryItem("Objects", "None"));
  } else {
    frameLabel.objects.forEach((object) => {
      elements.frameSummary.append(createSummaryItem(object.type, summarizeObject(object)));
    });
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
    return `${object.center[0]}, ${object.center[1]} r${object.radius}`;
  }
  if (object.type === "table") return `${object.polygon.length} pts`;
  if (object.type === "net") return "2 pts";
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

function canvasPointToVideoPoint(x, y) {
  const video = elements.video;
  return {
    x: x * (video.videoWidth / elements.canvas.width),
    y: y * (video.videoHeight / elements.canvas.height),
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
