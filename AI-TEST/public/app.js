import { advance, createGame, decisionState, safeMoves } from "./engine.js";

const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");
const startButton = document.querySelector("#start");
const statusElement = document.querySelector("#status");
const scoreElement = document.querySelector("#score");
const movesElement = document.querySelector("#moves");
const modelElement = document.querySelector("#model");
const confidenceElement = document.querySelector("#confidence");
const costElement = document.querySelector("#cost");
const latencyElement = document.querySelector("#latency");
const decisionList = document.querySelector("#probabilities");

let game = createGame();
let running = false;
let runId = 0;

function draw() {
  const cell = canvas.width / game.width;
  context.fillStyle = "#171916";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "#242820";
  context.lineWidth = 1;
  for (let index = 1; index < game.width; index += 1) {
    const position = index * cell;
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, canvas.height);
    context.stroke();
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(canvas.width, position);
    context.stroke();
  }

  if (game.food) {
    context.fillStyle = "#e36d4f";
    context.fillRect(game.food.x * cell + 8, game.food.y * cell + 8, cell - 16, cell - 16);
  }

  game.snake.forEach((part, index) => {
    context.fillStyle = index === 0 ? "#d6f5a2" : "#88ad5d";
    context.fillRect(part.x * cell + 3, part.y * cell + 3, cell - 6, cell - 6);
  });

  scoreElement.textContent = game.score;
  movesElement.textContent = game.moves;
}

function setStatus(text, tone = "idle") {
  statusElement.textContent = text;
  statusElement.dataset.tone = tone;
}

function renderDecision(result) {
  modelElement.textContent = result.model || "—";
  confidenceElement.textContent = Number.isFinite(result.confidence)
    ? `${(result.confidence * 100).toFixed(1)}%`
    : "—";
  costElement.textContent = `$${Number(result.cost || 0).toFixed(4)}`;
  latencyElement.textContent = Number.isFinite(result.latencyMs)
    ? `${result.latencyMs.toLocaleString()} ms`
    : "—";
  decisionList.replaceChildren();
  Object.entries(result.probabilities || {})
    .sort((a, b) => b[1] - a[1])
    .forEach(([move, probability]) => {
      const row = document.createElement("li");
      const label = document.createElement("span");
      const value = document.createElement("span");
      label.textContent = move;
      value.textContent = `${(probability * 100).toFixed(1)}%`;
      row.append(label, value);
      decisionList.append(row);
    });
}

async function requestMove() {
  const response = await fetch("/api/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(decisionState(game)),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Decision request failed");
  return result;
}

async function play(currentRun) {
  while (running && currentRun === runId && !game.over) {
    const available = safeMoves(game);
    if (available.length === 0) {
      game = { ...game, over: true };
      break;
    }

    setStatus("Model is choosing…", "thinking");
    let result;
    try {
      result = await requestMove();
    } catch (error) {
      running = false;
      setStatus(error.message, "error");
      startButton.textContent = "Restart test";
      return;
    }

    if (!running || currentRun !== runId) return;
    renderDecision(result);
    setStatus(`Chose ${result.move}`, "playing");
    game = advance(game, result.move);
    draw();
    await new Promise((resolve) => setTimeout(resolve, 650));
  }

  if (currentRun === runId) {
    running = false;
    setStatus(game.food === null ? "Board cleared" : `Game over after ${game.moves} moves`, game.food === null ? "playing" : "error");
    startButton.textContent = "Restart test";
  }
}

startButton.addEventListener("click", () => {
  runId += 1;
  game = createGame();
  running = true;
  startButton.textContent = "Restart test";
  modelElement.textContent = "Waiting for first move";
  confidenceElement.textContent = "—";
  costElement.textContent = "$0.0000";
  latencyElement.textContent = "—";
  decisionList.replaceChildren();
  draw();
  play(runId);
});

draw();

