const STORAGE_KEY = "ar-ping-pong-match-v1";

const state = loadState();
const focusables = Array.from(document.querySelectorAll(".focusable"));
let focusIndex = 0;

const elements = {
  scoreA: document.querySelector("#scoreA"),
  scoreB: document.querySelector("#scoreB"),
  serverA: document.querySelector("#serverA"),
  serverB: document.querySelector("#serverB"),
  statusText: document.querySelector("#statusText"),
  pointLog: document.querySelector("#pointLog"),
};

document.addEventListener("keydown", handleKeydown);
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) runAction(button.dataset.action);
});

focusables.forEach((button, index) => {
  button.addEventListener("focus", () => setFocus(index));
});

render();
setFocus(0);

function defaultState() {
  return {
    scoreA: 0,
    scoreB: 0,
    game: 1,
    points: [],
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...defaultState(), ...JSON.parse(saved) } : defaultState();
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function handleKeydown(event) {
  const key = event.key.toLowerCase();

  if (key === "arrowright" || key === "arrowdown") {
    event.preventDefault();
    setFocus((focusIndex + 1) % focusables.length);
  }

  if (key === "arrowleft" || key === "arrowup") {
    event.preventDefault();
    setFocus((focusIndex - 1 + focusables.length) % focusables.length);
  }

  if (key === "enter" || key === " ") {
    event.preventDefault();
    runAction(focusables[focusIndex].dataset.action);
  }

  if (key === "a") runAction("point-a");
  if (key === "l") runAction("point-b");
  if (key === "u") runAction("undo");
  if (key === "r") runAction("reset-game");
}

function setFocus(index) {
  focusIndex = index;
  focusables.forEach((button, buttonIndex) => {
    button.classList.toggle("is-focused", buttonIndex === focusIndex);
  });
  focusables[focusIndex].focus({ preventScroll: true });
}

function runAction(action) {
  if (action === "point-a") addPoint("a");
  if (action === "point-b") addPoint("b");
  if (action === "undo") undoPoint();
  if (action === "reset-game") resetGame();
  if (action === "reset-match") resetMatch();
}

function addPoint(player) {
  const previousScoreA = state.scoreA;
  const previousScoreB = state.scoreB;

  if (player === "a") state.scoreA += 1;
  if (player === "b") state.scoreB += 1;

  state.points.push({
    player,
    previousScoreA,
    previousScoreB,
    scoreA: state.scoreA,
    scoreB: state.scoreB,
    at: Date.now(),
  });

  saveState();
  render();
}

function undoPoint() {
  const previous = state.points.pop();
  if (!previous) return;

  state.scoreA = previous.previousScoreA ?? Math.max(0, previous.scoreA - (previous.player === "a" ? 1 : 0));
  state.scoreB = previous.previousScoreB ?? Math.max(0, previous.scoreB - (previous.player === "b" ? 1 : 0));
  saveState();
  render();
}

function resetGame() {
  state.scoreA = 0;
  state.scoreB = 0;
  state.game += 1;
  state.points = [];
  saveState();
  render();
}

function resetMatch() {
  Object.assign(state, defaultState());
  saveState();
  render();
}

function render() {
  elements.scoreA.textContent = state.scoreA;
  elements.scoreB.textContent = state.scoreB;

  document.querySelector(".mode").textContent = `Game ${state.game}`;
  elements.statusText.textContent = getStatus();

  const server = getServer();
  elements.serverA.classList.toggle("is-hidden", server !== "a");
  elements.serverB.classList.toggle("is-hidden", server !== "b");
  elements.serverA.textContent = server === "a" ? "Serve" : "Receive";
  elements.serverB.textContent = server === "b" ? "Serve" : "Receive";

  renderHistory();
}

function getStatus() {
  const leader = state.scoreA === state.scoreB ? null : state.scoreA > state.scoreB ? "A" : "B";
  const high = Math.max(state.scoreA, state.scoreB);
  const spread = Math.abs(state.scoreA - state.scoreB);

  if (high >= 10 && spread < 2) return "Deuce";
  if (high >= 10 && spread === 1) return `Advantage ${leader}`;
  if (high >= 11 && spread >= 2) return `Game ${leader}`;
  if (high >= 10) return `Game point ${leader}`;
  return "First to 11, win by 2";
}

function getServer() {
  const total = state.scoreA + state.scoreB;
  const serveBlock = total >= 20 ? total : Math.floor(total / 2);
  return serveBlock % 2 === 0 ? "a" : "b";
}

function renderHistory() {
  const recentPoints = state.points.slice(-4).reverse();
  elements.pointLog.innerHTML = "";

  if (recentPoints.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No points yet";
    elements.pointLog.append(empty);
    return;
  }

  recentPoints.forEach((point, index) => {
    const item = document.createElement("li");
    const player = point.player.toUpperCase();
    const label = document.createElement("span");
    const score = document.createElement("span");

    label.textContent = `${index === 0 ? "Last" : "Point"}: Player ${player}`;
    score.textContent = `${point.scoreA}-${point.scoreB}`;
    item.append(label, score);
    elements.pointLog.append(item);
  });
}
